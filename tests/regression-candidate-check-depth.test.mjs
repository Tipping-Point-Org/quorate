// G-13 of 20261013-220031-rv-delivery: the remediation runner ran the commit candidate's declared checks — code the
// remediator wrote among it — in its own top-level environment, so that code ran at GRAPH_NODE_DEPTH 0 and new-run,
// run-graph or remediate would start for it: a node spawning further nodes, by way of the runner. The commit's own
// environment already forced depth 1 (remediate.mjs `commitEnv`); the candidate check now does too, through one pure
// owner. The rest of the environment is the plan's stated choice (remediation-verification.plan.md: "the project's own
// environment, less what a remediation capture strips"), the residual shared/remediation.md records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import * as fullCheck from '../scripts/lib/full-check.mjs';
// The platform context the runner supplies (candidate-check-boundaries.plan.md stage 2): an allow-list now.
const CTX = { basics: ['PATH', 'HOME'], declared: [], caseInsensitiveEnv: false };

test('the candidate check runs at depth 1 whatever the runner\'s depth, with the channel files it is given', () => {
  const { candidateCheckEnv } = fullCheck;
  assert.equal(typeof candidateCheckEnv, 'function', 'no owner decides the environment the candidate check runs in');
  for (const depth of [undefined, '0', '3']) {
    const src = { PATH: '/bin', ...(depth === undefined ? {} : { GRAPH_NODE_DEPTH: depth }) };
    const env = candidateCheckEnv(src, { QUORATE_COUNT_FILE: 'c.txt' }, CTX);
    assert.equal(env.GRAPH_NODE_DEPTH, '1', String(depth));
    assert.equal(env.QUORATE_COUNT_FILE, 'c.txt');
    assert.equal(env.PATH, '/bin');
  }
  assert.equal(candidateCheckEnv({}, {}, CTX).GRAPH_NODE_DEPTH, '1');
  assert.equal(candidateCheckEnv({}, { GRAPH_NODE_DEPTH: '0' }, CTX).GRAPH_NODE_DEPTH, '1', 'a channel cannot lower it');
});

test('remediate.mjs gives every declared check that environment, not only test', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  const at = src.indexOf('envOf:');
  assert.ok(at !== -1);
  const line = src.slice(at, src.indexOf('\n', at));
  assert.match(line, /candidateCheckEnv\(process\.env/);
  assert.doesNotMatch(line, /: undefined/, 'a check other than test ran in the runner\'s own environment');
});
