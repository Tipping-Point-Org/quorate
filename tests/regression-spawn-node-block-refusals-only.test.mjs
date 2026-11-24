// G-7 of 20261123-011514-m3s7-b4-remediation-2-review (I-9 of m3-stage7-fixes.md, engine-entry-1): every catch that sends a
// failure to blockBeforeLaunch turned any exception, an unexpected I/O or programming error included, into a policy
// refusal recorded as BLOCKED. A-30's refusal classes (lib/egress-read.mjs refusalClass) leave an 'other' failure to the
// caller to re-throw, so it reaches the last-resort flush and is recorded as the crash it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');

test('every catch that blocks before launch re-throws a failure that is not a refusal or an absence', () => {
  const catches = [...src.matchAll(/catch \(e\) \{([^\n]*?)blockBeforeLaunch\(/g)];
  assert.ok(catches.length >= 3, `expected the three pre-launch catches, found ${catches.length}`);
  for (const m of catches) {
    assert.match(m[1], /if \(!refusedOrAbsent\(e\)\) throw e;/, `a catch blocks on any exception: ${m[0]}`);
  }
});
