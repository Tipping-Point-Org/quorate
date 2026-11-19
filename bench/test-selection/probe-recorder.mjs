// probe-recorder.mjs — which difference between the sample's recording and the full run's drops a test process's own
// reads (test-selection-exploration.md; full run of 2026-10-27: 274 of the 278 tests importing tests/helpers.mjs had no
// record of it, where the 20-test sample's recording had it).
//
// Usage: node bench/test-selection/probe-recorder.mjs --repo <sandbox> --node <node.exe> [--test <test file>]
//
// Records ONE test file four ways, each changing one thing from the sample's way, and says whether the test process's
// own import (tests/helpers.mjs) was recorded:
//   list      the sample's way: the file named, the dot reporter only, the record folder outside the repository
//   reporter  + the per-file reporter the full run adds
//   inrepo    + the record folder inside the repository, as the full run makes it
//   glob      the file reached through a `**` glob, as the full run passes the suite

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { requireIsolated } from './guard.mjs';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const repo = path.resolve(arg('repo') ?? (() => { throw new Error('--repo is required'); })());
requireIsolated(repo);
const nodeBin = path.resolve(arg('node') ?? process.execPath);
const testFile = arg('test') ?? 'tests/regression-telemetry-run-time.test.mjs';
const rel = (p) => path.relative(repo, p).split(path.sep).join('/');

const { NODE_TEST_CONTEXT, ...baseEnv } = process.env;
const pathKey = Object.keys(baseEnv).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
baseEnv[pathKey] = `${path.dirname(nodeBin)}${path.delimiter}${baseEnv[pathKey] ?? ''}`;
const preload = pathToFileURL(path.join(repo, 'bench', 'test-selection', 'recorder', 'audit-preload.mjs')).href;
const reporter = pathToFileURL(path.join(repo, 'tests', 'tools', 'suite-file-reporter.mjs')).href;
const glob = `tests/**/${path.basename(testFile)}`;

const VARIANTS = {
  list: { reporters: false, inRepo: false, target: testFile },
  reporter: { reporters: true, inRepo: false, target: testFile },
  inrepo: { reporters: true, inRepo: true, target: testFile },
  glob: { reporters: true, inRepo: true, target: glob },
};

const seenBy = {};
for (const [name, v] of Object.entries(VARIANTS)) {
  const dir = fs.mkdtempSync(v.inRepo ? path.join(repo, '.ts-records-') : path.join(os.tmpdir(), 'ts-probe-'));
  const claudeConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-suite-claude-'));
  const lines = path.join(os.tmpdir(), `ts-probe-${process.pid}.jsonl`);
  const reporterArgs = v.reporters
    ? ['--test-reporter=dot', '--test-reporter-destination=stdout', `--test-reporter=${reporter}`, `--test-reporter-destination=${lines}`]
    : ['--test-reporter=dot'];
  const started = Date.now();
  const r = spawnSync(nodeBin, [...reporterArgs, '--test', v.target], {
    cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28,
    env: { ...baseEnv, CLAUDE_CONFIG_DIR: claudeConfig, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
      TS_RECORD_DIR: dir, NODE_OPTIONS: `${baseEnv.NODE_OPTIONS ?? ''} --permission-audit --import=${preload}`.trim() },
  });
  const leaked = fs.readdirSync(claudeConfig);
  fs.rmSync(claudeConfig, { recursive: true, force: true });
  if (leaked.length) throw new Error(`a test started the real Claude CLI (it wrote ${leaked.join(', ')}); stopping`);
  const tests = {}; let records = 0;
  for (const f of fs.readdirSync(dir)) {
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).filter(Boolean)) {
      const e = JSON.parse(l); records++;
      (tests[rel(e.test)] ??= new Set()).add(rel(e.file));
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(lines, { force: true });
  const own = tests[testFile] ?? new Set();
  console.log(`${name.padEnd(8)} exit ${r.status} ${((Date.now() - started) / 1000).toFixed(0)} s; ${records} records, tests seen: ${Object.keys(tests).join(' ') || 'none'}; `
    + `${testFile}: ${own.size} files, helpers.mjs ${own.has('tests/helpers.mjs') ? 'RECORDED' : 'missing'}`);
  seenBy[name] = own;
}
// What the sample's way recorded and the glob's did not, by folder.
const lost = [...seenBy.list].filter((f) => !seenBy.glob.has(f));
console.log(`list but not glob (${lost.length}): ${lost.join(' ')}`);
