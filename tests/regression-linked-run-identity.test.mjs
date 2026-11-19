// G-14 of 20261015-230146-archive-fold-remediation-review (G-12 its symptom): resolveLinkedRun accepted ANY run at the
// recorded path when the link carried no run_id, against its own docstring ("for a path with no recorded id, the path's
// own name"), and probed that stale path before the repository's run roots — so a reused or recreated path could stand in
// for the linked run and the round cap was counted along the wrong chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveLinkedRun } from '../scripts/lib/remediation-chain.mjs';

// An admitting reader over a fake disk (admission is required since run-dir-descendants.plan.md stage 3, G-19): a run on
// the disk is admitted at its own spelling, anything else is refused.
const admitFrom = (runs) => (dir) => (runs[dir] ? { ok: true, dir, record: runs[dir] } : { ok: false });
const opts = (runs, extra) => ({ admit: admitFrom(runs), join: path.posix.join, basename: path.posix.basename, ...extra });

test('G-19: a linked run is never resolved without admission', () => {
  const runs = { '/stale/20261001-000100-r0': { run_id: '20261001-000100-r0' } };
  assert.throws(() => resolveLinkedRun({ dir: '/stale/20261001-000100-r0', readRun: (d) => runs[d] ?? null, join: path.posix.join, basename: path.posix.basename }),
    /admit is required/);
});

test('G-14: with no recorded run_id, a run at the recorded path whose id is not the path\'s name is not the linked run', () => {
  const runs = { '/stale/20261001-000100-r0': { run_id: '20261009-000000-unrelated' } };
  assert.equal(resolveLinkedRun(opts(runs, { dir: '/stale/20261001-000100-r0', runId: null })), null);
});

test('G-14: with no recorded run_id, the run named by the path is still found', () => {
  const runs = { '/stale/20261001-000100-r0': { run_id: '20261001-000100-r0' } };
  assert.equal(resolveLinkedRun(opts(runs, { dir: '/stale/20261001-000100-r0' })).run_dir, '/stale/20261001-000100-r0');
});

// G-13 and G-14 of 20261023-040306-rdt-remediation-2-review: remediate.mjs's and run-graph.mjs's readers admitted each
// candidate and returned only its record, so run_dir was the candidate's spelling and every later read of the linked run
// (its reconciliation, its census payload) went back through a path a link could retarget after admission.
test('G-13/G-14: an admitting reader\'s canonical directory is the run_dir every later read uses', () => {
  const id = '20261001-000100-r0';
  const admitted = { [`/repo/.claude/reviews/${id}`]: { ok: true, dir: `/real/${id}`, record: { run_id: id } } };
  const admit = (dir) => admitted[dir] ?? { ok: false };
  const readRun = (dir) => (admit(dir).ok ? admit(dir).record : null);   // the record-only reader the callers held
  const r = resolveLinkedRun({ dir: `/stale/${id}`, runId: id, roots: ['/repo/.claude/reviews'], readRun, admit, join: path.posix.join, basename: path.posix.basename });
  assert.equal(r?.run_dir, `/real/${id}`, 'the admitted directory, not the spelling that was admitted');
  assert.equal(r.run_id, id);
});

test('G-14: the run under the repository\'s run roots wins over a copy at the recorded path', () => {
  const id = '20261001-000100-r0';
  const runs = { [`/stale/${id}`]: { run_id: id, copy: 'stale' }, [`/repo/.claude/reviews/${id}`]: { run_id: id, copy: 'archived' } };
  const r = resolveLinkedRun(opts(runs, { dir: `/stale/${id}`, runId: id, roots: ['/repo/.claude/reviews'] }));
  assert.equal(r.copy, 'archived');
  assert.equal(r.run_dir, `/repo/.claude/reviews/${id}`);
});
