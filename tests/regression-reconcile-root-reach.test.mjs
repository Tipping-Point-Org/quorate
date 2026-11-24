// G-14 of 20261121-233915-m3s7-b2-review: checkRootLinks accepted any root_cause_group the same rows judged, so a
// symptom naming itself, a dropped group, or another symptom in a cycle passed, its chain reached no confirmed root,
// and the runner later refused it as unconfirmed. Each such link is now cleared and named, and the symptom confirmed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRootLinks } from '../scripts/lib/reconcile-batches.mjs';
import { symptomRoot } from '../scripts/lib/remediation-chain.mjs';

const row = (group_id, decision, root_cause_group = '') => ({ group_id, decision, root_cause_group, rationale: 'r' });

/** Every symptom the rows leave is remediable: its chain reaches a confirmed group. */
function everySymptomHasARoot(rows) {
  const confirmed = rows.filter((r) => r.decision === 'confirmed').map((r) => r.group_id);
  const symptoms = Object.fromEntries(rows.filter((r) => r.decision === 'symptom').map((r) => [r.group_id, r.root_cause_group]));
  for (const id of Object.keys(symptoms)) assert.ok(symptomRoot(id, { confirmed, symptoms }), `${id} reaches no confirmed root`);
}

test('G-14: a symptom that names itself is cleared and confirmed', () => {
  const { rows, cleared, orphaned } = checkRootLinks([row('G-1', 'symptom', 'G-1')]);
  assert.deepEqual(cleared, [{ from: 'G-1', to: 'G-1' }]);
  assert.deepEqual(orphaned, ['G-1']);
  everySymptomHasARoot(rows);
});

test('G-14: a symptom whose root was dropped is cleared and confirmed', () => {
  const { rows, cleared, orphaned } = checkRootLinks([row('G-1', 'dropped'), row('G-2', 'symptom', 'G-1')]);
  assert.deepEqual(cleared, [{ from: 'G-2', to: 'G-1' }]);
  assert.deepEqual(orphaned, ['G-2']);
  assert.equal(rows[0].decision, 'dropped', 'the dropped group stays dropped');
  everySymptomHasARoot(rows);
});

test('G-14: a symptom cycle is broken at its first member, and the rest reach it', () => {
  const { rows, cleared, orphaned } = checkRootLinks([
    row('G-0', 'symptom', 'G-1'), row('G-1', 'symptom', 'G-2'), row('G-2', 'symptom', 'G-1'),
  ]);
  assert.deepEqual(cleared, [{ from: 'G-1', to: 'G-2' }]);
  assert.deepEqual(orphaned, ['G-1']);
  everySymptomHasARoot(rows);
});

test('G-14: a chain of symptoms ending at a confirmed root is left alone', () => {
  const input = [row('G-1', 'confirmed'), row('G-2', 'symptom', 'G-1'), row('G-3', 'symptom', 'G-2')];
  const { rows, cleared, orphaned } = checkRootLinks(input);
  assert.deepEqual(cleared, []);
  assert.deepEqual(orphaned, []);
  assert.deepEqual(rows, input);
});
