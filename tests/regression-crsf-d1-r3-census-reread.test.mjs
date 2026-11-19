// G-12 of 20261105-181450-crsf-d1-remediation-2-review: the CHAIN-BROKEN census rereads an admitted run through readRun,
// which turns every failure into null, and skipped that run with no trace, so the census could miss the newest prior
// remediation and read as complete. An admitted run whose run.json cannot be read now joins `censusUnread`, which is named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'remediate.mjs'), 'utf8');

test('G-12: an admitted run the census cannot reread is named, not skipped', () => {
  const at = SRC.indexOf('const r = readRun(a.dir);');
  assert.ok(at > 0, 'the census rereads the admitted run');
  const after = SRC.slice(at, at + 400);
  assert.match(after, /if \(!r\) \{ censusUnread\.push\(/, 'a null reread is pushed to censusUnread');
});
