// G-28's second half (panel-codex-docs): `preflight.mjs --run` wrote `.preflight-cache/` into a
// declared in-repository reviews_dir without the `.gitignore` that new-run and the archive write, so
// following the documented setup order — seed the pre-flight, THEN mint — left one machine's "the
// checks passed" visible to git. One owner writes that rule now, and every writer into a reviews root
// calls it before writing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureReviewsIgnore, REVIEWS_IGNORE_TEXT } from '../scripts/io/reviews-root.mjs';

const S = path.join(import.meta.dirname, '..', 'scripts');

test('G-28: the reviews root gets its ignore rule, and an operator\'s own edit is kept', (t) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ignore-')), 'reviews');
  t.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));
  ensureReviewsIgnore(dir);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), REVIEWS_IGNORE_TEXT);
  assert.match(REVIEWS_IGNORE_TEXT, /^\.preflight-cache\/$/m);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'mine\n');
  ensureReviewsIgnore(dir);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'mine\n');
});

test('G-28: every writer into a reviews root calls the one owner before it writes', () => {
  const pf = fs.readFileSync(path.join(S, 'preflight.mjs'), 'utf8');
  const call = pf.indexOf('ensureReviewsIgnore(reviewsRoot)');
  assert.ok(call > -1, 'preflight writes the rule');
  // The seed's first write into the root is its exclusive mkdir since run-dir-descendants.plan.md stage 4.
  const firstWrite = pf.indexOf('fs.mkdirSync(path.dirname(runDir), { recursive: true });');
  assert.ok(firstWrite > -1, 'the seed run\'s first write is not where this test looks for it');
  assert.ok(call < firstWrite, 'before it writes anything into the root');
  // The archive's write (run-graph, remediate.mjs, archive-run.mjs) is io/reviews-root's archiveStagedRun since 2026-10-15.
  const io = fs.readFileSync(path.join(S, 'io', 'reviews-root.mjs'), 'utf8');
  const archive = io.slice(io.indexOf('export function archiveStagedRun'), io.indexOf('export function evidenceIgnoredByGit'));
  assert.match(archive, /ensureReviewsIgnore\(path\.dirname\(plan\.to\)\)[\s\S]*archiveRun\(plan/, 'the archive writes the rule before the move');
  for (const f of ['new-run.mjs', 'run-graph.mjs', 'remediate.mjs', 'archive-run.mjs']) {
    const src = fs.readFileSync(path.join(S, f), 'utf8');
    assert.match(src, f === 'new-run.mjs' ? /ensureReviewsIgnore\(/ : /archiveStagedRun\(\{/, `${f} uses the owner`);
    assert.doesNotMatch(src, /writeTextAtomic\([^)]*REVIEWS_IGNORE_TEXT/, `${f} keeps no private copy`);
  }
});
