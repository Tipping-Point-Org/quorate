// A REMEDIATION IS JUDGED AGAINST ITS REVIEW'S REQUEST (remediation-consumer-findings.plan.md stage 1, AC5; story-pipeline,
// 2026-10-20). new-run --remediates recorded the reviewed run's request in remediation_frame.request, but resolved the
// run's own `request` again from the contract, with no stamp: a review minted with --request had its remediation, and the
// follow-up review inheriting from it, name a different document (story-pipeline's 20261020-103911).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const approved = (title) => `---\nstatus: approved\n---\n\n# ${title}\n\n## Acceptance criteria\n1. it works\n`;

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-reqinherit-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.claude', 'requests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(repo, '.claude', 'requests', 'a.md'), approved('the reviewed ask'));
  fs.writeFileSync(path.join(repo, '.claude', 'requests', 'b.md'), approved('other work'));
  const yaml = ['graph_contract_version: 6', 'project: reqinherit', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'doc_roles:', '  request: ".claude/requests/b.md"', 'ui:', '  surface: none',
    'review:', '  external_panel: false'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/reviews/\n');
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 'x@x'); git(repo, 'config', 'user.name', 'x');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
  const env = { QUORATE_HOME: path.join(base, 'home'), QUORATE_REVIEWER_PROBES: path.join(base, 'probes') };
  const mint = (extra) => runScript('new-run.mjs', ['--repo-root', repo, '--no-verify-sandbox', ...extra], { cwd: repo, env });
  // A finished review: the files --remediates refuses without, as the runner's own fixture writes them.
  const finish = (dir) => {
    fs.writeFileSync(path.join(dir, 'reconciled.md'), '# Reconciled\n\n## Confirmed (1)\n\n### G-1 · MEDIUM · `src/a.js:1`\n');
    fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
    fs.mkdirSync(path.join(dir, 'evidence', 'reconcile'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'evidence', 'reconcile', 'payload.json'),
      JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }] }));
    return dir;
  };
  // A slug per call: a run id is YYYYMMDD-HHMMSS-<slug>, so two reviews minted within one second under one slug collide
  // ("run dir already exists"), which CI's faster Linux runners hit (PR #2 run 43302732129, Node 22 and 24).
  let reviews = 0;
  const review = (extra) => finish(mintedRunDir(mint(['--slug', `rev${++reviews}`, '--full-sweep', 'src', ...extra]).output));
  const runOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  return { repo, mint, review, runOf };
}

test('AC5: a remediation takes the request its review was judged against, not the contract\'s', (t) => {
  const f = fixture(t);
  const rev = f.review(['--request', '.claude/requests/a.md']);
  assert.equal(f.runOf(rev).request.path, '.claude/requests/a.md');
  const r = f.mint(['--slug', 'fix', '--remediates', rev]);
  assert.equal(r.status, 0, r.output.slice(-800));
  assert.equal(f.runOf(mintedRunDir(r.output)).request?.path, '.claude/requests/a.md', 'the remediation names the contract\'s request');
});

test('AC5: the follow-up review of a remediation inherits the remediation\'s request', (t) => {
  const f = fixture(t);
  const rem = mintedRunDir(f.mint(['--slug', 'fix', '--remediates', f.review(['--request', '.claude/requests/a.md'])]).output);
  const r = f.mint(['--slug', 'fix-review', '--base', 'HEAD', '--follows-remediation', rem, '--full-sweep', 'src']);
  assert.equal(r.status, 0, r.output.slice(-800));
  assert.equal(f.runOf(mintedRunDir(r.output)).request?.path, '.claude/requests/a.md', 'the follow-up names the contract\'s request');
});

test('AC5: a --request that names a different document than the review\'s is refused, naming both', (t) => {
  const f = fixture(t);
  const rev = f.review(['--request', '.claude/requests/a.md']);
  const r = f.mint(['--slug', 'fix', '--remediates', rev, '--request', '.claude/requests/b.md']);
  assert.notEqual(r.status, 0, 'a conflicting --request was accepted');
  assert.match(r.output, /\.claude\/requests\/a\.md/);
  assert.match(r.output, /\.claude\/requests\/b\.md/);
  // The same document, spelled the same, is not a conflict.
  assert.equal(f.mint(['--slug', 'fix2', '--remediates', rev, '--request', '.claude/requests/a.md']).status, 0);
});

test('AC5: a reviewed request that no longer exists refuses the mint, naming it', (t) => {
  const f = fixture(t);
  const rev = f.review(['--request', '.claude/requests/a.md']);
  fs.rmSync(path.join(f.repo, '.claude', 'requests', 'a.md'));
  const r = f.mint(['--slug', 'fix', '--remediates', rev]);
  assert.notEqual(r.status, 0, 'a remediation was minted against a request that is gone');
  assert.match(r.output, /\.claude\/requests\/a\.md/);
});

// G-8 of 20261021-014056-rcf-delivery: the path was checked and the bytes were not, so an edited request was inherited as
// the one the review was judged against, under a fresh hash.
test('G-8: a request edited after the review refuses the remediation mint', (t) => {
  const f = fixture(t);
  const rev = f.review(['--request', '.claude/requests/a.md']);
  fs.writeFileSync(path.join(f.repo, '.claude', 'requests', 'a.md'), approved('the reviewed ask, rewritten'));
  const r = f.mint(['--slug', 'fix', '--remediates', rev]);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /\.claude\/requests\/a\.md has changed since/);
});

test('AC5: an inferred request is inherited with REQUEST-INFERRED; no request stays no request', (t) => {
  const f = fixture(t);
  const rev = f.review(['--request', '.claude/requests/a.md']);
  // As run-graph's recovery leaves a review: an inferred document and the stamp.
  const inferred = '.claude/requests/rev.inferred.md';
  const inferredText = '---\nstatus: inferred\n---\n\n# inferred\n';
  fs.writeFileSync(path.join(f.repo, inferred), inferredText);
  const run = f.runOf(rev);
  // The hash recovery records (run-graph's newestRequestDoc); new-run compares it (G-8 of 20261021-014056-rcf-delivery).
  const sha256 = crypto.createHash('sha256').update(inferredText).digest('hex');
  fs.writeFileSync(path.join(rev, 'run.json'), JSON.stringify({ ...run, request: { path: inferred, sha256 },
    stamps: [...new Set([...(run.stamps ?? []), 'REQUEST-INFERRED'])] }));
  const rem = f.runOf(mintedRunDir(f.mint(['--slug', 'fix', '--remediates', rev]).output));
  assert.equal(rem.request?.path, inferred);
  assert.ok(rem.stamps.includes('REQUEST-INFERRED'), `stamps: ${rem.stamps}`);

  const none = f.review(['--no-request']);
  const remNone = f.runOf(mintedRunDir(f.mint(['--slug', 'fix-none', '--remediates', none]).output));
  assert.equal(remNone.request, null, 'a review with no request gave its remediation the contract\'s');
  assert.ok(remNone.stamps.includes('UNREQUESTED'), `stamps: ${remNone.stamps}`);
});
