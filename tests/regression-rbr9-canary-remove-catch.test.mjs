// A failure to remove the sandbox canary is said, not swallowed (G-13 of 20261103-022403-rbr-remediation-8-review;
// disk-first §6 silent_error_swallowing): new-run.mjs wrapped the removal in `catch {}`, so a canary left in the run
// directory, and the error that left it, went unreported. A canary that was never written is not an error: the owner's
// remove returns false for a missing name, so whatever it throws is a real failure.
// Source check: the removal runs inside the sandbox canary, which needs the node runtime to reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-13: new-run.mjs names a failed canary removal and the file it leaves', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  const site = src.match(/try \{ mintOwner\.remove\(\[canaryName\]\); \} catch[^\n]*/);
  assert.ok(site, 'the canary removal was not found');
  assert.doesNotMatch(site[0], /catch\s*\{\s*\}/, 'the canary removal swallows its error');
  assert.match(site[0], /catch \(e\) \{ console\.error\([^)]*canaryName[^)]*e\.message/, 'the canary removal\'s error does not name the file and the error');
});
