// ground-truth.mjs — which sample tests each change affects, by a breaking mutation (test-selection-exploration.md).
//
// Usage: node bench/test-selection/ground-truth.mjs --repo <clone> --out <file.json>
//
// For each change in changes.json: mutate the file so anything that loads or reads it breaks, run every sample test
// file, record which fail, restore the file from git. A test that fails is affected for certain; one that passes may
// still read the file (a mutation of data it only checks for presence), so this is a lower bound, independent of every
// candidate. A clean run first marks the tests that fail with no mutation, which no change can be credited with.
// Per-file results come from the project's own reporter (tests/tools/suite-file-reporter.mjs), the TAP reporter giving
// no file per test.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireIsolated } from './guard.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const out = path.resolve(arg('out') ?? 'ground-truth.json');
const { sample, changes } = JSON.parse(fs.readFileSync(path.join(HERE, 'changes.json'), 'utf8'));

const MUTATE = {
  // FIRST, not last: appended, the throw never ran in an entry script that exits before its last line (findings-ledger.mjs
  // showed 0 affected). Imports are hoisted, so a leading throw still runs before any of the module's own code.
  '.mjs': (s) => `throw new Error('TEST-SELECTION MUTATION');\n${s}`,
  '.json': (s) => `{${s}`,
  '.md': () => 'TEST-SELECTION MUTATION\n',
};

function runSample() {
  const lines = path.join(repo, '.ground-truth-files.jsonl');
  fs.rmSync(lines, { force: true });
  const reporter = pathToFileURL(path.join(repo, 'tests', 'tools', 'suite-file-reporter.mjs')).href;
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const started = Date.now();
  spawnSync(process.execPath, ['--test-reporter=dot', '--test-reporter-destination=stdout',
    `--test-reporter=${reporter}`, `--test-reporter-destination=${lines}`, '--test', ...sample],
  { cwd: repo, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const ended = Date.now();
  const ms = ended - started;
  const failed = new Set(); const seen = new Set();
  for (const l of fs.readFileSync(lines, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const e = JSON.parse(l);
    if (e.event !== 'summary') continue;
    const rel = path.relative(repo, e.file).split(path.sep).join('/');
    seen.add(rel);
    if ((e.counts?.failed ?? 0) > 0 || (e.counts?.tests ?? 0) === 0) failed.add(rel);
  }
  fs.rmSync(lines, { force: true });
  // A file the runner reported nothing for (it crashed before its summary) counts as failed.
  for (const f of sample) if (!seen.has(f)) failed.add(f);
  // Wall times, so each run can be joined to the load sampler's rows (avp, total CPU) for the same window.
  return { failed: [...failed].sort(), ms, started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString() };
}

// ONE RUN AT A TIME, ON A CLEAN TREE. On 2026-10-27 a run was stopped and another started; the second read a file the
// first had mutated as its "original", and the first left bench/RESULTS.md mutated. A lock refuses a second run, the
// change targets must be unmodified before anything starts, and each original comes from git, never the working copy.
const lock = path.join(repo, '.ground-truth.lock');
try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); } catch {
  throw new Error(`${lock} exists: another run holds this clone, or one was stopped; check no run is going, restore the change targets with git checkout, then delete it`);
}
process.on('exit', () => { try { fs.rmSync(lock, { force: true }); } catch { /* best effort */ } });
const dirty = spawnSync('git', ['status', '--porcelain', '--', ...changes.map((c) => c.file)], { cwd: repo, encoding: 'utf8' }).stdout.trim();
if (dirty) throw new Error(`change targets already modified, restore them first:\n${dirty}`);
const original = (file) => {
  const r = spawnSync('git', ['show', `HEAD:${file}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git show HEAD:${file} failed: ${r.stderr}`);
  return r.stdout;
};

const result = { repo, sample, clean: runSample(), changes: [] };
console.log(`clean: ${result.clean.failed.length} failing of ${sample.length} (${(result.clean.ms / 1000).toFixed(0)} s)`);
for (const c of changes) {
  const abs = path.join(repo, c.file);
  const before = original(c.file);
  const mutate = MUTATE[path.extname(c.file)];
  if (!mutate) throw new Error(`no mutation for ${c.file}`);
  fs.writeFileSync(abs, mutate(before));
  let run;
  try { run = runSample(); } finally {
    const r = spawnSync('git', ['checkout', '--', c.file], { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0 || fs.readFileSync(abs, 'utf8') !== before) throw new Error(`could not restore ${c.file}: ${r.stderr}`);
  }
  const affected = run.failed.filter((f) => !result.clean.failed.includes(f));
  result.changes.push({ ...c, affected, ms: run.ms });
  console.log(`${c.id} ${c.file}: ${affected.length} affected (${(run.ms / 1000).toFixed(0)} s)`);
}
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`wrote ${out}`);
