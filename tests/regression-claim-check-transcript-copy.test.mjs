// claim-check-cross-family.plan.md stage 3 (operator, 2026-10-18: "The whole transcript"). Under
// `claim_check_transcript: cross-family` the cross-family checker reads the session's transcript, and what it reads is a
// copy in the check directory passed through the secret shapes every tracked write uses, never the original. A session
// transcript runs to hundreds of megabytes (287,614,300 bytes on 2026-10-18), so the copy streams line by line, and it
// records what it did: bytes in and out, lines, and how many secrets it redacted.
//
// Since 2026-10-25 the copy is REDUCED (operator: "Yes" to the reduced transcript, "exploring the repo looks like tokens
// better spent than reading command outputs"): commands and their outputs are dropped before redaction
// (lib/transcript-reduce.mjs), so a tool result is not copied, and the secret this test plants is in a line kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('the copy redacts a secret shape in what it keeps, drops tool output, and records its counts', async () => {
  const mod = await import('../scripts/io/transcript-copy.mjs').catch(() => null);
  assert.ok(mod?.redactedTranscriptCopy, 'scripts/io/transcript-copy.mjs has no redactedTranscriptCopy');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-transcript-'));
  try {
    const src = path.join(dir, 'session.jsonl');
    const token = `ghp_${'a'.repeat(36)}`;
    const lines = [
      JSON.stringify({ type: 'user', message: { content: 'do 1' } }),
      JSON.stringify({ type: 'user', message: { content: `my GITHUB_TOKEN=${token}` } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'long command output' }] } }),
      JSON.stringify({ type: 'user', message: { content: 'no secret here' } }),
    ];
    fs.writeFileSync(src, `${lines.join('\n')}\n`);
    const out = path.join(dir, 'check');
    fs.mkdirSync(out);
    const record = await mod.redactedTranscriptCopy(src, out);
    const copy = fs.readFileSync(record.path, 'utf8');
    assert.equal(path.dirname(record.path), out, 'the copy is not in the check directory');
    assert.ok(!copy.includes(token), 'the secret reached the copy');
    assert.match(copy, /\[redacted: GitHub token\]/);
    assert.equal(copy.trimEnd().split('\n').length, 3, 'a text line was lost, or the tool output was kept');
    assert.ok(!copy.includes('long command output'), 'a tool result reached the copy');
    assert.match(copy, /no secret here/);
    assert.equal(record.redactions, 1);
    assert.equal(record.lines, 3);
    assert.equal(record.lines_in, 4);
    assert.equal(record.bytes_in, fs.statSync(src).size);
    assert.equal(record.bytes_out, fs.statSync(record.path).size);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'transcript.json'), 'utf8')), record);
    assert.equal(fs.readFileSync(src, 'utf8').includes(token), true, 'the original was modified');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a transcript that cannot be read is refused, and leaves no copy behind', async () => {
  const mod = await import('../scripts/io/transcript-copy.mjs').catch(() => null);
  assert.ok(mod?.redactedTranscriptCopy, 'scripts/io/transcript-copy.mjs has no redactedTranscriptCopy');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-transcript-'));
  try {
    await assert.rejects(() => mod.redactedTranscriptCopy(path.join(dir, 'missing.jsonl'), dir));
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
