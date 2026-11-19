// A SYMPTOM IS ADMITTED ONLY WITH AN ADMITTED ROOT (20261015-013937-symptom-admission, the review of 5a3ad670). The
// change that let a reported symptom be judged as its confirmed root checked only that the root was confirmed and not
// deferred, and resolved one `root_cause_group` hop; its two documents were left behind it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { admitGroups, COMMIT_CHECK_KINDS } from '../scripts/lib/remediation-chain.mjs';

const G = (id, files, extra = {}) => ({ group_id: id, disposition: 'fixed', files, red_evidence: '', green_evidence: '', cluster: id, ...extra });
const ids = (r) => r.plannable.map((g) => g.group_id);

// G-3 (HIGH): a symptom with its own files and its own cluster was planned while its root was refused or missing — a
// downstream-only change committed as though the root were fixed. Its root must itself be committed.
test('G-3: a symptom is not planned when its root is refused, evidence-refused or not reported', () => {
  const ctx = { confirmed: ['G-1'], symptoms: { 'G-2': 'G-1' }, caseInsensitive: false };
  const notFixed = admitGroups({ ...ctx, groups: [G('G-1', ['src/a.js'], { disposition: 'not-fixed' }), G('G-2', ['src/b.js', 'tests/b.test.js'])] });
  assert.deepEqual(ids(notFixed), [], 'root reported not-fixed: the symptom was still planned');
  const g2 = notFixed.checks.find((c) => c.group === 'G-2');
  assert.equal(g2?.kind, 'shared-with-refused', JSON.stringify(notFixed.checks));
  assert.equal(g2.blocked_by, 'G-1');
  const evidence = { 'evidence/remediation/red.log': null };
  const evRefused = admitGroups({ ...ctx, evidence, groups: [G('G-1', ['src/a.js', 'tests/a.test.js'], { red_evidence: 'evidence/remediation/red.log', green_evidence: 'evidence/remediation/green.log' }),
    G('G-2', ['src/b.js'])] });
  assert.deepEqual(ids(evRefused), [], 'root evidence-refused: the symptom was still planned');
  const missing = admitGroups({ ...ctx, groups: [G('G-2', ['src/b.js', 'tests/b.test.js'])] });
  assert.deepEqual(ids(missing), [], 'root not reported: the symptom was still planned');
  assert.equal(missing.checks[0]?.kind, 'unconfirmed-group', JSON.stringify(missing.checks));
  assert.match(missing.checks[0].message, /G-1/, 'the refusal names the root it was not reported with');
  const both = admitGroups({ ...ctx, groups: [G('G-1', ['src/a.js', 'tests/a.test.js']), G('G-2', ['src/b.js', 'tests/b.test.js'])] });
  assert.deepEqual(ids(both), ['G-1', 'G-2'], 'root and symptom both fixed, in separate clusters: both planned');
});

// G-11: one lookup, no walk — in A -> B -> C with only C confirmed, A was refused as unconfirmed-group, and the refusal
// spread to C through any shared file. The chain is followed, with a visited set, to the confirmed root.
test('G-11: a symptom chain is followed to its confirmed root', () => {
  const symptoms = { 'G-3': 'G-2', 'G-2': 'G-1' };
  const r = admitGroups({ confirmed: ['G-1'], symptoms, caseInsensitive: false,
    groups: [G('G-1', ['src/a.js', 'tests/a.test.js'], { cluster: 'c1' }), G('G-3', ['tests/a.test.js'], { cluster: 'c1' })] });
  assert.deepEqual(ids(r), ['G-1', 'G-3'], JSON.stringify(r.checks));
  const deferred = admitGroups({ confirmed: ['G-1'], deferred: ['G-1'], symptoms, caseInsensitive: false, groups: [G('G-3', ['src/b.js'])] });
  assert.equal(deferred.checks[0]?.kind, 'deferred-group', 'a chain ending at a deferred root is deferred with it');
  const cycle = admitGroups({ confirmed: ['G-1'], symptoms: { 'G-3': 'G-2', 'G-2': 'G-3' }, caseInsensitive: false, groups: [G('G-3', ['src/b.js'])] });
  assert.equal(cycle.checks[0]?.kind, 'unconfirmed-group', 'a cycle reaches no confirmed root');
});

const contractRow = () => fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8').split('\n')
  .find((l) => l.startsWith('| `scripts/remediate.mjs`'));

// G-12 (MEDIUM): the row said `cluster` is null "for the first ten" while COMMIT_CHECK_KINDS holds eleven cluster-less
// kinds. The row names the boundary rather than a count, and its listing keeps the owner's order, so the boundary is true.
test('G-12: the contract row states which commit_check kinds carry no cluster without a count that can drift', () => {
  const row = contractRow();
  assert.doesNotMatch(row, /for the first (ten|eleven|\w+)\b/, 'the row still counts the cluster-less kinds');
  assert.match(row, /`cluster` is null for every kind listed before `merged`/);
  const kinds = Object.keys(COMMIT_CHECK_KINDS);
  const listing = row.slice(row.indexOf('naming what it would not or could not commit'));
  const at = kinds.map((k) => listing.indexOf(`\`${k}\``));
  assert.ok(at.every((i) => i >= 0), 'every kind is listed');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the listing follows COMMIT_CHECK_KINDS order');
  const m = kinds.indexOf('merged');
  assert.ok(kinds.every((k, i) => COMMIT_CHECK_KINDS[k].cluster === (i >= m)), 'every kind before merged is cluster-less, and none after');
});

// G-13 (and G-1, its rendered copy): the stamp table still said any group not confirmed is refused, with no clause for a
// symptom judged as its root.
test('G-13: the COMMIT-CHECK stamp row and its consequence name the symptom exception', () => {
  const stampRow = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8').split('\n')
    .find((l) => l.startsWith('| `COMMIT-CHECK`'));
  assert.match(stampRow, /`unconfirmed-group`[^|]*symptom[^|]*root/);
  const consequence = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'stamp-consequences.json'), 'utf8'))['COMMIT-CHECK'];
  assert.match(consequence, /unconfirmed-group[^.;]*symptom[^.;]*root/);
  assert.match(contractRow(), /`unconfirmed-group` \([^)]*committed only with/, 'the contract row says a symptom commits only with its root');
});
