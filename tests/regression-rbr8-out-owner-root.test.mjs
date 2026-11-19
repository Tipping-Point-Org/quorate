// external-review.mjs walked --out's parent with an owner rooted at realRun, fs.realpathSync(outDir) (G-8 of
// 20261103-005954-rbr-remediation-7-review): the class G-12 of 20261102-231209-rbr-remediation-6-review fixed elsewhere, a
// root resolved through links before `confined` can see one at it, left here by a census that said realRun was never
// passed to confined. `confined` is given the sink as admitted (admitRun's directory) or as the operator named it
// (--evidence-dir, resolved lexically), so a link at the sink's own path is refused, never followed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-8: no owner in external-review.mjs is rooted at a resolved real path', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  assert.doesNotMatch(src, /confined\(\s*realRun\s*\)/, 'the --out parent walk is rooted at realRun, the sink\'s real path');
  assert.doesNotMatch(src, /confined\(\s*fs\.realpathSync/, 'an owner is rooted at realpathSync(...)');
  // Every variable assigned a real path is a name an owner must not be rooted at.
  const realNames = [...src.matchAll(/(\w+)\s*=\s*fs\.realpathSync(?:\.native)?\(/g)].map((m) => m[1]);
  for (const n of new Set(realNames)) {
    assert.doesNotMatch(src, new RegExp(`confined\\(\\s*${n}\\s*\\)`), `an owner is rooted at ${n}, a real path`);
  }
  assert.match(src, /confined\(\s*outDir\s*\)\.stat\(parentSegs\)/, 'the --out parent walk is not rooted at the sink as named');
});
