// G-5 of 20261106-013812-stoplog-g8-remediation-review: the turn start's notice that lines of the stop record could not
// be read, a sentence the session reads, was written inline in stop-guard.mjs, an orchestration entry point, while
// ARCHITECTURE.md §2 gives every sentence a model reads to the prompt library. It is now a template, and still printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendStopEvent, sessionDir } from '../scripts/io/stop-log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'stop-record-unreadable.md';

test('G-5: the unreadable-lines notice lives in the prompt library, not in stop-guard.mjs', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'prompts', '_templates', NAME)), `prompts/_templates/${NAME} holds the notice`);
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'stop-guard.mjs'), 'utf8');
  assert.ok(!/could not be read and were skipped/.test(src), 'the sentence is not written in the entry point');
  // The same class, one line below it: the run state's fault notice.
  assert.ok(fs.existsSync(path.join(ROOT, 'prompts', '_templates', 'run-state-unreadable.md')));
  assert.ok(!/run state could not be read:/.test(src), 'the run state\'s fault sentence is not written in the entry point');
});

test('G-5: a turn start over a torn line still prints the notice, rendered from the template', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-repo-'));
  try {
    appendStopEvent(repo, { at: 1, event: 'end', kind: 'named', reason: 'done', session: 's1' }, { home, retentionDays: null });
    fs.appendFileSync(path.join(sessionDir(repo, 's1', { home }), 'current.jsonl'), '{"torn\n');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stop-guard.mjs'), '--repo-root', repo, '--turn-start'], {
      input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'yes' }),
      encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home }, windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /quorate: 1 line\(s\) of this session's stop record could not be read and were skipped/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
