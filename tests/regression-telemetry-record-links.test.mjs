// G-8, G-9 and G-10 of 20261105-013235-ar-d1-c-remediation-review. readRecords read each record through raw readJson,
// so a link standing below a run directory or a record folder was followed and an outside file taken as the record
// (A-30). writeSuiteRecord created and wrote .claude/suite-runs through raw calls, following a link there, and kept every
// suite record with no retention, so the folder and the report's reading of it grew with every suite run (§6).
// Junctions are used for directory links, so the tests run on Windows without privilege.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRecords, writeSuiteRecord, SUITE_RECORDS_DIR } from '../scripts/io/telemetry-record.mjs';
import { SUITE_RECORDS_KEEP } from '../scripts/lib/telemetry-record.mjs';

const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trl-')));

test('G-9: a link below a record folder is refused, never read as the record', () => {
  const dir = tmp();
  try {
    const rec = path.join(dir, '.claude', 'decisions', '20261105-100000-aaaaaa');
    fs.mkdirSync(rec, { recursive: true });
    fs.writeFileSync(path.join(rec, 'outcome.json'), JSON.stringify({ outcome: 'none', rounds: 1 }));
    const outside = path.join(dir, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'outcome.json'), JSON.stringify({ outcome: 'FORGED', rounds: 9 }));
    link(outside, path.join(rec, 'revote'));
    const { records, unreadable } = readRecords(dir, { runRoots: [] });
    assert.ok(!records.some((r) => r.outcome === 'FORGED'), 'the outside file was read as the record');
    assert.ok(unreadable.some((u) => /revote/.test(u)), `the link was not named: ${JSON.stringify(unreadable)}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-9: a run\'s telemetry.json that is a link is refused (where this host can make a file link)', (t) => {
  const dir = tmp();
  try {
    const runs = path.join(dir, 'runs'); const run = path.join(runs, '20261105-000000-x'); fs.mkdirSync(run, { recursive: true });
    const forged = path.join(dir, 'forged.json');
    fs.writeFileSync(forged, JSON.stringify({ schema_version: 1, kind: 'review', run_id: 'FORGED' }));
    try { fs.symlinkSync(forged, path.join(run, 'telemetry.json'), 'file'); } catch (e) { t.skip(`no file links here (${e.code})`); return; }
    const { records } = readRecords(dir, { runRoots: [runs] });
    assert.ok(!records.some((r) => r.run_id === 'FORGED'), 'the linked telemetry.json was read');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-9: a claim check\'s check.json that is a link is refused by its record\'s writer (where this host can make a file link)', async (t) => {
  const { writeClaimCheckRecord } = await import('../scripts/io/telemetry-record.mjs');
  const dir = tmp();
  try {
    const check = path.join(dir, '.claude', 'claim-checks', 'c1'); fs.mkdirSync(check, { recursive: true });
    const forged = path.join(dir, 'forged.json'); fs.writeFileSync(forged, JSON.stringify({ family: 'FORGED' }));
    try { fs.symlinkSync(forged, path.join(check, 'check.json'), 'file'); } catch (e) { t.skip(`no file links here (${e.code})`); return; }
    const w = writeClaimCheckRecord(check, { repoRoot: dir });
    assert.equal(w.ok, false, 'the linked check.json was read as the check\'s');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const lines = (dir) => { const f = path.join(dir, 'lines.jsonl'); fs.writeFileSync(f, ''); return f; };

test('G-8: a link at .claude/suite-runs is refused, not written through', () => {
  const dir = tmp();
  try {
    const outside = path.join(dir, 'outside'); fs.mkdirSync(outside);
    fs.mkdirSync(path.join(dir, '.claude'));
    link(outside, path.join(dir, SUITE_RECORDS_DIR));
    const w = writeSuiteRecord(dir, { linesFile: lines(dir), startedAt: '2026-11-05T00:00:00.000Z', endedAt: null, exitCode: 0 });
    assert.equal(w.ok, false, 'the record was written through the link');
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-8: suite records are bounded, the oldest removed', () => {
  const dir = tmp();
  try {
    const f = lines(dir);
    const n = SUITE_RECORDS_KEEP + 3;
    for (let i = 0; i < n; i++) {
      const at = new Date(Date.UTC(2026, 10, 5, 0, 0, i)).toISOString();
      assert.equal(writeSuiteRecord(dir, { linesFile: f, startedAt: at, endedAt: at, exitCode: 0 }).ok, true);
    }
    const kept = fs.readdirSync(path.join(dir, SUITE_RECORDS_DIR)).filter((x) => x.endsWith('.json')).sort();
    assert.equal(kept.length, SUITE_RECORDS_KEEP);
    assert.ok(!kept.includes('suite-20261105T000000000Z.json'), `the oldest was kept: ${kept[0]}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
