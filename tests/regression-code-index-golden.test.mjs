// THE GOLDEN TABLE COVERS EVERY SHAPE, AND "COULD NOT TELL" AT EVERY SHAPE (code-index.plan.md stage 2).
//
// tests/fixtures/code-index/golden.json holds the expected answers over the fixtures beside it, derived by reading them
// by hand. These tests do not run an extractor (stages 4, 5 and 7 do): they check the table itself. Every shape has a
// sweep, every shape has an `unresolved` twin, and the nine sweeps story-pipeline's requirements name are all present by
// name. Every expected row also points at a line that exists, so a fixture edit that shifts lines fails here first.
//
// The nine names are the requirements' "Why" section, as consumer zero confirmed it on 2026-10-20. A fresh clone has no
// story-pipeline to read them from, so they are quoted here. Consumer zero checks that this list matches its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { SHAPES, OUTCOMES } from '../scripts/lib/code-index-schema.mjs';
import { sweepMatches } from '../scripts/lib/code-index-query.mjs';

const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'code-index');
const golden = JSON.parse(fs.readFileSync(path.join(FIX, 'golden.json'), 'utf8'));

const WHY = [
  '`by_model` comparisons against a locality call',
  '`"auto"` literals keyed by enclosing function',
  'modules reaching a model entry point',
  '`LLMConfig(` construction sites and their keyword sets',
  "the settings models' string fields",
  "`assert_local_allowed`'s call sites",
  '`Asset(` sites',
  'locality consumers',
  'binding sites passing a settings object where a config was expected',
];

test('every sweep names a shape and an outcome the schema knows', () => {
  for (const s of golden.sweeps) {
    assert.ok(SHAPES.includes(s.shape), `${s.name}: shape ${s.shape}`);
    assert.ok(OUTCOMES.includes(s.outcome), `${s.name}: outcome ${s.outcome}`);
    assert.ok(golden.roots[s.language], `${s.name}: language ${s.language} has no fixture root`);
    assert.ok(Array.isArray(s.expected), `${s.name}: no expected rows`);
  }
  // Matching a sweep is linear in its rows. G-25 of 20261020-043006-code-index-delivery: each expected row rescanned
  // every result row, O(E*R). Counted by reads of a row's path, which every comparison makes; in this test rather than a
  // new one, because the suite's test count is a stated fact (check-counted-facts).
  const n = 300;
  let reads = 0;
  const rows = Array.from({ length: n }, (_, i) => {
    const r = { span: { start: { line: 1, col: 0 }, end: { line: 1, col: 1 } } };
    Object.defineProperty(r, 'path', { get: () => { reads++; return `f${n - 1 - i}.py`; }, enumerable: true });
    return r;
  });
  const expected = Array.from({ length: n }, (_, i) => ({ path: `f${i}.py`, line: 1 }));
  const m = sweepMatches({ outcome: 'complete', rows }, { outcome: 'complete', expected });
  assert.ok(m.ok, `the rows were not matched: ${JSON.stringify(m.missing.slice(0, 3))}`);
  assert.ok(reads <= 4 * n, `matching ${n} expected rows against ${n} rows read a path ${reads} times`);
  // One actual row covers one expected row at most. G-16 of 20261020-051530-code-index-remediation-review: two expected
  // rows covered by the same actual row, plus an unexpected row making the totals equal, read as an exact match.
  const at = (line, extra) => ({ path: 'a.py', span: { start: { line, col: 0 }, end: { line, col: 1 } }, ...extra });
  const twice = sweepMatches({ outcome: 'complete', rows: [at(1, { callee: 'f' }), at(9, { callee: 'g' })] },
    { outcome: 'complete', expected: [{ path: 'a.py', line: 1 }, { path: 'a.py', line: 1, callee: 'f' }] });
  assert.equal(twice.ok, false, 'two expected rows were both matched by one actual row');
  // A general expected row must not take the row a specific one needs when another row satisfies it.
  const both = sweepMatches({ outcome: 'complete', rows: [at(1, { callee: 'f' }), at(1, { callee: 'g' })] },
    { outcome: 'complete', expected: [{ path: 'a.py', line: 1 }, { path: 'a.py', line: 1, callee: 'f' }] });
  assert.equal(both.ok, true, `a one-to-one matching that exists was not found: ${JSON.stringify(both.missing)}`);
});

test('every shape has a sweep that finds rows, and an unresolved twin that must not answer empty', () => {
  for (const shape of SHAPES) {
    const of = golden.sweeps.filter((s) => s.shape === shape);
    assert.ok(of.some((s) => s.expected.length > 0), `${shape} has no sweep that finds rows`);
    const twin = of.find((s) => s.outcome === 'unresolved');
    assert.ok(twin, `${shape} has no unresolved twin`);
    assert.deepEqual(twin.expected, [], `${shape}'s twin expects rows`);
  }
});

test('the nine sweeps of the requirements are all in the table, by name', () => {
  const names = new Set(golden.sweeps.filter((s) => s.source === 'why').map((s) => s.name));
  for (const n of WHY) assert.ok(names.has(n), `missing sweep: ${n}`);
});

test('every expected row points at a line that exists in its fixture', () => {
  for (const s of golden.sweeps) {
    for (const row of s.expected) {
      const file = path.join(FIX, golden.roots[s.language], row.path);
      assert.ok(fs.existsSync(file), `${s.name}: ${row.path} does not exist`);
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      assert.ok(Number.isInteger(row.line) && row.line >= 1 && row.line <= lines.length && lines[row.line - 1].trim(),
        `${s.name}: ${row.path}:${row.line} is not a line with code`);
    }
  }
});
