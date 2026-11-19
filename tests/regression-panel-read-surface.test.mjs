// G-43 (found by security-audit, 2026-09-10, HIGH, basis: invariant): every panel arm spawned with
// `cwd: repoRoot`, and `.claude/reviews/` sits inside that root — so the run's own evidence tree was
// inside the tree a third-party CLI was told to read.
//
// WHAT THAT EXPOSES IS NOT SOURCE. `run-checks.mjs` says plainly that a captured command's output
// may hold "a connection string, an environment dump, a token inside an error", and §3 accepts
// `capture.mjs` inheriting the operator's environment ON THE STATED GROUND that the output "stays on
// local disk and is never committed". It lists the conditions that would flip that decision —
// committed, CI artifact, shared between machines, bug report — and did not name the panel, which
// sends it to a vendor cloud. The arm constraints tell the reviewer that "Reading the repository IS
// your job … by WHATEVER means"; codex runs `--sandbox read-only` over its cwd; the shadow prompt
// embeds the lens brief, which prints the absolute run-directory path. `generated_globs` bounds what
// an arm may REPORT, not what it may read.
//
// THE FIX IS BY CONSTRUCTION, NOT BY INSTRUCTION, and that distinction is the whole point: the
// obvious fix is a sentence in the constraints file, and a sandbox that exists only as a request in
// a prompt is not one. `evidence/` is gitignored, so a `git worktree` of the reviewed commit does
// not contain it — which is what the first test here measures against a real repository rather than
// asserting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript } from './helpers.mjs';
import { buildArmsSurface } from '../scripts/io/snapshot.mjs';
import { panelReadSurface } from '../scripts/lib/capabilities.mjs';

// SCRATCH INSIDE THE REPOSITORY, BUT IGNORED (20261001-205530-m0-pending-claims-review). These tests need a directory inside
// the repository and made it at the root as `.tmp-*`, untracked and NOT ignored — so the arms-snapshot builder's
// `git add -A`, run by another test at the same time, saw files appear and vanish and failed with "unable to index
// file" (exit 128), twice. `.sandbox/` is the gitignored scratch area CLAUDE.md names.
const SCRATCH = (() => { const d = path.join(REPO_ROOT, '.sandbox'); fs.mkdirSync(d, { recursive: true }); return d; })();


// THE CODE, NOT ITS LINE ENDINGS. With core.autocrlf=true git writes every file it checks out or
// patches as CRLF, while a file written by an editor or a tool keeps whatever it was written with —
// this checkout had 278 LF-only tracked files when that was measured. The mirror is git-applied, so
// it is CRLF regardless, and a byte comparison failed on the day the sample file was rewritten LF,
// with the code identical line for line. What these tests protect is that the arm reads the same
// code the lens does; line endings change neither the code nor a single line number.
const sameCode = (text) => text.replace(/\r\n/g, '\n');

test('the arms\' directory holds the working tree, not the run: no evidence, no run artifacts', (t) => {
  // THE SECURITY PROPERTY, measured against a repository SHAPED LIKE THIS ONE (test-suite-cost.md): this test built the
  // arms' surface over the real repository, every file of it, minutes per suite run. The shape is what matters: run
  // directories under .claude/reviews tracked, their evidence/ ignored, a live run untracked, code and prompts beside
  // them. Three things the arms' directory must hold: the lens's code (the working tree, dirty or not; G-15), no
  // evidence tree (G-43), and none of a live run's untracked artifacts (G-21).
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-surface-repo-')));
  const dir = path.join(os.tmpdir(), `quorate-surface-${process.pid}`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); });
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  const write = (rel, body) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
  write('.gitignore', '.claude/reviews/*/evidence/\n');
  write('scripts/io/worktree.mjs', 'export const worktree = 1;\n');
  write('prompts/_templates/brief.md', '# brief\n');
  write('.claude/reviews/20260101-000000-done/run.json', '{"run_id":"20260101-000000-done"}');
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'base');
  // An archived run's evidence (ignored, as here), and a LIVE run, untracked: both planted, so the zero below means
  // something.
  write('.claude/reviews/20260101-000000-done/evidence/code-audit/probe.log', 'captured output a vendor must not read');
  const reviews = path.join(root, '.claude', 'reviews');
  const planted = path.join(reviews, `surface-probe-${process.pid}`);
  write(path.relative(root, path.join(planted, 'run.json')), '{"run_id":"surface-probe"}');
  write(path.relative(root, path.join(planted, 'intent.md')), '# criteria a third party must not read');
  write(path.relative(root, path.join(planted, 'evidence', 'code-audit', 'probe.log')), 'captured output a vendor must not read');
  write('scripts/io/worktree.mjs', 'export const worktree = 2; // dirty: the arms read the working tree\n');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const built = buildArmsSurface({ repoRoot: root, headCommit: head, baseCommit: head, dir, exclude: [reviews], maxBytes: null });
  assert.equal(built.ok, true, built.why);

  const evidenceDirs = (base) => {
    let n = 0;
    const walk = (p) => {
      let entries = [];
      try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name === 'evidence') { n++; continue; }
        if (e.name === '.git' || e.name === 'node_modules') continue;
        walk(path.join(p, e.name));
      }
    };
    walk(path.join(base, '.claude', 'reviews'));
    return n;
  };
  assert.ok(evidenceDirs(root) > 0, 'the fixture must have some, or this proves nothing');
  assert.equal(evidenceDirs(dir), 0, 'no evidence directory crosses — that is the boundary');
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'reviews', path.basename(planted))), false,
    'a live run\'s untracked artifacts do not cross — that is the run reviewing itself');
  const code = path.join('scripts', 'io', 'worktree.mjs');
  assert.equal(sameCode(fs.readFileSync(path.join(dir, code), 'utf8')), sameCode(fs.readFileSync(path.join(root, code), 'utf8')),
    'the arms read exactly what the lens reads');
  assert.ok(fs.existsSync(path.join(dir, 'prompts', '_templates')), 'and the prompt library');
});

test('a built directory with its framework is where the arms stand', () => {
  const s = panelReadSurface({ built: { ok: true, dir: '/arms' }, frameworkReady: true });
  assert.equal(s.cwd, '/arms');
  assert.equal(s.isolated, true);
  assert.equal(s.stamp, null, 'nothing to record when the arms stand in their own directory');
});

test('there is no fallback to the repository: every other case is no surface, stamped', () => {
  // THE ROOT FALLBACK IS GONE (arms-read-surface criterion 6; operator: "B drop"). It handed the arms
  // the operator's real tree, stamped PANEL-SEES-EVIDENCE; every link check that kept missing a class
  // of path was a check of that tree. Nothing here can even name the repository root.
  for (const [built, frameworkReady] of [[null, true], [{ ok: false, why: 'size cap' }, true], [{ ok: true, dir: '/arms' }, false]]) {
    const s = panelReadSurface({ built, frameworkReady });
    assert.equal(s.cwd, null, JSON.stringify({ built, frameworkReady }));
    assert.equal(s.isolated, false);
    assert.equal(s.stamp, 'PANEL-NO-SAFE-SURFACE');
  }
  assert.doesNotMatch(panelReadSurface.toString(), /repoRoot/, 'the surface decision takes no repository root at all');
});

test('a build that failed is stamped with its reason, never silently accepted', () => {
  const s = panelReadSurface({ built: { ok: false, why: 'the changed files exceed the cap' }, frameworkReady: true });
  assert.equal(s.stamp, 'PANEL-NO-SAFE-SURFACE');
  assert.match(s.why, /exceed the cap/, 'the gate says why there was no panel');
  assert.match(panelReadSurface({ built: null }).why, /never built/);
});

test('run-graph points the arms at the resolved surface and tears the directory down', () => {
  const code = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(code.includes("'--surface', armSurface.cwd"),
    'the arm reads the resolved surface (external-review stays in the repository for its containment)');
  assert.ok(!/return \{ cwd: repoRoot, env, detached/.test(code),
    'the old unconditional repoRoot spawn must be gone');
  const teardown = code.slice(code.indexOf('function tearDownPanelWorktree'), code.indexOf('function tearDownPanelWorktree') + 600);
  assert.match(teardown, /fs\.rmSync\(dir, \{ recursive: true/, 'the arms\' directory is removed, on every path out');
  assert.ok(code.includes('armSurface.stamp'), 'a missing surface must reach the run record');
});

test('the doctrine names the panel among the conditions that flip the decision', () => {
  // Half of this finding was a DOCUMENT defect: §3 justified inheriting the operator's environment
  // on the ground that evidence stays local, and listed four conditions that would flip that — none
  // of them the panel, which this contract enables.
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8');
  const at = doc.indexOf('The condition that flips this decision');
  assert.notEqual(at, -1, 'the flip conditions must still be stated');
  // TO THE NEXT HEADING, not a fixed 2200 bytes. The byte window made this assertion a distance
  // measurement: adding a paragraph anywhere inside the section pushed PANEL-SEES-EVIDENCE out of
  // range and failed a test whose subject had not changed. What it means to assert is that the
  // stamp is named in the SAME section as the conditions, and a section ends at the next heading.
  const rest = doc.slice(at);
  const end = rest.search(/\n#{2,3} /);
  const section = end === -1 ? rest : rest.slice(0, end);
  assert.match(section, /external panel/i, 'the panel must be named as a condition');
  // Since arms-read-surface: the stamp that records a run whose panel had nowhere safe to stand, and
  // the measured limit — the reviewer's read-only sandbox does not bound reads.
  assert.match(section, /PANEL-NO-SAFE-SURFACE/, 'and the stamp that records the no-surface case');
  assert.match(section, /bounds writes, not reads/, 'and what the directory does NOT bound, as measured');
});

test('the arm constraints say not to read the run directory, and say it is not the boundary', () => {
  // Defence in depth, labelled as such. A prompt-level rule presented as the fix would be exactly
  // the failure this repository keeps finding: a comment claiming a boundary that does not exist.
  const text = fs.readFileSync(
    path.join(REPO_ROOT, 'prompts', '_templates', 'external-arm-constraints.md'), 'utf8',
  );
  // Whitespace-normalised: the phrase wraps across a line in the file, and a prose assertion that
  // depends on where a line happens to break tests the formatting rather than the rule.
  const flat = text.replace(/\s+/g, ' ');
  assert.match(flat, /Do not read the run directory/);
  assert.match(flat, /not the boundary/,
    'the constraints must not present a request as an enforcement');
});

// THE ARMS REVIEWED THE COMMIT BEFORE THE ONE UNDER REVIEW (G-30, arch-review).
//
// The disposable worktree was checked out at `base_commit`, and new-run defaults --base to HEAD~1 —
// so on any clean tree the panel read the tree as it was ONE COMMIT BEFORE what the lenses read
// from repoRoot, while this file's own doctrine calls it "a worktree of the reviewed commit". That
// is the exact failure capabilities.mjs refuses to accept for a DIRTY tree — "an isolated checkout
// would show the arm different code than the lens it shadows" — reintroduced by construction on the
// clean path that guard protects, and unstamped. Demonstrated in the run that found it, where an arm
// reported the change under review had an empty diff.
test('the arms read the reviewed commit, and diff against the base', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const block = src.slice(src.indexOf('if (panelArms.length || mayAdjudicate) {'), src.indexOf('const armSurface = panelReadSurface('));
  // G-30: the arms once read base_commit — the PARENT of the change — and reported an empty diff.
  assert.match(block, /headCommit: runJson\.head_commit \?\? 'HEAD'/,
    'head_commit is the reviewed revision the snapshot is taken on');
  // base_commit is now used deliberately, as the other end of the arms' own `git diff <base>`
  // (operator: "option 1") — and ONLY there.
  assert.match(block, /baseCommit: runJson\.base_commit/);
  assert.equal((block.match(/runJson\.base_commit/g) ?? []).length, 1, 'the base is the diff base and nothing else');
});

// THE ORCHESTRATOR TRUSTED A DIRECTORY BOTH ITS LEAF SCRIPTS REFUSE (G-26, panel-codex-security).
//
// --run-dir decides where every artifact lands AND supplies the `contract` every subsequent spawn is
// configured from. capture.mjs and external-review.mjs each refuse a directory outside the tree, one
// that cannot name itself, or one whose realpath leaves — while run-graph, which hands the same path
// to both, only called path.resolve on it.
test('run-graph refuses a run directory it should not spawn from', () => {
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-foreign-'));
  try {
    fs.writeFileSync(path.join(foreign, 'run.json'), JSON.stringify({ run_id: path.basename(foreign) }));
    // mayFanOut: every call in this test asserts a REFUSAL that happens before any node set is
    // derived. helpers.mjs's spend guard has to be told that, or it refuses the invocation instead.
    const out = runScript('run-graph.mjs', ['--run-dir', foreign], { mayFanOut: true });
    assert.notEqual(out.status, 0);
    // Two containers since graph_contract 2; a temp directory is inside neither.
    assert.match(out.output, /neither inside the repository under review .* nor inside the engine's home/);
  } finally { fs.rmSync(foreign, { recursive: true, force: true }); }

  // ...and one inside the tree that cannot name itself, or names itself something else.
  const inside = fs.mkdtempSync(path.join(SCRATCH, '.tmp-rundir-'));
  try {
    fs.writeFileSync(path.join(inside, 'run.json'), '{}');
    // The owner's refusal since run-dir-trust (ARCHITECTURE A-28).
    assert.match(runScript('run-graph.mjs', ['--run-dir', inside], { mayFanOut: true }).output, /is not the run its run\.json names \(run_id null\)/);
    fs.writeFileSync(path.join(inside, 'run.json'), JSON.stringify({ run_id: 'something-else' }));
    assert.match(runScript('run-graph.mjs', ['--run-dir', inside], { mayFanOut: true }).output,
      /is not the run its run\.json names \(run_id "something-else"\)/);
  } finally { fs.rmSync(inside, { recursive: true, force: true }); }
});

// THE DATA-GOVERNANCE PARAGRAPH DESCRIBED A SURFACE THE DEFAULT PATH NO LONGER HAS (G-40, G-41).
//
// external-reviewers.md told the operator the arm is "launched with the repository root as its
// working directory" — false for every clean-tree run since the arms moved into a disposable
// worktree — and the codex-trust section justified itself with `cwd: repoRoot`. That second one
// mattered in the worst way: it points a maintainer debugging a dead arm AWAY from the arm's working
// directory, which is exactly where the regression that killed every arm in one run actually was.
//
// This is the paragraph an operator weighs when deciding whether to set `external_panel: true`, so
// it has to describe BOTH surfaces and name the stamp that tells them which one a given run had.
test('the panel guide describes both arm surfaces and names the stamp', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'external-reviewers.md'), 'utf8');

  assert.ok(!/launched with the repository root as its working directory/.test(doc),
    'the clean-tree default is a worktree, not the repository root');
  assert.ok(!/spawns the adapter with\n`cwd: repoRoot`/.test(doc),
    'the codex-trust claim rested on a mechanism the code abandoned');
  // Since arms-read-surface: one surface or none. The guide must describe the snapshot, the stamp a
  // run without a surface carries, and what external-review actually passes the reviewer.
  assert.match(doc, /SNAPSHOT of the working\s+state/, 'the surface must be described');
  assert.match(doc, /PANEL-NO-SAFE-SURFACE/, 'and the stamp that says a run had none');
  assert.match(doc, /--surface/, 'the trust section must name what is actually passed');
  assert.match(doc, /bounds writes, not reads/, 'and what the read-only sandbox does not bound, as measured');

  // The tie-break is a separate vendor, mode and prompt, and a check of the arms alone said nothing about it (G-42).
  // check-reviewers (reviewer-preflight stage 4) checks both, and the guide must say so rather than name one probe.
  assert.match(doc, /check-reviewers\.mjs/, 'the guide names the command that checks the panel');
  assert.match(doc, /tie-break mode/, 'and says the judges are checked in their own mode, not only the arms');
});

// §7's STAMP TABLE OMITTED THE STAMP WITH THE STRONGEST EFFECT (G-38).
//
// It is the only place the doctrine enumerates stamps and what each does, and `TESTS-FAILING` —
// which forces `gate = FAIL` unconditionally — had no row, nor did `PANEL-SEES-EVIDENCE`, which §3
// describes in prose. A reader holding a gate.md that prints either had nowhere to look it up.
test('every stamp the engine can emit has a row in the gate-ceiling table', async () => {
  const { explainedStamps } = await import('../scripts/io/stamp-notes.mjs');
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8');
  const at = doc.indexOf('| `TESTS-THIN` |');
  assert.notEqual(at, -1, 'the stamp table must still exist');
  const rest = doc.slice(at);
  const table = rest.slice(0, rest.search(/\n\n/) === -1 ? rest.length : rest.search(/\n\n/));

  for (const stamp of explainedStamps()) {
    // The recovery stamps are composed (`<STAMP>-FAILED`) and explained by derivation, not by a row.
    if (stamp.endsWith('-FAILED')) continue;
    assert.ok(doc.includes(`\`${stamp}\``),
      `${stamp} is emitted and explained to nodes, but the doctrine never states it`);
  }
  assert.match(table, /TESTS-FAILING/, 'the stamp that forces a FAIL belongs in the table that lists effects');
});




// A PARTIALLY PREPARED CHECKOUT WAS USED AS THOUGH IT WERE WHOLE.
//
// `git worktree add` leaves every submodule an EMPTY DIRECTORY, and in the documented consumer mount
// the framework IS a submodule — so run-graph copies it in afterwards. When that copy failed, the
// code logged the failure and kept the checkout anyway. The arms then stood in a tree missing the
// doctrine file every lens prompt names and the find-inert-features detector they are ORDERED to run,
// and reported both absent: an accurate report about a checkout this engine built for them, recorded
// in the gate as the ARM being unavailable. A vendor problem, in the artifacts, for a defect at home.
//
// It was then sent to the repository root, stamped PANEL-SEES-EVIDENCE, on the reasoning that a declared
// exposure beats a silent wrong answer. Since arms-read-surface there is no root fallback ("B drop"): an
// incomplete framework is no surface at all, stamped PANEL-NO-SAFE-SURFACE with the reason.
//
// Raised by code-audit, panel-codex-code and panel-codex-contract — two families, three nodes.
test('a directory whose framework could not be populated is no surface', () => {
  // Raised by code-audit, panel-codex-code and panel-codex-contract: the arms once stood in a tree
  // missing the doctrine file and the detector their prompts require, and reported both absent —
  // recorded as the ARM being unavailable. An incomplete framework is no surface, stamped.
  const s = panelReadSurface({ built: { ok: true, dir: '/arms' }, frameworkReady: false });
  assert.equal(s.isolated, false, 'the arms must not read a tree missing the doctrine they are graded on');
  assert.equal(s.cwd, null);
  assert.equal(s.stamp, 'PANEL-NO-SAFE-SURFACE');
  assert.match(s.why, /framework/i, 'and the reason says which failure it was');
  assert.equal(panelReadSurface({ built: { ok: true, dir: '/arms' } }).cwd, null, 'readiness defaults to false');
});



test('run-graph tells the surface whether the framework is actually there', () => {
  // The default is FALSE, so a caller that forgets this argument falls back and stamps rather than
  // claiming an isolation it never verified. This asserts the one real caller does not forget.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(src, /frameworkReady/,
    'run-graph must pass frameworkReady, or every panel run falls back to the repository — the fix '
    + 'for this finding would then be a different defect wearing the same stamp');
});
