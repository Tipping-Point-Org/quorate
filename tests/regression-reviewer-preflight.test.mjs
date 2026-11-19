// EVERY EXTERNAL REVIEWER IS TESTED BEFORE IT IS USED (reviewer-preflight.plan.md; design decided, operator 2026-10-09:
// D1 "Everything that matters (Recommended)", D2 "Egress point, probe on demand (Recommended)", D3 "Key change or age
// (Recommended)", D4 "Cap at RISK (Recommended)"). The ask, 2026-10-08: "no fallback. preflight test for what is needed
// and fails if something is missing. if the use decides to use agy or orther model preflight should be ran again".
// Split into 6 files by split-slow-test-files.md; the others are regression-reviewer-preflight-*.test.mjs, and the
// fixture they share is reviewer-preflight-fixture.mjs.

import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterErrors } from '../scripts/lib/reviewers.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { probeKey, KEY_FIELDS, recordCounts, probePassed, probeLimits, maxAgeHoursOf, adapterHash, PROBE_REVIEW_SCHEMA } from '../scripts/lib/reviewer-probe.mjs';
import { cliVersion, readProbeRecord, writeProbeRecord } from '../scripts/io/reviewer-probe.mjs';
import { REPO_ROOT, runScript, seedReviewerProbe, noRealReviewers } from './helpers.mjs';
import { classifyPanelProbe } from '../scripts/lib/decisions.mjs';
import { CAPPING_STAMPS } from '../scripts/lib/decisions.mjs';
import { base, combo, tmpHome, worker, run, safePathDirs, fakeReviewer, REVIEW_OK, setup2, calls, UNIVERSAL_OK, FAST_LIMITS, BOUND_MS, agyIsTheFake, mintFixture } from './reviewer-preflight-fixture.mjs';

test('stage 1: adapterErrors refuses a malformed version_argv', () => {
  for (const bad of ['--version', [], [''], [1], ['--version', '']]) {
    const errs = adapterErrors('fake', { ...base, version_argv: bad });
    assert.ok(errs.some((e) => /version_argv/.test(e)), `${JSON.stringify(bad)}: ${errs.join(' | ')}`);
  }
  assert.deepEqual(adapterErrors('fake', { ...base, version_argv: ['--version'] }).filter((e) => /version_argv/.test(e)), []);
});

test('stage 1: adapterErrors refuses a probe limit that is not a positive number', () => {
  for (const field of ['probe_timeout_minutes', 'version_timeout_seconds', 'check_margin_seconds']) {
    // A digit string is a minutes value like any other since the minutes owner (G-18 of 20261022-013653-cid1a-delivery);
    // the seconds limits still take numbers only, and '0x2' is refused for all three.
    const strings = field === 'probe_timeout_minutes' ? ['0x2', ''] : ['5', '0x2'];
    for (const bad of [0, -1, ...strings, null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const errs = adapterErrors('fake', { ...base, [field]: bad });
      assert.ok(errs.some((e) => e.includes(field)), `${field}=${String(bad)}: ${errs.join(' | ')}`);
    }
    assert.deepEqual(adapterErrors('fake', { ...base, [field]: 0.05 }).filter((e) => e.includes(field)), [], `${field} may be fractional`);
  }
});

test('stage 1: changing any one key field changes the key, so the old record no longer counts', () => {
  const rec = { key: probeKey(combo), state: 'passed', checked_at: '2026-10-09T00:00:00Z' };
  const now = Date.parse('2026-10-09T01:00:00Z');
  assert.equal(recordCounts(rec, combo, { now, maxAgeHours: 24 }), true);
  for (const k of KEY_FIELDS) {
    assert.equal(recordCounts(rec, { ...combo, [k]: `${combo[k]}-changed` }, { now, maxAgeHours: 24 }), false, k);
  }
  assert.notEqual(adapterHash({ cmd: 'codex', a: 1 }), adapterHash({ cmd: 'codex', a: 2 }));
  assert.equal(adapterHash({ a: 1, b: 2 }), adapterHash({ b: 2, a: 1 }), 'field order does not move the hash');
});

// THE PROBE'S OWN CODE IS PART OF ITS KEY (story-pipeline, 2026-10-16; operator: "Hash of the probe's code"): the key named
// the adapter, model, CLI and host but not the code that runs and judges the probe, so a record one engine wrote vouched
// for another engine's probe. A fixed working tree's passing records hid a pinned engine's broken probe for 24 hours.
test('a probe record is keyed by the hash of the code that runs and judges the probe', async () => {
  const lib = await import('../scripts/lib/reviewer-probe.mjs');
  assert.ok(KEY_FIELDS.includes('probe_code_hash'), JSON.stringify(KEY_FIELDS));
  assert.ok(Array.isArray(lib.PROBE_CODE_FILES) && lib.PROBE_CODE_FILES.includes('scripts/external-review.mjs')
    && lib.PROBE_CODE_FILES.includes('prompts/_templates/reviewer-probe-propose.md'), JSON.stringify(lib.PROBE_CODE_FILES));
  const files = Object.fromEntries(lib.PROBE_CODE_FILES.map((f) => [f, `content of ${f}`]));
  const h = lib.probeCodeHash((f) => files[f]);
  assert.equal(h, lib.probeCodeHash((f) => files[f]), 'stable');
  for (const f of lib.PROBE_CODE_FILES) {
    assert.notEqual(lib.probeCodeHash((g) => (g === f ? `${files[g]} edited` : files[g])), h, `${f} moves the hash`);
  }
  const io = await import('../scripts/io/reviewer-probe.mjs');
  assert.match(io.frameworkProbeCodeHash(), /^[0-9a-f]{16}$/, 'the engine hashes its own files');
});

// G-9 of 20261016-193355-sp-bugs-review: PROBE_CODE_FILES left out scripts/lib/reviewer-schemas.mjs, which builds the
// probe's schemas and judges its response, and scripts/io/reviewer-probe.mjs, which runs the version command and writes
// the record — so editing either left the key unchanged and an old passing record vouched for the changed probe. Every
// module the probe's pure half imports is in the list, read from its import lines rather than restated here.
test('G-9: every module the probe imports, and its I/O half, are in PROBE_CODE_FILES', async () => {
  const lib = await import('../scripts/lib/reviewer-probe.mjs');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const src = fs.readFileSync(path.join(root, 'scripts/lib/reviewer-probe.mjs'), 'utf8');
  const imported = [...src.matchAll(/^import [^;]*? from '\.\/([^']+)';/gm)].map((m) => `scripts/lib/${m[1]}`);
  assert.ok(imported.includes('scripts/lib/reviewer-schemas.mjs'), `the probe's imports were read: ${imported.join(', ')}`);
  const missing = [...imported, 'scripts/io/reviewer-probe.mjs'].filter((f) => !lib.PROBE_CODE_FILES.includes(f));
  assert.deepEqual(missing, [], `the probe's code not in its key: ${missing.join(', ')}`);
  for (const f of lib.PROBE_CODE_FILES) assert.ok(fs.existsSync(path.join(root, f)), `${f} exists`);
});

// G-9 of 20261016-204040-sp-bugs-remediation-review: the test above read only the pure half's DIRECT imports, so the list
// still left out scripts/lib/adjudication.mjs (the tie-break probe's participants and prompt), scripts/io/spawn-capture.mjs
// and the platform's process adapter (the spawn and the kill). The probe is scripts/external-review.mjs run again, so
// everything that file and the I/O half load, followed through their own imports, is code that runs or judges a probe.
test('G-9 (r2): every module the probe loads, followed through its imports, is in PROBE_CODE_FILES', async () => {
  const lib = await import('../scripts/lib/reviewer-probe.mjs');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const importsOf = (f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const specs = [...src.matchAll(/^(?:import|export)\s[^;]*?\bfrom\s+'(\.{1,2}\/[^']+)'/gm), ...src.matchAll(/\bimport\(\s*'(\.{1,2}\/[^']+)'\s*\)/g)];
    return specs.map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])));
  };
  const seen = new Set();
  const queue = ['scripts/external-review.mjs', 'scripts/io/reviewer-probe.mjs'];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    queue.push(...importsOf(f));
  }
  for (const f of ['scripts/lib/adjudication.mjs', 'scripts/io/spawn-capture.mjs', 'scripts/platform/index.mjs']) {
    assert.ok(seen.has(f), `the closure was followed: ${f} reached (${[...seen].join(', ')})`);
  }
  const missing = [...seen].filter((f) => !lib.PROBE_CODE_FILES.includes(f)).sort();
  assert.deepEqual(missing, [], `the probe's code not in its key: ${missing.join(', ')}`);
});

// G-12 of 20261016-214749-sp-bugs-remediation-2-review: the list held every module but not every TEMPLATE the probe reads.
// buildTieBreakPrompt reads prompts/_templates/brief-feedback.md into every tie-break probe, and it was not in the list, so
// editing it left the key unchanged and an old passing record vouched for a prompt never sent. The templates are read from
// what building the probe's prompts actually opens, not restated here.
test('G-12: every template the probe\'s prompts read is in PROBE_CODE_FILES', async () => {
  const lib = await import('../scripts/lib/reviewer-probe.mjs');
  const { buildTieBreakPrompt } = await import('../scripts/lib/review-prompts.mjs');
  const { readTemplate } = await import('../scripts/lib/template.mjs');
  const { adjudicationBrief, renderVoteVocabulary } = await import('../scripts/lib/adjudication.mjs');
  const { hostPlatform } = await import('../scripts/platform/index.mjs');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const host = hostPlatform();
  const read = new Set();
  const seen = (p) => {
    const rel = path.relative(root, String(p)).split(path.sep).join('/');
    if (rel.startsWith('prompts/')) read.add(rel);
  };
  // openSync too (G-9 of 20261112-154323-hl-review-c): a template is read through the egress owner's bounded read, which
  // opens a descriptor rather than calling readFileSync.
  const io = { ...host, fs: { ...host.fs,
    readFileSync: (p, ...rest) => { seen(p); return host.fs.readFileSync(p, ...rest); },
    openSync: (p, ...rest) => { seen(p); return host.fs.openSync(p, ...rest); },
  } };
  // The same three prompts external-review's --probe-run writes (tie-break, propose, review).
  const group = lib.probeDispute({ armSource: 'codex', armNodeId: 'panel-codex-code' });
  const brief = adjudicationBrief({ group, excerpt: group.excerpt });
  buildTieBreakPrompt({ ...group, groupId: group.group_id, judgeCount: 1,
    voteVocabulary: renderVoteVocabulary(brief.participants), mechanicalFacts: brief.mechanicalFacts, io });
  readTemplate('reviewer-probe-propose.md', io);
  readTemplate('reviewer-probe-review.md', io);
  assert.ok(read.has('prompts/_templates/tie-break.md'), `the reads were seen: ${[...read].join(', ')}`);
  const missing = [...read].filter((f) => !lib.PROBE_CODE_FILES.includes(f)).sort();
  assert.deepEqual(missing, [], `templates the probe reads, not in its key: ${missing.join(', ')}`);
});

test('stage 1: age — absent is 24 h, "" is no limit, a failed record never counts, a malformed limit is refused', () => {
  const key = probeKey(combo);
  const at = (h) => ({ key, state: 'passed', checked_at: new Date(Date.parse('2026-10-09T00:00:00Z') - h * 3_600_000).toISOString() });
  const now = Date.parse('2026-10-09T00:00:00Z');
  assert.equal(maxAgeHoursOf(undefined), 24);
  assert.equal(maxAgeHoursOf(''), null);
  assert.equal(maxAgeHoursOf(1), 1);
  for (const bad of [0, -1, '24', null]) assert.throws(() => maxAgeHoursOf(bad), /reviewer_probe_max_age_hours/);
  assert.equal(recordCounts(at(23), combo, { now, maxAgeHours: 24 }), true);
  assert.equal(recordCounts(at(25), combo, { now, maxAgeHours: 24 }), false);
  assert.equal(recordCounts(at(1000), combo, { now, maxAgeHours: null }), true);
  assert.equal(recordCounts({ ...at(1), state: 'failed' }, combo, { now, maxAgeHours: null }), false);
});

test('stage 1: a probe passes only with its own mode\'s answer, and never as an unavailable envelope', () => {
  assert.equal(probePassed('review', { verdict: 'PASS', not_checked: [] }), true);
  // At least one candidate (G-5 of 20261010-034246-reviewer-preflight-r3): this line pinned an empty pool as a pass.
  assert.equal(probePassed('propose', { candidates: [{ name: 'probe' }], not_checked: [] }), true);
  assert.equal(probePassed('propose', { candidates: [], not_checked: [] }), false);
  assert.equal(probePassed('tie-break', { supports: 'lens', not_checked: [] }), true);
  assert.equal(probePassed('review', { candidates: [] }), false, 'a propose envelope does not pass review');
  // What unavailable() emits in each mode (scripts/external-review.mjs): shapes that look like answers.
  assert.equal(probePassed('review', { verdict: 'RISK', not_checked: [{ item: "external reviewer 'codex'", reason: 'x' }] }), false);
  assert.equal(probePassed('propose', { candidates: [], not_checked: [{ item: "external proposer 'codex'", reason: 'x' }] }), false);
  assert.equal(probePassed('tie-break', { supports: null, not_checked: [{ item: "tie-breaker 'agy'", reason: 'x' }] }), false);
  assert.equal(probePassed('tie-break', { supports: '  ', not_checked: [] }), false);
  assert.equal(probePassed('review', { verdict: 'PASS', status: 'incomplete' }), false);
});

test('stage 1: the limits come from the adapter, else probe_defaults; the bound covers a stale wait and the check', () => {
  const defaults = { probe_timeout_minutes: 5, version_timeout_seconds: 30, check_margin_seconds: 60 };
  const l = probeLimits({}, defaults);
  // G-4: the probe child = version + probe + margin; a holder = one child; a check = version + wait + child + margin.
  assert.equal(l.probeChildMs, 30_000 + 300_000 + 60_000);
  assert.equal(l.staleMs, l.probeChildMs);
  assert.equal(l.checkBoundMs, 30_000 + (390_000 + 60_000) + 390_000 + 60_000);
  const f = probeLimits({ probe_timeout_minutes: 0.05, version_timeout_seconds: 1, check_margin_seconds: 0.5 }, defaults);
  assert.equal(f.checkBoundMs, 1000 + (4500 + 500) + 4500 + 500, 'fractional, in one unit');
  assert.throws(() => probeLimits({}, {}), /probe_defaults/);
});

test('stage 1: the CLI version — undeclared, a failure, and a command that never returns', () => {
  // A GENEROUS limit for the commands that exit, and 0.5 s only for the one that never does: node's own start-up can
  // take longer than half a second on a loaded machine, and "exited 3" then read as a timeout (seen once, in the suite
  // that ran beside the delivery review's remediation).
  const lim = probeLimits({ version_timeout_seconds: 30 }, { probe_timeout_minutes: 5, check_margin_seconds: 1 });
  const tight = probeLimits({ version_timeout_seconds: 0.5 }, { probe_timeout_minutes: 5, check_margin_seconds: 1 });
  // `dropped` is the count of PATH entries left out (G-8 of 20261017-064450; on the undeclared branch too, G-9 of
  // 20261017-173539): this host's PATH decides it, not the test.
  const undeclared = cliVersion({ cmd: 'x' }, lim);
  assert.deepEqual({ ok: undeclared.ok, version: undeclared.version }, { ok: true, version: 'undeclared' });
  assert.equal(typeof undeclared.dropped, 'number');
  const node = process.execPath;
  const passed = cliVersion({ cmd: node, version_argv: ['-e', 'process.stdout.write("v9\\n")'] }, lim);
  assert.deepEqual({ ok: passed.ok, version: passed.version }, { ok: true, version: 'v9' });
  assert.equal(typeof passed.dropped, 'number');
  const failed = cliVersion({ cmd: node, version_argv: ['-e', 'process.exit(3)'] }, lim);
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /exited 3/);
  const t0 = Date.now();
  const hung = cliVersion({ cmd: node, version_argv: ['-e', 'setInterval(() => {}, 1000)'] }, tight);
  assert.equal(hung.ok, false);
  assert.match(hung.reason, /did not exit within 0.5 s/);
  assert.ok(Date.now() - t0 < 10_000, 'bounded, not waiting for ever');
});

test('stage 1: two processes on ONE key make one probe; the second uses the first\'s record', async (t) => {
  const home = tmpHome(t);
  const log = path.join(home, 'log.txt');
  const key = probeKey(combo);
  await Promise.all([run(worker(home, key, log)), run(worker(home, key, log))]);
  assert.equal(fs.readFileSync(log, 'utf8'), 'probe\n', 'exactly one probe');
  assert.equal(readProbeRecord(home, key).state, 'passed');
});

test('stage 1: two processes on DIFFERENT keys both keep their records', async (t) => {
  const home = tmpHome(t);
  const log = path.join(home, 'log.txt');
  const k1 = probeKey(combo);
  const k2 = probeKey({ ...combo, model: 'other' });
  await Promise.all([run(worker(home, k1, log)), run(worker(home, k2, log))]);
  assert.ok(readProbeRecord(home, k1) && readProbeRecord(home, k2));
});

test('stage 1: a leftover lock whose holder is dead is reclaimed once stale; a live holder\'s never is', async (t) => {
  const home = tmpHome(t);
  const log = path.join(home, 'log.txt');
  const key = probeKey(combo);
  const dir = path.join(home, 'reviewer-probes');
  fs.mkdirSync(dir, { recursive: true });
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
  const lock = path.join(dir, `${key}.lock`);
  fs.writeFileSync(lock, dead);
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  await run(worker(home, key, log));
  assert.equal(fs.readFileSync(log, 'utf8'), 'probe\n', 'the dead holder\'s lock was reclaimed and the waiter probed');
  // A live holder (this test process) with an old lock: never taken; the waiter's bounded wait runs out.
  const k2 = probeKey({ ...combo, model: 'live' });
  const lock2 = path.join(dir, `${k2}.lock`);
  fs.writeFileSync(lock2, String(process.pid));
  fs.utimesSync(lock2, old, old);
  const code = await run(worker(home, k2, log));
  assert.notEqual(code, 0, 'the waiter gave up rather than taking a live holder\'s lock');
  assert.equal(readProbeRecord(home, k2), null);
});

test('stage 2: a reviewer whose probe fails is refused (exit 5, named), and the main call never happens', (t) => {
  const { fake, call } = setup2(t, { body: 'not json at all', probeBody: 'not json at all' });
  const r = call();
  assert.equal(r.status, 5, r.output);
  const env = JSON.parse(r.stdout);
  const named = env.not_checked.find((n) => n.item === "external reviewer 'codex'");
  assert.ok(named && /^reviewer preflight failed for codex\//.test(named.reason), JSON.stringify(env.not_checked));
  assert.deepEqual(calls(fake), ['probe'], 'probed, and never called');
});

// G-6 of 20261017-071826-rpe-remediation-2-review (I-5): a preflight that failed after the version probe had filtered
// PATH returned only its reason, and the refusal exited before either line that says the dropped count on stderr.
test('G-6: a failed preflight says on stderr how many PATH entries were left out of the reviewer\'s PATH', (t) => {
  const { fake, call } = setup2(t, { body: 'nope', probeBody: 'nope' });
  const r = call([], { [fake.pathKey]: ['relative-a', fake.pathValue].join(path.delimiter) });
  assert.equal(r.status, 5, r.output);
  assert.match(r.stderr, /external-review: 1 PATH entry relative or inside the repository was left out of the reviewer's PATH/, r.stderr);
});

test('stage 2: a passing probe is recorded once and reused; a changed model probes again', (t) => {
  const { fake, call, probes } = setup2(t, { body: REVIEW_OK });
  assert.equal(call().status, 0);
  assert.equal(call().status, 0);
  assert.deepEqual(calls(fake), ['probe', 'call', 'call']);
  assert.equal(fs.readdirSync(probes).filter((f) => f.endsWith('.json')).length, 1);
  assert.equal(call(['--model', 'another-model']).status, 0);
  assert.deepEqual(calls(fake), ['probe', 'call', 'call', 'probe', 'call'], 'a different combination');
});

test('stage 2: the probe runs in an EMPTY temporary directory, never the caller\'s, and it is gone afterwards', (t) => {
  const { fake, call } = setup2(t, { body: REVIEW_OK });
  call();
  const probeLine = fake.kinds().find((l) => l.startsWith('probe '));
  const cwd = probeLine.slice('probe '.length);
  // The --probe-run child's own empty repository, not even the one runProbe handed it (G-3 of
  // 20261020-190617-argv-remediation-4-review): the reviewer starts where no caller can put anything after the check.
  assert.match(path.basename(cwd), /^quorate-probe-run-/);
  assert.notEqual(path.resolve(cwd), path.resolve(REPO_ROOT));
  assert.equal(fs.existsSync(cwd), false, 'removed after the probe');
});

test('stage 2: each mode and route is probed in its own mode, and recorded under its own key', (t) => {
  const { fake, call, probes, dir } = setup2(t, {
    body: JSON.stringify({ status: 'ok', candidates: [{ name: 'probe' }], not_checked: [], supports: 'neither', confidence: 'high', rationale: 'x', verdict: 'PASS', findings: [] }),
  });
  assert.equal(call(['--mode', 'propose', '--schema', '{"candidates":"array"}']).status, 0);
  assert.equal(call(['--mode', 'propose', '--schema', '{"candidates":"array"}', '--candidate-fields', 'name']).status, 0);
  const records = fs.readdirSync(probes).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(probes, f), 'utf8')));
  assert.deepEqual(records.map((r) => `${r.mode}/${r.route}`).sort(), ['propose/native', 'propose/prompt-and-scan']);
  assert.ok(records.every((r) => r.state === 'passed' && r.cli_version === 'fake-codex 1.0'));
  void fake; void dir;
});

test('stage 2: with --out, a refusal writes the refusal envelope to the reserved file', (t) => {
  const { call, dir } = setup2(t, { body: 'nope', probeBody: 'nope' });
  const home = path.join(dir, 'home');
  const sink = path.join(home, 'ev');
  fs.mkdirSync(sink, { recursive: true });
  const out = path.join(sink, 'codex.json');
  const r = call(['--mode', 'propose', '--schema', '{"candidates":"array"}', '--evidence-dir', sink, '--out', out], { QUORATE_HOME: home });
  assert.equal(r.status, 5, r.output);
  assert.equal(fs.readFileSync(out, 'utf8'), r.stdout, 'the refusal is the response written there');
});

// A PREFLIGHT REFUSAL KEEPS THE PROBE'S RAW OUTPUT (story-pipeline, 2026-10-16; M2 plan stage 7c): the probe child was
// spawned without the caller's --evidence-dir or --run-dir, so a refused preflight reported "neither --run-dir nor
// --evidence-dir was given" when one was, and the reviewer's answer, the one diagnostic, was discarded. request/SKILL.md
// promises that passing --evidence-dir keeps the raw output.
test('a preflight refusal keeps the probe\'s raw output under the caller\'s --evidence-dir, and says where', (t) => {
  const { call, dir } = setup2(t, { body: 'not json at all', probeBody: 'the probe answered in prose' });
  const home = path.join(dir, 'home');
  const sink = path.join(home, 'ev');
  fs.mkdirSync(sink, { recursive: true });
  const r = call(['--mode', 'propose', '--schema', '{"candidates":"array"}', '--evidence-dir', sink], { QUORATE_HOME: home });
  assert.equal(r.status, 5, r.output);
  const reason = JSON.parse(r.stdout).not_checked.map((n) => n.reason).join(' | ');
  assert.doesNotMatch(reason, /neither --run-dir nor --evidence-dir was given/, reason);
  const logs = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else logs.push(p); } };
  walk(sink);
  const kept = logs.find((p) => fs.readFileSync(p, 'utf8').includes('the probe answered in prose'));
  assert.ok(kept, `the probe's answer is kept under ${sink}: ${JSON.stringify(logs)}`);
});

// G-5 of 20261016-193355-sp-bugs-review: a call given --run-dir resolves its adapter from the run's FROZEN contract, but
// its probe child was handed --evidence-dir, so the child read the LIVE contract's reviewers and probed whatever adapter
// that named — then the parent recorded the result under the frozen adapter's key. Here the adapter exists only in the
// frozen contract: a child reading the live one cannot find it, and the probe fails.
test('G-5: under --run-dir the probe child reads the run\'s frozen reviewers, not the live contract\'s', async (t) => {
  const { call, dir, fake } = setup2(t, { body: REVIEW_OK });
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q', '--template='], { cwd: repo });
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/reviews/\n');
  const { builtinReviewers } = await import('../scripts/io/reviewers.mjs');
  const runDir = path.join(repo, '.claude', 'reviews', '20261016-000000-frozen');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
    run_id: '20261016-000000-frozen', repo_root: repo, contract: { review: { external_panel: true }, reviewers: { frozenrev: builtinReviewers().codex } },
  }));
  const r = runScript('external-review.mjs', [
    '--reviewer', 'frozenrev', '--prompt-file', path.join(dir, 'prompt.md'), '--schema', '{"verdict":"PASS|RISK|FAIL"}',
    '--consent', 'transport-probe', '--run-dir', runDir,
  ], { cwd: repo, env: { [fake.pathKey]: fake.pathValue, QUORATE_REVIEWER_PROBES: path.join(dir, 'probes') } });
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(calls(fake), ['probe', 'call'], 'the frozen adapter was probed, then called');
  void call;
});

// PROPOSE WITHOUT --candidate-fields READS THE REVIEWER'S ANSWER, NOT ITS TRANSPORT (story-pipeline, 2026-10-16): on the
// prompt-and-scan path codex was given no --output-last-message, and its stdout under --json is an event stream with the
// answer string-escaped inside it, so a correct one-candidate answer read as "no parseable proposal batch".
test('a codex proposer answering correctly passes the propose preflight on the prompt-and-scan path', (t) => {
  const answer = JSON.stringify({ candidates: [{ name: 'probe' }], not_checked: [], status: 'ok' });
  const { call, dir } = setup2(t, { body: answer, probeBody: answer, jsonl: true });
  const home = path.join(dir, 'home');
  const r = call(['--mode', 'propose', '--schema', '{"candidates":"array"}', '--preflight-only'], { QUORATE_HOME: home });
  assert.equal(r.status, 0, r.output);
});

// THE PROBE BRINGS ITS OWN SCHEMA (story-pipeline, 2026-10-16): with the caller's --candidate-fields the probe built its
// schema from the caller's fields (kind, concern, ...) and then demanded a candidate NAMED "probe". A reviewer that
// answered that schema exactly ({"kind":"probe", ...}) was refused, on codex and agy alike.
test('the native propose probe passes for a reviewer obeying its schema, whatever --candidate-fields the caller gave', (t) => {
  const { call, dir } = setup2(t, { body: '{}', schemaAware: true });
  const home = path.join(dir, 'home');
  const r = call(['--mode', 'propose', '--schema', '{"candidates":"array"}', '--candidate-fields', 'kind,concern,why,suggestion,confidence',
    '--preflight-only'], { QUORATE_HOME: home });
  assert.equal(r.status, 0, r.output);
});

test('stage 2: a refused arm or judge is recognised as UNAVAILABLE with the probe\'s reason (what run-graph classifies)', (t) => {
  // run-graph parses an arm's stdout whatever the exit and classifies it with classifyPanelProbe (run-graph.mjs:2437-2455),
  // and takes a judge's state from the same classification (:3984) — so the refusal must carry the recognised subject.
  const { call } = setup2(t, { body: 'nope', probeBody: 'nope' });
  const arm = JSON.parse(call().stdout);
  const armCls = classifyPanelProbe(arm, 'codex');
  assert.equal(armCls.state, 'unavailable');
  assert.match(armCls.reason, /reviewer preflight failed for codex\/[^:]*\/review\//);
  const judge = JSON.parse(call(['--mode', 'tie-break', '--participants', 'code-audit,panel-codex-code']).stdout);
  const judgeCls = classifyPanelProbe(judge, 'codex');
  assert.equal(judgeCls.state, 'unavailable', 'a refused judge is not OK (G-25/G-33)');
  assert.match(judgeCls.reason, /reviewer preflight failed for codex\/[^:]*\/tie-break\//, 'probed in its own mode');
});
