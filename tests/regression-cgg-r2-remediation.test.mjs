// Run 20261001-034021-cgg-remediation-review, round 2 under ROADMAP.md D1 (operator, 2026-10-01: "Fix D1's set, tests
// first (Recommended)"). Its four remediation MEDIUMs were a guard failing open on a caught error, a case-sensitive
// prune, and tests that matched source text where the intent (I-13) asks for behaviour. So these drive the behaviour:
// a real tree, a real run, a walk that fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as rr from '../scripts/io/reviews-root.mjs';
import { confined } from '../scripts/io/confined-path.mjs';
import * as ds from '../scripts/io/doc-snapshot.mjs';
import { worktreeSha } from '../scripts/io/worktree.mjs';
import * as decisions from '../scripts/lib/decisions.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { runScript, mintedRunId, mintedRunDir, REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
const tmp = (t, prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const put = (root, rel, body = `${rel}\n`) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const failingReaddir = (failOn) => (dir, opts) => {
  if (path.basename(dir) === failOn) { const e = new Error(`EACCES: ${dir}`); e.code = 'EACCES'; throw e; }
  return fs.readdirSync(dir, opts);
};

// ---------------------------------------------------------------------------------------------- G-7
test('G-7: an evidence directory that cannot be listed withholds the evidence (null), never answers "ignored"', (t) => {
  const root = tmp(t, 'q-r2-g7-');
  spawnSync('git', ['init', '-q', '.'], { cwd: root });
  // The root itself unreadable: a file where the directory should be (ENOTDIR), reproducible without privileges. The
  // reader takes the run's owner (G-10 of 20261029-235315-rdr-remediation-4-review), so the file stands at evidence/.
  const fileRun = path.join(root, 'staged-file');
  fs.mkdirSync(fileRun);
  fs.writeFileSync(path.join(fileRun, 'evidence'), 'not a directory\n');
  assert.equal(rr.evidenceIgnoredByGit(root, 'run-1', confined(fileRun)), null, 'an unlistable evidence root answered as ignored');
  // A subdirectory that cannot be listed: the files beneath it were never asked about.
  const ev = path.join(root, 'staged', 'evidence');
  put(ev, 'node/test.log');
  put(ev, 'locked/secret.log');
  assert.equal(rr.evidenceIgnoredByGit(root, 'run-1', confined(path.dirname(ev)), { readdir: failingReaddir('locked') }), null,
    'an unlistable evidence subdirectory answered as ignored');
  // Absent is not unreadable: no evidence directory has nothing to carry.
  const emptyRun = path.join(root, 'staged-empty');
  fs.mkdirSync(emptyRun);
  assert.equal(rr.evidenceIgnoredByGit(root, 'run-1', confined(emptyRun)), true);
});

// ------------------------------------------------------------------------------------- G-25 (G-1 part)
test('G-25: a doc directory that cannot be listed is recorded and the snapshot carries on', (t) => {
  const repo = tmp(t, 'q-r2-g1-');
  put(repo, 'docs/a.md');
  put(repo, 'docs/locked/b.md');
  const snapDir = path.join(tmp(t, 'q-r2-g1-snap-'), 'docs');
  const skips = [];
  const snap = ds.createSnapshot(snapDir);
  ds.snapshotDocGlobs({ repoRoot: repo, docPaths: ['docs/**'], snap, onSkip: (s) => skips.push(s), readdir: failingReaddir('locked') });
  assert.ok(skips.some((s) => /docs\/locked/.test(s.item) && /could not be read/.test(s.reason)), JSON.stringify(skips));
  assert.ok(fs.readdirSync(snapDir).some((n) => n.endsWith('a.md')), 'the readable document was not copied');
});

// ------------------------------------------------------------------------------- G-4, G-6, G-25 (wiring)
function intentTree(t) {
  const repo = tmp(t, 'q-r2-intent-');
  put(repo, 'docs/a.md');
  put(repo, '.claude/reviews/old-run/gate.md');
  put(repo, '.claude/notes.md');
  put(repo, 'dist/built.md');
  return repo;
}
function intentCopies(t, repo, docPaths, { generatedGlobs = [], caseInsensitive = false } = {}) {
  const snapDir = path.join(tmp(t, 'q-r2-intent-snap-'), 'docs');
  const skips = [];
  ds.snapshotIntentDocs({
    repoRoot: repo, docPaths, generatedGlobs, stagingRoot: path.join(os.tmpdir(), 'q-r2-staging-elsewhere'),
    snap: ds.createSnapshot(snapDir, { caseInsensitive }), caseInsensitive, onSkip: (s) => skips.push(s),
  });
  return { copies: fs.existsSync(snapDir) ? fs.readdirSync(snapDir) : [], skips };
}

test('G-25/G-4: the intent sandbox never holds an archived run, whatever the caller passes as generated globs', (t) => {
  assert.equal(typeof ds.snapshotIntentDocs, 'function', 'no single owner builds the intent sandbox');
  const repo = intentTree(t);
  const { copies } = intentCopies(t, repo, ['.claude/**']);
  assert.ok(copies.some((c) => c.endsWith('notes.md')), `the declared document was not copied: ${copies}`);
  assert.ok(!copies.some((c) => c.endsWith('gate.md')), `an archived run's artifact reached the sandbox: ${copies}`);
});

test('G-4: on a case-insensitive filesystem a differently-cased doc glob does not escape the prune', (t) => {
  const prune = ds.pruneUnder([path.join('C:', 'repo', '.claude', 'reviews')], { caseInsensitive: true });
  assert.equal(prune(path.join('C:', 'repo', '.CLAUDE', 'Reviews', 'old-run')), true);
  assert.equal(ds.pruneUnder([path.join('C:', 'repo', '.claude', 'reviews')])(path.join('C:', 'repo', '.CLAUDE', 'reviews', 'x')), false,
    'case-sensitive comparison is kept where the filesystem is case-sensitive');
  if (!hostPlatform().caseInsensitiveFs) { t.skip('the end-to-end half needs a filesystem that resolves .CLAUDE'); return; }
  const repo = intentTree(t);
  const { copies } = intentCopies(t, repo, ['.CLAUDE/**'], { generatedGlobs: ['dist/**'], caseInsensitive: true });
  assert.ok(!copies.some((c) => c.toLowerCase().endsWith('gate.md')), `.CLAUDE/** carried an archived run: ${copies}`);
});

test('G-6: a doc glob naming a single file is pruned like a walked one, and the skip is recorded', (t) => {
  const repo = intentTree(t);
  const archived = intentCopies(t, repo, ['.claude/reviews/old-run/gate.md']);
  assert.deepEqual(archived.copies, [], 'a literal path into the archive was copied');
  assert.ok(archived.skips.some((s) => /gate\.md/.test(s.item)), 'the refusal was silent');
  const generated = intentCopies(t, repo, ['dist/built.md'], { generatedGlobs: ['dist/**'] });
  assert.deepEqual(generated.copies, [], 'a literal path into a generated tree was copied');
});

// REMOVED (G-22 of 20261001-155615-cgg-review-r3): the wiring check that every intent-sandbox builder called snapshotIntentDocs with the case flag (G-18, G-19). The case flag now defaults to the host's inside snapshotIntentDocs, so no caller can drop it.
// It matched source text, so an equivalent rewrite failed it and a broken wiring with the same spelling passed. The
// property is now DRIVEN in regression-cgg-r3-remediation.test.mjs, through a fake runtime passed with --runtime-bin,
// which logs what the node was actually handed.

// ---------------------------------------------------------------------------------------------- G-2
test('G-2: the live probe refuses to run inside a graph node, before anything else', () => {
  const r = runScript('check-intent-grant.mjs', [], { env: { GRAPH_NODE_DEPTH: '1', QUORATE_LIVE: '' } });
  assert.equal(r.status, 3, `exit ${r.status}: ${r.output.slice(-300)}`);
  assert.match(r.output, /GRAPH_NODE_DEPTH/);
});

// --------------------------------------------------------------------------------------------- G-24
test('G-24: a subscription probe child gets no credential, no API key, and depth 1', () => {
  assert.equal(typeof decisions.subscriptionProbeEnv, 'function', 'the probe environment has no owner');
  const secretName = ['GITHUB', 'TOKEN'].join('_');
  const src = { PATH: '/bin', [secretName]: 'x', ANTHROPIC_API_KEY: 'k', CLAUDECODE: '1', GRAPH_NODE_DEPTH: '0' };
  // The runtime's adapter names what is stripped (G-11 of 20261103-022403-rbr-remediation-8-review).
  const { env } = decisions.subscriptionProbeEnv(src, builtinReviewers().claude);
  assert.equal(env.PATH, '/bin');
  for (const k of [secretName, 'ANTHROPIC_API_KEY', 'CLAUDECODE']) assert.ok(!(k in env), `${k} reached the child`);
  assert.equal(env.GRAPH_NODE_DEPTH, '1');
  // Both subscription probes take it from the owner (source check: the behaviour is the assertion above).
  // With the runtime the probe spawns, whose adapter names what is stripped (G-11 of 20261103-022403-rbr-remediation-8-review).
  for (const f of ['new-run.mjs', 'check-intent-grant.mjs']) assert.match(read('scripts', f), /subscriptionProbeEnv\(process\.env, (NODE_RUNTIME|RUNTIME)\)/, f);
});

// ---------------------------------------------------------------------------------------------- G-8
test('G-8: a file the tree hash cannot read makes the hash unrepeatable, so the gate cannot call the tree stable', (t) => {
  const repo = tmp(t, 'q-r2-g8-');
  put(repo, 'src/a.js');
  put(repo, 'src/locked.js');
  const failing = (f, ...rest) => {
    if (path.basename(f) === 'locked.js') { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
    return fs.readFileSync(f, ...rest);
  };
  const a = worktreeSha({ repoRoot: repo, paths: ['src'], readFile: failing });
  const b = worktreeSha({ repoRoot: repo, paths: ['src'], readFile: failing });
  assert.ok(a && b);
  assert.notEqual(a, b, 'an unreadable file was dropped from the hash, so two snapshots agree about content neither read');
  assert.equal(worktreeSha({ repoRoot: repo, paths: ['src'] }), worktreeSha({ repoRoot: repo, paths: ['src'] }),
    'a readable tree must still hash the same twice');
});

// --------------------------------------------------------------------------------------------- G-23
test('G-23: with the panel OFF, a run whose evidence git would not ignore says so in the gate (driven, not matched)', (t) => {
  const repo = tmp(t, 'q-r2-g23-');
  put(repo, 'src/app.js', 'export const x = 1;\n');
  put(repo, '.claude/reviews/.gitignore', '.preflight-cache/\n');   // no evidence rule
  const yaml = ['graph_contract_version: 5', 'project: r2-archive', 'commands:', '  build: "node -e 0"', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:', '  external_panel: false'].join('\n');
  put(repo, 'CLAUDE.md', '# fixture\n\n```yaml\n' + yaml + '\n```\n');
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  const slug = `r2archive${Math.floor(Math.random() * 1e6)}`;
  const mint = runScript('new-run.mjs', ['--slug', slug, '--repo-root', repo, '--no-request', '--no-verify-sandbox', '--full-sweep', 'src'], { cwd: repo });
  assert.equal(mint.status, 0, mint.output.slice(-500));
  const runId = mintedRunId(mint.output, slug);
  const staged = mintedRunDir(mint.output);
  t.after(() => fs.rmSync(staged, { recursive: true, force: true }));
  const graph = runScript('run-graph.mjs', ['--run-dir', staged, '--repo-root', repo, '--only', 'ui-audit', '--preflight', 'always'], { cwd: repo });
  const gatePath = [path.join(repo, '.claude', 'reviews', runId, 'gate.json'), path.join(staged, 'gate.json')].find((p) => fs.existsSync(p));
  assert.ok(gatePath, `no gate was written:\n${graph.output.slice(-800)}`);
  const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  const entry = (gate.buckets?.not_checked ?? []).find((e) => e.node_id === 'archive');
  assert.ok(entry, `the gate is silent about withheld evidence with the panel off: ${JSON.stringify(gate.buckets?.not_checked)}`);
  assert.match(entry.why, /stays staged|lacks/);
});
