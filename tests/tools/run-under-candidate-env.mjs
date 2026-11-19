#!/usr/bin/env node
// THIS REPOSITORY'S SUITE UNDER THE CANDIDATE CHECK'S ENVIRONMENT (candidate-check-boundaries.plan.md stage 4): the
// instrument that finds what the suite needs beyond the platform's process basics, so it can be declared in
// review.candidate_env rather than discovered by a refused remediation. It builds the environment exactly as the runner
// does for `test` — candidateCheckEnv over this process's environment, with the platform's basics and case rule and the
// contract's declared names, plus fresh channel files — runs `node tests/run-all.mjs` in it, and exits with its status.
//
// Test tooling, not engine: run by hand, on each platform (`node tests/tools/run-under-candidate-env.mjs`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { candidateCheckEnv } from '../../scripts/lib/full-check.mjs';
import { hostPlatform } from '../../scripts/platform/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const printed = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'new-run.mjs'), '--print-contract'], { cwd: ROOT, encoding: 'utf8' });
if (printed.status !== 0) { console.error(`could not read the contract: ${printed.stderr}`); process.exit(2); }
const contract = JSON.parse(printed.stdout);
const p = hostPlatform();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-candidate-env-'));
const env = candidateCheckEnv(process.env,
  { QUORATE_COUNT_FILE: path.join(dir, 'count.txt'), QUORATE_FACTS_FILE: path.join(dir, 'facts.json') },
  { basics: p.processEnvBasics, declared: contract.review?.candidate_env ?? [], caseInsensitiveEnv: p.caseInsensitiveEnv });
console.log(`run-under-candidate-env: ${p.name}, ${Object.keys(env).length} variables: ${Object.keys(env).sort().join(' ')}`);
const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'run-all.mjs')], { cwd: ROOT, env, stdio: 'inherit' });
let facts = null;
try { facts = JSON.parse(fs.readFileSync(path.join(dir, 'facts.json'), 'utf8')); } catch { /* none written */ }
fs.rmSync(dir, { recursive: true, force: true });
console.log(`run-under-candidate-env: exit ${r.status}; facts ${JSON.stringify(facts)}`);
process.exit(r.status ?? 1);
