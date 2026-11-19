// G-12 of 20261024-224631-arp-remediation-review: the plan's record is one line per turn start and per turn end "with
// time, kind, named reason and the background task count", and the start and involuntary lines the guard wrote carried
// none of the three. And every --turn-start read the whole record, both files, to look for one session's open turn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as stopLog from '../scripts/io/stop-log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNING = [{ id: 'b1', type: 'shell', status: 'running', command: 'node tests/run-all.mjs' }];

function withRepo(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-repo-'));
  try { fn({ home, repo }); } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
}
function turnStart({ home, repo }, input) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stop-guard.mjs'), '--repo-root', repo, '--turn-start'], {
    input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'yes', ...input }),
    encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home }, windowsHide: true,
  });
  assert.equal(r.status, 0, r.stderr);
  return stopLog.readStopEvents(repo, { home }).events;
}

test('regression: start and involuntary lines carry kind, named reason and the background task count', () => withRepo((ctx) => {
  turnStart(ctx, {});
  const events = turnStart(ctx, { background_tasks: RUNNING });
  assert.deepEqual(events.map((e) => [e.event, e.kind, e.reason, e.running]), [
    ['start', 'start', null, 0], ['involuntary', 'involuntary', null, 1], ['start', 'start', null, 1],
  ]);
}));

// G-12 of 20261024-224631-arp-remediation-review: every turn start read the whole record. Since
// session-record-files.plan.md stage 1 a session has its own folder, and the turn start reads only that folder.
test('regression: a turn start reads only its own session folder', () => withRepo(({ home, repo }) => {
  assert.equal(typeof stopLog.readSessionEvents, 'function', 'the turn start has a session-scoped read');
  stopLog.appendStopEvent(repo, { at: 1, event: 'start', session: 's1' }, { home });
  stopLog.appendStopEvent(repo, { at: 2, event: 'start', session: 's2' }, { home });
  stopLog.appendStopEvent(repo, { at: 3, event: 'end', kind: 'named', session: 's1' }, { home });
  assert.deepEqual(stopLog.readSessionEvents(repo, 's1', { home }).map((e) => e.at), [1, 3]);
  assert.deepEqual(stopLog.readSessionEvents(repo, 's2', { home }).map((e) => e.at), [2]);
  assert.notEqual(stopLog.sessionDir(repo, 's1', { home }), stopLog.sessionDir(repo, 's2', { home }));
}));

// G-24 of 20261025-092319-srf-review-amended: the test above calls the reader, not the guard, so a guard that went back to
// reading every session would still pass it. Here another session's record cannot be read at all: a turn start that
// reads beyond its own folder fails and records nothing.
test('regression: the guard\'s turn start never reads another session\'s folder', () => withRepo(({ home, repo }) => {
  stopLog.appendStopEvent(repo, { at: 1, event: 'start', session: 's1' }, { home });
  const other = stopLog.sessionDir(repo, 's2', { home });
  fs.mkdirSync(path.join(other, 'current.jsonl'), { recursive: true });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stop-guard.mjs'), '--repo-root', repo, '--turn-start'], {
    input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'yes' }),
    encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home }, windowsHide: true,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.trim(), '', 'nothing failed to read');
  assert.deepEqual(stopLog.readSessionEvents(repo, 's1', { home }).map((e) => e.event), ['start', 'involuntary', 'start'], r.stderr);
}));

// G-16 and G-6 of 20261025-080709-srf-delivery: the turn start read and parsed every file of its session to learn whether
// the last turn is open, which only the newest turn event decides. Here the previous file cannot be read at all: a turn
// start that reads it fails and records nothing; one that stops at the newest file finds the open turn.
test('regression: a turn start reads its session newest first and stops at the newest turn event', () => withRepo(({ home, repo }) => {
  const dir = path.dirname(stopLog.appendStopEvent(repo, { at: 1, event: 'start', session: 's1' }, { home }));
  fs.mkdirSync(path.join(dir, '1.jsonl'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stop-guard.mjs'), '--repo-root', repo, '--turn-start'], {
    input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'yes' }),
    encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home }, windowsHide: true,
  });
  assert.equal(r.status, 0, r.stderr);
  fs.rmdirSync(path.join(dir, '1.jsonl'));
  const events = stopLog.readSessionEvents(repo, 's1', { home });
  assert.deepEqual(events.map((e) => e.event), ['start', 'involuntary', 'start'], r.stderr);
}));
