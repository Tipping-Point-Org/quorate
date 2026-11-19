// A-30'S REFUSAL-CLASS RULE HAS ONE OWNER (G-28 of 20261116-221234-m2-9a-high-2; ARCHITECTURE.md §2 A-1, §4 A-30).
// run-graph defined its own classifier (refusedOrAbsent) and wrote "not started (a required input)" at five sites,
// spawn-node had another (causeOf) that worded an absence "refused (ENOENT)", and new-run caught ECONFINED only, so an
// absent contract snapshot threw out of the mint. lib/egress-read.mjs, which owns refusalWords, now owns the class, the
// cause sentence and the outcome words; every site reaches them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import * as lib from '../scripts/lib/egress-read.mjs';
import * as io from '../scripts/io/egress-read.mjs';

const src = (p) => fs.readFileSync(path.join(REPO_ROOT, ...p.split('/')), 'utf8');
const err = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

test('the owner classifies a refusal, an absence, and any other failure', () => {
  assert.equal(lib.refusalClass(err('ECONFINED', { refusal: 'link' })), 'refused');
  assert.equal(lib.refusalClass(err('ENOENT')), 'absent');
  assert.equal(lib.refusalClass(err('EACCES')), 'other');
  assert.equal(lib.refusalClass(null), 'other');
  assert.equal(lib.refusedOrAbsent(err('ENOENT')), true);
  assert.equal(lib.refusedOrAbsent(err('EIO')), false);
  assert.equal(io.refusedOrAbsent, lib.refusedOrAbsent, 'the host re-export is the same function');
});

test('the cause sentence says an absence as an absence, never as a refusal', () => {
  assert.equal(lib.refusalCause(err('ECONFINED', { refusal: 'link' })), 'a link or junction stands there');
  assert.equal(lib.refusalCause(err('ENOENT')), 'nothing stands there');
  assert.doesNotMatch(lib.refusalCause(err('ENOENT')), /refused/);
  assert.equal(lib.refusalCause(err('EACCES')), 'a file that could not be read (EACCES)');
  assert.equal(lib.REQUIRED_NOT_STARTED, 'not started (a required input)');
});

test('run-graph, spawn-node and new-run hold no copy of the rule', () => {
  const rg = src('scripts/run-graph.mjs');
  assert.doesNotMatch(rg, /const refusedOrAbsent = /, 'run-graph defines its own classifier');
  assert.doesNotMatch(rg, /not started \(a required input\)/, 'run-graph restates the outcome words');
  const sn = src('scripts/spawn-node.mjs');
  assert.doesNotMatch(sn, /const causeOf = /, 'spawn-node defines its own cause words');
  assert.doesNotMatch(sn, /refused \(\$\{e\?\.code/);
  const nr = src('scripts/new-run.mjs');
  assert.doesNotMatch(nr, /if \(e\?\.code !== 'ECONFINED'\) throw e;\s*die\(`the intent canary's contract snapshot/,
    "new-run's canary snapshot catch handles a refusal but not an absence");
});
