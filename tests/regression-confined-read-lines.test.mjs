// readLines copies a long line's bytes once, not once per chunk (G-7 of 20261031-013928-urr-delivery).
//
// The remainder before a newline was concatenated with every new chunk, so a newline-free record of L bytes was recopied
// L / chunkBytes times: O(L²/chunkBytes) copying through usage-report --transcripts. The bytes Buffer.concat produces are
// counted, the one place the accumulation copies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confined } from '../scripts/io/confined-path.mjs';

test('G-7 of 20261031-013928-urr-delivery: a long newline-free line is copied in linear, not quadratic, bytes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-lines-long-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const L = 64 * 1024;
  fs.writeFileSync(path.join(dir, 'f.txt'), `${'x'.repeat(L)}\nshort\n${'y'.repeat(L)}`);
  const concat = Buffer.concat;
  let copied = 0;
  Buffer.concat = (list, len) => { const b = concat(list, len); copied += b.length; return b; };
  t.after(() => { Buffer.concat = concat; });
  const got = [];
  try {
    confined(fs.realpathSync(dir)).readLines(['f.txt'], (l) => got.push(l), { chunkBytes: 64 });
  } finally { Buffer.concat = concat; }
  assert.deepEqual(got.map((l) => l.length), [L, 5, L]);
  assert.ok(got[0] === 'x'.repeat(L) && got[2] === 'y'.repeat(L));
  assert.ok(copied <= 4 * L, `readLines copied ${copied} bytes for two ${L}-byte lines`);
});

// G-7 of 20261031-022756-urr-remediation-review: the pieces of an unended line grew without bound, so one newline-free
// record of an operator-named transcript could hold the whole file in memory. Past maxLineBytes the read is refused,
// before more than that is held, naming the line; the lines before it were already handed over.
test('G-7: a line longer than maxLineBytes is refused, not held without bound', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-lines-cap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'f.txt'), `short\n${'x'.repeat(4096)}`);
  const got = [];
  assert.throws(
    () => confined(fs.realpathSync(dir)).readLines(['f.txt'], (l) => got.push(l), { chunkBytes: 64, maxLineBytes: 1024 }),
    (e) => e.code === 'ELINETOOLONG' && /line 2/.test(e.message),
  );
  assert.deepEqual(got, ['short']);
  const ok = [];
  confined(fs.realpathSync(dir)).readLines(['f.txt'], (l) => ok.push(l), { chunkBytes: 64, maxLineBytes: 4096 });
  assert.deepEqual(ok.map((l) => l.length), [5, 4096], 'a line at the limit is read');
});
