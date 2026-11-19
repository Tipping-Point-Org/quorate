// regression-below-root-cost.test.mjs — G-8 of 20261118-112631-cpi-review.
//
// belowRoot ran rootSpelling on every ancestor of the path, and each call re-ran canonicalSpelling's upward walk with a
// realpath, so one check cost O(d²) synchronous filesystem calls with no early exit on a miss; telemetry pays it once per
// archived run. A root keeps its own last name under rootSpelling, so only an ancestor carrying that name is resolved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { belowRoot } from '../scripts/lib/finding-scope.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

test('belowRoot resolves the root and no unrelated ancestor of a deep path not below it (G-8)', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-below-cost-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'home');
  const deep = path.join(base, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
  fs.mkdirSync(root);
  fs.mkdirSync(deep, { recursive: true });
  const host = hostPlatform();
  let calls = 0;
  const counted = (p) => { calls += 1; return fs.realpathSync.native(p); };
  counted.native = counted;
  const io = { ...host, fs: { ...host.fs, realpathSync: counted } };
  calls = 0;
  assert.equal(belowRoot(root, deep, io), null);
  // The root's rootSpelling and the path's canonicalSpelling: a handful, not one per ancestor level.
  assert.ok(calls <= 4, `belowRoot made ${calls} realpath calls for a miss on a ${deep.split(path.sep).length}-level path`);
  const hit = belowRoot(root, path.join(root, 'runs', 'r1'), io);
  assert.deepEqual(hit?.segs, ['runs', 'r1']);
});

// G-6 of 20261118-131040-cpi-remediation-review: the basename filter leaves every ancestor that carries the root's name,
// and each one still ran rootSpelling's own walks (canonicalSpelling's lstat per level, ancestorSpelling's existsSync up
// the part not made yet), so a path whose ancestors repeat the root's name stayed Θ(d²) in filesystem calls.
test('belowRoot stays linear in filesystem calls when every ancestor carries the root\'s name (G-6)', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-below-cost-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'x', 'home');
  fs.mkdirSync(root, { recursive: true });
  const made = path.join(base, ...Array(6).fill('home'));
  fs.mkdirSync(made, { recursive: true });
  const deep = path.join(made, ...Array(24).fill('home'));   // not made: the part every walk climbs
  const host = hostPlatform();
  let calls = 0;
  const count = (f) => { const g = (...a) => { calls += 1; return f(...a); }; return g; };
  const real = count((p) => fs.realpathSync.native(p));
  real.native = real;
  const io = { ...host, fs: { ...host.fs, realpathSync: real, existsSync: count(fs.existsSync), lstatSync: count(fs.lstatSync) } };
  calls = 0;
  assert.equal(belowRoot(root, deep, io), null);
  const levels = deep.split(path.sep).filter(Boolean).length;
  assert.ok(calls <= 6 * levels, `belowRoot made ${calls} filesystem calls on a ${levels}-level path`);
});
