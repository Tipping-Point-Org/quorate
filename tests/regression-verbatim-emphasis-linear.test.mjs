// G-18 of 20261121-233915-m3s7-b2-review: stripEmphasis searched for each opening delimiter run's closer from the start
// of the run list (runs.findIndex), so a text of R runs that never close cost O(R^2) predicate checks: delimiter-heavy
// text in a report or transcript stalled the quote check. The closer is now found from a per-character queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flat } from '../scripts/lib/verbatim.mjs';

test('G-18: 60,000 opening runs with no closer normalise in well under the quadratic time', () => {
  const text = '*a '.repeat(60_000);
  const t0 = process.hrtime.bigint();
  const out = flat(text);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(out, text.trim().toLowerCase(), 'an unclosed run keeps its marker');
  // Linear is a few milliseconds here; the quadratic scan was 1.8 billion checks. 1.5 s leaves room for a loaded machine.
  assert.ok(ms < 1500, `stripEmphasis took ${ms.toFixed(0)} ms on 60,000 unclosed runs`);
});

test('G-18: pairing is unchanged — first eligible closer of the same character, ambiguous runs kept', () => {
  assert.equal(flat('**I dispute.** and *this*'), 'i dispute. and this');
  assert.equal(flat('__init__ stays'), '__init__ stays');
  assert.equal(flat('snake_case_name'), 'snake_case_name');
  // Run 0 pairs with run 5, the first that can close; run 3 then pairs with run 8.
  assert.equal(flat('*a *b* c*'), 'a b c', 'each opener takes the first closer left after the opener');
  assert.equal(flat('*a* b*'), 'a b*', 'a closer used once is not used again');
  assert.equal(flat('`code` and _em_'), 'code and em');
});
