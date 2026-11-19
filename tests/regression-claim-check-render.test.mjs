// claim-check-cross-family.plan.md stage 5. checked.md is what the operator reads, so it says who checked the draft and
// in which family, whether the session transcript left the machine and to whom, and, per claim, which checker graded it
// and any kind the two checkers disagreed on. A check with no check.json says that how it ran is not recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChecked } from '../scripts/lib/claim-check.mjs';

const claim = (id, kind = 'behaviour') => ({
  id, text: `claim ${id}`, kind, verdict: 'stands', grade: 'inferred', search: { looked_for: 'x', where: [], found: 'nothing' },
  citations_resolved: [], counter_question: { question: 'q?', answer: '' }, notes: [],
});
const checked = (claims) => ({ ok: true, claims, not_checked: [],
  summary: { stands: claims.length, dissolved: 0, downgrade: 0, 'ask-operator': 0, inferred: claims.length } });

test('same-family is said, at the top', () => {
  const md = renderChecked(checked([claim('C1')]), { check: { panel: false, setting: 'same-family', family: 'same', arm: null,
    same_family: { via: 'spawn-subagent.mjs', runtime: 'node-rt' }, transcript: { sent: false, to: null }, graded_by: { C1: 'node-rt' }, kind_disagreements: [] } });
  assert.match(md, /same-family/);
  assert.match(md, /Checked by a node-rt subagent/, 'the same-family checker is not named by its runtime');
  assert.match(md, /## C1 [^\n]*checked by node-rt/);
});

test('cross-family names the reviewer and pin, and what of the transcript was sent to it', () => {
  const md = renderChecked(checked([claim('C1')]), { check: { panel: true, setting: 'cross-family', family: 'cross',
    arm: { reviewer: 'codex', model: 'm-x', effort: 'high' }, claude: null,
    transcript: { sent: true, to: 'codex', bytes: 1234, redactions: 2 }, graded_by: { C1: 'arm' }, kind_disagreements: [] } });
  assert.match(md, /codex \(m-x, high\)/);
  assert.match(md, /cross-family/);
  assert.match(md, /transcript[^\n]*sent to codex[^\n]*1234 bytes[^\n]*2 secret/i);
  assert.match(md, /## C1 [^\n]*checked by codex/);
});

test('the fallback names both checkers and every kind they disagreed on', () => {
  const md = renderChecked(checked([claim('C1', 'attribution'), claim('C2')]), { check: { panel: true, setting: 'same-family',
    family: 'cross', arm: { reviewer: 'codex', model: 'm-x', effort: 'high' },
    same_family: { via: 'spawn-subagent.mjs', runtime: 'node-rt', scope: 'attributions' },
    transcript: { sent: true, to: 'same-family' }, graded_by: { C1: 'node-rt', C2: 'arm' },
    kind_disagreements: [{ id: 'C1', arm: 'behaviour', same_family: 'attribution' }] } });
  assert.match(md, /attribution[^\n]*node-rt/i);
  assert.match(md, /not sent to codex/i);
  assert.match(md, /C1: codex said behaviour, node-rt said attribution/);
  assert.doesNotMatch(md, /Claude/, 'a vendor name is rendered where the runtime\'s should be (G-10)');
  assert.match(md, /## C1 [^\n]*checked by node-rt/);
  assert.match(md, /## C2 [^\n]*checked by codex/);
  assert.match(md, /C1[^\n]*behaviour[^\n]*attribution/);
});

test('no check.json: how the check ran is said to be unrecorded', () => {
  assert.match(renderChecked(checked([claim('C1')])), /not recorded/);
});
