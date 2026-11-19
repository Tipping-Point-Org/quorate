// claim-check-cross-family.plan.md stage 4. `claim-check.mjs <dir> --check` decides who checks the draft: the panel off,
// a Claude subagent through spawn-subagent.mjs, same-family; the panel on, `external-review --mode claim-check` at the
// roster's claim_checker pin, with the redacted transcript under `cross-family` and without it under `same-family`. Under
// `claude` the Claude checker, given the transcript and the arm's claim list, decides which claims are attributions —
// the arm ran without the transcript, so its classification is not the authority for the set the transcript is needed
// for — and grades those; the merge records every kind the two disagree on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, withTempDir, seedReviewerProbe } from './helpers.mjs';
import * as claimCheck from '../scripts/lib/claim-check.mjs';

const claim = (over = {}) => ({
  id: 'C1', text: 'the claim', kind: 'behaviour',
  search: { looked_for: 'x', where: ['CLAUDE.md'], found: 'nothing' },
  grade: 'inferred', citations: [], trigger: '', counter_question: { question: 'q?', answer: '' },
  operator_only: false, verdict: 'stands', ...over,
});
const result = (claims) => ({ schema_version: 1, claims, not_checked: [] });

test('mergeAttributionCheck: the Claude checker grades what it classes as an attribution, and disagreements are kept', () => {
  const { mergeAttributionCheck } = claimCheck;
  assert.equal(typeof mergeAttributionCheck, 'function', 'lib/claim-check.mjs has no mergeAttributionCheck');
  const arm = result([claim({ id: 'C1', kind: 'behaviour', text: 'you asked for X' }), claim({ id: 'C2', kind: 'attribution' }),
    claim({ id: 'C3' })]);
  // C1 quotes the arm's claim, as the brief asks: an id matches only the claim it quotes (G-11 of 20261019-033102).
  const claude = result([claim({ id: 'C1', kind: 'attribution', text: 'you asked for X', verdict: 'ask-operator', grade: 'inferred' }),
    claim({ id: 'A1', kind: 'attribution', text: 'you approved Y' })]);
  const m = mergeAttributionCheck(arm, claude, { grader: 'node-rt' });
  assert.deepEqual(m.errors, []);
  const by = Object.fromEntries(m.result.claims.map((c) => [c.id, c]));
  assert.equal(by.C1.kind, 'attribution');
  assert.equal(by.C1.verdict, 'ask-operator');
  assert.equal(by.C3.kind, 'behaviour', 'a claim neither checker classes as an attribution stays the arm\'s');
  assert.ok(by.A1, 'an attribution the arm did not list is lost');
  assert.deepEqual(m.graded_by, { C1: 'node-rt', C2: 'arm', C3: 'arm', A1: 'node-rt' });
  assert.deepEqual(m.kind_disagreements, [
    { id: 'C1', arm: 'behaviour', same_family: 'attribution' },
    { id: 'C2', arm: 'attribution', same_family: 'not an attribution' },
  ]);
  const bad = mergeAttributionCheck(arm, result([claim({ id: 'C3', kind: 'behaviour' })]));
  assert.ok(bad.errors.length, 'the Claude checker graded a claim it did not class as an attribution');
});

// ---------------------------------------------------------------------------------------------- end to end
function fixtureRepo(dir, review) {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: cc-fixture',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:',
    '  models: { judgment: opus }', '  effort: { judgment: low }', ...review, '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'fixture');
  const check = path.join(repo, '.claude', 'claim-checks', 'c1');
  fs.mkdirSync(check, { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'claim-checks', '.gitignore'), '*\n');
  fs.writeFileSync(path.join(check, 'draft.md'), 'You asked for X. The build passes.\n');
  return { repo, check };
}

function fakeClaude(dir, answer) {
  const bin = path.join(dir, 'fake-claude.mjs');
  fs.writeFileSync(bin, [
    "import fs from 'node:fs';",
    `fs.appendFileSync(${JSON.stringify(path.join(dir, 'claude-argv.jsonl'))}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    `process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: ${JSON.stringify(JSON.stringify(answer))} }));`,
  ].join('\n'));
  return bin;
}

function fakeCodex(dir, body) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'), [
    "import fsx from 'node:fs';",
    'const a = process.argv;',
    // Where the reviewer stood, and what it could read there (G-2).
    `fsx.appendFileSync(${JSON.stringify(path.join(dir, 'codex-argv.jsonl'))}, JSON.stringify({ cwd: process.cwd(),`
      + " env: fsx.existsSync('.env'), draft: fsx.existsSync('.claim-check/draft.md'),"
      + " transcript: fsx.existsSync('.claim-check/transcript.redacted.jsonl') }) + '\\n');",
    "const i = a.indexOf('--output-last-message');",
    `const body = ${JSON.stringify(JSON.stringify(body))};`,
    'if (i !== -1 && a[i + 1]) fsx.writeFileSync(a[i + 1], body);',
    'process.stdout.write(body);',
    '',
  ].join('\n'));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'codex.cmd'), `@"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`);
  } else {
    const shim = path.join(binDir, 'codex');
    fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex.mjs" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  return binDir;
}

function runCheck({ dir, repo, check, transcript = null, runtimeBin, codexBody = null }) {
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home') };
  delete env.GRAPH_NODE_DEPTH;
  if (codexBody) {
    const pathValue = `${fakeCodex(dir, codexBody)}${path.delimiter}${process.env[pathKey] ?? ''}`;
    const roster = JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, 'lens-roster.json'), 'utf8')).claim_checker;
    const probes = path.join(dir, 'probes');
    seedReviewerProbe(probes, { reviewer: roster.reviewer, model: roster.model, effort: roster.effort ?? '', mode: 'claim-check',
      route: 'native', pathValue });
    env[pathKey] = pathValue;
    env.QUORATE_REVIEWER_PROBES = probes;
  }
  const args = [path.join(SCRIPTS_DIR, 'claim-check.mjs'), check, '--check', '--runtime-bin', runtimeBin,
    ...(transcript ? ['--transcript', transcript] : [])];
  return spawnSync(process.execPath, args, { cwd: repo, env, encoding: 'utf8' });
}

const transcriptFile = (dir) => {
  const t = path.join(dir, 'session.jsonl');
  fs.writeFileSync(t, `${JSON.stringify({ type: 'user', message: { content: 'do X' } })}\n`);
  return t;
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('panel off: the Claude checker runs through spawn-subagent, pinned, and the check says same-family', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: false']);
    const r = runCheck({ dir, repo, check, runtimeBin: fakeClaude(dir, result([claim()])) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readJson(path.join(check, 'result.json')).claims[0].id, 'C1');
    const info = readJson(path.join(check, 'check.json'));
    assert.equal(info.family, 'same');
    assert.equal(info.arm, null);
    const argv = JSON.parse(fs.readFileSync(path.join(dir, 'claude-argv.jsonl'), 'utf8').trim().split('\n')[0]);
    assert.equal(argv[argv.indexOf('--effort') + 1], 'low', 'the checker was not pinned to the contract\'s effort');
    // The spawn's telemetry record, beside its envelope (telemetry-records.plan.md stage 3), written by spawn-subagent.
    const sub = readJson(path.join(check, 'same-family.envelope.telemetry.json'));
    assert.equal(sub.kind, 'subagent');
    assert.equal(sub.tasks[0].exit_code, 0);
    assert.equal(sub.tasks[0].effort, 'low');
    // The spawn's call entry in its record (runtime-call-telemetry.plan.md stage 3).
    // Its facts from the call entry (runtime-call-telemetry.plan.md stage 5): family, exit code and outcome on the task.
    assert.equal(sub.tasks[0].family, 'anthropic', JSON.stringify(sub.tasks[0]));
    assert.equal(sub.tasks[0].exit_code, 0);
    assert.equal(sub.tasks[0].outcome, 'answered');
    assert.ok(Date.parse(sub.tasks[0].ended_at) >= Date.parse(sub.tasks[0].started_at));
    // And the check's own record, written by the rules step, with the same-family checker as its task.
    const rules = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'claim-check.mjs'), check], { cwd: repo, encoding: 'utf8',
      env: { ...process.env, QUORATE_HOME: path.join(dir, 'home'), GRAPH_NODE_DEPTH: '' } });
    assert.equal(rules.status, 0, rules.stderr);
    const tel = readJson(path.join(check, 'telemetry.json'));
    assert.equal(tel.kind, 'claim-check');
    assert.equal(tel.claims.total, 1);
    assert.ok(tel.tasks.some((t) => t.id === 'claim-checker-same-family'), JSON.stringify(tel.tasks));
  });
});

test('panel on, cross-family: the arm checks every claim and reads the redacted transcript copy', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: true', '  claim_check_transcript: cross-family']);
    const body = { status: 'ok', reason: '', ...result([claim({ id: 'C1', kind: 'attribution' })]) };
    const r = runCheck({ dir, repo, check, transcript: transcriptFile(dir), runtimeBin: fakeClaude(dir, result([])), codexBody: body });
    assert.equal(r.status, 0, r.stderr);
    const info = readJson(path.join(check, 'check.json'));
    assert.equal(info.family, 'cross');
    assert.equal(info.transcript.sent, true);
    // What the checker's process did (telemetry-records.plan.md stage 1c): placed in time, with its exit status.
    assert.ok(Date.parse(info.arm.ended_at) >= Date.parse(info.arm.started_at), `no start and end: ${JSON.stringify(info.arm)}`);
    assert.equal(info.arm.exit_code, 0);
    assert.equal(info.arm.signal, null);
    // The vendor call's entry, through external-review's output (runtime-call-telemetry.plan.md stage 3), answered.
    assert.equal(info.arm.call?.family, 'openai', JSON.stringify(info.arm.call));
    assert.equal(info.arm.call.outcome, 'answered');
    assert.ok(Number.isInteger(info.arm.call.duration_ms));
    assert.match(fs.readFileSync(path.join(check, 'arm-prompt.md'), 'utf8'), /transcript\.redacted\.jsonl/);
    assert.ok(fs.existsSync(path.join(check, 'transcript.redacted.jsonl')));
    assert.deepEqual(info.graded_by, { C1: 'arm' });
    assert.equal(fs.existsSync(path.join(dir, 'claude-argv.jsonl')), false, 'a Claude checker ran under cross-family');
  });
});

test('panel on, same-family: no transcript reaches the arm, and the same-family checker grades the attributions', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: true', '  claim_check_transcript: same-family']);
    const body = { status: 'ok', reason: '', ...result([claim({ id: 'C1', kind: 'behaviour', text: 'You asked for X' }), claim({ id: 'C2' })]) };
    const claudeAnswer = result([claim({ id: 'C1', kind: 'attribution', text: 'You asked for X', verdict: 'ask-operator' })]);
    const r = runCheck({ dir, repo, check, transcript: transcriptFile(dir), runtimeBin: fakeClaude(dir, claudeAnswer), codexBody: body });
    assert.equal(r.status, 0, r.stderr);
    // CHECKER.md, carried verbatim, mentions a transcript; what must be absent is the line handing the arm one.
    assert.doesNotMatch(fs.readFileSync(path.join(check, 'arm-prompt.md'), 'utf8'), /^- The session transcript, redacted:/m);
    assert.equal(fs.existsSync(path.join(check, 'transcript.redacted.jsonl')), false, 'a copy was made for no one');
    const res = readJson(path.join(check, 'result.json'));
    assert.equal(res.claims.find((c) => c.id === 'C1').kind, 'attribution');
    const info = readJson(path.join(check, 'check.json'));
    const rt = info.same_family.runtime;
    assert.ok(rt && rt !== 'same-family', 'the same-family checker is not named by the node runtime');
    assert.deepEqual(info.graded_by, { C1: rt, C2: 'arm' });
    assert.deepEqual(info.kind_disagreements, [{ id: 'C1', arm: 'behaviour', same_family: 'attribution' }]);
  });
});

// G-2 of 20261019-014448-ccf-delivery: the cross-family checker stood in the real repository, so a gitignored file there
// (a .env, the unredacted transcript's path in transcript.json) could reach the vendor. It must read the arms' snapshot.
test('panel on: the arm reads the arms\' snapshot with the draft added, never the repository or an ignored file', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: true', '  claim_check_transcript: cross-family']);
    fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n');
    fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');
    const body = { status: 'ok', reason: '', ...result([claim()]) };
    const r = runCheck({ dir, repo, check, transcript: transcriptFile(dir), runtimeBin: fakeClaude(dir, result([])), codexBody: body });
    assert.equal(r.status, 0, r.stderr);
    const prompt = fs.readFileSync(path.join(check, 'arm-prompt.md'), 'utf8');
    assert.equal(prompt.includes(repo), false, 'the arm prompt points the reviewer at the real repository');
    assert.equal(prompt.includes(check), false, 'the arm prompt points the reviewer into the check directory');
    const argv = fs.readFileSync(path.join(dir, 'codex-argv.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
    assert.ok(argv.cwd && path.resolve(argv.cwd) !== path.resolve(repo), `the reviewer ran in the repository: ${argv.cwd}`);
    assert.equal(argv.env, false, 'an ignored .env was in the directory the reviewer read');
    assert.equal(argv.draft, true, 'the draft was not in the directory the reviewer read');
    assert.equal(argv.transcript, true, 'the redacted transcript copy was not in the directory the reviewer read');
  });
});

// G-3 of 20261019-014448-ccf-delivery: a second --check whose arm dies before writing --out read the first run's arm.json.
test('panel on: an arm that fails does not reuse an earlier check\'s arm.json', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: true', '  claim_check_transcript: cross-family']);
    fs.writeFileSync(path.join(check, 'arm.json'), JSON.stringify({ result: result([claim({ id: 'STALE' })]) }));
    const r = runCheck({ dir, repo, check, runtimeBin: fakeClaude(dir, result([])), codexBody: { not: 'a result' } });
    assert.notEqual(r.status, 0, 'the check succeeded on a stale arm.json');
    assert.equal(fs.existsSync(path.join(check, 'result.json')), false, 'a stale result was recorded as this check\'s');
  });
});

// G-5 of 20261025-215217-tel-remediation-2-review: the cleanup left an earlier check's same-family envelope and the
// records, so a later check's record counted a checker task it did not run.
test('a new --check removes an earlier check\'s same-family envelope and its telemetry records', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: true', '  claim_check_transcript: cross-family']);
    const stale = ['same-family.envelope.json', 'same-family.envelope.telemetry.json', 'telemetry.json'];
    for (const f of stale) fs.writeFileSync(path.join(check, f), JSON.stringify({ stale: true }));
    const r = runCheck({ dir, repo, check, runtimeBin: fakeClaude(dir, result([])), codexBody: { not: 'a result' } });
    assert.notEqual(r.status, 0, 'the check succeeded on a failed arm');
    for (const f of stale.filter((x) => x !== 'telemetry.json')) {
      assert.equal(fs.existsSync(path.join(check, f)), false, `${f} from an earlier check was left standing`);
    }
    // A check that fails after its checker ran writes its OWN record (G-2 of 20261025-232315-tel-remediation-4-review): the
    // file is this check's, its checker FAILED, never the earlier one left standing.
    const tel = JSON.parse(fs.readFileSync(path.join(check, 'telemetry.json'), 'utf8'));
    assert.equal(tel.stale, undefined, 'telemetry.json from an earlier check was left standing');
    assert.equal(tel.tasks.find((t) => t.task_kind === 'claim-checker')?.state, 'FAILED', JSON.stringify(tel.tasks));
  });
});

// G-5 of 20261019-014448-ccf-delivery: a claim-check response that omits its mandatory status was read as `ok`.
test('panel on: a claim-check response with no status is refused, not read as completed', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: true', '  claim_check_transcript: cross-family']);
    const r = runCheck({ dir, repo, check, runtimeBin: fakeClaude(dir, result([])), codexBody: { reason: '', ...result([claim()]) } });
    assert.notEqual(r.status, 0, 'a response with no status was accepted');
    assert.equal(fs.existsSync(path.join(check, 'result.json')), false);
  });
});

test('claim-check --check refuses at depth: it starts model work', () => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'claim-check.mjs'), 'x', '--check'],
    { encoding: 'utf8', env: { ...process.env, GRAPH_NODE_DEPTH: '1' } });
  assert.equal(r.status, 3, r.stderr);
});

// ---------------------------------------------------------------------------------------------- stage 4: the step journal
// runtime-call-telemetry.plan.md stage 4 (design CR-D1): every step appends its entry when it ends, and the check's record
// is written from the journal at exit, whatever ended it. Each case below is a row of the design note's table of ends; a
// cleanup or a write that throws cannot be provoked portably and stays with the source. A failed check leaves no check.json.

const failingClaude = (dir) => {
  const bin = path.join(dir, 'failing-claude.mjs');
  fs.writeFileSync(bin, 'process.stderr.write("boom");\nprocess.exit(1);\n');
  return bin;
};
const telemetryOf = (check, r = null) => {
  assert.ok(fs.existsSync(path.join(check, 'telemetry.json')), `no record; the check said: ${r?.stderr ?? ''} ${r?.stdout ?? ''}`);
  return readJson(path.join(check, 'telemetry.json'));
};
const failedSteps = (tel) => tel.steps.filter((s) => s.outcome === 'failed').map((s) => `${s.step}:${s.task}`);
const failedTasks = (tel) => tel.tasks.filter((t) => t.state === 'FAILED').map((t) => t.id);

test('stage 4: panel off, the same-family checker\'s call fails: its step and only it is failed, and no check.json', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: false']);
    const r = runCheck({ dir, repo, check, runtimeBin: failingClaude(dir) });
    assert.notEqual(r.status, 0);
    const tel = telemetryOf(check, r);
    assert.deepEqual(failedSteps(tel), ['same-family-call:claim-checker-same-family']);
    assert.deepEqual(failedTasks(tel), ['claim-checker-same-family']);
    assert.equal(tel.exit_code, 1, 'the total records how the check ended');
    assert.equal(fs.existsSync(path.join(check, 'check.json')), false, 'a failed check left a check.json (G-6)');
  });
});

test('stage 4: panel off, the same-family answer has no list of claims: charged to that checker, no step after it ran', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: false']);
    const r = runCheck({ dir, repo, check, runtimeBin: fakeClaude(dir, { schema_version: 1, claims: {}, not_checked: [] }) });
    assert.notEqual(r.status, 0);
    const tel = telemetryOf(check, r);
    assert.deepEqual(failedSteps(tel), ['same-family-answer:claim-checker-same-family']);
    assert.deepEqual(tel.steps.map((s) => s.step), ['same-family-call', 'same-family-answer']);
  });
});

test('stage 4: panel off, success: every step ok, the record written at exit before the rules step', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: false']);
    const r = runCheck({ dir, repo, check, runtimeBin: fakeClaude(dir, result([claim()])) });
    assert.equal(r.status, 0, r.stderr);
    const tel = telemetryOf(check, r);
    assert.deepEqual(failedSteps(tel), []);
    assert.deepEqual(tel.steps.map((s) => s.step), ['same-family-call', 'same-family-answer', 'write-result', 'write-check']);
    assert.equal(tel.exit_code, 0);
    const same = tel.tasks.find((t) => t.id === 'claim-checker-same-family');
    assert.equal(same?.outcome, 'answered', 'the same-family task takes its facts from its call\'s entry');
    assert.equal(same.exit_code, 0);
  });
});

test('stage 4: panel on, the arm returns no result: its answer step fails, charged to it, the surface still cleaned', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: true', '  claim_check_transcript: cross-family']);
    const r = runCheck({ dir, repo, check, runtimeBin: fakeClaude(dir, result([])), codexBody: { not: 'a result' } });
    assert.notEqual(r.status, 0);
    const tel = telemetryOf(check, r);
    assert.deepEqual(failedSteps(tel), ['arm-answer:claim-checker']);
    assert.deepEqual(failedTasks(tel), ['claim-checker']);
    assert.deepEqual(tel.steps.slice(0, 2).map((s) => `${s.step}:${s.outcome}`), ['arm-call:ok', 'surface-cleanup:ok']);
  });
});

test('stage 4: panel on, the attributions checker fails: charged to it, and the arm that answered is not failed', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: true', '  claim_check_transcript: same-family']);
    const body = { status: 'ok', reason: '', ...result([claim({ id: 'C1', kind: 'attribution' })]) };
    const r = runCheck({ dir, repo, check, transcript: transcriptFile(dir), runtimeBin: failingClaude(dir), codexBody: body });
    assert.notEqual(r.status, 0);
    const tel = telemetryOf(check, r);
    assert.deepEqual(failedSteps(tel), ['same-family-call:claim-checker-same-family']);
    assert.deepEqual(failedTasks(tel), ['claim-checker-same-family'], 'the arm that answered was marked failed (G-16)');
  });
});

test('stage 4: panel on, the merge is refused: charged to the attributions checker', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: true', '  claim_check_transcript: same-family']);
    const body = { status: 'ok', reason: '', ...result([claim({ id: 'C1', kind: 'behaviour' })]) };
    // The same-family checker grades a claim it does not class as an attribution: the merge refuses it.
    const r = runCheck({ dir, repo, check, transcript: transcriptFile(dir),
      runtimeBin: fakeClaude(dir, result([claim({ id: 'C1', kind: 'behaviour' })])), codexBody: body });
    assert.notEqual(r.status, 0);
    const tel = telemetryOf(check, r);
    assert.deepEqual(failedSteps(tel), ['merge:claim-checker-same-family']);
    assert.deepEqual(failedTasks(tel), ['claim-checker-same-family']);
  });
});

test('stage 4: panel on, success: every step ok and the arm carries its call\'s entry', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: true', '  claim_check_transcript: cross-family']);
    const body = { status: 'ok', reason: '', ...result([claim({ id: 'C1' })]) };
    const r = runCheck({ dir, repo, check, runtimeBin: fakeClaude(dir, result([])), codexBody: body });
    assert.equal(r.status, 0, r.stderr);
    const tel = telemetryOf(check, r);
    assert.deepEqual(failedSteps(tel), []);
    assert.deepEqual(tel.steps.map((s) => s.step), ['arm-call', 'surface-cleanup', 'arm-answer', 'write-result', 'write-check']);
    assert.equal(tel.tasks.find((t) => t.id === 'claim-checker')?.outcome, 'answered');
  });
});

test('stage 4: the two ends no fake can provoke run inside a step at source: the surface cleanup and the writes', () => {
  const src = fs.readFileSync(path.join(SCRIPTS_DIR, 'claim-check.mjs'), 'utf8');
  assert.match(src, /runStep\('surface-cleanup', null, dropSurface\)/);
  assert.equal(src.split("runStep('write-result', null,").length - 1, 3, 'every result write is a step');
  assert.match(src, /runStep\('write-check', null,/);
  assert.equal(/failAfterChecker|afterChecker\(/.test(src), false, 'the routing by hand is gone');
});
