// entrypoint-argv.plan.md stage 2: the depth guard's parse has one owner, scripts/lib/node-depth.mjs. Thirteen entry
// scripts carried the same expression, copied; the case table pins the rule they applied, and the scan keeps a fourteenth
// copy from appearing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { nodeDepth } from '../scripts/lib/node-depth.mjs';

test('nodeDepth: absent is 0; anything but plain decimal digits is unreadable', () => {
  const rows = [
    [undefined, 0], ['0', 0], ['1', 1], ['12', 12],
    ['', null], ['  ', null], ['-1', null], ['1.5', null], ['abc', null], ['NaN', null], ['Infinity', null],
    // G-9 of 20261020-151402-argv-delivery: the plan's stage 2 fails these closed, where the copies' Number() read 1.
    [' 1', null], ['1 ', null], ['\t1', null], ['1.0', null], ['0x1', null], ['1e0', null], ['+1', null], ['0b1', null],
  ];
  for (const [raw, want] of rows) {
    const env = raw === undefined ? {} : { GRAPH_NODE_DEPTH: raw };
    assert.equal(nodeDepth(env).depth, want, `GRAPH_NODE_DEPTH=${JSON.stringify(raw)}`);
    assert.equal(nodeDepth(env).raw, raw);
  }
});

test('no entry script or io module reads GRAPH_NODE_DEPTH except through nodeDepth', () => {
  const dirs = [path.join(REPO_ROOT, 'scripts'), path.join(REPO_ROOT, 'scripts', 'io')];
  const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.mjs')).map((f) => path.join(d, f)));
  const offenders = files.filter((f) => /process\.env\.GRAPH_NODE_DEPTH|process\.env\[['"]GRAPH_NODE_DEPTH['"]\]/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(REPO_ROOT, f)), [], 'a script parses the depth itself');
  // The thirteen readers of 2026-10-20 BY NAME (the plan's stage 2 grep), so one dropping its guard fails even when another
  // file adds a call; a count let that through (G-18 of 20261020-151402-argv-delivery). A new reader may join; none may leave.
  const READERS = ['bench-lenses', 'bench-second-opinion', 'check-intent-grant', 'check-reviewers', 'claim-check',
    'external-review', 'new-run', 'preflight', 'remediate', 'run-checks', 'run-graph', 'spawn-node', 'spawn-subagent']
    .map((n) => path.join('scripts', `${n}.mjs`));
  const callers = files.filter((f) => /nodeDepth\(process\.env\)/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(REPO_ROOT, f));
  assert.deepEqual(READERS.filter((r) => !callers.includes(r)), [], 'a depth reader no longer calls nodeDepth(process.env)');
});
