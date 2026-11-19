// One session's read (G-8 of 20261024-235344-arp-remediation-2-review, and G-12 of 20261024-224631-arp-remediation-review).
// Under the shared file a rotation between a session's start and a block left the open turn in a file that was not read;
// and every turn start read the whole record. Since session-record-files.plan.md stage 1 each session has its own folder:
// its read covers every file of that folder, rotated ones included, in write order, and nothing of any other session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionEvents, sessionDir } from '../scripts/io/stop-log.mjs';
import { hasOpenTurn } from '../scripts/lib/stop-record.mjs';

function withRepo(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try { fn({ home, repo }); } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
}
const line = (o) => `${JSON.stringify(o)}\n`;

test('regression: a block in the current file does not hide the start in a rotated one', () => withRepo(({ home, repo }) => {
  const dir = sessionDir(repo, 's', { home });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1.jsonl'), line({ at: 1, event: 'start', session: 's', source: 'operator' }));
  fs.writeFileSync(path.join(dir, 'current.jsonl'), line({ at: 2, event: 'blocked', kind: 'unnamed', session: 's' }));
  const events = readSessionEvents(repo, 's', { home });
  assert.deepEqual(events.map((e) => e.at), [1, 2], 'every file of the session folder is read, in write order');
  assert.equal(hasOpenTurn(events, 's'), true);
}));

test('regression: a session reads only its own folder', () => withRepo(({ home, repo }) => {
  for (const [s, at] of [['s', 1], ['other', 2]]) {
    const dir = sessionDir(repo, s, { home });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'current.jsonl'), line({ at, event: 'start', session: s }));
  }
  assert.deepEqual(readSessionEvents(repo, 's', { home }).map((e) => e.at), [1]);
}));
