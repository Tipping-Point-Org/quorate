// THE BACKFILL PARSES EACH BENCH RESULTS FILE ONCE (G-6 of 20261026-174311-rct-remediation-review). telemetry backfill read
// and parsed a results file to check its not_a_measurement marker, then handed only its PATH to writeBenchRecord, which
// read and parsed the same file again: 2S of synchronous reads and parses for S bytes of results. writeBenchRecord takes
// the parsed results now, and the backfill passes the ones it already holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { writeBenchRecord, writeRunRecord } from '../scripts/io/telemetry-record.mjs';

test('writeBenchRecord builds from the results it is handed, without reading the file again', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-bench-once-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'run.json');
  // On disk: a measurement. Handed: the same file as already parsed, marked not a measurement. A writer that reads the
  // file again writes a record; one that uses what it is handed does not.
  fs.writeFileSync(file, JSON.stringify({ arms: [] }));
  const w = writeBenchRecord(file, { repoRoot: dir, results: { arms: [], not_a_measurement: 'handed' } });
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.equal(w.written, false, `the writer re-read the file instead of the results it was handed: ${JSON.stringify(w)}`);
});

test('telemetry backfill hands writeBenchRecord the results it already parsed', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'telemetry.mjs'), 'utf8');
  assert.match(src, /writeBenchRecord\(file, \{ repoRoot, results \}\)/);
});

// THE SAME DOUBLE PARSE FOR A RUN: the backfill parsed run.json to decide the run's kind, and writeRunRecord parsed it again.
test('writeRunRecord builds from the run it is handed, and the backfill hands it the one it parsed', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-run-once-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: 'on-disk' }));
  const w = writeRunRecord(dir, { recordKind: 'review', repoRoot: dir, run: { run_id: 'handed' } });
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8')).run_id, 'handed');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'telemetry.mjs'), 'utf8');
  assert.match(src, /writeRunRecord\(dir, \{ recordKind: kind, repoRoot, run \}\)/);
});
