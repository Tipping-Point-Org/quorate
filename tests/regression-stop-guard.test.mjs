// The stop guard is what holds autonomous-run-pauses.md criteria 1 and 2 (criterion 5: "held by something that
// executes ... since prose did not hold"). Driven here as Claude Code drives it, with the hook's input on stdin (the
// fields stage 1's probe recorded), against a temporary home, asserting what it prints, its exit code and what it records.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readStopEvents } from '../scripts/io/stop-log.mjs';
import { sessionHookEnv } from './helpers.mjs';

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
function guard({ home, repo }, input, args = []) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stop-guard.mjs'), '--repo-root', repo, ...args], {
    input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'Stop', ...input }),
    encoding: 'utf8', env: sessionHookEnv({ QUORATE_HOME: home }), windowsHide: true,
  });
  const out = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  return { status: r.status, out, events: readStopEvents(repo, { home }).events };
}

test('regression: a named stop is allowed and recorded as a turn end', () => withRepo((ctx) => {
  const r = guard(ctx, { last_assistant_message: 'Committed.\nStop: done', background_tasks: [], stop_hook_active: false });
  assert.equal(r.status, 0);
  assert.equal(r.out, null);
  assert.deepEqual(r.events.map((e) => [e.event, e.kind, e.reason]), [['end', 'named', 'done']]);
}));

test('regression: an unnamed stop is blocked once, then allowed and counted', () => withRepo((ctx) => {
  const first = guard(ctx, { last_assistant_message: 'Waiting on you.', background_tasks: [], stop_hook_active: false });
  assert.equal(first.status, 0);
  assert.equal(first.out.decision, 'block');
  assert.match(first.out.reason, /named reason/);
  const second = guard(ctx, { last_assistant_message: 'Waiting on you.', background_tasks: [], stop_hook_active: true });
  assert.equal(second.out, null);
  assert.deepEqual(second.events.map((e) => [e.event, e.kind]), [['blocked', 'unnamed-blocked'], ['end', 'unnamed-after-block']]);
}));

test('regression: an undeclared wait is blocked; a declared one is allowed', () => withRepo((ctx) => {
  assert.equal(guard(ctx, { last_assistant_message: 'The suite is running.', background_tasks: RUNNING }).out.decision, 'block');
  assert.equal(guard(ctx, { last_assistant_message: 'x\nStop: wait — the suite', background_tasks: RUNNING }).out, null);
}));

// G-13 of 20261024-220920-arp-delivery: a project's .claude/quorate/session-rules.md replaces the rules its sessions
// read, and the guard's refusal named quorate's default regardless. It names the file this project follows.
test('regression: the refusal names the project\'s session rules when it has its own', () => withRepo((ctx) => {
  assert.match(guard(ctx, { last_assistant_message: 'hm', background_tasks: [] }).out.reason, /\(shared\/session-rules\.md\)/);
  fs.mkdirSync(path.join(ctx.repo, '.claude', 'quorate'), { recursive: true });
  fs.writeFileSync(path.join(ctx.repo, '.claude', 'quorate', 'session-rules.md'), '# rules\n');
  assert.match(guard(ctx, { last_assistant_message: 'hm', background_tasks: [] }).out.reason, /\(\.claude\/quorate\/session-rules\.md\)/);
}));

test('regression: a reserved stop with no options is blocked', () => withRepo((ctx) => {
  const r = guard(ctx, { last_assistant_message: 'Approve?\nStop: reserved', background_tasks: [] });
  assert.equal(r.out.decision, 'block');
  assert.match(r.out.reason, /options/);
}));

// G-12 of 20261024-220920-arp-delivery: the involuntary stop is written to the record, with its cause, when the next
// start finds the open turn; it was only derived in memory at summary time. Another session's open turn is not this one's.
test('regression: --turn-start records a start, and a start after an open turn records it as involuntary', () => withRepo((ctx) => {
  guard(ctx, { hook_event_name: 'UserPromptSubmit', prompt: 'yes' }, ['--turn-start']);
  guard(ctx, { hook_event_name: 'UserPromptSubmit', prompt: 'yes', session_id: 's2' }, ['--turn-start']);
  const r = guard(ctx, { hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<task-id>b1</task-id>' }, ['--turn-start']);
  assert.equal(r.out, null);
  assert.deepEqual(r.events.map((e) => [e.event, e.session, e.source ?? e.cause]), [
    ['start', 's1', 'operator'], ['start', 's2', 'operator'], ['involuntary', 's1', 'ended without a Stop'], ['start', 's1', 'notification'],
  ]);
}));

// G-11 and G-17 of 20261024-220920-arp-delivery: the guard exits 0 even when it blocks, so the exit code alone could not
// see malformed input turned into {} and blocked as unnamed. An input error allows the stop: no decision, nothing recorded.
test('regression: unreadable input never fails the session, and is never blocked', () => withRepo(({ home, repo }) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stop-guard.mjs'), '--repo-root', repo], {
    input: 'not json', encoding: 'utf8', env: sessionHookEnv({ QUORATE_HOME: home }), windowsHide: true,
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '', 'no block decision on an input error');
  assert.match(r.stderr, /the stop is allowed/);
  assert.deepEqual(readStopEvents(repo, { home }).events, []);
}));

// The project's hooks reach the graph nodes the engine spawns too (claude -p with GRAPH_NODE_DEPTH of 1 or more), and the
// guard blocked every node's final stop once (2026-10-25: about twenty node sessions in this repository's record, one
// unnamed-blocked each). A node ends by its own contract, so its stop is recorded and never blocked.
test('regression: a graph node\'s stop is never blocked, and is recorded as a node\'s', () => withRepo(({ home, repo }) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stop-guard.mjs'), '--repo-root', repo], {
    input: JSON.stringify({ session_id: 'n1', cwd: repo, hook_event_name: 'Stop', last_assistant_message: '{"verdict":"PASS"}', background_tasks: [] }),
    encoding: 'utf8', env: sessionHookEnv({ QUORATE_HOME: home, GRAPH_NODE_DEPTH: '1', QUORATE_RUN_ID: 'r-1' }), windowsHide: true,
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '', 'no block decision for a node');
  const events = readStopEvents(repo, { home }).events;
  assert.deepEqual(events.map((e) => [e.event, e.kind, e.depth, e.run]), [['end', 'node', 1, 'r-1']]);
}));
