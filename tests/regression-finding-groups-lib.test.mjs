// THE FINDING GROUPER IS A PURE DECISION IN lib/ (G-7 of 20261115-002137-pbr-remediation-2-review). The loop that groups
// findings by file and proximity sat at module scope in run-graph.mjs, needing no I/O yet testable only by loading the
// orchestrator, against ARCHITECTURE §2's boundary for pure decisions. It is groupFindings in lib/decisions.mjs now, and
// run-graph calls it; these tests pin its rule: same file within PROXIMITY_LINES of the anchor, the anchor being the
// first finding of a group, numbered in sorted order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const lib = await import('../scripts/lib/decisions.mjs');

test('lib/decisions.mjs exports the grouper, and run-graph uses it rather than its own loop', () => {
  assert.equal(typeof lib.groupFindings, 'function', 'groupFindings is a lib function');
  assert.equal(lib.PROXIMITY_LINES, 3);
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(src, /const groups = groupFindings\(findings\);/);
  assert.doesNotMatch(src, /const lastGroupInFile = new Map\(\);/, 'no second copy of the loop in the orchestrator');
});

test('findings in one file within three lines of the anchor share a group; further ones start a new one', () => {
  const f = (file, line, node_id) => ({ file, line, node_id });
  const groups = lib.groupFindings([f('a.mjs', 10, 'x'), f('a.mjs', 13, 'y'), f('a.mjs', 17, 'z'), f('b.mjs', 10, 'x')]);
  assert.deepEqual(groups.map((g) => [g.group_id, g.file, g.line, g.findings.length, [...g.nodes]]), [
    ['G-1', 'a.mjs', 10, 2, ['x', 'y']],
    ['G-2', 'a.mjs', 17, 1, ['z']],
    ['G-3', 'b.mjs', 10, 1, ['x']],
  ]);
});

test('the anchor stays the first finding: a chain of near findings does not drift past the reach', () => {
  const f = (line) => ({ file: 'a.mjs', line, node_id: 'n' });
  const groups = lib.groupFindings([f(1), f(4), f(5), f(8)]);
  // 4 is within 3 of 1; 5 is 4 past the anchor 1, so it anchors G-2; 8 is within 3 of 5.
  assert.deepEqual(groups.map((g) => [g.line, g.findings.map((x) => x.line)]), [[1, [1, 4]], [5, [5, 8]]]);
});

test('a missing or non-numeric line is line 0, and the input order does not change the groups', () => {
  const a = { file: 'a.mjs', line: 'x', node_id: 'p' };
  const b = { file: 'a.mjs', line: 2, node_id: 'q' };
  const c = { file: 'a.mjs', line: 40, node_id: 'r' };
  const one = lib.groupFindings([c, b, a]);
  const two = lib.groupFindings([a, b, c]);
  assert.deepEqual(one.map((g) => [g.line, g.findings.length]), [[0, 2], [40, 1]]);
  assert.deepEqual(two.map((g) => [g.line, g.findings.length]), one.map((g) => [g.line, g.findings.length]));
});
