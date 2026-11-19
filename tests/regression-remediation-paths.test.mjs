// PATH IDENTITY IN THE REMEDIATION PATH (remediation-paths.plan.md; design decided 2026-10-08: 1 "The runner", 2 "Ask
// git once", 3 "One owner"). The remediate rebuild's delivery review drew new MEDIUMs from its own fixes three rounds
// running, all on one question answered in three places: which file does a path name, and what kind of file is it.
//
// Stage 1: one owner of a path's kind — lib/finding-scope.mjs classifyPath — with the precedence generated > test >
// source > doc > undeclared, the "generated is never source or test" rule written where the contract's keys get their
// meaning, and new-run's review scope kept EXACTLY (G-16, G-2 of 20261008-225754-remediate-rebuild-r4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import * as scope from '../scripts/lib/finding-scope.mjs';
import { worktreeSha } from '../scripts/io/worktree.mjs';

const C = {
  source_globs: ['src/**', 'tests/**'],     // overlaps test_globs on purpose
  test_globs: ['tests/**', '**/*.test.js'],
  doc_paths: ['docs/**'],
  generated_globs: ['src/gen/**', 'tests/fixtures/out/**'],
};

test('stage 1: classifyPath — generated > test > source > doc > undeclared', () => {
  const k = (p) => scope.classifyPath(p, C, { caseInsensitive: false });
  assert.equal(k('src/a.js'), 'source');
  assert.equal(k('src/a.test.js'), 'test', 'test_globs win over source_globs');
  assert.equal(k('tests/b.js'), 'test', 'matching both, the test wins');
  assert.equal(k('src/gen/x.js'), 'generated', 'a generated file is never source');
  assert.equal(k('tests/fixtures/out/y.js'), 'generated', 'nor test');
  assert.equal(k('docs/readme.md'), 'doc');
  assert.equal(k('other/z.txt'), 'undeclared');
});

test('stage 1: the parts are exported, so new-run keeps its scope exactly', () => {
  assert.equal(scope.matchesSourceGlobs('tests/b.js', C), true);
  assert.equal(scope.isGeneratedPath('src/gen/x.js', C), true);
  assert.equal(scope.isTestPath('tests/b.js', C), true);
  // new-run's scope meaning: source_globs minus generated_globs — a file matching both source and test stays in scope.
  const inScope = (p) => scope.matchesSourceGlobs(p, C) && !scope.isGeneratedPath(p, C);
  assert.equal(inScope('tests/b.js'), true);
  assert.equal(inScope('src/gen/x.js'), false);
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  assert.match(src, /const isSource = \(p\) => matchesSourceGlobs\(p, contract\) && !isGeneratedPath\(p, contract\)/,
    'new-run asks the one owner, with its current meaning');
});

test('stage 1: the generated rule is written where the contract keys get their meaning', () => {
  const owner = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(owner, /a file matching `generated_globs` is never source or test/i);
  for (const f of ['CLAUDE.md', 'CLAUDE.template.md']) {
    const line = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8').split('\n').find((l) => /^test_globs:/.test(l)) ?? '';
    // the RULE, not the word (G-19 of 20261009-002459-remediation-paths-review): "generated" alone passed a contradiction
    assert.match(line, /a generated_globs file is neither/, `${f}'s test_globs comment states the generated rule`);
  }
});

// ------------------------------------------------------------------ stage 2: git's answer, parsed once
// Decision 2 ("Ask git once"): a path is committable only if git status lists it verbatim, and porcelain v2 says which
// entries are not files — an untracked nested repository (`? nested/`) and a submodule (sub field `S…`, mode 160000).
// Measured on git 2.56.0.windows.2 by the design's claim check; CI's Linux job runs the same fixture.
import { spawnSync as sp } from 'node:child_process';
import os from 'node:os';
import { statusEntriesV2 } from '../scripts/lib/remediation-chain.mjs';

test('stage 2: statusEntriesV2 reads ordinary, renamed, unmerged and untracked entries, and refuses repositories', () => {
  const N = 'N...';
  const z = [
    `1 .M ${N} 100644 100644 100644 aaa aaa src/a b.js`,
    `1 D. ${N} 100644 000000 000000 bbb 000 src/gone.js`,
    `2 R. ${N} 100644 100644 100644 ccc ccc R100 src/new.js`, 'src/old.js',
    `u UU ${N} 100644 100644 100644 100644 ddd eee fff src/conflict.js`,
    '? src/untracked file.js',
    '? nested/',
    '1 .M SC.. 160000 160000 160000 ggg ggg sm',
    '',
  ].join('\0');
  const { files, refused } = statusEntriesV2(z);
  assert.deepEqual(files.sort(), ['src/a b.js', 'src/conflict.js', 'src/gone.js', 'src/new.js', 'src/old.js', 'src/untracked file.js'].sort());
  assert.deepEqual(refused.map((r) => r.path).sort(), ['nested/', 'sm']);
  assert.ok(refused.every((r) => /repository|submodule/.test(r.reason)));
});

test('stage 2: against a real repository, a nested repository and a submodule are refused, files are listed', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-statusv2-'));
  try {
    const g = (cwd, ...a) => sp('git', ['-c', 'protocol.file.allow=always', '-c', 'user.email=x@x', '-c', 'user.name=x', ...a], { cwd, encoding: 'utf8' });
    const sub = path.join(base, 'sub');
    fs.mkdirSync(sub);
    g(sub, 'init', '-q'); fs.writeFileSync(path.join(sub, 'f'), '1'); g(sub, 'add', '-A'); g(sub, 'commit', '-qm', 's');
    const repo = path.join(base, 'repo');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    g(repo, 'init', '-q'); fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a'); g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'i');
    g(repo, 'submodule', 'add', '-q', sub, 'sm'); g(repo, 'commit', '-qm', 'sm');
    fs.writeFileSync(path.join(repo, 'sm', 'f'), '2');                       // the submodule's checkout moves
    const nested = path.join(repo, 'nested');
    fs.mkdirSync(nested); g(nested, 'init', '-q'); fs.writeFileSync(path.join(nested, 'n'), 'n');
    fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'changed');
    const out = g(repo, 'status', '--porcelain=v2', '-z', '--untracked-files=all').stdout;
    const { files, refused } = statusEntriesV2(out);
    assert.ok(files.includes('src/a.js'), files.join(','));
    assert.ok(!files.some((f) => f === 'sm' || f.startsWith('nested')), `no repository listed as a file: ${files}`);
    assert.deepEqual(refused.map((r) => r.path).sort(), ['nested/', 'sm']);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ stages 3+4: the runner commits each cluster
// Decision 1 ("The runner"): the node reports, per group, a `cluster` id and the `files` it changed; after it exits the
// runner decides which files of which clusters it may commit (planClusterCommits, pure) and commits them.
import { planClusterCommits } from '../scripts/lib/remediation-chain.mjs';

const CONTRACT = { source_globs: ['src/**'], test_globs: ['tests/**'], generated_globs: ['src/gen/**'], doc_paths: ['docs/**'] };
const plan = (groups, { files = [], refused = [], dirty = [], severity = {} } = {}) => planClusterCommits({ caseInsensitive: false, 
  groups, status: { files, refused }, dirtyAtStart: dirty, contract: CONTRACT, severityOf: (id) => severity[id] ?? 'LOW',
});
const fixed = (group_id, cluster, files, extra = {}) => ({ group_id, disposition: 'fixed', cluster, files, red_evidence: 'r', ...extra });

test('stages 3+4: a path git does not report verbatim is refused — a directory, a deleted directory, an alias, ./', () => {
  const status = { files: ['src/a.js', 'src/d/x.js', 'tests/a.test.js'] };
  for (const p of ['src/d', 'src//a.js', './src/a.js', 'src/gone']) {
    const [c] = plan([fixed('G-1', 'c1', [p, 'tests/a.test.js'])], status);
    assert.equal(c.committable, false, `${p} must not be committable`);
    assert.ok(c.refused.some((r) => r.path === p && /not in git status/.test(r.reason)), JSON.stringify(c.refused));
  }
});

test('stages 3+4: a nested repository or submodule is refused as a repository; a deleted file git reports is accepted', () => {
  const [c] = plan([fixed('G-1', 'c1', ['nested/x.js', 'sm', 'src/gone.js', 'tests/a.test.js'])],
    { files: ['src/gone.js', 'tests/a.test.js'], refused: [{ path: 'nested/', reason: 'a nested repository' }, { path: 'sm', reason: 'a submodule' }] });
  assert.deepEqual(c.refused.map((r) => r.path).sort(), ['nested/x.js', 'sm']);
  assert.ok(c.refused.every((r) => /repository|submodule/.test(r.reason)));
  assert.ok(c.accepted.includes('src/gone.js'));
});

test('stages 3+4: the operator\'s files, and files that are not source or test, are refused', () => {
  const status = { files: ['src/a.js', 'src/gen/g.js', 'docs/d.md', 'other.txt', 'tests/a.test.js'] };
  const [c] = plan([fixed('G-1', 'c1', ['src/a.js', 'src/gen/g.js', 'docs/d.md', 'other.txt', 'tests/a.test.js'])],
    { ...status, dirty: ['src/a.js'] });
  const why = Object.fromEntries(c.refused.map((r) => [r.path, r.reason]));
  assert.match(why['src/a.js'], /changed before the remediation began/);
  assert.match(why['src/gen/g.js'], /generated/);
  assert.match(why['docs/d.md'], /doc/);
  assert.match(why['other.txt'], /undeclared/);
  assert.equal(c.committable, false, 'a cluster with a refused file is not committed at all');
});

test('stages 3+4: clusters that share a file are merged, and named; clusters run most severe first', () => {
  const status = { files: ['src/a.js', 'src/b.js', 'tests/a.test.js', 'tests/b.test.js'] };
  const out = plan([
    fixed('G-1', 'c1', ['src/a.js', 'tests/a.test.js']),
    fixed('G-2', 'c2', ['src/a.js', 'tests/b.test.js']),
    fixed('G-3', 'c3', ['src/b.js', 'tests/b.test.js']),
    fixed('G-4', 'c4', ['src/b.js']),
  ], { ...status, severity: { 'G-4': 'HIGH' } });
  assert.equal(out.length, 1, 'G-1..G-4 chain through shared files into one cluster');
  assert.deepEqual(out[0].groups.sort(), ['G-1', 'G-2', 'G-3', 'G-4']);
  assert.ok(out[0].merged_from.length > 1);
  const two = plan([fixed('G-1', 'c1', ['src/a.js', 'tests/a.test.js']), fixed('G-9', 'c9', ['src/b.js', 'tests/b.test.js'])],
    { ...status, severity: { 'G-9': 'HIGH' } });
  assert.deepEqual(two.map((c) => c.groups[0]), ['G-9', 'G-1'], 'the HIGH cluster first');
});

test('stages 3+4: a cluster needs its fix and its test, unless it declared the claim has no possible red', () => {
  const status = { files: ['src/a.js', 'tests/a.test.js'] };
  const [onlyTest] = plan([fixed('G-1', 'c1', ['tests/a.test.js'])], status);
  assert.equal(onlyTest.committable, false);
  assert.ok(onlyTest.notes.some((n) => /no source_globs path/.test(n)));
  const [noTest] = plan([fixed('G-1', 'c1', ['src/a.js'])], status);
  assert.equal(noTest.committable, false);
  assert.ok(noTest.notes.some((n) => /no test_globs path/.test(n)));
  // G-1 of 20261023-062611-rer-remediation-review-2: an empty red alone is a skipped red; only a `no_red` declaration commits.
  const [undeclared] = plan([fixed('G-1', 'c1', ['src/a.js'], { red_evidence: '' })], status);
  assert.equal(undeclared.committable, false, 'an undeclared empty red committed a fix alone');
  const [notExpressible] = plan([fixed('G-1', 'c1', ['src/a.js'], { red_evidence: '', no_red: 'a comment' })], status);
  assert.equal(notExpressible.committable, true, 'a claim declared to have no possible red commits its fix alone, and says so');
  assert.ok(notExpressible.notes.some((n) => /committed without a test: every group in it declared no possible red/.test(n)));
});

test('stages 3+4: the remediation schema carries cluster and files, not a commit the node made', () => {
  const sp = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  const at = sp.indexOf("if (variant === 'remediation')");
  const block = sp.slice(at, at + 3000);
  assert.match(block, /'cluster'/);
  assert.match(block, /'files'/);
  assert.doesNotMatch(block, /'commit'/);
  const contract = fs.readFileSync(path.join(REPO_ROOT, 'prompts', 'remediation', 'PROMPT.md'), 'utf8');
  assert.doesNotMatch(contract, /remediate-commit/);
  assert.match(contract, /You do not commit/);
});

// A SCOPE ENTRY IS A PATH (found by the stage 3+4 runner fixture, 2026-10-08): worktreeSha handed every scope entry to
// the glob grammar's walkRoot, so a review whose diff touched `src/[ab].js` died at mint with "contract glob refused" —
// and with it the follow-up review a remediation mints. Only an entry carrying `*` is a (tolerated) glob.
test('worktreeSha hashes a scope path with glob characters as the path it is', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q-wtsha-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', '[ab].js'), 'x\n');
  const a = worktreeSha({ repoRoot: root, paths: ['src/[ab].js'] });
  assert.ok(a, 'hashed rather than refused');
  fs.writeFileSync(path.join(root, 'src', '[ab].js'), 'y\n');
  assert.notEqual(worktreeSha({ repoRoot: root, paths: ['src/[ab].js'] }), a, 'the file\'s content moves the hash');
});

// STAGE 5: remediate-commit.mjs is removed with every reference — the runner commits, so nothing may still describe the
// node committing through it. The ledger and dated records (requests, reviews, the build log) keep their history.
test('stage 5: no tracked file names remediate-commit except the ledger and dated records', () => {
  const ls = sp('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
  assert.equal(ls.status, 0, ls.stderr);
  const dated = (f) => /^\.claude\/(requests|reviews)\//.test(f) || /^blog\//.test(f) || f === 'tests/regression-remediation-paths.test.mjs';
  const naming = ls.stdout.split('\0').filter(Boolean).filter((f) => !dated(f))
    .filter((f) => { try { return fs.readFileSync(path.join(REPO_ROOT, f), 'utf8').includes('remediate-commit'); } catch { return false; } });
  assert.deepEqual(naming, [], `still named in: ${naming.join(', ')}`);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'scripts', 'remediate-commit.mjs')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8'), /QUORATE_RUN_DIR/, 'no node is handed its run directory to commit from');
});

// G-3 of 20261009-002459-remediation-paths-review: COMMIT-CHECK's consequence named "a commit git refused" and never a
// failed reset — the one outcome that leaves files STAGED — nor a rejected hook. Both texts name every outcome.
test('r1: COMMIT-CHECK names a rejected hook, a failed reset that leaves files staged, and an unconfirmed group', () => {
  const consequence = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'stamp-consequences.json'), 'utf8'))['COMMIT-CHECK'];
  const row = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8').split('\n').find((l) => l.startsWith('| `COMMIT-CHECK`'));
  for (const text of [consequence, row]) {
    assert.match(text, /hook/, text);
    assert.match(text, /reset failed|failed reset/, text);
    assert.match(text, /staged/, text);
    assert.match(text, /not confirmed/, text);
  }
});

// G-16 of 20261009-002459-remediation-paths-review: the contract doc's row for the remediation node still listed a
// per-group `commit` field, which the schema now rejects; a node built from it would emit an invalid payload.
test('r1: the contract doc documents the node envelope with cluster and files, and no commit field', () => {
  const row = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8').split('\n').find((l) => l.startsWith('| `remediation/PROMPT.md`'));
  assert.ok(row, 'the row exists');
  assert.match(row, /cluster, files/);
  assert.doesNotMatch(row, /, commit,/);
});

// G-6, G-14 of 20261009-002459-remediation-paths-review (operator, 2026-10-09: "1 conform fully"): a refusal carries
// `reason`, and a planned cluster names its `groups` and `accepted` files and whether it is `committable`.
test('r1 shapes: refusals carry reason; a planned cluster has groups, accepted, committable', () => {
  const v2 = ['? nested/', '1 .M S... 160000 160000 160000 aaaa bbbb sm', '1 .M N... 100644 100644 100644 aaaa bbbb src/a.js', ''].join('\0');
  const st = statusEntriesV2(v2);
  assert.ok(st.refused.length === 2 && st.refused.every((r) => typeof r.reason === 'string' && !('why' in r)), JSON.stringify(st.refused));
  const [c] = plan([fixed('G-1', 'c1', ['src/a.js', 'tests/a.test.js', 'other.txt'])], { files: ['src/a.js', 'tests/a.test.js', 'other.txt'] });
  assert.deepEqual(c.groups, ['G-1']);
  assert.deepEqual(c.accepted, ['src/a.js', 'tests/a.test.js']);
  assert.equal(c.committable, false);
  assert.ok(c.refused.every((r) => typeof r.reason === 'string' && !('why' in r)));
  for (const k of ['group_ids', 'files', 'commit']) assert.ok(!(k in c), `no ${k}`);
});

// The owner documents the shapes it was made to conform to (operator, 2026-10-09: "1 conform fully").
test('r1 shapes: the contract doc documents dirty_at_start, clusters and every commit_check kind the runner emits', () => {
  const row = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8').split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`'));
  assert.match(row, /dirty_at_start: \{files, refused\}/);
  // `pending_retry?` and `unrecorded?` added by remediation-commit-recovery (G-10 of 20261011-005705-commit-recovery-r2;
  // its round-cap design step).
  // `attempting?` and `seq` added by G-9 of 20261011-031727-commit-recovery-design-review.
  // `readmitted?` added by the shape --readmit-evidence writes on a planned cluster (scripts/remediate.mjs).
  assert.match(row, /clusters: \[\{id, merged_from, groups, accepted, refused, notes, commit, reason\?, output\?, pending_retry\?, fmt_turned_red\?, unrecorded\?, attempting\?, readmitted\?, seq\}\]/);
  // The vocabulary's one owner is COMMIT_CHECK_KINDS (G-12 of 20261009-011732-remediation-paths-r1); the runner refuses
  // any kind outside it, so every kind it can emit is a key there.
  for (const k of Object.keys(COMMIT_CHECK_KINDS)) assert.ok(row.includes(`\`${k}\``), `${k} is documented`);
  // Which kinds stamp is the stamp table's (G-11 of 20261009-014530-remediation-paths-r2): the row points there.
  assert.match(row, /disk-first-protocol\.md` §7/);
  const stampRow = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8').split('\n').find((l) => l.startsWith('| `COMMIT-CHECK`'));
  assert.match(stampRow, /`merged` entry is recorded and does not stamp/);
});

// G-8 of 20261017-195046-lit-review: `left-in-tree` stamps in COMMIT_CHECK_KINDS, and the stamp table the contract doc hands
// that question to did not name it, so its owner could not tell that a leftover path stamps COMMIT-CHECK.
test('G-8 (lit): the COMMIT-CHECK stamp row names left-in-tree, and every kind that does not stamp', () => {
  const stampRow = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8').split('\n').find((l) => l.startsWith('| `COMMIT-CHECK`'));
  assert.equal(COMMIT_CHECK_KINDS['left-in-tree'].stamps, true);
  assert.ok(stampRow.includes('`left-in-tree`'), 'the stamp row does not name left-in-tree');
  for (const [k, v] of Object.entries(COMMIT_CHECK_KINDS)) if (!v.stamps) assert.ok(stampRow.includes(`\`${k}\``), `${k} does not stamp and is not named`);
});

// G-3 of 20261009-011732-remediation-paths-r1: a COPY's original is unchanged, so it is not a changed file (it let an
// untouched source pass as a cluster's fix); and a renamed SUBMODULE's original is refused with it, not dropped.
test('r2: a copy\'s original is not a changed file; a renamed submodule\'s original is refused, not dropped', () => {
  const N = 'N...';
  const st = statusEntriesV2([
    `2 C. ${N} 100644 100644 100644 ccc ccc C75 src/copy.js`, 'src/orig.js',
    `2 R. ${N} 100644 100644 100644 ccc ccc R100 src/new.js`, 'src/old.js',
    `2 R. SC.. 160000 160000 160000 ggg ggg R100 sm2`, 'sm1',
    '',
  ].join('\0'));
  assert.ok(st.files.includes('src/copy.js'));
  assert.ok(!st.files.includes('src/orig.js'), 'a copy leaves its original unchanged');
  assert.ok(st.files.includes('src/new.js') && st.files.includes('src/old.js'), 'a rename changes both');
  assert.deepEqual(st.refused.map((r) => r.path).sort(), ['sm1', 'sm2']);
});

// G-10 of 20261009-011732-remediation-paths-r1: spawn-node exits 0 when its node ends BLOCKED or DEGRADED, so the gate
// reads the node's recorded state too. Written after the gate; checked by mutation (evidence/rp-r2-gate-mutation-red.txt).
import { commitGate, COMMIT_CHECK_KINDS, commitCheckStamps } from '../scripts/lib/remediation-chain.mjs';
test('r2: commitGate refuses a node that exited 0 but did not finish OK, a mismatched or missing report, an unknown confirmed set', () => {
  const ok = { exitStatus: 0, nodeState: 'OK', confirmedKnown: true, payloadRunId: 'r', runId: 'r' };
  assert.equal(commitGate(ok), null);
  for (const nodeState of ['BLOCKED', 'DEGRADED', null]) assert.equal(commitGate({ ...ok, nodeState }).kind, 'node-failed', String(nodeState));
  assert.equal(commitGate({ ...ok, exitStatus: 1 }).kind, 'node-failed');
  assert.equal(commitGate({ ...ok, payloadRunId: 'other' }).kind, 'report-mismatch');
  assert.equal(commitGate({ ...ok, payloadRunId: null }).kind, 'report-mismatch');
  assert.equal(commitGate({ ...ok, confirmedKnown: false }).kind, 'confirmed-unknown');
  for (const k of ['node-failed', 'report-mismatch', 'confirmed-unknown']) assert.ok(COMMIT_CHECK_KINDS[k]);
  assert.equal(commitCheckStamps([{ kind: 'merged' }]), false);
  assert.equal(commitCheckStamps([{ kind: 'merged' }, { kind: 'refused-file' }]), true);
});
