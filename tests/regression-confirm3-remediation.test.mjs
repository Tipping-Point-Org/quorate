// Run 20261002-004527-confirm2-confirm (operator, 2026-10-02: "Fix G-7, G-18, G-4; ledger the rest (Recommended)").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, REPO_ROOT, withKill } from './helpers.mjs';
import * as rc from '../scripts/io/run-child.mjs';

function childFixture(t, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-confirm3-'));
  const bin = path.join(dir, 'child.mjs');
  fs.writeFileSync(bin, source);
  const kids = [];
  t.after(async () => {
    for (const pid of kids) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
      for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); } catch { break; } await new Promise((r) => setTimeout(r, 50)); }
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  return { dir, bin, kids };
}

// ----------------------------------------------------------------------------------------------------- G-7
// The G-7 fix (20e08eb) made the first watchdog disarm the other, and with it removed the last deadline: a kill the OS
// ACCEPTS whose child never exits left runChild unresolved, and nothing outside it times a lens out. code-audit and
// security-audit both filed it; the reconciler lowered it on an outer timeout that does not exist.
test('G-7: an accepted kill whose child never exits still ends the node, within a bounded time', { timeout: 20_000 }, async (t) => {
  const { dir, bin, kids } = childFixture(t, 'setInterval(() => {}, 1000);\n');
  const t0 = Date.now();
  const res = await rc.runChild(withKill({
    cmd: process.execPath, args: [bin], cwd: os.tmpdir(), env: process.env,
    stdoutPath: path.join(dir, 'out'), stderrPath: path.join(dir, 'err'),
    timeoutMs: 200, outputCapBytes: 1024 * 1024, deathGraceMs: 600,
    // Accepts the kill and does nothing: the child survives, as one behind a failed escalation would.
    kill: (pid) => { kids.push(pid); return true; },
  }));
  assert.ok(Date.now() - t0 < 10_000, 'the node waited on a child that was never going to exit');
  assert.equal(res.timedOut, true, 'the reason that asked for the kill is kept');
  assert.equal(res.exitUnconfirmed, true);
  assert.equal(res.killRefused, null);
  assert.ok(Number.isInteger(res.orphanPid), 'the survivor is named, so run-graph can report it');
});

// ---------------------------------------------------------------------------------------------------- G-18
// The refused-kill test checked only that spawn-node CALLED runChild and that the note formatted; removing spawn-node's
// handling of the refusal left it green. The recording now has an owner, recordRunOutcome, which spawn-node calls.
test('G-18: a refused or unconfirmed kill reaches the node\'s status', () => {
  assert.equal(typeof rc.recordRunOutcome, 'function', 'the status recording has no owner a test can drive');
  const base = () => ({ validator_errors: [] });
  const refused = base();
  rc.recordRunOutcome(refused, { exitCode: null, signal: 'SIGKILL-REFUSED', timedOut: false, overflowed: true, killedTree: false, killRefused: 'output-cap', orphanPid: 4242, exitUnconfirmed: false });
  assert.equal(refused.kill_refused, 'output-cap');
  assert.equal(refused.orphan_pid, 4242);
  assert.equal(refused.killed_tree, false);
  assert.ok(refused.validator_errors.some((e) => /4242/.test(e) && /no longer capped/.test(e)));
  const unconfirmed = base();
  rc.recordRunOutcome(unconfirmed, { exitCode: null, signal: 'KILL-UNCONFIRMED', timedOut: true, overflowed: false, killedTree: true, killRefused: null, orphanPid: 5151, exitUnconfirmed: true });
  assert.equal(unconfirmed.kill_unconfirmed, true);
  assert.equal(unconfirmed.orphan_pid, 5151);
  // The wording sweep (2026-10-03): an unconfirmed stop is "not seen to exit after its stop", never an accepted kill.
  assert.ok(unconfirmed.validator_errors.some((e) => /5151/.test(e) && /not seen to exit/.test(e)));
  const clean = base();
  rc.recordRunOutcome(clean, { exitCode: 0, signal: null, timedOut: false, overflowed: false, killedTree: false, killRefused: null, orphanPid: null, exitUnconfirmed: false });
  assert.equal(clean.kill_refused, undefined);
  assert.deepEqual(clean.validator_errors, []);
  // The wiring is no longer matched in source (ledger tests/regression-confirm3-remediation.test.mjs:60: a regex for the
  // call passed whether or not the call was reached or its result persisted). regression-stop-on-exit drives spawn-node
  // with a refused and an unconfirmed kill and reads the status file it wrote (stopping-a-child stage 3).
});

// ----------------------------------------------------------------------------------------------------- G-4
// find-inert-features counted the source files that are not documents, and grepped all source files — so a file under
// both a source glob and a doc glob (this repository's `shared/**`) counted as an implementation reader of every name it
// mentions, and a name only documents use was never reported inert.
test('G-4: a document that is also under a source glob does not count as an implementation reader', (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-inert-overlap-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const files = {
    'shared/doc.md': 'The `zorbQuuxSetting` option is documented here and implemented nowhere.\n',
    'src/a.js': 'export const a = 1;\n',
  };
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), body);
  }
  const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**", "shared/**"]', 'doc_paths: ["shared/**"]'].join('\n');
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  const git = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' });
  git('init', '-q', '.'); git('add', '-A');
  const r = runScript('find-inert-features.mjs', ['--repo-root', d, '--json'], { cwd: d });
  assert.equal(r.status, 0, r.output);
  const report = JSON.parse(r.stdout);
  assert.ok(report.inert.some((i) => JSON.stringify(i).includes('zorbQuuxSetting')),
    `a name only a document uses was not reported inert: ${JSON.stringify(report.inert)}`);
});
