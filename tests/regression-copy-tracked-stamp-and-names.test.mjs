// G-9 and G-10 of 20261122-014737-m3s7-b2-review-2 (I-2 of .claude/requests/m3-stage7-fixes.md).
// G-9: copyTrackedInto decoded `git ls-files -s -z` as UTF-8, so a tracked name whose bytes are not UTF-8 was mangled
// into U+FFFD before it could be copied, and the copy went on as if the mangled name were the file.
// G-10: a failed write of the source stamp (.quorate-source.json) was swallowed and the copy still returned ok: true,
// though a copy without its stamp reports the enclosing repository's commit as the framework's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { copyTrackedInto } from '../scripts/io/worktree.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-tracked-stamp-'));
  const src = path.join(root, 'src');
  const dest = path.join(root, 'dest');
  fs.mkdirSync(src);
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(src, 'a.txt'), 'a\n');
  execFileSync('git', ['init', '-q'], { cwd: src });
  execFileSync('git', ['add', 'a.txt'], { cwd: src });
  return { root, src, dest };
}

test('a failed stamp write fails the copy rather than returning ok: true', (t) => {
  const { root, src, dest } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // No host refuses one write on request, so the stamp's writer is handed in.
  const writeStamp = () => { throw Object.assign(new Error('EACCES: stamp'), { code: 'EACCES' }); };
  const r = copyTrackedInto(src, dest, { writeStamp });
  assert.equal(r.ok, false, 'the stamp was not written and the copy still said ok');
  assert.match(r.why, /quorate-source\.json/);
});

test('a written stamp still gives ok: true', (t) => {
  const { root, src, dest } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = copyTrackedInto(src, dest);
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(dest, '.quorate-source.json')));
});

test('a tracked name that is not UTF-8 is refused by name, never copied under a mangled one', (t) => {
  const { root, src, dest } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // No Windows or macOS file system holds a non-UTF-8 name, so the listing is handed in: a.txt, and one name whose
  // bytes are Latin-1 (0xE9), exactly what git prints for it on Linux.
  const nul = Buffer.from([0]);
  const listing = Buffer.concat([
    Buffer.from('100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0\ta.txt'), nul,
    Buffer.from('100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0\tcaf'), Buffer.from([0xe9]), Buffer.from('.txt'), nul,
  ]);
  const listFiles = () => ({ status: 0, stdout: listing, stderr: Buffer.alloc(0) });
  const r = copyTrackedInto(src, dest, { listFiles });
  assert.equal(r.ok, false, 'a non-UTF-8 tracked name was decoded lossily and the copy went on');
  assert.match(r.why, /UTF-8/);
  assert.ok(!fs.readdirSync(dest).some((n) => n.includes('�')), 'a mangled name was written');
});
