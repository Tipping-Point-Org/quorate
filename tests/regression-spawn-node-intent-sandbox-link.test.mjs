// regression-spawn-node-intent-sandbox-link.test.mjs — G-18 of 20261023-014400-rdt-delivery.
//
// An intent node's working directory is sandbox/<node-id> under the admitted run, made with mkdirSync and used as it
// stood. A junction planted there, pointing at the implementation, passed every lexical --add-dir check and started
// intent-capture with source access: the source-before-intent isolation defeated. The directory must resolve, through
// links, inside the run directory admitRun admitted, and the run directory acted on must be that admitted one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');

// REWRITTEN for run-dir-descendants.plan.md stage 2: the sandbox was made with mkdirSync, then resolved with realpath and
// checked against the run. The one owner now makes it level by level and refuses a link at sandbox/ or sandbox/<node-id>
// whatever it leads to, a link resolving inside the run included, so this holds that the sandbox comes from the owner. The
// behaviour is held end to end by regression-spawn-node-confined.test.mjs.
test('the intent sandbox is made by the one owner below the admitted run before it is used', () => {
  assert.match(src, /cwd = owner\.dir\(\[\s*'sandbox',\s*nodeId\s*\]\)/, 'the intent sandbox is not made through the owner');
  assert.match(src, /const owner = confined\(runDir\);/, 'the owner is not rooted at the admitted run directory');
});

test('spawn-node acts on the directory admitRun admitted, not the one the caller spelled', () => {
  assert.ok(/const runDir = admitted\.dir;/.test(src), 'runDir is not the admitted directory');
});
