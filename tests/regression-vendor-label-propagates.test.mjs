// G-15 of 20261122-002915-m3s7-b2-remediation-review. vendorLabel's comment said the old fallback, which swallowed any
// failure to read the adapter table into `{}`, was removed; the code still did exactly that, so a broken or unreadable
// reviewers.json printed the raw id to the model instead of failing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vendorLabel } from '../scripts/lib/review-prompts.mjs';

const ioReading = (readFileSync) => ({ fs: { readFileSync } });

test('an unreadable adapter table fails vendorLabel rather than printing the raw id', () => {
  const io = ioReading(() => { throw new Error('EIO: table unreadable'); });
  assert.throws(() => vendorLabel('codex', null, io), /EIO: table unreadable/);
});

test('an unparseable adapter table fails vendorLabel', () => {
  const io = ioReading(() => '{ not json');
  assert.throws(() => vendorLabel('codex', null, io), SyntaxError);
});

test('a readable table still yields the declared label, and an undeclared id is used verbatim', () => {
  const io = ioReading(() => JSON.stringify({ reviewers: { codex: { cmd: 'codex', label: 'Codex' } } }));
  assert.equal(vendorLabel('codex', null, io), 'Codex');
  assert.equal(vendorLabel('other', null, io), 'other');
});
