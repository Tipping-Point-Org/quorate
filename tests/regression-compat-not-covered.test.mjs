// THE POLICY SAYS WHAT IT DOES NOT PROMISE (shared/compatibility.md, "Not covered"; m3-v1.plan.md stage 3, Q4 and Q8).
//
// A promise with no stated edge is read as wider than it is: a consumer parsing gate.md or the ledger would believe it
// stable because gate.json is. The plan names what the "Not covered" list must carry, and the README must link the
// policy (ROADMAP §M3 exit gate). Each is read from the documents here, so dropping one fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\r\n').join('\n');

const REQUIRED = [
  'Prompt wording', 'what the lenses find', 'Everything under `scripts/` that `QUORATE.md` does not document',
  '`gate.md`', '`reconciled.md`', "the run directory's layout", "findings ledger's format", 'telemetry records',
  'shared/unverified-claims.md',
  // claim-check's four limits, each itself (G-21 of 20261123-161216-m3s9-review), not only the link to their owner.
  'checks what is written down', 'its checker can miss a claim', 'a claim about who asked stands only on a transcript',
  'a command citation is re-runnable, not re-run',
];

// The items of the plan's list the section does not state. Whitespace is folded, so a limit wrapped across lines reads
// as one phrase.
function missingFromNotCovered(policy) {
  const at = policy.indexOf('\n## Not covered\n');
  if (at === -1) return ['the "Not covered" section'];
  const section = policy.slice(at).split(/\n## /)[1].replace(/\s+/g, ' ');
  return REQUIRED.filter((r) => !section.includes(r));
}

test('the Not covered list names every item the plan requires', () => {
  assert.deepEqual(missingFromNotCovered(read('shared/compatibility.md')), [], 'the Not covered list is missing these');
});

// G-21 of 20261123-161216-m3s9-review: m3-v1.plan.md requires the list to name claim-check's four limits, and the
// required list held only the link to their owner, so any limit could be deleted with the test green.
test('deleting any one of claim-check\'s four limits from the Not covered list is reported', () => {
  const policy = read('shared/compatibility.md').replace(/[ \t]*\n[ \t]*(?=[a-z`])/g, ' ');
  const limits = ['checks what is written down', 'its checker can miss a claim',
    'a claim about who asked stands only on a transcript', 'a command citation is re-runnable, not re-run'];
  for (const l of limits) {
    assert.ok(policy.includes(l), `the policy no longer states the limit "${l}"`);
    assert.notDeepEqual(missingFromNotCovered(policy.replace(l, 'X')), [], `the limit "${l}" can be deleted with the check green`);
  }
});

test('README links the compatibility policy', () => {
  assert.match(read('README.md'), /\]\(shared\/compatibility\.md\)/);
});
