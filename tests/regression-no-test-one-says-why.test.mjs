// G-7 (and its doc-side symptom G-17) of 20261013-220031-rv-delivery: the evidence gate admits only `test_one` reds and
// greens, yet the contract reference and the remediation node's brief told a project with no `commands.test_one` to
// check a fix with the full suite, red then green — evidence the gate then refused, so every test-expressible fix in such
// a project was made and never committed. The plan's decision stands (remediation-verification.plan.md stages 5 and 8:
// without the key, only groups declared not expressible as a test commit, "and the commit check says why (the gate names
// an empty test_one)"); what was wrong is that the node was told otherwise and the refusal did not name the key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { evidenceRefusal } from '../scripts/lib/remediation-chain.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const RED = { admitted: 'test', file: null, exit: 1, timed_out: false, captured: '2026-10-13T10:00:00.000Z' };
const GREEN = { ...RED, exit: 0, captured: '2026-10-13T10:05:00.000Z' };
const G = { group_id: 'G-1', disposition: 'fixed', files: ['scripts/a.mjs', 'tests/a.test.mjs'],
  red_evidence: 'evidence/remediation/red.log', green_evidence: 'evidence/remediation/green.log' };
const EV = { 'evidence/remediation/red.log': RED, 'evidence/remediation/green.log': GREEN };
const C = (testOne) => ({ commands: { test: 'node tests/run-all.mjs', test_one: testOne }, source_globs: ['scripts/**'], test_globs: ['tests/**'] });

test('with no commands.test_one declared, a full-suite red is refused and the refusal names the empty key', () => {
  const why = evidenceRefusal(G, EV, C(''), { caseInsensitive: false });
  assert.ok(why);
  assert.match(why, /not a test_one capture/);
  assert.match(why, /declares no commands\.test_one/);
});

test('with commands.test_one declared, a full-suite red is refused without blaming the key', () => {
  const why = evidenceRefusal(G, EV, C('node --test {file}'), { caseInsensitive: false });
  assert.match(why, /not a test_one capture/);
  assert.doesNotMatch(why, /declares no commands\.test_one/);
});

test('nothing tells a node with no test_one that full-suite captures are its red and green', () => {
  const brief = read('scripts/remediate.mjs');
  assert.doesNotMatch(brief, /your red and green are captures of the full test command/);
  assert.match(brief, /test_one: none declared[\s\S]{0,300}not expressible as a test/);
  assert.doesNotMatch(read('shared/claude-md-contract.md'), /checks a fix with the full suite, red then green/);
  assert.doesNotMatch(read('prompts/remediation/PROMPT.md'), /only when it says none is declared do you capture the full test command/);
});
