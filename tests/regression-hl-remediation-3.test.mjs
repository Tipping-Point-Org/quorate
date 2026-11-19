// Remediation 20261112-052704-hl-remediation-3, of review 20261112-050334-hl-review-b.
//   G-6: egressReadFile read a caller-named file whole with no size bound, though the amended plan refuses one over 8 MiB
//   (SEAT_COPY_MAX_FILE_BYTES), and rooted its owner at the file's own folder, so a junction in a higher folder of an
//   in-repository path was followed. Driven here on real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { egressReadFile } from '../scripts/io/egress-read.mjs';
import { SEAT_COPY_MAX_FILE_BYTES } from '../scripts/io/seat-copies.mjs';
import { redactedTranscriptCopy } from '../scripts/io/transcript-copy.mjs';

const tmp = (t, p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('G-6: a named file over the 8 MiB bound is refused with its size, before it is read; one at the bound is read', (t) => {
  const d = tmp(t, 'hl3-size-');
  const big = path.join(d, 'big.md');
  fs.writeFileSync(big, Buffer.alloc(SEAT_COPY_MAX_FILE_BYTES + 1, 0x61));
  assert.throws(() => egressReadFile(big), (e) => e.code === 'ECONFINED' && e.refusal === 'too-large'
    && e.message.includes(String(SEAT_COPY_MAX_FILE_BYTES + 1)), 'a file over the bound was read');
  const ok = path.join(d, 'ok.md');
  fs.writeFileSync(ok, Buffer.alloc(SEAT_COPY_MAX_FILE_BYTES, 0x61));
  assert.equal(egressReadFile(ok).length, SEAT_COPY_MAX_FILE_BYTES);
});

test('G-6: an in-repository path is checked from the repository root, so a junction in a higher folder is refused', (t) => {
  const repo = tmp(t, 'hl3-repo-');
  const outside = tmp(t, 'hl3-outside-');
  fs.mkdirSync(path.join(outside, 'real', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'real', 'deep', 'q.json'), '{"outside":true}\n');
  fs.symlinkSync(path.join(outside, 'real'), path.join(repo, 'j'), process.platform === 'win32' ? 'junction' : 'dir');
  const named = path.join(repo, 'j', 'deep', 'q.json');
  assert.throws(() => egressReadFile(named, 'utf8', { repoRoot: repo }), (e) => e.code === 'ECONFINED',
    'a junction above the file\'s own folder was followed');
  // A path outside the repository is still read from its own folder.
  fs.writeFileSync(path.join(outside, 'p.md'), 'prompt\n');
  assert.equal(egressReadFile(path.join(outside, 'p.md'), 'utf8', { repoRoot: repo }), 'prompt\n');
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.writeFileSync(path.join(repo, 'docs', 'r.md'), 'mine\n');
  assert.equal(egressReadFile(path.join(repo, 'docs', 'r.md'), 'utf8', { repoRoot: repo }), 'mine\n');
});

//   G-8 (G-7 its symptom): redactedTranscriptCopy made one blocking fs.writeSync per kept line, so a transcript of tens of
//   thousands of lines made as many syscalls. It now gathers lines into bounded chunks, each written every byte.
test('G-8: the transcript copy writes in bounded chunks, not once per kept line, and loses no line', async (t) => {
  const d = tmp(t, 'hl3-transcript-');
  const src = path.join(d, 'session.jsonl');
  const N = 2000;
  const lines = [];
  for (let i = 0; i < N; i++) lines.push(JSON.stringify({ type: 'user', message: { content: `line ${i}` } }));
  fs.writeFileSync(src, `${lines.join('\n')}\n`);
  const out = path.join(d, 'check');
  fs.mkdirSync(out);
  const calls = t.mock.method(fs, 'writeSync');
  const record = await redactedTranscriptCopy(src, out);
  const n = calls.mock.callCount();
  calls.mock.restore();
  assert.ok(n < 10, `${n} writeSync calls for ${N} kept lines: one per line`);
  assert.equal(record.lines, N);
  const copy = fs.readFileSync(record.path, 'utf8').trimEnd().split('\n');
  assert.equal(copy.length, N, 'a line was lost');
  assert.match(copy[N - 1], /line 1999/);
});
