// G-6 of 20261110-022503-dps-remediation-4-review: shared/external-reviewers.md lists "every other path a copy refuses",
// and remediation 4 added two refusals it did not name: an untracked file that is not UTF-8 text or holds a NUL (isText,
// now textOf, in scripts/io/seat-copies.mjs) and a path whose name holds a line break (seatCopyPaths in scripts/lib/decision-panel.mjs).
// A reader trusting the list expected a binary evidence file, or a newline name, to reach the seat. Each refusal the code
// makes is held to a phrase in the owning sentence, and each phrase to the code that refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G-6: the doc\'s list of refused seat-copy paths names every refusal the copy makes', () => {
  const doc = read('shared/external-reviewers.md').replace(/\s+/g, ' ');
  const at = doc.indexOf('every other path a copy refuses');
  assert.ok(at >= 0, 'the owning sentence is gone');
  const list = doc.slice(at, doc.indexOf('the seat never sees it', at));
  const copies = read('scripts/io/seat-copies.mjs');
  const panel = read('scripts/lib/decision-panel.mjs');
  const cases = [
    ['a link or junction', /link or junction/, copies.includes("e.refusal === 'link'")],
    ['the size bounds', /SEAT_COPY_MAX_FILE_BYTES/, copies.includes('maxFileBytes')],
    ['an untracked file that is not text', /not UTF-8 text|holds a NUL/, copies.includes('function textOf(')],
    ['a credential-shaped untracked file', /credential/, copies.includes('SECRET_PATTERNS')],
    ['a name holding a line break', /line break/, /\[\\r\\n\]\/\.test\(s\)\) \{ refused\.push/.test(panel)],
  ];
  for (const [what, phrase, inCode] of cases) {
    assert.ok(inCode, `the code no longer makes the refusal of ${what}; update this test with the doc`);
    assert.match(list, phrase, `the doc's list of refused seat-copy paths does not name ${what}`);
  }
});
