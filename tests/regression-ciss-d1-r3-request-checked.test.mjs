// regression-ciss-d1-r3-request-checked.test.mjs — G-3 of review 20261021-190234-ciss-d1-remediations-review.
//
// requestErrors, the request interpreter, had no call site: build() and conformance each wrote a request and handed it
// to an extractor unchecked, so the interpreter held only the spec's examples to the request contract. Every request
// code-index.mjs writes now passes through checkedRequest, which refuses one requestErrors finds wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../scripts/code-index.mjs', import.meta.url), 'utf8');

test('G-3: every request code-index.mjs builds is checked by requestErrors before an extractor is given it', () => {
  const built = [...src.matchAll(/const request = (\w*)\(?\{ code_index_request:/g)];
  assert.ok(built.length >= 2, `build and conformance both construct a request (found ${built.length})`);
  for (const m of built) assert.equal(m[1], 'checkedRequest', 'a request constructed without checkedRequest');
  const helper = src.match(/function checkedRequest\(request\) \{([\s\S]*?)\n\}/);
  assert.ok(helper, 'checkedRequest is defined');
  assert.match(helper[1], /requestErrors\(request\)/);
  assert.match(helper[1], /throw /, 'a wrong request is refused, not handed on');
});
