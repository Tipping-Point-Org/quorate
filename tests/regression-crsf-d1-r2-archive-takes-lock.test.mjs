// G-3 of 20261105-173030-crsf-d1-remediation-review: archive-run checked that a remediation run had no remediate.lock
// and then copied the run and removed its staged directory without holding the lock, so remediate.mjs could create the
// lock after the check and lose what it wrote after the copy. The lock is now taken, exclusively, as remediate.mjs takes
// it: the source shows the create and that the lock is left out of the archive. A run that cannot be moved, here one
// whose remediation never ended, is refused with the lock released, so archive-run never strands a lock of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';

test('G-3: archive-run takes remediate.lock exclusively, rather than checking it is absent', () => {
  const s = fs.readFileSync(new URL('../scripts/archive-run.mjs', import.meta.url), 'utf8');
  assert.match(s, /\.create\(\['remediate\.lock'\]/, 'archive-run only observes remediate.lock; it never takes it');
  assert.match(s, /archiveStagedRun\(\{[^}]*skip: \['remediate\.lock'\]/, 'the lock archive-run holds would be archived with the run');
});

test('G-3: a refused remediation run keeps no lock of archive-run\'s', (t) => {
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'q-archive-lock-'));
  t.after(() => fs.rmSync(b, { recursive: true, force: true }));
  const repo = path.join(b, 'repo');
  const runId = '20261105-000001-unended';
  const dir = path.join(repo, '.claude', 'reviews', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: runId, repo_root: repo, remediates: '20261105-000000-v' }));
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', dir]);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /has not ended/, r.output);
  assert.equal(fs.existsSync(path.join(dir, 'remediate.lock')), false, 'archive-run left its lock behind');
  assert.ok(fs.existsSync(path.join(dir, 'run.json')), 'the run was not left whole');
});
