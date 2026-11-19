// G-15 of 20261105-004603-ar-d1-c-review: one turn end read and parsed the same contract at least twice (the panel's
// state, then each line's context, then the retention age), every hook call. The guard now reads it once per process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

test('the stop guard reads the contract once per hook process, through one memo', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'stop-guard.mjs'), 'utf8');
  const calls = [...src.matchAll(/\bsessionContract\(/g)].length;
  assert.equal(calls, 1, `the guard calls sessionContract at ${calls} sites; each call reads and parses the contract again`);
  assert.match(src, /const contractOf = \(repoRoot\) =>[^\n]*sessionContract\(repoRoot\)/, 'the one call is the memo');
});
