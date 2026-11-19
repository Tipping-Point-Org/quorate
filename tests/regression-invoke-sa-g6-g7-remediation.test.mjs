// Remediation of run 20260930-021623-invoke-security-audit-g6-g7, G-2 (operator's answer: "Fix despite D1
// (Recommended)"): the child-env scrub's name pattern had no JWT or PAT marker, so a variable such as GITHUB_PAT or
// CI_JOB_JWT reached every agentic node and the project commands it runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubChildEnv } from '../scripts/lib/decisions.mjs';

test('G-2: JWT- and PAT-named variables are scrubbed from a child\'s environment', () => {
  const names = ['GITHUB_PAT', 'CI_JOB_JWT', 'CI_JOB_JWT_V2', 'PAT', 'AZDO_PAT_READ', 'jwt'];
  const { env, scrubbed } = scrubChildEnv(Object.fromEntries(names.map((n) => [n, 'x'])));
  assert.deepEqual(scrubbed.sort(), [...names].sort(), `crossed into the child: ${Object.keys(env).join(', ')}`);
});

// PAT is a delimited token, never a substring: PATH and names built on it must still reach the child, or no
// toolchain resolves.
test('G-2: PATH and other names that merely contain PAT still cross', () => {
  const names = ['PATH', 'Path', 'PATHEXT', 'PYTHONPATH', 'NODE_PATH', 'PATTERN', 'CLASSPATH'];
  const { env, scrubbed } = scrubChildEnv(Object.fromEntries(names.map((n) => [n, 'x'])));
  assert.deepEqual(scrubbed, [], `scrubbed a non-secret: ${scrubbed.join(', ')}`);
  assert.deepEqual(Object.keys(env).sort(), [...names].sort());
});
