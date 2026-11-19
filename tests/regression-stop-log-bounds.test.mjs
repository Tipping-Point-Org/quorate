// The stop record's bound and its place (G-6 and G-5 of 20261024-224631-arp-remediation-review). The size check limited
// only the file the next line was appended to, never the line: one event whose session or detail ran long was appended
// whole and took the file past its cap. And the record's path took any engine home, so a home set inside the project
// wrote the personal record into the repository it must never reach.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendStopEvent, readStopEvents, stopLogPath, STOP_READ_MAX_EVENTS } from '../scripts/io/stop-log.mjs';

test('regression: one oversized event does not take the record past its cap', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try {
    const maxBytes = 512;
    const file = appendStopEvent(repo, { at: 1, event: 'end', kind: 'named', reason: 'error', detail: 'x'.repeat(5000), session: 's' }, { home, maxBytes });
    assert.ok(fs.statSync(file).size <= maxBytes, `the file holds ${fs.statSync(file).size} bytes, past the cap of ${maxBytes}`);
    const { events } = readStopEvents(repo, { home });
    assert.equal(events.length, 1, 'the event is still recorded, cut');
    assert.equal(events[0].event, 'end');
    assert.equal(events[0].at, 1);
    assert.equal(events[0].truncated, true, 'and says it was cut');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// The lock (G-5 and G-6 of 20261024-235344-arp-remediation-2-review; G-6 of 20261025-021243-arp-remediation-3c-review).
// It was judged stale by its age, so two waiters could both clear it and the second delete the first's fresh lock. Since
// session-record-files.plan.md stage 1 the lock names its owner, a pid and a start time: a live owner's lock is waited
// on and then refused, never cleared, and only a lock whose owner is gone is reclaimed.
const platformWith = (alive, started) => ({ proc: { isAlive: () => alive, startedAt: () => started } });

test('regression: a lock held by a live owner is waited on, then refused, and nothing is appended', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try {
    const file = appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home });
    fs.writeFileSync(path.join(path.dirname(file), '.lock'), JSON.stringify({ pid: 4242, writtenAt: 1000 }));
    assert.throws(() => appendStopEvent(repo, { at: 2, event: 'start', session: 's' },
      { home, lockWaitMs: 50, platform: platformWith(true, 900) }), /held by a live writer/);
    assert.deepEqual(readStopEvents(repo, { home }).events.map((e) => e.at), [1]);
    assert.ok(fs.existsSync(path.join(path.dirname(file), '.lock')), 'a live owner\'s lock is never cleared');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('regression: a lock whose owner is gone, or whose pid was reused, is reclaimed', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try {
    const file = appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home });
    const lock = path.join(path.dirname(file), '.lock');
    fs.writeFileSync(lock, JSON.stringify({ pid: 4242, writtenAt: 1000 }));
    appendStopEvent(repo, { at: 2, event: 'end', session: 's' }, { home, platform: platformWith(false, null) });
    fs.writeFileSync(lock, JSON.stringify({ pid: 4242, writtenAt: 1000 }));
    appendStopEvent(repo, { at: 3, event: 'start', session: 's' }, { home, platform: platformWith(true, 999_999) });
    assert.deepEqual(readStopEvents(repo, { home }).events.map((e) => e.at), [1, 2, 3]);
    assert.ok(!fs.existsSync(lock), 'the lock is released after each write');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// G-5 and G-21 of 20261025-080709-srf-delivery: every rotation was kept, so a session's record grew without bound while
// shared/session-rules.md promised the current file and one previous; this test asserted that all 21 events remained.
test('regression: a file past its size rotates inside the session folder, only one previous file is kept, and the read keeps the order', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try {
    for (let i = 0; i < 20; i++) appendStopEvent(repo, { at: i, event: 'start', session: 's' }, { home, fileMaxBytes: 200 });
    const dir = path.dirname(appendStopEvent(repo, { at: 20, event: 'start', session: 's' }, { home, fileMaxBytes: 200 }));
    const rotated = fs.readdirSync(dir).filter((n) => /^\d+\.jsonl$/.test(n));
    assert.equal(rotated.length, 1, `one previous file is kept, found ${rotated.join(', ')}`);
    const ats = readStopEvents(repo, { home }).events.map((e) => e.at);
    assert.ok(ats.length < 21, 'older events are dropped');
    assert.deepEqual(ats, Array.from({ length: ats.length }, (_, i) => 21 - ats.length + i), 'what is kept is the newest, in order');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// G-7 of 20261025-080709-srf-delivery: a session's events were gathered with push(...events), which passes every event
// as a call argument, so a session with more events than the engine accepts as arguments threw RangeError.
test('regression: a session with a million events is read without a RangeError', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try {
    const dir = path.dirname(appendStopEvent(repo, { at: 0, event: 'start', session: 's' }, { home }));
    const n = 1_000_000;
    fs.writeFileSync(path.join(dir, 'current.jsonl'), Array.from({ length: n }, (_, i) => `{"at":${i}}\n`).join(''));
    // Every one of the million is read and kept or counted (the read is capped since G-5 of
    // 20261105-154708-crsf-remediation-5-review, and a caller's cap may only lower it since G-9 of
    // 20261106-005647-stoplog-g8-review).
    const r = readStopEvents(repo, { home, maxEvents: n });
    assert.equal(r.events.length, STOP_READ_MAX_EVENTS);
    assert.equal(r.events.length + r.dropped, n, 'every event was read past or kept');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('regression: an engine home inside the repository is refused for the stop record', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try {
    assert.throws(() => stopLogPath(repo, { home: path.join(repo, '.quorate') }), /inside the repository/);
    assert.throws(() => stopLogPath(repo, { home: repo }), /inside the repository/);
    assert.doesNotThrow(() => stopLogPath(repo, { home: `${repo}-home` }), 'a sibling whose name starts the same is outside');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
