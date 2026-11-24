// G-12 of 20261122-154951-m3s7-b3-remediation-4-review (panel-codex-arch, panel-codex-security): the intent sandbox
// floor's link scan, firstLinkLeaving, tested only isSymbolicLink(), so a regular file with a second name (a hard link
// onto an implementation file) passed as an ordinary file and its content reached the intent node. A hard link has no
// target to resolve, so a multi-named regular file beneath the floor is reported as a link that may leave it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as scope from '../scripts/lib/finding-scope.mjs';
import { makeLink } from './helpers.mjs';

const R = path.resolve('/virtual/floor');
const at = (...p) => path.join(R, ...p);

/** path -> 'dir' | 'file' | { nlink }: a regular file with that many names. */
function fakeIo(tree) {
  const node = (p) => tree[path.resolve(p)];
  return { fs: {
    readFileSync() { throw new Error('not read by this function'); },
    readdirSync: (d) => Object.keys(tree).filter((p) => path.dirname(p) === path.resolve(d)).map((p) => path.basename(p)),
    lstatSync: (p) => { const n = node(p);
      return { isSymbolicLink: () => false, isDirectory: () => n === 'dir', isFile: () => n !== 'dir',
        nlink: typeof n === 'object' ? n.nlink : 1 }; },
    realpathSync: (p) => path.resolve(p),
  } };
}

test('G-12: a hard-linked file beneath the floor is reported, however deep', () => {
  const io = fakeIo({ [at('docs')]: 'dir', [at('docs', 'a.md')]: 'file', [at('docs', 'deep')]: 'dir',
    [at('docs', 'deep', 'impl.md')]: { nlink: 2 } });
  assert.equal(scope.firstLinkLeaving(at('docs'), io), 'deep/impl.md');
});

test('G-12: single-named files leave nothing', () => {
  const io = fakeIo({ [at('docs')]: 'dir', [at('docs', 'a.md')]: 'file', [at('docs', 'b.md')]: { nlink: 1 } });
  assert.equal(scope.firstLinkLeaving(at('docs'), io), null);
});

test('G-12: a real hard link is found on this host', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-floor-hl-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const floor = path.join(base, 'floor');
  fs.mkdirSync(floor);
  fs.writeFileSync(path.join(base, 'impl.mjs'), 'export const secret = 1;\n');
  if (!makeLink(t, { type: 'hard', target: path.join(base, 'impl.mjs'), at: path.join(floor, 'impl.md') })) return;
  const host = { fs: { readFileSync: fs.readFileSync, readdirSync: fs.readdirSync, lstatSync: fs.lstatSync, realpathSync: fs.realpathSync } };
  assert.equal(scope.firstLinkLeaving(floor, host), 'impl.md');
});
