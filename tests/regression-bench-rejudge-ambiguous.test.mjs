// G-3 of 20261124-180917-gsw-remediation-4-review-b: `--rejudge` took the first kept directory, by name, among every one
// matching the seed, without knowing which pass it came from. A kept run records neither its mutation, its rule nor its
// setting, so with two kept passes for one seed an older report was re-judged and attributed to the configuration of this
// invocation. Two candidates are refused as ambiguous, both named, and the seed is not run; one candidate goes on.
// Reached by a dry run, which spends nothing.
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

// The preserved run the dry run copies, with one confirmed group in the defect's file so the barrier keeps it and the
// --rejudge selection is reached (the setup of regression-bench-hard-links.test.mjs).
function preserved(t) {
  const fx = benchFixture(t, { gitRepo: true });
  fs.mkdirSync(path.join(fx.fw, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'tests', 'regression-caps.test.mjs'), path.join(fx.fw, 'tests', 'regression-caps.test.mjs'));
  const manifestPath = path.join(fx.fw, 'bench', 'corpus', SEED, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, tolerance: 100000 }));
  fx.git('add', '-A');
  fx.git('commit', '-qm', 'the seed\'s file, a wide tolerance');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: fx.fw, encoding: 'utf8' }).stdout.trim();
  const resultPath = path.join(fx.fw, 'bench', 'results', `${RESULT}.json`);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  for (const s of result.scores ?? []) if (s.seed === SEED) delete s.defect_line;
  fs.writeFileSync(resultPath, JSON.stringify(result));
  const run = path.join(fx.fw, 'bench', 'results', RUN_ID);
  fs.mkdirSync(path.join(run, 'nodes'), { recursive: true });
  fs.mkdirSync(path.join(run, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: RUN_ID, head_commit: head, contract: { review: {} } }));
  fs.writeFileSync(path.join(run, 'finding-groups.json'), JSON.stringify({ run_id: RUN_ID,
    groups: [{ group_id: 'G-1', file: manifest.defect.file, line: 1, severity: 'HIGH', members: [] },
      { group_id: 'G-2', file: 'scripts/lib/ledger.mjs', line: 10, severity: 'LOW', members: [] }] }));
  fs.writeFileSync(path.join(run, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ run_id: RUN_ID,
    groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'HIGH' }, { group_id: 'G-2', decision: 'confirmed', severity: 'LOW' }] }));
  fs.writeFileSync(path.join(run, 'reconciled.md'), ['# Reconciled', '', '## Confirmed (1)', '',
    `### G-1 · HIGH · \`${manifest.defect.file}:1\``, '', 'Raised by: `code-audit`', '', 'The reconciler judged this group real.', '',
    '- `code-audit` · opus: the defect (evidence: `evidence/code-audit/x.log`)', '',
    '### G-2 · LOW · `scripts/lib/ledger.mjs:10`', '', 'Raised by: `code-audit`', '', 'Another group, the anchor\'s destination.', '',
    '- `code-audit` · opus: another finding (evidence: `evidence/code-audit/y.log`)', ''].join('\n'));
  return { fx, resultPath };
}
function keep(keptFolder, name) {
  const keptRun = path.join(keptFolder, name, RUN_ID);
  fs.mkdirSync(path.join(keptRun, 'nodes'), { recursive: true });
  fs.mkdirSync(path.join(keptRun, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(keptRun, 'reconciled.md'), '# reconciled\n');
  fs.writeFileSync(path.join(keptRun, 'finding-groups.json'), JSON.stringify({ groups: [] }));
  fs.writeFileSync(path.join(keptRun, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [] }));
  fs.writeFileSync(path.join(keptRun, 'nodes', 'second-opinion-report.md'), `a report kept by ${name}\n`);
}
const dryRun = (fx, resultPath, extra = []) => runBench(fx, 'bench-second-opinion.mjs', ['--from', resultPath, '--seed', SEED, '--dry-run', ...extra],
  { QUORATE_HOME: path.join(path.dirname(fx.fw), 'home') });

test('two kept passes for one seed are refused as ambiguous, both named, and neither is re-judged', (t) => {
  const { fx, resultPath } = preserved(t);
  const keptFolder = path.join(path.dirname(fx.fw), 'kept');
  keep(keptFolder, `${SEED}-aaaaaa`);
  keep(keptFolder, `${SEED}-bbbbbb`);
  const r = dryRun(fx, resultPath, ['--rejudge', keptFolder]);
  assert.doesNotMatch(r.output, /re-judging preserved artifacts/, `the first kept pass by name was re-judged:\n${r.output.slice(-1500)}`);
  assert.match(r.output, /more than one preserved run/, `no ambiguity was named:\n${r.output.slice(-1500)}`);
  assert.ok(r.output.includes(`${SEED}-aaaaaa`) && r.output.includes(`${SEED}-bbbbbb`), `both candidates are named:\n${r.output.slice(-1500)}`);
});

test('one kept pass for the seed is re-judged', (t) => {
  const { fx, resultPath } = preserved(t);
  const keptFolder = path.join(path.dirname(fx.fw), 'kept');
  keep(keptFolder, `${SEED}-aaaaaa`);
  const r = dryRun(fx, resultPath, ['--rejudge', keptFolder]);
  assert.match(r.output, /re-judging preserved artifacts/, r.output.slice(-1500));
});
