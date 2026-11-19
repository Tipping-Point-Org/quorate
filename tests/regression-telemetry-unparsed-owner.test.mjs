// G-6 and G-19 of 20261105-013235-ar-d1-c-remediation-review: the I/O writers appended `journal_unparsed_lines` and
// `unparsed_lines` after the pure builders returned, so the record's shape had a second owner (A-1), and
// shared/telemetry.md, the owner of the format, documented neither field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildClaimCheckRecord, buildSuiteRecord } from '../scripts/lib/telemetry-record.mjs';
import { REPO_ROOT } from './helpers.mjs';

test('G-6: the pure builders shape the unparsed-line counts', () => {
  assert.equal(buildClaimCheckRecord({ journalUnparsed: 2 }).journal_unparsed_lines, 2);
  assert.equal(buildClaimCheckRecord({}).journal_unparsed_lines, null, 'not counted is null, never 0');
  assert.equal(buildSuiteRecord({ unparsedLines: 3 }).unparsed_lines, 3);
  assert.equal(buildSuiteRecord({}).unparsed_lines, null);
  const io = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'telemetry-record.mjs'), 'utf8');
  assert.doesNotMatch(io, /\b(journal_)?unparsed_lines\s*:/, 'the writer still adds a field the builder owns');
});

test('G-19: shared/telemetry.md documents both fields', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'telemetry.md'), 'utf8');
  assert.match(doc, /`journal_unparsed_lines`/);
  assert.match(doc, /`unparsed_lines`/);
});
