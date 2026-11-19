// Review 20261101-032931-ar-remediation-3-review, remediated in 20261101-040217-ar-remediation-4.
//   G-12: finalOutcome caught every read or parse error of the revote's outcome and fell back to the first talk's, so a
//         corrupt revote outcome read as the decision's earlier state (a `revote`, never `postponed`), and --pending,
//         --sample and --overrule acted on it. A missing file is the only error that means "not written yet"; any other
//         is refused, never reset (the rule spends.json is held to).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finalOutcome } from '../scripts/io/decision-run.mjs';

test('G-12: a corrupt outcome is refused, never read as the earlier one; a missing one is still "not yet"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decide-final-'));
  try {
    assert.equal(finalOutcome(dir), null, 'no outcome written yet is null');
    fs.writeFileSync(path.join(dir, 'outcome.json'), JSON.stringify({ outcome: 'revote' }));
    assert.equal(finalOutcome(dir).outcome, 'revote', 'the first talk\'s outcome when no revote was written');
    fs.mkdirSync(path.join(dir, 'revote'));
    assert.equal(finalOutcome(dir).outcome, 'revote', 'a revote directory with no outcome yet is not an outcome');
    fs.writeFileSync(path.join(dir, 'revote', 'outcome.json'), '{"outcome": "postp');
    assert.throws(() => finalOutcome(dir), /revote[\\/]outcome\.json/, 'a corrupt revote outcome fell back to the first talk\'s');
    fs.writeFileSync(path.join(dir, 'revote', 'outcome.json'), JSON.stringify({ outcome: 'postponed' }));
    fs.writeFileSync(path.join(dir, 'outcome.json'), 'not json');
    assert.equal(finalOutcome(dir).outcome, 'postponed', 'the revote\'s outcome is the decision\'s');
    fs.rmSync(path.join(dir, 'revote'), { recursive: true });
    assert.throws(() => finalOutcome(dir), /outcome\.json/, 'a corrupt first outcome read as none');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
