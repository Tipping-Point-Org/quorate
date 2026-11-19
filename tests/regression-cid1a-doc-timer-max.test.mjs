// G-19 of 20261022-013653-cid1a-delivery: the contract still said CHECK_TIMEOUT_MAX_MINUTES was "about 150 billion" (its
// old MAX_SAFE_INTEGER bound) after the code moved it to the timer maximum, 35,791, so an operator following the document
// was refused at mint.
//
// G-16 of 20261022-034225-cid1a-remediation-2-review: the fix for that copied the maximum, by name and number, into
// hand-written prose beside the generated minutes table, which already owns it — a second copy a later change can leave
// stale. The maximum is stated once, in the generated region; the prose points at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { TIMER_MAX_MINUTES } from '../scripts/lib/check-timeout.mjs';

test('the contract states the minutes maximum only in the generated table', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared/claude-md-contract.md'), 'utf8');
  const open = doc.indexOf('<!-- rule:minutes-table -->');
  const close = doc.indexOf('<!-- /rule:minutes-table -->');
  assert.ok(open >= 0 && close > open, 'the generated minutes table is missing');
  assert.match(doc.slice(open, close), new RegExp(`\\| ${TIMER_MAX_MINUTES} \\|`), 'the table does not state the maximum');
  const outside = doc.slice(0, open) + doc.slice(close);
  const copies = new RegExp(`${TIMER_MAX_MINUTES}|${TIMER_MAX_MINUTES.toLocaleString('en-US')}|CHECK_TIMEOUT_MAX_MINUTES|billion`);
  const lines = outside.split('\n').filter((l) => copies.test(l));
  assert.deepEqual(lines, [], 'a hand-written copy of the maximum');
});
