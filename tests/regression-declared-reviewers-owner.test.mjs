// G-12 of 20261029-235315-rdr-remediation-4-review (panel-codex-contract, MEDIUM). declaredReviewers, given a run, took a
// raw run directory and built its own `confined` owner on it before reading run.json, so its root was never proven to be
// one admitRun returned (run-dir-reads.plan.md stage 3: the helpers that read below a run take the admitted run's owner).
// It now takes that owner as `run`, and refuses a `runDir` path rather than wrapping it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confined } from '../scripts/io/confined-path.mjs';
import { declaredReviewers } from '../scripts/io/reviewers.mjs';

test('G-12: a raw run directory is refused, never wrapped in an owner here', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-declared-owner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: 'r', contract: { reviewers: { x: { cmd: 'x' } } } }));
  assert.throws(() => declaredReviewers({ runDir: dir }), TypeError, 'a raw run path was read through an owner built here');
  assert.deepEqual(declaredReviewers({ run: confined(dir) }), { x: { cmd: 'x' } }, 'the admitted run\'s owner is read');
});
