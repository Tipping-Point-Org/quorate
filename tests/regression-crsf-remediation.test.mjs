// The confirmed groups of review 20261105-052942-crsf-delivery (contract-runtime-and-session-files.plan.md's delivery):
// the session records and the telemetry records still had paths outside the confined owner (ARCHITECTURE.md A-30), and a
// subagent's record ignored the contract's review.runtime. Each test names its group.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
const filesBelow = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }) : []);

// G-7: an existing lock was read with a raw readFileSync, so a link standing at .lock was followed.
test('G-7: a link at a session folder\'s lock is refused, not read through', async () => {
  const { appendStopEvent, sessionDir } = await import('../scripts/io/stop-log.mjs');
  const base = tmp('crsf-g7-');
  try {
    const repo = path.join(base, 'repo'); const home = path.join(base, 'home'); const outside = path.join(base, 'outside');
    fs.mkdirSync(repo); fs.mkdirSync(home); fs.mkdirSync(outside);
    appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home, retentionDays: null });
    link(outside, path.join(sessionDir(repo, 's', { home }), '.lock'));
    assert.throws(() => appendStopEvent(repo, { at: 2, event: 'stop', session: 's' }, { home, retentionDays: null, lockWaitMs: 200 }),
      /link|junction/, 'the lock was not refused as a link');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// G-9: newestWrite stat'ed each file with a raw statSync, so a link in an expired folder lent it an outside time.
test('G-9: a link inside an expired session folder is reported by the sweep, not followed for its time', async () => {
  const { appendStopEvent, sessionDir, readSessionEvents } = await import('../scripts/io/stop-log.mjs');
  const base = tmp('crsf-g9-');
  try {
    const repo = path.join(base, 'repo'); const home = path.join(base, 'home'); const outside = path.join(base, 'outside');
    fs.mkdirSync(repo); fs.mkdirSync(home); fs.mkdirSync(outside);
    appendStopEvent(repo, { at: 1, event: 'start', session: 'old' }, { home, retentionDays: null });
    const old = sessionDir(repo, 'old', { home });
    const then = new Date(Date.now() - 10 * 86400_000);
    fs.utimesSync(path.join(old, 'current.jsonl'), then, then);
    link(outside, path.join(old, 'x'));
    appendStopEvent(repo, { at: 2, event: 'start', session: 'new' }, { home, retentionDays: 1 });
    const failed = readSessionEvents(repo, 'new', { home }).filter((e) => e.event === 'retention-failed');
    assert.equal(failed.length, 1, 'the link kept the expired folder alive with nothing reported');
    assert.equal(failed[0].folders[0].code, 'ECONFINED');
    assert.ok(fs.existsSync(outside), 'the outside folder was touched');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// G-8: the lock's removal ran after the close in one finally, so a close that threw left the lock behind.
test('G-8: the lock is removed even when its close throws', async () => {
  const { appendStopEvent, sessionDir } = await import('../scripts/io/stop-log.mjs');
  const base = tmp('crsf-g8-');
  try {
    const repo = path.join(base, 'repo'); const home = path.join(base, 'home');
    fs.mkdirSync(repo); fs.mkdirSync(home);
    appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home, retentionDays: null });
    const orig = fs.closeSync;
    let thrown = false;
    mock.method(fs, 'closeSync', (fd) => { orig(fd); if (!thrown) { thrown = true; throw Object.assign(new Error('EIO: close'), { code: 'EIO' }); } });
    try {
      assert.throws(() => appendStopEvent(repo, { at: 2, event: 'stop', session: 's' }, { home, retentionDays: null }), /EIO/);
    } finally { mock.restoreAll(); }
    assert.equal(fs.existsSync(path.join(sessionDir(repo, 's', { home }), '.lock')), false, 'the lock was left behind');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// G-12: writeRunRecord rooted its owner at the run directory, so a link at .claude/reviews above it was followed.
test('G-12: a run\'s record is not written through a link above the run in the repository', async () => {
  const { writeRunRecord } = await import('../scripts/io/telemetry-record.mjs');
  const base = tmp('crsf-g12-');
  try {
    const repo = path.join(base, 'repo'); const outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.mkdirSync(path.join(outside, 'r1'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'r1', 'run.json'), '{}');
    link(outside, path.join(repo, '.claude', 'reviews'));
    const r = writeRunRecord(path.join(repo, '.claude', 'reviews', 'r1'), { recordKind: 'review', repoRoot: repo });
    assert.equal(r.ok, false, `written through the link: ${JSON.stringify(r)}`);
    assert.equal(fs.existsSync(path.join(outside, 'r1', 'telemetry.json')), false, 'a record landed outside the repository');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// G-13: writeSuiteRecord read the reporter's lines file with a raw readFileSync, following a link there.
test('G-13: the suite reporter\'s lines are not read through a link', async () => {
  const { writeSuiteRecord } = await import('../scripts/io/telemetry-record.mjs');
  const base = tmp('crsf-g13-');
  try {
    const repo = path.join(base, 'repo'); const outside = path.join(base, 'outside');
    fs.mkdirSync(repo); fs.mkdirSync(outside);
    // Inside the repository, so the link is what refuses it: a lines file outside the repository is refused for that
    // alone (G-7 of 20261105-074139-crsf-remediation-3-review), and run-all writes its own under tests/.
    const lines = path.join(repo, 'lines.jsonl');
    link(outside, lines);
    const r = writeSuiteRecord(repo, { linesFile: lines, startedAt: 1, endedAt: 2, exitCode: 0 });
    assert.equal(r.ok, false);
    assert.match(r.note, /link|junction/, `the lines file was read through, not refused as a link: ${r.note}`);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// G-11: with no runtime passed, the subagent record named the table's default and ignored the contract's review.runtime.
test('G-11: a subagent\'s record takes its runtime from the one owner, the contract\'s review.runtime included', async () => {
  const { writeSubagentRecord } = await import('../scripts/io/telemetry-record.mjs');
  const base = tmp('crsf-g11-');
  try {
    const repo = path.join(base, 'repo');
    fs.mkdirSync(path.join(repo, '.claude', 'plan-reviews', 'p', 'round-1'), { recursive: true });
    const out = path.join(repo, '.claude', 'plan-reviews', 'p', 'round-1', 'envelope.json');
    const r = writeSubagentRecord(out, { envelope: null, proc: {}, pins: {}, repoRoot: repo, contract: { review: { runtime: 'no-such-runtime' } } });
    assert.equal(r.ok, false, `the contract's review.runtime was not consulted: ${JSON.stringify(r)}`);
    assert.match(r.note, /no-such-runtime/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
