// G-7 (and its symptom G-6) of 20261022-025041-cid1a-remediation-review: the mint's check of reviewers.json's probe
// minutes caught the minutes owner's refusal and threw it away, then restated the bound in its own words ("at most
// 2147483647 ms", NaN shown as null). The refusal at mint must be the owner's: it names the key, the value and the bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterErrors, probeDefaultsErrors } from '../scripts/lib/reviewers.mjs';
import { minutes, MINUTES } from '../scripts/lib/check-timeout.mjs';

const KEY = 'reviewers.probe_timeout_minutes';
const ownerSays = (v) => { try { minutes(KEY, v); } catch (e) { return e.message; } throw new Error(`${v} was accepted`); };

test('an adapter\'s malformed probe minutes are refused at mint in the owner\'s words', () => {
  // A finite value above the maximum: the registry had no `max`, so this was NaN (G-18 of 20261022-034225-cid1a-remediation-2-review).
  assert.ok(Number.isFinite(MINUTES[KEY].max + 1), 'the over-maximum case is not a finite value');
  for (const bad of ['abc', MINUTES[KEY].max + 1, Number.NaN]) {
    const errs = adapterErrors('x', { argv: ['x'], probe_timeout_minutes: bad }).filter((e) => /probe_timeout/.test(e));
    assert.equal(errs.length, 1, JSON.stringify(errs));
    assert.ok(errs[0].includes(ownerSays(bad)), `${errs[0]} does not carry the owner's refusal`);
  }
});

test('probe_defaults\' malformed probe minutes are refused in the owner\'s words', () => {
  const errs = probeDefaultsErrors({ probe_timeout_minutes: Number.NaN, version_timeout_seconds: 30, check_margin_seconds: 30 });
  assert.equal(errs.length, 1, JSON.stringify(errs));
  assert.ok(errs[0].includes(ownerSays(Number.NaN)), errs[0]);
  assert.doesNotMatch(errs[0], /got null/, 'NaN rendered as null is a second owner\'s vocabulary');
});
