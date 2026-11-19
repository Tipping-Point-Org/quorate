// stop-owner-grep-state-roots.plan.md stage 2, G-9 (with G-12 as its symptom) of 20261022-200543-ciss-d1-review-2:
// ARCHITECTURE.md §1 lists the state the engine keeps outside its run directories, and the list had fallen behind the
// code: the code index's cache root and the repository locks root were missing, and others with them. This test
// enumerates the names the engine creates directly under its home, from the code that creates them, and fails when §1
// does not name one, so the list cannot fall behind again.
//
// THE INSTRUMENT, over every .mjs under scripts/ (the forms in use at 84f4310b; dated, indicative):
//   1. path.join(<home>, '<name>' ...), where <home> is quorateHome(), a `home` or `h` parameter, or
//      `opts.home ?? quorateHome()`  — reviews, arms, locks, reviewer-probes, session-runs, code-index,
//      claim-check-surfaces, cli-freshness.json;
//   2. an owner rooted at the home asked for a folder: `home.dir(['<name>'])`  — bench-repair;
//   3. decide's surfaces, named through `const H = (...names) => ['<name>', ...names]`  — decision-surfaces;
//   4. the session records' roots, named where a record is written: `contextFor(input, '<name>'`  — stops, commands;
//   5. an owner rooted at the home asked for a folder named by a file-local constant: `owner.dir([NAME])` with
//      `const NAME = '<name>'` in the same file  — stdin (G-1 of 20261110-193817-sfo-delivery: the stdin root was made
//      this way, which no pattern above matched, so §1 omitted it and this test passed).
// Its floor is the count found when it was written, so a pattern that stops matching cannot pass vacuously.
//
// WHAT IT DOES NOT CHECK (G-11 of 20261110-202954-sfo-remediation-review-c): it is a census of the shapes above, not a
// proof over every expression. A root named any other way (a computed name, a constant from another module, a receiver
// named other than `owner` or `home`) is not found, and the floor catches only the loss of a match, never a new root of an
// unmatched shape. A new shape of root-making joins the list above, with a fixture case in the G-12 test below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const FLOOR = 13;

function scriptFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...scriptFiles(p));
    else if (e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const PATTERNS = [
  /path\.join\(\s*(?:quorateHome\(\)|home|h|opts\.home \?\? quorateHome\(\))\s*,\s*'([a-z][a-z0-9.-]*)'/g,
  // Any of the owner's creating operations, the root as the first of any number of names (G-12 of
  // 20261110-202954-sfo-remediation-review-c: only a one-name `dir` was matched).
  /\bhome\.(?:dir|dirNew|create|replace)\(\['([a-z][a-z0-9-]*)'/g,
  /const H = \(\.\.\.names\) => \['([a-z][a-z0-9-]*)'/g,
  /contextFor\(input, '([a-z][a-z0-9-]*)'/g,
];
// Form 5: the constant's name, resolved through a `const <NAME> = '<name>'` in the same file.
// Any creating operation, the constant first of any number of names (G-12: `owner.dirNew([CONST, name])` was not matched).
const CONST_DIR = /\b(?:owner|home)\.(?:dir|dirNew|create|replace)\(\[([A-Z][A-Z0-9_]*)\b/g;

// The census over `[file, source]` pairs, so a fixture source can show which shapes it finds (G-11, G-12 of
// 20261110-202954-sfo-remediation-review-c).
function censusOf(sources) {
  const found = new Map();
  for (const [f, src] of sources) {
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) if (!found.has(m[1])) found.set(m[1], f);
    }
    for (const m of src.matchAll(CONST_DIR)) {
      const def = src.match(new RegExp(`\\bconst ${m[1]} = '([a-z][a-z0-9.-]*)'`));
      assert.ok(def, `${f}: owner.dir([${m[1]}]) names a constant this census cannot resolve`);
      if (!found.has(def[1])) found.set(def[1], f);
    }
  }
  return found;
}

function homeRoots() {
  return censusOf(scriptFiles(path.join(REPO_ROOT, 'scripts')).map((f) => [path.relative(REPO_ROOT, f), fs.readFileSync(f, 'utf8')]));
}

test('G-12 (20261110-202954-sfo-remediation-review-c): a root made only through dirNew, create or replace is found', () => {
  for (const op of ['dir', 'dirNew', 'create', 'replace']) {
    const found = censusOf([[`fixture-${op}.mjs`, `const ROOT_NAME = 'fixture-root';\nowner.${op}([ROOT_NAME, name]);\n`]]);
    assert.ok(found.has('fixture-root'), `a root made through owner.${op}([CONST, ...]) is invisible to the census`);
    const lit = censusOf([[`fixture-lit-${op}.mjs`, `home.${op}(['fixture-lit', name]);\n`]]);
    assert.ok(lit.has('fixture-lit'), `a root made through home.${op}(['<name>', ...]) is invisible to the census`);
  }
});

function sectionOne() {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'ARCHITECTURE.md'), 'utf8');
  const at = doc.indexOf('## 1. ');
  const end = doc.indexOf('\n## 2. ', at);
  assert.ok(at >= 0 && end > at, 'ARCHITECTURE.md §1 was not found');
  return doc.slice(at, end);
}

test('G-9: every name the census finds the engine creating under its home is named in ARCHITECTURE.md §1', () => {
  const roots = homeRoots();
  assert.ok(roots.size >= FLOOR, `the census found ${roots.size} names under the home, below its floor of ${FLOOR}: `
    + `${[...roots.keys()].join(', ')} — a pattern stopped matching`);
  const s1 = sectionOne();
  const missing = [...roots].filter(([name]) => !s1.includes(`<quorateHome>/${name}`)).map(([n, f]) => `${n} (${f})`);
  assert.deepEqual(missing, [], 'ARCHITECTURE.md §1 does not name these state roots under the engine\'s home');
});

test('G-12: the code index\'s cache root and the repository locks root are among them', () => {
  const roots = homeRoots();
  assert.ok(roots.has('code-index'), 'the census no longer finds the code index\'s cache root');
  assert.ok(roots.has('locks'), 'the census no longer finds the repository locks root');
});

test('G-1 (20261110-193817-sfo-delivery): the root of the stdin folders is among them, found through its constant', () => {
  const roots = homeRoots();
  assert.ok(roots.has('stdin'), 'the census no longer finds the root of the stdin folders (scripts/io/stdin-file.mjs)');
});
