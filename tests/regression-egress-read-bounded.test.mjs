// G-8 of 20261112-073408-hl-remediation-5-review (G-9 its symptom): the egress owner's whole-file read,
// egress().read, had no size limit, so a caller sending its content (the adjudication excerpt to every judge, a
// decision's request to every seat) bypassed ARCHITECTURE A-30's 8 MiB bound on a file that leaves the machine. The bound
// is now applied at the owner: a file over it is refused with its size, refusal 'too-large'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { egress } from '../scripts/lib/egress-read.mjs';
import { readExcerpt } from '../scripts/lib/excerpt.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const EIGHT_MIB = 8 * 1024 * 1024;

function withBigFile(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'egress-bound-')));
  try {
    fs.writeFileSync(path.join(root, 'big.txt'), Buffer.alloc(EIGHT_MIB + 1, 0x61));
    fs.writeFileSync(path.join(root, 'small.txt'), 'line one\nline two\n');
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('regression: the egress owner\'s whole-file read refuses a file over 8 MiB', () => {
  withBigFile((root) => {
    const own = egress({ root, io: hostPlatform() });
    assert.throws(() => own.read(['big.txt'], 'utf8'), (e) => e.code === 'ECONFINED' && e.refusal === 'too-large',
      'a file over the bound on what leaves the machine was read whole');
    assert.equal(own.read(['small.txt'], 'utf8'), 'line one\nline two\n', 'a file under the bound is still read');
  });
});

// G-9 of 20261112-154323-hl-review-c: read() checked the stat's size, then read the WHOLE file and only afterwards
// compared its length, so a file that grew between the stat and the read was held whole before it was refused. The stat
// is faked small here (the file having grown after it), and the whole-file read is watched: it must never run.
test('regression: a file that grew past the bound after the stat is refused without being read whole', () => {
  withBigFile((root) => {
    const host = hostPlatform();
    const big = path.join(root, 'big.txt');
    const wholeReads = [];
    const target = host.fs;
    const fsProxy = {};
    for (const k of Object.keys(target)) fsProxy[k] = typeof target[k] === 'function' ? target[k].bind(target) : target[k];
    for (const prop of ['lstatSync', 'statSync']) {
      fsProxy[prop] = (p, ...rest) => {
        const st = target[prop](p, ...rest);
        if (path.resolve(String(p)) !== big) return st;
        return new Proxy(st, { get: (s, k) => (k === 'size' ? 10 : (typeof s[k] === 'function' ? s[k].bind(s) : s[k])) });
      };
    }
    fsProxy.readFileSync = (p, ...rest) => { if (path.resolve(String(p)) === big) wholeReads.push(p); return target.readFileSync(p, ...rest); };
    const own = egress({ root, io: { ...host, fs: fsProxy } });
    assert.throws(() => own.read(['big.txt'], 'utf8'), (e) => e.code === 'ECONFINED' && e.refusal === 'too-large',
      'a file that grew past the bound was not refused');
    assert.deepEqual(wholeReads, [], 'the file that grew past the bound was read whole before it was refused');
  });
});

test('regression: the adjudication excerpt of a file over 8 MiB is refused, not read whole', () => {
  withBigFile((root) => {
    const r = readExcerpt({ repoRoot: root, file: 'big.txt', line: 1, io: hostPlatform() });
    assert.equal(r.ok, false, 'an excerpt was taken from a file over the bound');
    assert.match(r.why, /refused: .*over the \d+-byte bound/);
    assert.equal(readExcerpt({ repoRoot: root, file: 'small.txt', line: 1, io: hostPlatform() }).ok, true);
  });
});
