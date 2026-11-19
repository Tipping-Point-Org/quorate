// .claude/requests/two-ledger-mediums.md, AC1 (operator, 2026-10-19: "The two MEDIUMs first, then item 3 (Recommended)").
// planClusterCommits read a group with no red_evidence as "not expressible as a test" and committed any cluster holding a
// test file (`hasTest || notExpressible`), so a fix whose red step was skipped committed: remediation
// 20261019-031140-review committed seven groups that way, their red shown afterwards by hand. A cluster with a test file
// now commits only when every group in it carries a red capture; not expressible stays a cluster with no test file,
// declared in `no_red` (remediation-evidence-rules.plan.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { planClusterCommits } from '../scripts/lib/remediation-chain.mjs';

const CONTRACT = { source_globs: ['src/**'], test_globs: ['tests/**'] };
const plan = (groups, files) => planClusterCommits({ caseInsensitive: false, groups, status: { files, refused: [] },
  dirtyAtStart: [], contract: CONTRACT, severityOf: () => 'MEDIUM' });
const fixed = (group_id, files, red) => ({ group_id, disposition: 'fixed', cluster: 'c1', files, red_evidence: red });

test('AC1: a cluster with a test file and a group with no red capture is not committed, and the group is named', () => {
  const [c] = plan([fixed('G-1', ['src/a.js', 'tests/a.test.js'], 'red.log'), fixed('G-2', ['src/a.js', 'tests/a.test.js'], '')],
    ['src/a.js', 'tests/a.test.js']);
  assert.equal(c.committable, false, 'a fix with a test and no red was committable');
  assert.ok(c.notes.some((n) => /G-2/.test(n) && /red-before-green skipped/.test(n)), JSON.stringify(c.notes));
});

test('AC1: every group with a red capture still commits', () => {
  const [c] = plan([fixed('G-1', ['src/a.js', 'tests/a.test.js'], 'red.log')], ['src/a.js', 'tests/a.test.js']);
  assert.equal(c.committable, true, JSON.stringify(c.notes));
});

// G-7 and G-8 of 20261019-211650-two-mediums-review: the contract row and the remediate skill still said a red-less group
// passes as not expressible, with no word of the cluster, after the code above began refusing it beside a test file.
test('AC1: the contract and the remediate skill state when a red-less group may commit beside a test', () => {
  const flat = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\s+/g, ' ');
  const contract = flat('shared/claude-md-contract.md');
  const skill = flat('skills/remediate/SKILL.md');
  assert.doesNotMatch(contract, /a group with no red declared its claim not expressible as a test and passes as before/,
    'the contract still says a red-less group passes, whatever its cluster holds');
  assert.doesNotMatch(skill, /unless the node reported the claim not expressible as one/,
    'the skill still promises an exception the runner refuses');
  assert.doesNotMatch(skill, /a claim declared not expressible as a test needs no red\)/,
    'the skill still says a not-expressible claim needs no red, with no word of the cluster');
  // Since remediation-evidence-rules.plan.md stage 2 (design E-D2 A) a red-less group commits beside a test only when it
  // DECLARES why no test can fail first (`no_red`); an undeclared one is still a skipped red. Both documents say so.
  for (const [name, text] of [['contract', contract], ['skill', skill]]) {
    assert.match(text, /`no_red`/, `the ${name} does not state the no_red declaration`);
  }
  assert.match(contract, /no `no_red` declaration[^.]*red-before-green skipped/, 'the contract does not say an undeclared red-less group is a skipped red');
});

// G-4 of 20261019-214353-review-review: a group with no red passes evidenceRefusal, and its cluster is refused by
// planClusterCommits, which remediate.mjs records as `refused-cluster`. The contract documented the refusal inside the
// `evidence-refused` definition, and disk-first-protocol §7 implied the same, so a consumer filtering commit_check on
// `evidence-refused` would miss it.
test('G-4: the skipped-red refusal is documented under refused-cluster, the kind the runner records', () => {
  const flat = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\s+/g, ' ');
  const contract = flat('shared/claude-md-contract.md');
  const evidenceDef = contract.slice(contract.indexOf('`evidence-refused` ('), contract.indexOf('`shared-with-refused` ('));
  assert.ok(evidenceDef.length > 0, 'the evidence-refused definition was not found');
  assert.doesNotMatch(evidenceDef, /red-before-green skipped/, 'the skipped-red refusal is still documented as evidence-refused');
  const clusterAt = contract.indexOf('`refused-cluster` (');
  assert.ok(clusterAt >= 0, 'refused-cluster has no definition in the commit_check vocabulary');
  const clusterDef = contract.slice(clusterAt, contract.indexOf('`committed-without-test`', clusterAt));
  assert.match(clusterDef, /red-before-green skipped/, 'refused-cluster does not name the skipped-red refusal');
  const rows = fs.readFileSync(path.join(REPO_ROOT, 'shared/disk-first-protocol.md'), 'utf8').split('\n');
  const commitRow = rows.find((l) => l.startsWith('| `COMMIT-CHECK` |'));
  const reportRow = rows.find((l) => l.startsWith('| `REPORT-CHECK` |'));
  assert.match(commitRow, /red-before-green skipped[^|]*`refused-cluster`/, 'the COMMIT-CHECK row does not name the skipped-red refusal as refused-cluster');
  assert.doesNotMatch(reportRow, /missing or not a red-before-green pair also refuses the group at admission \(`evidence-refused`/,
    'the REPORT-CHECK row still files a missing red under evidence-refused');
});

// G-1 of 20261023-062611-rer-remediation-review-2: with no test file, an empty red commits only when it is DECLARED
// (`no_red`); an undeclared one is a skipped red there too (shared/remediation.md, What a fix must show).
test('AC1: a claim declared to have no possible red stays committable with no test file; an undeclared one does not', () => {
  const [c] = plan([{ ...fixed('G-1', ['src/a.js'], ''), no_red: 'a comment no test can observe' }], ['src/a.js']);
  assert.equal(c.committable, true, JSON.stringify(c.notes));
  assert.ok(c.notes.some((n) => /committed without a test/.test(n)));
  const [u] = plan([fixed('G-1', ['src/a.js'], '')], ['src/a.js']);
  assert.equal(u.committable, false, JSON.stringify(u.notes));
  assert.ok(u.notes.some((n) => /red-before-green skipped: G-1/.test(n)));
});
