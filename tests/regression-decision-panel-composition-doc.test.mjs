// G-14 of 20261104-072059-epo-remediation-review: shared/claude-md-contract.md said who sits on the decision panel is the
// roster's `decision_panel` entry, while decide.mjs seats the node runtime beside the roster's `decision_panel.seats`
// (seatSpecs: the runtime first, then each roster seat). The key's paragraph names both, as the code builds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');

test('G-14: the decision_panel key names the node runtime seat beside the roster\'s seats, as decide.mjs builds them', () => {
  const doc = read('shared/claude-md-contract.md');
  const at = doc.indexOf('**`decision_panel` —');
  assert.ok(at >= 0, 'no decision_panel paragraph');
  const para = doc.slice(at, doc.indexOf('\n\n', at));
  assert.doesNotMatch(para, /who\s+sits on the panel is the roster's `decision_panel` entry/, para);
  assert.match(para, /node runtime/, para);
  assert.match(para, /`decision_panel\.seats`/, para);
  // The code it describes still seats the runtime beside the roster's seats.
  assert.match(read('scripts/decide.mjs'), /new Map\(\[\[runtime, \{ kind: 'runtime' \}\], \.\.\.roster\.seats/);
});
