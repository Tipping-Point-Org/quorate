// A TIMED-OUT LENS DISCARDED EVERYTHING IT PRODUCED, AND THE STATUS COULD NOT SAY IT HAD PRODUCED ANY.
//
// Observed on run 20260913-222312: arch-review wrote 17 capture files into evidence/arch-review/
// between 22:40 and 22:54 UTC and was killed at 22:55 with `stdout_bytes: 0`. It was WORKING, not
// hung, right up to the kill. The evidence survives on disk; the verdict does not.
//
// The verdict is genuinely unrecoverable and this does not pretend otherwise — a process killed
// before it emitted its envelope has no verdict to salvage, and synthesising one from partial
// captures would be the fabrication this whole system exists to refuse. What was ALSO lost, and did
// not have to be, is the distinction between the two reasons a node hits its cap:
//
//   working to the last second -> the cap is too small. Raise it.
//   produced nothing for 15 minutes -> it hung. Debug it.
//
// Both wrote exactly `timed out after N ms; process tree killed`, so the operator's next decision
// had no signal behind it. The 15 -> 30 raise that followed was argued from a hand-read of file
// timestamps in a run directory, which is not a thing a consumer will do.
//
// PROVENANCE, stated because it is weaker than the other entries fixed today: this was recorded as an
// `observed` ledger entry by the author, seen once, and it is NOT in any reconciled.md. No lens
// raised it and no reconciler confirmed it, so it carries no cross-family corroboration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { timeoutForensics } from '../scripts/lib/decisions.mjs';

const at = (iso) => Date.parse(iso);

test('a node that was still writing is distinguishable from one that hung', () => {
  const killed = at('2026-09-13T22:55:00Z');
  const working = timeoutForensics({
    files: [
      { name: 'a.log', mtimeMs: at('2026-09-13T22:40:00Z') },
      { name: 'q.log', mtimeMs: at('2026-09-13T22:54:00Z') },
    ],
    killedAtMs: killed,
  });
  assert.equal(working.files, 2);
  assert.equal(working.idle_ms, 60_000, 'one minute between the last write and the kill');
  // The OBSERVED case is exactly this one: last write 22:54, killed 22:55. The message reports the
  // gap in minutes rather than a vague 'still working', because a minute is a number the operator
  // can hold against the cap they set. The first draft of this assertion demanded the vague phrase
  // and was simply worse than the code it was checking.
  assert.match(working.why, /1 minute\(s\) before the kill/);
  assert.match(working.why, /2 evidence file\(s\)/, 'and how much work survived');

  const hung = timeoutForensics({
    files: [{ name: 'a.log', mtimeMs: at('2026-09-13T22:40:00Z') }],
    killedAtMs: killed,
  });
  assert.equal(hung.idle_ms, 900_000);
  assert.match(hung.why, /15 minute/,
    'the operator needs the idle gap in a unit they can compare against the cap they set');
});

test('a node that produced nothing at all says so', () => {
  const none = timeoutForensics({ files: [], killedAtMs: at('2026-09-13T22:55:00Z') });
  assert.equal(none.files, 0);
  assert.equal(none.idle_ms, null, 'there is no last write, so there is no idle gap to report');
  assert.match(none.why, /no evidence/i,
    'silence for the whole window is its own diagnosis and must not read as a narrow overrun');
});

test('it states plainly that the verdict is gone', () => {
  const f = timeoutForensics({
    files: [{ name: 'a.log', mtimeMs: at('2026-09-13T22:54:00Z') }],
    killedAtMs: at('2026-09-13T22:55:00Z'),
  });
  // The first draft forbade the WORD 'verdict' anywhere in the message. That is the wrong property
  // and it made the honest sentence fail: what must never happen is a claim that the verdict
  // SURVIVED, and the way to guarantee that is to say outright that it did not.
  assert.match(f.why, /no verdict to recover/,
    'a node killed before it emitted an envelope has nothing to salvage, and assembling one from '
    + 'partial captures would be the fabrication this system exists to refuse');
  assert.ok(!/(recovered|salvaged|reconstructed) (the )?(verdict|envelope)/i.test(f.why),
    'and it must never read as though one was');
});

test('the timeout path records the forensics, not only the elapsed time', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  assert.match(src, /timeoutForensics\(/,
    'spawn-node must ask the shared decision on the timeout branch. `timed out after N ms` alone '
    + 'is the same sentence for a node that worked to the last second and one that hung at minute '
    + 'one, and those need opposite responses from the operator.');
});
