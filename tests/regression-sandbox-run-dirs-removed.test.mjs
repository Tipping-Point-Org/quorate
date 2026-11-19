// The test helper repoRunDir documented "the caller removes the returned base", and callers did not:
// 1,653 .sandbox/quorate-run-* directories had accumulated between 2026-09-21 and 2026-09-25, about
// 140 a day. The operator's rule for .sandbox (2026-09-25): unless a use is one of a set of runs whose
// content you can be sure of, it starts from a fresh directory and leaves none behind. Every call
// already made a fresh one (mkdtemp); the helper now also removes what it made when the process ends,
// so no caller can forget.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const HELPERS = pathToFileURL(path.join(import.meta.dirname, 'helpers.mjs')).href;

test('a run directory made by repoRunDir is gone once the process that made it exits', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { repoRunDir } = await import(${JSON.stringify(HELPERS)}); process.stdout.write(repoRunDir().base);`],
  { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const base = r.stdout.trim();
  assert.match(path.basename(base), /^quorate-run-/);
  assert.equal(fs.existsSync(base), false, `${base} was left behind`);
});
