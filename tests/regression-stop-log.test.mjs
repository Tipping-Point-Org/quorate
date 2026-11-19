// The stop record (autonomous-run-pauses.plan.md stage 2) measures the request's effect against the baseline it was
// built on (898 turn-end stops, 157 h), so a wait must count as a turn end and a turn that never ended must be found.
// These drive the file under a temporary home and the summary script, so nothing touches a real home directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendStopEvent, readStopEvents, sessionDir, stopLogPath } from '../scripts/io/stop-log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('regression: events are kept under the engine home, per repository, and read back in order', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try {
    const file = appendStopEvent(repo, { at: 1, event: 'start' }, { home });
    appendStopEvent(repo, { at: 2, event: 'end', kind: 'named', reason: 'done' }, { home });
    assert.ok(file.startsWith(path.join(home, 'stops')), 'the record lives under the engine home');
    assert.ok(!file.startsWith(repo), 'and never inside the repository');
    fs.appendFileSync(file, 'not json\n');
    const { events, unreadable } = readStopEvents(repo, { home });
    assert.deepEqual(events.map((e) => e.at), [1, 2]);
    assert.equal(unreadable, 1);
    // Another repository has its own file.
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-other-'));
    assert.notEqual(stopLogPath(other, { home }), file);
    fs.rmSync(other, { recursive: true, force: true });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// G-5 and G-6 of 20261024-220920-arp-delivery: the file was appended to forever and every read loaded all of it. It is
// bounded: past maxBytes the current file becomes the one previous file, so the record holds at most twice the cap,
// read back whole and in order.
test('regression: the record is bounded, the newest events kept and read back in order', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try {
    // The FILE cap is fileMaxBytes (maxBytes is one line's), and the record is the session's folder: this summed the
    // sizes of the folders under <home>/stops, 0 on Windows and 4096 on Linux, so it passed there without measuring the
    // record and failed here (CI, ubuntu: "the record holds 4096 bytes"). Regular files only: the lock is not a record.
    const maxBytes = 400;
    for (let i = 0; i < 100; i++) appendStopEvent(repo, { at: i, event: 'start', session: 's' }, { home, fileMaxBytes: maxBytes });
    const dir = sessionDir(repo, 's', { home });
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.jsonl'));
    assert.ok(files.length >= 2, `rotation never ran: ${files.map((e) => e.name).join(', ')}`);
    const total = files.reduce((n, e) => n + fs.statSync(path.join(dir, e.name)).size, 0);
    assert.ok(total <= 2 * maxBytes, `the record holds ${total} bytes, over twice the ${maxBytes}-byte cap`);
    const ats = readStopEvents(repo, { home }).events.map((e) => e.at);
    assert.equal(ats.at(-1), 99, 'the newest event is kept');
    assert.deepEqual(ats, [...ats].sort((a, b) => a - b), 'in the order recorded');
    assert.ok(ats.length > 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('regression: the summary counts waits and involuntary ends, beside the baseline', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stoplog-repo-'));
  try {
    for (const e of [
      { at: 0, event: 'start' }, { at: 1000, event: 'end', kind: 'declared-wait', reason: 'wait' },
      { at: 61000, event: 'start', source: 'notification' },
      { at: 70000, event: 'start' }, { at: 71000, event: 'end', kind: 'named', reason: 'done' },
    ]) appendStopEvent(repo, e, { home });
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stop-log.mjs'), '--summary', '--repo-root', repo], {
      encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home }, windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /turn ends: 2; involuntary: 1/);
    assert.match(r.stdout, /declared-wait:wait\s+1\s+0\.0 h/);
    assert.match(r.stdout, /baseline: 898 turn-end stops/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
