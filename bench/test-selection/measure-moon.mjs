// measure-moon.mjs — candidate 7: moon, one task per test file, affected by git's local changes
// (test-selection-exploration.md).
//
// Usage: node bench/test-selection/measure-moon.mjs --repo <sandbox> --sets <audit.json> --truth <ground-truth.json>
//        --moon <moon binary> --out <file.json>
//
// moon selects from DECLARATIONS: each task's `inputs`, here each test's recorded reads inside the repository (candidate
// 4's sets). Probed 2026-10-27 on moon 2.6.4: `moon query affected` reads git's local changes and prints JSON, `tasks`
// keyed `root:<task>`; with nothing changed no task is affected (its own untracked config shows as a changed file that
// no task declares). Nothing runs: the selection is moon's answer. For each change: a harmless edit (a trailing
// newline), the query, the edit undone. The config files exist only in the sandbox.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireIsolated } from './guard.mjs';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const { sets } = JSON.parse(fs.readFileSync(path.resolve(arg('sets')), 'utf8'));
const truth = JSON.parse(fs.readFileSync(path.resolve(arg('truth')), 'utf8'));
const moon = path.resolve(arg('moon'));
const out = path.resolve(arg('out') ?? 'moon.json');

const ids = Object.fromEntries(truth.sample.map((t, i) => [t, `t${i}`]));
const q = (s) => `'${s.replaceAll("'", "''")}'`;
const lines = ['tasks:'];
for (const t of truth.sample) {
  const files = [...new Set([...(sets[t]?.load ?? []), ...(sets[t]?.read ?? [])])].filter((f) => !f.startsWith('..') && !/^[A-Za-z]:|^[\\/]/.test(f)).sort();
  lines.push(`  ${ids[t]}:`, `    command: ${q(`node --test ${t}`)}`, `    toolchains: ['system']`, '    inputs:', ...files.map((f) => `      - ${q(`/${f}`)}`));
}
fs.mkdirSync(path.join(repo, '.moon'), { recursive: true });
fs.writeFileSync(path.join(repo, '.moon', 'workspace.yml'), "projects:\n  root: '.'\nvcs:\n  client: git\n");
fs.writeFileSync(path.join(repo, 'moon.yml'), `${lines.join('\n')}\n`);

function affected() {
  const started = Date.now();
  const r = spawnSync(moon, ['query', 'affected'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26, shell: process.platform === 'win32' });
  const ms = Date.now() - started;
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* reported below */ }
  if (!json) throw new Error(`moon query affected gave no JSON (exit ${r.status}): ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  const tasks = Object.keys(json.tasks ?? {}).map((k) => k.split(':').pop());
  return { ms, selected: truth.sample.filter((t) => tasks.includes(ids[t])) };
}

const idle = affected();
console.log(`nothing changed: ${idle.selected.length} affected (${(idle.ms / 1000).toFixed(1)} s)`);
if (idle.selected.length) throw new Error('moon reports affected tasks with nothing changed; the reader is wrong');
const rows = [];
for (const c of truth.changes) {
  const abs = path.join(repo, c.file);
  const before = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(abs, `${before}\n`);
  let run;
  try { run = affected(); } finally { fs.writeFileSync(abs, before); }
  rows.push({ id: c.id, kind: c.kind, affected: c.affected.length, selected: run.selected.length,
    missed: c.affected.filter((t) => !run.selected.includes(t)), over: run.selected.filter((t) => !c.affected.includes(t)).length, ms: run.ms });
  console.log(`  ${c.id} ${c.kind.padEnd(34)} affected ${c.affected.length}  selected ${run.selected.length}  missed ${rows.at(-1).missed.length}  over ${rows.at(-1).over}  (${(run.ms / 1000).toFixed(1)} s)`);
}
const result = { idle, candidate: { 'C7-moon': { misses: rows.reduce((n, x) => n + x.missed.length, 0), rows } } };
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`C7-moon: ${result.candidate['C7-moon'].misses} miss(es)`);
