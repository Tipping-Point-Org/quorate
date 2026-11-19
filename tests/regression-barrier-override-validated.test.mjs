// G-30 of run 20260924-004905-today-review — MEDIUM, raised by `arch-review` with a verifiable
// evidence log and reached independently by `panel-codex-docs` from the doc side. A lens and an
// external arm agreeing is stronger evidence than two lenses agreeing.
//
// TWO DEFINITIONS OF "WHICH NODE SETTINGS EXIST". `rosterNodeSetting` resolves an override over
// roster.lenses PLUS roster.barrier_nodes, and run-graph applies it at spawn. `validateRoster`
// looped over lenses, panel_arms and adjudicators only — never barrier_nodes. So a bad effort
// pinned on `reconcile` or `second-opinion` passed pre-flight and failed hours later when that node
// spawned, which is the late failure the validator's own comment exists to prevent (§2 A-1).
//
// The roster's own `$effort` note tells a future reader to "RE-PIN HERE if the contract ever rises
// again" — an instruction pointing straight at the unvalidated path.
//
// This gap was opened the same day, by widening resolution to barrier nodes without widening
// validation to match. Fixing the resolution and not the validator is how the two came apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRoster } from '../scripts/lib/capabilities.mjs';

// A runtime that takes a closed set of efforts, like the real claude node_runtime does.
const RUNTIME = {
  roles: ['node'],
  cmd: 'claude',
  node_runtime: {
    prompt: { flag: '-p' },
    model: { flag: '--model' },
    effort: { flag: '--effort', values: ['low', 'medium', 'high'], ascending: true },
  },
};
const resolve = (name) => (name === 'claude' ? RUNTIME : null);
const opts = { defaultRuntime: 'claude', defaults: { model: 'opus', effort: 'medium' } };

test('a bad effort on a BARRIER node is caught at mint, like one on a lens', () => {
  const onLens = validateRoster(
    { lenses: [{ id: 'code-audit', effort: 'wrong' }], barrier_nodes: [] }, resolve, opts,
  );
  assert.ok(onLens.errors.length, 'baseline: a lens override has always been validated');

  const onBarrier = validateRoster(
    { lenses: [], barrier_nodes: [{ id: 'second-opinion', effort: 'wrong' }] }, resolve, opts,
  );
  assert.ok(onBarrier.errors.length,
    'a barrier-node override reaches spawn through rosterNodeSetting, so it must be validated at '
    + 'mint — otherwise it fails hours into a run, on the rarest nodes in the graph');
  assert.ok(onBarrier.errors.some((e) => /second-opinion/.test(e)),
    'the error must name the node, or an operator cannot act on it');
});

test('a bad MODEL on a barrier node is caught too, and a good override still passes', () => {
  const badModel = validateRoster(
    { barrier_nodes: [{ id: 'reconcile', model: '', effort: 'nope' }] }, resolve, opts,
  );
  assert.ok(badModel.errors.length);

  const good = validateRoster(
    { lenses: [{ id: 'code-audit' }], barrier_nodes: [{ id: 'second-opinion', effort: 'low' }] },
    resolve, opts,
  );
  assert.deepEqual(good.errors, [], 'a legal override must not be reported as a hole');
});

test('a bare-string barrier entry carries no override and is not an error', () => {
  // `barrier_nodes` legitimately holds bare ids — run-graph reads `n.id ?? n` at its one read site.
  const bare = validateRoster({ barrier_nodes: ['request-capture'] }, resolve, opts);
  assert.deepEqual(bare.errors, [],
    'an entry with nothing pinned inherits the contract and has nothing of its own to check');
});
