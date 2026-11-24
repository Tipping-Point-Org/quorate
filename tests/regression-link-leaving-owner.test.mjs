// THE ONE OWNER OF "DOES ANYTHING BELOW THIS DIRECTORY LEAD OUT" (link-leaving-owner.plan.md stage 1; design LL-D1 B, LL-D3
// A). The three --add-dir walks each carried part of the rule, and each fix reached one and missed its siblings (G-12 of
// 20261122-154951-m3s7-b3-remediation-4-review: a hard link passed the new walk; G-7 of
// 20261122-164811-m3s7-b3-remediation-5-review: the hard-link rule restated inline). Driven on real links, each kind the
// platform refuses skipped by name through makeLink.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as scope from '../scripts/lib/finding-scope.mjs';
import { makeLink } from './helpers.mjs';

const host = { fs };
const fresh = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q-lead-out-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'floor');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 's');
  return { root, dir, outside };
};

test('a directory of plain files and an inward link leads nowhere', (t) => {
  const { dir } = fresh(t);
  if (!makeLink(t, { target: path.join(dir, 'a.txt'), at: path.join(dir, 'sub', 'alias.txt'), type: 'file', fallback: { dir: path.join(dir, 'sub') } })) return;
  assert.equal(scope.firstLeadingOut(dir, undefined, host), null);
});

test('a symbolic link out is found, however deep, as kind "link"', (t) => {
  const { dir, outside } = fresh(t);
  if (!makeLink(t, { target: path.join(outside, 'secret.txt'), at: path.join(dir, 'sub', 'leak.txt'), type: 'file', fallback: { dir: outside } })) return;
  assert.deepEqual(scope.firstLeadingOut(dir, undefined, host), { path: 'sub/leak.txt', kind: 'link' });
});

test('a directory junction out is found as kind "link"', { skip: process.platform !== 'win32' && 'a junction is a Windows link' }, (t) => {
  const { dir, outside } = fresh(t);
  if (!makeLink(t, { target: outside, at: path.join(dir, 'j'), type: 'junction' })) return;
  assert.deepEqual(scope.firstLeadingOut(dir, undefined, host), { path: 'j', kind: 'link' });
});

test('a hard-linked file leads out, in every mode, through hardLinkReason', (t) => {
  const { dir, outside } = fresh(t);
  if (!makeLink(t, { target: path.join(outside, 'secret.txt'), at: path.join(dir, 'sub', 'same.txt'), type: 'hard' })) return;
  const hit = { path: 'sub/same.txt', kind: 'hard-link' };
  assert.deepEqual(scope.firstLeadingOut(dir, undefined, host), hit);
  assert.deepEqual(scope.firstLeadingOut(dir, { into: outside }, host), hit, 'firstLinkInto lacked the hard-link rule (G-8)');
  assert.deepEqual(scope.firstLeadingOut(dir, { onto: outside }, host), hit, 'firstLinkOnto lacked the hard-link rule (G-8)');
  assert.equal(scope.firstLinkInto(dir, outside, host), 'sub/same.txt');
  assert.equal(scope.firstLinkOnto(dir, outside, host), 'sub/same.txt');
});

test('a dangling link leads out: its target cannot be shown inside', (t) => {
  const { dir, root } = fresh(t);
  const gone = path.join(root, 'gone');
  fs.mkdirSync(gone);
  if (!makeLink(t, { target: gone, at: path.join(dir, 'd'), type: 'dir', fallback: { dir: gone } })) return;
  fs.rmdirSync(gone);
  assert.deepEqual(scope.firstLeadingOut(dir, undefined, host), { path: 'd', kind: 'dangling' });
});

test('into: a link into the forbidden root is "into"; one elsewhere outside is not', (t) => {
  const { dir, root, outside } = fresh(t);
  const other = path.join(root, 'other');
  fs.mkdirSync(other);
  if (!makeLink(t, { target: other, at: path.join(dir, 'o'), type: 'dir', fallback: { dir: other } })) return;
  assert.equal(scope.firstLeadingOut(dir, { into: outside }, host), null, 'a link to an unrelated directory is not "into"');
  if (!makeLink(t, { target: outside, at: path.join(dir, 'in'), type: 'dir', fallback: { dir: outside } })) return;
  assert.deepEqual(scope.firstLeadingOut(dir, { into: outside }, host), { path: 'in', kind: 'into' });
});

test('onto: a link onto a directory containing the source root is "onto"', (t) => {
  const { dir, root, outside } = fresh(t);
  const src = path.join(outside, 'src');
  fs.mkdirSync(src);
  if (!makeLink(t, { target: outside, at: path.join(dir, 'up'), type: 'dir', fallback: { dir: outside } })) return;
  assert.deepEqual(scope.firstLeadingOut(dir, { onto: src }, host), { path: 'up', kind: 'onto' });
  assert.ok(root);
});

test('an entry that cannot be read leads out (LL-D3 A); an unlistable root throws', () => {
  const R = path.resolve('/virtual/floor');
  const io = { fs: {
    readFileSync() { throw new Error('not read by this function'); },
    realpathSync: (p) => path.resolve(p),
    readdirSync: (d) => {
      if (path.resolve(d) === R) return ['locked', 'ok.txt'];
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    },
    lstatSync: (p) => {
      if (path.basename(p) === 'ok.txt') return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true, nlink: 1 };
      return { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false, nlink: 2 };
    },
  } };
  assert.deepEqual(scope.firstLeadingOut(R, undefined, io), { path: 'locked', kind: 'unreadable' });
  const noLstat = { fs: { ...io.fs, readdirSync: () => ['x'], lstatSync: () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } } };
  assert.deepEqual(scope.firstLeadingOut(R, undefined, noLstat), { path: 'x', kind: 'unreadable' });
  const noRoot = { fs: { ...io.fs, readdirSync: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } } };
  assert.throws(() => scope.firstLeadingOut(R, undefined, noRoot), /EACCES/);
});
