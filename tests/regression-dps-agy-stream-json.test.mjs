// decision-panel-seats.plan.md stage 3 (design DP-D2 A, operator 2026-11-09: "A. stream-json, always (Recommended)"): agy
// took its prompt inline in argv, so external-review refused any prompt over its 30,000-byte budget rather than send it
// truncated (decision 20261107-213602-4f3308's agy seat: "prompt is 33827 bytes; agy receives it inline in argv"; review
// 20261108-230300-rts-remediation-review's agy adjudicator: 49,582 bytes). agy reads NDJSON on stdin under
// `--input-format stream-json --output-format stream-json --print=` (measured, the design's "DP-D2, measured"), so the
// reviewer table gains `prompt.via: stdin-ndjson`: one `{"event":"user",…}` line on stdin, the answer, the schemaless
// text and the usage all read from the final `{"event":"result",…}` line, and a result whose status is not SUCCESS
// reported as the reviewer's failure with its error, never as an empty answer. Held here with a fake agy that records its
// argv and stdin and writes a stream-json reply, the reply's shape cut from the real probe's stdout.ndjson.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { adapterErrors, reviewerPromptVia, reviewerPromptInput, ndjsonResult, ndjsonFailure, responseFrom, usageFrom, schemalessText } from '../scripts/lib/reviewers.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import { reviewerArgv } from '../scripts/lib/decisions.mjs';
import { runScript, REPO_ROOT } from './helpers.mjs';

const BIG = `${'A forty-kilobyte agy prompt, never in argv. '.repeat(950)}END-OF-PROMPT`;   // 41 KB
const noneInArgv = (argv, text) => {
  const joined = argv.join('\u0000');
  for (let i = 0; i + 64 <= text.length; i += 997) if (joined.includes(text.slice(i, i + 64))) return false;
  return true;
};
// The final event's shape, cut from the probe's real output (.claude/candidate-pools/decision-panel-seats/agy-stream-probe/
// stdout.ndjson, 2026-11-09): init, step_update lines, then one result line.
const stream = (result) => [
  JSON.stringify({ event: 'init', conversation_id: 'c', init: { model: 'Gemini 3.8 Flash (High)', cwd: '/x' } }),
  JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'c', step_index: 1, state: 'DONE', step_type: 'agent_response',
    text_delta: '{"n":7}\n', usage: { input_tokens: 1, output_tokens: 1 } } }),
  JSON.stringify({ event: 'result', result: { conversation_id: 'c', num_turns: 1, ...result } }),
].join('\n') + '\n';
const OK = { status: 'SUCCESS', response: '{"n":7,"word":"PONG"}\n', structured_output: { n: 7, word: 'PONG' },
  usage: { input_tokens: 8110, output_tokens: 211, thinking_tokens: 192, cache_read_tokens: 0, total_tokens: 8321 } };

// ------------------------------------------------------------------------------------------------ the adapter
test('agy takes its prompt as one NDJSON user line on stdin, and is no longer held to the argv budget', () => {
  const agy = builtinReviewers().agy;
  assert.equal(reviewerPromptVia(agy), 'stdin-ndjson');
  assert.equal(agy.prompt.budget_bytes, undefined, 'a stdin reviewer still declares an argv budget');
  assert.deepEqual(adapterErrors('agy', agy), []);
  const line = reviewerPromptInput(agy, BIG);
  assert.ok(line.endsWith('\n') && line.indexOf('\n') === line.length - 1, 'not exactly one line');
  assert.deepEqual(JSON.parse(line), { event: 'user', message: { role: 'user', content: BIG } });
  // stdin is the text itself; argv has no stdin text to give.
  assert.equal(reviewerPromptInput({ prompt: { via: 'stdin' } }, 'x'), 'x');
  assert.equal(reviewerPromptInput({ prompt: { via: 'argv', placeholder: 'P' } }, 'x'), null);
});

test('agy\'s argv carries the stream-json flags, no prompt placeholder and no --output-format json', () => {
  const agy = builtinReviewers().agy;
  const { argv } = reviewerArgv({ adapter: agy, reviewer: 'agy', model: 'Gemini 3.8 Flash (High)', schemaFile: '/s.json' });
  for (const f of ['--input-format', '--output-format', '--print=']) assert.ok(argv.includes(f), `${f} missing: ${argv.join(' ')}`);
  assert.equal(argv[argv.indexOf('--input-format') + 1], 'stream-json');
  assert.equal(argv[argv.indexOf('--output-format') + 1], 'stream-json');
  assert.equal(argv.filter((a) => a === '--output-format').length, 1, 'a second --output-format (json) would override the stream');
  assert.ok(!argv.includes('__PROMPT__') && !argv.includes('--print'), 'the inline prompt slot is still there');
  assert.ok(argv.includes('--json-schema'));
});

test('validation: stdin-ndjson is a reviewer transport only; ndjson-result is a response and a usage source', () => {
  const base = { cmd: 'x', roles: ['reviewer'], prompt: { via: 'stdin-ndjson' }, response: { from: 'ndjson-result', field: 'structured_output' },
    usage: { from: 'ndjson-result', field: 'usage' } };
  assert.deepEqual(adapterErrors('x', base), []);
  assert.ok(adapterErrors('x', { ...base, response: { from: 'ndjson-result' } }).some((e) => /response\.field/.test(e)));
  assert.ok(adapterErrors('x', { ...base, usage: { from: 'nowhere' } }).some((e) => /usage\.from/.test(e)));
  assert.ok(adapterErrors('x', { ...base, prompt: { via: 'stdin-ndjson', budget_bytes: 100 } }).some((e) => /budget/.test(e)));
  const rt = { cmd: 'rt', roles: ['node'], node_runtime: { prompt: { flag: '-p', via: 'stdin-ndjson', argv_marker: '-p' } } };
  assert.ok(adapterErrors('rt', rt).some((e) => /via must be 'stdin' or 'argv'/.test(e)), 'a runtime took the reviewer-only transport');
});

// ------------------------------------------------------------------------------------------------ the reply
test('the answer, the schemaless text and the usage come from the final result event', () => {
  const agy = builtinReviewers().agy;
  const out = stream(OK);
  assert.equal(ndjsonResult(out).status, 'SUCCESS');
  assert.deepEqual(responseFrom(agy, { stdout: out }), { n: 7, word: 'PONG' });
  assert.deepEqual(usageFrom(agy, out), OK.usage, 'the step_update usage was read, or none');
  assert.equal(schemalessText(agy, out), OK.response, 'the scan would read the raw stream, where the answer is escaped');
  assert.equal(ndjsonFailure(agy, out), null);
  // The stream's last result wins; a torn line is skipped, never thrown on.
  assert.equal(ndjsonResult(`${out}{"event":"result","res`).status, 'SUCCESS');
  assert.equal(ndjsonResult('not a stream'), null);
  // The other adapters' text is the stdout as given.
  assert.equal(schemalessText({ response: { from: 'stdout-wrapper', field: 'x' } }, 'abc'), 'abc');
});

// The error is the VENDOR'S text: it is returned for classification (a usage limit) and kept out of any reason that can be
// committed (G-43 of lib/decisions.mjs vendorFailureReason), the raw output staying on the gitignored side.
test('a result whose status is not SUCCESS is the reviewer\'s failure, with its error, never an empty answer', () => {
  const agy = builtinReviewers().agy;
  const failed = stream({ status: 'ERROR', error: 'quota exhausted for today', response: '' });
  assert.equal(responseFrom(agy, { stdout: failed }), null);
  assert.deepEqual(ndjsonFailure(agy, failed), { status: 'ERROR', error: 'quota exhausted for today' });
  assert.deepEqual(ndjsonFailure(agy, stream({ status: 'CANCELLED', error: { message: 'stopped' } })), { status: 'CANCELLED', error: 'stopped' });
  assert.deepEqual(ndjsonFailure(agy, 'no result event at all\n'), { status: null, error: '' });
  assert.equal(ndjsonFailure({ response: { from: 'file' } }, failed), null, 'another adapter\'s stdout is not a stream');
});

// ------------------------------------------------------------------------------------------------ driven, with a fake agy
// AGY IS AN .EXE spawned without a shell, so a fake agy.cmd on PATH is never found (reviewer-preflight-fixture.mjs says
// why): the fixture's contract declares agy's command as node with the fake as its first argument.
function fakeAgyMain() {
  const fs = require('node:fs');
  const path = require('node:path');
  const here = path.dirname(process.argv[1]);
  const a = process.argv.slice(2);
  if (a.includes('--version')) { process.stdout.write('fake-agy 1.0\n'); return; }
  let stdin = '';
  try { stdin = fs.readFileSync(0, 'utf8'); } catch { /* none */ }
  fs.appendFileSync(path.join(here, 'calls.jsonl'), `${JSON.stringify({ argv: a, stdin })}\n`);
  const mode = fs.existsSync(path.join(here, 'mode.txt')) ? fs.readFileSync(path.join(here, 'mode.txt'), 'utf8').trim() : 'ok';
  const answer = { status: 'ok', reason: '', verdict: 'PASS', findings: [], checked_clean: [], not_checked: [],
    candidates: [{ name: 'probe' }], supports: 'neither', confidence: 'high', rationale: 'probe' };
  const schema = a.includes('--json-schema');
  const result = mode === 'error'
    ? { status: 'ERROR', error: 'the fake reports a quota exhausted for today', response: '' }
    : { status: 'SUCCESS', response: `${JSON.stringify(answer)}\n`, ...(schema ? { structured_output: answer } : {}),
      usage: { input_tokens: 11, output_tokens: 3, total_tokens: 14 } };
  process.stdout.write([
    JSON.stringify({ event: 'init', init: { model: 'fake' } }),
    JSON.stringify({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: result.response ?? '' } }),
    JSON.stringify({ event: 'result', result }),
  ].join('\n') + '\n');
  // G-5 of 20261109-232630-dps-delivery: a well-formed answer from a process that then exits nonzero, on the call only
  // (the probe's prompt is small), so the probe passes and the call's exit is what is judged.
  if (mode === 'exit-after-answer' && stdin.includes('END-OF-PROMPT')) process.exitCode = 3;
}
function agyFixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dps-agy-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const fake = path.join(bin, 'fake-agy.mjs');
  fs.writeFileSync(fake, `import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n(${fakeAgyMain.toString()})();\n`);
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
    `    cmd: "${fwd(process.execPath)}"`, `    version_argv: ["${fwd(fake)}", "--version"]`, `    base_argv: ["${fwd(fake)}", ${base}]`,
    '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  // Below the engine's home: an evidence directory outside both the repository and the home is refused (G-9).
  const ev = path.join(dir, 'home', 'ev');
  fs.mkdirSync(ev, { recursive: true });
  const prompt = path.join(dir, 'prompt.md');
  fs.writeFileSync(prompt, BIG);
  const calls = () => (fs.existsSync(path.join(bin, 'calls.jsonl'))
    ? fs.readFileSync(path.join(bin, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const call = (args) => runScript('external-review.mjs', ['--reviewer', 'agy', '--prompt-file', prompt, '--evidence-dir', ev, '--out', path.join(ev, 'out.json'), ...args],
    { cwd: repo, env: { QUORATE_HOME: path.join(dir, 'home'), QUORATE_REVIEWER_PROBES: path.join(dir, 'probes') } });
  return { dir, bin, calls, call, out: () => JSON.parse(fs.readFileSync(path.join(ev, 'out.json'), 'utf8')) };
}
const assertNdjsonCall = (c, where) => {
  const lines = c.stdin.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `${where}: stdin is not one NDJSON line`);
  const msg = JSON.parse(lines[0]);
  assert.equal(msg.event, 'user', `${where}: the line has no user event`);
  assert.equal(msg.message.role, 'user');
  assert.ok(noneInArgv(c.argv, msg.message.content), `${where}: part of the prompt is in argv`);
  assert.ok(!c.argv.includes('__PROMPT__'), `${where}: the placeholder reached the CLI`);
  return msg.message.content;
};

test('end to end: a 40 KB prompt reaches agy whole on stdin, none of it in argv, and the schema\'s answer and usage are read', (t) => {
  const f = agyFixture(t);
  const r = f.call(['--schema', '{"verdict":"PASS|RISK|FAIL"}']);
  assert.equal(r.status, 0, r.output);
  const calls = f.calls();
  assert.ok(calls.length >= 2, `the probe and the call did not both reach the fake: ${calls.length}`);
  const contents = calls.map((c, i) => assertNdjsonCall(c, `call ${i + 1}`));
  assert.ok(contents.some((c) => c.includes(BIG)), 'the 40 KB prompt did not arrive whole');
  const env = f.out();
  assert.equal(env.result?.verdict ?? env.verdict, 'PASS', JSON.stringify(env).slice(0, 400));
  assert.deepEqual(env.usage, { input_tokens: 11, output_tokens: 3, total_tokens: 14 }, 'the result event\'s usage was not read');
});

test('end to end, no schema: the scan reads the result event\'s response, on the probe and on the call', (t) => {
  const f = agyFixture(t);
  // No --candidate-fields, so no native schema: the prompt-and-scan path, on the call and on its probe's route.
  const r = f.call(['--mode', 'propose', '--schema', JSON.stringify({ candidates: 'array', not_checked: 'array' })]);
  assert.equal(r.status, 0, r.output);
  assert.ok(f.calls().length >= 2, 'the probe and the call did not both reach the fake');
  for (const [i, c] of f.calls().entries()) assertNdjsonCall(c, `call ${i + 1}`);
  const env = f.out();
  assert.ok(Array.isArray(env.candidates) && env.candidates.length >= 1, `the escaped answer was not found: ${JSON.stringify(env).slice(0, 400)}`);
});

test('end to end: a result whose status is not SUCCESS is reported as the reviewer\'s failure, with its error', (t) => {
  const f = agyFixture(t);
  fs.writeFileSync(path.join(f.bin, 'mode.txt'), 'error');
  // A probe record seeded as passed would hide the call behind nothing: the probe itself fails first here, and says so.
  const r = f.call(['--schema', '{"verdict":"PASS|RISK|FAIL"}']);
  const text = `${r.output}\n${fs.existsSync(path.join(f.dir, 'home', 'ev', 'out.json')) ? fs.readFileSync(path.join(f.dir, 'home', 'ev', 'out.json'), 'utf8') : ''}`;
  assert.match(text, /reported its result as ERROR/, `the reviewer's failure was not reported by its status:\n${text.slice(-800)}`);
  assert.doesNotMatch(text, /returned no parseable/, 'a failed result read as an empty answer');
  // Its error decides the kind: the fake's names a quota, so the failure is a usage limit, its text kept out of the reason.
  assert.match(text, /usage limit/, `the error's quota was not recognised:\n${text.slice(-800)}`);
  const envelope = fs.existsSync(path.join(f.dir, 'home', 'ev', 'out.json')) ? fs.readFileSync(path.join(f.dir, 'home', 'ev', 'out.json'), 'utf8') : '';
  assert.doesNotMatch(envelope, /the fake reports a quota exhausted/, 'the vendor\'s error text was quoted into the envelope');
});

// G-5 of 20261109-232630-dps-delivery: the reviewer was refused on a nonzero exit only when its stdout was empty, so a
// process that wrote a parseable answer and then failed was accepted as a valid panel result.
test('end to end: a reviewer that writes a parseable answer and exits nonzero is unavailable, never accepted', (t) => {
  const f = agyFixture(t);
  fs.writeFileSync(path.join(f.bin, 'mode.txt'), 'exit-after-answer');
  const r = f.call(['--schema', '{"verdict":"PASS|RISK|FAIL"}']);
  const outFile = path.join(f.dir, 'home', 'ev', 'out.json');
  const envelope = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  assert.ok(f.calls().some((c) => c.stdin.includes('END-OF-PROMPT')), 'the call never reached the fake');
  // An unavailable reviewer still exits 0 with an envelope saying so; the envelope is what is judged.
  assert.doesNotMatch(envelope, /"verdict"\s*:\s*"PASS"/, `the failed process's answer was accepted as its verdict:\n${r.output.slice(-400)}`);
  assert.match(envelope, /exited 3 after writing output/, `the nonzero exit was not named as the reason:\n${envelope.slice(0, 800)}`);
});

test('census: the argv budget is consulted only for a reviewer whose prompt goes by argv, and no stdin reviewer declares one', () => {
  for (const [name, a] of Object.entries(builtinReviewers())) {
    const via = reviewerPromptVia(a);
    if (via && via !== 'argv') assert.equal(a.prompt.budget_bytes, undefined, `${name} (${via}) still declares an argv budget`);
  }
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const gates = src.split('\n').filter((l) => /fitsInlineArgv\(/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/^import/.test(l));
  assert.ok(gates.length >= 1 && gates.every((l) => /reviewerPromptVia\(ADAPTER\) === 'argv' && !fitsInlineArgv\(/.test(l)), gates.join('\n'));
});
