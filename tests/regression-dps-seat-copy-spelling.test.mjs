// G-8 (and its symptom G-2) and G-7 of 20261110-014035-dps-remediation-3-review, in what a node-runtime seat is copied.
//   G-8  seatCopyPaths trimmed every path before choosing what to copy, while decide.mjs reads git's lists untrimmed and the
//        work context names each file in its own spelling: a tracked `config ` was named to the seat and copied as
//        `config`, so the named file was absent and an ignored sibling `config` could ride in in its place (G-2).
//   G-7  codeSpan shows a line break in a name as a space, while seatCopyPaths copied the name with its line break: the seat
//        was told a path it could not open. Such a name is now refused, named with why, and never copied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seatCopyPaths } from '../scripts/lib/decision-panel.mjs';

test('G-8: a path ending in whitespace is copied in the spelling the seat is sent, never trimmed', () => {
  const r = seatCopyPaths({ files: ['config ', ' lead.txt'], evidence: [{ inRepo: true, rel: 'notes.md\t' }] });
  assert.deepEqual(r.copy, ['config ', ' lead.txt', 'notes.md\t'], 'a trimmed spelling names a different file than the seat was sent');
});

test('G-8: an empty or whitespace-only entry is still not a path', () => {
  const r = seatCopyPaths({ request: '', files: ['', '   ', 'a.js'] });
  assert.deepEqual(r.copy, ['a.js']);
});

test('G-7: a name holding a line break is refused with why, never copied under a name the seat cannot address', () => {
  const r = seatCopyPaths({ files: ['a\nb', 'ok.js', 'c\rd'] });
  assert.deepEqual(r.copy, ['ok.js'], 'a name shown to the seat with its line break as a space was copied with the break');
  assert.deepEqual(r.refused.map((x) => x.path), ['a\nb', 'c\rd']);
  assert.match(r.refused[0].why, /line break/);
});
