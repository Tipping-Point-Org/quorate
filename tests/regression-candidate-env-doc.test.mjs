// G-13 of 20261014-000825-rv-delivery-remediation-2-review: shared/remediation.md said the candidate check's environment
// "drops every secret-shaped name, as the commit's does", while the commit's keeps the SSH agent socket and the scoped
// git config; claude-md-contract.md restated the rule a second time, through commitEnvFor. remediation.md owns it now,
// states what the candidate check drops that the commit keeps, and the contract row points there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rem = readFileSync(new URL('../shared/remediation.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
const contract = readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');

test('remediation.md does not equate the candidate check environment with the commit\'s', () => {
  assert.doesNotMatch(rem, /as the commit's does/);
  assert.match(rem, /`candidateEnvFor`/);
  // candidate-check-boundaries stage 6: the allow-list never admits what the commit keeps for git's sake.
  assert.match(rem, /never admits the SSH agent socket or any `GIT_CONFIG_\*` name/);
});

test('the contract row points at the owner rather than restating the candidate policy through commitEnvFor', () => {
  assert.doesNotMatch(contract, /candidateCheckEnv`, through the commit environment's owner/);
  // candidate-check-boundaries stage 6: the row points at the key's entry, the one owner of what crosses.
  assert.match(contract, /`candidateCheckEnv`; an allow-list, and what crosses is the `review\.candidate_env` entry's/);
});
