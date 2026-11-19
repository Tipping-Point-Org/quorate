// telemetry-records.plan.md stage 3: the writers. The I/O half (io/telemetry-record.mjs) reads a finished run's files and
// writes its record beside them; run-graph, remediate, claim-check, spawn-subagent and the bench scripts call it; and
// `telemetry.mjs backfill` builds records for the runs that predate them. The run directories here are assembled from the
// fixtures cut from real files (tests/fixtures/telemetry/), in the layout a run writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, SCRIPTS_DIR, withTempDir } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';
import { writeRunRecord, writeClaimCheckRecord, writeBenchRecord, subagentRecordPath, benchRecordPath, readRecords, isSelfReview } from '../scripts/io/telemetry-record.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'telemetry');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const put = (file, obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj)); };

// A finished review's directory, in the layout run-graph leaves: nodes/, evidence/, checks, groups, the gate.
function reviewDir(root, name = '20261025-114413-fixture-review') {
  const dir = path.join(root, name);
  put(path.join(dir, 'run.json'), { ...fx('review-run.json'), run_id: name });
  for (const [id, s] of Object.entries(fx('review-statuses.json'))) put(path.join(dir, 'nodes', `${id}.status.json`), s);
  put(path.join(dir, 'evidence', 'code-audit', 'stdout.json'), fx('review-stdouts.json')['code-audit']);
  put(path.join(dir, 'evidence', 'reconcile-reask', 'batch-1-status.json'), fx('reask-status.json'));
  put(path.join(dir, 'checks.json'), fx('review-checks.json'));
  put(path.join(dir, 'finding-groups.json'), { groups: fx('review-groups.json') });
  put(path.join(dir, 'evidence', 'reconcile', 'payload.json'), { groups: fx('review-decisions.json') });
  put(path.join(dir, 'gate.json'), fx('review-gate.json'));
  return dir;
}

test('stage 3: writeRunRecord reads every task a run directory holds, the re-ask batches included', () => {
  withTempDir((tmp) => {
    const dir = reviewDir(tmp);
    const r = writeRunRecord(dir, { recordKind: 'review', repoRoot: tmp });
    assert.equal(r.ok, true, r.note);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8'));
    const ids = rec.tasks.map((t) => t.id);
    for (const id of Object.keys(fx('review-statuses.json'))) assert.ok(ids.includes(id), `${id} missing`);
    assert.ok(ids.includes('reconcile-reask-1'), 'the re-ask batch is a task');
    assert.ok(ids.includes('check:build'));
    assert.equal(rec.tasks.find((t) => t.id === 'code-audit').terminal_reason, fx('review-stdouts.json')['code-audit'].terminal_reason,
      'the stdout envelope beside a status is read');
    assert.equal(rec.development_data, false, 'a repository that is not the framework\'s own is not development data');
  });
});

test('stage 3: a record that cannot be built is a note, never a throw', () => {
  withTempDir((tmp) => {
    const dir = reviewDir(tmp);
    fs.writeFileSync(path.join(dir, 'gate.json'), '{ not json');
    const r = writeRunRecord(dir, { recordKind: 'review', repoRoot: tmp });
    assert.equal(r.ok, false);
    assert.match(r.note, /telemetry record not written/);
    assert.equal(fs.existsSync(path.join(dir, 'telemetry.json')), false, 'no record is guessed from a half-read run');
  });
});

test('stage 3: a subagent\'s and a bench run\'s records are named after the file beside them', () => {
  assert.equal(subagentRecordPath(path.join('a', 'round-1', 'envelope.json')), path.join('a', 'round-1', 'envelope.telemetry.json'));
  assert.equal(benchRecordPath(path.join('bench', 'results', '2026-09-24T00-04-14-249Z.json')),
    path.join('bench', 'results', '2026-09-24T00-04-14-249Z.telemetry.json'));
  // The extension is matched as ".json", not as any character before "json" (a regex that lost its backslash in a heredoc).
  assert.equal(benchRecordPath('results-xjson'), 'results-xjson.telemetry.json');
  assert.equal(subagentRecordPath('envelope-xjson'), 'envelope-xjson.telemetry.json');
});

test('stage 3: run-graph writes the review\'s record before the run is archived, so the record moves with it', () => {
  const src = fs.readFileSync(path.join(SCRIPTS_DIR, 'run-graph.mjs'), 'utf8');
  const write = src.indexOf("writeRunRecord(runDir, { recordKind: 'review', repoRoot })");
  const archive = src.indexOf('const finalDir = args.noArchive ? runDir');
  assert.ok(write > 0, 'run-graph does not write the record');
  assert.ok(write < archive, 'the record is written after the archive, so it stays behind');
});

test('stage 3: the bench scripts write a record beside their results file', () => {
  for (const f of ['bench-lenses.mjs', 'bench-second-opinion.mjs']) {
    assert.match(fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8'), /writeBenchRecord\((outFile|outPath), \{ repoRoot: FRAMEWORK_ROOT \}\)/, f);
  }
});

function contractRepo(dir) {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: tel-fixture',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:',
    '  models: { judgment: opus }', '  effort: { judgment: low }', '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'fixture');
  return repo;
}

test('stage 3: backfill writes a record for each finished run, check and bench result, and leaves existing ones alone', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    const reviews = path.join(repo, '.claude', 'reviews');
    const one = reviewDir(reviews, '20261025-000001-one');
    const two = reviewDir(reviews, '20261025-000002-two');
    fs.writeFileSync(path.join(two, 'telemetry.json'), '{"kept":true}');
    const unfinished = path.join(reviews, '20261025-000003-unfinished');
    put(path.join(unfinished, 'run.json'), { run_id: '20261025-000003-unfinished' });
    const check = path.join(repo, '.claude', 'claim-checks', 'c1');
    put(path.join(check, 'check.json'), fx('claim-check-check.json'));
    put(path.join(check, 'arm.json'), fx('claim-check-arm.json'));
    put(path.join(check, 'checked.json'), fx('claim-check-checked.json'));
    const bench = path.join(repo, 'bench', 'results', '2026-09-24T00-04-14-249Z.json');
    put(bench, fx('bench-results.json'));

    const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home') };
    delete env.GRAPH_NODE_DEPTH;
    const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'telemetry.mjs'), 'backfill', '--repo-root', repo], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(one, 'telemetry.json'), 'utf8')).kind, 'review');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(two, 'telemetry.json'), 'utf8')), { kept: true }, 'an existing record was rewritten');
    assert.equal(fs.existsSync(path.join(unfinished, 'telemetry.json')), false, 'a run with no gate is not finished');
    assert.match(r.stdout, /skipped .*20261025-000003-unfinished: no gate/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(check, 'telemetry.json'), 'utf8')).kind, 'claim-check');
    assert.equal(JSON.parse(fs.readFileSync(benchRecordPath(bench), 'utf8')).kind, 'bench');
    assert.match(r.stdout, /3 written, 1 already there, 1 skipped, 0 could not be built/);
  });
});

// ------------------------------------------------------------------ remediation of 20261025-203513-tel-delivery

test('G-4: a re-ask is counted once, by its batches, not also by the aggregate status that sums them', () => {
  withTempDir((tmp) => {
    const dir = reviewDir(tmp);
    const batch = fx('reask-status.json');
    put(path.join(dir, 'evidence', 'reconcile-reask', 'batch-2-status.json'), batch);
    // run-graph's aggregate: the batches' durations and costs summed, written beside every other node status.
    put(path.join(dir, 'nodes', 'reconcile-reask.status.json'), { ...batch, duration_ms: batch.duration_ms * 2,
      total_cost_usd: (batch.total_cost_usd ?? 0) * 2 });
    assert.equal(writeRunRecord(dir, { recordKind: 'review', repoRoot: tmp }).ok, true);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8'));
    const reasks = rec.tasks.filter((t) => t.task_kind === 'reask').map((t) => t.id).sort();
    assert.deepEqual(reasks, ['reconcile-reask-1', 'reconcile-reask-2'], 'the aggregate is a second count of the batches');
  });
});

test('G-11: a run\'s tasks are attributed to the node runtime its frozen contract declared, not to a default', () => {
  withTempDir((tmp) => {
    const dir = reviewDir(tmp);
    const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    put(path.join(dir, 'run.json'), { ...run, contract: { ...(run.contract ?? {}), review: { ...(run.contract?.review ?? {}), runtime: 'codex' } } });
    assert.equal(writeRunRecord(dir, { recordKind: 'review', repoRoot: tmp }).ok, true);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8'));
    // A family is the runtime adapter's (runtime-call-telemetry stage 1): the frozen runtime codex gives openai, never the
    // default runtime's anthropic.
    assert.equal(rec.tasks.find((t) => t.id === 'code-audit').family, 'openai');
    assert.equal(rec.tasks.find((t) => t.id === 'panel-codex-code').family, 'openai', 'an arm\'s family is its adapter\'s');
  });
});

test('G-12: a remediation run\'s formatter baseline reaches its record', () => {
  withTempDir((tmp) => {
    const dir = reviewDir(tmp);
    const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    put(path.join(dir, 'run.json'), { ...run, fmt_baseline: { fmt_check: { exit_code: 0, outcome: 'passed', duration_ms: 5 } } });
    assert.equal(writeRunRecord(dir, { recordKind: 'remediation', repoRoot: tmp }).ok, true);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8'));
    assert.ok(rec.tasks.some((t) => t.id === 'fmt-baseline:fmt_check'));
  });
});

test('G-6: a record folder that cannot be listed is named unreadable, never a crash', () => {
  withTempDir((tmp) => {
    // bench/results is a FILE: listing it fails with ENOTDIR, as an EACCES would, and not with ENOENT.
    // A plan-review round is listed through the same guarded read; only a directory is listed there, so no portable
    // fixture makes one fail, and this one stands for both.
    put(path.join(tmp, 'bench', 'results'), {});
    let got;
    assert.doesNotThrow(() => { got = readRecords(tmp, { runRoots: [] }); });
    assert.ok(got.unreadable.some((u) => u.includes(path.join('bench', 'results'))), got.unreadable.join('\n'));
  });
});

const backfill = (dir, repo, extra = []) => {
  const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home') };
  delete env.GRAPH_NODE_DEPTH;
  return spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'telemetry.mjs'), 'backfill', ...extra, '--repo-root', repo], { cwd: repo, env, encoding: 'utf8' });
};

test('G-20: backfill leaves a remediation that has not ended alone, and names it', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    // STAGED, under quorate's home, where a remediation in flight lives: an archived one has ended by being archived.
    const staging = defaultReviewsRoot({ project: 'tel-fixture', repoRoot: fs.realpathSync.native(repo), home: path.join(dir, 'home') });   // native, as the engine keys it (8.3, CI run 43281517496)
    const active = path.join(staging, '20261025-000004-active-remediation');
    put(path.join(active, 'run.json'), { run_id: '20261025-000004-active-remediation', remediates: '20261025-000001-one' });
    // The runner's mark, which remediate.mjs writes at mint: only a run it made is asked whether it has ended.
    put(path.join(active, 'remediate-settings.json'), {});
    const ended = path.join(staging, '20261025-000005-ended-remediation');
    put(path.join(ended, 'run.json'), { run_id: '20261025-000005-ended-remediation', remediates: '20261025-000001-one',
      remediation_state: 'reported', clusters: [] });
    // ARCHIVED, from before remediation_state existed (the earliest remediations, 2026-09): ended, so it gets its record
    // (found by backfill --rebuild, runtime-call-telemetry stage 5, which skipped 93 of them as never run).
    const old = path.join(repo, '.claude', 'reviews', '20260902-130727-old-remediation');
    put(path.join(old, 'run.json'), { run_id: '20260902-130727-old-remediation', remediates: '20260902-030905-x' });
    const r = backfill(dir, repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.existsSync(path.join(active, 'telemetry.json')), false, 'a remediation that has not ended got a frozen partial record');
    assert.match(r.stdout, /skipped .*000004-active-remediation: .*not ended/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(ended, 'telemetry.json'), 'utf8')).kind, 'remediation');
    assert.equal(JSON.parse(fs.readFileSync(path.join(old, 'telemetry.json'), 'utf8')).kind, 'remediation',
      'an archived remediation from before remediation_state was read as never run');
  });
});

// G-11 of 20261105-070121-crsf-remediation-2-review (panel-codex-arch): backfill rooted each run's owner at the run
// itself, so a junction at .claude/reviews, above the run, was followed and the run's files read as its own. The run is
// walked from the repository down (A-30), and a link above it names the run failed, never "already there".
test('G-11: backfill refuses a run reached through a link above it, below the repository', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    // Inside the repository, so the root list keeps it (it drops a root whose real path escapes): A-30 refuses a link at
    // any level whatever it leads to, a link back inside included.
    const outside = path.join(repo, 'elsewhere');
    const run = reviewDir(outside, '20261025-000009-linked');
    fs.writeFileSync(path.join(run, 'telemetry.json'), '{"kept":true}');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.symlinkSync(outside, path.join(repo, '.claude', 'reviews'), process.platform === 'win32' ? 'junction' : 'dir');
    const r = backfill(dir, repo);
    assert.doesNotMatch(r.stdout, /1 already there/, 'a run behind a link above it was read as its own record');
    // Refused at the listing since G-10 of 20261105-151040-crsf-remediation-4b-review: the linked root is named unreadable.
    assert.match(r.stdout, /UNREAD .*reviews: ECONFINED/, 'the linked root is not named');
    assert.equal(r.status, 1, r.stdout + r.stderr);
  });
});

test('G-21: backfill makes no bench record of a forge file, which is not a measurement', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    const forge = path.join(repo, 'bench', 'results', '2026-09-24T00-04-14-249Z.forge.json');
    put(forge, { schema_version: 1, not_a_measurement: 'forged rationales only', seeds: [{ seed: 's', spent: { second_opinion_usd: 1 } }] });
    const r = backfill(dir, repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.existsSync(benchRecordPath(forge)), false, 'a forge file became a bench record');
    assert.match(r.stdout, /skipped .*forge\.json: not a measurement/);
  });
});

// ------------------------------------------------------------ remediation of 20261025-215217-tel-remediation-2-review

test('G-20: a task\'s runtime is the one the run or check froze, never today\'s adapter table; none frozen is unknown', () => {
  withTempDir((tmp) => {
    const family = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8')).tasks.find((t) => t.id === 'code-audit').family;
    const frozen = reviewDir(tmp, '20261025-000001-frozen');
    const run = JSON.parse(fs.readFileSync(path.join(frozen, 'run.json'), 'utf8'));
    put(path.join(frozen, 'run.json'), { ...run, host: { ...(run.host ?? {}), runtime: 'codex' } });
    assert.equal(writeRunRecord(frozen, { recordKind: 'review', repoRoot: tmp }).ok, true);
    assert.equal(family(frozen), 'openai', 'run.json host.runtime was not read (codex, so openai, not the default runtime\'s anthropic)');
    const none = reviewDir(tmp, '20261025-000002-none');
    const bare = JSON.parse(fs.readFileSync(path.join(none, 'run.json'), 'utf8'));
    delete bare.host; delete bare.contract;
    put(path.join(none, 'run.json'), bare);
    assert.equal(writeRunRecord(none, { recordKind: 'review', repoRoot: tmp }).ok, true);
    assert.equal(family(none), 'unknown', 'a run that froze no runtime was attributed to today\'s configuration');
    // A claim check's same-family checker ran on the runtime its check.json recorded.
    const check = path.join(tmp, 'c1');
    put(path.join(check, 'check.json'), { family: 'same', arm: null, same_family: { runtime: 'codex' } });
    put(path.join(check, 'same-family.envelope.json'), { type: 'result', is_error: false });
    put(path.join(check, 'checked.json'), {});
    assert.equal(writeClaimCheckRecord(check, { repoRoot: tmp }).ok, true);
    const t = JSON.parse(fs.readFileSync(path.join(check, 'telemetry.json'), 'utf8')).tasks.find((x) => x.id === 'claim-checker-same-family');
    assert.equal(t.family, 'openai', 'check.json same_family.runtime was not read');
  });
});

test('G-17/G-10: a results file marked not_a_measurement gets no record, whatever its name, and one beside it is not read', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    const marked = path.join(repo, 'bench', 'results', '2026-09-24T00-04-14-249Z.json');
    put(marked, { ...fx('bench-results.json'), not_a_measurement: 'forged rationales only' });
    assert.equal(fs.existsSync(benchRecordPath(marked)), false);
    assert.equal(writeBenchRecord(marked, { repoRoot: repo }).written ?? true, false, 'the writer wrote a record of a non-measurement');
    assert.equal(fs.existsSync(benchRecordPath(marked)), false, 'the writer wrote a record of a non-measurement');
    const r = backfill(dir, repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.existsSync(benchRecordPath(marked)), false, 'backfill wrote a record of a marked file not named .forge.json');
    assert.match(r.stdout, /skipped .*249Z\.json: not a measurement/);
    // A record already standing beside a marked file is not read into the report.
    put(benchRecordPath(marked), { schema_version: 1, kind: 'bench', tasks: [] });
    assert.equal(readRecords(repo, { runRoots: [] }).records.length, 0, 'a record beside a non-measurement was read');
  });
});

test('G-16: backfill names a run whose files cannot be stat\'d as failed, and goes on to the rest', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    const reviews = path.join(repo, '.claude', 'reviews');
    const one = reviewDir(reviews, '20261025-000001-one');
    reviewDir(reviews, '20261025-000002-EACCES-HERE');
    // A stat that fails with EACCES, as an unreadable or looping run.json does: no portable fixture makes one, so the
    // backfill runs with statSync failing for that run's paths.
    const pre = path.join(dir, 'deny-stat.mjs');
    fs.writeFileSync(pre, ["import fs from 'node:fs';", "import { syncBuiltinESMExports } from 'node:module';",
      'const real = fs.statSync;',
      "fs.statSync = (p, ...a) => { if (String(p).includes('EACCES-HERE')) { const e = new Error('denied'); e.code = 'EACCES'; throw e; } return real(p, ...a); };",
      // A run's files are probed through its owner, which lstats (G-7 of 20261030-153323-ciss-s7-remediation-2-review).
      'const realL = fs.lstatSync;',
      "fs.lstatSync = (p, ...a) => { if (String(p).includes('EACCES-HERE')) { const e = new Error('denied'); e.code = 'EACCES'; throw e; } return realL(p, ...a); };",
      'syncBuiltinESMExports();', ''].join('\n'));
    const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home') };
    delete env.GRAPH_NODE_DEPTH;
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(pre).href, path.join(SCRIPTS_DIR, 'telemetry.mjs'), 'backfill',
      '--repo-root', repo], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAILED .*EACCES-HERE/, r.stdout + r.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(one, 'telemetry.json'), 'utf8')).kind, 'review', 'the other run was not reached');
  });
});

test('G-8: the engine\'s own repository named in another case is still a self-review where the file system folds case', (t) => {
  if (!hostPlatform().caseInsensitiveFs) { t.skip('this file system tells names apart by case'); return; }
  const flip = (s) => [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
  assert.equal(isSelfReview(REPO_ROOT), true);
  assert.equal(isSelfReview(flip(REPO_ROOT)), true, 'the same repository in another case was not recognised');
});

test('G-11: readRecords keeps only the records its caller selects, so a narrow report holds no more than it reports', () => {
  withTempDir((tmp) => {
    for (const [name, kind] of [['a', 'review'], ['b', 'remediation'], ['c', 'review']]) {
      put(path.join(tmp, 'runs', name, 'telemetry.json'), { schema_version: 1, kind, run_id: name });
    }
    const got = readRecords(tmp, { runRoots: [path.join(tmp, 'runs')], keep: (r) => r.kind === 'remediation' });
    assert.deepEqual(got.records.map((r) => r.run_id), ['b'], 'records the caller did not select were held');
    assert.equal(got.locations[0].found, 3, 'a location still says how many records it held');
  });
});

test('stage 3: a node killed before it printed leaves an empty stdout, and its run still gets a record', () => {
  // Found by the backfill over this repository: five archived runs held an empty evidence/<node>/stdout.json, among them
  // the remediation stopped at its 30-minute limit on 2026-10-13. The child's raw output is not an engine record.
  withTempDir((tmp) => {
    const dir = reviewDir(tmp);
    fs.writeFileSync(path.join(dir, 'evidence', 'code-audit', 'stdout.json'), '');
    const r = writeRunRecord(dir, { recordKind: 'review', repoRoot: tmp });
    assert.equal(r.ok, true, r.note);
    const t = JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8')).tasks.find((x) => x.id === 'code-audit');
    assert.equal(t.terminal_reason, null, 'no envelope: its fields are absent');
    assert.equal(t.duration_ms, fx('review-statuses.json')['code-audit'].duration_ms, 'the status still gives what it recorded');
  });
});

test('runtime-call-telemetry stage 5: backfill --rebuild rewrites a record already there; without it, the record is left alone', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    const one = reviewDir(path.join(repo, '.claude', 'reviews'), '20261025-000001-one');
    // A run freezes the runtime its nodes ran on, as a real run.json does (host.runtime); a run that froze none reads unknown.
    const run1 = JSON.parse(fs.readFileSync(path.join(one, 'run.json'), 'utf8'));
    put(path.join(one, 'run.json'), { ...run1, host: { ...(run1.host ?? {}), runtime: 'claude' } });
    fs.writeFileSync(path.join(one, 'telemetry.json'), '{"kept":true}');
    const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home') };
    delete env.GRAPH_NODE_DEPTH;
    const run = (extra) => spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'telemetry.mjs'), 'backfill', ...extra, '--repo-root', repo],
      { cwd: repo, env, encoding: 'utf8' });
    assert.equal(run([]).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(one, 'telemetry.json'), 'utf8')), { kept: true });
    const r = run(['--rebuild']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const rec = JSON.parse(fs.readFileSync(path.join(one, 'telemetry.json'), 'utf8'));
    assert.equal(rec.kind, 'review', 'the record was not rebuilt');
    assert.equal(rec.tasks.find((t) => t.id === 'code-audit').family, 'anthropic', 'the rebuilt record follows the one family rule');
  });
});

test('G-15 of 20261026-080302-rct-delivery: backfill --rebuild rebuilds a failed claim check, which has a record and no checked.json', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    // A check that failed after its checker ran: claim-check writes its record and no check.json or checked.json.
    const failedCheck = path.join(repo, '.claude', 'claim-checks', 'c-failed');
    fs.mkdirSync(failedCheck, { recursive: true });
    fs.writeFileSync(path.join(failedCheck, 'steps.jsonl'),
      `${JSON.stringify({ step: 'start', task: null, panel: true, setting: 'cross-family', family: 'cross', same_runtime: 'claude' })}\n`);
    put(path.join(failedCheck, 'arm.json'), fx('claim-check-arm.json'));
    fs.writeFileSync(path.join(failedCheck, 'telemetry.json'), '{"kept":true}');
    // A check directory with neither is one the rules step never reached and no writer ever recorded: still skipped.
    const never = path.join(repo, '.claude', 'claim-checks', 'c-never');
    fs.mkdirSync(never, { recursive: true });
    const r = backfill(dir, repo, ['--rebuild']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(failedCheck, 'telemetry.json'), 'utf8')).kind, 'claim-check',
      'a failed check\'s record was not rebuilt under --rebuild');
    assert.match(r.stdout, /skipped .*c-never: no checked\.json/);
  });
});
