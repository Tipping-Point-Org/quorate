// bench-second-opinion's judge call: the engine's home reaches external-review, and its deadline has one owner.
//
// G-10 of 20261030-171256-ciss-c-review: askJudge built the child's environment with reviewerEnv alone, whose vendor
// allow-list drops QUORATE_HOME, so external-review resolved the default home and refused every judge run for an
// operator with a custom one. run-graph had already fixed the same drop for its arm and tie-break spawns
// (ENGINE_LOCATION, G-12 of 20261010-063310-reviewer-preflight-r6); the keys now have one owner both read.
//
// G-11: the judge's --timeout-minutes was a literal '20', a second timeout authority beside lib/check-timeout.mjs. It is
// now the frozen contract's node_timeout_minutes, as the spawned second-opinion node's and run-graph's tie-break are.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

function askJudgeBody() {
  const src = read('scripts/bench-second-opinion.mjs');
  const start = src.indexOf('async function askJudge(');
  assert.ok(start >= 0, 'askJudge is declared');
  const end = src.indexOf('\nasync function ', start + 1);
  return src.slice(start, end < 0 ? undefined : end);
}

test('G-10: the engine-location keys have one owner, and it keeps QUORATE_HOME and the probe store only', async () => {
  const m = await import(pathToFileURL(path.join(REPO_ROOT, 'scripts', 'lib', 'decisions.mjs')).href);
  assert.equal(typeof m.engineLocationEnv, 'function', 'decisions.mjs exports engineLocationEnv');
  assert.deepEqual(m.engineLocationEnv({ QUORATE_HOME: '/h', QUORATE_REVIEWER_PROBES: '/p', OPENAI_API_KEY: 'x', PATH: '/bin' }),
    { QUORATE_HOME: '/h', QUORATE_REVIEWER_PROBES: '/p' });
  assert.deepEqual(m.engineLocationEnv({}), {}, 'an unset key is not forwarded as empty');
});

test('G-10: askJudge hands the engine location to external-review, as run-graph does', () => {
  const body = askJudgeBody();
  assert.match(body, /\.\.\.engineLocationEnv\(process\.env\)/, 'the judge child gets QUORATE_HOME back after reviewerEnv');
  assert.match(read('scripts/run-graph.mjs'), /engineLocationEnv\(process\.env\)/, 'run-graph reads the same owner');
});

test('G-11: the judge deadline comes from the contract, not a literal', () => {
  const body = askJudgeBody();
  assert.doesNotMatch(body, /'--timeout-minutes',\s*'\d+'/, 'no literal minutes');
  assert.match(read('scripts/bench-second-opinion.mjs'), /minutes: contractMinutes\(frozen\.review, 'node_timeout_minutes'\)/,
    'the caller passes the frozen contract\'s node_timeout_minutes');
});
