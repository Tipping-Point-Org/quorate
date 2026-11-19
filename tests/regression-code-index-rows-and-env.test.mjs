// AN ANSWER FILE'S ROWS AND AN EXTRACTOR'S ENVIRONMENT ARE CHECKED ENTRY BY ENTRY (G-31, G-28 of
// 20261020-061457-code-index-full-sweep).
//
// - G-31: answersFileErrors checked only that `expected` was a list, so a null row passed and sweepMatches then crashed
//   on e.path instead of the file being refused.
// - G-28: the secret-shape check ran on a declared prefix's text (GITHUB_ for GITHUB_*), which is not secret-shaped, and
//   extractorEnvFor then forwarded every variable under it, GITHUB_TOKEN included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answersFileErrors } from '../scripts/lib/code-index-query.mjs';
import { extractorEnvFor } from '../scripts/lib/code-index-cache.mjs';

const file = (expected) => ({ pinned_commit: 'abcdef1', sweeps: [{ name: 's', shape: 'calls', args: { callee: 'm.f' }, method: 'grep', outcome: 'complete', expected }] });

test('G-31: an answer file whose expected rows are not objects naming a path is refused', () => {
  assert.deepEqual(answersFileErrors(file([{ path: 'a.py', line: 1 }])), []);
  for (const row of [null, 'a.py', 7, [], {}, { path: '' }]) {
    assert.ok(answersFileErrors(file([row])).some((e) => /expected\[0\]/.test(e)), `${JSON.stringify(row)} passed`);
  }
});

test('G-28: a declared prefix forwards no secret-shaped variable under it, and an exact name is forwarded as declared', () => {
  const source = { PATH: '/bin', GITHUB_TOKEN: 't', GITHUB_API_KEY: 'k', GITHUB_WORKSPACE: '/w', MY_TOOL_HOME: '/h' };
  const env = extractorEnvFor(source, { basics: ['PATH'], declared: ['GITHUB_*', 'MY_TOOL_HOME'], caseInsensitiveEnv: false });
  assert.deepEqual(Object.keys(env).sort(), ['GITHUB_WORKSPACE', 'MY_TOOL_HOME', 'PATH']);
});
