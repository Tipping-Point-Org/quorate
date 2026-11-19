// G-29 of 20261021-162807-ciss-d1-review: shared/claude-md-contract.md promises that for an unbenchmarked perf-audit "a
// §6 invariant is never capped, so an unbenchmarked run can still fail on one". The severity clamp kept that promise
// (spawn-node skips basis invariant), but the VERDICT ceiling did not: spawn-node raised the verdict to its floor and
// then capped it at the degraded ceiling (RISK) with no exemption, so a HIGH credential-exposure finding ended at RISK.
//
// The ceiling still binds every other finding; only the floor the invariant findings alone set survives it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as D from '../scripts/lib/decisions.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const F = (severity, basis) => ({ severity, basis });

test('G-29: a degraded ceiling caps every verdict except the floor a §6 invariant finding sets', () => {
  assert.equal(typeof D.capVerdictKeepingInvariants, 'function',
    'lib/decisions.mjs has no verdict cap that exempts §6 invariant findings; the ceiling is applied with no exemption');
  const cap = D.capVerdictKeepingInvariants;
  // An invariant HIGH under a RISK ceiling still FAILs: the promise on the contract page.
  assert.equal(cap('FAIL', 'RISK', [F('HIGH', 'invariant')]), 'FAIL');
  assert.equal(cap('FAIL', 'RISK', [F('BLOCKER', 'invariant'), F('LOW', 'convention')]), 'FAIL');
  // A convention HIGH is still capped: the exemption is the invariant's, not the run's.
  assert.equal(cap('FAIL', 'RISK', [F('HIGH', 'convention')]), 'RISK');
  // An invariant MEDIUM sets a RISK floor, which the cap already allows.
  assert.equal(cap('FAIL', 'RISK', [F('MEDIUM', 'invariant'), F('HIGH', 'convention')]), 'RISK');
  // A lens that judged FAIL on LOW invariant findings is capped like any other judgement: the floor is the findings'.
  assert.equal(cap('FAIL', 'RISK', [F('LOW', 'invariant')]), 'RISK');
  // No ceiling, no change; a bad ceiling still throws, as capVerdict does.
  assert.equal(cap('PASS', null, [F('HIGH', 'invariant')]), 'PASS');
  assert.throws(() => cap('FAIL', 'MEDIUM', []), /verdict ceiling/);
});

test('G-29: spawn-node applies the verdict ceiling through the invariant-keeping cap', () => {
  const src = read('scripts/spawn-node.mjs');
  const at = src.indexOf('if (args.verdictCeiling) {');
  assert.ok(at > 0, 'spawn-node no longer applies --verdict-ceiling where this test expects it');
  const block = src.slice(at, src.indexOf('status.findings_count', at));
  assert.match(block, /capVerdictKeepingInvariants\(/,
    'spawn-node caps the verdict with capVerdict alone, so a §6 invariant finding of a degraded lens ends at the ceiling');
});
