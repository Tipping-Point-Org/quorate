// THE SESSION RECORDS' FILES THROUGH THE CONFINED OWNER (contract-runtime-and-session-files.plan.md stage 3; design CR-D3
// A, operator 2026-11-05). The telemetry records, the run state and the CLI freshness cache, the stop record and the command
// log were read and written partly through `confined` and partly raw, and each remediation round of autonomous-run's
// delivery chain found the next raw call: G-14 of 20261105-021654-ar-d1-c-remediation-2-review (a write confined only from
// its own folder), G-5/G-6 of 20261105-031048-ar-d1-c-remediation-3-review (a subagent's and a bench's record written with
// no owner in view, a link above it followed). A link at any level from the record's root down is now refused, for a read
// and for a write. And G-9 of the same review: resume-run read the run state with no error path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
const filesBelow = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }) : []);

test('a subagent\'s record is not written through a link above it in the repository', async () => {
  const { writeSubagentRecord } = await import('../scripts/io/telemetry-record.mjs');
  const base = tmp('sfc-sub-');
  try {
    const repo = path.join(base, 'repo'); const outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.mkdirSync(path.join(outside, 'p', 'round-1'), { recursive: true });
    link(outside, path.join(repo, '.claude', 'plan-reviews'));
    const out = path.join(repo, '.claude', 'plan-reviews', 'p', 'round-1', 'envelope.json');
    const r = writeSubagentRecord(out, { envelope: null, proc: {}, pins: {}, repoRoot: repo });
    assert.equal(r.ok, false, `written through the link: ${JSON.stringify(r)}`);
    assert.deepEqual(filesBelow(path.join(outside, 'p', 'round-1')), [], 'a record landed outside the repository');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a bench\'s record is not written through a link above it in the repository', async () => {
  const { writeBenchRecord } = await import('../scripts/io/telemetry-record.mjs');
  const base = tmp('sfc-bench-');
  try {
    const repo = path.join(base, 'repo'); const outside = path.join(base, 'outside');
    fs.mkdirSync(repo); fs.mkdirSync(path.join(outside, 'results'), { recursive: true });
    link(outside, path.join(repo, 'bench'));
    const results = path.join(repo, 'bench', 'results', '2026-11-05T00-00-00-000Z.json');
    const r = writeBenchRecord(results, { repoRoot: repo, results: { arms: [] } });
    assert.equal(r.ok, false, `written through the link: ${JSON.stringify(r)}`);
    assert.deepEqual(filesBelow(path.join(outside, 'results')), [], 'a record landed outside the repository');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a stop event is not appended through a link below the engine home', async () => {
  const { appendStopEvent } = await import('../scripts/io/stop-log.mjs');
  const base = tmp('sfc-stop-');
  try {
    const repo = path.join(base, 'repo'); const home = path.join(base, 'home'); const outside = path.join(base, 'outside');
    fs.mkdirSync(repo); fs.mkdirSync(home); fs.mkdirSync(outside);
    link(outside, path.join(home, 'stops'));
    assert.throws(() => appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home, retentionDays: null }), /link|junction/);
    assert.deepEqual(filesBelow(outside), [], 'the stop record was written outside the engine home');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('the stop record is not read through a link below the engine home', async () => {
  const { readStopEvents } = await import('../scripts/io/stop-log.mjs');
  const base = tmp('sfc-stopr-');
  try {
    const repo = path.join(base, 'repo'); const home = path.join(base, 'home'); const outside = path.join(base, 'outside');
    fs.mkdirSync(repo); fs.mkdirSync(home); fs.mkdirSync(outside);
    link(outside, path.join(home, 'stops'));
    assert.throws(() => readStopEvents(repo, { home }), /link|junction/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('the freshness cache is not written through a link at the engine home\'s level', async () => {
  const { writeFreshness } = await import('../scripts/io/run-state.mjs');
  const base = tmp('sfc-fresh-');
  try {
    const real = path.join(base, 'real'); const home = path.join(base, 'home');
    fs.mkdirSync(real); link(real, home);
    assert.throws(() => writeFreshness({ checked_day: '2026-11-05' }, { home }), /link|junction/);
    assert.deepEqual(filesBelow(real), [], 'the cache was written through the linked home');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('G-9: resume-run says an unreadable run state rather than crashing', () => {
  const base = tmp('sfc-resume-');
  try {
    const repo = path.join(base, 'repo'); const home = path.join(base, 'home');
    fs.mkdirSync(repo); fs.mkdirSync(home);
    runScript('run-session.mjs', ['start', '--plan', 'x', '--repo-root', repo], { env: { QUORATE_HOME: home } });
    // A run state that is not one: written where the engine keeps it.
    const { runStatePath } = await_runStatePath();
    const p = runStatePath(repo, { home });
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{not json');
    const r = runScript('resume-run.mjs', ['--repo-root', repo], { env: { QUORATE_HOME: home } });
    assert.notEqual(r.status, 0);
    assert.match(r.output, /run state could not be read/, r.output);
    assert.doesNotMatch(r.output, /at .*resume-run\.mjs:\d+/, 'a stack trace instead of a message');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// A synchronous handle on the module for the test above (node:test runs it after the imports resolve).
import * as runStateIo from '../scripts/io/run-state.mjs';
function await_runStatePath() { return runStateIo; }
