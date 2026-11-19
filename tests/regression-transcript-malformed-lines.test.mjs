// G-11 of 20261112-063354-hl-remediation-4-review: the transcript copy dropped a line it could not parse with no trace,
// so a torn or corrupt transcript was reported as a complete reduced copy and the cross-family checker judged attributions
// against a partial conversation with nothing saying so. A malformed line is now counted in the copy's record, and
// checked.md says how many the checker never saw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactedTranscriptCopy } from '../scripts/io/transcript-copy.mjs';
import { renderChecked } from '../scripts/lib/claim-check.mjs';

test('a malformed transcript line is counted in the copy\'s record, not dropped without a trace', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-transcript-malformed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'session.jsonl');
  fs.writeFileSync(src, [
    JSON.stringify({ type: 'user', message: { content: 'do 1' } }),
    '{"type":"user","message":{"content":"torn',
    JSON.stringify({ type: 'user', message: { content: 'after the tear' } }),
    'not json at all',
  ].join('\n') + '\n');
  const out = path.join(dir, 'check');
  fs.mkdirSync(out);
  const record = await redactedTranscriptCopy(src, out);
  assert.equal(record.malformed, 2, 'the two lines that could not be parsed are not counted');
  assert.equal(record.lines, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'transcript.json'), 'utf8')).malformed, 2, 'transcript.json does not record them');
});

test('checked.md says how many transcript lines the checker never saw', () => {
  const check = { family: 'cross', setting: 'cross-family', arm: {}, transcript: { sent: true, to: 'codex', bytes: 10, redactions: 0, malformed: 2 } };
  const checked = { ok: true, errors: [], summary: 'checked', claims: [], not_checked: [] };
  const md = renderChecked(checked, { check });
  assert.match(md, /2 line\(s\) of the transcript could not be parsed and were not sent/, 'checked.md is silent about the malformed lines');
  const clean = renderChecked(checked, { check: { ...check, transcript: { ...check.transcript, malformed: 0 } } });
  assert.doesNotMatch(clean, /could not be parsed/);
});
