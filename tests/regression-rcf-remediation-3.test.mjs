// THE rcf-remediation-2 REVIEW'S STOP-FIELD AND INHERITED-REQUEST DOC FINDINGS (20261021-024001-rcf-remediation-2-review;
// the operator's work list: "continue").
//
// G-2   stopReasonChecks skipped every fixed and declined group, so a fixed group carrying stop_reason `blocked`, or a
//       declined one carrying `limit` with no limit_kind, drew no REPORT-CHECK line; the fields are null where they do
//       not apply (prompts/_templates/schema-fields.json). G-8, the contract's null-when-inapplicable promise, is its
//       documentation symptom.
// G-7   the contract said an inherited explicit request "must still exist"; new-run also refuses one whose bytes changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('G-2: a stop field set where it does not apply is named', async () => {
  const { stopReasonChecks } = await import('../scripts/lib/remediation-chain.mjs');
  const one = (o) => stopReasonChecks([{ group_id: 'G-1', ...o }], {}, {});
  assert.match(one({ disposition: 'fixed', stop_reason: 'blocked' }).join(), /G-1: fixed with stop_reason blocked/);
  assert.match(one({ disposition: 'declined', stop_reason: 'limit' }).join(), /G-1: declined with stop_reason limit/);
  assert.match(one({ disposition: 'fixed', limit_kind: 'turns' }).join(), /G-1: limit_kind turns without stop_reason limit/);
  assert.match(one({ disposition: 'declined', stop_cause: 'x' }).join(), /G-1: stop_cause without stop_reason blocked/);
  assert.match(one({ disposition: 'not-fixed', stop_reason: 'not-attempted', limit_kind: 'budget' }).join(),
    /G-1: limit_kind budget without stop_reason limit/);
  assert.match(one({ disposition: 'not-fixed', stop_reason: 'limit', limit_kind: 'turns', stop_cause: 'x' }).join(),
    /G-1: stop_cause without stop_reason blocked/);
  assert.deepEqual(one({ disposition: 'fixed', stop_reason: null, limit_kind: null, stop_cause: null }), []);
  assert.deepEqual(one({ disposition: 'not-fixed', stop_reason: 'blocked', limit_kind: null, stop_cause: 'denied' }), []);
});

test('G-2 / G-8: the contract names the inapplicable-field check', () => {
  const row = read('shared/claude-md-contract.md').split('\n').find((l) => l.startsWith('| `remediation/PROMPT.md`')) ?? '';
  assert.match(row, /a `fixed` or `declined` group with a `stop_reason`/, 'the payload row does not name the check');
});

test('G-7: the contract says an inherited request whose bytes changed is refused', () => {
  const c = read('shared/claude-md-contract.md');
  const para = c.slice(c.indexOf('**A run minted from another run inherits its request'));
  assert.match(para.slice(0, para.indexOf('\n\n')), /refused when its bytes no longer match/,
    'the contract does not say an edited inherited request is refused');
});
