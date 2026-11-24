// G-5 and G-4 of 20261123-020742-m3s7-b4-remediation-3-review: the excerpt a publish finding prints masked a path only to
// the first space, so a drive path with a space in a folder name ("Jane Doe", "Program Files") printed what followed the
// space in clear; and every hit on a line re-walked every other hit's span. A path's end cannot be known from its text,
// so the masked span runs to the end of the line, and the excerpt is built from that once per line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../scripts/lib/publish.mjs';

// Built, not written out, so this file does not carry the shapes the scan refuses.
const drive = [{ name: 'windows-drive-path', regex: '(^|[^A-Za-z0-9])[A-Za-z]:[\\\\/][A-Za-z0-9_.~-]' }];
const d = (rest) => `C:${rest}`;

test('a path with a space in it is masked past the space', () => {
  for (const p of [d(['', 'Users', 'Jane Doe', 'repo'].join('\\')), d(['', 'Users', 'Ada Lovelace', 'r'].join('/'))]) {
    const hits = scanText('a.md', `see ${p} here\n`, { patterns: drive });
    assert.equal(hits.length, 1);
    const tail = p.split(' ')[1];
    assert.ok(!hits[0].excerpt.includes(tail), `the excerpt ${JSON.stringify(hits[0].excerpt)} prints ${JSON.stringify(tail)}`);
    assert.ok(hits[0].excerpt.includes('[masked]'));
    assert.ok(hits[0].excerpt.startsWith('see'), 'the context before the hit is kept');
  }
});

test('every hit on a line has its excerpt, each masking the rest of the line', () => {
  const line = `a ${d('\\x')} b ${d('\\y')} c`;
  const hits = scanText('a.md', `${line}\n`, { patterns: drive });
  assert.equal(hits.length, 2);
  for (const h of hits) {
    assert.ok(!/x|y/.test(h.excerpt.replace('[masked]', '')), `${h.excerpt} shows a masked path`);
  }
});

test('many hits on one line are scanned in linear time', () => {
  const line = Array.from({ length: 20000 }, () => d('\\x')).join(' ');
  const t0 = Date.now();
  const hits = scanText('a.md', `${line}\n`, { patterns: drive });
  assert.equal(hits.length, 20000);
  assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms for 20000 hits`);
});
