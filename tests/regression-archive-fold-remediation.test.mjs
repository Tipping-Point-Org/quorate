// THE REMEDIATION OF 20261015-220413-archive-fold-review: archive-run.mjs's arguments and its "already in place" answer,
// and the one owner of "a remediation run has ended". The runner's own halves (G-9, G-12) are in
// regression-remediate-runner*.test.mjs, beside the fixture they need.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, SCRIPTS_DIR } from './helpers.mjs';

// An ended run, written directly into a repository's .claude/reviews: `archiveTo` true records archive_to there.
function inPlaceRun(t, { archiveTo }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-archive-run-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const reviews = path.join(repo, '.claude', 'reviews');
  const runId = '20261015-000000-in-place';
  const dir = path.join(reviews, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: runId, repo_root: repo, ...(archiveTo ? { archive_to: reviews } : {}) }));
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  return { repo, dir };
}

// G-1: `argv[++i]` took the next flag as the path, and that path reached a run.json read and exit 1.
test('G-1: --run-dir followed by a flag, or by nothing, is a bad argument (exit 2)', () => {
  for (const args of [['--run-dir', '--unknown'], ['--run-dir']]) {
    const r = runScript('archive-run.mjs', args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.output}`);
    assert.doesNotMatch(r.output, /run\.json/, 'nothing was read');
  }
});

// G-2: a run written straight into .claude/reviews through a declared reviews_dir has no archive_to, and was refused.
test('G-2: a run with no archive_to is already where it belongs (exit 0)', (t) => {
  const { repo, dir } = inPlaceRun(t, { archiveTo: false });
  // --repo-root: a run is admitted only for the repository the command runs for (ARCHITECTURE A-28).
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', dir]);
  assert.equal(r.status, 0, r.output);
  assert.ok(fs.existsSync(path.join(dir, 'run.json')));
});

// G-3: the in-place test was case-sensitive while archiveStagedRun's is the platform's rule, so on a case-insensitive
// filesystem an archived run named with other casing was left in place by one and reported "not archived" by the other.
test('G-3: a run already in archive_to is in place whatever the casing of --run-dir, on a case-insensitive filesystem', (t) => {
  const { repo, dir } = inPlaceRun(t, { archiveTo: true });
  const same = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', dir]);
  assert.equal(same.status, 0, same.output);
  if (process.platform !== 'win32') { t.skip('the case-insensitive filesystem this ran on; macOS\'s default is unverified'); return; }
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', dir.toUpperCase()]);
  assert.equal(r.status, 0, r.output);
  assert.ok(fs.existsSync(path.join(dir, 'run.json')), 'nothing moved');
});

// G-11: remediate.mjs rebuilt the pending/unrecorded rule inline while archive-run used lib's remediationNotEnded, so the
// two could drift: one archives a run the other refuses. One owner, which remediate.mjs consults for its decision.
test('G-11: remediate.mjs decides "ended" by lib\'s owner, not by an inline copy of its conditions', async () => {
  const lib = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(typeof lib.remediationEnd, 'function', 'the owner exposes what it decided from');
  const pending = { remediation_state: 'reported', clusters: [{ id: 'c1', commit: null, pending_retry: true }, { id: 'c2', unrecorded: true }] };
  const end = lib.remediationEnd(pending);
  assert.deepEqual(end.pending.map((c) => c.id), ['c1']);
  assert.deepEqual(end.unrecorded.map((c) => c.id), ['c2']);
  assert.equal(end.why, lib.remediationNotEnded(pending));
  assert.match(lib.remediationEnd({ clusters: [] }).why, /node has not run/);
  assert.equal(lib.remediationEnd({ remediation_state: 'reported', clusters: [{ id: 'c1', commit: 'abc' }] }).why, null);
  const src = fs.readFileSync(path.join(SCRIPTS_DIR, 'remediate.mjs'), 'utf8');
  const step5 = src.slice(src.indexOf('5. the follow-up review'));
  assert.doesNotMatch(step5, /isPending\(/, 'step 5 rebuilds the pending condition inline');
  assert.doesNotMatch(step5, /filter\(\(x\) => x\.unrecorded\)/, 'step 5 rebuilds the unrecorded condition inline');
  assert.match(step5, /remediationEnd\(done\)/, 'step 5 asks the owner');
});
