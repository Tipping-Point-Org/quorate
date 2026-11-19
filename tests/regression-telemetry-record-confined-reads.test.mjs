// G-2 of 20261030-153323-ciss-s7-remediation-2-review: writeRunRecord read run.json, checks.json, finding-groups.json, the
// reconcile payload, gate.json, queue.json and every node status with a raw readFileSync, so a link standing below a run
// was followed and another directory's files were recorded as the run's (ARCHITECTURE.md A-30). They go through the
// run's owner: a link is refused, and the record is a note, never built from the linked files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeRunRecord } from '../scripts/io/telemetry-record.mjs';

const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tel-confined-'));
  const run = path.join(base, 'run');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(run); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: 'r1' }));
  fs.writeFileSync(path.join(run, 'gate.json'), JSON.stringify({ gate: 'PASS' }));
  fs.writeFileSync(path.join(outside, 'lens.status.json'), JSON.stringify({ node: 'lens', state: 'done' }));
  return { base, run, outside };
}

test('G-2: a run with no link below it gets its record', (t) => {
  const { base, run } = fixture();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(run, 'nodes'));
  const r = writeRunRecord(run, { recordKind: 'review', repoRoot: base });
  assert.equal(r.ok, true, r.note);
});

test('G-2: a link standing at nodes/ below a run is refused, not followed into the record', (t) => {
  const { base, run, outside } = fixture();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  link(outside, path.join(run, 'nodes'));
  const r = writeRunRecord(run, { recordKind: 'review', repoRoot: base });
  assert.equal(r.ok, false, 'the linked nodes/ was followed and its status recorded as the run\'s');
  assert.match(r.note, /confined path refused/);
  assert.equal(fs.existsSync(path.join(run, 'telemetry.json')), false);
});

test('G-2: a link standing at evidence/ below a run is refused, not followed into the record', (t) => {
  const { base, run, outside } = fixture();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(outside, 'reconcile'));
  fs.writeFileSync(path.join(outside, 'reconcile', 'payload.json'), JSON.stringify({ groups: [] }));
  link(outside, path.join(run, 'evidence'));
  const r = writeRunRecord(run, { recordKind: 'review', repoRoot: base });
  assert.equal(r.ok, false, 'the linked evidence/ was followed into the record');
  assert.match(r.note, /confined path refused/);
});
