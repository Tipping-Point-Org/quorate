// G-13 of 20261029-190658-rdr-delivery (panel-codex-code): isWithin compared paths case-sensitively after normalising,
// so on a case-insensitive filesystem two spellings of one folder were judged apart: a --cwd, request or run path spelled
// in another case was refused, or granted an extra directory it already had. The case rule is the platform's
// (caseInsensitiveFs), so the pure function takes it as an option and the host binding supplies it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import * as pure from '../scripts/lib/finding-scope.mjs';
import * as host from '../scripts/io/finding-scope.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const parent = path.resolve(os.tmpdir(), 'Quorate-Run');
const child = path.join(parent.toUpperCase(), 'nodes');

test('G-13: a child spelled in another case is within its parent where the filesystem folds case', () => {
  assert.equal(pure.isWithin(parent, child, { caseInsensitive: true }), true, 'folded, one folder');
  assert.equal(pure.isWithin(parent, child), false, 'unfolded by default: two spellings are two folders');
  assert.equal(pure.isWithin(parent, path.join(parent, 'nodes'), { caseInsensitive: true }), true, 'the same spelling still within');
  assert.equal(pure.isWithin(parent, `${parent}-other`, { caseInsensitive: true }), false, 'a sibling sharing a prefix is not within');
});

test('G-13: the host binding folds exactly where the platform says the filesystem does', () => {
  assert.equal(host.isWithin(parent, child), hostPlatform().caseInsensitiveFs);
});
