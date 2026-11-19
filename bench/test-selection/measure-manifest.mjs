// measure-manifest.mjs — candidate 5: a per-test manifest, ENFORCED by node's Permission Model
// (test-selection-exploration.md).
//
// Usage: node bench/test-selection/measure-manifest.mjs --repo <sandbox> --sets <audit.json> --truth <ground-truth.json>
//        --node <node >= 24.20> --out <file.json>
//
// The manifest is each test's recorded reads (candidate 4's run), collapsed to FOLDERS: probed 2026-10-27, permission
// flags reach a spawned child only as command-line flags (node passes them on itself; a config file's grants did not
// reach the child, and --experimental-config-file is refused in NODE_OPTIONS), and the largest test reads 1,378 files,
// past Windows' 32,767-character command line as single files but ~10k characters as folders. Each test then runs alone
// with reads limited to its manifest (writes and child processes allowed): a test that fails with ERR_ACCESS_DENIED
// read something the recording missed, so this is the completeness check. Selection is by folder: a change selects the
// tests whose manifest holds the changed file's folder.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireIsolated } from './guard.mjs';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const { sets } = JSON.parse(fs.readFileSync(path.resolve(arg('sets')), 'utf8'));
const truth = JSON.parse(fs.readFileSync(path.resolve(arg('truth')), 'utf8'));
const nodeBin = path.resolve(arg('node'));
const out = path.resolve(arg('out') ?? 'manifest.json');
const lc = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

// A folder manifest per test: the folder of every in-repository read, and outside the repository the first two levels
// (the temp root, the user's home), whose contents change every run and never select anything.
const manifests = {};
for (const [t, s] of Object.entries(sets)) {
  const dirs = new Set();
  for (const rel of [...s.load, ...s.read]) {
    const abs = path.resolve(repo, rel);
    if (rel.startsWith('..')) dirs.add(abs.split(path.sep).slice(0, 2).join(path.sep) + path.sep);
    // A grant covers everything beneath it (measured: granting scripts/ allowed scripts/lib/argv.mjs), so a file in the
    // repository root is granted by itself: granting the root folder would allow every read and enforce nothing.
    else if (!rel.includes('/')) dirs.add(abs);
    else dirs.add(path.dirname(abs));
  }
  dirs.add(path.dirname(nodeBin));
  manifests[t] = [...dirs].sort();
}

const { NODE_TEST_CONTEXT, ...env } = process.env;
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
env[pathKey] = `${path.dirname(nodeBin)}${path.delimiter}${env[pathKey] ?? ''}`;
const runs = [];
for (const t of truth.sample) {
  const m = manifests[t] ?? [];
  const args = ['--permission', '--allow-child-process', '--allow-worker', '--allow-fs-write=*',
    // THE FILE DIRECTLY, not through --test: the runner reads the repository root to find its file ("Could not find"),
    // and granting the root would grant everything. node:test runs a test file's tests in-process when it is the entry.
    ...m.map((d) => `--allow-fs-read=${d}`), path.join(repo, t)];
  const started = Date.now();
  const r = spawnSync(nodeBin, args, { cwd: repo, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  runs.push({ test: t, folders: m.length, cmd_chars: args.join(' ').length, exit_code: r.status, ms: Date.now() - started,
    denied: /ERR_ACCESS_DENIED/.test(text), first_denial: (text.match(/resource: '([^']+)'/) ?? [])[1] ?? null,
    spawn_error: r.error?.code ?? null });
  console.log(`${r.status === 0 ? 'pass' : 'FAIL'} ${String(m.length).padStart(3)} folders  ${t}${/ERR_ACCESS_DENIED/.test(text) ? '  (ACCESS DENIED)' : ''}`);
}

const rows = truth.changes.map((c) => {
  const folder = lc(path.dirname(path.join(repo, c.file)));
  const selected = truth.sample.filter((t) => (manifests[t] ?? []).some((d) => lc(d) === folder));
  return { id: c.id, kind: c.kind, affected: c.affected.length, selected: selected.length,
    missed: c.affected.filter((t) => !selected.includes(t)), over: selected.filter((t) => !c.affected.includes(t)).length };
});
const result = { node: nodeBin, runs, candidate: { 'C5-enforced-folder-manifest': { misses: rows.reduce((n, x) => n + x.missed.length, 0), rows } } };
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
const failed = runs.filter((x) => x.exit_code !== 0);
console.log(`enforced: ${runs.length - failed.length}/${runs.length} pass; ${failed.filter((x) => x.denied).length} denied; max command ${Math.max(...runs.map((x) => x.cmd_chars))} chars`);
console.log(`C5-enforced-folder-manifest: ${result.candidate['C5-enforced-folder-manifest'].misses} miss(es)`);
for (const x of rows) console.log(`  ${x.id} ${x.kind.padEnd(34)} affected ${x.affected}  selected ${x.selected}  missed ${x.missed.length}  over ${x.over}`);
