// Review 20261112-035452-hl-delivery, remediated in 20261112-042915-hl-remediation. No seat and no model is reached.
//   G-5: decide.mjs --revote read question.json through `confined`, which has no link-count check, so a hard-linked
//        question went to every panel seat. It is read through the egress owner and refused.
//   G-9: hardLinkWhyAt caught every stat failure and returned null, "no hard link", so a file whose link count could not
//        be read entered the intent sandbox. It fails closed.
//   G-11: the transcript copier ignored writeSync's byte count, so a short write left a silently truncated copy that was
//        renamed into place. Every byte is written or the copy fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript } from './helpers.mjs';
import { hardLinkWhyAt } from '../scripts/io/egress-read.mjs';
import { redactedTranscriptCopy } from '../scripts/io/transcript-copy.mjs';

const Q = { question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable' };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('G-5: a hard-linked question.json is refused before the revote reads it', () => {
  const dir = tmp('hl-rem-decide-');
  const outside = tmp('hl-rem-outside-');
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/decisions/\n');
    git('add', '-A'); git('commit', '-qm', 'init');
    const id = '20261112-120000-abcdef';
    const rec = path.join(dir, '.claude', 'decisions', id);
    fs.mkdirSync(rec, { recursive: true });
    const real = path.join(outside, 'secret.json');
    fs.writeFileSync(real, JSON.stringify(Q));
    fs.writeFileSync(path.join(rec, 'outcome.json'), JSON.stringify({ outcome: 'revote' }));
    fs.linkSync(real, path.join(rec, 'question.json'));
    const r = runScript('decide.mjs', ['--revote', id, '--repo-root', dir]);
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /hard link/, `a hard-linked question was not what refused the revote: ${r.output}`);
  } finally { for (const d of [dir, outside]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('G-9: a file whose link count cannot be read is refused, never taken as single-named', () => {
  const io = { fs: { statSync() { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; } } };
  const why = hardLinkWhyAt('/some/doc.md', { io });
  assert.ok(why, 'a failed stat was read as "no hard link"');
  assert.match(String(why), /EACCES/);
});

test('G-11: a short write does not leave a truncated transcript copy', async () => {
  const dir = tmp('hl-rem-tr-');
  try {
    const src = path.join(dir, 'session.jsonl');
    const lines = [];
    for (let i = 0; i < 5; i++) lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: `line number ${i} with some text` } }));
    fs.writeFileSync(src, lines.join('\n') + '\n');
    const out = path.join(dir, 'out');
    fs.mkdirSync(out);
    // A full write, for the expected bytes.
    const full = await redactedTranscriptCopy(src, out);
    const expected = fs.readFileSync(full.path);
    assert.ok(expected.length > 0, 'the fixture produced no copy to compare');
    fs.rmSync(full.path);
    // Then every write accepts at most half of what it is given, as a short write does.
    const orig = fs.writeSync;
    fs.writeSync = function (fd, data, ...rest) {
      if (typeof data === 'string') data = Buffer.from(data, rest.length && typeof rest[rest.length - 1] === 'string' ? rest[rest.length - 1] : 'utf8');
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer ?? data);
      const off = Buffer.isBuffer(data) && typeof rest[0] === 'number' ? rest[0] : 0;
      const len = Buffer.isBuffer(data) && typeof rest[1] === 'number' ? rest[1] : buf.length - off;
      const n = Math.max(1, Math.floor(len / 2));
      return orig.call(fs, fd, buf, off, n);
    };
    try { await redactedTranscriptCopy(src, out); } finally { fs.writeSync = orig; }
    assert.deepEqual(fs.readFileSync(path.join(out, 'transcript.redacted.jsonl')), expected, 'a short write left a truncated copy');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
