// autonomous-run.plan.md stage 7 part 2, the three decisions of its "Open questions" (operator, 2026-10-31: "1 a 2 a",
// then "3 a"): a fifth voluntary stop, `Stop: limit — <what>`; Claude Code's own usage limit kept as the harness's wait
// and RECORDED by a StopFailure hook; and a codex or agy quota error recognised as one rather than read as any failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopMarker, guardDecision, summary, STOP_REASONS, stopFailureEvent, stopGuardDeclared } from '../scripts/lib/stop-record.mjs';
import { quotaOf, resetTextOf } from '../scripts/lib/quota.mjs';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, sessionHookEnv, runScript, withTempDir, seedReviewerProbe } from './helpers.mjs';

const end = (message, extra = {}) => ({ session_id: 's', last_assistant_message: message, background_tasks: [], ...extra });

test('Stop: limit is a fifth named stop, and like error it names its <what>', () => {
  assert.ok(STOP_REASONS.includes('limit'));
  assert.deepEqual(stopMarker('ran out\nStop: limit — time limit'), { reason: 'limit', detail: 'time limit' });
  assert.equal(stopMarker('ran out\nStop: limit'), null, 'a bare limit names nothing');
});

test('the guard lets a limit stop through with no options, and never sends it to the panel', () => {
  const d = guardDecision(end('The 72-hour limit is reached.\nStop: limit — time limit'), { decisionPanel: 'on' });
  assert.equal(d.block, false);
  assert.equal(d.record.kind, 'named');
  assert.equal(d.record.reason, 'limit');
});

test('the stop record counts limit stops apart from done', () => {
  const ev = [
    { at: 1, event: 'start', kind: 'start', session: 's' },
    { at: 2, event: 'end', kind: 'named', reason: 'limit', detail: 'time limit', session: 's' },
    { at: 3, event: 'start', kind: 'start', session: 's' },
    { at: 4, event: 'end', kind: 'named', reason: 'done', session: 's' },
  ];
  const s = summary(ev);
  assert.equal(s.byKind['named:limit'].count, 1);
  assert.equal(s.byKind['named:done'].count, 1);
});

test('a StopFailure (the docs example) is an involuntary turn end with its error, details and reset text', () => {
  const docs = { session_id: 's', hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429 Too Many Requests',
    last_assistant_message: 'API Error: Rate limit reached' };
  const e = stopFailureEvent(docs, { at: 5 });
  assert.equal(e.event, 'involuntary');
  assert.equal(e.cause, 'api-error');
  assert.equal(e.error, 'rate_limit');
  assert.equal(e.error_details, '429 Too Many Requests');
  assert.equal(e.reset_text, null, 'no reset time in the docs example, so none is invented');
  const withReset = stopFailureEvent({ ...docs, last_assistant_message: 'Usage limit reached · limit resets 3:45pm' }, { at: 6 });
  assert.equal(withReset.reset_text, '3:45pm');
  // The involuntary event closes the open turn, so the next start does not count it a second time.
  const s = summary([{ at: 1, event: 'start', kind: 'start', session: 's' }, e, { at: 9, event: 'start', kind: 'start', session: 's' }]);
  assert.equal(s.involuntary, 1);
});

// G-9 of 20261105-004603-ar-d1-c-review: the hook's error, details and last message were stored verbatim in the session
// log under the engine's home, so a credential in an API error reached a file on disk. They are redacted by the one owner.
test('a StopFailure\'s error, details and message are redacted before they are recorded', () => {
  const key = ['sk', 'A'.repeat(12) + 'b'.repeat(12)].join('-');
  const e = stopFailureEvent({ session_id: 's', error: `bad key ${key}`, error_details: `Authorization: ${key}`,
    last_assistant_message: `API Error: ${key} rejected · limit resets 3:45pm` }, { at: 5 });
  for (const k of ['error', 'error_details', 'message']) assert.ok(!String(e[k]).includes(key), `${k} recorded the credential verbatim`);
  assert.match(e.error, /\[redacted: /);
  assert.equal(e.reset_text, '3:45pm', 'the reset time survives redaction');
});

// G-21 of 20261104-223634-ar-d1-review: an involuntary event was kept only while its start was open, so a StopFailure
// whose start the record no longer held (retention, a tail read) vanished, where an orphan end makes a start-null turn.
test('an orphaned StopFailure is counted as a start-null involuntary turn, never dropped', () => {
  const e = stopFailureEvent({ session_id: 's', error: 'rate_limit' }, { at: 5 });
  assert.equal(summary([e]).involuntary, 1, 'the orphaned API failure vanished from the summary');
  assert.equal(summary([{ at: 1, event: 'end', kind: 'named', reason: 'done', session: 's' }, e]).involuntary, 1);
});

test('the StopFailure hook is declared here, and check-install can see it', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude', 'settings.json'), 'utf8'));
  assert.equal(stopGuardDeclared(settings).stopFailure, true);
  assert.equal(stopGuardDeclared({ hooks: {} }).stopFailure, false);
});

test('the hook writes the event to the record it is given and never fails the session', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-repo-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-home-'));
  const hook = (input) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'stop-guard.mjs'), '--stop-failure', '--repo-root', repo], {
    input, encoding: 'utf8', env: sessionHookEnv({ QUORATE_HOME: home }), windowsHide: true,
  });
  try {
    const r = hook(JSON.stringify({ session_id: 'sf-test', cwd: repo, hook_event_name: 'StopFailure', error: 'rate_limit',
      error_details: '429 Too Many Requests', last_assistant_message: 'API Error: Rate limit reached' }));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'a StopFailure hook has no decision control: it prints nothing');
    const lines = [];
    const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else lines.push(...fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)); } };
    walk(home);
    const ev = lines.map((l) => JSON.parse(l)).find((e) => e.cause === 'api-error');
    assert.ok(ev, 'the event is in the record under the given home');
    assert.equal(ev.error, 'rate_limit');
    assert.equal(hook('not json').status, 0, 'a bad input never fails the session');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a quota error is recognised by the adapter\'s declared patterns, with its reset text when it has one', () => {
  const patterns = ['usage limit', 'rate limit', '\\bquota\\b', '\\b429\\b', 'try again'];
  assert.deepEqual(quotaOf('ERROR: You have hit your usage limit. Try again at 4:10 PM.', patterns), { quota: true, reset_text: '4:10 PM' });
  assert.deepEqual(quotaOf('HTTP 429 Too Many Requests', patterns), { quota: true, reset_text: null });
  assert.equal(quotaOf('model not found', patterns), null);
  assert.equal(quotaOf('usage limit', []), null, 'no declared patterns: nothing is recognised');
  assert.equal(quotaOf('usage limit', ['(']), null, 'an invalid pattern is skipped, never thrown');
  assert.equal(resetTextOf('limit resets 3:45pm'), '3:45pm');
  assert.equal(resetTextOf('try again in 2 hours'), '2 hours');
});

test('codex and agy declare quota_patterns, marked unverified', () => {
  const t = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'reviewers.json'), 'utf8'));
  const adapters = t.reviewers;
  for (const name of ['codex', 'agy']) {
    assert.ok(Array.isArray(adapters[name]?.quota_patterns) && adapters[name].quota_patterns.length > 0, name);
  }
  assert.match(String(t['$capabilities']?.quota_patterns), /UNVERIFIED/, 'the declaration says its patterns are unverified');
});

// G-27 of 20261101-005402-ar-delivery: "\bquota\b" in JSON is a BACKSPACE, not a word boundary, so the declared
// patterns for a bare quota error or an HTTP 429 never matched. Held on the shipped file, not on a copy of its patterns.
test('the shipped quota patterns match a bare quota error and an HTTP 429', () => {
  const t = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'reviewers.json'), 'utf8'));
  for (const [name, a] of Object.entries(t.reviewers)) {
    if (!Array.isArray(a?.quota_patterns)) continue;
    assert.ok(!a.quota_patterns.some((p) => /[\b]/.test(p)), `${name}: a quota pattern holds a backspace character`);
    assert.ok(quotaOf('Error: quota exceeded for this project', a.quota_patterns), `${name}: a bare quota error`);
    assert.ok(quotaOf('HTTP 429 Too Many Requests', a.quota_patterns), `${name}: an HTTP 429`);
    // G-25 of 20261104-223634-ar-d1-review: a bare "try again" classed every failure that says it as a usage limit.
    for (const other of ['Authentication failed. Please log in and try again.', 'stream disconnected before completion; try again'])
      assert.equal(quotaOf(other, a.quota_patterns), null, `${name}: an ordinary failure was classed a quota error: ${other}`);
    assert.ok(quotaOf('You have hit your usage limit. Try again at 4:10 PM.', a.quota_patterns), `${name}: a usage limit with a reset`);
  }
});

// End to end through external-review, with a fake codex first on PATH that fails the way a quota error might: exit 1,
// nothing on stdout, the message on stderr. The seat is silence as before, and its not_checked entry now says why.
function fakeFailingCodex(dir, stderrText) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'),
    `if (process.argv.includes("--version")) { process.stdout.write("codex-cli 0.0.0-fake"); process.exit(0); }\nprocess.stderr.write(${JSON.stringify(stderrText)});\nprocess.exit(1);\n`);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'codex.cmd'), `@"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`);
  } else {
    const shim = path.join(binDir, 'codex');
    fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex.mjs" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  return binDir;
}
function failingSeat(stderrText) {
  return withTempDir((dir) => {
    const binDir = fakeFailingCodex(dir, stderrText);
    const home = path.join(dir, 'home');
    const sink = path.join(home, 'ev');
    fs.mkdirSync(sink, { recursive: true });
    const prompt = path.join(dir, 'prompt.md');
    fs.writeFileSync(prompt, 'Choose an entry.');
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const pathValue = `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`;
    const probes = path.join(dir, 'probes');
    seedReviewerProbe(probes, { mode: 'decide', route: 'native', pathValue });
    const out = path.join(sink, 'seat.json');
    runScript('external-review.mjs', ['--reviewer', 'codex', '--mode', 'decide', '--prompt-file', prompt, '--evidence-dir', sink, '--out', out],
      { env: { [pathKey]: pathValue, QUORATE_HOME: home, QUORATE_REVIEWER_PROBES: probes } });
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  });
}

test('a reviewer at its usage limit is silence named as a quota error, with the reset text; any other failure is not', () => {
  const q = failingSeat('ERROR: You have hit your usage limit. Try again at 4:10 PM.\n');
  assert.equal(q.result, null);
  const n = q.not_checked.find((x) => /^decision seat 'codex'/.test(x.item));
  assert.equal(n.kind, 'quota');
  assert.equal(n.reset_text, '4:10 PM');
  assert.match(n.reason, /usage limit/);
  assert.doesNotMatch(n.reason, /You have hit/, 'the vendor\'s text is not quoted into the reason');
  const other = failingSeat('error: model not found\n');
  const m = other.not_checked.find((x) => /^decision seat 'codex'/.test(x.item));
  assert.equal(m.kind, undefined);
});

test('a decision seat silent for a usage limit is recorded as quota in its round, and is silence, not a vote', async () => {
  const { runDecision } = await import('../scripts/io/decision-run.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-seat-'));
  try {
    const ok = (choice) => ({ status: 'ok', choice, rationale: `because ${choice}`, other_text: '', change_of: '', what_would_change: `if not ${choice}`, citations: [] });
    const { outcome } = await runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
      question: { question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], category: 'delegable' },
      recordDir: dir, seed: 'q', seats: ['s1', 's2', 's3'], context: '', caps: { cap: 1, hardCap: 1 },
      runSeat: async (seat) => (seat === 's3' ? { status: 'quota', reason: 'usage limit; resets 4:10 PM' } : ok('E1')),
      runModerator: async () => ({ extend: false, reason: 'n' }),
    });
    assert.equal(outcome.outcome, 'majority', 'two readable seats agreeing still decide');
    const reply = JSON.parse(fs.readFileSync(path.join(dir, 'round-1-s3-reply.json'), 'utf8'));
    assert.equal(reply.result, null);
    assert.match(reply.why, /quota/);
    assert.match(reply.why, /4:10 PM/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
