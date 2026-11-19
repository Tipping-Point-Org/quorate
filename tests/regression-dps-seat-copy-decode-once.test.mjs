// G-2 of 20261110-022503-dps-remediation-4-review: an untracked file's bytes were decoded as UTF-8 twice, once by the
// fatal TextDecoder that decides whether the file is text (its string thrown away) and again by Buffer.toString for the
// credential screen. For files up to the 64 MiB call bound that is two full decodes and two full strings. The screen now
// reads the string the text check made, so each untracked file is decoded once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyIntoSeatDir } from '../scripts/io/seat-copies.mjs';

test('G-2: an untracked text file is decoded once, and a credential in it is still refused', (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-decode-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repoRoot, 'notes.txt'), 'plain scratch notes\n');
  fs.writeFileSync(path.join(repoRoot, 'creds.txt'), 'password: hunter2hunter2\n');
  let decodes = 0;
  const td = TextDecoder.prototype.decode;
  const ts = Buffer.prototype.toString;
  TextDecoder.prototype.decode = function (...a) { decodes += 1; return td.apply(this, a); };
  Buffer.prototype.toString = function (...a) { decodes += 1; return ts.apply(this, a); };
  let r;
  try {
    r = copyIntoSeatDir({ repoRoot, owner: { create() {} }, segs: ['s'], paths: ['notes.txt'], tracked: [] });
  } finally { TextDecoder.prototype.decode = td; Buffer.prototype.toString = ts; }
  assert.deepEqual(r.copied, ['notes.txt']);
  assert.equal(decodes, 1, `${decodes} UTF-8 decodes of one untracked file's bytes`);
  const c = copyIntoSeatDir({ repoRoot, owner: { create() {} }, segs: ['s'], paths: ['creds.txt'], tracked: [] });
  assert.deepEqual(c.copied, []);
  assert.match(c.refused[0].why, /looks like a credential/);
});
