// Run 20261001-205530-m0-pending-claims-review (operator, 2026-10-01: "Expose git's error, then fix (Recommended)";
// "Fix the kill path; fix G-18 too (Recommended)").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, withKill } from './helpers.mjs';

const snap = await import('../scripts/lib/snapshot-surface.mjs');

// ------------------------------------------------------------------------------------ git's real error
// The arms-snapshot test failed twice with "git add -A -- exited 128" and three line-ending warnings — the builder kept
// the first 300 characters of stderr, and git prints a warning per converted file before its fatal line.
test('a git failure keeps git\'s error lines, whatever warnings precede them', () => {
  assert.equal(typeof snap.gitFailureWhy, 'function', 'no owner summarises a failed git step');
  const warnings = Array.from({ length: 12 }, (_, i) =>
    `warning: in the working copy of 'docs/file-${i}.md', LF will be replaced by CRLF the next time Git touches it`);
  const stderr = [...warnings, "error: open(\"tmp/gone.txt\"): No such file or directory", 'error: unable to index file \'tmp/gone.txt\'', 'fatal: adding files failed'].join('\n');
  const why = snap.gitFailureWhy(['add', '-A', '--', '.'], 128, stderr);
  assert.match(why, /^git add -A -- exited 128/);
  assert.match(why, /fatal: adding files failed/);
  assert.match(why, /unable to index file 'tmp\/gone\.txt'/);
  assert.match(why, /12 warning\(s\) omitted/);
  // Warnings alone are still reported (nothing else to say), and bounded.
  assert.match(snap.gitFailureWhy(['status'], 1, warnings.join('\n')), /warning: in the working copy/);
  assert.ok(snap.gitFailureWhy(['add'], 128, 'fatal: ' + 'x'.repeat(5000)).length < 700);
});

test('the snapshot builder reports a failed git step through that owner', () => {
  const s = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'snapshot.mjs'), 'utf8');
  assert.match(s, /gitFailureWhy\(args, r\.status, r\.stderr\)/, 'the builder still slices raw stderr');
});

// ------------------------------------------------------------------------- the cause: a file vanishing mid-add
// Measured 2026-10-01 (job experiment, churn of untracked files in the repository): every build failed with `unable to
// index file … fatal: adding files failed`, exit 128 — the two suite failures. The builder retries such a failure from a
// fresh index, bounded; anything else fails as before.
const io = await import('../scripts/io/snapshot.mjs');
const os = await import('node:os');
const { spawnSync } = await import('node:child_process');
const VANISHED = "error: open(\"tmp/gone.txt\"): No such file or directory\nerror: unable to index file 'tmp/gone.txt'\nfatal: adding files failed";

// A one-file repository (test-suite-cost.md): the retry is driven by the injected runGit, so the tree it snapshots does
// not matter, and snapshotting THIS repository cost minutes per test.
function surfaceWith(t, failAdds, stderr = VANISHED) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-vanish-repo-')));
  const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  g('init', '-q'); g('config', 'user.email', 'x@x'); g('config', 'user.name', 'x'); g('add', '-A'); g('commit', '-qm', 'a');
  const head = g('rev-parse', 'HEAD').stdout.trim();
  const dir = path.join(os.tmpdir(), `quorate-vanish-${process.pid}-${Math.random().toString(36).slice(2)}`);
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); });
  let adds = 0;
  const runGit = (cwd, args, opts) => {
    if (args[0] === 'add' && ++adds <= failAdds) return { ok: false, why: snap.gitFailureWhy(args, 128, stderr) };
    return io.git(cwd, args, opts);
  };
  const built = io.buildArmsSurface({ repoRoot: repo, headCommit: head, baseCommit: head, dir, maxBytes: null, runGit });
  return { built, adds };
}

test('the vanished-file failure is recognised, and only that one', () => {
  assert.equal(snap.vanishedDuringAdd(snap.gitFailureWhy(['add', '-A'], 128, VANISHED)), true);
  assert.equal(snap.vanishedDuringAdd(snap.gitFailureWhy(['add', '-A'], 128, "fatal: pathspec 'x' did not match any files")), false);
  assert.equal(snap.vanishedDuringAdd(snap.gitFailureWhy(['write-tree'], 128, VANISHED)), false, 'only add is retried');
});

test('a file vanishing during git add is retried, and the snapshot is built', (t) => {
  const { built, adds } = surfaceWith(t, 1);
  assert.equal(built.ok, true, built.why);
  assert.equal(adds, 2);
});

test('a tree that keeps moving fails closed after the bounded attempts, with git\'s own error', (t) => {
  const { built, adds } = surfaceWith(t, 99);
  assert.equal(built.ok, false);
  assert.equal(adds, snap.ADD_ATTEMPTS);
  assert.match(built.why, /fatal: adding files failed .*after 3 attempts/);
});

test('any other git add failure is not retried', (t) => {
  const { built, adds } = surfaceWith(t, 99, "fatal: pathspec ':(exclude)x' did not match any files");
  assert.equal(built.ok, false);
  assert.equal(adds, 1);
});

// --------------------------------------------------------------------------------- the refused-kill path
// G-8, G-9, G-13 of the review, the scenario G-26 was kept open for. The runner moved out of spawn-node into
// scripts/io/run-child.mjs with its kill injectable, so a real child can be driven through a REFUSED kill without the
// operating system's help.
const runChildMod = await import('../scripts/io/run-child.mjs').catch(() => ({}));

function childFixture(t, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-runchild-'));
  const bin = path.join(dir, 'child.mjs');
  fs.writeFileSync(bin, source);
  const kids = [];
  // The "refused" child is alive by design: kill it for real, and WAIT for it to be gone before removing its files —
  // Windows refuses to delete a directory a live process still has files open in.
  t.after(async () => {
    for (const pid of kids) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
      for (let i = 0; i < 100; i++) {
        try { process.kill(pid, 0); } catch { break; }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  return { dir, bin, kids };
}
const refused = (kids) => (pid) => { kids.push(pid); return false; };

test('G-13/G-8: an output-cap kill the OS refuses is reported as the overflow it was, the child not as killed', async (t) => {
  assert.equal(typeof runChildMod.runChild, 'function', 'the child runner is not a module of its own');
  const { dir, bin, kids } = childFixture(t, "const b='x'.repeat(65536); const w=()=>process.stdout.write(b,()=>setImmediate(w)); w();\n");
  const res = await runChildMod.runChild(withKill({
    cmd: process.execPath, args: [bin], cwd: os.tmpdir(), env: process.env,
    stdoutPath: path.join(dir, 'out'), stderrPath: path.join(dir, 'err'),
    timeoutMs: 60_000, outputCapBytes: 256 * 1024, kill: refused(kids),
  }));
  assert.equal(res.spawnError, null, 'a refused kill was reported as a failure to spawn');
  assert.equal(res.overflowed, true);
  assert.equal(res.killedTree, false, 'the status would say killed for a child that is still alive');
  assert.equal(res.killRefused, 'output-cap');
  assert.ok(Number.isInteger(res.orphanPid));
});

test('G-13/G-8: a timeout kill the OS refuses is reported as the timeout it was', async (t) => {
  const { dir, bin, kids } = childFixture(t, 'setInterval(() => {}, 1000);\n');
  const res = await runChildMod.runChild(withKill({
    cmd: process.execPath, args: [bin], cwd: os.tmpdir(), env: process.env,
    stdoutPath: path.join(dir, 'out'), stderrPath: path.join(dir, 'err'),
    timeoutMs: 300, outputCapBytes: 1024 * 1024, kill: refused(kids),
  }));
  assert.equal(res.spawnError, null);
  assert.equal(res.timedOut, true);
  assert.equal(res.killedTree, false);
  assert.equal(res.killRefused, 'timeout');
});

test('a kill that works is still reported as killed', async (t) => {
  const { dir, bin } = childFixture(t, 'setInterval(() => {}, 1000);\n');
  const res = await runChildMod.runChild(withKill({
    cmd: process.execPath, args: [bin], cwd: os.tmpdir(), env: process.env,
    stdoutPath: path.join(dir, 'out'), stderrPath: path.join(dir, 'err'),
    timeoutMs: 300, outputCapBytes: 1024 * 1024, kill: (pid) => { process.kill(pid, 'SIGKILL'); return true; },
  }));
  assert.equal(res.timedOut, true);
  assert.equal(res.killedTree, true);
  assert.equal(res.killRefused, null);
});

test('G-9/G-13: spawn-node reports a refused kill as itself, and says the output is no longer capped', () => {
  const s = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  assert.match(s, /await runChild\(\{/, 'spawn-node does not run its child through the module');
  const note = runChildMod.refusedKillNote?.({ killRefused: 'output-cap', orphanPid: 4242 });
  assert.match(String(note), /4242/);
  assert.match(String(note), /no longer capped/);
});

// ------------------------------------------------------------------------------------------------- G-18
test('G-18: the dead-name check in the output-cap test is a word boundary, not a backspace', () => {
  const s = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'regression-node-output-cap.test.mjs'), 'utf8');
  const line = s.split(/\r?\n/).find((l) => /new RegExp\(`.*\$\{dead\}/.test(l));
  assert.ok(line, 'the check moved; find it again');
  assert.doesNotMatch(line, /`\\b\$\{dead\}\\b`/, 'a template literal turns \\b into a backspace, so the check can never fail');
});

// ------------------------------------------- round 2: run 20261001-234443-pending-claims-confirm-2
// (operator, 2026-10-01: "Fix both, ledger the LOWs (Recommended)").

// G-7 (with its symptom G-6): the watchdogs did not disarm each other. The output-cap kill left the timeout armed, so
// while a correctly killed child was still dying the timer fired, called kill('timeout'), and a second kill of a dying
// process — refused, as taskkill reports for a process already gone — overwrote the node's real reason.
test('G-7: once one watchdog starts a kill, the other cannot start a second', async (t) => {
  const { dir, bin, kids } = childFixture(t, "const b='x'.repeat(65536); const w=()=>process.stdout.write(b,()=>setImmediate(w)); w();\n");
  let calls = 0;
  // The first kill is accepted but takes a while to land, as an escalating killTree does; any later call is refused.
  const slowKill = (pid) => {
    calls++;
    kids.push(pid);
    if (calls > 1) return false;
    setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch {} }, 2500);
    return true;
  };
  const res = await runChildMod.runChild(withKill({
    cmd: process.execPath, args: [bin], cwd: os.tmpdir(), env: process.env,
    stdoutPath: path.join(dir, 'out'), stderrPath: path.join(dir, 'err'),
    timeoutMs: 400, outputCapBytes: 256 * 1024, kill: slowKill,
  }));
  // WHICHEVER FIRES FIRST: under a loaded suite the child writes slowly and the timeout can win; with the watchdogs
  // armed against each other either order produces a second kill, and with the fix neither does.
  assert.equal(calls, 1, 'a second kill was attempted on a child already being killed');
  assert.equal(res.killRefused, null, 'the first kill was overwritten by a refused second one');
  assert.equal(res.killedTree, true);
  assert.equal(Number(res.overflowed) + Number(res.timedOut), 1, 'exactly one reason is recorded');
});

// G-21: the same defect as G-18, in another form. A regex literal in regression-bench-and-counts held raw backspace bytes
// (U+0008) where `\b` was meant, so its doesNotMatch could never fail. Both forms are checked across the source tree: a
// raw backspace byte anywhere, and a `\b` inside a template literal handed to `new RegExp`.
test('G-21: no source file holds a backspace where a word boundary was meant', () => {
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.m?js$/.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      if (s.includes('\u0008')) offenders.push(`${path.relative(REPO_ROOT, p)}: a raw backspace byte`);
      for (const m of s.matchAll(/new RegExp\(`([^`]*)`/g)) {
        if (/(^|[^\\])\\b/.test(m[1])) offenders.push(`${path.relative(REPO_ROOT, p)}: \\b inside a template literal`);
      }
    }
  };
  walk(path.join(REPO_ROOT, 'tests'));
  walk(path.join(REPO_ROOT, 'scripts'));
  assert.deepEqual(offenders, []);
});
