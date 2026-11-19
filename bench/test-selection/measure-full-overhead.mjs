// measure-full-overhead.mjs — the recording's cost on the whole suite, in paired, interleaved full runs, and the cost of
// computing a selection from the map it produces (test-selection-by-recorded-reads.plan.md, item 0).
//
// Usage: node bench/test-selection/measure-full-overhead.mjs --repo <sandbox> --node <node.exe> --out <file.json>
//        [--pairs 4] [--load-csv <sampler csv>]
//
// Each pair is one plain full run and one full run under candidate 4's recorder, every test file named (as measure-full.mjs
// times them), in alternating order (plain first in even pairs, recorded first in odd ones) so a drift in machine load falls
// on both arms alike. No warm-up pair: measure-full.mjs ran the suite in the same clone beforehand. Then the selection
// itself, five times on the first recording's map: hash every file the map names that lies inside the repository, and
// compute the selected set for each change of changes-full.json, as measure-full.mjs selects. The results are written
// after every run.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireIsolated } from './guard.mjs';
import { fullRunner } from './full-run.mjs';
import { joinLoad } from './load-join.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const nodeBin = path.resolve(arg('node') ?? process.execPath);
const out = path.resolve(arg('out') ?? 'full-overhead.json');
const pairs = Number(arg('pairs') ?? 4);
const { changes } = JSON.parse(fs.readFileSync(path.join(HERE, 'changes-full.json'), 'utf8'));
const { ALL, runTests, recordedRun } = fullRunner(repo, nodeBin);
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const log = (s) => console.log(`${new Date().toLocaleTimeString()} ${s}`);
const slim = (r) => ({ status: r.status, ms: r.ms, started_at: r.started_at, ended_at: r.ended_at, files: r.files, failed: r.failed });

const result = { node: nodeBin, tests: ALL.length, pairs: [], selection: null };
const save = () => fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
let sets = null;
for (let i = 0; i < pairs; i++) {
  const p = { n: i, order: i % 2 ? 'recorded-first' : 'plain-first' };
  const plain = () => { p.plain = slim(runTests(null)); };
  const recorded = () => { const r = recordedRun(); sets ??= r.sets; p.candidate = { ...slim(r.run), tests_recorded: Object.keys(r.sets).length }; };
  if (i % 2) { recorded(); plain(); } else { plain(); recorded(); }
  p.diff_ms = p.candidate.ms - p.plain.ms;
  result.pairs.push(p); save();
  log(`pair ${i} (${p.order}): plain ${(p.plain.ms / 1000).toFixed(1)} s, recorded ${(p.candidate.ms / 1000).toFixed(1)} s, diff ${(p.diff_ms / 1000).toFixed(1)} s; failing ${p.plain.failed.length}/${p.candidate.failed.length}`);
}

// The selection's own cost: hash what the map names, then select, as a selected run would before it starts.
const isDir = new Map();
const folder = (f) => {
  if (!isDir.has(f)) isDir.set(f, !f.startsWith('..') && !path.isAbsolute(f) && (() => { try { return fs.statSync(path.join(repo, f)).isDirectory(); } catch { return false; } })());
  return isDir.get(f);
};
const covers = (f, x) => same(f, x) || (folder(f) && same(x.slice(0, f.length + 1), `${f}/`));
const named = [...new Set(Object.values(sets).flat())].filter((f) => !f.startsWith('..') && !path.isAbsolute(f));
const times = [];
for (let k = 0; k < 5; k++) {
  isDir.clear();
  const t0 = process.hrtime.bigint();
  let hashed = 0;
  for (const f of named) {
    const abs = path.join(repo, f);
    try { if (fs.statSync(abs).isFile()) { crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'); hashed++; } } catch { /* gone */ }
  }
  const t1 = process.hrtime.bigint();
  for (const c of changes) ALL.filter((t) => (sets[t] ?? []).some((f) => c.files.some((x) => covers(f, x))));
  const t2 = process.hrtime.bigint();
  times.push({ hash_ms: Number(t1 - t0) / 1e6, select_ms_all_changes: Number(t2 - t1) / 1e6, hashed });
}
result.selection = { files_named: named.length, changes: changes.length, runs: times };
if (arg('load-csv')) joinLoad(result.pairs, path.resolve(arg('load-csv')));
save();
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
log(`selection: ${named.length} files named, hash median ${med(times.map((t) => t.hash_ms)).toFixed(0)} ms, select median ${med(times.map((t) => t.select_ms_all_changes)).toFixed(0)} ms for ${changes.length} changes`);
