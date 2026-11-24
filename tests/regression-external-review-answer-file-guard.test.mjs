// G-7 of 20261122-044843-m3s7-b3-remediation-review (I-6 of .claude/requests/m3-stage7-fixes.md): with no evidence sink,
// external-review read the schemaless answer file as `existsSync(f) ? readFileSync(f) : ''`, unguarded, so a directory
// (EISDIR) or an unreadable file (EACCES) at the answer path threw past every structured emitter. The sink branch
// beside it already returned '' on any failure; the two branches of one reader must refuse alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('readAnswerFile guards its no-sink read the way its sink read is guarded', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const fn = src.match(/const readAnswerFile = \(f\) => \{([\s\S]*?)\n\};/);
  assert.ok(fn, 'readAnswerFile was not found');
  const body = fn[1];
  const reads = [...body.matchAll(/readFileSync\(/g)];
  assert.ok(reads.length >= 1, `the no-sink branch no longer reads the file:\n${body}`);
  for (const line of body.split('\n').filter((l) => /readFileSync\(/.test(l))) {
    assert.match(line, /\btry\s*\{[^}]*readFileSync\([^)]*\)[^}]*\}\s*catch\b/,
      `an unguarded readFileSync throws EISDIR or EACCES before the envelope:\n${line}`);
  }
});

test('every declaredReviewers call in external-review is guarded, as check-reviewers guards its own (G-6)', () => {
  // G-6 of 20261122-044843-m3s7-b3-remediation-review: the live read with no --run-dir was unguarded, so an unreadable or
  // invalid live contract escaped as an unstructured exception instead of the tool's own failure.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const calls = src.split('\n').filter((l) => /\bdeclaredReviewers\(\{/.test(l));
  assert.ok(calls.length >= 1, 'no declaredReviewers call was found');
  for (const line of calls) {
    assert.match(line, /\btry\s*\{[^}]*declaredReviewers\(/, `an unguarded declaredReviewers call:\n${line}`);
    assert.match(line, /catch\s*\(e\)\s*\{\s*die\(/, `a declaredReviewers failure is not said through die():\n${line}`);
  }
});
