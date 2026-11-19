// measure-whole.mjs — a second ground truth for the full-suite run: each changed file's WHOLE content replaced, so a test
// that reads the file as text, or scans its folder, can fail too (test-selection-exploration.md; operator, 2026-10-28,
// option B: "2 B").
//
// Usage: node bench/test-selection/measure-whole.mjs --repo <sandbox> --node <node.exe> --from <full-v2.json>
//        --out <file.json> [--resume]
//
// The first ground truth broke a .mjs file with a leading throw, which fails a test that RUNS the file and leaves every
// pattern in its text in place: 113 of the 465 over-selected pairs of the re-recorded run read the changed file by name
// and check its source. Here a .mjs or .json file becomes one line, `throw new Error('TEST-SELECTION MUTATION');` for
// .mjs and garbage for .json, so neither its code nor its text survives. A .md file was already replaced whole, so a change
// made only of .md files is not run again. For each change: the tests failing now and not in the clean runs; their union
// with the first ground truth; and, against the selection of --from (unchanged), the misses and over-selection that union
// gives. A test failing here and NOT selected is a miss the first ground truth could not show.
//
// Every run gets run-all.mjs's isolation, as measure-full.mjs does: a throwaway CLAUDE_CONFIG_DIR and blank credentials,
// checked empty after. runTests is measure-full.mjs's, minus the per-file times this measurement does not use.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { requireIsolated } from './guard.mjs';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const need = (k) => arg(k) ?? (() => { throw new Error(`--${k} is required`); })();
const repo = path.resolve(need('repo'));
requireIsolated(repo);
const nodeBin = path.resolve(arg('node') ?? process.execPath);
const from = JSON.parse(fs.readFileSync(path.resolve(need('from')), 'utf8'));
const out = path.resolve(need('out'));
const rel = (p) => path.relative(repo, p).split(path.sep).join('/');

const { NODE_TEST_CONTEXT, ...baseEnv } = process.env;
const pathKey = Object.keys(baseEnv).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
baseEnv[pathKey] = `${path.dirname(nodeBin)}${path.delimiter}${baseEnv[pathKey] ?? ''}`;
const reporter = pathToFileURL(path.join(repo, 'tests', 'tools', 'suite-file-reporter.mjs')).href;
const ALL = spawnSync('git', ['ls-files', 'tests/*.test.mjs', 'tests/**/*.test.mjs'], { cwd: repo, encoding: 'utf8' })
  .stdout.split(/\r?\n/).filter(Boolean).sort();
if (ALL.length !== from.tests) throw new Error(`${ALL.length} test files here, ${from.tests} in --from: not the same suite`);

function runTests() {
  const lines = path.join(repo, `.ts-whole-${process.pid}.jsonl`);
  fs.rmSync(lines, { force: true });
  const claudeConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-suite-claude-'));
  const started = new Date();
  spawnSync(nodeBin, ['--test-reporter=dot', '--test-reporter-destination=stdout', `--test-reporter=${reporter}`,
    `--test-reporter-destination=${lines}`, '--test', ...ALL], {
    cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28,
    env: { ...baseEnv, CLAUDE_CONFIG_DIR: claudeConfig, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' },
  });
  const ended = new Date();
  const leaked = fs.readdirSync(claudeConfig);
  fs.rmSync(claudeConfig, { recursive: true, force: true });
  if (leaked.length) throw new Error(`a test started the real Claude CLI (it wrote ${leaked.join(', ')}); stopping`);
  const failed = new Set(); const seen = new Set();
  const text = fs.existsSync(lines) ? fs.readFileSync(lines, 'utf8') : '';
  for (const l of text.split(/\r?\n/).filter(Boolean)) {
    const e = JSON.parse(l);
    if (e.event !== 'summary') continue;
    const f = rel(e.file); seen.add(f);
    if ((e.counts?.failed ?? 0) > 0 || (e.counts?.tests ?? 0) === 0) failed.add(f);
  }
  fs.rmSync(lines, { force: true });
  for (const f of ALL) if (!seen.has(f)) failed.add(f);
  return { ms: ended - started, started_at: started.toISOString(), ended_at: ended.toISOString(), failed: [...failed].sort() };
}

const WHOLE = {
  '.mjs': () => "throw new Error('TEST-SELECTION MUTATION');\n",
  '.json': () => 'TEST-SELECTION MUTATION\n',
  '.md': () => 'TEST-SELECTION MUTATION\n',
};
const original = (file) => {
  const r = spawnSync('git', ['show', `HEAD:${file}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git show HEAD:${file} failed: ${r.stderr}`);
  return r.stdout;
};
function withWhole(files, fn) {
  const before = Object.fromEntries(files.map((f) => [f, original(f)]));
  for (const f of files) fs.writeFileSync(path.join(repo, f), WHOLE[path.extname(f)]());
  try { return fn(); } finally {
    for (const f of files) {
      fs.writeFileSync(path.join(repo, f), before[f]);
      if (fs.readFileSync(path.join(repo, f), 'utf8') !== before[f]) throw new Error(`could not restore ${f}`);
    }
  }
}

const result = process.argv.includes('--resume') && fs.existsSync(out)
  ? JSON.parse(fs.readFileSync(out, 'utf8')) : { node: nodeBin, from: path.resolve(need('from')), tests: ALL.length, changes: {} };
const save = () => fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
const log = (s) => console.log(`${new Date().toLocaleTimeString()} ${s}`);
// The clean runs of --from: a test failing in any of them is not counted as affected (none did, on 2026-10-28).
const cleanFailed = new Set(from.baselines.flatMap((b) => b.failed));

for (const [id, c] of Object.entries(from.changes)) {
  if (result.changes[id]) continue;
  if (c.files.every((f) => path.extname(f) === '.md')) {
    result.changes[id] = { files: c.files, skipped: 'every file is .md, already replaced whole by the first ground truth' };
    save(); log(`${id}: skipped (.md only)`); continue;
  }
  const r = withWhole(c.files, runTests);
  const whole = r.failed.filter((f) => !cleanFailed.has(f));
  const union = [...new Set([...c.affected, ...whole])].sort();
  const sel = new Set(c.selected);
  const missed = union.filter((t) => !sel.has(t));
  const over = c.selected.filter((t) => !union.includes(t));
  result.changes[id] = { files: c.files, kind: c.kind, affected_throw: c.affected.length, affected_whole: whole.length,
    affected_union: union.length, newly_affected: whole.filter((t) => !c.affected.includes(t)), selected: c.selected.length,
    missed, over: over.length, over_throw: c.over, run: { ms: r.ms, started_at: r.started_at, ended_at: r.ended_at } };
  save();
  log(`${id} ${c.kind}: affected ${c.affected.length} by the throw, ${whole.length} by whole replacement, ${union.length} together; `
    + `selected ${c.selected.length}; MISSED ${missed.length}${missed.length ? ` (${missed.join(', ')})` : ''}; over ${c.over} -> ${over.length}; run ${(r.ms / 1000).toFixed(0)} s`);
}
log(`done: misses in all ${Object.values(result.changes).reduce((k, c) => k + (c.missed?.length ?? 0), 0)}`);
