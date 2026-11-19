// Two misreadings in the stop record's grammar. G-12 of 20261024-235344-arp-remediation-2-review: asksWithOptions counted
// option-shaped lines anywhere in the message, so two status bullets above a bare question passed as its options. G-14:
// the turn-start flag was a whole argument only when unquoted, so `"--turn-start"`, which runs correctly, was reported
// absent and check-install warned of a half-declared guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksWithOptions, stopGuardDeclared } from '../scripts/lib/stop-record.mjs';

test('regression: bullets before the question are not its options', () => {
  assert.equal(asksWithOptions('Done so far:\n- fixed the lock\n- fixed the path\nShall I push?\nStop: question'), false);
  assert.equal(asksWithOptions('Done so far:\n- fixed the lock\nShall I push?\n- A. push now\n- B. wait\nStop: question'), true);
});

test('regression: a quoted --turn-start is the flag', () => {
  const settings = (c) => ({ hooks: { UserPromptSubmit: [{ hooks: [{ command: c }] }] } });
  assert.equal(stopGuardDeclared(settings('node scripts/stop-guard.mjs "--turn-start"')).turnStart, true);
  assert.equal(stopGuardDeclared(settings("node scripts/stop-guard.mjs '--turn-start'")).turnStart, true);
  assert.equal(stopGuardDeclared(settings('node scripts/stop-guard.mjs "--turn-started"')).turnStart, false);
  assert.equal(stopGuardDeclared(settings('node scripts/stop-guard.mjs "--turn-start\'')).turnStart, false, 'quotes that do not pair are not the flag');
});
