// full-run.mjs — one node --test run over named test files, with run-all.mjs's isolation, shared by measure-full.mjs and
// measure-full-overhead.mjs so both time a run the same way.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { gitSync } from '../../scripts/io/git.mjs';

export function fullRunner(repo, nodeBin) {
  const rel = (p) => path.relative(repo, p).split(path.sep).join('/');
  const { NODE_TEST_CONTEXT, ...baseEnv } = process.env;
  const pathKey = Object.keys(baseEnv).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  baseEnv[pathKey] = `${path.dirname(nodeBin)}${path.delimiter}${baseEnv[pathKey] ?? ''}`;
  const reporter = pathToFileURL(path.join(repo, 'tests', 'tools', 'suite-file-reporter.mjs')).href;
  // A failed enumeration is refused: read as empty, it became a "successful" run of zero tests (G-1 of
  // 20261107-061412-split-delivery-2).
  // git runs through scripts/io/git.mjs, the one owner of the engine's git processes (G-1 of
  // 20261107-072037-split-delivery-3; ARCHITECTURE A-29).
  const listed = gitSync(['ls-files', 'tests/*.test.mjs', 'tests/**/*.test.mjs'], { cwd: repo, encoding: 'utf8' });
  if (listed.error || listed.status !== 0) {
    throw new Error(`git ls-files could not list the test files in ${repo}: ${listed.error?.message ?? `exit ${listed.status}: ${(listed.stderr ?? '').trim()}`}`);
  }
  const ALL = listed.stdout.split(/\r?\n/).filter(Boolean).sort()
    .slice(0, Number(process.env.TS_FULL_LIMIT) || undefined);   // TS_FULL_LIMIT: a smoke test of the harness on N tests
  // An enumeration that succeeds and lists nothing is refused too: it was a "successful" run of zero tests (G-2 of
  // 20261107-072037-split-delivery-3).
  if (!ALL.length) throw new Error(`git ls-files listed no test files in ${repo}`);

  // One node --test run of `files` (or every test file), with the file reporter: which test files failed. `reporters`
  // adds further [reporter, destination] pairs.
  function runTests(files, extraEnv = {}, reporters = []) {
    const targets = files ?? ALL;
    if (!targets.length) throw new Error('runTests was given no test files; a run of zero tests is no run (G-2 of 20261107-072037-split-delivery-3)');
    const lines = path.join(repo, `.ts-full-${process.pid}.jsonl`);
    const list = path.join(repo, `.ts-files-${process.pid}.txt`);
    fs.rmSync(lines, { force: true });
    const claudeConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-suite-claude-'));
    // Every temporary file is removed on every exit, a throw included (G-3 of 20261107-072037-split-delivery-3).
    try {
      return runOnce(targets, extraEnv, reporters, lines, list, claudeConfig);
    } finally {
      fs.rmSync(claudeConfig, { recursive: true, force: true });
      fs.rmSync(lines, { force: true }); fs.rmSync(list, { force: true });
    }
  }

  function runOnce(targets, extraEnv, reporters, lines, list, claudeConfig) {
    // Every run names its files: given a glob, node --test's processes raised no audit event for a read under tests/, so a
    // recording lost every test's own imports and fixtures (probe-recorder.mjs, 2026-10-28; the sample, which named its
    // files, kept them). A full run is timed the same way, so the selected runs and the baselines compare like with like.
    // The names go through a file to run-named.mjs, node:test's run() in a process of its own: Windows caps a command line at
    // 32,767 characters, and 656 named files from the sandbox's paths came to 32,991 (2026-11-06).
    fs.writeFileSync(list, `${targets.join('\n')}\n`);
    const argv = [path.join(repo, 'bench', 'test-selection', 'run-named.mjs'), '--files-from', list,
      ...[['dot', 'stdout'], [reporter, lines], ...reporters].flatMap(([r, d]) => ['--reporter', r, '--reporter-destination', d])];
    const started = new Date();
    const r = spawnSync(nodeBin, argv, {
      cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28,
      env: { ...baseEnv, CLAUDE_CONFIG_DIR: claudeConfig, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ...extraEnv },
    });
    const ended = new Date();
    const leaked = fs.readdirSync(claudeConfig);
    if (leaked.length) throw new Error(`a test started the real Claude CLI (it wrote ${leaked.join(', ')}); stopping`);
    const failed = new Set(); const seen = new Set(); const durations = {};
    const text = fs.existsSync(lines) ? fs.readFileSync(lines, 'utf8') : '';
    for (const l of text.split(/\r?\n/).filter(Boolean)) {
      const e = JSON.parse(l);
      // Each file's whole time, so a slow run can be traced to the files that made it slow.
      if (e.event === 'file') { durations[rel(e.file)] = e.duration_ms === null ? null : Math.round(e.duration_ms); continue; }
      if (e.event !== 'summary') continue;
      const f = rel(e.file); seen.add(f);
      if ((e.counts?.failed ?? 0) > 0 || (e.counts?.tests ?? 0) === 0) failed.add(f);
    }
    // A file the runner reported nothing for (it crashed before its summary) counts as failed.
    for (const f of targets) if (!seen.has(f)) failed.add(f);
    return { status: r.status, ms: ended - started, started_at: started.toISOString(), ended_at: ended.toISOString(),
      files: targets.length, failed: [...failed].sort(), durations };
  }

  // A full run under candidate 4's recorder: the run, and each test's recorded files.
  function recordedRun() {
    const dir = fs.mkdtempSync(path.join(repo, '.ts-records-'));
    const preload = pathToFileURL(path.join(repo, 'bench', 'test-selection', 'recorder', 'audit-preload.mjs')).href;
    // The records directory is removed on every exit, a throw from runTests included (G-5 of
    // 20261107-072037-split-delivery-3, a symptom of G-3).
    let r; const sets = {};
    try {
      r = runTests(null, { TS_RECORD_DIR: dir, NODE_OPTIONS: `${baseEnv.NODE_OPTIONS ?? ''} --permission-audit --import=${preload}`.trim() });
      for (const f of fs.readdirSync(dir)) {
        for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).filter(Boolean)) {
          const e = JSON.parse(l);
          (sets[rel(e.test)] ??= new Set()).add(rel(e.file));
        }
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    return { run: r, sets: Object.fromEntries(Object.entries(sets).map(([t, s]) => [t, [...s].sort()])) };
  }

  return { ALL, rel, runTests, recordedRun };
}
