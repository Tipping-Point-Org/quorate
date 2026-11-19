// A RETRY COMMITS ONLY THE GROUPS IT RECORDED (G-4 of 20261015-025724-symptom-remediation-2-review). --retry-commits
// re-planned a cluster through the evidence gate, which drops a group whose captures no longer admit it, and then compared
// the re-plan with the record by accepted PATHS alone. A symptom sharing every file with its root left the paths
// unchanged, so the cluster was committed with the edits of a group that had just failed its gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { planClusterCommits, retryMismatch } from '../scripts/lib/remediation-chain.mjs';

const CONTRACT = { source_globs: ['src/**'], test_globs: ['tests/**'] };
const FILES = ['src/a.js', 'tests/a.test.js'];
// The root shows its red and green, real test_one captures this run holds: a fix with a test must (two-ledger-mediums AC1).
const ROOT = { group_id: 'G-1', disposition: 'fixed', cluster: 'c1', files: FILES, red_evidence: 'root-red.log', green_evidence: 'root-green.log' };
const ROOT_EVIDENCE = {
  'root-red.log': { admitted: 'test_one', file: 'tests/a.test.js', exit: 1, timed_out: false, captured: '2026-10-19T10:00:00.000Z' },
  'root-green.log': { admitted: 'test_one', file: 'tests/a.test.js', exit: 0, timed_out: false, captured: '2026-10-19T10:05:00.000Z' },
};
// The symptom cites captures this run does not hold, so the evidence gate refuses it on the re-read.
const SYMPTOM = { group_id: 'G-2', disposition: 'fixed', cluster: 'c1', files: FILES, red_evidence: 'red.log', green_evidence: 'green.log' };
const RECORDED = { id: 'c1', groups: ['G-1', 'G-2'], accepted: FILES };

test('G-4: a re-plan that lost a group to the evidence gate is refused even when its paths are unchanged', () => {
  const planned = planClusterCommits({ groups: [ROOT, SYMPTOM], status: { files: FILES, refused: [] }, contract: CONTRACT,
    evidence: ROOT_EVIDENCE, confirmed: ['G-1'], symptoms: { 'G-2': 'G-1' }, caseInsensitive: false });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].committable, true, 'the root alone still plans as committable');
  assert.deepEqual([...planned[0].accepted].sort(), [...FILES].sort(), 'the paths are the recorded ones');
  assert.deepEqual(planned[0].groups, ['G-1'], 'the symptom was dropped by the gate');
  const why = retryMismatch(planned[0], RECORDED);
  assert.ok(why, 'the paths matched, and the cluster would have been committed without G-2\'s gate');
  assert.match(why, /G-2/);
  assert.equal(retryMismatch({ ...planned[0], groups: ['G-2', 'G-1'] }, RECORDED), null, 'the same groups and paths may be retried');
  assert.match(retryMismatch({ ...planned[0], groups: ['G-1', 'G-2'], accepted: ['src/a.js'] }, RECORDED), /accepts src\/a\.js/);
});

test('G-4: the runner admits a retried cluster only through retryMismatch, never by comparing paths alone', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  assert.match(src, /\bretryMismatch\b[^;]*from '\.\/lib\/remediation-chain\.mjs'|import \{[^}]*\bretryMismatch\b[^}]*\} from '[^']*remediation-chain\.mjs'/);
  assert.doesNotMatch(src, /same\(p\.accepted/, 'a path-only comparison is still an admission check');
  const uses = src.match(/retryMismatch\(p, c\)/g) ?? [];
  assert.ok(uses.length >= 2, `the candidate and the commit loop must both ask it (found ${uses.length})`);
});

// G-9 of 20261015-031932-symptom-remediation-3-review: the owning document still said a re-plan is admitted on its
// recorded `accepted` files alone, so a retry refused for a lost group, with its paths unchanged, was unexplained.
test('G-9: the owning document states that a retry re-plan must hold the recorded groups as well as the recorded files', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs` |'));
  assert.ok(row, 'the remediate.mjs row of the owning document');
  const retry = row.slice(row.indexOf('`--retry-commits`, on a run already run'));
  const rule = retry.slice(0, retry.indexOf('else the cluster is `refused-cluster`'));
  assert.ok(rule.length > 0, 'the retry admission sentence');
  assert.match(rule, /recorded `groups`/, 'the re-plan is compared with the recorded groups too');
  assert.match(rule, /recorded `accepted` files/);
  assert.match(rule, /retryMismatch/, 'the rule names its one owner');
});
