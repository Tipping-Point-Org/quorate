// G-36: feature-verify could only ever return an EMPTY PASS.
//
// Its whole contract is to exercise a built artifact and cite captured evidence — its only
// permitted basis is `measurement`, which by §4 requires an evidence_path containing that
// measurement. But every step its SKILL.md ordered was impossible under the policy the node
// actually ran with: writeBrief filtered `commands.run` out of the declared-commands block for
// EVERY lens (including the one lens whose job is to run it), Edit/Write are denied so it could not
// build the harness its skill describes, and capture.mjs applied the same filter. So the lens ran,
// could do nothing, and returned zero findings with a PASS — which reads at the gate exactly like a
// feature that was verified and worked.
//
// A lens that verified nothing reporting PASS is the worst outcome this system can produce. The
// refusal is enforced in the VALIDATOR rather than requested in the skill's prose, because a node
// cannot be trusted to disqualify its own output — the same reason severity caps are flags and not
// instructions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAllowedBasis } from '../scripts/lib/decisions.mjs';
import { REPO_ROOT } from './helpers.mjs';

test('feature-verify is measurement-only, which is what makes an empty PASS meaningless', () => {
  assert.deepEqual(resolveAllowedBasis('feature-verify', 'measurement'), ['measurement'],
    'if this lens ever gains a judgment basis, the empty-measurement rule below needs revisiting');
});

test('regression: the empty-measurement refusal is enforced in code, not asked for in prose', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  assert.match(src, /basisIsMeasurementOnly/, 'the rule must exist in the validator');
  assert.match(src, /measurement-only lens produced no findings and no checked_clean/,
    'and it must refuse, with a reason the node can act on');
  // It must key off the RESOLVED schema enum, not a hardcoded node id — a second measurement-only
  // lens must inherit the rule automatically.
  assert.match(src, /const enforcedBasis = schema\?\.properties\?\.findings/,
    'the rule must derive from the enforced basis set, not from a lens name');
  assert.doesNotMatch(src, /basisIsMeasurementOnly[\s\S]{0,200}feature-verify/,
    'the rule must not be special-cased to one lens');
});

test('regression: the runner lens actually receives commands.run in its brief', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  // The IDENTITY moved to the roster and travels through run.json (G-5) — it was a bare literal here
  // and another in capture.mjs, two modules that never communicate, while the roster declared every
  // other per-lens property. This test pinned the literal, so it went red for the fix that removed
  // the duplication; what it must actually pin is that the grant is derived and still narrow.
  assert.match(graph, /const isRunner = \(runJson\.runner_nodes \?\? \[\]\)\.includes\(e\.node_id\)/,
    'the one lens that must launch the product needs the command to launch it, named by the roster');
  assert.match(graph, /k !== 'run' \|\| isRunner/,
    'run stays withheld from every OTHER lens — launching the app is not a review action');

  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  assert.deepEqual(roster.lenses.filter((l) => l.may_launch_run).map((l) => l.id), ['feature-verify'],
    'and exactly one lens is declared able to launch it');
});

test("the lens's own contract still forbids it from reading source", () => {
  // The fix must not widen the lens: it exercises an artifact, it does not review code.
  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  const fv = roster.lenses.find((l) => l.id === 'feature-verify');
  assert.deepEqual(fv.allowed_basis, ['measurement']);
  assert.equal(fv.intent, 'forbidden', 'it may not cite intent; it measures');
});

// A DEGRADED LENS MUST STILL BE ABLE TO RAISE §6 (G-45). The roster's own note argued for giving
// perf-audit the `invariant` basis — "§6 says ANY lens may raise the six non-waivable invariants
// regardless of scope, and this lens could not" — and then `degrade_when` replaced its enum with
// `convention` alone. So the guarantee held exactly when the lens did not need it: with a bench
// command present. With commands.bench empty, which is this repository's own state, the lens best
// placed to notice unbounded_resource_growth could not say so.
test('perf-audit keeps the invariant basis when it degrades, and its cap is a ceiling', () => {
  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  const perf = roster.lenses.find((l) => l.id === 'perf-audit');

  assert.ok(perf.allowed_basis.includes('invariant'), 'the undegraded enum has always had it');
  assert.ok(perf.degraded_basis.includes('invariant'),
    'and losing it on degradation waives a guarantee the doctrine calls non-waivable');
  assert.ok(perf.degraded_basis.includes('convention'), 'without widening what else it may claim');

  // A CEILING, not a floor. `degraded_severity_floor: LOW` was a no-op — LOW is the bottom rung —
  // while both the contract doc and the doctrine promise an unbenchmarked finding is recorded AT
  // LOW (G-40). A floor said "at least LOW", which every finding already satisfies.
  assert.equal(perf.degraded_severity_ceiling, 'LOW');
  assert.equal(perf.degraded_severity_floor, undefined, 'the no-op must be gone, not left beside it');
});

// NON-WAIVABLE MEANS NON-CAPPABLE. Handing a degraded lens the invariant basis is worthless if the
// degradation ceiling then rewrites a credential_exposure as LOW.
test('the severity clamp exempts §6 invariants', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  const at = src.indexOf('status.severity_clamped = 0;');
  assert.notEqual(at, -1);
  const loop = src.slice(at, src.indexOf('status.severity_clamped += 1;', at));
  assert.match(loop, /if \(f\.basis === 'invariant'\) continue;/,
    'a non-waivable finding must leave the clamp with the severity the lens gave it');
});
