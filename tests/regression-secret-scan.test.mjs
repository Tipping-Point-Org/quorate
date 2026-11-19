// A secret scan on every push (operator, 2026-09-25: "can't we start using it from now? why wait?").
//
// The pre-push gate spends its declared checks only on pushes into main/master, so saving work in
// progress stays free. The secret scan deliberately does NOT follow that rule: a secret pushed to
// ANY branch on the remote has already left the machine, and scanning only the commits a push adds
// takes well under a second. So it runs before the protected-ref decision, on every push.
//
// WHETHER IT IS REQUIRED IS THE CONTRACT'S TO SAY (G-9 of 20260926-002850-m0-close; operator,
// 2026-09-25): `hooks.secret_scan: required | off`, absent meaning required. Required and gitleaks
// missing BLOCKS — the first version let a consumer's push through unscanned, which is the "absent
// treated as pass" the intent names as an anti-pattern. Off skips, and says so on every push. Anything
// else is refused rather than read as either. CI reads the same flag through the engine. A scanner
// that FAILED is not a scan that passed: that blocks too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { secretScanRanges, secretScanArgv, secretScanOutcome, secretScanPolicy, SECRET_LEAK_EXIT } from '../scripts/lib/push-gate.mjs';
import { REPO_ROOT } from './helpers.mjs';

const Z = '0'.repeat(40);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('the scan covers exactly the commits a push adds, and fails closed to the whole history', () => {
  assert.deepEqual(secretScanRanges(`refs/heads/x ${B} refs/heads/x ${A}\n`), { all: false, ranges: [`${A}..${B}`] });
  assert.deepEqual(secretScanRanges(`refs/heads/new ${B} refs/heads/new ${Z}\n`), { all: false, ranges: [`${B} --not --remotes`] },
    'a new branch: everything on it that no remote already has');
  assert.deepEqual(secretScanRanges(`(delete) ${Z} refs/heads/gone ${A}\n`), { all: false, ranges: [] }, 'a deletion adds nothing to scan');
  assert.deepEqual(secretScanRanges(''), { all: true, ranges: [] }, 'no readable ref list: scan everything rather than guess');
  assert.deepEqual(secretScanRanges('garbage'), { all: true, ranges: [] });
});

test('the scanner is asked to redact, and to report leaks with their own exit code', () => {
  const argv = secretScanArgv('/r', `${A}..${B}`);
  assert.deepEqual(argv.slice(0, 2), ['git', '/r']);
  for (const f of ['--redact', '--no-banner']) assert.ok(argv.includes(f), f);
  assert.equal(argv[argv.indexOf('--exit-code') + 1], String(SECRET_LEAK_EXIT));
  assert.equal(argv[argv.indexOf('--log-opts') + 1], `${A}..${B}`);
  assert.ok(!secretScanArgv('/r', null).includes('--log-opts'), 'no range means the whole history');
  assert.notEqual(SECRET_LEAK_EXIT, 1, 'distinct from the exit code of a scanner that failed');
});

test('what each outcome means', () => {
  assert.equal(secretScanOutcome({ status: 0 }).block, false);
  assert.equal(secretScanOutcome({ status: SECRET_LEAK_EXIT }).block, true);
  assert.equal(secretScanOutcome({ status: 1 }).block, true, 'a scanner that failed is not a scan that passed');
  // This asserted that a consumer without gitleaks was "warned, not blocked" — G-9 itself.
  const missing = secretScanOutcome({ missing: true, mode: 'required' });
  assert.equal(missing.block, true, 'required and not installed blocks, in any repository');
  assert.match(missing.message, /install gitleaks|secret_scan: off/);
});

test('G-9: the contract decides — absent is required, a typo is refused, off is off', () => {
  assert.deepEqual(secretScanPolicy({}), { mode: 'required', declared: false });
  assert.deepEqual(secretScanPolicy({ hooks: { secret_scan: 'required' } }), { mode: 'required', declared: true });
  assert.deepEqual(secretScanPolicy({ hooks: { secret_scan: 'off' } }), { mode: 'off', declared: true });
  for (const bad of ['requred', '', 'false', 'OFF ']) {
    const p = secretScanPolicy({ hooks: { secret_scan: bad } });
    assert.ok(p.error && !p.mode, `${JSON.stringify(bad)} is refused, never read as required or off`);
  }
});

test('G-9: the hook asks the contract, and CI asks the engine rather than parsing YAML', () => {
  const hook = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'hooks', 'checks.mjs'), 'utf8');
  assert.ok(hook.indexOf('secretScanPolicy(') > -1 && hook.indexOf('secretScanPolicy(') < hook.indexOf('secretScanRanges('), 'policy first');
  assert.doesNotMatch(hook, /secretScanOutcome\([^)]*framework/, 'no framework-versus-consumer split any more');
  const ci = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'checks.yml'), 'utf8');
  assert.match(ci, /check-secrets\.mjs --mode/, 'CI reads the flag through the engine');
  assert.match(ci, /if: steps\.policy\.outputs\.mode == 'required'/, 'and installs gitleaks only when it is required');
  assert.match(ci, /sha256sum -c/, 'hash-pinned');
});

test('G-9: check-secrets refuses a required scan it cannot run, and honours off', (t) => {
  const script = path.join(REPO_ROOT, 'scripts', 'check-secrets.mjs');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-check-secrets-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: d });
  const contract = (mode) => fs.writeFileSync(path.join(d, 'CLAUDE.md'), [
    '# x', '', '```yaml', 'graph_contract_version: 5', 'project: probe', ...(mode ? ['hooks:', `  secret_scan: ${mode}`] : []), '```', '',
  ].join(String.fromCharCode(10)));
  const run = (args, env) => spawnSync(process.execPath, [script, ...args], { cwd: d, encoding: 'utf8', env: { ...process.env, ...env } });
  // Every PATH entry except those holding a gitleaks binary: git and node stay reachable, the scanner
  // does not. Whatever the platform calls the PATH variable, it is replaced by the same filtered list.
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const withoutGitleaks = (process.env[pathKey] ?? '').split(path.delimiter)
    .filter((p) => p && !['gitleaks', 'gitleaks.exe'].some((n) => fs.existsSync(path.join(p, n))))
    .join(path.delimiter);
  contract(null);
  assert.equal(run(['--mode']).stdout.trim(), 'required', 'absent is required');
  const noTool = run([], { [pathKey]: withoutGitleaks });
  assert.equal(noTool.status, 1, `required and not installed fails: ${noTool.stderr}`);
  contract('off');
  const off = run([], { [pathKey]: withoutGitleaks });
  assert.equal(off.status, 0, off.stderr);
  assert.match(off.stdout + off.stderr, /off/);
  contract('requred');
  assert.equal(run(['--mode']).status, 2, 'a typo is refused, not guessed');
});

test('the hook scans before it decides whether the push is gated', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'hooks', 'checks.mjs'), 'utf8');
  const scan = src.indexOf('secretScanRanges(');
  const early = src.indexOf('checks skipped (they run when this lands');
  assert.ok(scan > -1, 'the hook runs the secret scan');
  assert.ok(scan < early, 'before a feature-branch push exits early');
});

const hasGitleaks = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).status === 0;

test('live: the exact argv finds a planted token, redacted, and passes a clean history', { skip: !hasGitleaks && 'gitleaks is not on PATH' }, (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-secret-scan-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(d, 'README.md'), 'clean');
  git('add', '-A'); git('commit', '-qm', 'clean');
  const clean = git('rev-parse', 'HEAD').stdout.trim();
  assert.equal(spawnSync('gitleaks', secretScanArgv(d, null), { encoding: 'utf8' }).status, 0, 'a clean history passes');

  // Built at run time, so this file never carries a string the repository's own scan would flag.
  const alnum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const token = 'gh' + 'p_' + Array.from(crypto.randomBytes(36), (b) => alnum[b % alnum.length]).join('');
  fs.writeFileSync(path.join(d, 'config.js'), `export const token = "${token}";\n`);
  git('add', '-A'); git('commit', '-qm', 'oops');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const r = spawnSync('gitleaks', secretScanArgv(d, `${clean}..${head}`), { encoding: 'utf8' });
  assert.equal(r.status, SECRET_LEAK_EXIT, `the planted token is found: ${r.stdout}${r.stderr}`);
  assert.ok(!(r.stdout + r.stderr).includes(token), 'and never printed');
});
