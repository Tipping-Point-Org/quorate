// Remediation 20261112-061652-hl-remediation-4, of review 20261112-054852-hl-remediation-3-review. Driven on real files.
//   G-2: the transcript claim-check sends was checked, and copied, from its own folder, so a junction in a higher folder of
//   an in-repository transcript was followed; both are now rooted at the repository, as the draft is.
//   G-6: egressReadFile bounded a file by its stat, then read it separately, so a file that grew between the two was read
//   past the bound; the bytes read are now checked too.
//   G-8: egressReadDeclared read a declared document whole with no bound; it is now refused over the same bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { egressReadFile, egressReadDeclared } from '../scripts/io/egress-read.mjs';
import { SEAT_COPY_MAX_FILE_BYTES } from '../scripts/io/seat-copies.mjs';
import { redactedTranscriptCopy } from '../scripts/io/transcript-copy.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const tmp = (t, p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('G-2: a transcript below a junction in a higher folder of the repository is refused by its copy', async (t) => {
  const repo = tmp(t, 'hl4-repo-');
  const outside = tmp(t, 'hl4-outside-');
  fs.mkdirSync(path.join(outside, 'real', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'real', 'deep', 's.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'x' } })}\n`);
  fs.symlinkSync(path.join(outside, 'real'), path.join(repo, 'j'), process.platform === 'win32' ? 'junction' : 'dir');
  const out = path.join(repo, 'check');
  fs.mkdirSync(out);
  await assert.rejects(() => redactedTranscriptCopy(path.join(repo, 'j', 'deep', 's.jsonl'), out, { repoRoot: repo }),
    (e) => e.code === 'ECONFINED', 'a junction above the transcript\'s own folder was followed');
  // An in-repository transcript with no link on its way is copied.
  fs.mkdirSync(path.join(repo, 'logs'));
  fs.writeFileSync(path.join(repo, 'logs', 's.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'y' } })}\n`);
  const rec = await redactedTranscriptCopy(path.join(repo, 'logs', 's.jsonl'), out, { repoRoot: repo });
  assert.equal(rec.lines, 1);
});

test('G-6: a file that grows between the size check and the read is refused by the bytes read', (t) => {
  const d = tmp(t, 'hl4-grow-');
  const f = path.join(d, 'p.md');
  fs.writeFileSync(f, Buffer.alloc(64, 0x61));
  const host = hostPlatform();
  // The stat sees the small file; the read sees it grown past the bound.
  const grow = () => fs.writeFileSync(f, Buffer.alloc(200, 0x61));
  // A plain wrapper (the platform's fs is frozen, so a Proxy may not change what it returns).
  const fsWrap = {};
  for (const k of Object.keys(host.fs)) {
    const v = host.fs[k];
    fsWrap[k] = typeof v !== 'function' ? v
      : (k === 'readFileSync' || k === 'openSync') ? (...a) => { grow(); return v.apply(host.fs, a); }
      : v.bind(host.fs);
  }
  const io = { ...host, fs: fsWrap };
  assert.throws(() => egressReadFile(f, 'utf8', { io, maxBytes: 100 }),
    // Seen past the bound by no more than one byte (G-7 of 20261112-063354-hl-remediation-4-review): the grown file is
    // refused without being read whole, so its size here is what the bounded read held, not the 200 bytes on disk.
    (e) => e.code === 'ECONFINED' && e.refusal === 'too-large' && e.size > 100 && e.size <= 101, 'a file grown past the bound was read');
  fs.writeFileSync(f, 'small\n');
  assert.equal(egressReadFile(f, 'utf8', { maxBytes: 100 }), 'small\n');
});

//   G-5: the egress owner imported its bound from seat-copies.mjs, which imports the owner: a cycle in which the generic
//   boundary knew one client's policy. The owner now holds the bound and the seat copy takes it from there.
test('G-5: the egress owner holds its own bound and imports nothing from the seat copy, which takes the same bound', async () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'io', 'egress-read.mjs'), 'utf8');
  assert.doesNotMatch(src, /from '\.\/seat-copies\.mjs'/, 'the egress owner imports from seat-copies.mjs, which imports it');
  const owner = await import('../scripts/io/egress-read.mjs');
  assert.equal(owner.EGRESS_MAX_FILE_BYTES, SEAT_COPY_MAX_FILE_BYTES, 'the seat copy and the owner disagree on the bound');
});

test('G-8: a declared document over the bound is refused with its size; one at the bound is read', (t) => {
  const d = tmp(t, 'hl4-declared-');
  const big = path.join(d, 'big.md');
  fs.writeFileSync(big, Buffer.alloc(SEAT_COPY_MAX_FILE_BYTES + 1, 0x61));
  assert.throws(() => egressReadDeclared(big), (e) => e.code === 'ECONFINED' && e.refusal === 'too-large'
    && e.size === SEAT_COPY_MAX_FILE_BYTES + 1, 'a declared document over the bound was read whole');
  const ok = path.join(d, 'ok.md');
  fs.writeFileSync(ok, Buffer.alloc(SEAT_COPY_MAX_FILE_BYTES, 0x61));
  assert.equal(egressReadDeclared(ok).length, SEAT_COPY_MAX_FILE_BYTES);
});
