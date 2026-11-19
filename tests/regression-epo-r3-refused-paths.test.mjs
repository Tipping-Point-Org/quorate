// G-6 of 20261104-082659-epo-remediation-2-review: normalizeEvidenceFields kept only the FIRST refused evidence path of an
// item (find() and `??=`), so a group with a bad red and a bad green, or two bad paths in one field, named one and dropped
// the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvidenceFields } from '../scripts/lib/remediation-chain.mjs';

const RUN = 'F:/runs/r1';

test('every refused path of an item is named, across fields and within one', () => {
  const [g] = normalizeEvidenceFields([{
    group_id: 'G-1',
    red_evidence: 'evidence/remediation/../x.log; evidence/other/y.log',
    green_evidence: 'notes/z.log',
  }], ['red_evidence', 'green_evidence'], { runDir: RUN, caseInsensitive: true });
  const why = String(g.evidence_path_refused);
  assert.match(why, /x\.log/);
  assert.match(why, /y\.log/, 'the second refused path in red_evidence is named');
  assert.match(why, /green_evidence:.*z\.log/, 'the refused green is named');
});
