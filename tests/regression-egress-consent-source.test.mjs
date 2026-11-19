// G-8: `--run-dir` meant two different things, and the egress decision paid for it.
//
// It named both a MINTED GRAPH RUN — whose run.json freezes the contract at mint precisely so a
// mid-run edit cannot change what the run consented to — and, for the pre-run `/request` path, a
// plain directory to keep raw reviewer output in. Because the two were indistinguishable, a run
// directory whose run.json was unreadable, truncated, or missing its `contract` key fell through
// to re-parsing the LIVE contract. Consent could therefore change after the mint, on the one path
// where freezing it was the entire point: enable the panel mid-run and arms start transmitting
// under a consent the run never recorded.
//
// capture.mjs fails closed in the same situation. This did not, and the artifacts would have
// described a contract nobody could reconstruct.
//
// The flags are separate now: `--run-dir` asserts a minted run and is held to it; `--evidence-dir`
// claims only a place to write. What is tested here is that the assertion is REFUSED when it cannot
// be substantiated — never quietly answered from a different source.
//
// Every case below is a REFUSAL. Nothing here may exercise an accepted egress: that path spawns a
// real reviewer CLI against the operator's own account, and a regression suite must never do that.
//
// A WARNING FOR ANYONE PROVING THESE GO RED. Reverting the fix to check that these tests fail does
// not merely fail them — it GRANTS consent, because this repository's live contract has
// external_panel: true, and the first two cases then spawn real codex sessions and bill them. That
// happened while this was written: two live calls, 70 s and 55 s, which is also the sharpest
// evidence that the defect was reachable rather than theoretical. If you need the red proof, cut
// the transport first (an unset PATH entry for the reviewer, or `--reviewer` pointed at a shim).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { runScript, REPO_ROOT, repoRunDir } from './helpers.mjs';

// external-review.mjs always exits 0 and always prints one envelope — a refusal is data, not a
// crash — so the refusal is read out of not_checked[] rather than from a status code.
let promptFile = null;
function promptPath() {
  if (!promptFile) {
    const { dir } = repoRunDir({ runId: '20260101-000000-consentprompt' });
    promptFile = path.join(dir, 'prompt.md');
    fs.writeFileSync(promptFile, 'review this');
  }
  return promptFile;
}

function review(args) {
  const r = runScript('external-review.mjs', ['--reviewer', 'codex', '--prompt-file', promptPath(), ...args]);
  let env = null;
  try { env = JSON.parse(r.stdout); } catch { /* a die() prints no envelope; the caller asserts on r */ }
  // `egress_basis` is the field that records WHY, in one line — the not_checked reason appends
  // generic advice ("Set review.external_panel: true to enable it") that would satisfy a naive
  // match for the fallback this test exists to forbid. Assert on the basis, not on the prose.
  return { r, env, basis: env?.egress_basis ?? '' };
}

test('regression: a run directory with no readable run.json is refused, not answered from the live tree', () => {
  const { base, dir } = repoRunDir({ runId: '20260101-000000-consent' });
  try {
    fs.writeFileSync(path.join(dir, 'run.json'), '{ this is not json');
    const { r, basis } = review(['--run-dir', dir]);
    // Refused at admission since run-dir-trust (ARCHITECTURE A-28): before any consent is read, with no envelope.
    assert.notEqual(r.status, 0, r.output);
    assert.match(r.stderr, /no readable run\.json/,
      'the caller asserted a minted run; failing to read its contract must refuse, not fall back');
    // The live contract of THIS repository has external_panel: true, so the old fallback would have
    // answered YES here with the basis below. That is what makes this test meaningful rather than
    // vacuous — and it is why the fixture lives in this repo and not in a synthetic tree.
    assert.notEqual(basis, 'review.external_panel: true',
      'consent must not be re-derived from the live tree once a run has been asserted');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('regression: a run.json without a contract is refused', () => {
  const { base, dir } = repoRunDir({ runId: '20260101-000000-consent2', json: { contract: undefined } });
  try {
    // Admitted (named for its directory, naming this repository), so the consent rule is what refuses it.
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: path.basename(dir), repo_root: REPO_ROOT, stamps: [] }));
    const { basis } = review(['--run-dir', dir]);
    assert.match(basis, /records no contract/,
      'a run that froze no contract froze no consent');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('regression: a frozen contract with the panel off is refused even when the live tree has it on', () => {
  // THE MID-RUN EDIT, in the direction that matters. The run said no; the tree now says yes; the
  // run's answer is the one that counts.
  const { base, dir } = repoRunDir({ runId: '20260101-000000-consent3' });
  try {
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
      run_id: path.basename(dir), repo_root: REPO_ROOT, contract: { review: { external_panel: false } },
    }));
    const { basis } = review(['--run-dir', dir]);
    assert.match(basis, /not true in the contract this run froze at mint/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('regression: the two flags are alternatives, not a pair', () => {
  const { base, dir } = repoRunDir({ runId: '20260101-000000-consent4' });
  try {
    const { r } = review(['--run-dir', dir, '--evidence-dir', dir]);
    assert.equal(r.status, 2, 'an ambiguous consent source is a usage error, not a silent precedence rule');
    assert.match(r.output, /alternatives/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('regression: the evidence sink is confined to the repository too', () => {
  // G-9 confinement was written for --run-dir. The new flag writes to disk exactly as much, so it
  // is held to the same boundary — a split that dropped the check on one side would have traded one
  // defect for a worse one.
  const outside = path.resolve(REPO_ROOT, '..', 'quorate-egress-escape-fixture');
  const { r } = review(['--evidence-dir', outside]);
  assert.equal(r.status, 2, 'a sink outside the tree must be refused before anything is written');
  assert.match(r.output, /--evidence-dir/, 'the message must name the flag the caller actually used');
  assert.ok(!fs.existsSync(outside), 'nothing may be created outside the repository, not even the directory');
});

// THE BASIS WAS RECORDED ON ONE EMITTER IN THREE (G-11, contract-audit against I-5).
//
// `egress_basis` was set in `envelope()`, which only `emit()` uses — so a proposal batch and a
// tie-break ruling left the machine recording nothing about WHY they were permitted to. I-5 names
// "--consent transport-probe accepted but not recorded in the envelope" as the failure mode, and
// the tie-break is the path most likely to be driven by an explicit --consent rather than by the
// project's own opt-in. An egress control whose decision is unrecorded cannot be audited afterwards,
// which is most of the point of having one.
test('every emitter records why the egress was allowed, not just the review one', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');

  // One per emitter: envelope() for review, emitProposal(), emitRuling(), and emitClaimCheck() since the claim-check mode
  // (claim-check-cross-family.plan.md stage 2), whose egress can carry a session transcript, and emitDecision() since the
  // decide mode (autonomous-run.plan.md stage 4), whose egress carries a question and its work context.
  assert.equal((src.match(/egress_basis: consent\?\.why \?\? null,/g) ?? []).length, 5,
    'a mode whose envelope omits the basis is a mode whose egress cannot be audited');

  for (const [name, end] of [['function emitProposal(', 'function emitRuling('],
    ['function emitRuling(', 'function emitClaimCheck('], ['function emitClaimCheck(', 'function emitDecision('],
    ['function emitDecision(', 'function unavailable(']]) {
    const body = src.slice(src.indexOf(name), src.indexOf(end));
    assert.match(body, /egress_basis/, `${name.replace('function ', '')} emits no egress basis`);
  }
});

// AN EMPTY CREDENTIAL PREFIX IS THE WHOLE ENVIRONMENT (G-16, panel-codex-security + security-audit).
//
// `env_prefixes` is contract-supplied — a consuming project declares its own reviewers — and every
// variable name startsWith(''), so `env_prefixes: [""]` forwards GITHUB_TOKEN, AWS keys and
// DATABASE_URL through both external-review hops to a third-party agentic CLI. The allow-list exists
// precisely because "a deny-list cannot bound an open set of secrets"; one blank entry turns it into
// no list at all.
test('a blank credential prefix forwards nothing, and is named at mint', async () => {
  const { reviewerEnv } = await import('../scripts/lib/decisions.mjs');
  const { adapterErrors, builtinReviewers } = await import('../scripts/io/reviewers.mjs');

  const secrets = { SECRET_TOKEN: 'x', GITHUB_TOKEN: 'y', CODEX_KEY: 'z' };
  const passed = (prefixes) => reviewerEnv('v', secrets, { depth: 0, prefixes }).passed;

  assert.deepEqual(passed(['']), [], 'an empty prefix must forward nothing, not everything');
  assert.deepEqual(passed(['  ']), [], 'nor a whitespace one');
  assert.deepEqual(passed(['', 'CODEX_']), ['CODEX_KEY'],
    'a real prefix beside a blank one still works — the fix drops the blank, not the list');

  // Named at MINT, because the pure layer can only drop it silently and a declaration that would
  // have leaked everything deserves more than being quietly narrowed to nothing.
  const errs = adapterErrors('bad', {
    cmd: 'x', env_prefixes: [''], response: { from: 'file' }, prompt: { via: 'stdin' },
  });
  assert.ok(errs.some((e) => /empty prefix matches every variable name/.test(e)), errs.join('; '));

  // And every shipped adapter still validates, so the check is not simply refusing everything.
  for (const [name, a] of Object.entries(builtinReviewers())) {
    assert.deepEqual(adapterErrors(name, a).filter((e) => /prefix/.test(e)), [], name);
  }
});

// THE ARM'S EVIDENCE COULD LAND WHERE GIT KEEPS IT FOREVER (G-9, security-audit).
//
// --evidence-dir was confined to "inside the repository", and that is exactly the set of places git
// remembers: the only rule covering evidence is `.claude/reviews/*/evidence/`, while the /request
// skill tells a caller to pass `--evidence-dir <abs>` without naming one — so the natural choices
// (the repo root, a scratch folder, docs/) are all tracked surface. What lands there is the RAW
// VENDOR RESPONSE, the class this project already refused to commit once: run-checks dropped
// stderr_tail from the tracked checks.json because command output may hold "a connection string, an
// environment dump, a token inside an error". /request's cross-family critique is default-ON.
test('an evidence directory git would track is refused by name', () => {
  // THE FIXTURE IS BUILT, NOT BORROWED (G-37, panel-codex-arch + panel-codex-security). This used
  // to hunt for an ARCHIVED arm prompt and `return` when it found none — so on a fresh checkout, or
  // once the archives are pruned, the test reported PASS without exercising anything. A prompt file
  // is just text as far as this check is concerned: the containment refusal happens long before
  // anything reads it.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-prompt-'));
  const prompt = path.join(tmp, 'arm-prompt.md');
  fs.writeFileSync(prompt, 'review the declared scope');

  // A DIRECTORY THAT IS TRACKED AND WILL STAY. This named `docs/`, which existed only to hold
  // `docs/requests/` — and when those moved to `.claude/requests/` (a request is an input the
  // engine reads, not documentation) the directory went with them. The refusal then came back
  // "could not be resolved through links", which is a DIFFERENT refusal: correct behaviour for a
  // path that does not exist, and no evidence at all about the tracked-surface rule this asserts.
  // `shared/` is doctrine the framework cannot lose.
  const trackedDir = path.join(REPO_ROOT, 'shared');
  assert.ok(fs.existsSync(trackedDir), 'the fixture must name a directory that actually exists, or '
    + 'the refusal under test is replaced by an unresolvable-path refusal that looks like a pass');
  const tracked = runScript('external-review.mjs',
    ['--evidence-dir', trackedDir, '--node-id', 'gp', '--reviewer', 'codex',
      '--prompt-file', prompt]);
  assert.notEqual(tracked.status, 0);
  assert.match(tracked.output, /inside git's tracked surface/);

  // A run's own evidence tree IS gitignored, so a run directory must still pass — the check looks at
  // where bytes LAND (`<dir>/evidence/<node-id>`), not at the directory that was named.
  //
  // MINTED, NOT BORROWED. This read `.claude/reviews` and took `runs[0]` — a real, committed review
  // artifact — which two tests then shared under the parallel runner. See
  // regression-no-test-adopts-a-real-run.test.mjs.
  const minted = repoRunDir();
  try {
    const ok = runScript('external-review.mjs',
      ['--run-dir', minted.dir, '--node-id', 'gp', '--reviewer', 'codex', '--prompt-file', prompt,
        '--allowed-basis', 'measurement']);
    assert.ok(!/tracked surface/.test(ok.output),
      `a run directory whose evidence tree is gitignored must not be refused: ${ok.output.slice(0, 200)}`);
  } finally {
    fs.rmSync(minted.base, { recursive: true, force: true });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ANY LEGITIMATE run.json BECAME A NODE'S ALLOW-LIST (G-5, security-audit).
//
// capture confines --run-dir to the repository and then reads THAT directory's run.json for
// contract.commands, so any valid run directory in the tree decided what the node may execute.
// run.json is a TRACKED artifact, so a project mounting this submodule inherits committed run
// directories whose frozen contracts become allow-lists for its own lenses — demonstrated live from
// a lens, which reached a second project's `python -m pytest` and `ruff check` while this repository
// declares lint and typecheck empty on purpose. G-6 closed the COUNTERFEIT case; a legitimate
// run.json belonging to a different contract passed that check unchanged.
test('a node may only use the allow-list of the run it belongs to', () => {
  // MINTED, NOT BORROWED, and this site is why it mattered most: the old version wrote
  // `<runs[0]>/evidence/x/y.log` into a COMMITTED review and then removed it, while the test above
  // used the same `runs[0]` and the same node id. Under the parallel runner one deleted what the
  // other was writing. A committed run directory is evidence; a test's scratch space is not.
  const minted = repoRunDir({ runId: 'a-real-run-id-000000-x' });
  const runDir = minted.dir;
  try {
    const foreign = runScript('capture.mjs',
      ['--run-dir', runDir, '--node', 'x', '--name', 'y', '--', 'git', 'status'],
      { env: { QUORATE_RUN_ID: 'a-different-run' } });
    assert.notEqual(foreign.status, 0);
    assert.match(foreign.output, /is not this node's allow-list/);

    // Absent means a caller outside the graph — /request, a probe, a person — and that keeps working.
    // This pins a NODE to its own run, and it is a node that has an allow-list to abuse.
    const outside = runScript('capture.mjs',
      ['--run-dir', runDir, '--node', 'x', '--name', 'y', '--', 'git', 'rev-parse', '--short', 'HEAD']);
    assert.equal(outside.status, 0, outside.output.slice(0, 200));
  } finally {
    fs.rmSync(minted.base, { recursive: true, force: true });
  }

  // And the spawner sets it, outside the model's reach, like the depth guard beside it.
  const spawn = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  assert.match(spawn, /QUORATE_RUN_ID: String\(runJson\.run_id/);
});

// THE EGRESS CHECK WOULD HAVE KILLED EVERY ARM IN EVERY CONSUMING PROJECT (G-10, code-audit).
//
// external-review refuses to write a vendor response into git's tracked surface — and the only
// pattern covering `<run>/evidence/` was THIS framework's own .gitignore. A project that mounts the
// submodule as documented and sets `external_panel: true` had every panel arm die at exit 2 before
// any vendor call, because nothing in QUORATE.md's setup or in any skill tells it to add that rule.
// A guarantee that holds only in the repository that wrote it is the inert-guarantee shape, aimed
// at consumers.
//
// quorate owns reviews_dir, so it keeps the rule there: a .gitignore inside the directory it governs
// needs no instruction and no edit to the project's own.
// EVIDENCE IS NEVER COMMITTED, and there are now two ways that is achieved.
//
// Runs used to be written into the repository under review, so the guarantee rested on a RULE: the
// engine wrote a `.gitignore` into its own reviews directory. Run directories now default OUT of the
// tree, where the guarantee holds BY CONSTRUCTION -- git cannot ignore what it cannot see. The rule
// still matters for a project that deliberately declares an in-tree reviews_dir to keep its evidence
// trail, so both paths are held here rather than one being dropped as obsolete.
//
// §3 accepts capture.mjs inheriting the operator's environment on the stated ground that its output
// "stays on local disk and is never committed". That sentence is what these two tests defend.
test('by construction: a default run writes nothing git can see', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-consumer-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-home-'));
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '.');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n```\n');
    git('add', '-A');
    git('commit', '-qm', 'init');

    const r = runScript('new-run.mjs',
      ['--slug', 'consumer', '--no-verify-sandbox', '--no-request', '--full-sweep', '.'],
      { cwd: dir, env: { QUORATE_HOME: home } });
    assert.equal(r.status, 0, r.output.slice(-300));

    // THE PROPERTY, asked of git rather than of a rule: the working tree is unchanged by a mint.
    const status = git('status', '--porcelain');
    assert.equal(status.stdout.trim(), '',
      'a mint must leave the reviewed tree untouched -- that is the whole reason runs moved out of it');
    assert.ok(!fs.existsSync(path.join(dir, '.claude', 'reviews')),
      'and it must not create a reviews directory in a tree that never asked for one');
    assert.ok(fs.readdirSync(path.join(home, 'reviews')).length > 0, 'the run went to quorate home');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('by rule: a project that keeps its reviews in-tree still gets the ignore rule', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-consumer-'));
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '.');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
      + 'review:\n  reviews_dir: ".claude/reviews"\n```\n');
    git('add', '-A');
    git('commit', '-qm', 'init');

    const r = runScript('new-run.mjs',
      ['--slug', 'consumer', '--no-verify-sandbox', '--no-request', '--full-sweep', '.'],
      { cwd: dir });
    assert.equal(r.status, 0, r.output.slice(-300));

    const ignore = path.join(dir, '.claude', 'reviews', '.gitignore');
    assert.ok(fs.existsSync(ignore), 'the engine must bring its own rule to a project that has none');
    assert.match(fs.readFileSync(ignore, 'utf8'), /\*\/evidence\//);

    // The property that matters: git itself agrees, so external-review's check passes here.
    const run = fs.readdirSync(path.join(dir, '.claude', 'reviews')).find((d) => d.includes('consumer'));
    const checked = git('check-ignore', '-q', path.join('.claude', 'reviews', run, 'evidence'));
    assert.equal(checked.status, 0, 'a consumer keeping reviews in-tree must have its evidence ignored');

    // And an operator who edited it keeps their version.
    fs.writeFileSync(ignore, '# mine\n*/evidence/\n');
    runScript('new-run.mjs',
      ['--slug', 'consumer2', '--no-verify-sandbox', '--no-request', '--full-sweep', '.'], { cwd: dir });
    assert.match(fs.readFileSync(ignore, 'utf8'), /^# mine/, 'a file the operator changed is theirs');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-10 of run 20260924-145430-post-med2 — `panel-codex-security`, verified in source.
//
// `resolved.some((p) => k.startsWith(p))` accepted any non-empty prefix the contract supplied, so a
// declaration of `env_prefixes: ["A"]` forwarded ANTHROPIC_*, AWS_* and AZURE_* to a third-party
// reviewer's process on the panel-arm and adjudication paths. Contract authors are semi-trusted —
// the contract says what to review, never what may leave the machine — which is why this is MEDIUM
// rather than lower.
//
// THE RULE IS NOT AN ARBITRARY LENGTH. Every prefix this engine ships ends at a separator:
// CODEX_, OPENAI_, AGY_, ANTHROPIC_, CLAUDE_. A credential namespace ENDS somewhere, and a prefix
// that does not reach its boundary is a wildcard wearing a namespace's clothes. Requiring the
// underscore refuses "A" and "ANTHROPIC" while accepting every real declaration unchanged.
//
// Dropped rather than thrown, matching the rule immediately above it: this is the pure layer and
// has no way to fail a run, so a bad declaration yields NOTHING — a visible DEGRADED rather than a
// silent leak — and new-run's adapter validation is where it should be named at mint.
test('a credential prefix must reach a namespace boundary, not just be non-empty', async () => {
  const { reviewerEnv } = await import('../scripts/lib/decisions.mjs');
  const secrets = {
    ANTHROPIC_API_KEY: 'a', AWS_SECRET_ACCESS_KEY: 'b', AZURE_CLIENT_SECRET: 'c',
    CODEX_TOKEN: 'd', OPENAI_API_KEY: 'e',
  };
  const passed = (prefixes) => reviewerEnv('v', secrets, { depth: 0, prefixes }).passed;

  // THE LEAK. One letter matched three credential namespaces.
  assert.deepEqual(passed(['A']), [], 'a prefix that names no namespace forwards nothing');
  assert.deepEqual(passed(['ANTHROPIC']), [], 'stopping short of the separator is still a wildcard');

  // EVERY SHIPPED DECLARATION STILL WORKS, which is what stops this being breakage.
  assert.deepEqual(passed(['CODEX_', 'OPENAI_']).sort(), ['CODEX_TOKEN', 'OPENAI_API_KEY']);
  assert.deepEqual(passed(['ANTHROPIC_']), ['ANTHROPIC_API_KEY']);
  assert.deepEqual(passed(['AGY_']), []);
});
