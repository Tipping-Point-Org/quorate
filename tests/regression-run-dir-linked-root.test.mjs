// regression-run-dir-linked-root.test.mjs — ci-path-identity.plan.md stage 1.
//
// PR #3's macOS job (CI run 44206754901) failed 309 tests on one cause: /var is a link to /private/var, admitRun took
// the run directory's real path (/private/var/...) and compared it with roots built from the engine's home as spelled
// (/var/...), so every run under the temporary folder was refused as "not one of <repo>'s runs". A root is now resolved
// to its real path before a run directory is compared with it. A link ABOVE a root is where the root lives; a link
// BELOW the run is still refused (ARCHITECTURE.md A-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, REPO_PROJECT, runScript, mintSlug, mintedRunDir } from './helpers.mjs';
import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

function linkedHome(t) {
  // fs.realpathSync.native throughout (CI run 44360975949): the JS realpathSync keeps a Windows runner's 8.3 spelling (RUNNER~1)
  // while the engine prints the long one, so a spelling built from it matched nothing there.
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-linked-root-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, 'real');
  fs.mkdirSync(real);
  const link = path.join(base, 'link');
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  // The home is spelled THROUGH the link, as QUORATE_HOME under macOS's /var is.
  const home = path.join(link, 'home');
  const runId = '20260101-000000-linked';
  const dir = path.join(defaultReviewsRoot({ project: REPO_PROJECT, repoRoot: REPO_ROOT, home }), runId);
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: runId, repo_root: REPO_ROOT, contract: {}, host: { cwd: REPO_ROOT } }));
  return { home, dir, realDir: fs.realpathSync.native(dir) };
}

const capture = (home, runDir, name) => runScript('capture.mjs',
  ['--run-dir', runDir, '--node', 'lens', '--name', name, '--', 'git', 'rev-parse', 'HEAD'], { env: { QUORATE_HOME: home } });

test('stage 1: a run under an engine home spelled through a link is admitted, by either spelling of the run', (t) => {
  const { home, dir, realDir } = linkedHome(t);
  assert.notEqual(dir, realDir, 'precondition: the fixture spells the run through a link');
  const viaLink = capture(home, dir, 'via-link');
  assert.equal(viaLink.status, 0, viaLink.output.slice(-600));
  const viaReal = capture(home, realDir, 'via-real');
  assert.equal(viaReal.status, 0, viaReal.output.slice(-600));
});

// Stage 1c: a run MINTED with the home and --repo-root both spelled through a link. new-run keyed its staging folder by the
// hash of the linked spelling, and a caller given the real spelling looked in another folder; spawn-node compared the
// generated intent settings under the real run directory with a --settings spelled through the link (CI run 44220656481).
function mintedThroughLink(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-linked-mint-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'real'));
  const link = path.join(base, 'link');
  fs.symlinkSync(path.join(base, 'real'), link, process.platform === 'win32' ? 'junction' : 'dir');
  const repoReal = path.join(base, 'real', 'repo');
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(repoReal, rel)), { recursive: true }); fs.writeFileSync(path.join(repoReal, rel), body); };
  put('src/app.js', 'export const x = 1;\n');
  put('docs/a.md', '# a\n');
  put('CLAUDE.md', '# fixture\n\n```yaml\n' + ['graph_contract_version: 6', 'project: lnk', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: ["docs/**"]', 'review:', '  external_panel: false'].join('\n') + '\n```\n');
  spawnSync('git', ['init', '-q', '.'], { cwd: repoReal });
  const home = path.join(link, 'home');
  const repoLinked = path.join(link, 'repo');
  const mint = runScript('new-run.mjs', ['--slug', mintSlug('lnk'), '--repo-root', repoLinked, '--no-verify-sandbox', '--full-sweep', 'src'],
    { cwd: repoReal, env: { QUORATE_HOME: home } });
  assert.equal(mint.status, 0, mint.output.slice(-600));
  return { home, repoReal, repoLinked, runDir: mintedRunDir(mint.output) };
}

test('stage 1c: a run minted through a linked home and --repo-root is admitted when the caller spells the repository really', (t) => {
  const { home, repoReal, runDir } = mintedThroughLink(t);
  const r = runScript('capture.mjs', ['--run-dir', runDir, '--node', 'lens', '--name', 'probe', '--', 'git', 'status', '--short'],
    { cwd: repoReal, env: { QUORATE_HOME: home } });
  assert.equal(r.status, 0, r.output.slice(-600));
});

test('stage 1c: spawn-node takes the generated intent settings named through the link', (t) => {
  const { home, repoLinked, runDir } = mintedThroughLink(t);
  const linkedRun = runDir.replace(fs.realpathSync.native(path.dirname(path.dirname(home))), path.dirname(path.dirname(home)));
  const settings = path.join(linkedRun, 'intent-settings.json');
  if (!fs.existsSync(settings)) fs.writeFileSync(settings, JSON.stringify({ permissions: { deny: ['Grep'] } }));
  fs.mkdirSync(path.join(linkedRun, 'docs'), { recursive: true });
  const r = runScript('spawn-node.mjs', ['--run-dir', linkedRun, '--repo-root', repoLinked, '--node-id', 'intent-capture', '--mode', 'intent',
    '--prompt', 'x', '--settings', settings, '--add-dir', path.join(linkedRun, 'docs'), '--print-cmd'], { cwd: repoLinked, env: { QUORATE_HOME: home } });
  assert.equal(r.status, 0, r.output.slice(-600));
});

// G-16 of 20261118-112631-cpi-review: I-21 asks the linked-root fixture to mint a REMEDIATION and FOLD a run through both
// spellings, and neither was tested; on Linux and win32 nothing above the temporary folder is a link, so only macOS CI
// reached them, by accident.
const finish = (dir) => {
  fs.writeFileSync(path.join(dir, 'reconciled.md'), '# Reconciled\n\n## Confirmed (1)\n\n### G-1 · MEDIUM · `src/app.js:1`\n');
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  fs.writeFileSync(path.join(dir, 'finding-groups.json'), JSON.stringify({ groups: [] }));
  fs.mkdirSync(path.join(dir, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }] }));
};
const throughLink = (home, runDir) => runDir.replace(path.dirname(fs.realpathSync.native(home)), path.dirname(home));

test('G-16: new-run --remediates admits a run minted through a link, by either spelling of the run and the repository', (t) => {
  const { home, repoReal, repoLinked, runDir } = mintedThroughLink(t);
  finish(runDir);
  const linkedRun = throughLink(home, runDir);
  assert.notEqual(linkedRun, runDir, 'precondition: the run has a spelling through the link');
  for (const [repo, run, slug] of [[repoLinked, linkedRun, 'fixl'], [repoReal, runDir, 'fixr']]) {
    const r = runScript('new-run.mjs', ['--slug', mintSlug(slug), '--repo-root', repo, '--no-request', '--no-verify-sandbox', '--remediates', run],
      { cwd: repoReal, env: { QUORATE_HOME: home } });
    assert.equal(r.status, 0, `${repo} / ${run}: ${r.output.slice(-600)}`);
  }
});

test('G-16: findings-ledger folds a run minted through a link, by either spelling of the run and the repository', (t) => {
  const { home, repoReal, repoLinked, runDir } = mintedThroughLink(t);
  finish(runDir);
  for (const [repo, run] of [[repoLinked, throughLink(home, runDir)], [repoReal, runDir]]) {
    const r = runScript('findings-ledger.mjs', ['--run-dir', run, '--repo-root', repo], { cwd: repoReal, env: { QUORATE_HOME: home } });
    assert.equal(r.status, 0, `${repo} / ${run}: ${r.output.slice(-600)}`);
  }
});

test('stage 1: a link below the run is still refused when the home is spelled through a link (A-30)', (t) => {
  const { home, dir } = linkedHome(t);
  fs.mkdirSync(path.join(dir, 'elsewhere'));
  fs.symlinkSync(path.join(dir, 'elsewhere'), path.join(dir, 'evidence'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = capture(home, dir, 'probe');
  assert.notEqual(r.status, 0, `the capture was written through the link: ${r.output.slice(-400)}`);
  assert.match(r.output, /link or junction/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'elsewhere')), [], 'nothing was created through the link');
});
