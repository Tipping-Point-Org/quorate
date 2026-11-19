// G-10 and G-11 (with its duplicate G-12) of 20261022-034225-cid1a-remediation-2-review. validateNodeSettings never
// required the parsed settings to be an object, so `[]` passed every gate and --validate-settings reported a file the
// CLI cannot use as passing. And the run directory was claimed by an existsSync check followed by a recursive mkdir, so
// two mints of one slug in one UTC second could both pass the check and share a directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, runScript, withTempDir } from './helpers.mjs';

test('settings that are not a JSON object fail --validate-settings', () => {
  withTempDir((dir) => {
    for (const [i, text] of ['[]', '7', '"x"', 'null'].entries()) {
      const f = path.join(dir, `s${i}.json`);
      fs.writeFileSync(f, text);
      const r = runScript('new-run.mjs', ['--validate-settings', f], { cwd: dir });
      assert.notEqual(r.status, 0, `${text} passed: ${r.stdout}`);
      assert.match(r.stderr, /must be a JSON object/, r.stderr);
    }
  });
});

test('the run directory is claimed by one exclusive mkdir, not a check followed by a recursive one', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/new-run.mjs'), 'utf8');
  assert.doesNotMatch(src, /fs\.mkdirSync\(path\.join\(runDir, 'nodes'\), \{ recursive: true \}\)/,
    'nodes/ created recursively, which creates the run directory without claiming it');
  assert.match(src, /fs\.mkdirSync\(runDir\);/, 'the run directory is not created exclusively');
  assert.match(src, /EEXIST/, 'a directory another mint claimed first is not refused by name');
});
