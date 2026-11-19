// tests/tools/ci-watch.mjs reports whether CI on a commit is green, so a wrong status is its one way to fail.
//
// G-5 of 20261112-220041-ci-fix-review: the post-watch `gh run view` was outside any try, so a gh failure threw and
// exited 1, the "a job failed" code, and the --out log was never written. A gh failure must exit 2 and still write it.
//
// G-4 of the same review: polling stopped at the first run listed and never listed again, so a workflow whose run
// appeared later for the same commit was never watched, and the tool could exit 0 while that run failed.
//
// gh and git are faked by a copy of node named gh/git first on PATH, which runs a script named after its first argument
// (`run`, `rev-parse`) from the working directory: no real gh, git or network is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tools', 'ci-watch.mjs');
const SHA = 'a'.repeat(40);

// The fake gh: `run list` answers from the scenario by call count, `run watch` succeeds, `run view` answers per run.
const FAKE_RUN = `
const fs = require('node:fs');
const [, , sub, id] = process.argv;
const sc = JSON.parse(fs.readFileSync('scenario.json', 'utf8'));
if (sub === 'list') {
  const n = fs.existsSync('calls') ? Number(fs.readFileSync('calls', 'utf8')) : 0;
  fs.writeFileSync('calls', String(n + 1));
  process.stdout.write(JSON.stringify(sc.lists[Math.min(n, sc.lists.length - 1)]));
} else if (sub === 'watch') {
  process.exit(0);
} else if (sub === 'view') {
  if (process.argv.includes('--log-failed')) process.exit(0);
  const v = sc.views[id];
  if (!v) { process.stderr.write('HTTP 502: Bad Gateway'); process.exit(1); }
  process.stdout.write(JSON.stringify(v));
}
`;
const FAKE_REV_PARSE = `process.stdout.write(process.argv[process.argv.length - 1] + '\\n');`;

function fixture(scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-watch-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['gh', 'git']) {
    const target = path.join(bin, process.platform === 'win32' ? `${name}.exe` : name);
    if (process.platform === 'win32') fs.copyFileSync(process.execPath, target);
    else fs.symlinkSync(process.execPath, target);
  }
  fs.writeFileSync(path.join(dir, 'run'), FAKE_RUN);
  fs.writeFileSync(path.join(dir, 'rev-parse'), FAKE_REV_PARSE);
  fs.writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(scenario));
  return { dir, bin };
}

function watch(scenario) {
  const { dir, bin } = fixture(scenario);
  const out = path.join(dir, 'out.log');
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${bin}${path.delimiter}${env[pathKey] ?? ''}`;
  const r = spawnSync(process.execPath, [SCRIPT, '--sha', SHA, '--repo', 'o/r', '--out', out], { cwd: dir, env, encoding: 'utf8', timeout: 60_000 });
  const log = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, log };
}

const run = (id, name) => ({ databaseId: id, event: 'push', headBranch: 'master', workflowName: name });
const view = (conclusion) => ({ conclusion, url: 'https://example.invalid/run', jobs: [{ name: 'job', conclusion }] });

test('a gh failure after the watch exits 2, not the job-failed 1, and still writes --out (G-5)', () => {
  const r = watch({ lists: [[run(1, 'CI')]], views: {} });
  assert.equal(r.status, 2, `exit ${r.status}; stderr: ${r.stderr}`);
  assert.ok(r.log !== null, 'the --out log was not written');
  assert.match(r.log, /gh run view failed/);
});

test('a run that appears after the first is listed is watched too, and its failure is reported (G-4)', () => {
  const r = watch({ lists: [[run(1, 'CI')], [run(1, 'CI'), run(2, 'Late')]], views: { 1: view('success'), 2: view('failure') } });
  assert.equal(r.status, 1, `exit ${r.status}; stdout: ${r.stdout}`);
  assert.match(r.log, /Late on push/);
});

test('every run passing exits 0 once a re-list finds nothing new', () => {
  const r = watch({ lists: [[run(1, 'CI')]], views: { 1: view('success') } });
  assert.equal(r.status, 0, `exit ${r.status}; stdout: ${r.stdout} stderr: ${r.stderr}`);
  assert.match(r.log, /CI on push/);
});
