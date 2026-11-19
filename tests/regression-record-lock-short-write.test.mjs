// Remediation 20261114-045434-m2-7b-remediation-3, of review 20261114-042824-m2-7b-remediation-2-review.
//   G-2: the record lock wrote its holder with one writeSync whose byte count was ignored, so a short write left a
//   truncated lock, read by every later writer as held or unreadable. It writes every byte through writeAllSync now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withRecordLock } from '../scripts/io/record-lock.mjs';
import { lockContent } from '../scripts/lib/session-record.mjs';

test('G-2: a short write of the lock record is finished, not accepted as the whole record', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-reclock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = (segs) => path.join(dir, ...segs);
  const own = {
    resolve: at,
    read: (segs) => fs.readFileSync(at(segs), 'utf8'),
    dir: (segs) => fs.mkdirSync(at(segs), { recursive: true }),
    rename: (a, b) => fs.renameSync(at(a), at(b)),
    remove: (segs) => fs.rmSync(at(segs), { force: true }),
  };
  const real = fs.writeSync.bind(fs);
  let first = true;
  t.mock.method(fs, 'writeSync', (fd, data, off, len) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const o = Number.isInteger(off) ? off : 0;
    const n = first ? 1 : (Number.isInteger(len) ? len : buf.length - o);
    first = false;
    return real(fd, buf, o, n);
  });
  const expected = lockContent({ pid: process.pid, writtenAt: 0 });
  const held = withRecordLock(own, ['rec.lock'], () => fs.readFileSync(at(['rec.lock']), 'utf8'), { waitMs: 1000, probeStart: false });
  t.mock.restoreAll();
  assert.ok(held.length > 1, `the lock held ${JSON.stringify(held)}: a short write was taken as the whole record`);
  // The same record lockContent makes, apart from the moment written.
  const shape = (s) => s.replace(/"writtenAt":\d+/g, '"writtenAt":T');
  assert.equal(shape(held), shape(expected));
});
