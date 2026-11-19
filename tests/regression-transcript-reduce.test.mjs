// The claim checker reads a reduced transcript (operator, 2026-10-25: "exploring the repo looks like tokens better spent
// than reading command outputs"): commands and outputs dropped, the operator's words, the assistant's text and the
// question tool's exchanges kept, and one line per file change and commit ("when such reference is found output some
// text about it. this may reduce the repo exploration"). Measured on this session: 53.4 MB to 0.87 MB, the copy's
// preparation from 3 min 23 s to about 1 s.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reduceRecord, newReduceState } from '../scripts/lib/transcript-reduce.mjs';
import { redactedTranscriptCopy } from '../scripts/io/transcript-copy.mjs';

const texts = (r) => (r?.message?.content ?? []).map((p) => p.text ?? p.type);

test('regression: text is kept, reminders and tool traffic are not', () => {
  const s = newReduceState();
  assert.deepEqual(texts(reduceRecord({ type: 'user', message: { role: 'user', content: 'yes' } }, s)), ['yes']);
  assert.equal(reduceRecord({ type: 'user', message: { content: [{ type: 'text', text: '<system-reminder>x</system-reminder>' }] } }, s), null);
  assert.equal(reduceRecord({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } }, s), null);
  assert.equal(reduceRecord({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a\nb' }] } }, s), null);
});

test('regression: the question tool\'s exchange is kept, since the operator\'s choice is a tool result', () => {
  const s = newReduceState();
  const q = reduceRecord({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [] } }] } }, s);
  assert.equal(q.message.content[0].name, 'AskUserQuestion');
  const a = reduceRecord({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'B (Recommended)' }] } }, s);
  assert.equal(a.message.content[0].type, 'tool_result');
});

test('regression: a file change and a commit leave a one-line marker', () => {
  const s = newReduceState();
  assert.deepEqual(texts(reduceRecord({ type: 'assistant', message: { content: [
    { type: 'text', text: 'Fixing it.' },
    { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: 'scripts/stop-guard.mjs', old_string: 'a', new_string: 'b' } },
    { type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: 'tests/x.test.mjs', content: 'long' } },
    { type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'git add a && git -c x commit -q -m "m"' } },
  ] } }, s)), ['Fixing it.', '[edited scripts/stop-guard.mjs]', '[wrote tests/x.test.mjs]']);
  const r = reduceRecord({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: [{ type: 'text', text: '[deploy-test 22bc39db] stop guard: a node\'s stop is never blocked\n 3 files changed' }] }] } }, s);
  assert.deepEqual(texts(r), ['[committed 22bc39db: stop guard: a node\'s stop is never blocked]']);
});

test('regression: the copy the checker reads is the reduced one, still redacted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reduce-'));
  try {
    const src = path.join(dir, 'session.jsonl');
    fs.writeFileSync(src, [
      { type: 'user', message: { role: 'user', content: 'use GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB please' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'cat big.log' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(5000) }] } },
    ].map((o) => JSON.stringify(o)).join('\n') + '\n');
    const rec = await redactedTranscriptCopy(src, dir);
    const out = fs.readFileSync(path.join(dir, 'transcript.redacted.jsonl'), 'utf8');
    assert.equal(out.trim().split('\n').length, 1, 'only the operator\'s line is kept');
    assert.ok(!out.includes('ghp_abcdef'), 'and it is redacted');
    assert.ok(rec.bytes_out < rec.bytes_in / 10);
    assert.equal(rec.reduced, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
