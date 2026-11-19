// decision-records.plan.md stage 3 (design DR-D2 B, DR-D6 A, DR-D7 A; ARCHITECTURE.md A-22, A-24): a panel decision's
// basis is set by code from the evidence paths its seats cite, a citation counting only when it resolves (through the one
// citation owner, lib/claim-check.mjs resolveCitation) to a captured artifact; the decision's basis is the lowest among
// the seats that formed the majority; at or above review.grounding_floor the panel settles it, below it the question goes
// to the operator with the panel's positions; and the record carries every field A-24 lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { seatBasis, decisionBasis, meetsFloor, settleOutcome, seatAnswerOf } from '../scripts/lib/decision-panel.mjs';
import { runDecision } from '../scripts/io/decision-run.mjs';

const IO = hostPlatform();
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-'));
  const ev = path.join(root, '.claude', 'reviews', '20261101-000000-r', 'evidence');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'bench.txt'), 'measured: 12 ms\n');
  fs.writeFileSync(path.join(root, 'notes.md'), 'an opinion\n');
  return root;
}

test('a seat is grounded only by a citation that resolves to a captured artifact', () => {
  const root = repo();
  try {
    const at = (c) => seatBasis(c, { evidence: c, repoRoot: root, io: IO });
    assert.equal(at(['.claude/reviews/20261101-000000-r/evidence/bench.txt']).basis, 'measurement');
    assert.equal(at(['notes.md']).basis, 'convention', 'a real file that is not a captured artifact grounds nothing');
    const missing = at(['.claude/reviews/20261101-000000-r/evidence/absent.txt']);
    assert.equal(missing.basis, 'convention');
    assert.equal(missing.refused.length, 1, 'a citation that does not resolve is named, not counted');
    assert.equal(at([path.join('..', 'outside.txt')]).basis, 'convention');
    assert.equal(at([]).basis, 'convention');
    assert.equal(at(undefined).basis, 'convention');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// G-14 of 20261102-231209-rbr-remediation-6-review: resolveCitation refuses only a link that leaves the repository, and
// seatBasis then classified the LEXICAL path, so a link under a run's evidence/ to an ordinary source file earned
// measurement. What the citation resolves to must itself be a captured artifact.
test('a link under evidence/ to an ordinary repository file grounds nothing (G-14)', () => {
  const root = repo();
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const x = 1;\n');
    fs.symlinkSync(path.join(root, 'src'), path.join(root, '.claude', 'reviews', '20261101-000000-r', 'evidence', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const r = seatBasis(['.claude/reviews/20261101-000000-r/evidence/linked/a.mjs'], { evidence: ['.claude/reviews/20261101-000000-r/evidence/linked/a.mjs'], repoRoot: root, io: IO });
    assert.equal(r.basis, 'convention', 'a linked source file was counted as a captured artifact');
    assert.equal(r.refused.length, 1, 'the linked citation is named as refused');
    assert.equal(seatBasis(['.claude/reviews/20261101-000000-r/evidence/bench.txt'], { evidence: ['.claude/reviews/20261101-000000-r/evidence/bench.txt'], repoRoot: root, io: IO }).basis, 'measurement', 'a real artifact still grounds');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the decision\'s basis is the lowest among the majority\'s seats; the others do not count', () => {
  const bases = { s1: 'measurement', s2: 'convention', s3: 'measurement' };
  assert.equal(decisionBasis(bases, ['s1', 's3']), 'measurement');
  assert.equal(decisionBasis(bases, ['s1', 's2']), 'convention', 'one ungrounded vote makes the majority ungrounded');
  assert.equal(decisionBasis(bases, []), null);
});

test('the floor: convention settles everything, measurement needs a measured majority, a floor no panel reaches settles nothing', () => {
  assert.equal(meetsFloor('measurement', 'measurement'), true);
  assert.equal(meetsFloor('convention', 'measurement'), false);
  assert.equal(meetsFloor('convention', 'convention'), true);
  assert.equal(meetsFloor('measurement', 'invariant'), false);
  assert.equal(meetsFloor(null, 'convention'), false, 'no basis meets no floor');
});

test('a majority at or above the floor is settled; below it, it goes to the operator with the positions', () => {
  const o = { outcome: 'majority', entry: 'E1', agreement: 'unanimous', rounds: 1, moderator_rounds: 0 };
  assert.equal(settleOutcome(o, { basis: 'measurement', floor: 'measurement' }).outcome, 'majority');
  const below = settleOutcome(o, { basis: 'convention', floor: 'measurement' });
  assert.equal(below.outcome, 'to-operator');
  assert.equal(below.entry, 'E1', 'the panel\'s choice is kept as its position');
  for (const other of ['revote', 'postponed']) assert.equal(settleOutcome({ outcome: other }, { basis: null, floor: 'measurement' }).outcome, other);
});

test('a seat\'s answer carries its citations and what would change its choice', () => {
  const a = seatAnswerOf({ status: 'ok', choice: 'E1', rationale: 'r', other_text: '', change_of: '', citations: ['x.txt', '', 3], what_would_change: 'a bench run' });
  assert.deepEqual(a.result.citations, ['x.txt']);
  assert.equal(a.result.what_would_change, 'a bench run');
});

test('the record holds A-24\'s fields, and a majority below the floor goes to the operator', async () => {
  const root = repo();
  const rec = path.join(root, 'rec');
  try {
    const cite = ['.claude/reviews/20261101-000000-r/evidence/bench.txt'];
    const ans = (choice, extra = {}) => ({ status: 'ok', choice, rationale: `because ${choice}`, other_text: '', change_of: '', what_would_change: `if not ${choice}`, citations: [], ...extra });
    const seats = { s1: ans('E1', { citations: cite }), s2: ans('E1'), s3: ans('E2', { citations: cite }) };
    const grounding = { floor: 'measurement', basisOf: (c) => seatBasis(c, { evidence: c, repoRoot: root, io: IO }).basis };
    const { outcome } = await runDecision({
      question: { question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }, recordDir: rec, seed: 'x', seats: ['s1', 's2', 's3'],
      context: '', caps: { cap: 1, hardCap: 1 }, runSeat: async (s) => seats[s], runModerator: async () => null,
      grounding, families: { s1: 'f1', s2: 'f2', s3: 'f3' },
    });
    assert.equal(outcome.outcome, 'to-operator', 's2 cited nothing, so the E1 majority is ungrounded');
    assert.equal(outcome.basis, 'convention');
    assert.equal(outcome.floor, 'measurement');
    const s1 = outcome.seats.find((x) => x.seat === 's1');
    assert.deepEqual([s1.family, s1.entry, s1.basis, s1.what_would_change], ['f1', 'E1', 'measurement', 'if not E1']);
    assert.deepEqual(s1.citations, cite);
    const onDisk = JSON.parse(fs.readFileSync(path.join(rec, 'outcome.json'), 'utf8'));
    for (const k of ['basis', 'floor', 'seats', 'agreement', 'rounds', 'entry']) assert.ok(Object.hasOwn(onDisk, k), k);
    await assert.rejects(() => runDecision({ question: { question: 'q', options: [{ label: 'A' }, { label: 'B' }] }, recordDir: path.join(root, 'r2'),
      seed: 'x', seats: ['s1'], context: '', caps: { cap: 1, hardCap: 1 }, runSeat: async () => null, runModerator: async () => null }), /floor/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
