// Review 20261019-033102-review-review, the documents of the cross-family claim checker:
//   G-7 (G-18 its symptom)  claude-md-contract.md and the claim-check skill promised the checker reads the arms' snapshot,
//        "never the repository itself". `--surface` sets its working directory and nothing more, and codex's read-only
//        sandbox bounds writes, not reads (shared/external-reviewers.md). The operator accepted that limit with the
//        snapshot ("narrows, not jails"), so the fix is the documents': the surface narrows what the checker is shown and
//        does not bound what it reads.
//   G-19 external-reviewers.md still named `claude` as the absent-key value of review.claim_check_transcript, a value now
//        refused at mint; absent means `same-family`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\s+/g, ' ');
const DOCS = ['shared/claude-md-contract.md', 'skills/claim-check/SKILL.md', 'shared/external-reviewers.md'];

for (const rel of DOCS) {
  test(`G-7: ${rel} does not promise the claim checker never reads the repository, and says the surface only narrows`, () => {
    const s = read(rel);
    assert.doesNotMatch(s, /never the repository itself/, 'the read boundary is promised, and nothing enforces it');
    assert.match(s, /narrows what (?:it|the checker|the reviewer) is shown/, 'what the surface does is not said');
    assert.match(s, /does not bound what it (?:can )?reads?/, 'what the surface does not do is not said');
  });
}

test('G-19: external-reviewers.md names same-family, not claude, as what an absent claim_check_transcript means', () => {
  const s = read('shared/external-reviewers.md');
  assert.doesNotMatch(s, /Under `claude`/, 'a value refused at mint is documented as the default');
  assert.match(s, /Under `same-family`, which is what an absent key means/);
});
