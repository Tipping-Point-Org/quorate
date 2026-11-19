// measure-recorder.mjs — candidates 1 and 2 against the ground truth (test-selection-exploration.md).
//
// Usage: node bench/test-selection/measure-recorder.mjs --repo <clone> --truth <ground-truth.json> --out <file.json>
//
// Runs the sample once with the recorder preloaded into every process (NODE_OPTIONS), builds each test file's set of
// loaded modules (candidate 2) and of loaded modules plus fs reads (candidate 1), and for every change selects the test
// files whose set holds the changed file. A test the ground truth marks affected and the selection leaves out is a MISS;
// a selected test the ground truth does not mark is OVER-selection, reported, not an error (the ground truth is a lower
// bound). The negative control must select nothing.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireIsolated } from './guard.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const truth = JSON.parse(fs.readFileSync(path.resolve(arg('truth')), 'utf8'));
const out = path.resolve(arg('out') ?? 'recorder.json');
const rel = (p) => path.relative(repo, p).split(path.sep).join('/');
const key = (p) => (process.platform === 'win32' ? rel(p).toLowerCase() : rel(p));

// --variant recorder: candidates 1 and 2 (preload.mjs). --variant audit: candidate 4 (audit-preload.mjs with
// --permission-audit, node >= 24.20 given by --node).
const variant = arg('variant') ?? 'recorder';
const VARIANTS = {
  recorder: { preload: 'preload.mjs', flags: '', candidates: { 'C2-import-graph': (s) => s.load, 'C1-loads-and-reads': (s) => new Set([...s.load, ...s.read]) } },
  audit: { preload: 'audit-preload.mjs', flags: '--permission-audit', candidates: { 'C4-permission-audit': (s) => new Set([...s.load, ...s.read]) } },
};
const V = VARIANTS[variant];
if (!V) throw new Error(`--variant must be one of ${Object.keys(VARIANTS).join(', ')}`);
const nodeBin = arg('node') ?? process.execPath;
const recDir = fs.mkdtempSync(path.join(repo, '.ts-records-'));
const preload = pathToFileURL(path.join(repo, 'bench', 'test-selection', 'recorder', V.preload)).href;
const { NODE_TEST_CONTEXT, ...env } = process.env;
// ONE NODE FOR THE WHOLE TREE: a flag in NODE_OPTIONS reaches every node process, and a contract command runs `node` from
// PATH. With --node naming a newer node than the installed one, the installed 24.13.1 rejected --permission-audit ("not
// allowed in NODE_OPTIONS") and two tests failed for that, not for the candidate. The given node goes first on PATH.
if (arg('node')) {
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${path.dirname(path.resolve(nodeBin))}${path.delimiter}${env[pathKey] ?? ''}`;
}
const started = Date.now();
const r = spawnSync(nodeBin, ['--test-reporter=dot', '--test', ...truth.sample], {
  cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28,
  env: { ...env, TS_RECORD_DIR: recDir, NODE_OPTIONS: `${env.NODE_OPTIONS ?? ''} ${V.flags} --import=${preload}`.trim() },
});
const ended = Date.now();

const sets = {};   // test -> { load: Set, read: Set }
let lines = 0;
for (const f of fs.readdirSync(recDir)) {
  for (const l of fs.readFileSync(path.join(recDir, f), 'utf8').split(/\r?\n/).filter(Boolean)) {
    const e = JSON.parse(l); lines += 1;
    const t = rel(e.test);
    const s = (sets[t] ??= { load: new Set(), read: new Set() });
    // ORIGINAL CASE KEPT: the sets feed candidate 5's manifest, and the Permission Model compares paths case-sensitively
    // (a lowercased `claude.md` grant denied `CLAUDE.md`). Only the comparison below folds case.
    s[e.kind]?.add(rel(e.file));
  }
}
fs.rmSync(recDir, { recursive: true, force: true });

const candidates = V.candidates;
const result = { variant, node: nodeBin, exit_code: r.status, ms: ended - started, started_at: new Date(started).toISOString(),
  ended_at: new Date(ended).toISOString(), record_lines: lines, tests_recorded: Object.keys(sets).length, candidates: {} };
for (const [name, setOf] of Object.entries(candidates)) {
  const rows = truth.changes.map((c) => {
    const target = c.file.toLowerCase();
    const selected = truth.sample.filter((t) => sets[t] && [...setOf(sets[t])].some((f) => f.toLowerCase() === target));
    const missed = c.affected.filter((t) => !selected.includes(t));
    const over = selected.filter((t) => !c.affected.includes(t));
    return { id: c.id, kind: c.kind, affected: c.affected.length, selected: selected.length, missed, over: over.length };
  });
  result.candidates[name] = { misses: rows.reduce((n, x) => n + x.missed.length, 0), rows };
}
// Each test's recorded files, repository-relative, kept for candidate 5, which enforces them as a manifest.
result.sets = Object.fromEntries(Object.entries(sets).map(([t, s]) => [t, { load: [...s.load].sort(), read: [...s.read].sort() }]));
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
for (const [name, c] of Object.entries(result.candidates)) {
  console.log(`${name}: ${c.misses} miss(es)`);
  for (const x of c.rows) console.log(`  ${x.id} ${x.kind.padEnd(34)} affected ${x.affected}  selected ${x.selected}  missed ${x.missed.length}  over ${x.over}`);
}
console.log(`recorder run: exit ${r.status}, ${(result.ms / 1000).toFixed(1)} s, ${result.tests_recorded}/${truth.sample.length} tests recorded`);
