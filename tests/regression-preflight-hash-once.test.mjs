// Found while planning the G-10 fix (settled with the operator 2026-09-25): the pre-flight input hash
// was computed TWICE per run — by run-graph to decide whether to reuse, then again by run-checks to
// key the entry it writes. The second walk-and-hash of every declared input was the smaller problem.
// The larger: run-checks hashed AFTER the checks finished, minutes later, so a tree that moved while
// they ran had its results cached under a state they never fully saw. The hash taken before the checks
// names the tree they started from; it is passed down, and run-checks computes its own only when run
// on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ARGV_SPECS } from '../scripts/lib/argv-specs.mjs';

const S = path.join(import.meta.dirname, '..', 'scripts');
const read = (f) => fs.readFileSync(path.join(S, f), 'utf8');

test('both spawners hand run-checks the hash they already computed', () => {
  // preflight passes it in the spawn itself; run-graph builds it just above, in runPreflight.
  const pf = read('preflight.mjs').match(/spawnSync\('node', \[path\.join\(scriptsDir, 'run-checks\.mjs'\)[^\]]*\]/);
  assert.ok(pf, 'preflight spawns run-checks');
  assert.match(pf[0], /'--input-hash'/, 'preflight passes the hash down');
  const g = read('run-graph.mjs');
  const fn = g.slice(g.indexOf('const runPreflight = '), g.indexOf('\n};\n', g.indexOf('const runPreflight = ')));
  assert.match(fn, /'--input-hash'/, 'run-graph passes the hash down');
  assert.match(g, /runPreflight\(decision\.reason, hash \? \{ hash, inferred, files: relFiles \?\? null \} : null\)/,
    'from the reuse decision that computed it, its file list in the same value');
});

// G-3 of 20261114-061035-m2-7b-remediation-4-review: runPreflight took the hash from `known` and the file list from a
// module-level variable each caller set separately, so the pair recorded in run.json was one only by convention. The
// list now travels in `known` with its hash, and run.json's two fields are written from that one value.
test('G-3: the hash and the file list it was taken over reach runPreflight as one value', () => {
  const g = read('run-graph.mjs');
  assert.doesNotMatch(g, /hashedInputFiles/, 'a module-level list still travels apart from its hash');
  const fn = g.slice(g.indexOf('const runPreflight = '), g.indexOf('\n};\n', g.indexOf('const runPreflight = ')));
  assert.match(fn, /runJson\.checks_input_files = known\.files \?\? null; runJson\.checks_input_files_sha256 = known\.hash;/,
    'run.json\'s list and hash are not written from the same value');
  assert.match(g, /if \(h\.hash\) known = \{ hash: h\.hash, inferred: h\.inferred, files: h\.relFiles \?\? null \};/,
    '--preflight always does not pass the list with its hash');
});

test('run-checks uses a passed hash, and hashes only when run on its own', () => {
  const src = read('run-checks.mjs');
  assert.equal(ARGV_SPECS['run-checks'].options['input-hash'], 'string');
  assert.match(src, /args\.inputHash = v\['input-hash'\]/);
  // Since G-10 of 20261114-032609-m2-7b-remediation-review: the passed hash first, the local one only in its else, both
  // before the checks run, and the inputs hashed again after them before an entry is written.
  const guard = src.indexOf("String(args.inputHash ?? '')");
  const fallback = src.indexOf('startHash = hashInputs()');
  const checks = src.indexOf('await runDeclaredChecks(');
  assert.ok(guard > -1 && fallback > guard && fallback - guard < 600, 'the local hash is the fallback, not the default');
  assert.ok(fallback < checks, 'the local hash is taken before the checks run');
  assert.match(src, /const endHash = hashInputs\(\)\.hash;\s*if \(endHash !== hash\)/, 'the inputs are hashed again after the checks');
});
