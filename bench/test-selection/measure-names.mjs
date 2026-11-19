// measure-names.mjs — one plain full run with test-names-reporter.mjs beside the file reporter: every test's name path and
// outcome, sorted, without its file (split-slow-test-files.md, criterion 2). Also each file's duration, for criterion 1.
//
// Usage: node bench/test-selection/measure-names.mjs --repo <sandbox> --node <node.exe> --out <names.json>
// Compare two outputs with: node bench/test-selection/measure-names.mjs --compare <before.json> <after.json>

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgv } from '../../scripts/lib/argv.mjs';

// The command line goes through scripts/lib/argv.mjs's parseArgv, the one parser, so a missing value or an unknown flag
// is refused by name (G-4 of 20261107-061412-split-delivery-2).
const die = (msg) => { process.stderr.write(`measure-names: ${msg}\n`); process.exit(2); };
let values;
try {
  ({ values } = parseArgv(process.argv.slice(2), { options: { repo: 'string', node: 'string', out: 'string', compare: 'list' } }));
} catch (e) { die(e.message); }
const arg = (k) => values[k] ?? null;

if (values.compare) {
  if (values.compare.length !== 2) die(`--compare takes two files, before and after; ${values.compare.length} given`);
  const [a, b] = values.compare.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')).names);
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const [ca, cb] = [count(a), count(b)];
  const diff = (p, q) => [...p].filter(([k, n]) => (q.get(k) ?? 0) < n).map(([k, n]) => `${k} (x${n - (q.get(k) ?? 0)})`);
  const lost = diff(ca, cb); const added = diff(cb, ca);
  console.log(`before ${a.length}, after ${b.length}; lost ${lost.length}, added ${added.length}`);
  for (const l of lost) console.log(`LOST  ${l}`);
  for (const l of added) console.log(`ADDED ${l}`);
  process.exit(lost.length || added.length ? 1 : 0);
}

const { requireIsolated } = await import('./guard.mjs');
const { fullRunner } = await import('./full-run.mjs');
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const nodeBin = path.resolve(arg('node') ?? process.execPath);
const out = path.resolve(arg('out') ?? 'names.json');
const { runTests } = fullRunner(repo, nodeBin);
const dest = path.join(repo, `.ts-names-${process.pid}.txt`);
const reporter = pathToFileURL(path.join(repo, 'bench', 'test-selection', 'test-names-reporter.mjs')).href;
const r = runTests(null, {}, [[reporter, dest]]);
const names = fs.readFileSync(dest, 'utf8').split(/\r?\n/).filter(Boolean).sort();
fs.rmSync(dest, { force: true });
// A failing or partial run is no complete name set, so it is not recorded: written, it compared as one (G-6 of
// 20261107-072037-split-delivery-3).
if (r.status !== 0 || r.failed.length || !names.length) {
  die(`the run did not pass (exit ${r.status}, ${r.failed.length} failing of ${r.files} files${r.failed.length ? `: ${r.failed.join(', ')}` : ''}, `
    + `${names.length} test names); no names written to ${out}`);
}
fs.writeFileSync(out, `${JSON.stringify({ node: nodeBin, run: r, names }, null, 2)}\n`);
console.log(`${(r.ms / 1000).toFixed(0)} s, ${r.failed.length} failing of ${r.files} files, ${names.length} test names`);
