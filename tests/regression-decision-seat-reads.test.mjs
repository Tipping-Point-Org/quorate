// G-15 of 20261104-072059-epo-remediation-review: shared/external-reviewers.md told the operator that a decision seat,
// run in an empty directory, "cannot open" the evidence paths the question names, while the same document records that a
// codex process read files outside its working directory, staged runs included. The Deciding entry claimed a
// confidentiality boundary that does not exist; it now says what an empty directory bounds and what it does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const doc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'external-reviewers.md'), 'utf8');

test('G-15: the Deciding entry does not claim a seat cannot open the evidence paths it is given', () => {
  const at = doc.indexOf('**Deciding**');
  assert.ok(at >= 0, 'no Deciding entry');
  const entry = doc.slice(at, doc.indexOf('\n\n', at));
  assert.doesNotMatch(entry, /cannot open/, entry);
  // It says the opposite, plainly: a seat can read a path it is given, so what that path holds can leave the machine.
  assert.match(entry, /can (?:open|read)[^.]*path/, entry);
  assert.match(entry, /reads? outside its working directory|bounds writes, not reads/, entry);
});
