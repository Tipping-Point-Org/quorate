// G-5 of 20261013-220031-rv-delivery: the runner's full check refused an unreadable test count before it looked at the
// exit code, so a project whose runner prints no format countTests knows (Jest, Vitest, Mocha) could commit no fix even
// with its suite passing. The plan was amended the same day (operator: "Accept, record uncounted (Recommended)"): a
// `test` that EXITS 0 with no readable count commits, recorded as uncounted, as a review's pre-flight records
// TESTS-UNCOUNTED; "no readable count" refuses only a non-zero exit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fullCheckVerdict } from '../scripts/lib/full-check.mjs';

const RAN = (o) => ({ exit_code: 0, timed_out: false, tests: 30, failing: 0, failing_names: [], evidence_path: 'evidence/remediation-runner/t.log', ...o });

test('a test that exits 0 with no readable count commits, and the verdict records it as uncounted', () => {
  const v = fullCheckVerdict({ declared: ['test'], ran: { test: RAN({ tests: null, failing: null }) } });
  assert.equal(v.commit, true, JSON.stringify(v));
  assert.deepEqual(v.refusals, []);
  assert.equal(v.stamps.length, 1);
  assert.equal(v.stamps[0].key, 'test');
  assert.match(v.stamps[0].why, /uncounted/);
});

test('a non-zero exit with no readable count still refuses, naming the unreadable count', () => {
  const v = fullCheckVerdict({ declared: ['test'], ran: { test: RAN({ exit_code: 1, tests: null, failing: null }) } });
  assert.equal(v.commit, false);
  assert.match(v.refusals[0].why, /no readable test count/);
});

test('a counted, passing test records nothing', () => {
  const v = fullCheckVerdict({ declared: ['test'], ran: { test: RAN() } });
  assert.equal(v.commit, true);
  assert.deepEqual(v.stamps, []);
});
