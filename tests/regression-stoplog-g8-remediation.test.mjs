// Remediation of 20261106-005647-stoplog-g8-review, three confirmed groups in scripts/io/stop-log.mjs.
// G-10: readStopEvents guarded only each session folder's stat, so one file of one folder that could not be read (a
// directory where a record file belongs, a link the owner refuses, EACCES) threw out of the whole read and
// `stop-log --summary` printed nothing for any session, where the folder should be named in unreadableFolders.
// G-8: readSessionTail dropped parseLines' unreadable count in both its paths, so a torn newest line was skipped with
// nothing said, and the turn start could take an older start as current.
// G-9: readStopEvents took any positive maxEvents, so a caller could read past the owner's cap of STOP_READ_MAX_EVENTS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendStopEvent, readStopEvents, readSessionTail, readSessionEvents, STOP_READ_MAX_EVENTS } from '../scripts/io/stop-log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function withRepo(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'slg8-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'slg8-repo-'));
  try { fn({ home, repo }); } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

test('regression G-10: a session folder with a file that cannot be read is named, and every other session is still read', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 'good' }, { home });
  const bad = path.dirname(appendStopEvent(repo, { at: 2, event: 'start', session: 'bad' }, { home }));
  fs.mkdirSync(path.join(bad, '1.jsonl'));   // a record file that is a directory: its read fails with neither ENOENT nor success
  let r;
  assert.doesNotThrow(() => { r = readStopEvents(repo, { home }); }, 'one unreadable file does not abort the whole read');
  assert.deepEqual(r.unreadableFolders.map((f) => f.folder), ['bad'], 'the folder is named, never lost in silence');
  assert.ok(r.unreadableFolders[0].code && r.unreadableFolders[0].code !== 'unknown', 'with the code that refused it');
  assert.ok(r.events.some((e) => e.session === 'good' && e.at === 1), 'the other session is read');
}));

test('regression G-8: the tail read counts a torn line, in its whole-file path and in its tail path', () => withRepo(({ home, repo }) => {
  const dir = path.dirname(appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home }));
  fs.appendFileSync(path.join(dir, 'current.jsonl'), '{"at":2,"event":"st\n');   // torn
  const small = readSessionTail(repo, 's', () => true, { home });
  assert.deepEqual(small.map((e) => e.at), [1]);
  assert.equal(small.unreadable, 1, 'the whole-file path says one line did not parse');
  // Past the tail window, so only the file's end is read.
  const lines = Array.from({ length: 2000 }, (_, i) => `{"at":${i + 10},"event":"start","session":"s"}\n`).join('');
  fs.writeFileSync(path.join(dir, 'current.jsonl'), `${lines}{"at":9999,"ev\n`);
  const tail = readSessionTail(repo, 's', () => true, { home });
  assert.ok(tail.length > 0 && tail.length < 2000, 'only the tail was read');
  assert.equal(tail.unreadable, 1, 'the tail path says one line did not parse');
  const clean = readSessionTail(repo, 's', (ev) => ev.some((e) => e.at === 10), { home });
  assert.equal(clean.unreadable, 1, 'a read that falls through to the whole file still counts it');
  assert.equal(readSessionEvents(repo, 's', { home }).unreadable, 1, 'the whole-session read counts it too');
}));

test('regression G-8: the guard\'s turn start says when its session\'s record had a line it could not read', () => withRepo(({ home, repo }) => {
  const dir = path.dirname(appendStopEvent(repo, { at: 1, event: 'start', session: 's1' }, { home }));
  fs.appendFileSync(path.join(dir, 'current.jsonl'), '{"at":2,"event":"en\n');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stop-guard.mjs'), '--repo-root', repo, '--turn-start'], {
    input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'yes' }),
    encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home }, windowsHide: true,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 line\(s\) of this session's stop record could not be read/, `said, not skipped in silence: ${r.stdout}`);
}));

test('regression G-9: a caller\'s maxEvents is held to the owner\'s cap', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home });
  const r = readStopEvents(repo, { home, maxEvents: STOP_READ_MAX_EVENTS * 5 });
  assert.equal(r.maxEvents, STOP_READ_MAX_EVENTS, 'a larger request reads at most the cap, and says the cap');
  assert.equal(readStopEvents(repo, { home, maxEvents: 5 }).maxEvents, 5, 'a smaller one is kept');
}));
