#!/usr/bin/env node
// check-secrets.mjs — the secret scan over the whole history, as the graph_contract declares it.
//
//   node <framework-root>/scripts/check-secrets.mjs           scan, if hooks.secret_scan requires it
//   node <framework-root>/scripts/check-secrets.mjs --mode    print `required` or `off`, and nothing else
//
// `hooks.secret_scan: required | off`, absent meaning required (G-9 of 20260926-002850-m0-close). The
// pre-push hook scans each push's commits; this is the same rule for CI, where a merge made on the
// forge runs no local hook. CI asks `--mode` first and installs gitleaks only when it is required,
// so the workflow never parses the contract itself: the meaning of the flag has one owner,
// lib/push-gate.mjs, whether a hook or a CI job is asking.
//
// Exit: 0 clean or off by declaration · 1 a secret found, the scanner failed, or it is required and
// not installed · 2 the flag is not a value this engine recognises, or this is not a repository.
import path from 'node:path';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { secretScanPolicy, secretScanArgv, secretScanOutcome, secretScanConfig } from './lib/push-gate.mjs';
import { readContract } from './io/contract-reader.mjs';
import { gitSync } from './io/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md): `--mode` is the
// one flag, and anything else is refused before the repository or the contract is read.
let modeOnly;
try { modeOnly = Boolean(parseArgv(process.argv.slice(2), ARGV_SPECS['check-secrets']).values.mode); } catch (e) {
  if (!(e instanceof ArgvError)) throw e;
  console.error(`check-secrets: ${e.message}`);
  process.exit(2);
}

const top = gitSync(['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (top.status !== 0) {
  console.error('check-secrets: not inside a git repository');
  process.exit(2);
}
const root = path.resolve(top.stdout.trim());

// Through the engine, like every contract key: location, the two-file rule and parsing are its. A
// contract that cannot be read is treated as absent — which means required, the strict answer.
const contract = readContract({ repoRoot: root }).contract ?? {};   // the one reader (ledger-findings stage 4); unreadable: required

const policy = secretScanPolicy(contract);
if (policy.error) {
  console.error(`check-secrets: ${policy.error}`);
  process.exit(2);
}
if (modeOnly) {
  console.log(policy.mode);
  process.exit(0);
}
if (policy.mode === 'off') {
  console.log('check-secrets: secret scan OFF by declaration (hooks.secret_scan: off) — nothing was scanned');
  process.exit(0);
}

// The framework's key-value rule (ledger-trust-boundaries 1b), unless the repository has its own config.
const config = secretScanConfig({ repoRoot: root, frameworkRoot: path.dirname(HERE), exists: fs.existsSync });
const r = spawnSync('gitleaks', secretScanArgv(root, null, { config }), { cwd: root, stdio: 'inherit' });
const outcome = secretScanOutcome(r.error?.code === 'ENOENT' ? { missing: true } : { status: r.status });
if (outcome.block) {
  console.error(`check-secrets: ${outcome.message}`);
  process.exit(1);
}
console.log(`check-secrets: ${outcome.message}`);
