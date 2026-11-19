// The stop record's grammar against shared/session-rules.md (G-7, G-9 and G-11 of 20261024-224631-arp-remediation-review).
// The marker parser took spellings the owner does not define (`Stop:done`, an ASCII hyphen before the detail); the
// options check refused a question whose two options were ordinary bullets, which nothing requires be labelled; and the
// install check counted `--turn-started` as the --turn-start flag the guard requires.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopMarker, asksWithOptions, stopGuardDeclared, STOP_REASONS, WAIT } from '../scripts/lib/stop-record.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('regression: only the marker forms the session rules define name a stop', () => {
  assert.deepEqual(stopMarker('x\nStop: done'), { reason: 'done', detail: null });
  assert.deepEqual(stopMarker('x\nStop: error — the disk is full'), { reason: 'error', detail: 'the disk is full' });
  assert.equal(stopMarker('x\nStop:done'), null, 'no space after the colon');
  assert.equal(stopMarker('x\nStop: error - the disk is full'), null, 'an ASCII hyphen is not the rules\' dash');
  assert.equal(stopMarker('x\nStop: wait-the suite'), null);
});

// G-8: which reasons need a `— <what>` is the owner's vocabulary, and the parser encodes it too. The two are bound here:
// a reason the owner writes with a detail is refused without one, and every other reason is accepted bare.
test('regression: the parser asks a detail of exactly the reasons the owner writes with one', () => {
  const owner = fs.readFileSync(path.join(ROOT, 'shared', 'session-rules.md'), 'utf8');
  for (const r of [...STOP_REASONS, WAIT]) {
    const needs = owner.includes(`\`Stop: ${r} — <`);
    assert.equal(stopMarker(`x\nStop: ${r}`) === null, needs, `Stop: ${r} ${needs ? 'needs' : 'needs no'} detail, as the owner writes it`);
    assert.notEqual(stopMarker(`x\nStop: ${r} — something`), null);
  }
});

test('regression: two plain bullet options make a question with options', () => {
  assert.equal(asksWithOptions('Which way?\n- keep the cap, cheaper\n- drop it, simpler\nSuggested: keep it.'), true);
  assert.equal(asksWithOptions('Which way?\n- only one\n'), false);
});

test('regression: --turn-start is matched as a whole argument', () => {
  const settings = (cmd) => ({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd }] }] } });
  assert.equal(stopGuardDeclared(settings('node scripts/stop-guard.mjs --turn-start')).turnStart, true);
  assert.equal(stopGuardDeclared(settings('node scripts/stop-guard.mjs --turn-started')).turnStart, false);
  assert.equal(stopGuardDeclared(settings('node scripts/stop-guard.mjs --no--turn-start')).turnStart, false);
});
