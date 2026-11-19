// regression-ciss-d1-r4-degraded-fail-wording.test.mjs — G-5, G-4 and G-3 of review
// 20261021-194056-ciss-d1-remediation-3-review.
//
// A §6 invariant finding is never capped, at severity or verdict (lib/decisions.mjs capVerdictKeepingInvariants), and the
// brief says so. The degraded-mode prompts still told perf-audit (its table and its description) and arch-review that
// they cannot FAIL, with no exception: the capped party declaring a cap the engine does not apply, which can suppress a
// non-waivable finding. perf-audit's table also gave a degraded basis enum without `invariant`, which the roster has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const roster = JSON.parse(read('scripts/lens-roster.json'));
const lens = (id) => roster.lenses.find((l) => l.id === id);

test('G-5/G-4/G-3: no degraded prompt says the lens cannot FAIL without the §6 invariant exception', () => {
  for (const p of ['prompts/perf-audit/PROMPT.md', 'prompts/arch-review/PROMPT.md']) {
    const text = read(p);
    // Every sentence that says the lens cannot FAIL must carry the invariant exception in the same sentence.
    const sentences = text.split(/(?<=[.|])\s+|\n\n/);
    for (const s of sentences) {
      if (/cannot\s+(?:produce|emit|return)\s+(?:a\s+)?`?FAIL/i.test(s)) {
        assert.match(s, /invariant/, `${p}: "${s.trim()}" says the lens cannot FAIL with no §6 invariant exception`);
      }
    }
  }
});

test('G-5: perf-audit\'s mode table gives the roster\'s basis enums', () => {
  const text = read('prompts/perf-audit/PROMPT.md');
  const p = lens('perf-audit');
  const row = (key) => text.split('\n').find((l) => l.startsWith(`| ${key} |`));
  assert.ok(row('declared').includes(JSON.stringify(p.allowed_basis).replace(/,/g, ', ').replace(/^/, '`').replace(/$/, '`')),
    `declared row ${row('declared')} does not give ${JSON.stringify(p.allowed_basis)}`);
  assert.ok(row('empty').includes(JSON.stringify(p.degraded_basis).replace(/,/g, ', ').replace(/^/, '`').replace(/$/, '`')),
    `empty row ${row('empty')} does not give ${JSON.stringify(p.degraded_basis)}`);
});
