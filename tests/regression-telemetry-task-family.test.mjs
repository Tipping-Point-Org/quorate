// G-16 and G-18 of 20261025-222928-tel-remediation-3-review: a check task and a bench task were given family null, while
// shared/telemetry.md says every task carries a family string, `unknown` when none can be determined. A null family is
// neither a family nor the declared fallback, so a reader grouping by family met a third value the contract does not name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunRecord, buildBenchRecord, checkEntry, UNKNOWN_FAMILY } from '../scripts/lib/telemetry-record.mjs';

test('a pre-flight check task carries the unknown family, never null', () => {
  assert.equal(checkEntry('test', { status: 'PASS' }).family, UNKNOWN_FAMILY);
  const rec = buildRunRecord({ kind: 'review', checks: { results: [{ check: 'build', status: 'PASS' }] },
    fmtBaseline: { fmt_check: { outcome: 'pass' } }, fullChecks: [{ results: { test: { outcome: 'pass' } } }] });
  for (const t of rec.tasks) assert.equal(t.family, UNKNOWN_FAMILY, `${t.id} has family ${t.family}`);
});

test('every bench task carries the unknown family, never null', () => {
  const rec = buildBenchRecord({ results: {
    runs: [{ seed: 's1', usage: { 'security-audit': { input_tokens: 1 } }, costs: { 'security-audit': 0.1 } }],
    unscored_spend: [{ seed: 's2', costs: { 'arch-review': 0.2 } }],
    seeds: [{ seed: 's3', spent: { node: 'second-opinion', second_opinion_usd: 0.3, forge_usd: 0.4 } }],
  } });
  assert.ok(rec.tasks.length >= 4, JSON.stringify(rec.tasks));
  for (const t of rec.tasks) assert.equal(t.family, UNKNOWN_FAMILY, `${t.id} has family ${t.family}`);
});
