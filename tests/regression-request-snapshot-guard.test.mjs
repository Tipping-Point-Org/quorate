// G-23 of run 20260925-015614-platform-review (panel-codex-security): intent capture copied the
// request document into its sandbox with copyFileSync, neither re-checking the SHA-256 mint froze nor
// resolving the path against the repository. A pre-flight command runs between mint and intent, so it
// could replace the approved request — or swap it for a link to implementation — and intent-capture
// would derive the run's criteria from a document nobody approved.
//
// Two guards, both already owned elsewhere for declared documents: the file must BE what it is
// declared as (no link out), and its bytes must be the ones frozen at mint.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { requestSnapshotAdmits } from '../scripts/lib/finding-scope.mjs';

const REPO = path.resolve('/virtual/repo');
const rel = path.join('.claude', 'requests', 'r.md');
const at = path.join(REPO, rel);

test('G-23: a request whose bytes changed since mint is not copied into the intent sandbox', () => {
  const r = requestSnapshotAdmits({ realRepoRoot: REPO, rel, resolved: at, frozenSha: 'aaa', actualSha: 'bbb' });
  assert.equal(r.ok, false);
  assert.match(r.why, /changed since the run was minted/);
  assert.equal(requestSnapshotAdmits({ realRepoRoot: REPO, rel, resolved: at, frozenSha: 'aaa', actualSha: 'aaa' }).ok, true);
});

test('G-23: a request that is a link out of place is refused like any declared document', () => {
  const r = requestSnapshotAdmits({ realRepoRoot: REPO, rel, resolved: path.join(REPO, 'scripts', 'secret.mjs'), frozenSha: 'a', actualSha: 'a' });
  assert.equal(r.ok, false);
});

test('G-23: an inferred request drafted during the run has no frozen hash, and is judged on place alone', () => {
  assert.equal(requestSnapshotAdmits({ realRepoRoot: REPO, rel, resolved: at, frozenSha: null, actualSha: 'x' }).ok, true);
});

test('G-23: run-graph applies the guard before copying the request', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  const block = src.slice(src.indexOf("if (nodeId === 'intent-capture' && runJson.request?.path)"));
  const guard = block.indexOf('requestSnapshotAdmits(');
  const copy = block.indexOf('snapCopy(reqAbs');
  assert.ok(guard > -1 && copy > -1 && guard < copy, 'judged before it is copied');
});

// G-35 of 20261116-200635-m2-9a-high: a request refused here (vanished, or no longer its frozen bytes) was pushed to the
// skips and `return [...dirs]`, so intent-capture started anyway, though the refusal says intent is not derived without
// it. A refused required input starts no node it feeds (I-18): the branch sets docReadRefusal and returns null, the
// signal every caller of docReadDirs turns into a BLOCKED status with the cause.
test('G-35: a refused request starts no intent-capture: its branch sets docReadRefusal and returns null', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  const block = src.slice(src.indexOf("if (nodeId === 'intent-capture' && runJson.request?.path)"));
  const refusal = block.slice(block.indexOf('if (!admits.ok) {'), block.indexOf('snapCopy(reqAbs'));
  assert.match(refusal, /docReadRefusal = /, 'the refusal does not record why the node is not started');
  assert.match(refusal, /return null;/, 'the refusal still returns the read directories, so intent-capture starts');
  assert.doesNotMatch(refusal, /return \[\.\.\.dirs\]/);
});
