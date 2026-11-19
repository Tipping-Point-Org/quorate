// THE ANSWER TO "REVIEW LET IT SLIP".
//
// capture.mjs's tail guard is the node-containment boundary, and a bundled-flag bypass survived
// eleven reviews that had it in scope. It survived because READING `/^-O/` looks correct: finding
// the hole requires knowing that git's parse-options bundles short flags AND that
// --open-files-in-pager runs the pager through a shell. The lens that finally caught it did not
// reason about the regex — it RAN the payload and captured a file from outside the repository.
//
// So the fix for "review missed it" is not more review. It is to encode the DEMONSTRATION as a
// test: drive the real entrypoint, assert the refusal, and assert that nothing from outside the
// repository reached the evidence directory. This runs offline, in milliseconds, with no model.
//
// It is also deliberately written by SHAPE rather than by one string — the class is "an equivalent
// spelling of a forbidden capability", and pinning only `-nOcat` would leave the next spelling
// open.
//
// Split into 2 files by split-slow-test-files.md; the other is regression-capture-containment-hang.test.mjs, and the
// fixture they share is capture-containment-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, REPO_ROOT, repoRunDir, detectorFixture } from './helpers.mjs';
import { forbiddenTailToken } from '../scripts/lib/forbidden-tail.mjs';
import { spawnSync } from 'node:child_process';
import { inRun } from './capture-containment-fixture.mjs';

// Every spelling of "launch a program / read outside the repo" we know of. The bundled forms are
// the ones that shipped.
const ESCAPES = [
  ['-O', 'bare short flag'],
  ['-Ocat', 'short flag with attached value'],
  ['-nOcat', 'BUNDLED behind another short flag — the form that got through'],
  ['-inOcat', 'bundled deeper in the cluster'],
  ['--open-files-in-pager', 'long form'],
  ['--no-index', 'reads outside the repository'],
  ['--output=x', 'writes an arbitrary path'],
  ['--ext-diff', 'runs an external program'],
  ['--textconv', 'runs a configured filter'],
];

for (const [flag, why] of ESCAPES) {
  test(`regression: capture REFUSES \`${flag}\` (${why})`, () => {
    inRun((dir) => {
      const r = runScript('capture.mjs', [
        '--run-dir', dir, '--node', 't', '--name', 'probe',
        '--', 'git', 'grep', flag, 'FORBIDDEN', '--', 'scripts/capture.mjs',
      ]);
      assert.notEqual(r.status, 0, `${flag} was ACCEPTED — the containment boundary is open`);
      assert.match(r.output, /refusing/i, `${flag} must be refused with a stated reason`);
    });
  });
}

// The property that actually matters, asserted on the artifact rather than on the exit code: a
// refused command must leave NOTHING from outside the repository in the evidence directory.
test('regression: no out-of-repo content reaches evidence through a refused command', () => {
  inRun((dir, base) => {
    const secret = path.join(base, 'outside.txt');
    fs.writeFileSync(secret, 'CANARY-OUTSIDE-THE-REPOSITORY');
    runScript('capture.mjs', [
      '--run-dir', dir, '--node', 't', '--name', 'probe',
      '--', 'git', 'grep', `-nOcat ${secret} #`, 'FORBIDDEN', '--', 'scripts/capture.mjs',
    ]);
    const ev = path.join(dir, 'evidence');
    const leaked = [];
    const walk = (p) => {
      if (!fs.existsSync(p)) return;
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const f = path.join(p, e.name);
        if (e.isDirectory()) walk(f);
        else if (fs.readFileSync(f, 'utf8').includes('CANARY-OUTSIDE-THE-REPOSITORY')) leaked.push(f);
      }
    };
    walk(ev);
    assert.deepEqual(leaked, [], 'a file from outside the repository reached the evidence directory');
  });
});

// A guard that refuses everything is its own failure: a lens that cannot capture stops emitting
// findings and reads as a weak reviewer rather than a blocked one.
test('a legitimate read-only capture still succeeds', () => {
  inRun((dir) => {
    const r = runScript('capture.mjs', [
      '--run-dir', dir, '--node', 't', '--name', 'ok',
      '--', 'git', 'grep', '-n', 'forbiddenTailToken', '--', 'scripts/capture.mjs',
    ]);
    assert.equal(r.status, 0, `legitimate capture was refused:\n${r.output.slice(0, 300)}`);
    assert.match(r.stdout, /evidence\/t\/ok\.log/);
  });
});

test('a fast command is unaffected by the bound', () => {
  inRun((dir) => {
    const r = runScript('capture.mjs', [
      '--run-dir', dir, '--node', 't', '--name', 'quick',
      '--', 'git', 'rev-parse', '--is-inside-work-tree',
    ]);
    assert.equal(r.status, 0, `an ordinary capture must not be affected:\n${r.output.slice(0, 300)}`);
  });
});

// GIT ACCEPTS UNIQUE PREFIX ABBREVIATIONS, and the long-option guard matched full spellings only.
//
// Found by security-audit on the 2026-09-06 sweep, and not argued — demonstrated, through
// capture.mjs, the sanctioned channel:
//
//     git grep --op=echo SHELL_METACHARS_EXECUTED; hostname
//     -> exit 0, printed SHELL_METACHARS_EXECUTED and the machine's hostname
//
// `--op` is an unambiguous abbreviation of `--open-files-in-pager`, which git runs through a SHELL.
// Same primitive the short-flag bundling defect gave up, reached by a different road: this is the
// third time this guard has been bypassed by a spelling it did not model, and the lesson each time
// is that a deny-list must model how the TARGET parses its input.
test('a prefix abbreviation of a forbidden long option is refused', () => {
  // The exact token from the demonstration.
  assert.ok(forbiddenTailToken('--op=echo SHELL_METACHARS_EXECUTED; hostname'),
    'the demonstrated escape must be refused');

  for (const t of ['--op', '--ope', '--open-files-in-pager', '--outp=/tmp/x', '--textc', '--no-ind',
    '--upload-p=sh', '--recei', '--cont=/etc/passwd', '--ext']) {
    assert.ok(forbiddenTailToken(t), `${t} abbreviates a forbidden option and must be refused`);
  }

  // Ambiguous between --output and --open-files-in-pager. git rejects it; so do we, because a token
  // whose meaning cannot be determined is exactly what failing closed is for.
  assert.ok(forbiddenTailToken('--o'), 'an ambiguous abbreviation must not be admitted');

  // Extensions too, in the other direction.
  assert.ok(forbiddenTailToken('--output-indicator-new=x'));
});

// A guard that fires on correct input is one people learn to route around — this project's own
// doctrine on ceilings. git resolves an EXACT match before any abbreviation, so --text is --text.
test('a real option that merely prefixes a forbidden one is still allowed', () => {
  assert.equal(forbiddenTailToken('--text'), false,
    '--text is a real git flag and git resolves it exactly; refusing it would break legitimate ' +
    'captures and teach the operator to route around the guard');

  for (const t of ['--oneline', '--name-only', '--stat', '--numstat', '--patch', '-n', '--']) {
    assert.equal(forbiddenTailToken(t), false, `${t} is legitimate and must pass`);
  }
});

// checks.json is TRACKED and COMMITTED; `.claude/reviews/*/evidence/` is gitignored on purpose,
// because a declared command's output is not the framework's to publish. run-checks was copying the
// last 15 lines of that output into checks.json as `stderr_tail`, so the one thing git was told to
// keep out was partly copied into a file git keeps forever — and a committed artifact carried the
// build's stdout verbatim. The commands are whatever a consuming project declares, and a failing
// test prints whatever it prints.
test('checks.json carries a pointer to the evidence, never a copy of it', () => {
  // A result's shape is the shared core's since remediation-verification stage 4 (io/declared-checks.mjs); run-checks
  // writes it into checks.json. Neither may carry command output.
  const core = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'declared-checks.mjs'), 'utf8');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-checks.mjs'), 'utf8');
  for (const s of [core, src]) {
    assert.doesNotMatch(s, /stderr_tail:/,
      'a tracked artifact must not carry command output; evidence_path already names the full log, ' +
      'at a path deliberately kept out of the repository');
  }
  assert.match(core, /evidence_path:/, 'the pointer itself must stay');
});

// The rule that makes the above load-bearing: evidence is excluded, so nothing may smuggle it back
// in under another name.
test('run evidence is gitignored, and checks.json is not evidence', () => {
  const ignored = (p) => spawnSync('git', ['check-ignore', '-q', p], { cwd: REPO_ROOT }).status === 0;
  assert.ok(ignored('.claude/reviews/20260101-000000-x/evidence/pre-flight/build.log'),
    'command output is excluded from the repository');
  assert.equal(ignored('.claude/reviews/20260101-000000-x/checks.json'), false,
    'checks.json is deliberately tracked — which is exactly why it must not contain output');
});

// A run.json WITHOUT A run_id SKIPPED THE IDENTITY CHECK ENTIRELY (G-3, panel-codex-security).
//
// `if (rj.run_id && rj.run_id !== basename)` made the check conditional on the field it was
// checking, so the one run.json anyone planting a directory would author — the one that simply
// omits the field — passed. That directory's own `contract.commands` then decides what this
// already-authorised execution surface will run. A missing field is not consent.
test('a run directory that cannot name itself is refused', () => inRun((dir) => {
  // Self-consistent in every other way, inside the repository, and carrying an allow-list of its
  // own — everything the old guard checked, minus the field that made it check anything.
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
    host: { cwd: REPO_ROOT }, contract: { commands: { test: 'hostname' } },
  }));
  const r = runScript('capture.mjs',
    ['--run-dir', dir, '--node', 'x', '--name', 'y', '--', 'git', 'status']);
  assert.notEqual(r.status, 0, 'a directory with no run_id must not be writable evidence');
  assert.match(r.output, /is not the run its run\.json names \(run_id null\)/);
}));

// A REPEATED --name OVERWROTE ACCEPTED EVIDENCE IN PLACE (G-6, panel-codex-arch).
//
// capture wrote the caller's chosen path directly while the run's other evidence writer has used
// freeEvidenceName since a probe record was destroyed that way. Retries are the NORMAL case here: a
// lens that captures, reads the output, and captures again under the same name is following its
// brief — and the finding citing the first log kept citing a path that now held something else.
test('a second capture under the same name does not destroy the first', () => inRun((dir, base) => {
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
    run_id: path.basename(dir), repo_root: REPO_ROOT, host: { cwd: REPO_ROOT }, contract: { commands: {} },
  }));
  const cap = (n) => runScript('capture.mjs',
    ['--run-dir', dir, '--node', 'lens', '--name', n, '--', 'git', 'rev-parse', '--short', 'HEAD']);

  const first = cap('probe');
  assert.equal(first.status, 0, first.output);
  const evidence = path.join(dir, 'evidence', 'lens');
  const firstBody = fs.readFileSync(path.join(evidence, 'probe.log'), 'utf8');

  const second = cap('probe');
  assert.equal(second.status, 0, second.output);
  assert.equal(fs.readFileSync(path.join(evidence, 'probe.log'), 'utf8'), firstBody,
    'the first capture is what an earlier finding cites — it may not be rewritten under it');
  assert.ok(fs.existsSync(path.join(evidence, 'probe.2.log')), 'the retry must land somewhere');
  // ...and the caller is told where it actually went, or it cites a path it did not write.
  assert.match(second.output, /probe\.2\.log/);
  void base;
}));

// I-30 BOUNDS THE LOG ON DISK, AND THE FRAMEWORK'S OWN BYTES WERE OUTSIDE THE BUDGET (G-5).
//
// logWindow received the whole 1 MiB for command output alone; capture then wrote a header — and,
// when truncating, a truncation notice — into the same file. The artifact came out over the stated
// limit by exactly the bytes the framework added to it, which is the least defensible way to
// exceed a limit you set.
test('the evidence log stays under its stated ceiling, header included', () => inRun((dir) => {
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
    run_id: path.basename(dir), repo_root: REPO_ROOT, host: { cwd: REPO_ROOT }, contract: { commands: {} },
  }));
  // Oversized output through a command the allow-list ALREADY permits. An earlier draft used
  // `node -e` and was refused by the payload allow-list — exit 2, no log written, and an assertion
  // that could only ever pass. This repository's own history is several megabytes of patch.
  // A FIXED COMMIT'S ANCESTRY, not the whole history (2026-10-01): the history passed 64 MiB of patch — capture's spawn
  // buffer — and this test then failed on ENOBUFS, measuring the repository's age instead of the cap. d9911760's
  // ancestry is about 6.6 MB, past the cap and fixed for good.
  // A SQUASHED MIRROR has no d9911760 (ROADMAP D2: one commit per release), and its one commit's patch is the whole tree,
  // several megabytes: that root commit serves instead, so the cap is still measured there (m2-public-release stage 2b).
  const pinned = 'd9911760cdd9e677672a8cba3d740843b85f52e2';
  const ref = spawnSync('git', ['cat-file', '-e', `${pinned}^{commit}`], { cwd: REPO_ROOT }).status === 0 ? pinned
    : spawnSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim().split('\n')[0];
  const r = runScript('capture.mjs',
    ['--run-dir', dir, '--node', 'lens', '--name', 'big', '--', 'git', 'log', '-p', '--no-color', ref]);
  assert.equal(r.status, 0, r.output);
  const log = path.join(dir, 'evidence', 'lens', 'big.log');
  const body = fs.readFileSync(log, 'utf8');
  const size = fs.statSync(log).size;
  assert.ok(size > 900 * 1024, `only ${size} bytes produced — the cap was never reached, so this proves nothing`);
  assert.ok(size <= 1024 * 1024, `log is ${size} bytes, over the 1 MiB I-30 states`);
  // The bytes that pushed it over were the framework's OWN: the header capture writes, and the
  // truncation notice logWindow used to add outside the budget it was handed.
  assert.ok(body.startsWith('$ git log'), 'the header is inside the budget, not additional to it');
  assert.match(body, /\[TRUNCATED —/);
}));

test('output past the spawn buffer is reported as an overflow, not as a failure to start', (t) => inRun((dir) => {
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
    run_id: path.basename(dir), repo_root: REPO_ROOT, host: { cwd: REPO_ROOT }, contract: { commands: {} },
  }));
  // The whole history's patch: past 64 MiB in this repository since 2026-10-01. A clone where it is not yet is skipped.
  const r = runScript('capture.mjs', ['--run-dir', dir, '--node', 'lens', '--name', 'huge', '--', 'git', 'log', '-p', '--no-color']);
  if (!/ENOBUFS|64 MiB spawn buffer/.test(r.output)) { t.skip('this clone\'s history is under the 64 MiB spawn buffer'); return; }
  assert.doesNotMatch(r.output, /failed to start/, 'an overflow was reported as a failure to start');
  assert.match(r.output, /exceeded the 64 MiB spawn buffer/);
}));

// A RELATIVE PATH IS NOT A PATH DERIVED FROM THIS FILE'S LOCATION (G-6, security-audit).
//
// The allow-list admitted `['node', DETECTOR_REL]`, and node resolves a relative path against the
// SPAWN's working directory — `opts.cwd` when the caller passes `--cwd` — not against capture.mjs.
// Demonstrated through the sanctioned channel: `--cwd <repo>/scripts -- node
// scripts/find-inert-features.mjs` passed both the allow-list and the tail check, and node then
// tried to load `<repo>/scripts/scripts/find-inert-features.mjs` — a path inside the reviewed tree,
// which the reviewed tree can itself contain. Had that file existed it would have run under the
// node's permissions with the environment unscrubbed. Same defect the two deleted legacy literals
// were removed for, reintroduced by a relative spelling of the right value.
test('the detector is executable only by its absolute path', () => inRun((dir) => {
  // host.cwd is a small fixture, where the absolute form runs (test-suite-cost.md); --cwd below stays confined to it.
  const fixture = detectorFixture();
  fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
    run_id: path.basename(dir), repo_root: REPO_ROOT, host: { cwd: fixture }, contract: { commands: {} },
  }));

  const relative = runScript('capture.mjs', [
    '--run-dir', dir, '--node', 'x', '--name', 'y', '--cwd', path.join(fixture, 'scripts'),
    '--', 'node', 'scripts/find-inert-features.mjs',
  ]);
  assert.notEqual(relative.status, 0, 'a relative path resolves against the caller, not against us');
  assert.match(relative.output, /refusing to execute/);

  // The absolute form — the one the brief actually hands a node — still works.
  // AT THE FIXTURE, by --cwd: capture runs a command at --cwd or the admitted repository, not at run.json's host.cwd (G-6 of
  // 20261023-014400-rdt-delivery), so without it this swept the whole repository — about a minute alone and past capture's
  // 10-minute limit under the suite (found 2026-10-26, runtime-call-telemetry stage 4).
  const absolute = runScript('capture.mjs', [
    '--run-dir', dir, '--node', 'x', '--name', 'det', '--cwd', fixture,
    '--', 'node', path.join(REPO_ROOT, 'scripts', 'find-inert-features.mjs'),
  ]);
  assert.equal(absolute.status, 0, absolute.output.slice(0, 300));

  // And the derivation itself is gone, not merely unused: a dangerous value left computed is one
  // edit away from being used again.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'capture.mjs'), 'utf8');
  assert.ok(!/const DETECTOR_REL =/.test(src));
}));

// ONE OWNER FOR THE COMMAND KEYS A NODE MAY EXECUTE (G-7, arch-review).
//
// A byte-identical nine-element literal sat in capture.mjs, which decides what a node may run
// through the evidence channel, and in new-run.mjs, which writes the policy rule for each declared
// command — two modules that never communicate, with no test comparing them. Adding a tenth key and
// updating one leaves the command granted by the policy and refused by capture, which reads as the
// project's own check being broken rather than as a missing allow-list entry.
test('capture and the node policy agree about which commands are executable', async () => {
  const { EXECUTABLE_COMMAND_KEYS } = await import('../scripts/lib/decisions.mjs');
  for (const f of ['capture.mjs', 'new-run.mjs']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', f), 'utf8');
    assert.match(src, /EXECUTABLE_COMMAND_KEYS/, `${f} must read the shared set`);
    assert.ok(!/'build', 'test', 'test_product'/.test(src), `${f} still carries a private copy`);
  }
  // `run` is deliberately absent: it launches the product, and feature-verify has its own route.
  assert.ok(!EXECUTABLE_COMMAND_KEYS.includes('run'));
  assert.ok(EXECUTABLE_COMMAND_KEYS.includes('test'));
});

// G-5 of 20261023-024719-rdt-remediation-b-review: the evidence directory's realpath was used only for the containment
// comparison, and the log was then named and written through the unresolved path, so a junction swapped in after the
// check redirected it. The directory the check resolved is the one written to. Read from the source: the window is a
// race between two statements, which no offline drive can open deterministically.
// REWRITTEN for run-dir-descendants.plan.md stage 2: the directory used to be resolved with realpath and checked, and
// this held the log to that resolved directory. The one owner now makes evidence/<node> level by level, refusing a
// link at any level, so the property is that the log is named in the directory the OWNER returned and created through
// it. The behaviour is held end to end by regression-capture-evidence-link-and-cwd.test.mjs.
test('capture writes its log through the evidence directory the one owner made', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'capture.mjs'), 'utf8');
  const made = src.match(/\b\w+\s*=\s*owner\.dir\(\s*(\[\s*'evidence'[^\]]*\])/);
  assert.ok(made, 'capture.mjs no longer makes its evidence directory through the owner');
  // The name is tested through the same owner, below the same names (run-dir-reads.plan.md stage 3; G-2 of
  // 20261029-134336-rdd-remediation-3-review): { owner, segments }, not an lstat of a joined path.
  const named = src.match(/freeEvidenceName\(\s*\{\s*owner,\s*segments:\s*(\[[^\]]*\])\s*\}/);
  assert.ok(named, 'capture.mjs no longer names its log with freeEvidenceName through the owner');
  assert.equal(named[1], made[1], 'the log is named in a directory other than the one the owner made');
  assert.match(src, /owner\.create\(\s*\[\s*'evidence'/, 'the log is not created through the owner');
});
