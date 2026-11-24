// REQUEST RECOVERY WRITES WHERE IT IS ALLOWED TO, AND STOPS AT A BOUND (G-23, G-22 of 20261121-193516-m3s7-b1-review).
// renderRequestDoc wrote <repo>/.claude/requests/<slug>.inferred.md through writeTracked, which confines every write below
// the run directory, so the write threw and recovery ended the run FAILED instead of producing the request (G-23, HIGH).
// Its collision probe incremented a suffix with no bound (G-22). Recovery runs only through the real runtime, which the
// suite never starts (tests/regression-recovery-spawn-guard), so this holds the function's own text: its write goes
// through an owner of the requests directory, redacted, by exclusive create, in a loop with a declared bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'scripts', 'run-graph.mjs'), 'utf8');

function body(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end);
}

test('the inferred request is not written through the run-confined writer (G-23)', () => {
  const b = body('renderRequestDoc');
  assert.doesNotMatch(b, /writeTracked\(/, 'writeTracked writes only below the run; the requests directory is outside it');
  assert.match(b, /confined\(dir\)/, 'the write goes through an owner of the resolved requests directory');
  assert.match(b, /\.create\(\[name\], text\)/, 'an exclusive create, so a persisted request is never overwritten');
  assert.match(b, /const text = redactClaim\(body\)/, 'the tracked request is redacted, as every tracked write is');
});

test('the collision probe has a declared bound (G-22)', () => {
  const b = body('renderRequestDoc');
  assert.doesNotMatch(b, /fs\.existsSync\(finalFile\)/, 'the unbounded existsSync probe is gone');
  assert.match(b, /n <= INFERRED_REQUEST_MAX_SUFFIX/);
  const m = src.match(/^const INFERRED_REQUEST_MAX_SUFFIX = (\d+);/m);
  assert.ok(m && Number(m[1]) > 1, 'the bound is a module constant');
  assert.ok(src.indexOf('const INFERRED_REQUEST_MAX_SUFFIX') < src.indexOf('function renderRequestDoc('),
    'declared before the function, so no call can meet it in its temporal dead zone');
});
