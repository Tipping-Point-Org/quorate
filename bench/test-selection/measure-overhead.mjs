// measure-overhead.mjs — what each zero-miss candidate COSTS, in paired, interleaved runs (test-selection-exploration.md).
//
// Usage: node bench/test-selection/measure-overhead.mjs --repo <sandbox> --candidate <c1|c4|wireit|tup|buildxl|moon|bazel>
//        --truth <ground-truth.json> --node <node.exe> [--sets <audit.json>] [--tool <binary or tool dir>] [--pairs 16]
//        [--load-csv <sampler csv>] --out <file.json>
//
// The selection was measured elsewhere; this measures time only. Each pair is one plain run of the 20-test sample
// (`node --test`, the baseline) and one run through the candidate, in alternating order (plain first in even pairs, the
// candidate first in odd ones) so a drift in machine load falls on both arms alike. Before each pair every sample test
// file gets a unique trailing comment, so a caching tool (Wireit, tup, BuildXL) must run every test: this is the cost
// when everything runs. Then one unchanged run of a caching tool is timed alone, the cost when nothing does. moon and
// Bazel run no tests, so their figure is the query alone, unpaired; what they add to a run is the recorder that feeds
// their declarations, candidate 4. One untimed warm-up pair comes first. The same node runs every arm.
//
// With --load-csv (the avp/load sampler's file, local times), each run gets the mean avp and total CPU of the samples
// taken while it ran, so a load-driven outlier can be seen and, if needed, adjusted for.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { requireIsolated } from './guard.mjs';
import { writeBuildxlConfig } from './buildxl-config.mjs';
import { joinLoad } from './load-join.mjs';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const candidate = arg('candidate');
const truth = JSON.parse(fs.readFileSync(path.resolve(arg('truth')), 'utf8'));
const nodeBin = path.resolve(arg('node') ?? process.execPath);
const tool = arg('tool') ? path.resolve(arg('tool')) : null;
const pairs = Number(arg('pairs') ?? 16);
const out = path.resolve(arg('out') ?? `overhead-${candidate}.json`);
const sets = arg('sets') ? JSON.parse(fs.readFileSync(path.resolve(arg('sets')), 'utf8')).sets : null;
const inRepo = (f) => !f.startsWith('..') && !/^[A-Za-z]:|^[\\/]/.test(f);
const declared = (t) => [...new Set([...(sets?.[t]?.load ?? []), ...(sets?.[t]?.read ?? [])])].filter(inRepo).sort();

// One node for every process in every arm: --permission-audit needs >= 24.20 in the whole tree (measure-recorder.mjs).
const { NODE_TEST_CONTEXT, ...baseEnv } = process.env;
const pathKey = Object.keys(baseEnv).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
baseEnv[pathKey] = `${path.dirname(nodeBin)}${path.delimiter}${baseEnv[pathKey] ?? ''}`;

const timed = (file, args, opts = {}) => {
  const started = new Date();
  const r = spawnSync(file, args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28, env: baseEnv, ...opts });
  const ended = new Date();
  return { status: r.status, ms: ended - started, started_at: started.toISOString(), ended_at: ended.toISOString(),
    text: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const nodeTest = (env = baseEnv) => timed(nodeBin, ['--test-reporter=dot', '--test', ...truth.sample], { env });
const plain = () => nodeTest();
const recorderRun = (preload, flags) => () => {
  const dir = fs.mkdtempSync(path.join(repo, '.ts-records-'));
  const href = pathToFileURL(path.join(repo, 'bench', 'test-selection', 'recorder', preload)).href;
  try {
    return nodeTest({ ...baseEnv, TS_RECORD_DIR: dir, NODE_OPTIONS: `${baseEnv.NODE_OPTIONS ?? ''} ${flags} --import=${href}`.trim() });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

// Each candidate: setup once, `run` (all tests made to run), `executed` (how many tests it ran, to prove the forcing
// worked), and whether it is paired against the plain run.
const CANDIDATES = {
  c1: { paired: true, run: recorderRun('preload.mjs', '') },
  c4: { paired: true, run: recorderRun('audit-preload.mjs', '--permission-audit') },
  wireit: {
    paired: true,
    setup() {
      const ids = Object.fromEntries(truth.sample.map((t, i) => [t, `t${i}`]));
      const pkg = { name: 'ts-wireit', private: true, scripts: { all: 'wireit' }, wireit: { all: { dependencies: Object.values(ids) } } };
      for (const t of truth.sample) { pkg.scripts[ids[t]] = 'wireit'; pkg.wireit[ids[t]] = { command: `node --test ${t}`, files: declared(t), output: [] }; }
      fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
      fs.symlinkSync(path.join(tool, 'node_modules'), path.join(repo, 'node_modules'), 'junction');
      this.ids = Object.values(ids);
    },
    run() {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      return timed(npm, ['run', 'all'], { env: { ...baseEnv, WIREIT_LOGGER: 'simple', CI: 'true' }, shell: process.platform === 'win32' });
    },
    executed(r) {
      return this.ids.filter((id) => new RegExp(`\\[${id}\\][^\\n]*(Running|Executed|Ran )`, 'i').test(r.text)
        && !new RegExp(`\\[${id}\\][^\\n]*(fresh|Skipped)`, 'i').test(r.text)).length;
    },
  },
  tup: {
    paired: true,
    setup() {
      fs.writeFileSync(path.join(repo, 'Tupfile'), truth.sample.map((t) => `: |> node --test ${t} |> ^dev-temp`).join('\n') + '\n');
      const init = timed(tool, ['init']);
      if (init.status !== 0) throw new Error(`tup init failed: ${init.text.slice(0, 400)}`);
    },
    run: () => timed(tool, ['upd', '-k']),
    executed: (r) => new Set([...r.text.matchAll(/\d+\)\s+(?:\[[\d.]+s\]\s+)?node --test (\S+)/g)].map((m) => m[1])).size,
  },
  buildxl: {
    paired: true,
    setup() {
      const profile = process.env.USERPROFILE ?? process.env.HOME;
      const untracked = [process.env.TEMP ?? 'C:/work/temp', profile, 'C:/Program Files', 'C:/Program Files (x86)', 'C:/ProgramData', 'C:/Windows', path.join(repo, '.git')];
      writeBuildxlConfig({ repo, sample: truth.sample, sdk: path.join(path.dirname(tool), 'Sdk'), nodeExe: nodeBin, untracked });
    },
    run: () => timed(tool, ['/c:config.dsc', '/server-', '/nologo']),
    executed() {
      const log = path.join(repo, 'Out', 'Logs', 'BuildXL.log');
      const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      return new Set([...text.matchAll(/DX0235: \[[^\]]*\|\| ts-test (\S+)\] Cache miss/g)].map((m) => m[1])).size;
    },
  },
  moon: {
    paired: false,
    setup() {
      const q = (s) => `'${s.replaceAll("'", "''")}'`;
      const lines = ['tasks:'];
      truth.sample.forEach((t, i) => lines.push(`  t${i}:`, `    command: ${q(`node --test ${t}`)}`, `    toolchains: ['system']`, '    inputs:', ...declared(t).map((f) => `      - ${q(`/${f}`)}`)));
      fs.mkdirSync(path.join(repo, '.moon'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.moon', 'workspace.yml'), "projects:\n  root: '.'\nvcs:\n  client: git\n");
      fs.writeFileSync(path.join(repo, 'moon.yml'), `${lines.join('\n')}\n`);
    },
    run: () => timed(tool, ['query', 'affected'], { shell: process.platform === 'win32' }),
    executed(r) { try { return Object.keys(JSON.parse(r.text.slice(r.text.indexOf('{'))).tasks ?? {}).length; } catch { return null; } },
  },
  bazel: {
    paired: false,
    setup() {
      const home = path.join(path.dirname(path.dirname(path.dirname(tool))), 'home');
      const lines = truth.sample.map((t, i) => `filegroup(name = "t${i}", srcs = [${declared(t).map((f) => JSON.stringify(f)).join(', ')}])`);
      fs.writeFileSync(path.join(repo, 'BUILD.bazel'), `${lines.join('\n')}\n`);
      fs.writeFileSync(path.join(repo, 'MODULE.bazel'), 'module(name = "ts_bazel")\n');
      fs.writeFileSync(path.join(repo, '.bazelrc'), `startup --output_user_root=${path.join(home, 'output-root').replaceAll('\\', '/')}\ncommon --enable_bzlmod\n`);
      this.env = { ...baseEnv, BAZELISK_HOME: path.join(home, 'bazelisk') };
    },
    // Every sample test file changed: the query names all their dependents.
    run() {
      return timed(tool, ['query', `rdeps(//:all, set(${truth.sample.map((t) => `//:${t}`).join(' ')}))`, '--output=label', '--noshow_progress'],
        { env: this.env, shell: process.platform === 'win32' });
    },
    executed: (r) => r.text.split(/\r?\n/).filter((l) => /^\/\/:t\d+$/.test(l.trim())).length,
    teardown() { timed(tool, ['shutdown'], { env: this.env, shell: process.platform === 'win32' }); },
  },
};
const C = CANDIDATES[candidate];
if (!C) throw new Error(`--candidate must be one of ${Object.keys(CANDIDATES).join(', ')}`);

const originals = Object.fromEntries(truth.sample.map((t) => [t, fs.readFileSync(path.join(repo, t), 'utf8')]));
const mark = (tag) => { for (const t of truth.sample) fs.writeFileSync(path.join(repo, t), `${originals[t]}\n// ts-overhead ${tag}\n`); };

const slim = (r, extra = {}) => ({ status: r.status, ms: r.ms, started_at: r.started_at, ended_at: r.ended_at, ...extra });

const runs = [];
try {
  C.setup?.();
  // Warm-up, untimed: a first build, a cold disk cache, a first query.
  mark('warm-up');
  if (C.paired) plain();
  const warm = C.run();
  console.log(`${candidate}: warm-up exit ${warm.status}, ${(warm.ms / 1000).toFixed(1)} s${C.executed ? `, ${C.executed(warm)} executed` : ''}`);
  for (let i = 0; i < pairs; i += 1) {
    mark(i);
    const pair = { i, order: C.paired ? (i % 2 === 0 ? 'plain-first' : 'candidate-first') : 'candidate-only' };
    const doPlain = () => { const r = plain(); pair.plain = slim(r); };
    const doCand = () => { const r = C.run(); pair.candidate = slim(r, C.executed ? { executed: C.executed(r) } : {}); if (r.status !== 0) pair.candidate.tail = r.text.slice(-600); };
    if (!C.paired) doCand();
    else if (i % 2 === 0) { doPlain(); doCand(); } else { doCand(); doPlain(); }
    // The cost when nothing changed, for a tool that caches: a second run of the same tree.
    if (C.executed && C.paired && candidate !== 'c1' && candidate !== 'c4') { const r = C.run(); pair.unchanged = slim(r, { executed: C.executed(r) }); }
    runs.push(pair);
    const p = pair.plain ? `plain ${(pair.plain.ms / 1000).toFixed(2)} s (${pair.plain.status})  ` : '';
    const u = pair.unchanged ? `  unchanged ${(pair.unchanged.ms / 1000).toFixed(2)} s, ${pair.unchanged.executed} run` : '';
    console.log(`  ${String(i).padStart(2)} ${pair.order.padEnd(15)} ${p}${candidate} ${(pair.candidate.ms / 1000).toFixed(2)} s (${pair.candidate.status}${pair.candidate.executed != null ? `, ${pair.candidate.executed} run` : ''})${u}`);
  }
} finally {
  for (const t of truth.sample) fs.writeFileSync(path.join(repo, t), originals[t]);
  C.teardown?.();
}

// Two-sided 95% t quantiles by degrees of freedom; 1.96 past 30.
const T95 = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120,
  2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
const stats = (xs) => {
  const n = xs.length; const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const half = n > 1 ? (T95[n - 1] ?? 1.96) * sd / Math.sqrt(n) : null;
  return { n, mean: Math.round(mean), median: Math.round(n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2), sd: Math.round(sd),
    ci95: half == null ? null : [Math.round(mean - half), Math.round(mean + half)], min: s[0], max: s[n - 1] };
};
// Read only now: read at the start, the file held none of the rows written while the runs went (2026-10-27, 0 of 240 joined).
joinLoad(runs, arg('load-csv'));
const summary = { candidate: stats(runs.map((p) => p.candidate.ms)) };
if (C.paired) {
  summary.plain = stats(runs.map((p) => p.plain.ms));
  summary.diff = stats(runs.map((p) => p.candidate.ms - p.plain.ms));
  summary.ratio_of_medians = +(summary.candidate.median / summary.plain.median).toFixed(3);
  summary.failed = { plain: runs.filter((p) => p.plain.status !== 0).length, candidate: runs.filter((p) => p.candidate.status !== 0).length };
}
if (runs.some((p) => p.unchanged)) summary.unchanged = stats(runs.filter((p) => p.unchanged).map((p) => p.unchanged.ms));
if (C.executed) summary.executed = [...new Set(runs.map((p) => p.candidate.executed))];
const result = { candidate, node: nodeBin, pairs, sample: truth.sample.length, summary, runs };
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
const f = (s) => `median ${s.median} ms, mean ${s.mean} (95% CI ${s.ci95?.join('..') ?? 'n/a'})`;
console.log(`${candidate}: candidate ${f(summary.candidate)}`);
if (summary.diff) console.log(`${candidate}: plain ${f(summary.plain)}; candidate minus plain ${f(summary.diff)}; ratio ${summary.ratio_of_medians}; failed ${JSON.stringify(summary.failed)}`);
if (summary.unchanged) console.log(`${candidate}: unchanged ${f(summary.unchanged)}`);
