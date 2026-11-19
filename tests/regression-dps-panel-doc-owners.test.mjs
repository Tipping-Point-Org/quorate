// G-12 of 20261110-001436-dps-remediation-review (G-16, G-17, G-18 its symptoms): the decision panel's quorum is owned by
// QUORUM in scripts/lib/decision-panel.mjs, and four documents restated it as the literal "fewer than two seats", so a
// change of QUORUM would leave each of them contradicting what the code does. Each now names the owner instead.
//
// G-15 of the same review: shared/external-reviewers.md named only a link and evidence outside the repository as what a
// node-runtime seat's copies refuse, while scripts/io/seat-copies.mjs also refuses a file over its size bounds and a file
// git does not track that holds a credential's shape, so a reader could believe a seat saw context it was denied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\s+/g, ' ');

for (const rel of ['shared/claude-md-contract.md', 'shared/external-reviewers.md', 'shared/session-rules.md', 'shared/telemetry.md']) {
  test(`${rel} names the panel's quorum by its owner, not as a number of its own`, () => {
    const text = read(rel);
    assert.doesNotMatch(text, /fewer than (two|2) (of its )?seats/i, `${rel} restates the quorum as a literal`);
    assert.match(text, /`QUORUM`/, `${rel} does not name QUORUM, the quorum's owner`);
  });
}

// G-3 and G-10 of 20261110-010058-dps-remediation-2-review: a comment in scripts/io/decision-run.mjs still said "fewer
// than two seats", and shared/external-reviewers.md, right after naming the owner, restated its value as "one voice is
// not a majority". Either goes stale when QUORUM changes.
test('scripts/io/decision-run.mjs does not restate the quorum as a literal', () => {
  assert.doesNotMatch(read('scripts/io/decision-run.mjs'), /fewer than (two|2) (of its )?seats/i);
});
test('shared/external-reviewers.md does not restate the quorum\'s value after naming its owner', () => {
  assert.doesNotMatch(read('shared/external-reviewers.md'), /one voice is not a majority/i);
});

test('shared/external-reviewers.md names every refusal of a seat copy', () => {
  const text = read('shared/external-reviewers.md');
  assert.match(text, /over (its|the) size bound/i, 'the size bounds a seat copy is refused over are not named');
  assert.match(text, /git does not track[^.]*credential/i, 'the credential screen of files git does not track is not named');
});
