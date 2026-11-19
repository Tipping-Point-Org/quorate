// regression-ciss-d1-r3-python-import-queue.test.mjs — G-2 of review 20261021-190234-ciss-d1-remediations-review.
//
// The Python extractor's imports_of walked a scope with list.pop(0), which shifts every remaining element: import
// discovery was quadratic in the scope's AST size, once for the module and again for every function and class. No
// bench is declared, so the claim is pinned by its mechanism: no list in the extractor is consumed from its front.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../extractors/python/extract.py', import.meta.url), 'utf8');

test('G-2: the Python extractor never consumes a list from its front', () => {
  assert.doesNotMatch(src, /\.pop\(0\)/, 'list.pop(0) is linear per call; a deque.popleft() is constant');
  assert.match(src, /todo = collections\.deque\(body\)/, 'imports_of keeps its breadth-first order through a deque');
});
