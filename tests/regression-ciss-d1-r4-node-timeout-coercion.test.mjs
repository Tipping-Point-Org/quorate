// regression-ciss-d1-r4-node-timeout-coercion.test.mjs — G-11 of review 20261021-194056-ciss-d1-remediation-3-review.
//
// run-graph read review.node_timeout_minutes (and the barrier and intent limits derived from it) through Number(), so
// YAML `true` became a one-minute limit on every lens, and `""` became 0. spawn-subagent's own check refused "" but took
// `true` as 1 too. Both now read the value through one helper, contractMinutes, which refuses alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../scripts/lib/check-timeout.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('G-11: contractMinutes takes a positive number or decimal string, the fallback when absent, and refuses the rest', () => {
  const { contractMinutes } = T;
  assert.equal(typeof contractMinutes, 'function', 'lib/check-timeout.mjs has no contractMinutes: each caller coerces the value its own way');
  // Absent: the registry's one default (30, code-index-d1-part-a.plan.md stage 1), whatever fallback a caller passes;
  // a caller's fallback serves only a key whose default is derived, as the barrier's is from the node limit.
  assert.equal(contractMinutes({}, 'node_timeout_minutes', 15), 30);
  assert.throws(() => contractMinutes({ node_timeout_minutes: null }, 'node_timeout_minutes'), /node_timeout_minutes/,
    'a key declared with no value is refused like "", as the check timeout owner always refused it');
  assert.equal(contractMinutes({}, 'barrier_timeout_minutes', 60), 60);
  assert.equal(contractMinutes({ node_timeout_minutes: 30 }, 'node_timeout_minutes', 15), 30);
  assert.equal(contractMinutes({ barrier_timeout_minutes: 0.5 }, 'barrier_timeout_minutes', 30), 0.5);
  assert.equal(contractMinutes({ node_timeout_minutes: '45' }, 'node_timeout_minutes', 15), 45);
  for (const bad of [true, false, '', ' ', '0x2', '1e1', 0, -1, Number.NaN, Infinity, [], {}, '30m']) {
    assert.throws(() => contractMinutes({ node_timeout_minutes: bad }, 'node_timeout_minutes', 15),
      /review\.node_timeout_minutes must be a positive number of minutes/, `accepted ${JSON.stringify(bad)}`);
  }
});

test('G-11: run-graph and spawn-subagent read every node, barrier and intent limit through contractMinutes', () => {
  const rg = read('scripts/run-graph.mjs');
  for (const key of ['node_timeout_minutes', 'barrier_timeout_minutes', 'intent_timeout_minutes']) {
    assert.doesNotMatch(rg, new RegExp(`Number\\(review\\.${key}`), `run-graph still coerces review.${key} with Number()`);
    assert.match(rg, new RegExp(`minutesOf\\('${key}'`), `run-graph does not read review.${key} through minutesOf`);
  }
  assert.match(rg, /const minutesOf = [^\n]*\n\s*try \{ return contractMinutes\(review, key, fallback\)/, 'run-graph\'s minutesOf does not call contractMinutes');
  const ss = read('scripts/spawn-subagent.mjs');
  assert.doesNotMatch(ss, /Number\(review\.node_timeout_minutes/, 'spawn-subagent still coerces review.node_timeout_minutes with Number()');
  assert.match(ss, /contractMinutes\(review, 'node_timeout_minutes'/);
});
