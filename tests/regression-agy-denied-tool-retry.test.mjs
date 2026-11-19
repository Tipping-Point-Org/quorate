// decision-panel-seats.plan.md stage 6 (operator, 2026-11-10: "A. Detect, retry once (Recommended)";
// decision-panel-seats.followup.md, the last bullet). The adjudicator of 20261110-214705-sfo-remediation-3-review (G-2)
// tried a shell command (`Get-ChildItem`); headless agy auto-denied it ("a tool required the \"command\" permission that
// headless mode cannot prompt for") and the stream ended `{"status":"SUCCESS","response":""}`, so quorate reported "no
// parseable ruling" and the gate went BLOCKED: a denied tool read as a reviewer that answered nonsense. Now a stream whose
// tool step was refused by a permission check and whose final result is an empty SUCCESS is classified as that cause,
// named with the tool, the vendor's text kept in the raw log (G-43); the call is retried once with the same prompt and
// settings, the first attempt's raw output and usage kept; and a retry denied again is unavailable with the cause. The
// fixture is cut from that review's own raw.log (tests/fixtures/agy/denied-tool.ndjson; the reviewer surface's path
// removed), never written from memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as reviewersLib from '../scripts/lib/reviewers.mjs';
import * as callEntryLib from '../scripts/lib/call-entry.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import { runScript, REPO_ROOT } from './helpers.mjs';

// Read off the namespaces so a name not exported yet fails its own test, not the whole file at import.
const { deniedEmptyAnswer, ndjsonDeniedTools, sumUsage, addUsage, retryLimitMs } = reviewersLib;
const { markAnswered, retriedEntry } = callEntryLib;

const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'agy');
const DENIED = fs.readFileSync(path.join(FIX, 'denied-tool.ndjson'), 'utf8');
const DENIED_ERR = fs.readFileSync(path.join(FIX, 'denied-tool.stderr.txt'), 'utf8');

// ------------------------------------------------------------------------------------------------ the pure rules
test('the real denied stream is classified: the tool named, from the stream\'s own structure', () => {
  const agy = builtinReviewers().agy;
  assert.deepEqual(ndjsonDeniedTools(DENIED, agy), ['run_command']);
  assert.deepEqual(deniedEmptyAnswer(agy, DENIED), { tools: ['run_command'] });
});

test('an empty SUCCESS with no denial, a denial with an answer, and a non-SUCCESS are not this cause', () => {
  const agy = builtinReviewers().agy;
  const lines = DENIED.trim().split('\n').map((l) => JSON.parse(l));
  const noDenial = lines.filter((ev) => ev.step_update?.step_type !== 'tool')
    .map((ev) => (ev.event === 'result' ? { ...ev, result: { ...ev.result, denied_actions: [] } } : ev));
  assert.equal(deniedEmptyAnswer(agy, noDenial.map((l) => JSON.stringify(l)).join('\n')), null, 'an empty answer with no denial was read as a denied tool');
  const answered = lines.map((ev) => (ev.event === 'result' ? { ...ev, result: { ...ev.result, response: '{"supports":"neither"}', structured_output: { supports: 'neither' } } } : ev));
  assert.equal(deniedEmptyAnswer(agy, answered.map((l) => JSON.stringify(l)).join('\n')), null, 'a denial the model worked around was read as no answer');
  const failed = lines.map((ev) => (ev.event === 'result' ? { ...ev, result: { ...ev.result, status: 'ERROR' } } : ev));
  assert.equal(deniedEmptyAnswer(agy, failed.map((l) => JSON.stringify(l)).join('\n')), null, 'a failed result is its own cause');
  assert.equal(deniedEmptyAnswer({ response: { from: 'file' } }, DENIED), null, 'another adapter\'s stdout is not a stream');
});

test('a tool name is reported only when it is a plain identifier; the vendor\'s text never is', () => {
  const step = (name) => JSON.stringify({ event: 'step_update', step_update: { step_type: 'tool', state: 'ERROR', tool_name: name,
    tool_info: { name, error: { type: 'TOOL_ERROR', message: 'permission check failed for command: user denied permission' } } } });
  const result = JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '' } });
  assert.deepEqual(ndjsonDeniedTools([step('read_file'), step('rm -rf / && echo secret=abc'), result].join('\n'), builtinReviewers().agy), ['read_file', 'a tool']);
});

test('sumUsage adds every numeric field of the two calls, and keeps one when the other is absent', () => {
  assert.deepEqual(sumUsage({ input_tokens: 1, output_tokens: 2, total_tokens: 3 }, { input_tokens: 10, output_tokens: 20, total_tokens: 30, cache_read_tokens: 4 }),
    { input_tokens: 11, output_tokens: 22, total_tokens: 33, cache_read_tokens: 4 });
  assert.deepEqual(sumUsage(null, { input_tokens: 5 }), { input_tokens: 5 });
  assert.deepEqual(sumUsage({ input_tokens: 5 }, null), { input_tokens: 5 });
  assert.equal(sumUsage(null, null), null);
});

// ------------------------------------------------------------------------------------------------ driven, with a fake agy
// A fake agy declared in the fixture's contract (agy is an .exe spawned without a shell, so a PATH shim is never found:
// reviewer-preflight-fixture.mjs). It answers the transport probe normally; a call is denied as the real stream was, the
// first DENY times (the count kept beside it), then answered.
function fakeAgyMain() {
  const fs = require('node:fs');
  const path = require('node:path');
  const here = path.dirname(process.argv[1]);
  const a = process.argv.slice(2);
  if (a.includes('--version')) { process.stdout.write('fake-agy 1.0\n'); return; }
  let stdin = '';
  try { stdin = fs.readFileSync(0, 'utf8'); } catch { /* none */ }
  const content = (() => { try { return JSON.parse(stdin.trim().split('\n')[0]).message.content; } catch { return ''; } })();
  const probe = /transport check/.test(content);
  const cfg = JSON.parse(fs.readFileSync(path.join(here, 'cfg.json'), 'utf8'));
  const countFile = path.join(here, 'count.txt');
  const n = probe ? 0 : Number(fs.existsSync(countFile) ? fs.readFileSync(countFile, 'utf8') : 0) + 1;
  if (!probe) fs.writeFileSync(countFile, String(n));
  fs.appendFileSync(path.join(here, 'calls.jsonl'), `${JSON.stringify({ probe, n })}\n`);
  if (!probe && cfg.mode === 'empty') {
    process.stdout.write(`${JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '', usage: { input_tokens: 2, output_tokens: 1 } } })}\n`);
    return;
  }
  const sleep = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
  // A file where the evidence folder goes while the first attempt's log is written, gone before the final log is.
  if (!probe && cfg.blockPath) {
    fs.rmSync(cfg.blockPath, { recursive: true, force: true });
    if (n === 1) { fs.mkdirSync(path.dirname(cfg.blockPath), { recursive: true }); fs.writeFileSync(cfg.blockPath, 'in the way'); }
  }
  // The executable moved away during the first call, so the retry cannot be started (a running file can be renamed on every platform).
  if (!probe && cfg.ownNode && n === 1) fs.renameSync(process.execPath, `${process.execPath}.gone`);
  // The same, during the transport probe, so the probe passes and the call itself cannot be started.
  if (probe && cfg.goneAfterProbe) fs.renameSync(process.execPath, `${process.execPath}.gone`);
  if (!probe && cfg.emptyAnswer) {
    process.stdout.write(`${JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '', usage: { input_tokens: 2, output_tokens: 1 } } })}\n`);
    return;
  }
  if (!probe && n <= cfg.deny) {
    sleep(cfg.denySleepMs ?? 0);
    process.stdout.write(cfg.denied);
    process.stderr.write(cfg.deniedErr);
    if (cfg.deniedExit) process.exitCode = cfg.deniedExit;
    return;
  }
  if (!probe && cfg.retryHangMs) { sleep(cfg.retryHangMs); return; }
  if (!probe && cfg.retryFail) {
    process.stdout.write(`${JSON.stringify({ event: 'result', result: { status: 'ERROR', response: '', error: 'x', usage: { input_tokens: 7, output_tokens: 1 } } })}\n`);
    return;
  }
  const answer = { status: 'ok', reason: '', verdict: probe ? 'PASS' : (cfg.verdict ?? 'PASS'), findings: probe ? [] : (cfg.findings ?? []), checked_clean: [], not_checked: [] };
  process.stdout.write(`${[JSON.stringify({ event: 'init', init: {} }), JSON.stringify({ event: 'result', result: { status: 'SUCCESS',
    response: `${JSON.stringify(answer)}\n`, ...(a.includes('--json-schema') ? { structured_output: answer } : {}),
    usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } })].join('\n')}\n`);
}
function fixture(t, cfg, extraArgs = []) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-deny-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const fake = path.join(bin, 'fake-agy.mjs');
  fs.writeFileSync(fake, `import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n(${fakeAgyMain.toString()})();\n`);
  const blockPath = cfg.blockEvidence ? path.join(dir, 'home', 'ev', 'evidence', 'panel-agy') : null;
  fs.writeFileSync(path.join(bin, 'cfg.json'), JSON.stringify({ denied: DENIED, deniedErr: DENIED_ERR, blockPath, ...cfg }));
  // Its own copy of the runtime, for the test that moves the executable away; the real one is never touched.
  const ownNode = cfg.ownNode || cfg.goneAfterProbe;
  const nodeBin = ownNode ? path.join(bin, path.basename(process.execPath)) : process.execPath;
  if (ownNode) fs.copyFileSync(process.execPath, nodeBin);
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  const fwd = (p) => p.split(path.sep).join('/');
  const base = builtinReviewers().agy.base_argv.map((x) => `"${x}"`).join(', ');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 5', 'project: t', 'commands:',
    '  build: ""', '  test: ""', 'review:', '  external_panel: true', 'reviewers:', '  agy:',
    '    probe_timeout_minutes: 0.5', '    version_timeout_seconds: 10', '    check_margin_seconds: 2',
    `    cmd: "${fwd(nodeBin)}"`, `    version_argv: ["${fwd(fake)}", "--version"]`, `    base_argv: ["${fwd(fake)}", ${base}]`,
    '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const ev = path.join(dir, 'home', 'ev');
  fs.mkdirSync(ev, { recursive: true });
  const prompt = path.join(dir, 'prompt.md');
  fs.writeFileSync(prompt, 'Review the declared scope.\n');
  const r = runScript('external-review.mjs', ['--reviewer', 'agy', '--prompt-file', prompt, '--schema', '{"verdict":"PASS|RISK|FAIL"}',
    '--evidence-dir', ev, '--node-id', 'panel-agy', '--out', path.join(ev, 'out.json'), ...extraArgs],
    { cwd: repo, env: { QUORATE_HOME: path.join(dir, 'home'), QUORATE_REVIEWER_PROBES: path.join(dir, 'probes') } });
  const calls = fs.readFileSync(path.join(bin, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((c) => !c.probe);
  const out = JSON.parse(fs.readFileSync(path.join(ev, 'out.json'), 'utf8'));
  // A file stands there, not a folder, when the test left the blocker in place for the final log.
  const evDirPath = path.join(ev, 'evidence', 'panel-agy');
  const evidence = fs.statSync(evDirPath).isDirectory() ? fs.readdirSync(evDirPath) : [];
  return { r, calls, out, evidence, evDir: path.join(ev, 'evidence', 'panel-agy') };
}

test('a call denied once, then answered, succeeds after one retry, and both attempts are on the record', (t) => {
  const f = fixture(t, { deny: 1 });
  assert.equal(f.r.status, 0, f.r.output);
  assert.equal(f.calls.length, 2, `not exactly one retry: ${f.calls.length} call(s)`);
  assert.equal(f.out.verdict, 'PASS', JSON.stringify(f.out).slice(0, 600));
  // Both calls' usage, summed and said so: the denied call spent 13029 input tokens.
  assert.equal(f.out.usage.input_tokens, 13029 + 100, `the usage is not both calls': ${JSON.stringify(f.out.usage)}`);
  const note = f.out.not_checked.find((n) => /retried/.test(n.item));
  assert.ok(note, `the retry is not on the record: ${JSON.stringify(f.out.not_checked)}`);
  assert.match(note.reason, /run_command/);
  assert.match(note.reason, /both calls/);
  // The first attempt's raw output is kept beside the second's.
  const denied = f.evidence.find((n) => /^raw-denied/.test(n));
  assert.ok(denied, `the denied attempt's raw output was not kept: ${f.evidence}`);
  assert.match(fs.readFileSync(path.join(f.evDir, denied), 'utf8'), /auto-denied/);
});

test('a call denied twice is unavailable, the cause named with the tool, never "no parseable"', (t) => {
  const f = fixture(t, { deny: 2 });
  assert.equal(f.calls.length, 2, `not exactly one retry: ${f.calls.length} call(s)`);
  const reason = (f.out.not_checked ?? []).map((n) => n.reason).join(' | ');
  assert.equal(f.out.verdict, 'RISK');
  assert.match(reason, /denied/, reason);
  assert.match(reason, /run_command/, reason);
  assert.doesNotMatch(reason, /no parseable/, reason);
  // G-43: the vendor's own words stay in the raw log.
  assert.doesNotMatch(JSON.stringify(f.out), /headless mode cannot prompt|Get-ChildItem|permission check failed/, 'the vendor\'s text reached the envelope');
});

test('an empty SUCCESS with no denial keeps today\'s behaviour: one call, no retry, "no parseable"', (t) => {
  const f = fixture(t, { deny: 0, mode: 'empty' });
  assert.equal(f.calls.length, 1, `an empty answer with no denial was retried: ${f.calls.length} call(s)`);
  const reason = (f.out.not_checked ?? []).map((n) => n.reason).join(' | ');
  assert.match(reason, /no parseable/, reason);
  assert.doesNotMatch(reason, /denied/, reason);
});

// ------------------------------------------------------------------- what a retry reports (20261110-230425-dps-remediation-6-review-b)
const retryNoteOf = (out) => (out.not_checked ?? []).find((n) => /^retried call/.test(n.item));

// G-7, G-8: telemetry prefers the call entry's usage over the envelope's, so an entry holding the retry's alone lost the first call's tokens.
test('G-7: a retried call\'s entry carries both calls\' usage, and each attempt\'s own record', (t) => {
  const f = fixture(t, { deny: 1 });
  assert.equal(f.out.call.usage.input_tokens, 13029 + 100, `the call entry's usage is not both calls': ${JSON.stringify(f.out.call.usage)}`);
  assert.equal(f.out.call.attempts?.length, 2, `each attempt is not on the record: ${JSON.stringify(f.out.call)}`);
  assert.equal(f.out.call.attempts[0].usage.input_tokens, 13029);
  assert.equal(f.out.call.attempts[1].usage.input_tokens, 100);
  assert.ok(Date.parse(f.out.call.attempts[0].ended_at) <= Date.parse(f.out.call.attempts[1].started_at), 'the attempts overlap');
  assert.equal(f.out.call.started_at, f.out.call.attempts[0].started_at);
  assert.equal(f.out.call.ended_at, f.out.call.attempts[1].ended_at);
});

test('G-7: the caller\'s verdict on a retried call reaches the attempt it is about', () => {
  const first = { usage: { input_tokens: 1 }, started_at: '2026-11-10T00:00:00.000Z', ended_at: '2026-11-10T00:00:01.000Z', outcome: 'no-answer' };
  const second = { usage: { input_tokens: 2 }, started_at: '2026-11-10T00:00:01.000Z', ended_at: '2026-11-10T00:00:03.000Z', outcome: 'no-answer' };
  const whole = retriedEntry(first, second);
  assert.equal(whole.duration_ms, 3000);
  assert.deepEqual(whole.usage, { input_tokens: 3 });
  const marked = markAnswered(whole, true);
  assert.equal(marked.outcome, 'answered');
  assert.equal(marked.attempts[0].outcome, 'no-answer', 'the denied attempt was marked as answered');
  assert.equal(marked.attempts[1].outcome, 'answered');
});

// G-9, G-14: unavailable() never carried the note, so summed usage reached the reader unexplained.
test('G-9: a retry denied again says its usage is both calls\' sum, and where the first call\'s output is', (t) => {
  const f = fixture(t, { deny: 2 });
  assert.equal(f.out.usage.input_tokens, 13029 * 2, JSON.stringify(f.out.usage));
  const note = retryNoteOf(f.out);
  assert.ok(note, `an unavailable retry does not say it was one: ${JSON.stringify(f.out.not_checked)}`);
  assert.match(note.reason, /both calls/);
  assert.match(note.reason, /raw-denied/);
  assert.ok(f.out.not_checked.some((n) => /^external reviewer 'agy'$/.test(n.item)), 'the unavailable subject is gone');
});

test('G-9: a retry whose result is not SUCCESS says so too, its usage added to the first\'s', (t) => {
  const f = fixture(t, { deny: 1, retryFail: true });
  assert.equal(f.calls.length, 2);
  assert.equal(f.out.usage.input_tokens, 13029 + 7, JSON.stringify(f.out.usage));
  assert.match(retryNoteOf(f.out)?.reason ?? '', /both calls/, JSON.stringify(f.out.not_checked));
  assert.equal(f.out.call.usage.input_tokens, 13029 + 7, JSON.stringify(f.out.call));
});

// G-6: run-graph's backstop is the limit plus two minutes, on the premise this process reports its own timeout first.
test('G-6: the retry has what is left of the call\'s limit, not a fresh one', (t) => {
  const f = fixture(t, { deny: 1, denySleepMs: 9000, retryHangMs: 120000 }, ['--timeout-minutes', '0.25']);
  assert.equal(f.calls.length, 2, `the retry was not made: ${JSON.stringify(f.out.not_checked)}`);
  assert.match((f.out.not_checked ?? []).map((n) => n.reason).join(' | '), /timed out/);
  // 15 s is the limit. A fresh timer ends near 9 + 15 = 24 s.
  assert.ok(f.out.duration_ms < 20000, `two calls ran past the one limit: ${f.out.duration_ms} ms`);
  assert.equal(f.out.usage.input_tokens, 13029, JSON.stringify(f.out.usage));
  assert.match(retryNoteOf(f.out)?.reason ?? '', /raw-denied/, JSON.stringify(f.out.not_checked));
});

test('G-6: the time left for a retry, and none when the limit is spent', () => {
  assert.equal(retryLimitMs(60000, 45000), 15000);
  assert.equal(retryLimitMs(60000, 60000), null);
  assert.equal(retryLimitMs(60000, 61000), null);
});

// G-4: "No other failure is retried", and a failing exit is another failure.
test('G-4: a denied-empty stream from a process that exited nonzero is not retried', (t) => {
  const f = fixture(t, { deny: 1, deniedExit: 3 });
  assert.equal(f.calls.length, 1, `a failing exit was retried: ${f.calls.length} call(s)`);
  assert.equal(f.out.verdict, 'RISK');
  assert.equal(retryNoteOf(f.out), undefined);
});

// G-11: the named failure is a denied tool STEP, then an empty result.
test('G-11: an empty SUCCESS carrying only denied_actions, with no denied tool step, is not this cause', () => {
  const agy = builtinReviewers().agy;
  const only = JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } });
  assert.deepEqual(ndjsonDeniedTools(only, agy), []);
  assert.equal(deniedEmptyAnswer(agy, only), null);
});

// G-12: where the answer lives is the adapter's response.field, one definition.
test('G-12: an answer in the adapter\'s declared field is an answer, whatever the field is called', () => {
  const adapter = { response: { from: 'ndjson-result', field: 'answer', denied_step: builtinReviewers().agy.response.denied_step } };
  const lines = DENIED.trim().split('\n').map((l) => JSON.parse(l))
    .map((ev) => (ev.event === 'result' ? { ...ev, result: { ...ev.result, answer: { verdict: 'PASS' } } } : ev));
  assert.equal(deniedEmptyAnswer(adapter, lines.map((l) => JSON.stringify(l)).join('\n')), null, 'a real answer was read as empty and would be called again');
});

// ------------------------------------------------------------------- what a retry reports (20261110-234941-dps-remediation-7-review)
// G-2: the retry ran under what the first attempt left, and each attempt's own record says the limit it ran under.
test('G-2: each attempt records the limit it ran under, and the call its whole limit', (t) => {
  const f = fixture(t, { deny: 1 }, ['--timeout-minutes', '0.25']);
  assert.equal(f.calls.length, 2, JSON.stringify(f.out.not_checked));
  assert.equal(f.out.call.attempts[0].timeout_minutes, 0.25);
  const second = f.out.call.attempts[1].timeout_minutes;
  assert.ok(second > 0 && second < 0.25, `the retry's record does not hold what it ran under: ${second}`);
  assert.equal(f.out.call.timeout_minutes, 0.25, 'the call as a whole had the whole limit');
});

// G-6, G-12: spawnCapture resolves with `error` set, so a catch around the call never saw a retry that could not start.
test('G-6: a retry that cannot be started says so, and the record is the first call\'s alone', (t) => {
  const f = fixture(t, { deny: 1, ownNode: true });
  assert.equal(f.calls.length, 1, `the retry ran: ${f.calls.length} call(s)`);
  assert.equal(f.out.verdict, 'RISK');
  const note = retryNoteOf(f.out);
  assert.ok(note, JSON.stringify(f.out.not_checked));
  assert.match(note.reason, /could not be started/, note.reason);
  assert.match(note.reason, /first call's alone/, note.reason);
  assert.doesNotMatch(note.reason, /both calls|once more/, note.reason);
  assert.equal(f.out.usage.input_tokens, 13029, JSON.stringify(f.out.usage));
  assert.equal(f.out.call.attempts, undefined, `an attempt that never ran is on the record: ${JSON.stringify(f.out.call)}`);
  assert.equal(f.out.call.usage.input_tokens, 13029, JSON.stringify(f.out.call));
  assert.ok(f.evidence.some((n) => /^raw-denied/.test(n)), `the first attempt's output was not kept: ${f.evidence}`);
});

// G-5: the two writes shared one error slot, so a lost first log was reported as the final raw.log being missing.
test('G-5: a first attempt\'s log that cannot be written is named, and the final raw.log is still cited', (t) => {
  const f = fixture(t, { deny: 2, blockEvidence: true });
  assert.equal(f.calls.length, 2, JSON.stringify(f.out.not_checked));
  assert.ok(f.evidence.includes('raw.log'), `the final log was not written: ${f.evidence}`);
  const items = f.out.not_checked ?? [];
  const lost = items.find((n) => /first attempt's raw log/.test(n.item));
  assert.ok(lost, `the lost log is not named: ${JSON.stringify(items)}`);
  assert.match(lost.reason, /could not be written/, lost.reason);
  assert.doesNotMatch(JSON.stringify(items), /therefore missing/, 'the final raw.log, which exists, was reported missing');
  const cause = items.find((n) => /^external reviewer 'agy'$/.test(n.item));
  assert.match(cause?.reason ?? '', /raw output: evidence\/panel-agy\/raw\.log\)/, JSON.stringify(items));
  // And on the path that answers, where the shared slot read as the cited log being gone.
  const answered = fixture(t, { deny: 1, blockEvidence: true });
  assert.equal(answered.out.verdict, 'PASS', JSON.stringify(answered.out.not_checked));
  assert.ok(answered.out.not_checked.some((n) => /first attempt's raw log/.test(n.item)), JSON.stringify(answered.out.not_checked));
  assert.doesNotMatch(JSON.stringify(answered.out.not_checked), /therefore missing/, 'the final raw.log, which exists, was reported missing');
});

// G-2 of 20261111-003934-dps-remediation-8-review: every other emitter carries runtimeNotChecked(), and the review branch of
// unavailable() did not, so a launched arm that ended unavailable lost the record that its raw log was never written (A-12).
test('G-2: a launched review that ends unavailable names its unwritten raw log and its unpinned settings', (t) => {
  // The blocker the first call leaves stays for the final log, and the one call ends in a non-SUCCESS result.
  const f = fixture(t, { deny: 0, retryFail: true, blockEvidence: true });
  assert.equal(f.calls.length, 1, JSON.stringify(f.out.not_checked));
  assert.equal(f.out.verdict, 'RISK');
  const items = f.out.not_checked ?? [];
  assert.match(items[0]?.item ?? '', /^external reviewer 'agy'$/, `the unavailable subject is not first: ${JSON.stringify(items)}`);
  const lost = items.find((n) => n.item === 'agy raw log');
  assert.ok(lost, `the unwritten raw log is not named: ${JSON.stringify(items)}`);
  assert.match(lost.reason, /could not be written/, lost.reason);
  assert.ok(items.some((n) => n.item === 'agy model'), `the unpinned model is not named: ${JSON.stringify(items)}`);
  assert.ok(items.some((n) => n.item === 'agy reasoning effort'), `the unpinned effort is not named: ${JSON.stringify(items)}`);
});

// G-8 of 20261111-011856-dps-remediation-9-review: `launched` is set before the spawn, and spawnCapture resolves with
// `error` set, so an arm that never started was described as having run on ambient settings.
test('G-8: a reviewer that could not be started is not said to have run on ambient settings', (t) => {
  const f = fixture(t, { deny: 0, goneAfterProbe: true });
  assert.equal(f.calls.length, 0, `the call ran: ${f.calls.length} call(s)`);
  assert.equal(f.out.verdict, 'RISK');
  const items = f.out.not_checked ?? [];
  assert.match(items[0]?.item ?? '', /^external reviewer 'agy'$/, JSON.stringify(items));
  assert.ok(!items.some((n) => /ran on the reviewer CLI ambient default/.test(n.reason)), `an arm that never ran is said to have: ${JSON.stringify(items)}`);
});

// G-10 of the same review: rawLogRel is set before the write, and these two reasons did not ask whether it succeeded, so
// each sent the reader to a file that does not exist, beside a note saying it could not be written.
test('G-10: a nonzero exit whose raw log could not be written cites no raw log', (t) => {
  const f = fixture(t, { deny: 1, deniedExit: 3, blockEvidence: true });
  assert.equal(f.calls.length, 1, JSON.stringify(f.out.not_checked));
  const items = f.out.not_checked ?? [];
  assert.ok(items.some((n) => n.item === 'agy raw log'), `the write did not fail: ${JSON.stringify(items)}`);
  assert.match(items[0].reason, /^exited 3/, items[0].reason);
  assert.doesNotMatch(items[0].reason, /evidence\/panel-agy\/raw/, items[0].reason);
});

test('G-10: an unparseable answer whose raw log could not be written cites no raw log', (t) => {
  const f = fixture(t, { deny: 0, emptyAnswer: true, blockEvidence: true });
  assert.equal(f.calls.length, 1, JSON.stringify(f.out.not_checked));
  const items = f.out.not_checked ?? [];
  assert.ok(items.some((n) => n.item === 'agy raw log'), `the write did not fail: ${JSON.stringify(items)}`);
  assert.match(items[0].reason, /no parseable/, items[0].reason);
  assert.doesNotMatch(items[0].reason, /evidence\/panel-agy\/raw/, items[0].reason);
  assert.match(items[0].reason, /could not be written/, items[0].reason);
});

// G-13 of the same review: any member of VERDICTS was taken as the ceiling, so FAIL lifted the cap, and PASS turned a
// non-PASS answer into a PASS. An external arm's verdict is capped at RISK whatever the caller passes.
for (const ceiling of ['FAIL', 'PASS']) {
  test(`G-13: --verdict-ceiling ${ceiling} does not move an external arm's cap, and the refusal is said`, (t) => {
    const f = fixture(t, { deny: 0, verdict: 'FAIL' }, ['--verdict-ceiling', ceiling]);
    assert.equal(f.out.verdict, 'RISK', JSON.stringify(f.out));
    const note = (f.out.not_checked ?? []).find((n) => /verdict ceiling/.test(n.item));
    assert.ok(note, `the ceiling that was not honoured is not named: ${JSON.stringify(f.out.not_checked)}`);
    assert.match(note.reason, new RegExp(ceiling), note.reason);
  });
}
test('G-13: the declared RISK ceiling is applied with nothing to say, and a PASS answer stays a PASS', (t) => {
  const risk = fixture(t, { deny: 0, verdict: 'FAIL' }, ['--verdict-ceiling', 'RISK']);
  assert.equal(risk.out.verdict, 'RISK', JSON.stringify(risk.out));
  assert.ok(!(risk.out.not_checked ?? []).some((n) => /verdict ceiling/.test(n.item)), JSON.stringify(risk.out.not_checked));
  assert.equal(fixture(t, { deny: 0, verdict: 'PASS' }, ['--verdict-ceiling', 'RISK']).out.verdict, 'PASS');
});

// G-2 of 20261111-015717-dps-remediation-10-review: the note was built after every early exit, so a --verdict-ceiling the
// arm did not apply went unsaid whenever the reviewer failed.
for (const ceiling of ['FAIL', 'PASS']) {
  test(`G-2: an arm that ends unavailable still says --verdict-ceiling ${ceiling} was not applied`, (t) => {
    const f = fixture(t, { deny: 0, emptyAnswer: true }, ['--verdict-ceiling', ceiling]);
    assert.equal(f.out.verdict, 'RISK', JSON.stringify(f.out));
    const note = (f.out.not_checked ?? []).find((n) => /verdict ceiling/.test(n.item));
    assert.ok(note, `the ceiling that was not honoured is not named: ${JSON.stringify(f.out.not_checked)}`);
    assert.match(note.reason, new RegExp(ceiling), note.reason);
  });
}
test('G-2: an arm that ends unavailable under the RISK ceiling has nothing to say about it', (t) => {
  const f = fixture(t, { deny: 0, emptyAnswer: true }, ['--verdict-ceiling', 'RISK']);
  assert.ok(!(f.out.not_checked ?? []).some((n) => /verdict ceiling/.test(n.item)), JSON.stringify(f.out.not_checked));
});

// G-5 of the same review: rawLogRel was set before the write and stayed set when it failed, so every finding cited a file
// that does not exist, and the arm path does not check an arm's evidence.
const ONE_FINDING = [{ severity: 'LOW', file: 'a.txt', line: 1, claim: 'a claim' }];
test('G-5: a finding cites no raw log when the raw log could not be written', (t) => {
  const f = fixture(t, { deny: 0, blockEvidence: true, findings: ONE_FINDING });
  const items = f.out.not_checked ?? [];
  const note = items.find((n) => n.item === 'agy raw log');
  assert.ok(note, `the write did not fail: ${JSON.stringify(items)}`);
  assert.equal(f.out.findings.length, 1, JSON.stringify(f.out));
  assert.equal(f.out.findings[0].evidence_path, null, JSON.stringify(f.out.findings[0]));
  assert.doesNotMatch(note.reason, /evidence\/panel-agy\/raw/, note.reason);
  assert.match(note.reason, /could not be written/, note.reason);
});
test('G-5: a finding cites the raw log that was written', (t) => {
  const f = fixture(t, { deny: 0, findings: ONE_FINDING });
  const cited = f.out.findings[0].evidence_path;
  assert.match(cited, /^evidence\/panel-agy\/raw/, JSON.stringify(f.out.findings[0]));
  assert.ok(f.evidence.includes(path.basename(cited)), `${cited} is not among ${f.evidence}`);
});

// G-9: the denial vocabulary is the adapter's data, so a second stream shape needs no engine edit.
const OTHER_SHAPE = { event: 'action', body: 'action', where: { kind: 'call', outcome: 'refused' }, message: 'why.text', pattern: 'not allowed', name: ['call_name'] };
test('G-9: what a denied step looks like is read from the adapter', () => {
  const adapter = { response: { from: 'ndjson-result', field: 'structured_output', denied_step: OTHER_SHAPE } };
  const stream = [{ event: 'action', action: { kind: 'call', outcome: 'refused', call_name: 'shell', why: { text: 'NOT allowed here' } } },
    { event: 'result', result: { status: 'SUCCESS', response: '' } }].map((l) => JSON.stringify(l)).join('\n');
  assert.deepEqual(deniedEmptyAnswer(adapter, stream), { tools: ['shell'] }, 'a denial described in data was not recognised');
  assert.equal(deniedEmptyAnswer(adapter, DENIED), null, 'another adapter\'s vocabulary was recognised');
  assert.equal(deniedEmptyAnswer({ response: { from: 'ndjson-result', field: 'structured_output' } }, DENIED), null,
    'an adapter that declares no denied_step has its stream read in a vocabulary it never declared');
});

test('G-9: a malformed denied_step is refused where adapters are checked', () => {
  const { adapterErrors } = reviewersLib;
  const base = { cmd: 'x', roles: ['reviewer'], prompt: { via: 'stdin-ndjson' }, response: { from: 'ndjson-result', field: 'structured_output' } };
  const errsOf = (response) => adapterErrors('x', { ...base, response }).filter((e) => /denied_step/.test(e));
  assert.deepEqual(errsOf({ ...base.response, denied_step: OTHER_SHAPE }), []);
  assert.ok(errsOf({ ...base.response, denied_step: { event: 'a' } }).length, 'an incomplete shape was admitted');
  assert.ok(errsOf({ ...base.response, denied_step: { ...OTHER_SHAPE, pattern: '(' } }).length, 'a pattern that does not compile was admitted');
  assert.ok(errsOf({ ...base.response, denied_step: { ...OTHER_SHAPE, name: [] } }).length, 'a shape with nowhere to read a name was admitted');
  assert.ok(errsOf({ from: 'file', denied_step: OTHER_SHAPE }).length, 'a denied_step on a response with no stream was admitted');
  assert.deepEqual(adapterErrors('agy', builtinReviewers().agy).filter((e) => /denied_step/.test(e)), []);
  assert.ok(builtinReviewers().agy.response.denied_step, 'the shipped adapter declares none');
});

// G-13: one rule for what counts as summable usage, the report's.
test('G-13: a non-finite usage value is not summed, as the report does not sum it', () => {
  assert.deepEqual(sumUsage({ input_tokens: Infinity, output_tokens: 1 }, { input_tokens: 2, output_tokens: NaN }), { input_tokens: 2, output_tokens: 1 });
  const acc = {};
  assert.equal(addUsage(acc, { input_tokens: 3, note: 'x' }), true);
  assert.deepEqual(acc, { input_tokens: 3 });
});
