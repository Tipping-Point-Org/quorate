// G-18 of 20261105-052942-crsf-delivery (panel-codex-code): `run-session.mjs start` read the run state outside any error
// handler, so a corrupt, unreadable or refused state ended the command with a stack trace instead of a message, unlike
// every other command's read of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';
import { runStatePath } from '../scripts/io/run-state.mjs';

test('G-18: start says an unreadable run state rather than crashing', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crsf-g18-'));
  try {
    const repo = path.join(base, 'repo'); const home = path.join(base, 'home');
    fs.mkdirSync(repo); fs.mkdirSync(home);
    fs.writeFileSync(path.join(repo, 'p.plan.md'), '---\nstatus: approved\n---\n# p\n');
    const p = runStatePath(repo, { home });
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{not json');
    const r = runScript('run-session.mjs', ['start', '--plan', 'p.plan.md', '--repo-root', repo], { env: { QUORATE_HOME: home } });
    assert.notEqual(r.status, 0);
    assert.match(r.output, /run state could not be read/, r.output);
    assert.doesNotMatch(r.output, /at .*run-session\.mjs:\d+/, 'a stack trace instead of a message');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
