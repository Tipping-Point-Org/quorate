// G-8 of 20261025-222928-tel-remediation-3-review: isSelfReview caught every error and answered "not a self-review", so a
// realpath that failed for any reason other than a missing path (EACCES, an invalid path) labelled the engine's own
// development data as production data. Absent is ENOENT only, as readJson in the same module; anything else is an error,
// and the writer that called it turns it into its note rather than a record with a guessed label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withTempDir } from './helpers.mjs';
import { isSelfReview, writeBenchRecord, readRecords } from '../scripts/io/telemetry-record.mjs';

// G-15 of 20261104-223634-ar-d1-review: readRecords wrapped isSelfReview in a bare catch defaulting to false, so the error
// it rethrows on purpose was swallowed and decision records were labelled "not a self-review" on nothing established.
test('the reader names a self-review check that failed, and builds no decision record on a guessed label', () => {
  const { records, unreadable } = readRecords('bad\0root');
  assert.ok(unreadable.some((u) => /self-review/i.test(u)), `the failed self-review check was not named: ${JSON.stringify(unreadable)}`);
  assert.equal(records.filter((r) => r.kind === 'decision').length, 0);
});

test('a repository root that does not exist is not a self-review', () => {
  withTempDir((dir) => assert.equal(isSelfReview(path.join(dir, 'gone')), false));
});

test('a repository root that cannot be resolved is an error, never "not a self-review"', () => {
  // A NUL byte fails realpath with ERR_INVALID_ARG_VALUE on every platform: a failure that is not absence.
  assert.throws(() => isSelfReview('bad\0root'), (e) => e.code !== 'ENOENT');
  withTempDir((dir) => {
    const results = path.join(dir, 'r.json');
    fs.writeFileSync(results, JSON.stringify({ runs: [] }));
    const w = writeBenchRecord(results, { repoRoot: 'bad\0root' });
    assert.equal(w.ok, false, 'a record was written with a self-review label nothing established');
    assert.match(w.note, /telemetry record not written/);
  });
});
