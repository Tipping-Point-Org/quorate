// regression-archive-cleanup-never-throws.test.mjs — G-9 of 20261023-014400-rdt-delivery.
//
// archiveStagedRun promises never to throw: a failed archive returns the staged run's directory and says where it is.
// Its catch removed the temp copy with an unguarded rmSync, and so did archiveRun's, so a removal that failed with
// anything but ENOENT (EPERM, EBUSY on Windows) threw out of the recovery path: the caller crashed and the diagnostic
// naming the staged run was lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { archiveStagedRun } from '../scripts/io/reviews-root.mjs';

test('a temp copy that cannot be removed does not throw out of archiveStagedRun; the run stays and is named', (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-archive-cleanup-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const repo = path.join(base, 'repo');
  const runDir = path.join(base, 'staged', '20260101-000000-run');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run.json'), '{}');
  const rm = () => { const e = new Error('EPERM: operation not permitted, rmdir'); e.code = 'EPERM'; throw e; };
  const logged = [];
  let to;
  assert.doesNotThrow(() => {
    to = archiveStagedRun({ runDir, archiveTo: path.join(repo, '.claude', 'reviews'), repoRoot: repo, log: (m) => logged.push(m), rm });
  }, 'the cleanup in the error path threw past the never-throws contract');
  assert.equal(to, runDir, 'the staged run is what is returned');
  assert.ok(logged.some((m) => m.includes(runDir)), `the diagnostic naming the staged run was lost: ${JSON.stringify(logged)}`);
  assert.ok(fs.existsSync(path.join(runDir, 'run.json')), 'the staged run is still whole');
});
