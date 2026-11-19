// CAPTURE'S INTERACTIVE FRONT END, ROUND 6 (remediation 20261116-121146-ci-remediation-6 of review
// 20261116-031337-ci-remediation-5-review). Each test names the group it exists for:
//   G-8   retention prunes only a label whose status.json carries this front end's writer mark, never a look-alike
//   G-5   a stream REACHING the cap stops the tree (the plan's stage 7: "a stream reaching it stops"), not only one past it
//   G-6   every stage of a pipeline has its stderr.stage-<n> file, a silent stage included
//   G-11  --fetch refuses a relative --evidence-dir, as a capture does
//   G-3   a positive capture_max_mb whose byte count floors to 0 is refused, not a zero-byte cap
//   G-19  the contract row says reaching the cap stops, names stderr.stage-<n> in the fetch synopsis, and states the mark

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, TEST_HOME } from './helpers.mjs';
import * as ci from '../scripts/io/capture-interactive.mjs';

const evidence = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ir6-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const baseEnv = () => ({ ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME });
const contractRow = () => fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8')
  .split('\n').find((l) => l.startsWith('| `scripts/capture.mjs --interactive`'));

test('G-8: an old directory with only schema_version 1 and a matching label is not pruned; a marked label is', async (t) => {
  const e = evidence(t);
  const past = new Date(Date.now() - 40 * 86_400_000);
  const lookalike = path.join(e, 'lookalike');
  fs.mkdirSync(lookalike);
  fs.writeFileSync(path.join(lookalike, 'status.json'), JSON.stringify({ schema_version: 1, label: 'lookalike' }));
  fs.utimesSync(path.join(lookalike, 'status.json'), past, past);
  const r0 = await ci.runInteractive({ source: 'node -e "1"', mode: 'run', evidenceDir: e, name: 'ours', cwd: REPO_ROOT, quiet: true,
    timeoutMinutes: 1, env: baseEnv() });
  assert.equal(r0.code, 0, r0.report);
  fs.utimesSync(path.join(e, 'ours', 'status.json'), past, past);
  const r = await ci.runInteractive({ source: 'node -e "1"', mode: 'run', evidenceDir: e, name: 'next', cwd: REPO_ROOT, quiet: true,
    timeoutMinutes: 1, env: baseEnv(), readContractFn: () => ({ contract: { review: { session_record_retention_days: 30 } } }) });
  assert.equal(r.code, 0, r.report);
  assert.equal(fs.existsSync(lookalike), true, 'a directory with only generic status fields was deleted as a label');
  assert.equal(fs.existsSync(path.join(e, 'ours')), false, 'a label this front end wrote, past retention, was kept');
});

test('G-5: a stream that writes exactly the cap and then hangs is stopped at the cap, not left to the deadline', async (t) => {
  const e = evidence(t);
  const cap = 0.01;
  const capBytes = Math.floor(cap * 1024 * 1024);
  const started = Date.now();
  const r = await ci.runInteractive({ source: `node -e "process.stdout.write(Buffer.alloc(${capBytes},120));setTimeout(()=>{},20000)"`,
    mode: 'run', evidenceDir: e, name: 'exact', cwd: REPO_ROOT, quiet: true, timeoutMinutes: 1, captureMaxMb: cap, env: baseEnv() });
  const status = JSON.parse(fs.readFileSync(path.join(e, 'exact', 'status.json'), 'utf8'));
  assert.equal(status.status, 'output_cap_reached', r.report);
  assert.equal(fs.statSync(path.join(e, 'exact', 'stdout')).size, capBytes);
  assert.ok(Date.now() - started < 12_000, 'the tree ran on past the cap');
});

test('G-6: a pipeline stage that writes no stderr still has its stderr.stage-<n>, fetched as empty', async (t) => {
  const e = evidence(t);
  const r = await ci.runInteractive({ source: `node -e "process.stderr.write('A1')" | node -e "1"`,
    mode: 'run', evidenceDir: e, name: 'silent', cwd: REPO_ROOT, quiet: true, timeoutMinutes: 1, env: baseEnv() });
  assert.equal(r.code, 0, r.report);
  const f = ci.fetchSaved({ evidenceDir: e, name: 'silent', stream: 'stderr.stage-2', mode: 'run' });
  assert.equal(f.code, 0, f.report);
  assert.equal(f.report, '');
});

test('G-11: --fetch refuses a relative --evidence-dir', async (t) => {
  const e = evidence(t);
  const r = await ci.runInteractive({ source: 'node -e "1"', mode: 'run', evidenceDir: e, name: 'f', cwd: REPO_ROOT, quiet: true,
    timeoutMinutes: 1, env: baseEnv() });
  assert.equal(r.code, 0, r.report);
  // On the evidence folder's drive (ci-path-identity.plan.md stage 3): path.relative across drives returns an absolute path,
  // so on the Windows runner (cwd D:, TEMP on C:) the "relative" --evidence-dir was absolute and was accepted (PR #3).
  const prev = process.cwd();
  process.chdir(path.dirname(e));
  let f;
  try {
    const rel = path.relative(process.cwd(), e);
    assert.ok(!path.isAbsolute(rel), `precondition: ${rel} is relative`);
    f = ci.fetchSaved({ evidenceDir: rel, name: 'f', stream: 'status.json', mode: 'run' });
  } finally { process.chdir(prev); }
  assert.equal(f.code, 2);
  assert.match(f.report, /must be absolute/);
  // A git that could not start is not "outside a work tree" (G-11 of 20261117-013640-m2-9a-final): the evidence-dir check
  // refuses, naming it, rather than admitting a directory git might track. Run with no PATH, so git cannot be found.
  const mod = new URL('../scripts/io/capture-interactive.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(mod)}); process.stdout.write(JSON.stringify(m.evidenceDirRefusal(${JSON.stringify(e)})));`],
  { encoding: 'utf8', env: { ...baseEnv(), PATH: '', Path: '' } });
  assert.equal(child.status, 0, child.stderr);
  const why = JSON.parse(child.stdout);
  assert.ok(typeof why === 'string' && /git could not be run/.test(why),
    `a git that could not start admitted the evidence directory (got ${JSON.stringify(why)}), failing open`);
});

test('G-3: a positive capture_max_mb whose byte count floors to 0 is refused', () => {
  assert.throws(() => ci.captureMaxBytesFrom({ review: { capture_max_mb: 1e-9 } }), /capture_max_mb/);
  assert.equal(ci.captureMaxBytesFrom({ review: { capture_max_mb: 1 / (1024 * 1024) } }), 1);
});

test('G-19: the contract row says reaching the cap stops, lists stderr.stage-<n> in the fetch synopsis, and names the mark', () => {
  const row = contractRow();
  assert.ok(row, 'the --interactive row is missing');
  assert.doesNotMatch(row, /does not stop it/, 'the row still says output exactly at the cap does not stop');
  assert.match(row, /reaching it stops the command's tree/);
  assert.match(row, /--fetch stdout\\\|stderr\\\|combined\\\|status\.json\\\|argv\.json\\\|stderr\.stage-<n>/);
  assert.match(row, /`writer`/);
});
