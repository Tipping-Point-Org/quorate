// A hard-linked file in a preserved or kept run is named to the user, not refused (usage-report-followup.plan.md stage 1).
//
// The operator's decision, 2026-10-31: "C but check and report to the user if one is found". G-7 of
// 20261031-033859-urr-remediation-2-review and G-8 of 20261031-055840-urr-remediation-3-review: the preserved-run copy and
// the --rejudge report read refuse a symbolic link or junction but not a hard link, a second name for a file that may sit
// anywhere on the same drive, whose content then reaches the external judge. A symbolic link stays refused (A-30); a hard
// link is warned about, naming the file, and the seed goes on. Both are reached by a dry run, which spends nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { benchFixture, runBench } from './tools/bench-fixture.mjs';

const RESULT = '2026-09-24T00-04-14-249Z';
const SEED = 'clamp-silent-noop';
const RUN_ID = `${RESULT}-${SEED}-run`;

// A framework fixture whose preserved run the dry run copies: the seed's file committed, the recorded line dropped (the
// line check is not what these tests are about), and a preserved run that records the fixture's own head.
function preserved(t) {
  const fx = benchFixture(t, { gitRepo: true });
  fs.mkdirSync(path.join(fx.fw, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'tests', 'regression-caps.test.mjs'), path.join(fx.fw, 'tests', 'regression-caps.test.mjs'));
  fx.git('add', '-A');
  fx.git('commit', '-qm', 'the seed\'s file');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: fx.fw, encoding: 'utf8' }).stdout.trim();
  const resultPath = path.join(fx.fw, 'bench', 'results', `${RESULT}.json`);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  for (const s of result.scores ?? []) if (s.seed === SEED) delete s.defect_line;
  fs.writeFileSync(resultPath, JSON.stringify(result));
  const run = path.join(fx.fw, 'bench', 'results', RUN_ID);
  fs.mkdirSync(path.join(run, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: RUN_ID, head_commit: head, contract: { review: {} } }));
  const outside = path.join(path.dirname(fx.fw), 'outside.txt');
  fs.writeFileSync(outside, 'content from outside the run\n');
  return { fx, run, outside, resultPath };
}
// The fixture's own engine home, so nothing is staged under the operator's ~/.quorate.
const dryRun = (fx, resultPath, extra = []) => runBench(fx, 'bench-second-opinion.mjs', ['--from', resultPath, '--seed', SEED, '--dry-run', ...extra],
  { QUORATE_HOME: path.join(path.dirname(fx.fw), 'home') });

test('a hard-linked file in the preserved run is named when the run is copied, and the seed goes on', (t) => {
  const { fx, run, outside, resultPath } = preserved(t);
  fs.linkSync(outside, path.join(run, 'nodes', 'extra.txt'));
  const r = dryRun(fx, resultPath);
  assert.match(r.output, /HARD LINK .*nodes[\\/]extra\.txt/, `no warning named the hard-linked file:\n${r.output.slice(-1200)}`);
  assert.doesNotMatch(r.output, /NOT RUN[^\n]*extra\.txt/, 'the hard-linked file stopped the seed');
});

test('a hard-linked report in the --rejudge kept run is named when it is chosen, and the seed goes on', (t) => {
  const { fx, run, outside, resultPath } = preserved(t);
  // The --rejudge selection comes after the barrier check, so the preserved run carries a reconciled group the barrier
  // keeps: one confirmed group in the defect's file, and a tolerance wide enough that its line is not what is tested.
  const manifestPath = path.join(fx.fw, 'bench', 'corpus', SEED, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, tolerance: 100000 }));
  fx.git('add', '-A');
  fx.git('commit', '-qm', 'a wide tolerance');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: fx.fw, encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: RUN_ID, head_commit: head, contract: { review: {} } }));
  fs.writeFileSync(path.join(run, 'finding-groups.json'), JSON.stringify({ run_id: RUN_ID,
    groups: [{ group_id: 'G-1', file: manifest.defect.file, line: 1, severity: 'HIGH', members: [] },
      { group_id: 'G-2', file: 'scripts/lib/ledger.mjs', line: 10, severity: 'LOW', members: [] }] }));
  fs.mkdirSync(path.join(run, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(run, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ run_id: RUN_ID,
    groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'HIGH' }, { group_id: 'G-2', decision: 'confirmed', severity: 'LOW' }] }));
  fs.writeFileSync(path.join(run, 'reconciled.md'), ['# Reconciled', '', '## Confirmed (1)', '',
    `### G-1 · HIGH · \`${manifest.defect.file}:1\``, '', 'Raised by: `code-audit`', '', 'The reconciler judged this group real.', '',
    '- `code-audit` · opus: the defect (evidence: `evidence/code-audit/x.log`)', '',
    '### G-2 · LOW · `scripts/lib/ledger.mjs:10`', '', 'Raised by: `code-audit`', '', 'Another group, the anchor\'s destination.', '',
    '- `code-audit` · opus: another finding (evidence: `evidence/code-audit/y.log`)', ''].join('\n'));
  const keptFolder = path.join(path.dirname(fx.fw), 'kept');
  const keptRun = path.join(keptFolder, `${SEED}-x`, RUN_ID);
  fs.mkdirSync(path.join(keptRun, 'nodes'), { recursive: true });
  fs.mkdirSync(path.join(keptRun, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(keptRun, 'reconciled.md'), '# reconciled\n');
  fs.writeFileSync(path.join(keptRun, 'finding-groups.json'), JSON.stringify({ groups: [] }));
  fs.writeFileSync(path.join(keptRun, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [] }));
  fs.linkSync(outside, path.join(keptRun, 'nodes', 'second-opinion-report.md'));
  const r = dryRun(fx, resultPath, ['--rejudge', keptFolder]);
  assert.match(r.output, /HARD LINK .*second-opinion-report\.md/, `no warning named the hard-linked report:\n${r.output.slice(-1200)}`);
});
