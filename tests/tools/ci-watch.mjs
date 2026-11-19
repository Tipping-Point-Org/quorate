#!/usr/bin/env node
// ci-watch — wait for GitHub's CI run on one commit to finish, then report each job and its failing tests.
//
//   node tests/tools/ci-watch.mjs [--sha <commit>] [--repo <owner/name>] [--out <log>]
//
// Started in the background after every push (operator, 2026-11-12: "Add a background agent to run after every push to
// wait for it to finish and check for issues. the last time Github workflow ran green was Oct 11th"): master's CI was red
// on every run from 2026-10-17 to 2026-10-20 and nothing watched it. A developer tool of this repository, not part of the
// engine; it lives in tests/tools beside the suite's other developer tools (G-1 of 20261112-220041-ci-fix-review; operator, 2026-11-12: "A. Move it, then remediate (Recommended)"), and nothing runs it but the session after a push. It needs `gh` logged in; a stale
// GITHUB_TOKEN in the environment is removed for gh's calls, since gh prefers it over the stored login.
//
// Exit: 0 every job passed · 1 a job failed or was cancelled · 2 no run appeared for the commit, or gh failed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { gitSync } from '../../scripts/io/git.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const env = { ...process.env }; delete env.GITHUB_TOKEN;
const gh = (args) => execFileSync('gh', args, { env, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
const firstLine = (e) => String(e?.stderr || e?.message || e).trim().split('\n')[0];
// The repository this checkout's origin names, unless --repo says otherwise: no owner is written here, so a copy in the
// public mirror watches its own repository (m2-public-release.plan.md stage 3).
const originRepo = () => {
  const url = gitSync(['remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  return /github\.com[:/]([^/\s]+\/[^/\s]+?)(\.git)?\/?$/.exec(url)?.[1] ?? null;
};
const repo = arg('repo', null) ?? originRepo();
if (!repo) { process.stderr.write('ci-watch: no --repo, and the origin remote is not a GitHub repository\n'); process.exit(2); }
const out = arg('out', null);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const lines = [];
const say = (l) => { lines.push(l); process.stdout.write(`${l}\n`); };
// The --out log is written on every way out, and the exit code is set rather than forced: process.exit right after
// stdout writes can truncate them on an asynchronous pipe (G-7 of 20261112-220041-ci-fix-review).
const finish = (code) => { if (out) fs.writeFileSync(out, `${lines.join('\n')}\n`); process.exitCode = code; };

function main() {
  // gh's --commit matches the full SHA only, so a short one is resolved first, through the engine's git owner (G-3).
  const rev = gitSync(['rev-parse', arg('sha', 'HEAD')], { encoding: 'utf8' });
  if (rev.status !== 0) { say(`ci-watch: git rev-parse failed: ${firstLine(rev.stderr || rev.error)}`); return 2; }
  const sha = rev.stdout.trim();
  const list = () => JSON.parse(gh(['run', 'list', '--repo', repo, '--commit', sha, '--json', 'databaseId,event,headBranch,workflowName'])) ?? [];

  // A push's run appears after a delay; wait up to five minutes for the first run on this commit.
  let runs = [];
  for (let i = 0; i < 30 && !runs.length; i++) {
    try { runs = list(); } catch (e) { say(`ci-watch: gh run list failed: ${firstLine(e)}`); return 2; }
    if (!runs.length) sleep(10_000);
  }
  if (!runs.length) { say(`ci-watch: no CI run appeared for ${sha.slice(0, 8)} in five minutes (a push to a branch with no open PR runs no CI)`); return 2; }

  let failed = false;
  let ghFailed = false;
  const watched = new Set();
  // Runs are listed again after each round of watching, and every run not yet watched is watched: a workflow whose run
  // is created later for the same commit would otherwise never be seen, and its failure reported as green (G-4).
  for (;;) {
    const fresh = runs.filter((r) => !watched.has(r.databaseId));
    if (!fresh.length) break;
    for (const r of fresh) { watched.add(r.databaseId); if (watchOne(r, sha)) failed = true; }
    try { runs = list(); } catch (e) { say(`ci-watch: gh run list failed: ${firstLine(e)}`); ghFailed = true; break; }
  }
  return failed ? 1 : ghFailed ? 2 : 0;

  // One run: watched to its end, then its jobs reported. True when it did not succeed. A gh failure here is gh's, not
  // the run's: it is said, and makes the exit 2 rather than the job-failed 1 (G-5).
  function watchOne(r, at) {
    try { gh(['run', 'watch', String(r.databaseId), '--repo', repo, '--exit-status', '--interval', '30']); } catch { /* the summary below says why */ }
    let jobs;
    try { jobs = JSON.parse(gh(['run', 'view', String(r.databaseId), '--repo', repo, '--json', 'jobs,conclusion,url'])); } catch (e) {
      say(`ci-watch: gh run view failed for ${r.workflowName} (${r.databaseId}): ${firstLine(e)}`);
      ghFailed = true;
      return false;
    }
    return report(r, at, jobs);
  }
}

function report(r, sha, jobs) {
  let failed = false;
  say(`ci-watch: ${r.workflowName} on ${r.event} ${r.headBranch} @ ${sha.slice(0, 8)}: ${jobs.conclusion} — ${jobs.url}`);
  for (const j of jobs.jobs) say(`  ${j.conclusion === 'success' ? 'ok  ' : 'FAIL'} ${j.name}`);
  if (jobs.conclusion !== 'success') {
    failed = true;
    let log = '';
    try { log = gh(['run', 'view', String(r.databaseId), '--repo', repo, '--log-failed']); } catch { log = ''; }
    // Each job's own summary: the counts and the "failing tests" list run-all's reporter prints.
    const byJob = new Map();
    for (const l of log.split(/\r?\n/)) {
      const [job, , ...rest] = l.split('\t');
      const text = rest.join('\t').replace(/^\S+\s/, '');
      if (!byJob.has(job)) byJob.set(job, []);
      byJob.get(job).push(text);
    }
    for (const [job, text] of byJob) {
      if (!job) continue; // a log line with no job column (a blank line), not a job
      const counts = text.filter((t) => /^ℹ (tests|fail) /.test(t)).join(', ');
      const at = text.findIndex((t) => t.startsWith('✖ failing tests:'));
      const failing = at < 0 ? [] : [...new Set(text.slice(at + 1).filter((t) => t.startsWith('✖ ')))];
      say(`  ${job}: ${counts || 'no suite summary (failed before the tests ran)'}`);
      for (const f of failing.slice(0, 15)) say(`    ${f.slice(0, 200)}`);
      if (failing.length > 15) say(`    … and ${failing.length - 15} more`);
    }
  }
  return failed;
}

finish(main());
