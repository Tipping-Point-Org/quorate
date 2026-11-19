// evidence-path-owner.plan.md stage 1 (design EP-D1 A, EP-D2 C, operator 2026-11-04). The grounding-and-retry-evidence
// chain reached its round cap with every round on how a cited evidence path is spelled or compared (absolute and '..'
// entries, the staged reviews root, case by the host's separator, '\' against '/': G-5 and G-2 of
// 20261104-030455-gre-remediation-3-review the last). One owner now gives each spelling one normal form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runEvidencePath, rootEvidencePath, reviewRoots } from '../scripts/lib/evidence-path.mjs';
import { seatBasis, isCapturedArtifact, questionEvidenceError } from '../scripts/lib/decision-panel.mjs';
import { normalizeEvidenceFields } from '../scripts/lib/remediation-chain.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IO = hostPlatform();

const RUN_WIN = 'C:\\Users\\op\\.quorate\\reviews\\proj\\20261104-000000-r';
const RUN_POSIX = '/home/op/.quorate/reviews/proj/20261104-000000-r';
// The case rule is the caller's on every call (G-6, G-21 of 20261104-060910-epo-delivery): these tests left it out and
// leant on a default the owner no longer has.
const CS = { caseInsensitive: false };

test('runEvidencePath: every spelling of one capture reaches one normal form', () => {
  const want = 'evidence/remediation/green.txt';
  for (const [p, o] of [
    ['evidence/remediation/green.txt', CS],
    ['evidence\\remediation\\green.txt', CS],
    ['./evidence//remediation/./green.txt', CS],
    [`${RUN_WIN}\\evidence\\remediation\\green.txt`, { runDir: RUN_WIN, ...CS }],
    [`c:/users/OP/.quorate/reviews/proj/20261104-000000-r/evidence/remediation/green.txt`, { runDir: RUN_WIN, caseInsensitive: true }],
    [`${RUN_POSIX}/evidence/remediation/green.txt`, { runDir: RUN_POSIX, ...CS }],
  ]) {
    const r = runEvidencePath(p, o);
    assert.equal(r.path, want, `${p}: ${r.refused}`);
    assert.deepEqual(r.segs, ['evidence', 'remediation', 'green.txt']);
  }
});

test('runEvidencePath: an absolute path written where the run was staged still reaches the run that moved', () => {
  const stagedDir = 'C:\\Users\\op\\.quorate\\reviews\\proj\\20261104-000000-r';
  const staged = `${stagedDir}\\evidence\\remediation\\red.txt`;
  const archived = 'F:\\work\\repo\\.claude\\reviews\\20261104-000000-r';
  assert.equal(runEvidencePath(staged, { runDir: archived, formerRunDirs: [stagedDir], ...CS }).path, 'evidence/remediation/red.txt');
  // Another run's id is not this run.
  assert.match(runEvidencePath(staged, { runDir: 'F:\\work\\repo\\.claude\\reviews\\20261104-111111-other', ...CS }).refused, /not below the run directory/);
});

// G-7 of 20261104-060910-epo-delivery: any absolute path with a `<run-id>/evidence` segment, in any tree, was rewritten to
// this run's capture, so the gate read a different file than the citation named.
test('G-7: a directory that merely carries the run id is not where the run lived', () => {
  const archived = 'F:\\work\\repo\\.claude\\reviews\\20261104-000000-r';
  const stagedDir = 'C:\\Users\\op\\.quorate\\reviews\\proj\\20261104-000000-r';
  for (const p of ['C:\\untrusted\\20261104-000000-r\\evidence\\remediation\\red.txt', '/tmp/x/20261104-000000-r/evidence/remediation/red.txt']) {
    assert.match(runEvidencePath(p, { runDir: archived, ...CS }).refused ?? '', /not below the run directory/, p);
    assert.match(runEvidencePath(p, { runDir: archived, formerRunDirs: [stagedDir], ...CS }).refused ?? '', /not below the run directory/, p);
  }
});

test('runEvidencePath: each refusal is named', () => {
  for (const [p, o, re] of [
    ['', CS, /empty/],
    ['evidence/remediation/../../run.json', CS, /'\.\.'/],
    ['evidence/other/x.txt', CS, /not a capture below evidence\/remediation/],
    [`${RUN_POSIX}/evidence/remediation/x.txt`, CS, /no run directory was given/],
    ['/elsewhere/evidence/remediation/x.txt', { runDir: RUN_POSIX, ...CS }, /not below the run directory/],
    // The run's id, not followed by evidence/, is not this run's folder.
    [`/elsewhere/20261104-000000-r/other/evidence/remediation/x.txt`, { runDir: RUN_POSIX, ...CS }, /not below the run directory/],
  ]) {
    assert.match(runEvidencePath(p, o).refused ?? '', re, p);
  }
});

// G-8 of 20261104-060910-epo-delivery: the folder with no capture name got the generic refusal, not its own.
test('G-8: a path naming no capture has its own refusal', () => {
  for (const p of ['evidence/remediation/', 'evidence/remediation', 'evidence\\remediation\\', `${RUN_POSIX}/evidence/remediation/`]) {
    assert.match(runEvidencePath(p, { runDir: RUN_POSIX, ...CS }).refused ?? '', /names no capture/, p);
  }
});

// G-6 of 20261104-060910-epo-delivery: both owners defaulted the case rule to case-sensitive, so a caller that left it out
// compared two spellings of one file as different on a case-insensitive file system, silently.
test('G-6: the case rule is required by each owner and by the readers that pass it on', () => {
  assert.throws(() => runEvidencePath('evidence/remediation/x.txt', {}), /caseInsensitive/);
  assert.throws(() => runEvidencePath('evidence/remediation/x.txt'), /caseInsensitive/);
  assert.throws(() => rootEvidencePath('x.txt', { repoRoot: REPO }), /caseInsensitive/);
  assert.throws(() => isCapturedArtifact('.claude/reviews/r/evidence/x.txt', { repoRoot: REPO }), /caseInsensitive/);
  assert.throws(() => questionEvidenceError(['x.txt'], { repoRoot: REPO }), /caseInsensitive/);
  assert.throws(() => normalizeEvidenceFields([{ red_evidence: 'evidence/remediation/r.txt' }], ['red_evidence'], { runDir: RUN_POSIX }), /caseInsensitive/);
});

const REPO = 'F:\\work\\repo';
const STAGING = 'C:\\Users\\op\\.quorate\\reviews\\repo-1';

test('rootEvidencePath: inside the repository, every spelling has one key, and the record keeps the relative form', () => {
  const opts = { repoRoot: REPO, stagingRoot: STAGING, caseInsensitive: true };
  const a = rootEvidencePath('.claude/reviews/r/evidence/bench.txt', opts);
  for (const p of ['.claude\\reviews\\r\\evidence\\bench.txt', 'f:/work/REPO/.claude/reviews/r/evidence/bench.txt', './.claude/reviews/r/evidence/bench.txt']) {
    const b = rootEvidencePath(p, opts);
    assert.equal(b.key, a.key, p);
  }
  assert.equal(a.inRepo, true);
  assert.equal(a.canonical, '.claude/reviews/r/evidence/bench.txt');
  assert.equal(a.rel, '.claude/reviews/r/evidence/bench.txt');
});

test('rootEvidencePath: below the staging root outside the repository, the record keeps the absolute form', () => {
  const r = rootEvidencePath(`${STAGING}\\20261104-000000-r\\evidence\\bench.txt`, { repoRoot: REPO, stagingRoot: STAGING, caseInsensitive: true });
  assert.equal(r.inRepo, false);
  assert.equal(r.root, 'C:/Users/op/.quorate/reviews/repo-1');
  assert.equal(r.rel, '20261104-000000-r/evidence/bench.txt');
  assert.equal(r.canonical, 'C:/Users/op/.quorate/reviews/repo-1/20261104-000000-r/evidence/bench.txt');
});

// G-9 of 20261104-060910-epo-delivery: a reviews root enclosing the repository was tried first, so a repository file was
// attributed to the outer root and marked outside the repository.
test('G-9: a repository nested below a reviews root keeps its own files', () => {
  const r = rootEvidencePath('src/a.mjs', { repoRoot: 'F:\\runs\\repo', reviewsDir: 'F:\\runs', ...CS });
  assert.equal(r.inRepo, true, JSON.stringify(r));
  assert.equal(r.canonical, 'src/a.mjs');
  assert.equal(r.root, 'F:/runs/repo');
  // A path below the reviews root and outside the repository is still that root's.
  const o = rootEvidencePath('F:\\runs\\20261104-000000-r\\evidence\\bench.txt', { repoRoot: 'F:\\runs\\repo', reviewsDir: 'F:\\runs', ...CS });
  assert.equal(o.inRepo, false, JSON.stringify(o));
  assert.equal(o.root, 'F:/runs');
});

test('rootEvidencePath: each refusal is named', () => {
  const opts = { repoRoot: REPO, stagingRoot: STAGING, ...CS };
  assert.match(rootEvidencePath('', opts).refused, /empty/);
  assert.match(rootEvidencePath('../other/x.txt', opts).refused, /'\.\.'/);
  assert.match(rootEvidencePath('D:\\elsewhere\\x.txt', opts).refused, /below neither the repository nor a reviews root/);
  assert.match(rootEvidencePath('x.txt', { repoRoot: 'relative', ...CS }).refused, /no absolute repository root/);
  // Case-sensitive, a case variant of the repository is another directory.
  assert.match(rootEvidencePath('F:\\WORK\\repo\\x.txt', opts).refused, /below neither/);
});

// G-10 and G-12 of 20261104-060910-epo-delivery: the normalizer took an item list and a field list the caller chose, so a
// read could normalize part of a report (the repair report's fixed greens only, after its check had read the spelling).
test('G-10: the report normalizer takes a report and returns it, every evidence field of every item normalized', async () => {
  const { normalizeReport } = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(typeof normalizeReport, 'function', 'no report-level normalizer');
  const out = normalizeReport({
    run_id: 'r',
    groups: [{ group_id: 'G-1', red_evidence: 'evidence\\remediation\\r.txt', green_evidence: './evidence/remediation/g.txt' }],
    failures: [
      { test_name: 'a', disposition: 'fixed', green_evidence: 'evidence\\remediation\\a.txt' },
      { test_name: 'b', disposition: 'not-fixed', green_evidence: 'evidence\\remediation\\b.txt' },
      { test_name: 'c', disposition: 'not-fixed', green_evidence: '/elsewhere/x.txt' },
    ],
  }, { runDir: RUN_POSIX, ...CS });
  assert.equal(out.run_id, 'r');
  assert.equal(out.groups[0].red_evidence, 'evidence/remediation/r.txt');
  assert.equal(out.groups[0].green_evidence, 'evidence/remediation/g.txt');
  assert.equal(out.failures[0].green_evidence, 'evidence/remediation/a.txt');
  assert.equal(out.failures[1].green_evidence, 'evidence/remediation/b.txt', 'a not-fixed failure was left in its spelling');
  assert.match(out.failures[2].evidence_path_refused ?? '', /not below the run directory/);
  assert.throws(() => normalizeReport({ groups: [] }, { runDir: RUN_POSIX }), /caseInsensitive/);
});

test('reviewRoots: a declared reviews directory is the one root; undeclared, the archive and the staging root', () => {
  assert.deepEqual(reviewRoots({ repoRoot: REPO, stagingRoot: STAGING, ...CS }), ['F:/work/repo/.claude/reviews', 'C:/Users/op/.quorate/reviews/repo-1']);
  assert.deepEqual(reviewRoots({ repoRoot: REPO, reviewsDir: 'runs', stagingRoot: STAGING, ...CS }), ['F:/work/repo/runs']);
  assert.deepEqual(reviewRoots({ repoRoot: '/srv/repo', reviewsDir: '/var/runs', ...CS }), ['/var/runs']);
});

// evidence-path-owner.plan.md stage 3: the panel's paths, normalized at the read of the question and of a seat's answer.
function panelRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epo-panel-'));
  fs.mkdirSync(path.join(root, '.claude', 'reviews', 'r', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'reviews', 'r', 'evidence', 'bench.txt'), 'measured: 12 ms\n');
  return root;
}

test('stage 3: a citation spelled another way than the question\'s list still matches it', () => {
  const root = panelRepo();
  try {
    const r = seatBasis(['.claude\\reviews\\r\\evidence\\bench.txt'], { repoRoot: root, io: IO, evidence: ['./.claude/reviews/r/evidence/bench.txt'] });
    assert.equal(r.basis, 'measurement', JSON.stringify(r.refused));
    assert.deepEqual(r.resolved, ['.claude/reviews/r/evidence/bench.txt'], 'the resolved citation is the canonical spelling');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stage 3: a link below a reviews root in the question\'s list is refused at intake, before a record exists', () => {
  const root = panelRepo();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'epo-elsewhere-'));
  try {
    fs.writeFileSync(path.join(elsewhere, 'bench.txt'), 'not a capture\n');
    fs.mkdirSync(path.join(root, '.claude', 'reviews', 'linked'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(root, '.claude', 'reviews', 'linked', 'evidence'), 'junction');
    const contract = ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: epo-fixture', 'commands:', '  build: ""', '  test: ""',
      'source_globs: ["src/**"]', 'test_globs: ["tests/**"]', 'doc_paths: []', 'ui:', '  surface: none', '  static_bundle: ""',
      'review:', '  external_panel: true', '  decision_panel: on', '```', ''].join('\n');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), contract);
    const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x'); git('add', 'CLAUDE.md'); git('commit', '-qm', 'init');
    const q = path.join(root, 'q.json');
    fs.writeFileSync(q, JSON.stringify({ question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable',
      evidence: ['.claude/reviews/linked/evidence/bench.txt'] }));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'decide.mjs'), '--question', q, '--repo-root', root],
      { encoding: 'utf8', env: { ...process.env, GRAPH_NODE_DEPTH: '0', QUORATE_HOME: path.join(root, 'home') }, timeout: 60_000 });
    assert.notEqual(r.status, 0, `accepted: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /evidence\[0\] \(\.claude\/reviews\/linked\/evidence\/bench\.txt\) reaches its file through a link/);
    assert.equal(fs.existsSync(path.join(root, '.claude', 'decisions')), false, 'a record was made for a refused question');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('stage 3: a revote checks its recorded list again: a link put in the record is refused before the revote asks', () => {
  const root = panelRepo();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'epo-elsewhere-'));
  try {
    fs.writeFileSync(path.join(elsewhere, 'bench.txt'), 'not a capture\n');
    fs.mkdirSync(path.join(root, '.claude', 'reviews', 'linked'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(root, '.claude', 'reviews', 'linked', 'evidence'), 'junction');
    const contract = ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: epo-fixture', 'commands:', '  build: ""', '  test: ""',
      'source_globs: ["src/**"]', 'test_globs: ["tests/**"]', 'doc_paths: []', 'ui:', '  surface: none', '  static_bundle: ""',
      'review:', '  external_panel: true', '  decision_panel: on', '```', ''].join('\n');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), contract);
    fs.writeFileSync(path.join(root, '.gitignore'), '.claude/decisions/\n');
    const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x'); git('add', 'CLAUDE.md', '.gitignore'); git('commit', '-qm', 'init');
    const id = '20261104-120000-abcdef';
    const rec = path.join(root, '.claude', 'decisions', id);
    fs.mkdirSync(rec, { recursive: true });
    fs.writeFileSync(path.join(rec, 'question.json'), JSON.stringify({ question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }],
      category: 'delegable', evidence: ['.claude/reviews/linked/evidence/bench.txt'] }));
    fs.writeFileSync(path.join(rec, 'outcome.json'), JSON.stringify({ outcome: 'revote' }));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'decide.mjs'), '--revote', id, '--repo-root', root],
      { encoding: 'utf8', env: { ...process.env, GRAPH_NODE_DEPTH: '0', QUORATE_HOME: path.join(root, 'home') }, timeout: 60_000 });
    assert.notEqual(r.status, 0, `accepted: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /the record's question cannot be asked: the question's evidence\[0\] .* reaches its file through a link/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});
