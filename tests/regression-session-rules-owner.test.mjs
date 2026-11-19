// autonomous-run-pauses.plan.md stage 4: what a working session may do without asking, what waits for the operator, and
// how it stops are owned by ONE document, shared/session-rules.md. The operator's rules reached sessions only through a
// memory file nothing else read, and instructions in prose "never worked or worked for a short time". So the owner is
// a file the guard's own refusal points at, QUORATE.md and CLAUDE.md point at it without restating it, and a consuming
// project's override is a profile check-install recognises.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STOP_REASONS, WAIT, guardDecision } from '../scripts/lib/stop-record.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const OWNER = 'shared/session-rules.md';

test('regression: the owner exists and states every marker the guard reads', () => {
  const text = read(OWNER);
  for (const r of [...STOP_REASONS, WAIT]) assert.ok(text.includes(`\`Stop: ${r}`), `${OWNER} states Stop: ${r}`);
  // The guard's refusal points at the file that exists.
  const d = guardDecision({ last_assistant_message: 'x', background_tasks: [] });
  assert.ok(d.reason.includes(OWNER));
});

test('regression: QUORATE.md and CLAUDE.md point at the owner and do not restate its table', () => {
  for (const doc of ['QUORATE.md', 'CLAUDE.md']) {
    const text = read(doc);
    assert.ok(text.includes(OWNER), `${doc} points at ${OWNER}`);
    assert.ok(!/\|\s*`Stop: reserved`\s*\|/.test(text), `${doc} restates the stop table instead of pointing at it`);
    // G-15 of 20261024-220920-arp-delivery: the table check alone passed while QUORATE.md restated the rules in prose
    // (G-2). These are the phrases a restatement of the owner's rules uses.
    for (const phrase of [/stops? only for a\s+named reason/i, /waits? for the operator only on/i, /approvals,\s+destructive\s+actions/i,
      // G-16 of 20261025-021243-arp-remediation-3c-review: a copy of what the record keeps is a restatement too.
      /records every turn/i]) {
      assert.ok(!phrase.test(text), `${doc} restates ${OWNER} (${phrase}) instead of pointing at it`);
    }
  }
});

test('regression: a consuming project\'s override is a profile check-install knows', () => {
  const src = read('scripts/check-install.mjs');
  const known = src.match(/const known = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(known, 'check-install\'s known profile set was not found; update this test with the code');
  assert.match(known[1], /'session-rules'/, 'check-install must know the session-rules profile, or it reports the override as matching nothing');
  assert.ok(read(OWNER).includes('.claude/quorate/session-rules.md'), `${OWNER} names the override's path`);
});
