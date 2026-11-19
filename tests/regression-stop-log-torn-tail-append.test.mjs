// G-2 of 20261106-013812-stoplog-g8-remediation-review: appendStopEvent wrote each line with appendFileSync and never
// checked that the file ended in a newline. After a torn tail (a short write, a crash mid-line), the next event was
// joined onto the broken line, so the reader skipped the joined line and lost an event the writer had reported written.
// An append now starts on a line of its own, and the event and the sweep's report go in one write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendStopEvent, readSessionEvents, sessionDir } from '../scripts/io/stop-log.mjs';

function withRepo(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try { fn({ home, repo }); } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

test('G-2: an event appended after a torn tail is kept, the torn line alone counted unreadable', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home, retentionDays: null });
  const file = path.join(sessionDir(repo, 's', { home }), 'current.jsonl');
  fs.appendFileSync(file, '{"at":2,"event":"end","sess');   // a torn write: no closing brace, no newline
  appendStopEvent(repo, { at: 3, event: 'start', session: 's' }, { home, retentionDays: null });
  const events = readSessionEvents(repo, 's', { home });
  assert.deepEqual(events.map((e) => e.at), [1, 3], 'the event after the torn line is read back');
  assert.equal(events.unreadable, 1);
}));

test('G-2: a file that ends in a newline gets no blank line', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home, retentionDays: null });
  appendStopEvent(repo, { at: 2, event: 'end', session: 's' }, { home, retentionDays: null });
  const file = path.join(sessionDir(repo, 's', { home }), 'current.jsonl');
  assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim()).length, 1, 'only the final newline');
}));
