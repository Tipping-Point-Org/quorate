// G-8 of 20261105-061926-crsf-remediation-review (four codex arms): selectAdapters checked only that the chosen runtime was
// in the adapter table, never that it serves the node role, so `review.runtime: codex` (a reviewer-only built-in) or a
// `--runtime` naming one was accepted as the node runtime, and every caller launched a reviewer's command as a node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../scripts/lib/reviewers.mjs';

const BUILTINS = {
  alpha: { cmd: 'alpha', roles: ['node'] },
  rev: { cmd: 'rev', roles: ['reviewer'] },
};
const RAW = { default_node_runtime: 'alpha' };
const pick = (o) => lib.selectAdapters({ builtins: BUILTINS, raw: RAW, ...o }).runtime;

test('G-8: a runtime that does not serve the node role is refused, from review.runtime, --runtime and the default alike', () => {
  assert.throws(() => pick({ contract: { review: { runtime: 'rev' } } }), /review\.runtime 'rev'.*node role/);
  assert.throws(() => pick({ runtimeArg: 'rev' }), /--runtime rev.*node role/);
  assert.throws(() => lib.selectAdapters({ builtins: BUILTINS, raw: { default_node_runtime: 'rev' } }).runtime, /'rev'.*node role/);
  // A contract may make an adapter node-capable by declaring it: then it is accepted.
  assert.equal(pick({ contract: { reviewers: { rev: { roles: ['node', 'reviewer'] } }, review: { runtime: 'rev' } } }), 'rev');
  assert.equal(pick({}), 'alpha');
});

test('G-8: the shipped table refuses a reviewer-only built-in as the node runtime', async () => {
  const { selectAdapters } = await import('../scripts/io/reviewers.mjs');
  assert.throws(() => selectAdapters({ contract: { review: { runtime: 'codex' } } }).runtime, /codex.*node role/);
});
