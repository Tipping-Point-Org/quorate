// measure-tup.mjs — candidate 10: tup, which OBSERVES each command's file reads (test-selection-exploration.md).
//
// Usage: node bench/test-selection/measure-tup.mjs --repo <sandbox> --truth <ground-truth.json> --tup <tup.exe>
//        --out <file.json>
//
// Unlike candidates 6 and 7, nothing is declared: one rule per test file (`: |> node --test <file> |>`), and tup records
// what each command reads through its injected DLL (Windows). Probed 2026-10-27 on tup v0.8-38: an edit to a module the
// test imports, though undeclared, re-ran the rule; an unchanged tree ran nothing; each executed command prints as
// ` 100% 0) [0.106s] node --test tests/x.test.mjs`. `tup upd -k` keeps going past a failing command. For each change: a
// harmless edit (a trailing newline), an update, the commands tup executed are the selection, the edit undone and an
// update to bring every rule current again.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireIsolated } from './guard.mjs';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const truth = JSON.parse(fs.readFileSync(path.resolve(arg('truth')), 'utf8'));
const tup = path.resolve(arg('tup'));
const out = path.resolve(arg('out') ?? 'tup.json');

// THE TEMP FOLDER EXCLUDED (operator, 2026-10-27: "That can be fixed"): tup errors on any write that is not a declared
// output, inside the project or not (probed: a dedicated TEMP folder and Windows' own temp, both refused), and these tests write
// randomly named fixture repositories there, git objects included, whose names cannot be declared. An output starting
// with '^' is an exclusion: "Any files that are read or written to when the sub-process executes that matches these
// patterns are ignored by tup" (tup manual). Temp files are a test's outputs, never its dependencies.
const TEMP_EXCLUSION = '^dev-temp';
fs.writeFileSync(path.join(repo, 'Tupfile'), truth.sample.map((t) => `: |> node --test ${t} |> ${TEMP_EXCLUSION}`).join('\n') + '\n');
const { NODE_TEST_CONTEXT, ...env } = process.env;
const run = (args) => {
  const started = Date.now();
  const r = spawnSync(tup, args, { cwd: repo, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  // A command line with or without its time: the first run counted no failed command, whose line differs.
  const executed = [...text.matchAll(/\d+\)\s+(?:\[[\d.]+s\]\s+)?node --test (\S+)/g)].map((m) => m[1].replaceAll('\\', '/'));
  const failedJobs = Number(text.match(/tup: (\d+) jobs? failed/)?.[1] ?? 0);
  return { status: r.status, ms: Date.now() - started, executed: [...new Set(executed)], failed_jobs: failedJobs, errors: (text.match(/tup error[^\n]*/gi) ?? []).slice(0, 5), text };
};

const init = run(['init']);
const first = run(['upd', '-k']);
console.log(`first update: exit ${first.status}, ${(first.ms / 1000).toFixed(1)} s, ${first.executed.length} executed, ${first.failed_jobs} failed${first.errors.length ? `; errors: ${first.errors.join(' | ')}` : ''}`);
const again = run(['upd', '-k']);
console.log(`unchanged: exit ${again.status}, ${(again.ms / 1000).toFixed(1)} s, ${again.executed.length} executed, ${again.failed_jobs} failed`);
// THE READER'S CHECK: every rule runs once, then nothing; otherwise no selection below can be read.
if (first.executed.length !== truth.sample.length || first.failed_jobs || again.executed.length) {
  console.log(`READER CHECK FAILED: first ${first.executed.length}/${truth.sample.length} executed with ${first.failed_jobs} failed, unchanged ${again.executed.length}; selections below are not valid`);
}
const rows = [];
for (const c of truth.changes) {
  const abs = path.join(repo, c.file);
  const before = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(abs, `${before}\n`);
  let r;
  try { r = run(['upd', '-k']); } finally { fs.writeFileSync(abs, before); }
  run(['upd', '-k']);
  rows.push({ id: c.id, kind: c.kind, affected: c.affected.length, selected: r.executed.length,
    missed: c.affected.filter((t) => !r.executed.includes(t)), over: r.executed.filter((t) => !c.affected.includes(t)).length, ms: r.ms, errors: r.errors });
  console.log(`  ${c.id} ${c.kind.padEnd(34)} affected ${c.affected.length}  selected ${r.executed.length}  missed ${rows.at(-1).missed.length}  over ${rows.at(-1).over}  (${(r.ms / 1000).toFixed(1)} s)`);
}
const result = { init: { status: init.status }, first: { ...first, text: first.text.slice(-4000) }, again: { ...again, text: undefined },
  candidate: { 'C10-tup': { misses: rows.reduce((n, x) => n + x.missed.length, 0), rows } } };
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`C10-tup: ${result.candidate['C10-tup'].misses} miss(es)`);
