// G-5 of 20261105-154708-crsf-remediation-5-review: readStopEvents gathered every event of every retained session and
// sorted them only after, with no cap, so with retention off (session_record_retention_days 0) the read grew without
// bound. The operator's amendment (contract-runtime-and-session-files.plan.md stage 3, 2026-11-05: "Bound it
// (Recommended)") caps the read at the newest events, and a summary over more than the cap says it covers only those.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as stopLog from '../scripts/io/stop-log.mjs';

const { appendStopEvent, readStopEvents } = stopLog;
const STOP_READ_MAX_EVENTS = stopLog.STOP_READ_MAX_EVENTS;

const dirs = () => ({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'stopcap-home-')), repo: fs.mkdtempSync(path.join(os.tmpdir(), 'stopcap-repo-')) });
const clean = ({ home, repo }) => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); };

test('G-5: the read holds at most the cap, the newest events across sessions, in order, and counts what it left out', () => {
  const d = dirs();
  try {
    // Interleaved across three sessions, so the newest are not one session's.
    for (let i = 0; i < 12; i++) appendStopEvent(d.repo, { at: i + 1, event: 'start', session: `s${i % 3}` }, { home: d.home });
    const r = readStopEvents(d.repo, { home: d.home, maxEvents: 5 });
    assert.deepEqual(r.events.map((e) => e.at), [8, 9, 10, 11, 12], 'the newest five, oldest first');
    assert.equal(r.dropped, 7, 'the older events left out are counted');
    assert.equal(r.maxEvents, 5);
  } finally { clean(d); }
});

test('G-5: under the cap nothing is dropped', () => {
  const d = dirs();
  try {
    for (let i = 0; i < 4; i++) appendStopEvent(d.repo, { at: i + 1, event: 'start', session: 's' }, { home: d.home });
    const r = readStopEvents(d.repo, { home: d.home, maxEvents: 5 });
    assert.deepEqual(r.events.map((e) => e.at), [1, 2, 3, 4]);
    assert.equal(r.dropped, 0);
  } finally { clean(d); }
});

test('G-5: the default read is capped, by a declared whole number', () => {
  assert.ok(Number.isInteger(STOP_READ_MAX_EVENTS) && STOP_READ_MAX_EVENTS > 0, String(STOP_READ_MAX_EVENTS));
  const d = dirs();
  try {
    appendStopEvent(d.repo, { at: 1, event: 'start', session: 's' }, { home: d.home });
    assert.equal(readStopEvents(d.repo, { home: d.home }).maxEvents, STOP_READ_MAX_EVENTS);
  } finally { clean(d); }
});

test('G-5: shared/session-rules.md states the cap', () => {
  const rules = fs.readFileSync(new URL('../shared/session-rules.md', import.meta.url), 'utf8');
  assert.ok(rules.includes(STOP_READ_MAX_EVENTS.toLocaleString('en-US')), `the cap ${STOP_READ_MAX_EVENTS} is not stated`);
});
