// A CAPTURE'S DEADLINE STOPS THE WHOLE TREE (capture-interactive.plan.md stage 3, approved 2026-11-15: "Approve, start the
// bench (Recommended)"). capture.mjs ran its command through spawnSync with `timeout` and SIGKILL, which ends the direct
// child only (story-pipeline's handover, H#L363-L373: "there is no kill logic to inherit"). A child that started a
// grandchild holding the same stdout left that grandchild running past the deadline, and spawnSync, which waits for the
// pipes to close, waited on it. The core now runs the command through the one stop owner (scripts/io/stop-child.mjs),
// which stops the tree.
//
// Slow by nature: capture's smallest deadline is one whole minute (lib/check-timeout.mjs owns what a deadline may be).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, TEST_HOME } from './helpers.mjs';
import { inRun } from './capture-containment-fixture.mjs';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('a command whose grandchild outlives the deadline: capture returns at its deadline, and the grandchild is gone', (t) => {
  inRun((dir, base) => {
    // Forward slashes: the declared command is matched by exact argv, and the contract's splitter reads a backslash.
    const pidFile = path.join(base, 'grandchild.pid').split(path.sep).join('/');
    // No spaces inside the argument: declared commands are matched by exact argv. The child starts a grandchild that
    // inherits its stdout and stderr and runs forever, writes the grandchild's pid, and runs forever itself.
    const TREE = `const{spawn}=require('child_process');const{writeFileSync}=require('fs');`
      + `globalThis.g=spawn(process.execPath,['-e','setInterval(()=>{},1e3)'],{stdio:'inherit'});`
      + `writeFileSync(process.argv[1],String(g.pid));setInterval(()=>{},1e3)`;
    const rj = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    rj.contract = { commands: { run: `node -e ${TREE} ${pidFile}`, shell: '' } };
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(rj));
    let grandchild = null;
    t.after(() => { if (grandchild && alive(grandchild)) try { process.kill(grandchild, 'SIGKILL'); } catch { /* gone */ } });
    const started = Date.now();
    // Its own ceiling, well past capture's one minute: on the old path spawnSync waits for the grandchild's pipes, so
    // without this the test would hang rather than fail.
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'capture.mjs'),
      '--run-dir', dir, '--node', 'feature-verify', '--name', 'tree', '--timeout-minutes', '1',
      '--', 'node', '-e', TREE, pidFile], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 150_000, killSignal: 'SIGKILL',
      env: { ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME } });
    const took = Date.now() - started;
    try { grandchild = Number(fs.readFileSync(pidFile, 'utf8')); } catch { /* not written */ }
    assert.ok(grandchild, `the fixture never started its grandchild (exit ${r.status}): ${String(r.stderr).slice(-600)}`);
    assert.notEqual(r.error?.code, 'ETIMEDOUT', `capture did not return at its deadline (${took} ms): it waited on the grandchild`);
    assert.ok(took < 120_000, `capture took ${took} ms for a one-minute deadline`);
    assert.match(r.stdout, /evidence\/feature-verify\/tree\.log/, 'the timed-out capture still prints its evidence path');
    assert.equal(r.status, 124, `a deadline is recorded as a timeout: ${r.stderr.slice(-400)}`);
    // Its stop is confirmed or the gate is told: within a short wait, the grandchild is gone.
    const until = Date.now() + 10_000;
    while (alive(grandchild) && Date.now() < until) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},200)']);
    assert.equal(alive(grandchild), false, `the grandchild (pid ${grandchild}) outlived capture's deadline`);
  });
});
