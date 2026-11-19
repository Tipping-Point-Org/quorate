// A SYMPTOM IS COMMITTED IN ITS ROOT'S CLUSTER (20261015-022849-symptom-remediation-review, the review of 24b95f70). The
// symptom-to-root link reached admission only: planning joined clusters by shared file alone, so a symptom in its own
// cluster was committed while its root's cluster was refused later; and the documents defined `shared-with-refused`
// without the symptom case the code emits it for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { planClusterCommits } from '../scripts/lib/remediation-chain.mjs';

const CONTRACT = { source_globs: ['src/**'], test_globs: ['tests/**'] };
// A fix with a test shows its red (two-ledger-mediums AC1); these tests are about clustering, not the red rule.
const G = (id, cluster, files) => ({ group_id: id, disposition: 'fixed', cluster, files, red_evidence: 'red.log', green_evidence: '' });
const ROOT = G('G-1', 'c1', ['src/a.js', 'tests/a.test.js']);
const SYMPTOM = G('G-2', 'c2', ['src/b.js', 'tests/b.test.js']);
const plan = (files) => planClusterCommits({ groups: [ROOT, SYMPTOM], status: { files, refused: [] }, contract: CONTRACT,
  confirmed: ['G-1'], symptoms: { 'G-2': 'G-1' }, caseInsensitive: false });

// G-4 (MEDIUM): with disjoint files and clusters, the root's cluster refused at planning (here a file git does not list)
// left the symptom's cluster committable on its own — the downstream-only commit admission exists to prevent.
test('G-4: a symptom and its root are planned as one cluster, refused together and committed together', () => {
  const refused = plan(['src/b.js', 'tests/a.test.js', 'tests/b.test.js']);
  assert.equal(refused.length, 1, `the symptom was planned apart from its root: ${JSON.stringify(refused)}`);
  assert.deepEqual([...refused[0].groups].sort(), ['G-1', 'G-2']);
  assert.equal(refused[0].committable, false, 'the root\'s refused file refuses the symptom with it');
  const ok = plan(['src/a.js', 'src/b.js', 'tests/a.test.js', 'tests/b.test.js']);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].committable, true);
  assert.deepEqual([...ok[0].merged_from].sort(), ['c1', 'c2'], 'recorded as merged, so the run names the join');
  // Without the reconciliation's links (a caller that has none), planning is by file alone, as before.
  const plain = planClusterCommits({ groups: [ROOT, SYMPTOM], status: { files: ['src/a.js', 'src/b.js', 'tests/a.test.js', 'tests/b.test.js'], refused: [] },
    contract: CONTRACT, caseInsensitive: false });
  assert.equal(plain.length, 2);
});

// THREE since --readmit-evidence (operator, 2026-11-03: "b"): a retry re-admitting the groups the evidence gate refused
// plans them as the first run does, so it is held to the same links.
test('G-4: every planner call in the runner passes the symptom links: the first run, the retry, and the re-admission', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  const calls = src.split('planClusterCommits({').slice(1).map((s) => s.slice(0, s.indexOf('});')));
  assert.equal(calls.length, 3);
  for (const c of calls) assert.match(c, /\bsymptoms\b/, c);
  for (const c of calls) assert.match(c, /\bconfirmed\b/, c);
});

// G-7 (and G-1, G-8, its copies): `shared-with-refused` was defined as sharing a file or cluster, but it is also the
// kind for a symptom whose root is refused.
test('G-7: every definition of shared-with-refused names the symptom of a refused root', () => {
  const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
  const contract = read('shared', 'claude-md-contract.md').split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`'));
  assert.match(contract, /`shared-with-refused` \([^)]*symptom[^)]*root/);
  const stamp = read('shared', 'disk-first-protocol.md').split('\n').find((l) => l.startsWith('| `COMMIT-CHECK`'));
  assert.match(stamp, /symptom[^(]*\(`shared-with-refused`\)/);
  const consequence = JSON.parse(read('prompts', '_templates', 'stamp-consequences.json'))['COMMIT-CHECK'];
  assert.match(consequence, /symptom[^(;]*\(shared-with-refused\)/);
});
