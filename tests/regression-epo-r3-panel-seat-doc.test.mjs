// G-15 of 20261104-082659-epo-remediation-2-review: shared/external-reviewers.md named the decision panel's internal seat
// "a Claude subagent", while decide.mjs seats the configured node runtime (seatSpecs: the runtime first). Accurate only
// under the default runtime; the guide names the seat by what builds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');

test('the Deciding entry names the node runtime\'s seat, as decide.mjs builds it', () => {
  const doc = read('shared/external-reviewers.md');
  const at = doc.indexOf('- **Deciding**');
  assert.ok(at >= 0, 'no Deciding entry');
  const entry = doc.slice(at, doc.indexOf('\n- ', at + 1));
  assert.match(entry, /node runtime/, entry);
  assert.doesNotMatch(entry, /beside a Claude subagent at/, entry);
  assert.match(read('scripts/decide.mjs'), /\[runtime, \{ kind: 'runtime' \}\]/);
});
