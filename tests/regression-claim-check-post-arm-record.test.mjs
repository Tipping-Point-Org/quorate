// Review 20261025-235636-tel-remediation-5-review, claim-check --check's record of a check that fails after a checker ran:
//   G-6  only spawnSame's non-zero exit and the merge's errors went through failAfterArm: an exception after the paid
//        cross-family arm (a same-family answer whose claims are not a list, a write that throws; G-8, G-9) exited with no
//        telemetry record, so shared/telemetry.md's promise that such a failure is recorded was false (G-17).
//   G-16 failAfterArm always marked the cross-family checker FAILED, so a same-family or later failure blamed the arm that
//        succeeded.
//   G-7  the failing same-family checker was left out of the record, its frozen runtime with it.
// And the same class with the panel off: a same-family checker that failed exited through fail() with no record at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, withTempDir, seedReviewerProbe } from './helpers.mjs';

const claim = (over = {}) => ({
  id: 'C1', text: 'the claim', kind: 'behaviour',
  search: { looked_for: 'x', where: ['CLAUDE.md'], found: 'nothing' },
  grade: 'inferred', citations: [], trigger: '', counter_question: { question: 'q?', answer: '' },
  operator_only: false, verdict: 'stands', ...over,
});
const result = (claims) => ({ schema_version: 1, claims, not_checked: [] });
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

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

// A node runtime that answers `answer` as its result, or reports an error when `isError`.
function fakeClaude(dir, { answer = null, isError = false }) {
  const bin = path.join(dir, 'fake-claude.mjs');
  const envelope = isError ? { type: 'result', is_error: true, result: 'the checker broke' }
    : { type: 'result', is_error: false, result: JSON.stringify(answer) };
  fs.writeFileSync(bin, `process.stdout.write(${JSON.stringify(JSON.stringify(envelope))});\n`);
  return bin;
}

function fakeCodex(dir, body) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'), [
    "import fsx from 'node:fs';",
    'const a = process.argv;',
    "if (a.includes('--version')) { process.stdout.write('fake-codex 1.0\\n'); process.exit(0); }",
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
    const roster = readJson(path.join(SCRIPTS_DIR, 'lens-roster.json')).claim_checker;
    const probes = path.join(dir, 'probes');
    seedReviewerProbe(probes, { reviewer: roster.reviewer, model: roster.model, effort: roster.effort ?? '', mode: 'claim-check',
      route: 'native', pathValue });
    env[pathKey] = pathValue;
    env.QUORATE_REVIEWER_PROBES = probes;
  }
  return spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'claim-check.mjs'), check, '--check', '--runtime-bin', runtimeBin,
    ...(transcript ? ['--transcript', transcript] : [])], { cwd: repo, env, encoding: 'utf8' });
}

const transcriptFile = (dir) => {
  const t = path.join(dir, 'session.jsonl');
  fs.writeFileSync(t, `${JSON.stringify({ type: 'user', message: { content: 'do X' } })}\n`);
  return t;
};
const armOk = () => ({ status: 'ok', reason: '', ...result([claim({ id: 'C1', text: 'You asked for X' })]) });
const SAME_FAMILY = ['  external_panel: true', '  claim_check_transcript: same-family'];

function recordOf(check, r) {
  assert.notEqual(r.status, 0, 'the check was expected to fail');
  assert.equal(fs.existsSync(path.join(check, 'check.json')), false, 'a failed check left a check.json that reads as current');
  const tel = path.join(check, 'telemetry.json');
  assert.ok(fs.existsSync(tel), `a check that failed after a checker ran wrote no telemetry record: ${r.stderr}`);
  return readJson(tel);
}

test('G-6: an exception after the cross-family arm ran (a same-family answer whose claims are no list) still writes the record', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, SAME_FAMILY);
    const r = runCheck({ dir, repo, check, transcript: transcriptFile(dir), runtimeBin: fakeClaude(dir, { answer: { claims: 5 } }),
      codexBody: armOk() });
    const rec = recordOf(check, r);
    assert.ok(rec.tasks.some((t) => t.id === 'claim-checker'), JSON.stringify(rec.tasks));
  });
});

test('G-16, G-7: a same-family checker that fails after the arm is the task marked FAILED, the arm is not', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, SAME_FAMILY);
    const r = runCheck({ dir, repo, check, transcript: transcriptFile(dir), runtimeBin: fakeClaude(dir, { isError: true }),
      codexBody: armOk() });
    const rec = recordOf(check, r);
    const arm = rec.tasks.find((t) => t.id === 'claim-checker');
    assert.ok(arm, `the record has no cross-family checker task: ${JSON.stringify(rec.tasks)}`);
    assert.notEqual(arm.state, 'FAILED', 'the cross-family checker, which answered, was blamed for the same-family failure');
    const same = rec.tasks.find((t) => t.id === 'claim-checker-same-family');
    assert.ok(same, `the failing same-family checker is missing from the record: ${JSON.stringify(rec.tasks)}`);
    assert.equal(same.state, 'FAILED');
    assert.notEqual(same.family, 'unknown', 'the same-family checker\'s frozen runtime was not passed to the record');
  });
});

test('panel off: a same-family checker that failed still writes the record, its task FAILED', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, ['  external_panel: false']);
    const r = runCheck({ dir, repo, check, runtimeBin: fakeClaude(dir, { isError: true }) });
    const rec = recordOf(check, r);
    assert.equal(rec.tasks.some((t) => t.id === 'claim-checker'), false, 'a cross-family task was recorded with the panel off');
    const same = rec.tasks.find((t) => t.id === 'claim-checker-same-family');
    assert.ok(same, JSON.stringify(rec.tasks));
    assert.equal(same.state, 'FAILED');
    assert.notEqual(same.family, 'unknown');
  });
});
