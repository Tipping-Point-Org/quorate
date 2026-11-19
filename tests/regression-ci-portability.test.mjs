// CI WAS RED FOR TWO WEEKS AND NOTHING LOCAL COULD SHOW IT.
//
// Every run of .github/workflows/checks.yml failed from 2026-09-23 (run 37552051536 diagnosed it,
// 2026-10-06): the suite passed on the one machine it was developed on and failed on a fresh checkout,
// on both runners. Two of the causes were not in any test but in how the tree is checked out, so they
// are pinned here, where a local run sees them:
//
//   - Windows: no .gitattributes, so core.autocrlf=true wrote CRLF and eight text-reading tests failed.
//   - Both: the offline job checked out at depth 1, and a test reads a pinned past commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('the working tree is LF on every OS, whatever core.autocrlf says', () => {
  const attrs = read('.gitattributes');
  assert.match(attrs, /^\*\s+text=auto\s+eol=lf\s*$/m,
    'without `* text=auto eol=lf`, a Windows checkout writes CRLF and the text-reading tests fail on \\r');
});

test('the offline CI job checks out full history', () => {
  const yml = read('.github/workflows/checks.yml');
  const offline = yml.slice(yml.indexOf('offline:'), yml.indexOf('secrets:'));
  assert.ok(offline.length > 0, 'checks.yml must still have an offline job before the secrets job');
  assert.match(offline, /actions\/checkout@v\d+\s*\n\s*with:\s*\n\s*fetch-depth:\s*0/,
    'a depth-1 checkout lacks the pinned commits some tests read ("fatal: bad object")');
});
