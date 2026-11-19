// G-4 of 20261105-181450-crsf-d1-remediation-2-review: claim-check's reclaimSurfaces returned on every readdirSync error,
// so a surfaces root it could not list left dead processes' source snapshots in place with nothing said. Only ENOENT is
// absence; any other error is named on stderr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'claim-check.mjs'), 'utf8');

test('G-4: reclaimSurfaces names a listing error other than ENOENT', () => {
  const at = SRC.indexOf('function reclaimSurfaces(');
  assert.ok(at > 0);
  const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
  assert.doesNotMatch(body, /readdirSync\(root\); \} catch \{ return; \}/, 'every error read as absence');
  assert.match(body, /catch \(e\) \{\s*if \(e\.code !== 'ENOENT'\) console\.error\(/, 'a non-ENOENT error is named');
});
