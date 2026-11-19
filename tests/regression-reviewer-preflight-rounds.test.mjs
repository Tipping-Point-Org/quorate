// Part 6 of 6 of regression-reviewer-preflight.test.mjs: the findings of the review rounds r1-r9. Split by
// split-slow-test-files.md; the fixture is reviewer-preflight-fixture.mjs.

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

// G-1 of 20261009-222911-reviewer-preflight-review (panel-codex-contract): check-reviewers passed no --consent, so with
// the panel off — the moment an operator checks the panel BEFORE enabling it — external-review refused at the consent
// gate and the check reported every combination FAILED for a reason that is not about the reviewers. It is the
// deliberate transport probe the `transport-probe` consent exists for (check-panel declared it the same way).
test('G-1: check-reviewers checks the panel even while it is off, by declaring the transport-probe consent', (t) => {
  const f = mintFixture(t, { panel: false });
  const r = runScript('check-reviewers.mjs', [], { cwd: f.repo, env: { ...f.env, QUORATE_LIVE: '1' } });
  assert.equal(r.status, 0, r.output);
  assert.ok(!/consent/i.test(r.output), r.output);
  // new-run's mint check does NOT pass it: a mint with the panel off checks nothing (stage 3).
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  assert.ok(!/transport-probe/.test(src.slice(src.indexOf('async function checkReviewersAtMint'))), 'the mint does not borrow it');
});

// G-4 of 20261009-232840-reviewer-preflight-r1 (panel-codex-security, MEDIUM): the version command — the adapter's own
// version_argv, which a consuming project may declare — ran with the operator's ENTIRE environment, while the reviewer
// call itself gets only the vendor's allow-list (reviewerEnv). The version command now gets the same scrubbed
// environment, from the same owner. Red first: the fake's version read the unrelated secret.
test('G-4 (r1): the version command runs under the reviewer allow-list, not the operator\'s whole environment', (t) => {
  const { call, probes } = setup2(t, { body: REVIEW_OK });
  // The name is BUILT, as this repository's fixtures do ('pass' + 'word'): written literally beside a value, it read as a
  // credential to the push's secret scan (operator, 2026-10-09: "Fingerprint the 1" for the commit that did).
  const secretVar = ['QUORATE', 'TEST', 'SEC' + 'RET'].join('_');
  const r = call([], { [secretVar]: 'not-for-any-vendor' });
  assert.equal(r.status, 0, r.output);
  const recs = fs.readdirSync(probes).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(probes, f), 'utf8')));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].cli_version, 'fake-codex 1.0', 'the version command saw a variable outside the allow-list');
});

// G-1 of 20261009-232840-reviewer-preflight-r1 (panel-codex-contract, MEDIUM): check-reviewers is to check every
// combination "the roster and declared reviewers name" — and it dropped any adapter whose schema.style is `none`, a
// contract-declared one included, while probing built-ins that neither names. Now: the roster's combinations, plus each
// reviewer the CONTRACT declares, in review mode, whatever its schema; nothing else. Red first.
test('G-1 (r1): check-reviewers checks the roster and the contract-declared reviewers, and nothing it was not told about', (t) => {
  const f = mintFixture(t, { contractExtra: ['  plain:', '    cmd: "plain-reviewer"', '    base_argv: ["__PROMPT__"]',
    '    prompt: { via: argv, placeholder: __PROMPT__, budget_bytes: 30000 }', '    response: { from: stdout-wrapper, field: answer }',
    '    schema: { style: none }', '    roles: ["reviewer"]'] });
  const r = runScript('check-reviewers.mjs', [], { cwd: f.repo, env: { ...f.env, QUORATE_LIVE: '1' } });
  assert.match(r.output, /plain\/\(ambient model\)\/\(ambient effort\)\/review/, `the declared schema-less reviewer is checked:\n${r.output}`);
  assert.ok(!/codex-review/.test(r.output), 'a built-in neither the roster nor the contract names is not checked');
  assert.ok(!/skipped/.test(r.output));
});

// G-11 of 20261009-232840-reviewer-preflight-r1 (panel-codex-contract, MEDIUM): an arm or judge refused by its preflight
// recorded only "unavailable — detail in failure.json" in its tracked status, while the plan requires the status to
// carry the probe's reason. The refusal's reason is the engine's own sentence ("reviewer preflight failed for …"), so it
// is recorded — through the status writer's redaction, like everything tracked; other vendor failures still point at
// the gitignored detail, where a vendor's stderr belongs. Red first.
test('G-11 (r1): a preflight refusal\'s reason reaches the arm\'s and the judge\'s status', async () => {
  const { preflightRefusal } = await import('../scripts/lib/reviewer-probe.mjs');
  assert.equal(preflightRefusal('reviewer preflight failed for codex/m/e/review/native: exited 1'),
    'reviewer preflight failed for codex/m/e/review/native: exited 1');
  assert.equal(preflightRefusal("'codex' timed out after 900 s"), null, 'any other unavailability is not a preflight refusal');
  assert.equal(preflightRefusal(undefined), null);
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(src, /preflightRefusal\(probe\.reason\)/, 'the arm records it');
  assert.match(src, /preflightRefusal\(tbProbe\.reason\)/, 'and the judge');
  assert.match(src, /preflight_refused:/);
});

// G-6 of 20261009-232840-reviewer-preflight-r1 (panel-codex-code): a record dated AFTER now — a clock set back, a record
// written on a machine whose clock ran ahead — had a negative age and so counted for as long as the clock lagged,
// suppressing the re-probe the age limit exists for. It no longer counts while an age limit applies. Red first.
test('G-6 (r1): a record dated in the future does not count under an age limit', () => {
  const combination = { adapter: 'codex', adapter_hash: 'h', model: '', effort: '', mode: 'review', route: 'native', cli_version: 'v', host: 'm' };
  const now = Date.parse('2026-10-10T00:00:00Z');
  const rec = (at) => ({ ...combination, key: probeKey(combination), state: 'passed', checked_at: at });
  assert.equal(recordCounts(rec('2026-10-09T23:00:00Z'), combination, { now, maxAgeHours: 24 }), true);
  assert.equal(recordCounts(rec('2026-10-10T05:00:00Z'), combination, { now, maxAgeHours: 24 }), false, 'from the future');
  assert.equal(recordCounts(rec('2026-10-10T05:00:00Z'), combination, { now, maxAgeHours: null }), true, 'no age limit: age is not asked');
});

// G-8 of 20261009-232840-reviewer-preflight-r1 (panel-codex-contract): a malformed review.reviewer_probe_max_age_hours
// was accepted at mint and failed only at a reviewer's call, as a probe that could not run. A contract key is refused at
// the contract boundary, naming itself. Red first.
test('G-8 (r1): a malformed reviewer_probe_max_age_hours is refused at mint, naming the key', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-pf-g8-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q', dir]);
  const contract = (v) => ['# t', '', '```yaml', 'graph_contract_version: 6', 'project: t', 'commands:', '  build: ""', '  test: ""',
    'review:', `  reviewer_probe_max_age_hours: ${v}`, '```', ''].join('\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), contract('"soon"'));
  for (const a of [['add', '-A'], ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-qm', 'init']]) spawnSync('git', a, { cwd: dir });
  const bad = runScript('new-run.mjs', ['--repo-root', dir, '--dry-run', '--no-request', '--full-sweep', '.']);
  assert.notEqual(bad.status, 0, bad.output);
  assert.match(bad.output, /reviewer_probe_max_age_hours/);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), contract('12'));
  assert.equal(runScript('new-run.mjs', ['--repo-root', dir, '--dry-run', '--no-request', '--full-sweep', '.']).status, 0);
});

// THE FROZEN RECORD MUST NOT READ AS A CREDENTIAL (found when 20261009-222911's run.json blocked the push): each entry
// carried the probe record's 32-hex hash under `key`, and gitleaks' generic-api-key rule matches a 32-hex value under
// any name containing "key" — so every panel-on run committed three findings and the required secret scan refused the
// push (operator, 2026-10-09: "Fingerprint the 3" for the runs already committed). The hash is `probe_record` now.
// Red first: the field was `key`.
test('run.json\'s reviewer_preflight names no field the secret scan reads as a credential', (t) => {
  const f = mintFixture(t);
  assert.equal(f.mint().status, 0);
  const rp = f.runJson().reviewer_preflight;
  for (const e of rp) {
    const named = Object.keys(e).filter((k) => /key|token|secret|pass|auth|api|cred|access/i.test(k));
    assert.deepEqual(named, [], `a field gitleaks reads as a credential name: ${named.join(', ')}`);
    assert.match(e.probe_record, /^[0-9a-f]{32}$/, 'the record\'s hash is still there, under its own name');
    assert.ok(fs.existsSync(path.join(f.probes, `${e.probe_record}.json`)));
  }
});

// G-5 of 20261010-034246-reviewer-preflight-r3 (panel-codex-contract, MEDIUM): the propose probe passed on ANY array,
// so {candidates: []} with no not_checked item passed — though an empty pool is one of the marks of a proposer that did
// not run, and the probe asks for exactly one candidate. A pass now needs at least one. Red first.
test('G-5 (r3): a propose probe passes only on a non-empty candidates array', () => {
  assert.equal(probePassed('propose', { status: 'ok', candidates: [] }), false, 'an empty pool is not an answer');
  assert.equal(probePassed('propose', { status: 'ok', candidates: [{ name: 'probe' }] }), true);
});

// G-18 of 20261010-051458-reviewer-preflight-r4 (panel-codex-code + panel-codex-contract, MEDIUM): PANEL-DEGRADED counted
// every arm whose status was not OK as a failed reviewer call — an arm SKIPPED before launch (no safe surface) and an
// arm whose reviewer ANSWERED but had most findings rejected on scope included — so a run could be capped for a
// reviewer that worked. A failed call is now one whose reviewer did not answer, recorded as `reviewer_answered` on every
// launched arm and judge, and read by one pure function. Red first.
test('G-18 (r4): only a reviewer that did not answer counts against the panel', async () => {
  const { panelCallFailed } = await import('../scripts/lib/reviewer-probe.mjs');
  assert.equal(panelCallFailed({ state: 'SKIPPED', launched: false }), false, 'never launched: not a failed call');
  assert.equal(panelCallFailed({ state: 'DEGRADED', launched: true, reviewer_answered: true }), false,
    'answered, findings rejected on scope: the reviewer worked');
  assert.equal(panelCallFailed({ state: 'DEGRADED', launched: true, reviewer_answered: false }), true);
  assert.equal(panelCallFailed({ state: 'OK', launched: true, reviewer_answered: true }), false);
  // A status written before the field existed: launched and not OK, unless it was the scope rejection.
  assert.equal(panelCallFailed({ state: 'DEGRADED', launched: true, validator_errors: ['arm unavailable — detail in …'] }), true);
  assert.equal(panelCallFailed({ state: 'DEGRADED', launched: true, validator_errors: ['9/12 findings rejected on scope (>50%) — …'] }), false);
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const wiring = src.slice(src.indexOf('panelDegraded({ preflight: runJson.reviewer_preflight') - 1500, src.indexOf('panelDegraded({ preflight: runJson.reviewer_preflight'));
  assert.equal((wiring.match(/panelCallFailed\(/g) ?? []).length, 2, 'the arms and the judges both decide by it');
  assert.equal((src.match(/reviewer_answered: false/g) ?? []).length, 2, 'both arm failure paths record it');
  assert.match(src, /reviewer_answered: true/, 'the arm that answered records it');
  assert.match(src, /reviewer_answered: tbProbe\.state === 'reachable'/, 'and the judge');
});

// G-15 of 20261010-051458-reviewer-preflight-r4 (panel-codex-contract): a record EXACTLY max-age old still counted
// (`<=`); the age limit is the age at which it stops counting. Red first.
test('G-15 (r4): a record exactly at the age limit no longer counts', () => {
  const combination = { adapter: 'codex', adapter_hash: 'h', model: '', effort: '', mode: 'review', route: 'native', cli_version: 'v', host: 'm' };
  const now = Date.parse('2026-10-10T00:00:00Z');
  const rec = (at) => ({ ...combination, key: probeKey(combination), state: 'passed', checked_at: at });
  assert.equal(recordCounts(rec('2026-10-09T00:00:00Z'), combination, { now, maxAgeHours: 24 }), false, 'exactly 24 h old');
  assert.equal(recordCounts(rec('2026-10-09T00:00:01Z'), combination, { now, maxAgeHours: 24 }), true);
});

// G-3 of 20261010-051458-reviewer-preflight-r4 (panel-codex-code): a trailing `--reviewer` with no name read as
// undefined, disabling the filter, so a command meant to check one reviewer probed — and spent on — every one. Red first.
test('G-3 (r4): check-reviewers refuses --reviewer without a name, before probing anything', (t) => {
  const f = mintFixture(t);
  const r = runScript('check-reviewers.mjs', ['--reviewer'], { cwd: f.repo, env: { ...f.env, QUORATE_LIVE: '1' } });
  assert.equal(r.status, 2, r.output);
  // The refusal is the shared parser's now (entrypoint-argv.plan.md stage 3), naming the flag.
  assert.match(r.output, /--reviewer needs a value/);
  assert.deepEqual(f.probed(), [], 'nothing probed');
});

// G-4 (and its symptom G-20) of 20261010-051458-reviewer-preflight-r4 (panel-codex-contract, panel-codex-docs): a
// declared reviewer that does not support review mode — a proposer-only one — was never checked, though the command
// is to check every contract-declared reviewer. It is checked in the first mode it supports. Red first.
test('G-4 (r4): a contract-declared proposer-only reviewer is checked, in a mode it supports', (t) => {
  const f = mintFixture(t, { contractExtra: ['  proposer:', '    cmd: "proposer-cli"', '    base_argv: ["__PROMPT__"]',
    '    prompt: { via: argv, placeholder: __PROMPT__, budget_bytes: 30000 }', '    response: { from: stdout-wrapper, field: answer }',
    '    schema: { style: none }', '    roles: ["reviewer"]', '    modes: ["propose"]'] });
  const r = runScript('check-reviewers.mjs', [], { cwd: f.repo, env: { ...f.env, QUORATE_LIVE: '1' } });
  assert.match(r.output, /proposer\/\(ambient model\)\/\(ambient effort\)\/propose/, r.output);
});

// G-12 of 20261010-055800-reviewer-preflight-r5 (panel-codex-contract, MEDIUM): the review probe asks for verdict PASS,
// and the pass rule accepted ANY non-empty verdict — so an answer normalised to RISK, or a refusal, read as a reviewer
// that works. The review probe now passes only on the answer it asked for. Red first.
test('G-12 (r5): a review probe passes only on the PASS it asked for', () => {
  assert.equal(probePassed('review', { status: 'ok', verdict: 'PASS', findings: [] }), true);
  assert.equal(probePassed('review', { status: 'ok', verdict: 'RISK', findings: [] }), false, 'not what the probe asked for');
  assert.equal(probePassed('review', { status: 'ok', verdict: 'REFUSE' }), false);
});

// G-17 of 20261010-055800-reviewer-preflight-r5 (panel-codex-code, MEDIUM), in r4's G-18 fix: an arm whose worker threw
// before writing its status reads back as a synthesized BLOCKED with no `launched`, and panelCallFailed took "not
// launched" for "not failed" — so a reviewer that passed at mint and never answered escaped PANEL-DEGRADED. Only a
// SKIPPED arm, deliberately never launched, is not a failed call. Red first.
test('G-17 (r5): an expected arm with no readable status counts against the panel; only SKIPPED does not', async () => {
  const { panelCallFailed } = await import('../scripts/lib/reviewer-probe.mjs');
  assert.equal(panelCallFailed({ node_id: 'panel-codex-code', state: 'BLOCKED', validator_errors: ['status file unreadable'] }), true);
  assert.equal(panelCallFailed({ state: 'SKIPPED', skip_reason: 'PANEL-NO-SAFE-SURFACE: …' }), false);
});

// G-12 of 20261010-063310-reviewer-preflight-r6 (panel-codex-code, MEDIUM): run-graph hands external-review the vendor
// allow-list (reviewerEnv), which drops QUORATE_HOME and QUORATE_REVIEWER_PROBES — so with a custom home an arm or judge
// read a different probe store from the mint's (re-probing what had passed) and could refuse its own --run-dir. Those
// two locate the ENGINE, not a vendor; external-review re-applies the allow-list at its last hop. Red first.
test('G-12 (r6): arms and judges reach external-review with the engine\'s own home and probe store', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(src, /const ENGINE_LOCATION = engineLocationEnv\(process\.env\)/, 'one definition, from the keys\' owner');
  // The keys moved to lib/decisions.mjs's engineLocationEnv (G-10 of 20261030-171256-ciss-c-review), which
  // bench-second-opinion's judge reads too; regression-bench-judge-engine-env.test.mjs checks what it returns.
  const owner = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'decisions.mjs'), 'utf8');
  assert.match(owner, /ENGINE_LOCATION_KEYS = \['QUORATE_HOME', 'QUORATE_REVIEWER_PROBES'\]/);
  assert.equal((src.match(/\.\.\.ENGINE_LOCATION/g) ?? []).length, 2, 'the arm and the judge spawn both carry it');
});

// G-10 of 20261010-063310-reviewer-preflight-r6 (panel-codex-contract): adapterErrors validates each adapter's own probe
// limits, but the fallback they inherit — reviewers.json's probe_defaults — was never validated, so a bad default
// surfaced later as a probe that could not run. It is checked at mint, beside the adapters. Red first.
test('G-10 (r6): probe_defaults is validated, each limit a positive number', async () => {
  const { probeDefaultsErrors } = await import('../scripts/lib/reviewers.mjs');
  assert.deepEqual(probeDefaultsErrors({ probe_timeout_minutes: 5, version_timeout_seconds: 30, check_margin_seconds: 60 }), []);
  const errs = probeDefaultsErrors({ probe_timeout_minutes: 0, version_timeout_seconds: 'x' });
  assert.equal(errs.length, 3, errs.join(' | '));
  assert.match(errs.join(' '), /probe_defaults\.probe_timeout_minutes/);
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  assert.match(src, /probeDefaultsErrors\(rawTable\(\)\.probe_defaults\)/, 'checked at mint');
});

// G-9 of 20261010-071234-reviewer-preflight-r7 (panel-codex-code, MEDIUM): the propose probe asks for exactly one
// candidate named "probe", and passed on any non-empty array — so a proposer that ignored or mangled the instruction was
// recorded as working. It passes only on the answer it asked for. Red first.
test('G-9 (r7): a propose probe passes only on the one candidate named "probe"', () => {
  assert.equal(probePassed('propose', { status: 'ok', candidates: [{ name: 'probe' }] }), true);
  assert.equal(probePassed('propose', { status: 'ok', candidates: [{ name: 'something else' }] }), false);
  assert.equal(probePassed('propose', { status: 'ok', candidates: [{ name: 'probe' }, { name: 'extra' }] }), false);
});

// G-3, G-11 and G-12 of 20261010-071234-reviewer-preflight-r7 (MEDIUM). Wiring no offline harness reaches, held by source:
// G-3: the probe child is spawned in its own process group and, on timeout, its whole tree is ended — on POSIX a timeout
//   ended only the wrapper, and the reviewer CLI it had started could keep spending.
// G-12: the mint's check children are spawned killable, as run-graph's arms are, for the same reason.
// G-11: with the panel on and the check requested, a missing external-review.mjs refuses the mint instead of stamping
//   PANEL-ABSENT and skipping the preflight (the fallback the operator ruled out, "no fallback"). Red first.
test('G-3, G-11, G-12 (r7): timed-out probes end their whole tree, and a missing reviewer script refuses the mint', () => {
  const er = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const probe = er.slice(er.indexOf('function runProbe('), er.indexOf('\n}\n', er.indexOf('function runProbe(')));
  assert.match(probe, /killableSpawnOptions\(\)/, 'G-3: the probe child gets its own process group');
  // Through the one owner (io/stop-child.mjs, via spawnCapture): only it may stop a child (regression-stop-single-owner).
  assert.match(probe, /await spawnCapture\(process\.execPath/, 'G-3: and a timed-out one is stopped by the owner, whole tree');
  assert.match(probe, /timeoutMs: limits\.probeChildMs/);
  const nr = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  const mint = nr.slice(nr.indexOf('async function checkReviewersAtMint'));
  assert.match(mint.slice(0, 1500), /killableSpawnOptions\(\)/, 'G-12: the mint check children are killable');
  assert.match(nr, /external-review\.mjs is missing[^\n]*\n?[^\n]*refus|refus[^\n]*external-review\.mjs is missing/, 'G-11: a missing reviewer script refuses');
});

// G-10 of 20261010-071234-reviewer-preflight-r7 (panel-codex-security): a limit only had to be a finite positive number,
// so 1e308 minutes passed and became Infinity milliseconds, which makes the spawn throw. Each limit must fit a Node
// timer (2^31-1 ms, about 24.8 days), in an adapter and in probe_defaults alike. Red first.
test('G-10 (r7): a probe limit too large for a timer is refused, in an adapter and in probe_defaults', async () => {
  const { probeDefaultsErrors } = await import('../scripts/lib/reviewers.mjs');
  const errs = probeDefaultsErrors({ probe_timeout_minutes: 1e308, version_timeout_seconds: 30, check_margin_seconds: 60 });
  assert.equal(errs.length, 1, errs.join(' | '));
  assert.match(errs[0], /probe_timeout_minutes/);
  const adapterErr = adapterErrors('codex', { cmd: 'codex', response: { from: 'file' }, prompt: { via: 'stdin' }, version_timeout_seconds: 1e12 });
  assert.ok(adapterErr.some((e) => /version_timeout_seconds/.test(e)), adapterErr.join(' | '));
});

// G-10 of 20261010-082146-reviewer-preflight-r8 (panel-codex-security, MEDIUM): a FAILED version command's first output
// line went into the failure reason, which new-run prints and run-graph records in tracked status — so a CLI that echoes
// a token on a failed --version moved it into durable artifacts. The reason names the exit, not the output. Red first.
test('G-10 (r8): a failed version command\'s output is not carried into its reason', () => {
  const lim = probeLimits({ version_timeout_seconds: 30 }, { probe_timeout_minutes: 5, check_margin_seconds: 1 });
  const marker = ['tok', 'en-', 'not-a-real-one'].join('');
  const r = cliVersion({ cmd: process.execPath, version_argv: ['-e', `console.log(${JSON.stringify(marker)}); process.exit(3)`] }, lim);
  assert.equal(r.ok, false);
  assert.match(r.reason, /exited 3/);
  assert.ok(!r.reason.includes(marker), r.reason);
});

// G-12 of 20261010-082146-reviewer-preflight-r8 (panel-codex-code), in r7's G-10 fix: each limit was bounded alone, but
// probeLimits SUMS them, so limits valid one by one could still overflow a Node timer. The sums are bounded too. Red first.
test('G-12 (r8): limits whose sum overflows a timer are refused', () => {
  assert.throws(() => probeLimits({ probe_timeout_minutes: 30_000, version_timeout_seconds: 30, check_margin_seconds: 60 }, {}),
    /timer/);
  assert.doesNotThrow(() => probeLimits({ probe_timeout_minutes: 5, version_timeout_seconds: 30, check_margin_seconds: 60 }, {}));
});

// G-3 of 20261010-082146-reviewer-preflight-r8 (panel-codex-contract, MEDIUM): under the lock, a record written while this
// process waited is used as it stands — judged by checked_at >= the wait's start — so a FUTURE-DATED record passed that
// test and skipped the re-probe the age rule had just demanded. "Written while waiting" is now also "not after now".
test('G-3 (r8): a record dated in the future is not "written while this process waited"', async () => {
  const { writtenWhileWaiting } = await import('../scripts/lib/reviewer-probe.mjs');
  const startedAt = Date.parse('2026-10-10T08:00:00Z');
  const now = Date.parse('2026-10-10T08:00:05Z');
  assert.equal(writtenWhileWaiting({ checked_at: '2026-10-10T08:00:03Z' }, { startedAt, now }), true);
  assert.equal(writtenWhileWaiting({ checked_at: '2026-10-10T07:59:00Z' }, { startedAt, now }), false, 'before the wait');
  assert.equal(writtenWhileWaiting({ checked_at: '2026-10-10T09:00:00Z' }, { startedAt, now }), false, 'from the future');
  const er = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  assert.match(er, /writtenWhileWaiting\(again, \{ startedAt, now: Date\.now\(\) \}\)/, 'the locked re-read uses it');
});

// G-16 and its symptom G-13 of 20261010-082146-reviewer-preflight-r8 (MEDIUM), in r7's G-11 fix: with the reviewer
// script missing and --no-verify-reviewers, the mint stamped PANEL-ABSENT and so skipped the branch that records
// "skipped" and stamps REVIEWERS-UNVERIFIED — the run lost its cap. --no-verify-reviewers with the panel on now always
// records the skip, missing script or not. Held by source (no offline harness removes the framework's own script).
test('G-16/G-13 (r8): --no-verify-reviewers with the panel on always stamps REVIEWERS-UNVERIFIED', () => {
  const nr = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  const block = nr.slice(nr.indexOf('let reviewerPreflight = null;'), nr.indexOf('async function checkReviewersAtMint'));
  assert.match(block, /if \(review\.external_panel === true\) \{\n\s+if \(args\.verifyReviewers === false\) \{/,
    'the skip is decided before, and independently of, PANEL-ABSENT');
  assert.match(block, /else if \(!stamps\.includes\('PANEL-ABSENT'\)\)/, 'only the check itself depends on the script');
});

// G-10 of 20261010-085904-reviewer-preflight-r9 (panel-codex-contract, MEDIUM): panelDegraded matched mint entries on
// adapter, model, effort and mode, not the schema route — which is part of a probed combination — so a call on a route
// the mint never checked could be stamped. The route joins the match, from one owner both sides use. Red first.
test('G-10 (r9): PANEL-DEGRADED matches the schema route too, from the same rule the probe uses', async () => {
  const { panelDegraded, schemaRoute } = await import('../scripts/lib/reviewer-probe.mjs');
  const preflight = [{ adapter: 'codex', model: 'm', effort: 'e', mode: 'review', route: 'prompt-and-scan', state: 'passed' }];
  const call = { id: 'panel-codex-code', reviewer: 'codex', model: 'm', effort: 'e', mode: 'review', route: 'native', ok: false };
  assert.deepEqual(panelDegraded({ preflight, calls: [call] }), [], 'a route the mint never checked is not this rule\'s');
  assert.deepEqual(panelDegraded({ preflight, calls: [{ ...call, route: 'prompt-and-scan' }] }), ['panel-codex-code']);
  assert.equal(schemaRoute('review'), 'native');
  assert.equal(schemaRoute('propose', { candidateFields: null }), 'prompt-and-scan');
  const rg = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.equal((rg.match(/route: schemaRoute\(/g) ?? []).length, 2, 'run-graph gives the arms and the judges their route');
  const er = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  assert.match(er, /schemaRoute\(args\.mode/, 'the probe decides its route by the same rule');
});

// G-15 of 20261010-085904-reviewer-preflight-r9 (panel-codex-contract): seedReviewerProbe refused a directory under the
// shared TEST_HOME by a case-sensitive prefix, so on Windows a differently cased path slipped past it. Red first.
test('G-15 (r9): seedReviewerProbe refuses TEST_HOME however its path is cased', async (t) => {
  const { TEST_HOME } = await import('./helpers.mjs');
  if (process.platform !== 'win32') { t.skip('a differently cased path names the same file only on Windows here'); return; }
  assert.throws(() => seedReviewerProbe(path.join(TEST_HOME.toUpperCase(), 'probes'), { pathValue: '' }), /TEST_HOME/);
});
