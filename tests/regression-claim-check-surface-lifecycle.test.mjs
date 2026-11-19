// Review 20261019-033102-review-review, the claim-check boundary of `claim-check.mjs`:
//   G-2  --new only WARNED when git would not ignore the check directory, so a draft and a checker's answer (model text)
//        could be committed in a repository that re-includes the path. It now refuses and leaves nothing behind.
//   G-3  the cross-family checker's surface under <home>/claim-check-surfaces was removed only around the reviewer's
//        spawn: an exception after the build, or a kill, left a repository snapshot there for good. It is removed on any
//        exit, and a later --check reclaims a surface whose process is gone (never one whose process is alive).
//   G-4  only the check directory was excluded from the surface, so a --transcript file tracked elsewhere in the
//        repository reached the reviewer UNREDACTED beside its redacted copy.
//   G-5  `built.withheld` was never read: what the snapshot left out was recorded nowhere, so a partial surface read as
//        the whole repository. It is in check.json and in the result's not_checked.
//   G-6  a retry removed only arm.json, so a failed --check left an earlier check's result.json, check.json and
//        checked.md looking current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, withTempDir, seedReviewerProbe } from './helpers.mjs';

const SCRIPT = path.join(SCRIPTS_DIR, 'claim-check.mjs');
const claim = (over = {}) => ({
  id: 'C1', text: 'the claim', kind: 'behaviour',
  search: { looked_for: 'x', where: ['CLAUDE.md'], found: 'nothing' },
  grade: 'inferred', citations: [], trigger: '', counter_question: { question: 'q?', answer: '' },
  operator_only: false, verdict: 'stands', ...over,
});
const result = (claims) => ({ schema_version: 1, claims, not_checked: [] });
const okBody = () => ({ status: 'ok', reason: '', ...result([claim()]) });
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function fixtureRepo(dir, { setting = 'cross-family', before = null } = {}) {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: cc-fixture',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:',
    '  models: { judgment: opus }', '  effort: { judgment: low }', '  external_panel: true', `  claim_check_transcript: ${setting}`,
    '```', ''].join('\n'));
  if (before) before(repo);
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'fixture');
  const check = path.join(repo, '.claude', 'claim-checks', 'c1');
  fs.mkdirSync(check, { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'claim-checks', '.gitignore'), '*\n');
  fs.writeFileSync(path.join(check, 'draft.md'), 'The build passes.\n');
  return { repo, check };
}

// A codex that records where it stood and every file it could read there.
function fakeCodex(dir, body) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'), [
    "import fsx from 'node:fs';",
    'const a = process.argv;',
    // The version probe runs in the test's own directory, the repository root, which other tests write into while the
    // suite runs: answered before any scan, as a real CLI answers --version (the runner's full check refused all five
    // tests, remediation 20261019-040234-review).
    "if (a.includes('--version')) { process.stdout.write('fake-codex 1.0\\n'); process.exit(0); }",
    "const files = fsx.readdirSync('.', { recursive: true }).map((f) => String(f).split('\\\\').join('/')).filter((f) => !f.startsWith('.git/') && f !== '.git');",
    `fsx.appendFileSync(${JSON.stringify(path.join(dir, 'codex-seen.jsonl'))}, JSON.stringify({ cwd: process.cwd(), files }) + '\\n');`,
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

function runCheck({ dir, repo, check, transcript = null, codexBody }) {
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home') };
  delete env.GRAPH_NODE_DEPTH;
  const pathValue = `${fakeCodex(dir, codexBody)}${path.delimiter}${process.env[pathKey] ?? ''}`;
  const roster = readJson(path.join(SCRIPTS_DIR, 'lens-roster.json')).claim_checker;
  const probes = path.join(dir, 'probes');
  if (!fs.existsSync(probes)) {
    seedReviewerProbe(probes, { reviewer: roster.reviewer, model: roster.model, effort: roster.effort ?? '', mode: 'claim-check',
      route: 'native', pathValue });
  }
  env[pathKey] = pathValue;
  env.QUORATE_REVIEWER_PROBES = probes;
  return spawnSync(process.execPath, [SCRIPT, check, '--check', ...(transcript ? ['--transcript', transcript] : [])],
    { cwd: repo, env, encoding: 'utf8' });
}

const surfacesRoot = (dir) => path.join(dir, 'home', 'claim-check-surfaces');
const leaves = (dir) => (fs.existsSync(surfacesRoot(dir)) ? fs.readdirSync(surfacesRoot(dir)) : []);
const lastSeen = (dir) => fs.readFileSync(path.join(dir, 'codex-seen.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);

test('G-2: --new refuses where git would not ignore the check directory, and leaves no directory behind', () => {
  withTempDir((dir) => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    const parent = path.join(repo, '.claude', 'claim-checks');
    fs.mkdirSync(parent, { recursive: true });
    // The repository's own choice, which --new leaves alone: it ignores nothing here.
    fs.writeFileSync(path.join(parent, '.gitignore'), '# this repository keeps its checks\n');
    const r = spawnSync(process.execPath, [SCRIPT, '--new', 'tracked'], { cwd: repo, encoding: 'utf8' });
    assert.notEqual(r.status, 0, `--new succeeded where git would commit the draft: ${r.stderr}`);
    assert.match(r.stderr, /not ignored/i);
    assert.deepEqual(fs.readdirSync(parent).filter((n) => n !== '.gitignore'), [], 'a check directory was left where git would add it');
  });
});

test('G-3: an exception after the surface is built leaves no surface under quorate\'s home', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir);
    // arm-prompt.md as a DIRECTORY: writing the arm's prompt, after the build, throws.
    fs.mkdirSync(path.join(check, 'arm-prompt.md'));
    const r = runCheck({ dir, repo, check, codexBody: okBody() });
    assert.notEqual(r.status, 0, 'the check was expected to fail writing its prompt');
    assert.deepEqual(leaves(dir), [], 'the surface outlived the process that built it');
  });
});

test('G-3: a later --check reclaims a surface whose process is gone, and keeps one whose process is alive', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir);
    const gone = spawnSync(process.execPath, ['-e', '0']).pid;
    const stale = path.join(surfacesRoot(dir), `${gone}-0123456789ab`);
    const live = path.join(surfacesRoot(dir), `${process.pid}-0123456789ab`);
    for (const d of [stale, live]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'source.md'), 'snapshot\n'); }
    const r = runCheck({ dir, repo, check, codexBody: okBody() });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(stale), false, 'a surface left by a process that is gone was never reclaimed');
    assert.equal(fs.existsSync(live), true, 'a surface a live process may be using was removed');
    assert.deepEqual(leaves(dir), [path.basename(live)], 'this check\'s own surface was left behind');
  });
});

test('G-4: a --transcript file tracked in the repository is not in the surface, only its redacted copy', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir, {
      before: (r) => {
        fs.mkdirSync(path.join(r, 'notes'));
        fs.writeFileSync(path.join(r, 'notes', 'session.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'do X' } })}\n`);
      },
    });
    const r = runCheck({ dir, repo, check, transcript: path.join(repo, 'notes', 'session.jsonl'), codexBody: okBody() });
    assert.equal(r.status, 0, r.stderr);
    const seen = lastSeen(dir);
    assert.ok(seen.files.includes('.claim-check/transcript.redacted.jsonl'), JSON.stringify(seen.files));
    assert.equal(seen.files.includes('notes/session.jsonl'), false, 'the unredacted transcript reached the reviewer');
  });
});

test('G-5: what the surface left out is recorded in check.json and in the result\'s not_checked', () => {
  withTempDir((dir) => {
    const outside = path.join(dir, 'outside.md');
    fs.writeFileSync(outside, 'outside the repository\n');
    const { repo, check } = fixtureRepo(dir);
    // A hard link whose other link is outside the repository: the builder withholds it and still succeeds.
    fs.linkSync(outside, path.join(repo, 'linked.md'));
    const r = runCheck({ dir, repo, check, codexBody: okBody() });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(lastSeen(dir).files.includes('linked.md'), false, 'the fixture did not withhold the link');
    const info = readJson(path.join(check, 'check.json'));
    assert.ok(Array.isArray(info.surface_withheld) && info.surface_withheld.some((w) => w.path === 'linked.md'),
      `check.json does not record what the surface left out: ${JSON.stringify(info.surface_withheld)}`);
    const res = readJson(path.join(check, 'result.json'));
    assert.ok(res.not_checked.some((n) => String(typeof n === 'string' ? n : JSON.stringify(n)).includes('linked.md')),
      `the result's not_checked does not name it: ${JSON.stringify(res.not_checked)}`);
  });
});

test('G-6: a failed --check leaves no earlier check\'s result, record or page looking current', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir);
    for (const f of ['result.json', 'check.json', 'checked.json']) fs.writeFileSync(path.join(check, f), '{"stale":true}\n');
    fs.writeFileSync(path.join(check, 'checked.md'), '# stale\n');
    const r = runCheck({ dir, repo, check, codexBody: { not: 'a result' } });
    assert.notEqual(r.status, 0, 'the check succeeded on an arm with no result');
    for (const f of ['result.json', 'check.json', 'checked.json', 'checked.md']) {
      assert.equal(fs.existsSync(path.join(check, f)), false, `an earlier check's ${f} survived a failed retry`);
    }
  });
});

// G-2 (and its symptom G-3) of 20261025-232315-tel-remediation-4-review: a failure AFTER the paid cross-family checker ran
// (no result, or a same-family merge that failed) exited through fail() with no record, so the check vanished from
// telemetry. Its record is written, the checker a task marked FAILED; check.json still is not (G-6 above).
test('G-2: a check that fails after its cross-family checker ran still writes its telemetry record, and no check.json', () => {
  withTempDir((dir) => {
    const { repo, check } = fixtureRepo(dir);
    const r = runCheck({ dir, repo, check, codexBody: { not: 'a result' } });
    assert.notEqual(r.status, 0, 'the check succeeded on an arm with no result');
    assert.equal(fs.existsSync(path.join(check, 'check.json')), false, 'a failed check left a check.json that reads as current');
    const tel = path.join(check, 'telemetry.json');
    assert.ok(fs.existsSync(tel), `a failed check wrote no telemetry record: ${r.stderr}`);
    const rec = readJson(tel);
    const task = rec.tasks.find((t) => t.task_kind === 'claim-checker');
    assert.ok(task, `the record has no checker task: ${JSON.stringify(rec.tasks)}`);
    assert.equal(task.state, 'FAILED');
    assert.ok(task.started_at && task.ended_at, 'the checker\'s process times were not recorded');
  });
});
