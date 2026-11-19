// stop-owner-grep-state-roots.plan.md stage 1, G-11 of 20261022-200543-ciss-d1-review-2: external-review ran the live
// reviewer through spawnSync, so a timeout ended only its direct process and a descendant the vendor CLI started could keep
// running (and spending). The call now runs through spawnCapture, the stop owner (ARCHITECTURE.md A-25), with the
// platform's killable spawn options, as the reviewer probe already did: a timeout stops the whole tree, and the timeout's
// text names the stop's outcome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, withTempDir, seedReviewerProbe } from './helpers.mjs';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// A fake codex first on PATH that starts a grandchild (its pid written to a file), waits until the grandchild is up, then
// outlives any timeout. The 15-second timeout leaves room for both to start on a loaded machine before the stop.
function fakeHangingCodex(dir, pidFile) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const grandchild = `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'), [
    'import { spawn } from "node:child_process";',
    'if (process.argv.includes("--version")) { process.stdout.write("codex-cli 0.0.0-fake"); process.exit(0); }',
    `spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" });`,
    'const fsm = await import("node:fs");',
    `while (!fsm.existsSync(${JSON.stringify(pidFile)})) await new Promise((r) => setTimeout(r, 50));`,
    `fsm.writeFileSync(${JSON.stringify(pidFile + '.vendor')}, String(process.pid));`,
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n'));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'codex.cmd'), `@"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`);
  } else {
    const shim = path.join(binDir, 'codex');
    fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex.mjs" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  return binDir;
}

test('G-11: a timed-out reviewer call is stopped with its descendants, and the timeout names the stop', () => {
  withTempDir((dir) => {
    const pidFile = path.join(dir, 'grandchild.pid');
    const binDir = fakeHangingCodex(dir, pidFile);
    const home = path.join(dir, 'home');
    const sink = path.join(home, 'ev');
    fs.mkdirSync(sink, { recursive: true });
    const prompt = path.join(dir, 'prompt.md');
    fs.writeFileSync(prompt, 'Choose an entry.');
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const pathValue = `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`;
    const probes = path.join(dir, 'probes');
    seedReviewerProbe(probes, { mode: 'decide', route: 'native', pathValue });
    const out = path.join(sink, 'seat.json');
    let pid = null;
    try {
      // Bounded HERE, at two minutes: under spawnSync the call never returned, its wait held open by the vendor's surviving
      // process (the red, 2026-11-05), and an unbounded wait would hang the suite instead of failing this test.
      const res = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), '--reviewer', 'codex',
        '--mode', 'decide', '--prompt-file', prompt, '--evidence-dir', sink, '--out', out, '--timeout-minutes', '0.25'], {
        cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000, windowsHide: true,
        env: { ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, [pathKey]: pathValue,
          QUORATE_HOME: home, QUORATE_REVIEWER_PROBES: probes },
      });
      assert.notEqual(res.error?.code, 'ETIMEDOUT', 'external-review did not return within two minutes of a 15-second reviewer timeout');
      assert.ok(fs.existsSync(pidFile), 'the fake reviewer never started its grandchild');
      pid = Number(fs.readFileSync(pidFile, 'utf8'));
      // The stop is confirmed before external-review returns; a short grace covers the OS reaping the process entry.
      const until = Date.now() + 5000;
      while (alive(pid) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      assert.equal(alive(pid), false, `the reviewer's grandchild (pid ${pid}) outlived the timed-out call`);
      const env = JSON.parse(fs.readFileSync(out, 'utf8'));
      const n = (env.not_checked ?? []).find((x) => /^decision seat 'codex'/.test(String(x.item)));
      assert.ok(n, `no not_checked entry for the seat: ${JSON.stringify(env.not_checked)}`);
      assert.match(n.reason, /timed out after/);
      assert.match(n.reason, /stopped|exited|refused|unconfirmed/, `the timeout does not name the stop's outcome: ${n.reason}`);
      // G-5 of 20261105-212751-sogsr-delivery: the timeout branch exited before the raw log was written, so a timed-out
      // reviewer left no failure evidence. It is written first now, and the timeout's reason cites it.
      const logs = fs.readdirSync(sink, { recursive: true }).filter((f) => /(^|[\\/])raw(\.\d+)?\.log$/.test(String(f)));
      assert.ok(logs.length > 0, `a timed-out reviewer left no raw log under the evidence directory: ${JSON.stringify(fs.readdirSync(sink, { recursive: true }))}`);
      assert.match(n.reason, /raw output: evidence\//, `the timeout does not cite its raw log: ${n.reason}`);
    } finally {
      if (pid && alive(pid)) { try { process.kill(pid); } catch { /* gone */ } }
      // The vendor process itself, which the red left running too.
      const vendor = fs.existsSync(`${pidFile}.vendor`) ? Number(fs.readFileSync(`${pidFile}.vendor`, 'utf8')) : null;
      if (vendor && alive(vendor)) { try { process.kill(vendor); } catch { /* gone */ } }
    }
  });
});
