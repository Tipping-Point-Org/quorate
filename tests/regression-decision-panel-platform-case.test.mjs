// G-4 of 20261104-020352-gre-remediation-2-review (its root, with G-3 and the code half of G-2): lib/decision-panel.mjs
// decided letter case by the host's path separator (`path.sep === '\\'`) rather than by the platform's
// caseInsensitiveFs (ARCHITECTURE §2), which is wrong for macOS (case-insensitive, '/'), and its two containment checks
// (questionEvidenceError, outsideRepoCapture) used the case-sensitive isWithin, so on Windows a reviews-root spelling
// that differed only by case was refused, or a measured vote demoted to convention. Now every fold comes from the
// platform: `caseInsensitive` for the functions that take no io, io.caseInsensitiveFs for seatBasis.
// And G-1 of the same review: a --revote read the record's question.json and never checked its evidence list against the
// approved roots, so an edited record could send any local path to the external seats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runScript } from './helpers.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { seatBasis, questionEvidenceError, isCapturedArtifact } from '../scripts/lib/decision-panel.mjs';
import { rootEvidencePath } from '../scripts/lib/evidence-path.mjs';

const IO = hostPlatform();
// The first letter after a separator, never a drive letter: lib/evidence-path.mjs compares a drive letter in either case,
// as Windows does on every file system, so flipping it would not be a case variant of the root (evidence-path-owner.plan.md).
const flip = (s) => s.replace(/(?<=[\\/])[a-z]/i, (ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()));

test('G-4: isCapturedArtifact folds the evidence segment by the caseInsensitive it is given, not by the separator', () => {
  const root = path.resolve(os.tmpdir(), 'dp-case-repo');
  const upper = '.claude/reviews/20261101-000000-r/EVIDENCE/x.txt';
  // The owner's result, as the intake gives it (G-5 of 20261104-171128-epo-remediation-3-review).
  const at = (p, o) => isCapturedArtifact(rootEvidencePath(p, o), o);
  assert.equal(at(upper, { repoRoot: root, caseInsensitive: true }), true);
  assert.equal(at(upper, { repoRoot: root, caseInsensitive: false }), false);
  assert.equal(at('.claude/reviews/20261101-000000-r/evidence/x.txt', { repoRoot: root, caseInsensitive: false }), true);
});

test('G-2/G-4: questionEvidenceError judges a reviews-root spelling differing only by case by the platform rule', () => {
  const root = path.resolve(os.tmpdir(), 'dp-case-repo');
  const staging = path.resolve(os.tmpdir(), 'dp-case-home', 'reviews', 'proj');
  const entry = path.join(flip(staging), '20261101-000000-r', 'evidence', 'bench.txt');
  assert.equal(questionEvidenceError([entry], { repoRoot: root, stagingRoot: staging, caseInsensitive: true }), null);
  assert.match(questionEvidenceError([entry], { repoRoot: root, stagingRoot: staging, caseInsensitive: false }) ?? '', /evidence\[0\]/);
  // The root itself, in either case, is still not an entry below it.
  assert.match(questionEvidenceError([flip(staging)], { repoRoot: root, stagingRoot: staging, caseInsensitive: true }) ?? '', /evidence\[0\]/);
});

test('G-4: seatBasis folds by io.caseInsensitiveFs, not by the separator', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-case-'));
  try {
    const rel = '.claude/reviews/20261101-000000-r/evidence/bench.txt';
    fs.mkdirSync(path.join(root, ...path.dirname(rel).split('/')), { recursive: true });
    fs.writeFileSync(path.join(root, ...rel.split('/')), 'measured\n');
    // A case-sensitive platform never matches a list entry that differs by case, whatever the host's separator.
    const sensitive = { ...IO, caseInsensitiveFs: false };
    assert.equal(seatBasis([rel], { repoRoot: root, io: sensitive, evidence: [rel.replace('bench', 'BENCH')] }).basis, 'convention');
    assert.equal(seatBasis([rel], { repoRoot: root, io: sensitive, evidence: [rel] }).basis, 'measurement');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// G-5 of 20261104-072059-epo-remediation-review: seatBasis read `io?.caseInsensitiveFs === true`, so an io carrying no
// case rule silently meant case-sensitive, while isCapturedArtifact beside it refuses an omitted rule. They refuse alike.
test('G-5: seatBasis refuses an io with no boolean caseInsensitiveFs rather than defaulting to case-sensitive', () => {
  const root = path.resolve(os.tmpdir(), 'dp-case-repo');
  const rel = '.claude/reviews/20261101-000000-r/evidence/bench.txt';
  const { caseInsensitiveFs, ...noRule } = IO;
  assert.throws(() => seatBasis([rel], { repoRoot: root, io: noRule, evidence: [rel] }), /caseInsensitive/);
  assert.throws(() => seatBasis([rel], { repoRoot: root, io: { ...IO, caseInsensitiveFs: 'yes' }, evidence: [rel] }), /caseInsensitive/);
  assert.throws(() => seatBasis([rel], { repoRoot: root, evidence: [rel] }), /caseInsensitive/);
  assert.equal(typeof caseInsensitiveFs, 'boolean');
});

test('G-3: on a case-insensitive file system, a capture below an outside reviews root cited with other case grounds the seat', { skip: !IO.caseInsensitiveFs }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-case-out-'));
  try {
    const root = path.join(tmp, 'repo'); fs.mkdirSync(root);
    const reviews = path.join(tmp, 'reviews');
    const file = path.join(reviews, '20261101-000000-r', 'evidence', 'bench.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'measured\n');
    const cited = path.join(flip(reviews), '20261101-000000-r', 'evidence', 'bench.txt');
    const r = seatBasis([cited], { repoRoot: root, io: IO, reviewsDir: reviews, evidence: [file] });
    assert.equal(r.basis, 'measurement', JSON.stringify(r.refused));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// G-6 of the same review: the vendor-egress inventory of the decision panel listed the work context as the request or
// plan, the stage and the changed files, and omitted the evidence list workContextText sends.
test('G-6: the external-reviewers egress inventory names the evidence list among what leaves the machine', () => {
  const doc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'external-reviewers.md'), 'utf8');
  const at = doc.indexOf('**Deciding**');
  assert.ok(at >= 0, 'no Deciding entry');
  const entry = doc.slice(at, doc.indexOf('\n\n', at));
  assert.match(entry, /What leaves the machine[^.]*evidence list/, entry);
});

// The panel on, and a seat put in the node runtime's family, so a revote that passes every check before the seats is
// refused at their family check (as in regression-decide-prep-and-pending): no seat and no model is reached.
const PANEL_CONTRACT = '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
  + 'review:\n  external_panel: true\n  decision_panel: on\nreviewers:\n  codex:\n    family: anthropic\n'
  + 'ui:\n  surface: none\n```\n';

test('G-1: a revote whose recorded evidence list names a path outside every approved root is refused before the seats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-revote-'));
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/decisions/\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), PANEL_CONTRACT);
    git('add', '-A'); git('commit', '-qm', 'init');
    const id = '20261031-120000-abcdef';
    const rec = path.join(dir, '.claude', 'decisions', id);
    fs.mkdirSync(rec, { recursive: true });
    const outside = path.resolve(os.tmpdir(), 'elsewhere', 'secret.txt');
    fs.writeFileSync(path.join(rec, 'question.json'), JSON.stringify({ question: 'Which bound?',
      options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable', evidence: [outside] }));
    fs.writeFileSync(path.join(rec, 'outcome.json'), JSON.stringify({ outcome: 'revote' }));
    const r = runScript('decide.mjs', ['--revote', id, '--repo-root', dir]);
    assert.notEqual(r.status, 0, r.output);
    assert.doesNotMatch(r.output, /same family/, `the revote reached the seats with an unchecked evidence list: ${r.output}`);
    assert.match(r.output, /evidence\[0\]/, r.output);
    assert.equal(fs.existsSync(path.join(rec, 'revote')), false, 'the refused revote left its claim directory behind');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
