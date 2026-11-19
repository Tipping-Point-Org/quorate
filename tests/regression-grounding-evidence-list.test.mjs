// grounding-and-retry-evidence.plan.md stages 1 and 3 (design GR-D1 A, operator 2026-11-03: "8 a").
// G-8 of 20261103-191032-dr-remediation-3-review, G-7 of its follow-up: a seat's citation earned `measurement` when it
// resolved to ANY run's captured artifact, with nothing tying it to the question, so an unrelated capture could meet the
// grounding floor and settle a decision the floor would send to the operator. Now a question names its evidence, and only
// a citation in that list grounds a seat. And G-1 of 20261103-211624-dr-remediation-4-review: --operator-quote was
// accepted with a mode that never reads it, and the operator's words were silently ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { seatBasis, questionEvidenceError, blindQuestion, workContextText } from '../scripts/lib/decision-panel.mjs';

const IO = hostPlatform();
// The intake normalizes against the roots (evidence-path-owner.plan.md stage 3), so it is always given them.
// The case rule is the caller's (G-6 of 20261104-060910-epo-delivery): the platform's, given every time.
const ROOTS = { repoRoot: path.resolve('evidence-list-repo'), caseInsensitive: IO.caseInsensitiveFs };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BENCH = '.claude/reviews/20261101-000000-r/evidence/bench.txt';
const OTHER = '.claude/reviews/20261101-000000-r/evidence/other.txt';
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-list-'));
  const ev = path.join(root, ...path.dirname(BENCH).split('/'));
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(root, ...BENCH.split('/')), 'measured: 12 ms\n');
  fs.writeFileSync(path.join(root, ...OTHER.split('/')), 'an unrelated capture\n');
  return root;
}

test('GR-D1 A: a captured artifact the question does not name grounds no seat', () => {
  const root = repo();
  try {
    const r = seatBasis([OTHER], { repoRoot: root, io: IO, evidence: [BENCH] });
    assert.equal(r.basis, 'convention');
    assert.match(r.refused[0].why, /not among the evidence the question names/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('GR-D1 A: a captured artifact the question names grounds a seat, compared as a citation resolves', () => {
  const root = repo();
  try {
    assert.equal(seatBasis([BENCH], { repoRoot: root, io: IO, evidence: [BENCH] }).basis, 'measurement');
    // The same file spelled another way still matches: both sides are resolved by one rule.
    assert.equal(seatBasis([`./${BENCH}`], { repoRoot: root, io: IO, evidence: [path.join(root, ...BENCH.split('/'))] }).basis, 'measurement');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('GR-D1 A: a question with no evidence list, or an empty one, grounds no seat', () => {
  const root = repo();
  try {
    for (const evidence of [undefined, []]) {
      const r = seatBasis([BENCH], { repoRoot: root, io: IO, evidence });
      assert.equal(r.basis, 'convention', JSON.stringify(evidence));
      assert.match(r.refused[0].why, /names no evidence/);
    }
    // Naming a file does not make it an artifact: the checks before the list still hold.
    fs.writeFileSync(path.join(root, 'notes.md'), 'an opinion\n');
    assert.equal(seatBasis(['notes.md'], { repoRoot: root, io: IO, evidence: ['notes.md'] }).basis, 'convention');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('GR-D1 A: the evidence list is absent or a list of non-empty paths; anything else is refused', () => {
  assert.equal(questionEvidenceError(undefined, ROOTS), null);
  assert.equal(questionEvidenceError([BENCH], ROOTS), null);
  assert.match(questionEvidenceError(BENCH, ROOTS), /must be a list/);
  assert.match(questionEvidenceError([BENCH, ''], ROOTS), /evidence\[1\]/);
  assert.match(questionEvidenceError([3], ROOTS), /evidence\[0\]/);
});

// G-5 of 20261103-234542-gre-delivery: the check took only a list of non-empty strings, so an absolute path or one
// escaping with `..` reached the record, which the plan's I-1 refuses before any record exists.
test('G-5: an evidence entry that is absolute or escapes with .. is refused', () => {
  for (const bad of ['/etc/passwd', 'C:/x/y.txt', 'C:\\x\\y.txt', '\\\\host\\share\\f', '../../x', 'a/../../x', 'a\\..\\..\\x', '..']) {
    assert.match(questionEvidenceError([BENCH, bad], ROOTS) ?? '', /evidence\[1\]/, JSON.stringify(bad));
  }
  // A `..` that is part of a name is not a step up.
  assert.equal(questionEvidenceError(['.claude/reviews/r/evidence/a..b.txt'], ROOTS), null);
});

// G-4 and its symptom G-3 of 20261103-234542-gre-delivery: the seat-facing question kept only `question` and `options`,
// so no seat was shown the list that decides which of its citations count.
test('G-4: the evidence list reaches the seat-facing question and the work context a seat is given', () => {
  const b = blindQuestion({ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], evidence: [BENCH] });
  assert.deepEqual(b.evidence, [BENCH]);
  assert.deepEqual(blindQuestion({ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }).evidence, []);
  const text = workContextText({ evidence: [BENCH] });
  assert.ok(text.includes(BENCH), text);
  assert.match(text, /only a citation among them grounds/i);
  assert.match(workContextText({}), /evidence the question names: \(none\)/i);
});

test('GR-D1 A: decide.mjs refuses a malformed evidence list before a record exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-cli-'));
  try {
    const q = path.join(tmp, 'q.json');
    fs.writeFileSync(q, JSON.stringify({ question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }],
      category: 'delegable', evidence: 'one path, not a list' }));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'decide.mjs'), '--question', q, '--repo-root', tmp],
      { encoding: 'utf8', env: { ...process.env, GRAPH_NODE_DEPTH: '0', QUORATE_HOME: path.join(tmp, 'home') }, timeout: 60_000 });
    assert.notEqual(r.status, 0, `accepted: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /evidence of the question must be a list/);
    assert.equal(fs.existsSync(path.join(tmp, '.claude', 'decisions')), false, 'a record was made for a refused question');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('G-1: decide.mjs refuses --operator-quote with a mode that does not read it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-quote-'));
  try {
    // Every mode that does not read it (G-1 of 20261104-004602-gre-remediation-review: --question and --revote were untested).
    fs.writeFileSync(path.join(tmp, 'q.json'), JSON.stringify({ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], category: 'delegable' }));
    for (const mode of [['--question', path.join(tmp, 'q.json')], ['--revote', '20261101-000000-x'], ['--pending'], ['--count-spend', 'run-x'], ['--sample']]) {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'decide.mjs'), ...mode, '--operator-quote', 'yes', '--repo-root', tmp],
        { encoding: 'utf8', env: { ...process.env, GRAPH_NODE_DEPTH: '0', QUORATE_HOME: path.join(tmp, 'home') }, timeout: 60_000 });
      assert.notEqual(r.status, 0, `${mode[0]} --operator-quote was accepted: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /--operator-quote is valid only with --overrule or --sample-mark/, mode[0]);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// G-3 of 20261104-004602-gre-remediation-review: the G-5 check refused every absolute path by its spelling, but I-1 lets
// an entry sit under a reviews directory, and undeclared a live run is staged under the engine's home, outside the
// repository and reachable only absolutely. So a capture of a live staged run, or of an absolute declared reviews_dir,
// could never be named, and no seat could earn `measurement` from it. An absolute path under one of those is allowed; an
// absolute path anywhere else, and every `..`, is still refused.
test('G-3: an absolute evidence entry under the staging root or a declared reviews directory is accepted', () => {
  const root = path.resolve(os.tmpdir(), 'g3-repo');
  const staging = path.resolve(os.tmpdir(), 'g3-home', 'reviews', 'proj');
  const underStaging = path.join(staging, '20261101-000000-r', 'evidence', 'bench.txt');
  assert.equal(questionEvidenceError([underStaging], { repoRoot: root, reviewsDir: '', stagingRoot: staging, caseInsensitive: IO.caseInsensitiveFs }), null);
  const declared = path.resolve(os.tmpdir(), 'g3-declared');
  const underDeclared = path.join(declared, '20261101-000000-r', 'evidence', 'bench.txt');
  assert.equal(questionEvidenceError([underDeclared], { repoRoot: root, reviewsDir: declared, caseInsensitive: IO.caseInsensitiveFs }), null);
  // A declared reviews_dir is the one place: the staging root no longer counts.
  assert.match(questionEvidenceError([underStaging], { repoRoot: root, reviewsDir: declared, stagingRoot: null, caseInsensitive: IO.caseInsensitiveFs }) ?? '', /evidence\[0\]/);
  // Anywhere else, and a `..` even under the root, is refused as before.
  assert.match(questionEvidenceError([path.resolve(os.tmpdir(), 'elsewhere', 'x.txt')], { repoRoot: root, reviewsDir: '', stagingRoot: staging, caseInsensitive: IO.caseInsensitiveFs }) ?? '', /evidence\[0\]/);
  assert.match(questionEvidenceError([`${staging}${path.sep}..${path.sep}x.txt`], { repoRoot: root, reviewsDir: '', stagingRoot: staging, caseInsensitive: IO.caseInsensitiveFs }) ?? '', /evidence\[0\]/);
  assert.match(questionEvidenceError([staging], { repoRoot: root, reviewsDir: '', stagingRoot: staging, caseInsensitive: IO.caseInsensitiveFs }) ?? '', /evidence\[0\]/);
});

// G-5 of 20261104-004602-gre-remediation-review: list membership was a case-sensitive Set of path strings, and the link
// check compared the real path's spelling with the cited one, so on a case-insensitive file system a citation naming a
// listed capture with other letter case was refused and the seat stayed at convention.
test('G-5: on Windows, a citation that differs from its list entry only by letter case grounds the seat', { skip: process.platform !== 'win32' }, () => {
  const root = repo();
  try {
    const upper = BENCH.replace('evidence/bench.txt', 'EVIDENCE/Bench.TXT');
    assert.equal(seatBasis([upper], { repoRoot: root, io: IO, evidence: [BENCH] }).basis, 'measurement');
    assert.equal(seatBasis([BENCH], { repoRoot: root, io: IO, evidence: [upper] }).basis, 'measurement');
    // Still only what the list names.
    assert.equal(seatBasis([OTHER.toUpperCase()], { repoRoot: root, io: IO, evidence: [BENCH] }).basis, 'convention');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// G-11 and G-12 of 20261104-004602-gre-remediation-review: the contract's vendor-disclosure list of the work context left
// out the evidence list a seat is now shown, and the evidence field's text named no refusal of an absolute or `..` path.
// ONE OWNER since evidence-path-owner.plan.md stage 5 (G-10 and G-9 of 20261104-030455-gre-remediation-3-review): what
// leaves for the panel was stated in both documents; shared/external-reviewers.md owns it and the contract points at it.
test('G-11: the owner of what leaves for the panel names the evidence list, and the contract points at it', () => {
  const owner = fs.readFileSync(path.join(ROOT, 'shared', 'external-reviewers.md'), 'utf8');
  assert.match(owner, /What leaves the machine is the question, its options and the work context[^.]*evidence list/);
  const doc = fs.readFileSync(path.join(ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  const panel = doc.slice(doc.indexOf('**`decision_panel`'), doc.indexOf('**`decision_panel`') + 900);
  assert.match(panel, /owned by `shared\/external-reviewers\.md`/, panel);
  assert.doesNotMatch(panel, /work context \(/, 'the contract restates the list it points at');
});

test('G-12: the contract states the path rules of an evidence entry', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  const floor = doc.slice(doc.indexOf('**`grounding_floor`'), doc.indexOf('**`grounding_floor`') + 1600);
  assert.match(floor, /`\.\.`/, floor);
  assert.match(floor, /absolute[^.]*reviews directory/, floor);
});
