// Part 5 of 6 of regression-reviewer-preflight.test.mjs: a check child failing, check-reviewers, tie-break probes and
// PANEL-DEGRADED. Split by split-slow-test-files.md; the fixture is reviewer-preflight-fixture.mjs.

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

test('stage 3: a child that crashes is refused, naming its exit', (t) => {
  const f = mintFixture(t);
  const r = f.mint(['--test-preflight-crash']);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /preflight check (?:for|of) codex[^\n]*exited 1/, r.output);
  assert.deepEqual(f.runs(), []);
});

test('stage 3: a child that refuses its arguments (exit 2) is refused with the CHILD\'s usage reason', (t) => {
  // An adapter declared for review only: new-run accepts the contract, and external-review refuses the judge's mode.
  const f = mintFixture(t, { contractExtra: ['    modes: ["review"]'] });
  const r = f.mint();
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /agy[^\n]*usage: [^\n]*supports only: review/, r.output);
  assert.deepEqual(f.runs(), []);
});

test('stage 3: runScript refuses a mint that could probe real reviewers, unless the test says so', () => {
  // THIS repository's contract has the panel on, so an unguarded mint here would probe — and bill — codex and agy.
  // The trailing unknown flag makes new-run refuse at its parser when the guard is absent (as at HEAD), so this test can
  // never reach a canary or a reviewer whichever way it fails.
  assert.throws(() => runScript('new-run.mjs', ['--slug', 'unguarded', '--full-sweep', 'scripts', '--unknown-flag-guard-test']),
    /--no-verify-reviewers/);
  // The guards that need no flag: a dry run and --print-contract mint nothing.
  assert.doesNotThrow(() => runScript('new-run.mjs', ['--dry-run']));
});

// A PARTIAL OVERRIDE OF A BUILT-IN REVIEWER IS VALIDATED MERGED (found writing stage 3). mergeReviewers merges a declared
// entry into its built-in field by field, and external-review validates that merged adapter; new-run validated the
// declaration ALONE, so a contract declaring only `codex: { probe_timeout_minutes: … }` was refused at mint for lacking
// `cmd`, `response.from` and `prompt.via` — fields the merge supplies. The two checks of one adapter disagreed.
test('a contract overriding one field of a built-in reviewer mints: the adapter is validated as merged', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-pf3m-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q', dir]);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 5', 'project: t', 'commands:',
    '  build: ""', '  test: ""', 'reviewers:', '  codex:', '    probe_timeout_minutes: 0.25', '```', ''].join('\n'));
  for (const a of [['add', '-A'], ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-qm', 'init']]) spawnSync('git', a, { cwd: dir });
  const r = runScript('new-run.mjs', ['--repo-root', dir, '--dry-run', '--no-request', '--full-sweep', '.']);
  assert.equal(r.status, 0, r.output);
  // And a declaration that is unusable even merged is still refused, naming the field.
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 5', 'project: t', 'commands:',
    '  build: ""', '  test: ""', 'reviewers:', '  codex:', '    probe_timeout_minutes: -1', '```', ''].join('\n'));
  const bad = runScript('new-run.mjs', ['--repo-root', dir, '--dry-run', '--no-request', '--full-sweep', '.']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.output, /probe_timeout_minutes/);
});

// ------------------------------------------------------------------ stage 4: one probe command
// check-reviewers runs the preflight for every combination at once, from the function new-run's mint check uses, and
// exits 0 only when every one passed. Red first: the script did not exist.
test('stage 4: check-reviewers checks every roster combination, and exits 0 only when all of them pass', (t) => {
  const f = mintFixture(t);
  const ok = runScript('check-reviewers.mjs', [], { cwd: f.repo, env: { ...f.env, QUORATE_LIVE: '1' } });
  assert.equal(ok.status, 0, ok.output);
  // The agy judge's model READ FROM THE ROSTER: it was a literal here, and moving the pin (Gemini 3.1 Pro left agy,
  // 2026-10-12) failed this test while every combination passed.
  const roster = JSON.parse(fs.readFileSync(new URL('../scripts/lens-roster.json', import.meta.url), 'utf8'));
  const agyJudge = roster.adjudicators.find((j) => j.reviewer === 'agy').model;
  for (const c of ['codex/gpt-5.6-sol/high/review', 'codex/gpt-5.6-sol/high/tie-break', `agy/${agyJudge}/(ambient effort)/tie-break`]) {
    assert.ok(ok.output.includes(`passed  ${c}`), `${c}\n${ok.output}`);
  }
  // One judge failing is a failure of the check (G-8 of check-tiebreak, which exited 0 with a judge silent).
  const g = mintFixture(t, { agyBody: 'not json' });
  const bad = runScript('check-reviewers.mjs', [], { cwd: g.repo, env: { ...g.env, QUORATE_LIVE: '1' } });
  assert.equal(bad.status, 1, bad.output);
  assert.match(bad.output, /FAILED  agy\/[^\n]*tie-break[^\n]*reviewer preflight failed/);
  assert.match(bad.output, /passed  codex\/gpt-5\.6-sol\/high\/review/, 'the others are still reported');
});

// PROPOSE IS CHECKED TOO (story-pipeline, 2026-10-16): check-reviewers probed the roster's review and tie-break
// combinations only, so it reported "all passed" while every propose call (candidate-pool, request's critique) was
// refused. Each reviewer the roster uses, at its model and effort, is now probed in propose on both routes.
test('check-reviewers probes propose for each roster reviewer, on the prompt-and-scan and native routes', (t) => {
  const f = mintFixture(t);
  const ok = runScript('check-reviewers.mjs', [], { cwd: f.repo, env: { ...f.env, QUORATE_LIVE: '1' } });
  assert.equal(ok.status, 0, ok.output);
  for (const c of ['codex/gpt-5.6-sol/high/propose/prompt-and-scan', 'codex/gpt-5.6-sol/high/propose/native']) {
    assert.ok(ok.output.includes(`passed  ${c}`), `${c}\n${ok.output}`);
  }
  assert.match(ok.output, /passed  agy\/[^\n]*\/propose\/native/);
});

test('stage 4: check-reviewers uses a record that counts, and --force probes again', (t) => {
  const f = mintFixture(t);
  const run = (a) => runScript('check-reviewers.mjs', a, { cwd: f.repo, env: { ...f.env, QUORATE_LIVE: '1' } });
  assert.equal(run([]).status, 0);
  const probes = () => f.probed().filter((l) => l.startsWith('probe ')).length;
  // Ten since autonomous-run.plan.md stage 4: three roster, four propose, the claim checker's pin, and the two decision
  // panel seats (claim-check-cross-family.plan.md stage 6 brought it to eight).
  assert.equal(probes(), 10, `ten combinations (three roster, four propose, one claim-check, two decide), each probed once: ${JSON.stringify({ codex: f.codex.kinds(), agy: f.agy.kinds() })}`);
  assert.equal(run([]).status, 0);
  assert.equal(probes(), 10, 'a record that counts is used');
  assert.equal(run(['--force']).status, 0);
  assert.equal(probes(), 20, '--force probes every one again');
});

test('stage 4: check-reviewers spends nothing without QUORATE_LIVE=1, and a graph node may not run it', (t) => {
  const f = mintFixture(t);
  const r = runScript('check-reviewers.mjs', [], { cwd: f.repo, env: f.env });
  assert.equal(r.status, 2);
  assert.match(r.output, /QUORATE_LIVE=1/);
  assert.deepEqual(f.probed(), []);
  const nested = runScript('check-reviewers.mjs', [], { cwd: f.repo, env: { ...f.env, QUORATE_LIVE: '1', GRAPH_NODE_DEPTH: '1' } });
  assert.equal(nested.status, 3);
  assert.deepEqual(f.probed(), []);
});

// NO TEST REACHES A REAL REVIEWER CLI (found in stage 4): the fixtures' agy probes were answered by the operator's real
// agy — an .exe, which a fake .cmd first on PATH cannot shadow for a spawn without a shell — and billed. runScript now
// removes every directory of the developer's PATH that holds a reviewer CLI, and keeps a directory a test added.
test('runScript never hands a script a PATH that reaches the developer\'s real codex or agy', (t) => {
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const real = String(process.env[pathKey] ?? '').split(path.delimiter).filter((d) => d
    && ['codex', 'agy'].some((n) => ['', '.exe', '.cmd', '.bat', '.com', '.ps1'].some((e) => fs.existsSync(path.join(d, n + e)))));
  const fakes = fs.mkdtempSync(path.join(os.tmpdir(), 'q-norev-'));
  t.after(() => fs.rmSync(fakes, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fakes, process.platform === 'win32' ? 'agy.cmd' : 'agy'), '');
  for (const given of [{}, { [pathKey]: `${fakes}${path.delimiter}${process.env[pathKey]}` }]) {
    const out = noRealReviewers(given)[pathKey].split(path.delimiter);
    for (const d of real) assert.ok(!out.includes(d), `${d} holds a real reviewer CLI and must not reach a script`);
    if (given[pathKey]) assert.equal(out[0], fakes, 'a directory the test added is kept, first');
  }
});

// ------------------------------------------------------------------ stage 4: guarantees moved from check-tiebreak
// G-7 of m0-gate-review (tests/regression-m0-gate-review-remediation, which grepped check-tiebreak): a vote outside the
// dispute's positions is illegible, not a ruling. The tie-break probe now lives in external-review, and its pass rule is
// probePassed — which accepted ANY non-empty `supports`.
test('stage 4: a tie-break probe passes only on a vote for one of the positions, or "neither"', () => {
  const participants = ['code-audit', 'panel-codex-code'];
  const vote = (supports) => probePassed('tie-break', { status: 'ok', supports, confidence: 'high', rationale: 'x' }, { participants });
  assert.equal(vote('code-audit'), true);
  assert.equal(vote('neither'), true);
  assert.equal(vote('somebody-else'), false, 'a vote outside the positions is illegible');
  assert.equal(vote(''), false);
});

// check-tiebreak validated each judge's model and effort BEFORE spending a call (tests/regression-tiebreak-probe, "the
// pinned model and effort are validated BEFORE spending a call"). The preflight's probe IS a call, so external-review
// validates the assignment before it: agy rejects an effort for a model whose name carries one.
test('stage 4: an assignment the adapter rejects is refused before any probe (exit 2, nothing spent)', (t) => {
  const { dir, prompt } = setup2(t, { body: REVIEW_OK });
  const fakeAgy = fakeReviewer(dir, { name: 'agy', body: REVIEW_OK });
  const r = runScript('external-review.mjs', ['--reviewer', 'agy', '--model', 'Gemini 3.1 Pro (High)', '--effort', 'high',
    '--mode', 'tie-break', '--prompt-file', prompt, '--consent', 'transport-probe'],
  { env: { [fakeAgy.pathKey]: fakeAgy.pathValue, QUORATE_REVIEWER_PROBES: path.join(dir, 'probes') } });
  assert.equal(r.status, 2, r.output);
  assert.match(r.output, /rejects an effort for model 'Gemini 3\.1 Pro \(High\)'/);
  assert.deepEqual(fakeAgy.kinds(), [], 'nothing was asked of the reviewer, not even its version');
});

// THE OLD PROBES ARE GONE, NOT MERELY UNUSED (stage 4). check-panel.mjs and check-tiebreak.mjs were deleted with their
// records (.claude/panel-check.json, .claude/tiebreak-check.json) and their reader (panelProbeGap, panelProbePath). No
// code under scripts/ may still import, spawn, call or build a path to any of them; comments naming them are history
// and stay. Comment lines are dropped before the search — `//` lines and the `*` lines of a block comment.
test('stage 4: no code under scripts/ references the retired probes, their records or their reader', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? walk(path.join(d, e.name)) : e.name.endsWith('.mjs') ? [path.join(d, e.name)] : []));
  const retired = /check-panel|check-tiebreak|panel-check\.json|tiebreak-check\.json|panelProbeGap|panelProbePath/;
  const hits = [];
  for (const file of walk(path.join(REPO_ROOT, 'scripts'))) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const code = line.replace(/\/\/.*$/, '');
      if (retired.test(code)) hits.push(`${path.relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
  for (const gone of ['check-panel.mjs', 'check-tiebreak.mjs']) {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'scripts', gone)), false, `${gone} is retired`);
  }
});

// ------------------------------------------------------------------ stage 5 (D4): a mid-run failure caps
// A reviewer whose combination passed at mint and then failed during the run is PANEL-DEGRADED, which caps the gate at
// RISK: the run was promised a panel that had been shown to work, and part of it did not answer. Decided by one pure
// function over the frozen run.json.reviewer_preflight and each panel call's outcome; red first, it did not exist.
test('stage 5: a call that failed after its combination passed at mint is degraded; nothing else is', async () => {
  const { panelDegraded } = await import('../scripts/lib/reviewer-probe.mjs');
  const preflight = [
    { key: 'k1', adapter: 'codex', model: 'gpt-5.6-sol', effort: 'high', mode: 'review', route: 'native', state: 'passed' },
    { key: 'k2', adapter: 'agy', model: 'Gemini 3.1 Pro (High)', effort: '', mode: 'tie-break', route: 'native', state: 'passed' },
  ];
  // Each call carries its schema route, as run-graph's do (G-10 of 20261010-085904): these are all native.
  const call = (id, reviewer, model, effort, mode, ok) => ({ id, reviewer, model, effort, mode, route: 'native', ok });
  const calls = [
    call('panel-codex-code', 'codex', 'gpt-5.6-sol', 'high', 'review', true),
    call('panel-codex-docs', 'codex', 'gpt-5.6-sol', 'high', 'review', false),     // timed out mid-run
    call('adjudicate-G-1-agy', 'agy', 'Gemini 3.1 Pro (High)', '', 'tie-break', false), // refused, record aged out
  ];
  assert.deepEqual(panelDegraded({ preflight, calls }), ['panel-codex-docs', 'adjudicate-G-1-agy']);
  // Guards. Every call answering leaves nothing.
  assert.deepEqual(panelDegraded({ preflight, calls: calls.map((c) => ({ ...c, ok: true })) }), []);
  // A run minted before this change, or with the panel off, has no record: no stamp from this rule.
  assert.deepEqual(panelDegraded({ preflight: null, calls }), []);
  assert.deepEqual(panelDegraded({ preflight: undefined, calls }), []);
  // --no-verify-reviewers: already capped by REVIEWERS-UNVERIFIED, nothing promised here.
  assert.deepEqual(panelDegraded({ preflight: 'skipped', calls }), []);
  // A failed call of a combination the mint did not check is not this rule's (it was never promised).
  assert.deepEqual(panelDegraded({ preflight, calls: [call('x', 'codex', 'other-model', 'high', 'review', false)] }), []);
});

test('stage 5: PANEL-DEGRADED caps, says what it means, and run-graph applies it before the gate', () => {
  assert.ok(CAPPING_STAMPS.includes('PANEL-DEGRADED'));
  const consequences = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'stamp-consequences.json'), 'utf8'));
  assert.ok(typeof consequences['PANEL-DEGRADED'] === 'string' && consequences['PANEL-DEGRADED'].length > 80);
  assert.match(fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8'), /\| `PANEL-DEGRADED` \|/);
  // The wiring: from the FROZEN record, over the arms' and the judges' statuses, stamped before the gate is written.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const at = src.indexOf('panelDegraded({ preflight: runJson.reviewer_preflight');
  assert.ok(at > 0, 'run-graph decides from run.json.reviewer_preflight');
  assert.ok(at < src.indexOf('const gate = writeGate(null, null);'), 'and does so before the gate is written');
  assert.match(src.slice(at, at + 1200), /'PANEL-DEGRADED'/);
});

// FOUND BY THE FIRST LIVE MINT (stage 7's delivery review was refused by its own preflight): the probe ran the reviewer
// in an empty directory that was not a git repository, and the real codex refuses outside one — "Not inside a trusted
// directory and --skip-git-repo-check was not specified", exit 1 — so every codex combination failed its probe on every
// machine, while the arms' real directory is built as a repository of its own (scripts/io/snapshot.mjs) and works. The
// probe's empty directory is a git repository now, initialised the way the arms' is: no template, nothing else in it.
test('the probe runs in an empty git repository, because codex refuses to run outside one', (t) => {
  const { fake, call } = setup2(t, { body: REVIEW_OK });
  const strict = fakeReviewer(path.dirname(fake.binDir), { body: REVIEW_OK, needsGit: true });
  const r = call([], { [strict.pathKey]: strict.pathValue });
  assert.equal(r.status, 0, r.output);
  assert.ok(!strict.kinds().some((l) => l.startsWith('refused ')), `the fake refused outside a repository: ${strict.kinds().join(' | ')}`);
  assert.ok(strict.kinds().some((l) => l.startsWith('probe ')), 'and it was probed');
});

// G-4 of 20261009-222911-reviewer-preflight-review (code-audit, MEDIUM): the bound a check child is given was shorter
// than the work it covers. A check runs its own version command, may wait on another process's lock for up to
// staleMs + margin, then runs its probe child — whose timeout was probeMs + versionMs + a 30 s literal, more than the
// staleMs the lock and the bound assumed. So a slow but legal check could be killed as "overran its bound". Every term is
// now named, from configuration: the probe child's own limit, the lock holder's maximum (that child), and a bound that is
// their sum. Red first: probeChildMs did not exist, and the bound did not cover the sum.
test('G-4: a check child\'s bound covers its worst case, step by step, and the probe child uses the named limit', () => {
  for (const adapter of [{ probe_timeout_minutes: 5, version_timeout_seconds: 30, check_margin_seconds: 60 },
    { probe_timeout_minutes: 0.5, version_timeout_seconds: 10, check_margin_seconds: 2 }]) {
    const l = probeLimits(adapter, {});
    assert.ok(Number.isFinite(l.probeChildMs), 'the probe child has a named limit');
    assert.ok(l.probeChildMs >= l.versionMs + l.probeMs, 'the probe child runs its own version command and the vendor call');
    assert.ok(l.staleMs >= l.probeChildMs, 'a lock holder may take as long as one probe child');
    const worst = l.versionMs + (l.staleMs + l.marginMs) + l.probeChildMs;
    assert.ok(l.checkBoundMs > worst, `bound ${l.checkBoundMs} must exceed version + lock wait + probe child = ${worst}`);
  }
  const er = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const probe = er.slice(er.indexOf('function runProbe('), er.indexOf('\n}\n', er.indexOf('function runProbe(')));
  assert.match(probe, /timeoutMs: limits\.probeChildMs/, 'the probe child is bounded by the named limit');
  assert.ok(!/30_000/.test(probe), 'no literal margin of its own');
});
