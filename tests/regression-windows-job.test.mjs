// G-1 of 20261002-215002-stop-child-review (panel-codex-docs), with its symptom G-8: ARCHITECTURE A-25 says a
// non-detached Windows child "is ended with its parent", while the win32 adapter said Node does not expose job objects
// and nothing in this repository creates one — so the sentence read as an inert guarantee. Measured on this machine it
// holds (3 of 3 gone non-detached, 3 of 3 alive detached): the ending is the runtime's (Node documents `detached` as what
// lets a Windows child "continue running after the parent exits"; libuv's job object is the mechanism). What was missing
// was a test that holds it, since A-25 and open question 3's accepted window both rest on it.
//
// Both ways the parent can go — a clean exit, and a hard kill of the parent alone (TerminateProcess, no /T), which is how
// spawn-node dies under a refused or escalated stop — and a detached control, so the test cannot pass because the child
// never started or died by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { IMPLEMENTATIONS } from '../scripts/platform/index.mjs';

const WIN = process.platform === 'win32';
const WIN_ONLY = WIN ? false : 'the runtime\'s job object is a Windows mechanism; on posix the owner\'s group kill and the file-size ceiling hold instead';
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitGone = async (pid, ms) => { const until = Date.now() + ms; while (Date.now() < until) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 50)); } return !alive(pid); };

// A parent that starts one child with the win32 adapter's own killable options (or detached, for the control), prints
// the child's pid, and then either exits or waits to be killed.
const PARENT = `
const { spawn } = require('node:child_process');
const [opts, mode] = process.argv.slice(2);
const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', ...JSON.parse(opts) });
process.stdout.write(String(c.pid) + '\\n');
if (mode === 'exit') setTimeout(() => process.exit(0), 200); else setInterval(() => {}, 1000);
`;

function startParent(t, opts, mode) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-winjob-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const script = path.join(d, 'parent.cjs');
  fs.writeFileSync(script, PARENT);
  const parent = spawn(process.execPath, [script, JSON.stringify(opts), mode], { stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve) => {
    let out = '';
    parent.stdout.on('data', (b) => { out += b; if (out.includes('\n')) resolve({ parent, childPid: Number(out.trim()) }); });
  });
}
const cleanup = (t, pid) => t.after(() => spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }));

const ATTACHED = () => IMPLEMENTATIONS.win32.proc.killableSpawnOptions();

test('G-1: the win32 adapter starts children non-detached — what the job ending rests on', () => {
  assert.deepEqual(IMPLEMENTATIONS.win32.proc.killableSpawnOptions(), { detached: false });
});

test('G-1 (win32): a non-detached child is gone once its parent EXITS', { skip: WIN_ONLY, timeout: 20_000 }, async (t) => {
  const { parent, childPid } = await startParent(t, ATTACHED(), 'exit');
  cleanup(t, childPid);
  assert.ok(Number.isInteger(childPid) && childPid > 0);
  await new Promise((r) => parent.on('exit', r));
  assert.equal(await waitGone(childPid, 3_000), true, `child ${childPid} outlived its parent's exit — A-25's Windows sentence is false here`);
});

test('G-1 (win32): a non-detached child is gone once its parent is KILLED alone, without /T', { skip: WIN_ONLY, timeout: 20_000 }, async (t) => {
  const { parent, childPid } = await startParent(t, ATTACHED(), 'wait');
  cleanup(t, childPid);
  assert.equal(alive(childPid), true, 'the child was not running before its parent was killed, so nothing would be tested');
  const exited = new Promise((r) => parent.on('exit', r));
  parent.kill();   // TerminateProcess on the parent only — the way spawn-node goes when it is stopped from outside
  await exited;
  assert.equal(await waitGone(childPid, 3_000), true, `child ${childPid} outlived its parent being killed`);
});

test('G-1 (win32): the control — a DETACHED child does outlive its parent, so the two tests above are not vacuous', { skip: WIN_ONLY, timeout: 20_000 }, async (t) => {
  const { parent, childPid } = await startParent(t, { detached: true }, 'exit');
  cleanup(t, childPid);
  await new Promise((r) => parent.on('exit', r));
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(alive(childPid), true, 'a detached child died with its parent: the measurement cannot tell the job from anything else');
});
