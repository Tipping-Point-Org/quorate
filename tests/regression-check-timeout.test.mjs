// M1 stage 5 (2026-10-04, operator: "Engine fix: a contract key"): story-pipeline's suite takes 11m15s on its own, and
// the pre-flight killed it at 10 minutes, 55% through (TESTS-TIMED-OUT), on every review. run-checks passed no timeout to
// capture, whose default is 10 minutes, and no contract key could change it — so a consumer with a longer suite could
// never get a test result: every gate was stamped TESTS-TIMED-OUT and capped, the suite result unknown.
//
// `review.check_timeout_minutes`: ABSENT is today's 10; a positive number is that many minutes. "" is REFUSED rather than
// read as uncapped, unlike the size caps: a check that hangs with no ceiling holds the whole run forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, REPO_ROOT, repoRunDir } from './helpers.mjs';

const lib = await import('../scripts/lib/check-timeout.mjs').catch(() => ({}));

test('the check timeout is 10 minutes when the contract does not declare one', () => {
  assert.equal(typeof lib.checkTimeoutMinutes, 'function', 'no owner for the pre-flight check timeout');
  assert.equal(lib.checkTimeoutMinutes({}), 10);
  assert.equal(lib.checkTimeoutMinutes({ review: {} }), 10);
});

// G-1 of 20261004-205244-m1-6b-check-timeout-6: every non-blank string went through Number(), so "0x2" was 2 minutes and
// "1e1" was 10. A string is accepted only as plain decimal digits — capture's --timeout-minutes always arrives as one,
// and a quoted "45" in a contract means 45 — and anything else Number() would coerce is refused.
test('a string timeout is accepted only as plain decimal digits', () => {
  assert.equal(lib.checkTimeoutMinutes({ review: { check_timeout_minutes: '45' } }), 45);
  for (const bad of ['0x2', '1e1', ' 45', '45 ', '+5', '4_5', '٣']) {
    assert.throws(() => lib.checkTimeoutMinutes({ review: { check_timeout_minutes: bad } }), /check_timeout_minutes/,
      `${JSON.stringify(bad)} was accepted`);
  }
});

test('a declared positive number of minutes is used', () => {
  assert.equal(lib.checkTimeoutMinutes({ review: { check_timeout_minutes: 30 } }), 30);
  assert.equal(lib.checkTimeoutMinutes({ review: { check_timeout_minutes: '45' } }), 45);
});

test('an empty, zero, negative or non-numeric timeout is refused, never read as uncapped', () => {
  for (const bad of ['', 0, -5, 'abc', null]) {
    assert.throws(() => lib.checkTimeoutMinutes({ review: { check_timeout_minutes: bad } }), /check_timeout_minutes/,
      `${JSON.stringify(bad)} was accepted`);
  }
});

// Driven end to end: run-checks reads the key and capture records the ceiling it was given, in every log's header, so a
// gate's reader can see what bound a check ran under and not only that it was killed.
const buildLogHeader = (review) => {
  const { base, dir } = repoRunDir({
    runId: '20260101-000000-checktimeout',
    json: { contract: { commands: { build: 'node -e 0' }, review }, stamps: [] },
  });
  try {
    const r = runScript('run-checks.mjs', ['--run-dir', dir, '--repo-root', REPO_ROOT]);
    const checks = JSON.parse(fs.readFileSync(path.join(dir, 'checks.json'), 'utf8'));
    const build = checks.results.find((c) => c.check === 'build');
    assert.ok(build?.evidence_path, `no build evidence: ${r.output ?? ''}`);
    return fs.readFileSync(path.join(dir, build.evidence_path), 'utf8').split('-'.repeat(72))[0];
  } finally {
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
};

test('run-checks passes the declared timeout to capture, which records it in the log header', () => {
  assert.match(buildLogHeader({ check_timeout_minutes: 30 }), /^# timeout: 30 minute\(s\)$/m);
});

test('with no key, the header records the 10-minute default', () => {
  assert.match(buildLogHeader({}), /^# timeout: 10 minute\(s\)$/m);
});

// G-2 and G-6 of 20261004-165507-m1-6b-check-timeout: the key accepted any positive number, while capture clamped to at
// least one minute (0.5 ran, and was logged, as 1) and passed a fraction straight to spawnSync, whose timeout must be an
// integer (1.234567 minutes threw before the command ran). The key's one owner now takes WHOLE minutes, at least 1.
test('a fractional or sub-minute timeout is refused by the key\'s one owner', () => {
  for (const bad of [0.5, 1.5, '2.25']) {
    assert.throws(() => lib.checkTimeoutMinutes({ review: { check_timeout_minutes: bad } }), /whole number/,
      `${JSON.stringify(bad)} was accepted`);
  }
  assert.equal(lib.checkTimeoutMinutes({ review: { check_timeout_minutes: 1 } }), 1);
});

// G-1 of 20261004-172841-m1-6b-check-timeout-2 (both families): capture kept its own 10-minute default and its own
// rounding while lib/check-timeout.mjs owned both and refused fractions — two owners of one rule. capture now asks the
// owner: a value the owner refuses is refused at the flag, before anything launches, with nothing crashing on the way.
const captureWith = (timeout, sentinel = null) => {
  // With a sentinel, the declared command is a script that writes it: proof the command ran, which a log's absence is not.
  let argv = ['node', '-e', '0'];
  let script = null;
  if (sentinel) {
    script = path.join(REPO_ROOT, '.sandbox', `capture-timeout-touch-${process.pid}.mjs`);
    fs.writeFileSync(script, "import fs from 'node:fs'; fs.writeFileSync(process.argv[2], 'ran');\n");
    argv = ['node', script.split(path.sep).join('/'), sentinel.split(path.sep).join('/')];
  }
  const { base, dir } = repoRunDir({
    runId: '20260101-000000-capturetimeout',
    json: { contract: { commands: { build: argv.join(' ') } }, stamps: [] },
  });
  try {
    const args = ['--run-dir', dir, '--node', 'pre-flight', '--name', 'build', '--cwd', REPO_ROOT];
    if (timeout !== undefined) args.push('--timeout-minutes', timeout);
    const r = runScript('capture.mjs', [...args, '--', ...argv]);
    const logPath = path.join(dir, 'evidence', 'pre-flight', 'build.log');
    return { r, log: fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : null };
  } finally {
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    if (script) fs.rmSync(script, { force: true });
  }
};

test('capture refuses a timeout the owner refuses, before launching anything', () => {
  // G-9 of 20261004-183024-m1-6b-check-timeout-3: this asserted only "no log" and a word in the output, so a launch that
  // aborted before writing its log, or a wrong exit status, passed too. Now: exit 2, and a child that would leave a
  // sentinel file proves it never ran.
  const sentinel = path.join(REPO_ROOT, '.sandbox', `capture-timeout-sentinel-${process.pid}`);
  fs.rmSync(sentinel, { force: true });
  // The probe is shown to bite: under a VALID timeout the same command runs and leaves the sentinel.
  assert.equal(captureWith('3', sentinel).r.status, 0);
  assert.equal(fs.existsSync(sentinel), true, 'the sentinel probe did not detect a command that ran');
  fs.rmSync(sentinel, { force: true });
  for (const bad of ['1.234567', '0', 'abc', String(Math.floor(Number.MAX_SAFE_INTEGER / 60_000) + 1)]) {
    const { r, log } = captureWith(bad, sentinel);
    assert.equal(r.status, 2, `capture did not refuse ${bad} with exit 2: ${r.output ?? ''}`);
    assert.equal(log, null, `capture wrote a log under a timeout the owner refuses (${bad})`);
    assert.equal(fs.existsSync(sentinel), false, `capture LAUNCHED the command under a refused timeout (${bad})`);
    assert.match(String(r.output ?? ''), /check_timeout_minutes/, `no reason given for ${bad}: ${r.output ?? ''}`);
  }
});

test('capture with no timeout uses the owner\'s default, and a valid one as given', () => {
  assert.match(captureWith(undefined).log ?? '', /^# timeout: 10 minute\(s\)$/m);
  assert.match(captureWith('3').log ?? '', /^# timeout: 3 minute\(s\)$/m);
});

// The upper bound. G-1 of 20261004-172841-m1-6b-check-timeout-2 said a 32-bit limit made 71,583 minutes throw, and the
// bound was set from that, never measured. Measured (G-6 of 20261004-183024-m1-6b-check-timeout-3; evidence
// spawnsync-limit.txt): spawnSync accepts every non-negative integer up to 2^63 and beyond, and throws only on a
// non-integer or Infinity. That measured what spawnSync ACCEPTS, never what it honours, so the bound is now the one every
// minutes value has, what a Node timer can hold (code-index-d1-part-a.plan.md stage 1; operator, 2026-10-21: "B").
test('a check timeout above what a timer can hold is refused by the owner', () => {
  assert.equal(lib.CHECK_TIMEOUT_MAX_MINUTES, 35_791);
  assert.ok(lib.CHECK_TIMEOUT_MAX_MINUTES * 60_000 <= 2 ** 31 - 1);
  assert.throws(() => lib.checkTimeoutMinutes({ review: { check_timeout_minutes: lib.CHECK_TIMEOUT_MAX_MINUTES + 1 } }), /at most/);
  assert.equal(lib.checkTimeoutMinutes({ review: { check_timeout_minutes: lib.CHECK_TIMEOUT_MAX_MINUTES } }), lib.CHECK_TIMEOUT_MAX_MINUTES);
});

// G-3 of the same review: the owner's header still said "a positive number", which the code no longer accepts.
test('the owner\'s header says what it accepts', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'lib', 'check-timeout.mjs'), 'utf8');
  // The sentence wraps across a `//` line, so whitespace AND comment slashes may sit between the words.
  assert.doesNotMatch(src, /A positive number is that[\s/]+many minutes/);
});

// G-10 of the same review: only the serial path was driven; the concurrent path builds its own argv (runOneAsync).
test('the concurrent pre-flight path passes the declared timeout too', () => {
  const { base, dir } = repoRunDir({
    runId: '20260101-000000-checktimeoutpool',
    json: { contract: { commands: { build: 'node -e 0', test: 'node -e 0', lint: 'node -e 0' },
      review: { check_timeout_minutes: 30, checks_concurrency: 2 } }, stamps: [] },
  });
  try {
    runScript('run-checks.mjs', ['--run-dir', dir, '--repo-root', REPO_ROOT]);
    const checks = JSON.parse(fs.readFileSync(path.join(dir, 'checks.json'), 'utf8'));
    for (const key of ['test', 'lint']) {
      const c = checks.results.find((x) => x.check === key);
      assert.ok(c?.evidence_path, `no ${key} evidence`);
      const header = fs.readFileSync(path.join(dir, c.evidence_path), 'utf8').split('-'.repeat(72))[0];
      assert.match(header, /^# timeout: 30 minute\(s\)$/m, `${key} ran under another ceiling on the concurrent path`);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
