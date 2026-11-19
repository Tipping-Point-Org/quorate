// G-11 of 20261025-021243-arp-remediation-3c-review: listProfiles answered [] for every readdir failure, so a profile
// directory that exists but cannot be read looked like one that is absent, and check-install skipped its diagnostics
// without saying why. An absent directory is still [] (most projects have none); any other failure is raised, and
// check-install reports it (session-record-files.plan.md stage 5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listProfiles } from '../scripts/lib/project-profile.mjs';

const failing = (code) => () => { const e = new Error(code); e.code = code; throw e; };

test('regression: an absent profile directory is empty, an unreadable one is an error', () => {
  assert.deepEqual(listProfiles({ repoRoot: '/r', readdir: failing('ENOENT') }), []);
  assert.throws(() => listProfiles({ repoRoot: '/r', readdir: failing('EACCES') }), /EACCES/);
  assert.deepEqual(listProfiles({ repoRoot: '/r', readdir: () => ['b.md', 'a.md', 'x.txt'] }), ['a', 'b']);
});
