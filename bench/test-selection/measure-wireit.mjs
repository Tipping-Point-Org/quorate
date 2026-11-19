// measure-wireit.mjs — candidate 6: Wireit, one cached script per test file (test-selection-exploration.md).
//
// Usage: node bench/test-selection/measure-wireit.mjs --repo <sandbox> --sets <audit.json> --truth <ground-truth.json>
//        --tool <dir holding wireit's node_modules> --out <file.json>
//
// Wireit selects from DECLARATIONS: each script lists its input files, and a script whose inputs' fingerprint is
// unchanged is skipped as fresh. The declarations here are each test's recorded reads inside the repository (candidate
// 4's sets), so this measures Wireit's own change detection and cost, not the declarations' completeness, which the
// recorders measured. The package.json exists only in the sandbox; the repository keeps no dependencies. For each change:
// a harmless edit (a trailing newline), a run, the scripts Wireit EXECUTED (not "fresh") are the selection, the edit is
// undone and a run brings every script fresh again.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireIsolated } from './guard.mjs';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const { sets } = JSON.parse(fs.readFileSync(path.resolve(arg('sets')), 'utf8'));
const truth = JSON.parse(fs.readFileSync(path.resolve(arg('truth')), 'utf8'));
const tool = path.resolve(arg('tool'));
const out = path.resolve(arg('out') ?? 'wireit.json');

const ids = Object.fromEntries(truth.sample.map((t, i) => [t, `t${i}`]));
const pkg = { name: 'ts-wireit', private: true, scripts: { all: 'wireit' }, wireit: { all: { dependencies: Object.values(ids) } } };
for (const t of truth.sample) {
  const files = [...new Set([...(sets[t]?.load ?? []), ...(sets[t]?.read ?? [])])].filter((f) => !f.startsWith('..') && !/^[A-Za-z]:|^[\\/]/.test(f)).sort();
  pkg.scripts[ids[t]] = 'wireit';
  pkg.wireit[ids[t]] = { command: `node --test ${t}`, files, output: [] };
}
fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
// Wireit's binary, reached as npm run reaches it: node_modules/.bin. A junction, so nothing is installed here.
fs.symlinkSync(path.join(tool, 'node_modules'), path.join(repo, 'node_modules'), 'junction');

const { NODE_TEST_CONTEXT, ...env } = process.env;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function runAll() {
  const started = Date.now();
  const r = spawnSync(npm, ['run', 'all'], { cwd: repo, env: { ...env, WIREIT_LOGGER: 'simple', CI: 'true' }, encoding: 'utf8', maxBuffer: 1 << 28, shell: process.platform === 'win32' });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  // Which scripts ran: the simple logger names each script it executes; a fresh one is reported as such.
  const executed = Object.entries(ids).filter(([, id]) => new RegExp(`\\[${id}\\][^\\n]*(Running|Executed|Ran )`, 'i').test(text)
    && !new RegExp(`\\[${id}\\][^\\n]*(fresh|Skipped)`, 'i').test(text)).map(([t]) => t);
  return { status: r.status, ms: Date.now() - started, executed, sample_output: text.slice(0, 2000) };
}

const first = runAll();
console.log(`first run: exit ${first.status}, ${(first.ms / 1000).toFixed(1)} s, ${first.executed.length} executed`);
const again = runAll();
console.log(`second run, nothing changed: exit ${again.status}, ${(again.ms / 1000).toFixed(1)} s, ${again.executed.length} executed`);
const rows = [];
for (const c of truth.changes) {
  const abs = path.join(repo, c.file);
  const before = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(abs, `${before}\n`);
  let run;
  try { run = runAll(); } finally { fs.writeFileSync(abs, before); }
  runAll();   // fresh again before the next change
  const selected = run.executed;
  rows.push({ id: c.id, kind: c.kind, affected: c.affected.length, selected: selected.length,
    missed: c.affected.filter((t) => !selected.includes(t)), over: selected.filter((t) => !c.affected.includes(t)).length, ms: run.ms });
  console.log(`  ${c.id} ${c.kind.padEnd(34)} affected ${c.affected.length}  selected ${selected.length}  missed ${rows.at(-1).missed.length}  over ${rows.at(-1).over}  (${(run.ms / 1000).toFixed(1)} s)`);
}
const result = { first, again, candidate: { 'C6-wireit': { misses: rows.reduce((n, x) => n + x.missed.length, 0), rows } } };
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`C6-wireit: ${result.candidate['C6-wireit'].misses} miss(es)`);
