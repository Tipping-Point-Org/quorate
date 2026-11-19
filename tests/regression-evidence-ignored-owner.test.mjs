// G-10 of 20261029-235315-rdr-remediation-4-review (panel-codex-contract, MEDIUM). evidenceIgnoredByGit, the archive's
// evidence reader, took an evidence path and rebuilt an owner with confined(path.dirname(evidenceDir)), so its root was
// never the one the caller admitted (run-dir-reads.plan.md stage 3: the helpers that read below a run take the admitted
// run's owner). It now takes that owner, and refuses a path rather than wrapping it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { confined } from '../scripts/io/confined-path.mjs';
import { evidenceIgnoredByGit, evidenceWillBeIgnored } from '../scripts/io/reviews-root.mjs';

test('G-10: the archive\'s evidence reader refuses a path, and reads through the caller\'s owner', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-evidence-owner-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const archive = path.join(base, 'archive');
  fs.mkdirSync(archive);
  spawnSync('git', ['init', '-q', archive]);
  fs.writeFileSync(path.join(archive, '.gitignore'), '*/evidence/\n');
  const run = path.join(base, 'staged', 'run-1');
  fs.mkdirSync(path.join(run, 'evidence', 'node'), { recursive: true });
  fs.writeFileSync(path.join(run, 'evidence', 'node', 'test.log'), 'captured\n');
  assert.throws(() => evidenceIgnoredByGit(archive, 'run-1', path.join(run, 'evidence')), TypeError,
    'an evidence path was read through an owner rebuilt here');
  assert.throws(() => evidenceWillBeIgnored(archive, 'run-1', path.join(run, 'evidence')), TypeError,
    'the gate\'s question took a path too');
  assert.equal(evidenceIgnoredByGit(archive, 'run-1', confined(run)), true, 'the admitted run\'s owner is read');
});
