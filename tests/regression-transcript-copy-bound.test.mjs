// G-7 of 20261112-154323-hl-review-c (G-4 and G-1 its symptoms): the reduced, redacted transcript copy that claim-check
// sends to the cross-family checker was written whole, its size never compared with EGRESS_MAX_FILE_BYTES, so a transcript
// whose kept lines ran past 8 MiB produced a copy of any size, and claim-check copied it into the checker's surface.
// ARCHITECTURE A-30 (operator, 2026-11-12: "A. Bound the copy sent (Recommended)") says that copy is refused over the
// bound with its size. The raw transcript stays unbounded: only what is sent is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactedTranscriptCopy } from '../scripts/io/transcript-copy.mjs';
import { EGRESS_MAX_FILE_BYTES } from '../scripts/io/egress-read.mjs';

test('regression: a reduced transcript copy over the egress bound is refused, and no copy is left', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-transcript-bound-')));
  try {
    const src = path.join(dir, 'session.jsonl');
    // Kept lines (user text), 64 KiB each, to just past the bound once reduced.
    const line = `${JSON.stringify({ type: 'user', message: { content: 'x'.repeat(64 * 1024) } })}\n`;
    const n = Math.ceil(EGRESS_MAX_FILE_BYTES / (64 * 1024)) + 2;
    fs.writeFileSync(src, line.repeat(n));
    const out = path.join(dir, 'check');
    fs.mkdirSync(out);
    await assert.rejects(() => redactedTranscriptCopy(src, out),
      (e) => e.code === 'ECONFINED' && e.refusal === 'too-large' && /over the \d+-byte bound/.test(e.message),
      'a reduced copy over the egress bound was written for the checker');
    assert.deepEqual(fs.readdirSync(out), [], 'a refused copy, or its temporary, was left in the check directory');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('regression: a raw transcript over the bound whose reduced copy is under it is still copied', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-transcript-bound-')));
  try {
    const src = path.join(dir, 'session.jsonl');
    // Tool output is dropped by the reduction, so the raw file may be large and its copy small.
    const dropped = `${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'y'.repeat(64 * 1024) }] } })}\n`;
    const kept = `${JSON.stringify({ type: 'user', message: { content: 'kept' } })}\n`;
    fs.writeFileSync(src, dropped.repeat(Math.ceil(EGRESS_MAX_FILE_BYTES / (64 * 1024)) + 2) + kept);
    const out = path.join(dir, 'check');
    fs.mkdirSync(out);
    const record = await redactedTranscriptCopy(src, out);
    assert.ok(record.bytes_in > EGRESS_MAX_FILE_BYTES);
    assert.ok(record.bytes_out <= EGRESS_MAX_FILE_BYTES);
    assert.equal(record.lines, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
