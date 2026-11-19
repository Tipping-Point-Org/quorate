// The node runtime's seams carry no vendor's name (G-3, with its symptom G-1, of 20261103-005954-rbr-remediation-7-review;
// ARCHITECTURE.md A-9: "a vendor name appearing in code, in a variable, or in a message is a defect even when the value is
// correct"). The G-13 rename of the round before left claudeSessionEnv (the node runtime's session environment) and
// claudeAnswered (whether its envelope is an answer) in bench-second-opinion.mjs and every other caller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('G-3: no script names the runtime session environment or answer check after a vendor', () => {
  const hits = [];
  for (const f of walk(path.join(ROOT, 'scripts'))) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => { if (/\bclaude(SessionEnv|Answered)\b/.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`); });
  }
  assert.deepEqual(hits, [], `vendor-named seams remain: ${hits.join(', ')}`);
});

test('G-3: the renamed seams are exported under their runtime names', async () => {
  const decisions = await import('../scripts/lib/decisions.mjs');
  const callEntry = await import('../scripts/lib/call-entry.mjs');
  assert.equal(typeof decisions.runtimeSessionEnv, 'function', 'decisions.mjs exports no runtimeSessionEnv');
  assert.equal(typeof callEntry.runtimeAnswered, 'function', 'call-entry.mjs exports no runtimeAnswered');
  // Given the runtime, whose adapter names the envelope fields (G-7 of 20261103-022403-rbr-remediation-8-review).
  const { builtinReviewers } = await import('../scripts/io/reviewers.mjs');
  const rt = builtinReviewers().claude;
  assert.equal(callEntry.runtimeAnswered('{"is_error":false,"subtype":"success"}', rt), true);
  assert.equal(callEntry.runtimeAnswered('not json', rt), false);
});
