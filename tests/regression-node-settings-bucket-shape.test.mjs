// G-7 of 20261122-154951-m3s7-b3-remediation-4-review (panel-codex-contract): validateNodeSettings iterated the allow,
// deny and ask buckets without requiring arrays, so a number threw an uncontrolled TypeError and a string was walked
// one character at a time, instead of the settings-shape refusal --validate-settings promises. The same holds for a
// `permissions` value that is not an object.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, withTempDir } from './helpers.mjs';

test('a permission bucket that is not an array is refused by name, not thrown on (G-7)', () => {
  withTempDir((dir) => {
    const cases = [
      [{ permissions: { allow: 7 } }, /permissions\.allow must be an array/],
      [{ permissions: { deny: 'Read' } }, /permissions\.deny must be an array/],
      [{ permissions: { ask: {} } }, /permissions\.ask must be an array/],
      [{ permissions: 'Read' }, /permissions must be a JSON object/],
      [{ permissions: [] }, /permissions must be a JSON object/],
    ];
    for (const [i, [value, why]] of cases.entries()) {
      const f = path.join(dir, `s${i}.json`);
      fs.writeFileSync(f, JSON.stringify(value));
      const r = runScript('new-run.mjs', ['--validate-settings', f], { cwd: dir });
      assert.notEqual(r.status, 0, `${JSON.stringify(value)} passed: ${r.stdout}`);
      assert.doesNotMatch(r.stderr, /TypeError/, r.stderr);
      assert.match(r.stderr, why, r.stderr);
    }
  });
});

test('well-formed buckets still pass (G-7)', () => {
  withTempDir((dir) => {
    const f = path.join(dir, 'ok.json');
    fs.writeFileSync(f, JSON.stringify({ permissions: { allow: ['Read'], deny: [], ask: ['Bash(git push:*)'] } }));
    const r = runScript('new-run.mjs', ['--validate-settings', f], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
  });
});
