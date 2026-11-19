// measure-full.mjs — option A on the whole suite: the time a selected run saves, and whether it misses a test
// (test-selection-exploration.md; operator, 2026-10-27: "my intent is knowing the time difference", and C1-C8 re-run at
// full scale: "Bugs exist").
//
// Usage: node bench/test-selection/measure-full.mjs --repo <sandbox> --node <node.exe> --out <file.json> [--resume]
//        [--truth-from <earlier full.json>]   (re-record and re-time, reusing that run's ground truth)
//
// Order: a plain full run (the clean baseline: which tests fail with nothing changed, and how long the suite takes); one
// full run under candidate 4's recorder (each test's recorded files); then for each change in changes-full.json:
//   1. the GROUND TRUTH: the full suite with every file of the change broken (a leading throw in .mjs, invalid JSON,
//      garbled .md); a test failing there and not in the clean run is affected;
//   2. the SELECTION: the tests whose recorded files hold any file of the change; an affected test left out is a MISS;
//   3. the SELECTED RUN, timed: only those tests, after a harmless edit to the change's files (a trailing newline).
// A plain full run is repeated halfway and at the end, so the saving is measured against baselines spread over the
// session. The results are written after every step, and --resume skips the steps already written.
//
// Every run gets run-all.mjs's isolation: a throwaway CLAUDE_CONFIG_DIR and blank credentials, checked empty after.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireIsolated } from './guard.mjs';
import { fullRunner } from './full-run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const nodeBin = path.resolve(arg('node') ?? process.execPath);
const out = path.resolve(arg('out') ?? 'full.json');
const { changes } = JSON.parse(fs.readFileSync(path.join(HERE, 'changes-full.json'), 'utf8'));
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const { ALL, rel, runTests, recordedRun } = fullRunner(repo, nodeBin);

const MUTATE = {
  '.mjs': (s) => `throw new Error('TEST-SELECTION MUTATION');\n${s}`,
  '.json': (s) => `{${s}`,
  '.md': () => 'TEST-SELECTION MUTATION\n',
};
const original = (file) => {
  const r = spawnSync('git', ['show', `HEAD:${file}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git show HEAD:${file} failed: ${r.stderr}`);
  return r.stdout;
};
// Writes `edit(original)` to every file of the change, runs `fn`, and restores every file from git whatever happens.
function withEdited(files, edit, fn) {
  const before = Object.fromEntries(files.map((f) => [f, original(f)]));
  for (const f of files) fs.writeFileSync(path.join(repo, f), edit(before[f], f));
  try { return fn(); } finally {
    for (const f of files) {
      fs.writeFileSync(path.join(repo, f), before[f]);
      if (fs.readFileSync(path.join(repo, f), 'utf8') !== before[f]) throw new Error(`could not restore ${f}`);
    }
  }
}

const result = process.argv.includes('--resume') && fs.existsSync(out)
  ? JSON.parse(fs.readFileSync(out, 'utf8')) : { node: nodeBin, tests: ALL.length, baselines: [], changes: {} };
const save = () => fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
const log = (s) => console.log(`${new Date().toLocaleTimeString()} ${s}`);
const dirty = spawnSync('git', ['status', '--porcelain', '--', ...changes.flatMap((c) => c.files)], { cwd: repo, encoding: 'utf8' }).stdout.trim();
if (dirty) throw new Error(`change targets already modified:\n${dirty}`);

const baseline = (label) => {
  if (result.baselines.some((b) => b.label === label)) return;
  const r = runTests(null);
  result.baselines.push({ label, ...r }); save();
  log(`baseline ${label}: ${(r.ms / 1000).toFixed(0)} s, ${r.failed.length} failing of ${r.files}${r.failed.length ? `: ${r.failed.join(', ')}` : ''}`);
};
baseline('start');
const cleanFailed = result.baselines[0].failed;

if (!result.sets) {
  const { run: r, sets } = recordedRun();
  result.record = { ...r, tests_recorded: Object.keys(sets).length };
  result.sets = sets;
  save();
  log(`recorder run: ${(r.ms / 1000).toFixed(0)} s, ${r.failed.length} failing, ${Object.keys(sets).length}/${ALL.length} tests recorded`);
}

// A recorded folder covers every file under it: a test that copies `scripts/` whole (fs.cpSync) is recorded as reading
// the folder, not its files, and was missed for a change inside it (C2, C6, F1 of the 2026-10-27 run).
const isDir = new Map();
const folder = (f) => {
  if (!isDir.has(f)) isDir.set(f, !f.startsWith('..') && !path.isAbsolute(f) && (() => { try { return fs.statSync(path.join(repo, f)).isDirectory(); } catch { return false; } })());
  return isDir.get(f);
};
const covers = (f, x) => same(f, x) || (folder(f) && same(x.slice(0, f.length + 1), `${f}/`));
const exactly = (c) => ALL.filter((t) => (result.sets[t] ?? []).some((f) => c.files.some((x) => same(f, x))));

// --truth-from <earlier result>: take each change's ground truth from that run rather than breaking the files again. The
// ground truth does not depend on the recorder, so a re-recording is judged against the truth already measured.
const truthFrom = arg('truth-from') ? JSON.parse(fs.readFileSync(path.resolve(arg('truth-from')), 'utf8')) : null;
if (truthFrom) result.truth_from = path.resolve(arg('truth-from'));

changes.forEach((c, n) => {
  if (n === Math.floor(changes.length / 2)) baseline('middle');
  if (result.changes[c.id]?.selected_run) return;
  const earlier = truthFrom?.changes[c.id];
  if (truthFrom && !earlier) throw new Error(`${c.id} has no ground truth in ${result.truth_from}`);
  const truthRun = earlier ? { ...earlier.truth_run, reused: true }
    : withEdited(c.files, (s, f) => MUTATE[path.extname(f)](s), () => runTests(null));
  const affected = earlier ? earlier.affected : truthRun.failed.filter((f) => !cleanFailed.includes(f));
  const selected = ALL.filter((t) => (result.sets[t] ?? []).some((f) => c.files.some((x) => covers(f, x))));
  const missed = affected.filter((t) => !selected.includes(t));
  const over = selected.filter((t) => !affected.includes(t));
  const selRun = selected.length
    ? withEdited(c.files, (s) => `${s}\n`, () => runTests(selected))
    : { status: 0, ms: 0, files: 0, failed: [], started_at: null, ended_at: null };
  result.changes[c.id] = { ...c, affected, selected, selected_exactly: exactly(c).length, missed, over: over.length,
    truth_run: { ms: truthRun.ms, started_at: truthRun.started_at, ended_at: truthRun.ended_at, durations: truthRun.durations,
      reused: truthRun.reused ?? false },
    selected_run: { ms: selRun.ms, files: selRun.files, failed: selRun.failed, started_at: selRun.started_at, ended_at: selRun.ended_at,
      durations: selRun.durations ?? {} } };
  save();
  log(`${c.id} ${c.kind}: affected ${affected.length}, selected ${selected.length} (${result.changes[c.id].selected_exactly} by exact path), MISSED ${missed.length}${missed.length ? ` (${missed.join(', ')})` : ''}, over ${over.length}; selected run ${(selRun.ms / 1000).toFixed(1)} s for ${selRun.files} files, ${selRun.failed.length} failing`);
});
baseline('end');
const base = result.baselines.map((b) => b.ms);
log(`baselines ${base.map((m) => `${(m / 1000).toFixed(0)} s`).join(', ')}; misses in all: ${Object.values(result.changes).reduce((k, c) => k + c.missed.length, 0)}`);
