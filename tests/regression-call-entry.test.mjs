// runtime-call-telemetry.plan.md stage 2: one call's entry, built where the runtime is called, the same shape for every
// runtime. The outputs are cut from real runs (tests/fixtures/telemetry/): a Claude node's stdout, a codex arm's JSONL events,
// an agy judge's stdout wrapper; model text replaced, so an entry that copied any of it is caught.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { callEntry, callOutcome, runtimeAnswered } from '../scripts/lib/call-entry.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'telemetry');
const TABLE = builtinReviewers();
const T0 = Date.parse('2026-10-26T01:00:00.000Z');

test('stage 2: a Claude node\'s call reads its usage through the claude adapter and is answered by its envelope', () => {
  const stdout = JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(FIX, 'review-stdouts.json'), 'utf8'))['code-audit'], subtype: 'success', is_error: false });
  const e = callEntry({ reviewer: 'claude', model: 'opus', table: TABLE, startedMs: T0, endedMs: T0 + 27303, exitCode: 0,
    timeoutMinutes: 30, stdout, answered: runtimeAnswered(stdout, TABLE.claude) });
  assert.equal(e.family, 'anthropic');
  assert.equal(e.duration_ms, 27303);
  assert.equal(e.started_at, '2026-10-26T01:00:00.000Z');
  assert.equal(e.exit_code, 0);
  assert.equal(e.timeout_minutes, 30);
  assert.deepEqual(e.usage, JSON.parse(stdout).usage, 'the claude adapter now declares where its usage is');
  assert.equal(e.outcome, 'answered');
});

test('stage 2: a codex call reads the last turn.completed usage; an agy call its wrapper\'s usage', () => {
  const codex = fs.readFileSync(path.join(FIX, 'codex-raw.jsonl'), 'utf8');
  const turn = codex.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.type === 'turn.completed').at(-1);
  const c = callEntry({ reviewer: 'codex', model: 'gpt-5.6-sol', table: TABLE, startedMs: T0, endedMs: T0 + 1000, exitCode: 0, stdout: codex, answered: true });
  assert.equal(c.family, 'openai');
  assert.deepEqual(c.usage, turn.usage);
  // agy answers in stream-json since decision-panel-seats.plan.md stage 3: its usage is the final result event's, never a
  // step_update's (the fixture's shape is the real probe's, .claude/candidate-pools/decision-panel-seats/agy-stream-probe).
  const agy = fs.readFileSync(path.join(FIX, 'agy-raw.ndjson'), 'utf8');
  const a = callEntry({ reviewer: 'agy', model: 'Gemini 3.8 Flash (High)', table: TABLE, startedMs: T0, endedMs: T0 + 1, exitCode: 0, stdout: agy, answered: true });
  assert.equal(a.family, 'gemini');
  assert.deepEqual(a.usage, JSON.parse(agy.trim().split('\n').at(-1)).result.usage);
  for (const x of [c, a]) assert.equal(JSON.stringify(x).includes('MODEL TEXT'), false, 'an entry copied model text');
});

test('stage 2: the outcome comes from what was observed, never from the exit code alone', () => {
  assert.equal(callOutcome({ timedOut: true, answered: true }), 'timeout');
  assert.equal(callOutcome({ signal: 'SIGTERM' }), 'stopped');
  assert.equal(callOutcome({ answered: true, stdout: '{}' }), 'answered');
  assert.equal(callOutcome({ answered: false, stdout: '{"is_error":true}' }), 'no-answer');
  assert.equal(callOutcome({ stdout: '  ' }), 'no-output');
  // The node runtime's adapter names the envelope fields (G-7 of 20261103-022403-rbr-remediation-8-review).
  const rt = TABLE.claude;
  assert.equal(runtimeAnswered('{"is_error":true,"subtype":"error_max_turns"}', rt), false);
  assert.equal(runtimeAnswered('not json', rt), false);
  assert.equal(runtimeAnswered('{"is_error":false}', rt), true, 'an envelope naming no subtype is judged by is_error');
  assert.equal(runtimeAnswered('{"is_error":false,"subtype":"error_during_execution"}', rt), false);
});

test('stage 2: an unparseable output gives usage absent and its outcome named, never zero', () => {
  const e = callEntry({ reviewer: 'codex', model: 'gpt-5.6-sol', table: TABLE, startedMs: T0, endedMs: T0 + 5, exitCode: 1, stdout: 'garbage' });
  assert.equal(e.usage, null);
  assert.equal(e.outcome, 'no-answer');
  assert.equal(e.exit_code, 1);
  const none = callEntry({ reviewer: 'codex', table: TABLE });
  assert.equal(none.duration_ms, null, 'no times: no duration, not 0');
  assert.equal(none.started_at, null);
});
