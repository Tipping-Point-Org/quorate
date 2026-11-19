// contract-glob-grammar.plan.md, stage 2b: check-intent-grant spawns the runtime and spends tokens, so it runs only when
// asked (QUORATE_LIVE=1), like check-panel. Offline, it must refuse and say how to opt in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from './helpers.mjs';

test('check-intent-grant refuses without QUORATE_LIVE=1, and says how to opt in', () => {
  const r = runScript('check-intent-grant.mjs', [], { env: { QUORATE_LIVE: '' } });
  assert.equal(r.status, 2, r.output);
  assert.match(r.stderr, /QUORATE_LIVE=1/);
});
