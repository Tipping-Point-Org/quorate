// G-4 of 20261114-174045-m2-pred1-review (I-1 of its intent): bench-lenses totalled a sweep's usage with
// `thinking_tokens` as a top-level field beside `output_tokens`, although the vendor's thinking tokens are
// already inside `output_tokens`. bench-admit's reader (`lensTokens`, through `readBenchResult`) sums every
// top-level `*_tokens` key, so every sweep's token figure counted thinking twice: the published 7,550,856
// for opus/medium is 330 + 98,963 + 13,558 (thinking, again) + 858,127 + 6,579,878.
//
// Pinned behaviourally: the reader on a total in the old shape, the summer's shape, and the two together.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bs from '../scripts/lib/bench-settings.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sweep = (total_usage) => ({ scores: [{ seed: 's1', caught: true }], total_usage });

test('a lens total written with thinking beside output counts thinking once', () => {
  const r = bs.readBenchResult(sweep({
    input_tokens: 1, output_tokens: 10, thinking_tokens: 4,
    cache_creation_input_tokens: 100, cache_read_input_tokens: 1000,
  }));
  assert.equal(r.ok, true);
  assert.equal(r.tokens, 1111, 'thinking is inside output_tokens and must not be added again');
});

test('bench-lenses totals usage with thinking nested, and the reader adds each token once', () => {
  assert.equal(typeof bs.sumLensUsage, 'function', 'the summer bench-lenses uses lives in the pure lib');
  const rows = [
    { usage: { a: { input_tokens: 1, output_tokens: 10, output_tokens_details: { thinking_tokens: 4 } } } },
    { usage: { b: { input_tokens: 2, output_tokens: 20, cache_read_input_tokens: 5 } } }, // no thinking field
  ];
  const t = bs.sumLensUsage(rows);
  assert.equal(t.thinking_tokens, undefined, 'no top-level thinking total beside output_tokens');
  assert.equal(t.output_tokens_details.thinking_tokens, 4, 'a record without thinking adds zero, not NaN');
  assert.equal(t.output_tokens, 30);
  assert.equal(bs.readBenchResult(sweep(t)).tokens, 1 + 2 + 10 + 20 + 5);
});

// G-10 of 20261114-195905-m2-pred1-remediation-2-review: the check matched any `sumLensUsage(` in the source, so a dead
// call, or one over no rows, passed. It is a function of the source, held below to a source with each of those mutations.
function wiringProblems(src) {
  const out = [];
  // The total is one name assigned from the summer over every spent row, scored and unscored...
  const m = src.match(/const (\w+) = sumLensUsage\(\[\.\.\.perSeedRuns, \.\.\.unscoredSpend\]\);/);
  if (!m) out.push('bench-lenses must total usage with sumLensUsage over every spent row, scored and unscored');
  // ...and that name, and nothing else, is what the result writes as its total.
  else if (!new RegExp(`\\btotal_usage: ${m[1]},`).test(src)) out.push(`the result's total_usage is not the summer's ${m[1]}`);
  if ((src.match(/\btotal_usage:/g) ?? []).length !== 1) out.push('the result writes total_usage exactly once');
  if (/thinking_tokens:\s*0/.test(src)) out.push('no second, local total with thinking at the top level');
  return out;
}

test('bench-lenses writes the total through the shared summer', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'bench-lenses.mjs'), 'utf8');
  assert.deepEqual(wiringProblems(src), []);
});

test('the wiring check refuses a dead call, a call over no rows, and a total written from elsewhere', () => {
  const good = 'const usageTotal = sumLensUsage([...perSeedRuns, ...unscoredSpend]);\nconst result = {\n  total_usage: usageTotal,\n};';
  assert.deepEqual(wiringProblems(good), []);
  const mutants = {
    'a call over no rows': good.replace('[...perSeedRuns, ...unscoredSpend]', '[]'),
    'a call over the scored seeds only': good.replace(', ...unscoredSpend', ''),
    'a dead call': good.replace('total_usage: usageTotal', 'total_usage: localTotal'),
    'the total not written': good.replace('  total_usage: usageTotal,\n', ''),
  };
  for (const [what, src] of Object.entries(mutants)) assert.notDeepEqual(wiringProblems(src), [], `${what} passed the wiring check`);
});

// G-6 and G-7 of 20261114-184441-m2-pred1-remediation-b-review: agy's usage (pinned in
// tests/regression-dps-agy-stream-json.test.mjs, cut from its real stream) carries thinking at the top level, inside
// its output_tokens, a cache_read_tokens bucket, and total_tokens, the aggregate of the others. The bench's readers
// counted that record's total twice (G-6), and its summer dropped the thinking and the cache reads (G-7).
const AGY = { input_tokens: 8110, output_tokens: 211, thinking_tokens: 192, cache_read_tokens: 7, total_tokens: 8321 };

test('a second-opinion seed in agy\'s usage shape is counted once: no aggregate, no thinking again', () => {
  assert.equal(bs.totalTokens({ seeds: [{ spent: { usage: AGY } }] }), 8110 + 211 + 7);
});

test('a lens sweep with an agy record keeps its thinking and its cache reads, and the reader counts each once', () => {
  const t = bs.sumLensUsage([{ usage: { arm: AGY, lens: { input_tokens: 1, output_tokens: 10, output_tokens_details: { thinking_tokens: 4 } } } }]);
  assert.equal(t.output_tokens_details.thinking_tokens, 192 + 4, 'agy\'s top-level thinking was dropped');
  assert.equal(t.cache_read_tokens, 7, 'agy\'s cache reads were dropped');
  assert.equal(t.total_tokens, undefined, 'an aggregate is not a bucket to total');
  assert.equal(bs.readBenchResult(sweep(t)).tokens, 8110 + 211 + 7 + 1 + 10);
});
