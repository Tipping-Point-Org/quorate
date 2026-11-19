// measure-buildxl.mjs — candidate 9: BuildXL, which OBSERVES each pip's reads (test-selection-exploration.md).
//
// Usage: node bench/test-selection/measure-buildxl.mjs --repo <sandbox> --truth <ground-truth.json> --bxl <bxl.exe>
//        --node <node.exe> --out <file.json>
//
// bxl.exe is the published Microsoft.BuildXL.win-x64 package that BuildXL's own bootstrap downloads from a public feed;
// nothing is built from source. One pip per test, declaring only its test file, reads allowed and observed
// (buildxl-config.mjs). Probed 2026-10-27: a first build executes every pip, an unchanged second build hits the cache for
// every pip, and an edit to an undeclared file a test read re-runs that test; each re-run pip is logged in
// Out/Logs/BuildXL.log as `DX0235: [Pip..., ts-test <file>] Cache miss`. /server- leaves no server holding the sandbox.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireIsolated } from './guard.mjs';
import { writeBuildxlConfig } from './buildxl-config.mjs';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const truth = JSON.parse(fs.readFileSync(path.resolve(arg('truth')), 'utf8'));
const bxl = path.resolve(arg('bxl'));
const out = path.resolve(arg('out') ?? 'buildxl.json');
const profile = process.env.USERPROFILE ?? process.env.HOME;
// The repository's .git too: a test running `git check-ignore` at the root makes git take .git/index.lock, which BuildXL
// refused as an undeclared write (DX0500, regression-telemetry-run-time); git's bookkeeping is not a test input.
const untracked = [process.env.TEMP ?? 'C:/work/temp', profile, 'C:/Program Files', 'C:/Program Files (x86)', 'C:/ProgramData', 'C:/Windows', path.join(repo, '.git')];
writeBuildxlConfig({ repo, sample: truth.sample, sdk: path.join(path.dirname(bxl), 'Sdk'), nodeExe: arg('node'), untracked });

const build = () => {
  const started = Date.now();
  const r = spawnSync(bxl, ['/c:config.dsc', '/server-', '/nologo'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  const log = path.join(repo, 'Out', 'Logs', 'BuildXL.log');
  const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  const executed = [...new Set([...text.matchAll(/DX0235: \[[^\]]*\|\| ts-test (\S+)\] Cache miss/g)].map((m) => m[1]))];
  const line = (r.stdout.match(/Processes: \[[^\]]*\]/g) ?? []).at(-1) ?? '';
  return { status: r.status, ms: Date.now() - started, executed, line, errors: (r.stdout.match(/error DX\d+[^\n]*/g) ?? []).slice(0, 3) };
};

const first = build();
console.log(`first build: exit ${first.status}, ${(first.ms / 1000).toFixed(1)} s, ${first.executed.length} executed  ${first.line}${first.errors.length ? `  ${first.errors.join(' | ')}` : ''}`);
const again = build();
console.log(`unchanged: exit ${again.status}, ${(again.ms / 1000).toFixed(1)} s, ${again.executed.length} executed  ${again.line}`);
if (first.executed.length !== truth.sample.length || again.executed.length) {
  console.log(`READER CHECK FAILED: first ${first.executed.length}/${truth.sample.length}, unchanged ${again.executed.length}; selections below are not valid`);
}
const rows = [];
for (const c of truth.changes) {
  const abs = path.join(repo, c.file);
  const before = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(abs, `${before}\n`);
  let r;
  try { r = build(); } finally { fs.writeFileSync(abs, before); }
  build();
  rows.push({ id: c.id, kind: c.kind, affected: c.affected.length, selected: r.executed.length,
    missed: c.affected.filter((t) => !r.executed.includes(t)), over: r.executed.filter((t) => !c.affected.includes(t)).length, ms: r.ms });
  console.log(`  ${c.id} ${c.kind.padEnd(34)} affected ${c.affected.length}  selected ${r.executed.length}  missed ${rows.at(-1).missed.length}  over ${rows.at(-1).over}  (${(r.ms / 1000).toFixed(1)} s)`);
}
const result = { first: { ...first }, again: { ...again }, candidate: { 'C9-buildxl': { misses: rows.reduce((n, x) => n + x.missed.length, 0), rows } } };
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`C9-buildxl: ${result.candidate['C9-buildxl'].misses} miss(es)`);
