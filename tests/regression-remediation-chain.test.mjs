// THE ROUND CAP, COUNTED ALONG THE REMEDIATION LINKS (remediate-rebuild.plan.md stages 1 and 4; operator, 2026-10-08:
// "B: follow the links (Recommended)"). shared/remediation.md: a chain is remediation run → the follow-up review it
// minted (follows_remediation) → the remediation of that review. A remediation whose own fixes drew a new MEDIUM in its
// follow-up review counts; the third such in a row means stop patching. Any other review starts a new chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundCapState, walkChain, ROUND_CAP } from '../scripts/lib/remediation-chain.mjs';

test('the cap is three consecutive remediations whose own fixes drew a new MEDIUM', () => {
  assert.equal(ROUND_CAP, 3);
  assert.deepEqual(roundCapState([]), { consecutive: 0, capped: false });
  assert.deepEqual(roundCapState([true, true]), { consecutive: 2, capped: false });
  assert.deepEqual(roundCapState([true, true, true]), { consecutive: 3, capped: true });
  assert.deepEqual(roundCapState([true, false, true, true]), { consecutive: 2, capped: false }, 'a clean round resets');
});

// Synthetic runs: R1 remediated V1; V2 is R1's minted follow-up; R2 remediated V2; V3 follows R2; and so on.
function runs(n, { brokenAt = null } = {}) {
  const byId = {};
  for (let i = 1; i <= n; i++) {
    byId[`V${i}`] = { run_id: `V${i}`, ...(i > 1 && i !== brokenAt ? { follows_remediation: { run_id: `R${i - 1}`, run_dir: `R${i - 1}` } } : {}) };
    byId[`R${i}`] = { run_id: `R${i}`, remediates: `V${i}`, remediation_frame: { run_id: `V${i}`, run_dir: `V${i}` } };
  }
  return byId;
}

test('walking back from a reviewed run follows only minted follow-ups, oldest first', () => {
  const byId = runs(4);
  const own = new Set(['V2', 'V3', 'V4']);   // each follow-up found a MEDIUM blamed to the previous remediation
  const { links, unknown } = walkChain({ reviewedDir: 'V4', readRun: (d) => byId[d], ownMedium: (v) => own.has(v.run_id) });
  assert.equal(unknown, null);
  assert.deepEqual(links.map((l) => l.remediation_run_id), ['R1', 'R2', 'R3']);
  assert.deepEqual(links.map((l) => l.own_medium), [true, true, true]);
  assert.equal(roundCapState(links.map((l) => l.own_medium)).capped, true);
});

test('a review that is not a minted follow-up ends the chain, so the count starts again', () => {
  const byId = runs(4, { brokenAt: 3 });     // V3 is a fresh sweep, not R2's follow-up
  const { links } = walkChain({ reviewedDir: 'V4', readRun: (d) => byId[d], ownMedium: () => true });
  assert.deepEqual(links.map((l) => l.remediation_run_id), ['R3']);
  assert.equal(roundCapState(links.map((l) => l.own_medium)).capped, false);
});

test('G-1, G-13: a link that cannot be read, or a blame that cannot be answered, is unknown, not the end of the chain', () => {
  const byId = runs(4);
  delete byId.R2;
  const gone = walkChain({ reviewedDir: 'V4', readRun: (d) => byId[d] ?? null, ownMedium: () => true });
  assert.match(gone.unknown, /cannot be read as a remediation run/);
  const unsure = walkChain({ reviewedDir: 'V4', readRun: (d) => runs(4)[d], ownMedium: () => null });
  assert.match(unsure.unknown, /cannot be established/);
});
