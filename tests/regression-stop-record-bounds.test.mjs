// stop-record-bounds-and-kill-log.plan.md stage 2 (design BI-D1 A, BI-D2 A; operator 2026-11-06). Only what a read of the
// stop record HELD was capped: with retention off it opened and parsed every file of every kept session (G-8 of
// 20261105-173030-crsf-d1-remediation-review, the operator's "Bound it too"; G-3 of
// 20261106-013812-stoplog-g8-remediation-review), and every new session's first write listed, stat'ed and judged every
// kept folder (G-1 of the same review). A read now visits the newest sessions only and says how many it left out; a write
// sweeps at most once an interval.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendStopEvent, readStopEvents, sessionDir, STOP_READ_MAX_SESSIONS, STOP_SWEEP_INTERVAL_MS,
} from '../scripts/io/stop-log.mjs';
import { stopLogPath } from '../scripts/io/stop-log.mjs';
import { makeLink } from './helpers.mjs';

function withRepo(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'srb-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'srb-repo-'));
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); });
  return { home, repo };
}
// Every file of a session's folder dated `daysAgo` days back.
const age = (dir, daysAgo) => {
  const when = new Date(Date.now() - daysAgo * 86_400_000);
  for (const n of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, n), when, when);
};

test('BI-D1: a read visits only the newest sessions by their last write, and says how many it left out', (t) => {
  const { home, repo } = withRepo(t);
  // Five sessions, s0 the oldest; retention off, so none is swept.
  for (let i = 0; i < 5; i++) {
    appendStopEvent(repo, { at: i + 1, event: 'start', session: `s${i}` }, { home, retentionDays: null });
    age(sessionDir(repo, `s${i}`, { home }), 10 - i);
  }
  const r = readStopEvents(repo, { home, maxSessions: 3 });
  assert.deepEqual(r.events.map((e) => e.session).sort(), ['s2', 's3', 's4'], 'the read did not keep to the newest sessions');
  assert.equal(r.sessionsLeftOut, 2, 'the sessions left out were not counted');
  assert.equal(r.maxSessions, 3);
});

test('BI-D1: a caller may only lower the session cap, never raise it', (t) => {
  const { home, repo } = withRepo(t);
  appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home, retentionDays: null });
  assert.equal(readStopEvents(repo, { home, maxSessions: STOP_READ_MAX_SESSIONS * 5 }).maxSessions, STOP_READ_MAX_SESSIONS);
  assert.equal(readStopEvents(repo, { home }).sessionsLeftOut, 0);
});

test('BI-D2: first writes inside one interval sweep once; one after it sweeps again', (t) => {
  const { home, repo } = withRepo(t);
  appendStopEvent(repo, { at: 1, event: 'start', session: 'a' }, { home, retentionDays: 30 });   // sweeps, marks
  appendStopEvent(repo, { at: 2, event: 'start', session: 'old' }, { home, retentionDays: 30 });
  const old = sessionDir(repo, 'old', { home });
  age(old, 40);
  appendStopEvent(repo, { at: 3, event: 'start', session: 'b' }, { home, retentionDays: 30 });
  assert.ok(fs.existsSync(old), 'a first write inside the interval swept again');
  // The interval passed: the marker is an hour and a minute old.
  fs.writeFileSync(path.join(stopLogPath(repo, { home }), '.last-sweep'), String(Date.now() - STOP_SWEEP_INTERVAL_MS - 60_000));
  appendStopEvent(repo, { at: 4, event: 'start', session: 'c' }, { home, retentionDays: 30 });
  assert.ok(!fs.existsSync(old), 'a first write after the interval did not sweep');
});

// G-6 of 20261106-061604-srb-delivery: sweepDue read the marker and replaced it with no lock, so two sessions whose first
// writes came together both saw it due, both set it and both swept. A due marker is taken under the record folder's lock:
// a session that finds that lock held (here by this live process, as another session marking it would) does not sweep.
test('G-6: a due sweep marker is taken under the record lock; a writer that finds it held does not sweep', (t) => {
  const { home, repo } = withRepo(t);
  appendStopEvent(repo, { at: 1, event: 'start', session: 'old' }, { home, retentionDays: null });
  const old = sessionDir(repo, 'old', { home });
  age(old, 40);
  const record = stopLogPath(repo, { home });
  const lock = path.join(record, '.lock');
  const held = JSON.stringify({ pid: process.pid, writtenAt: Date.now() });
  fs.writeFileSync(lock, held);
  appendStopEvent(repo, { at: 2, event: 'start', session: 'new' }, { home, retentionDays: 30, lockWaitMs: 200 });
  assert.ok(fs.existsSync(old), 'a writer swept while another held the marker\'s lock');
  assert.equal(fs.existsSync(path.join(record, '.last-sweep')), false, 'the marker was set without its lock');
  assert.equal(fs.readFileSync(lock, 'utf8'), held, "a live holder's lock was removed");
  fs.rmSync(lock);
  appendStopEvent(repo, { at: 3, event: 'start', session: 'newer' }, { home, retentionDays: 30, lockWaitMs: 200 });
  assert.ok(!fs.existsSync(old), 'with the lock free, a due first write did not sweep');
  assert.equal(fs.existsSync(lock), false, 'the marker\'s lock was left behind');
});

// G-7 of 20261106-061604-srb-delivery: the age was asked only on a session's first write, so a session still writing when
// the interval passed never swept, and the sweep waited for the next new session. The first append after the interval
// sweeps, whichever session's it is.
test('G-7: a later write of a session already started sweeps once the interval has passed', (t) => {
  const { home, repo } = withRepo(t);
  appendStopEvent(repo, { at: 1, event: 'start', session: 'a' }, { home, retentionDays: 30 });   // sweeps, marks
  appendStopEvent(repo, { at: 2, event: 'start', session: 'old' }, { home, retentionDays: 30 });
  const old = sessionDir(repo, 'old', { home });
  age(old, 40);
  fs.writeFileSync(path.join(stopLogPath(repo, { home }), '.last-sweep'), String(Date.now() - STOP_SWEEP_INTERVAL_MS - 60_000));
  appendStopEvent(repo, { at: 3, event: 'stop', session: 'a' }, { home, retentionDays: 30 });
  assert.ok(!fs.existsSync(old), "a session's later write after the interval did not sweep");
});

test('BI-D2: the sweep marker is read through the owner, a link at it refused, never followed', (t) => {
  const { home, repo } = withRepo(t);
  appendStopEvent(repo, { at: 1, event: 'start', session: 'a' }, { home, retentionDays: 30 });
  const mark = path.join(stopLogPath(repo, { home }), '.last-sweep');
  fs.rmSync(mark);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'srb-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'x'), String(Date.now()));
  if (!makeLink(t, { target: path.join(outside, 'x'), at: mark, type: 'file' })) { t.skip('no symlinks here'); return; }
  assert.throws(() => appendStopEvent(repo, { at: 2, event: 'start', session: 'b' }, { home, retentionDays: 30 }));
  assert.equal(fs.readFileSync(path.join(outside, 'x'), 'utf8').length > 0, true);
});

test('BI-D2: a first write with retention off sweeps nothing and leaves the interval to the next that would', (t) => {
  const { home, repo } = withRepo(t);
  appendStopEvent(repo, { at: 1, event: 'start', session: 'old' }, { home, retentionDays: null });
  const old = sessionDir(repo, 'old', { home });
  age(old, 40);
  assert.equal(fs.existsSync(path.join(stopLogPath(repo, { home }), '.last-sweep')), false, 'a write that cannot sweep set the marker');
  appendStopEvent(repo, { at: 2, event: 'start', session: 'new' }, { home, retentionDays: 30 });
  assert.ok(!fs.existsSync(old), 'the write that could sweep found the interval taken');
});
