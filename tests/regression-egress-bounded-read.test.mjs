// G-7 of 20261112-063354-hl-remediation-4-review (G-8 and G-9 its symptoms): every bounded egress read checked the size
// before and after a WHOLE-FILE read, so a file that grew between the stat and the read was allocated in full before the
// after-read check refused it; the bound held for what was returned, not for what was held. The read itself is now bounded:
// at most one byte over the limit is read, so a file found over it is refused having never been held whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { egressReadDeclared, egressReadFile } from '../scripts/io/egress-read.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const MAX = 1024;
const GROWN = 64 * MAX; // what the file holds by the time it is read: far over the bound

test('a declared document that grew after its fstat is read no further than one byte past the bound', () => {
  let whole = 0;
  let asked = 0;
  let pos = 0;
  const fakeFs = {
    openSync: () => 7,
    closeSync: () => {},
    fstatSync: () => ({ isFile: () => true, nlink: 1, size: 10 }), // small when stat'ed
    readFileSync: () => { whole += 1; return Buffer.alloc(GROWN); }, // grown when read whole
    readSync: (fd, buf, off, len) => {
      const n = Math.min(len, GROWN - pos);
      buf.fill(0x61, off, off + n); pos += n; asked += n;
      return n;
    },
  };
  assert.throws(() => egressReadDeclared('doc.md', { fs: fakeFs, maxBytes: MAX }), (e) => e.code === 'ECONFINED' && e.refusal === 'too-large');
  assert.equal(whole, 0, 'the document was read whole, so its growth was allocated in full before the bound refused it');
  assert.ok(asked <= MAX + 1, `${asked} bytes read, over the bound plus the one that shows it was crossed`);
});

test('a file named for egress that grew after its stat is read no further than one byte past the bound', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-bounded-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'prompt.md');
  fs.writeFileSync(file, 'a'.repeat(GROWN));
  const host = hostPlatform();
  let whole = 0;
  let asked = 0;
  const target = path.resolve(file);
  // Over an empty target: the platform's fs is frozen, and a proxy may not change a frozen target's members.
  const spyFs = new Proxy({}, {
    get(_, k) {
      const f = host.fs[k];
      if (k === 'lstatSync' || k === 'statSync') {
        return (p, ...rest) => {
          const st = f(p, ...rest);
          if (path.resolve(String(p)) !== target) return st;
          // The stat sees the file before it grew.
          return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: 10 });
        };
      }
      if (k === 'readFileSync') return (p, ...rest) => { if (path.resolve(String(p)) === target) whole += 1; return f(p, ...rest); };
      if (k === 'readSync') return (...a) => { const n = f(...a); asked += n; return n; };
      return f;
    },
  });
  const io = { ...host, fs: spyFs };
  assert.throws(() => egressReadFile(file, 'utf8', { io, maxBytes: MAX }), (e) => e.code === 'ECONFINED' && e.refusal === 'too-large');
  assert.equal(whole, 0, 'the file was read whole, so its growth was allocated in full before the bound refused it');
  assert.ok(asked <= MAX + 1, `${asked} bytes read, over the bound plus the one that shows it was crossed`);
});

test('a file within the bound is still read whole and returned as before', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-bounded-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'prompt.md');
  fs.writeFileSync(file, 'héllo\n');
  assert.equal(egressReadFile(file, 'utf8', { maxBytes: MAX }), 'héllo\n');
  assert.deepEqual(egressReadFile(file, null, { maxBytes: MAX }), Buffer.from('héllo\n'));
  const fakeFs = {
    openSync: () => 7, closeSync: () => {},
    fstatSync: () => ({ isFile: () => true, nlink: 1, size: 3 }),
    readSync: (() => { let done = false; return (fd, buf, off) => { if (done) return 0; done = true; buf.write('abc', off); return 3; }; })(),
  };
  assert.deepEqual(egressReadDeclared('doc.md', { fs: fakeFs, maxBytes: MAX }), Buffer.from('abc'));
});
