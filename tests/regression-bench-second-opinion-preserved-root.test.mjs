// G-5 of 20261029-235315-rdr-remediation-4-review (panel-codex-docs, panel-codex-security; MEDIUM). bench-second-opinion
// read run.json from the preserved run directory, and later copied that directory whole, with nothing checking what
// stood at the directory itself: an owner refuses a link below its root, not at it, so a link or junction planted at the
// preserved-run path was followed and an outside tree copied. admitRun is reached only on the copy. The preserved run's
// root is now refused when it is a link or not a directory, before anything is read from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { benchFixture, runBench } from './tools/bench-fixture.mjs';

const RESULT = '2026-09-24T00-04-14-249Z';
const SEED = 'clamp-silent-noop';

// G-5 is held by what the bench does, in tests/regression-bench-tree-reads.test.mjs (usage-report-reviewed-runs.plan.md
// stage 4): its source-text form matched the first readRunRecord(c.runDir) in the file, so an earlier reader broke it.

// G-6 of 20261030-024618-rdr-remediation-6-review (panel-codex-security; MEDIUM), with G-5 its symptom. The preserved run
// was copied with fs.cpSync and no filter, which keeps a link below it as a link, and the copy's nodes/ was then read
// (the control report, sent to an external judge) and deleted from (the report and its status) with raw fs calls, so a
// nodes junction in the preserved run led both into another tree. The copy now refuses a link anywhere below the
// preserved run, so the copy holds none and the seed is NOT RUN, naming it.
//
// HELD BY WHAT THE BENCH DOES (G-13 of 20261031-013928-urr-delivery): this test matched the source for a filter,
// `lstatSync` and `throw`, so it passed with the check unreachable or refusing nothing. A dry run, which spends nothing,
// now meets a real junction below a preserved run and must refuse it, with nothing of the outside tree copied.
test('G-6: a link below the preserved run is refused when the run is copied, and nothing is followed', (t) => {
  const fx = benchFixture(t, { gitRepo: true });
  // The seed's patch edits this test; the fixture tree must hold it for the worktree to be recreated.
  fs.mkdirSync(path.join(fx.fw, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'tests', 'regression-caps.test.mjs'), path.join(fx.fw, 'tests', 'regression-caps.test.mjs'));
  fx.git('add', '-A');
  fx.git('commit', '-qm', 'the seed\'s file');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: fx.fw, encoding: 'utf8' }).stdout.trim();
  // The recorded line is the pass's tree, not today's regression-caps; the line check is not what this test is about.
  const resultPath = path.join(fx.fw, 'bench', 'results', `${RESULT}.json`);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  for (const s of result.scores ?? []) if (s.seed === SEED) delete s.defect_line;
  fs.writeFileSync(resultPath, JSON.stringify(result));
  const run = path.join(fx.fw, 'bench', 'results', `${RESULT}-${SEED}-run`);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: `${RESULT}-${SEED}-run`, head_commit: head, contract: { review: {} } }));
  const outside = path.join(path.dirname(fx.fw), 'outside-nodes');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'OUTSIDE-MARK.txt'), 'outside');
  // A junction needs no privilege on Windows; elsewhere this is a directory symlink.
  fs.symlinkSync(outside, path.join(run, 'nodes'), 'junction');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'q-bench-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const r = runBench(fx, 'bench-second-opinion.mjs',
    ['--from', path.join(fx.fw, 'bench', 'results', `${RESULT}.json`), '--seed', SEED, '--dry-run'], { QUORATE_HOME: home });
  assert.match(r.output, /NOT RUN: nodes in the preserved run is a link or junction; it is not copied or followed/, r.output.slice(-1200));
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.name === 'OUTSIDE-MARK.txt') found.push(p); if (e.isDirectory() && !e.isSymbolicLink()) walk(p); } };
  walk(home);
  assert.deepEqual(found, [], 'the outside tree was copied into the staged run');
  assert.ok(fs.existsSync(path.join(outside, 'OUTSIDE-MARK.txt')), 'the outside tree was deleted through the link');
});
