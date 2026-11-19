// stopping-a-child.plan.md stage 5 (design 4B; operator, 2026-10-02: "4 GB (Recommended)"): on posix the model child is
// launched under a file-size ceiling — `sh -c 'ulimit -f "$1"; shift; exec "$@"' sh <blocks> <cmd> <args…>` — sized as
// disk protection, not as the output cap. It is what still bounds a child whose cap kill was refused or never seen to take
// effect (ledger io/run-child.mjs:80; spawn-node.mjs:1210 and :1230, pending-claims G-9's survivor half). The platform
// declares whether it applies and the ceiling, behind the interface (ARCHITECTURE §2, the Platform row); win32 says null,
// because a non-detached child there is ended by the job with its parent (design §4, open question 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { IMPLEMENTATIONS } from '../scripts/platform/index.mjs';
import { runChild } from '../scripts/io/run-child.mjs';
import { runScript, REPO_ROOT, repoRunDir } from './helpers.mjs';

const POSIX = process.platform !== 'win32';
const POSIX_ONLY = POSIX ? false : 'a file-size ceiling is a posix rlimit; Windows has none (design 4B), and win32 says so with null';
const GiB = 1024 ** 3;
const tmp = (t, prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

// Every shape an argument can take that a shell would otherwise reinterpret.
const AWKWARD = ['plain', 'with space', "it's", '"double"', '$HOME', '`id`', '-p', '--flag=a b', '', 'semi;colon', 'new\nline'];

for (const name of ['linux', 'darwin']) {
  test(`stage 5 (${name}): the argv carries the sh placeholder, the block count, and every argument unaltered`, () => {
    const proc = IMPLEMENTATIONS[name].proc;
    assert.equal(typeof proc.boundedLaunch, 'function', 'the platform does not declare a bounded launch');
    const { cmd, args, ceilingBytes } = proc.boundedLaunch('/usr/bin/claude', AWKWARD);
    assert.equal(cmd, '/bin/sh');
    assert.equal(args[0], '-c');
    assert.equal(args[1], 'ulimit -f "$1"; shift; exec "$@"', 'the script changed — or an argument was interpolated into it');
    assert.equal(args[2], 'sh', '$0 must be a placeholder, or the first argument is eaten as the script name');
    // 512-byte blocks on linux, 1024 on darwin, whose /bin/sh counts them so (ci-path-identity.plan.md stage 3b).
    const block = name === 'darwin' ? 1024 : 512;
    assert.equal(args[3], String(4 * GiB / block), `the ceiling is not 4 GiB in ${block}-byte blocks`);
    assert.deepEqual(args.slice(4), ['/usr/bin/claude', ...AWKWARD], 'an argument was altered, dropped or reordered');
    assert.equal(ceilingBytes, 4 * GiB);
    for (const a of AWKWARD.filter(Boolean)) assert.ok(!args[1].includes(a), `"${a}" reached the script text`);
  });
}

test('stage 5 (win32): no ceiling applies, the command is unchanged, and that is said as null', () => {
  const proc = IMPLEMENTATIONS.win32.proc;
  assert.equal(typeof proc.boundedLaunch, 'function', 'the platform does not declare whether a ceiling applies');
  const r = proc.boundedLaunch('claude.exe', AWKWARD);
  assert.deepEqual(r, { cmd: 'claude.exe', args: AWKWARD, ceilingBytes: null });
  assert.notEqual(r.args, AWKWARD, 'the caller\'s array is handed back to be mutated');
});

test('stage 5: spawn-node records the ceiling that applied to its child', (t) => {
  const { base, dir } = repoRunDir({ runId: '20260101-000000-ceiling' });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'node-settings.json'), JSON.stringify({ permissions: { defaultMode: 'manual', allow: [], deny: [] } }));
  const fake = path.join(base, 'fake-claude.mjs');
  fs.writeFileSync(fake, `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, num_turns: 1, result: JSON.stringify({ verdict: 'PASS', findings: [], not_checked: [] }) }));\n`);
  runScript('spawn-node.mjs', ['--run-dir', dir, '--repo-root', REPO_ROOT, '--node-id', 'code-audit', '--mode', 'lens',
    '--prompt', 'x', '--allowed-basis', 'convention', '--timeout-minutes', '1', '--runtime-bin', fake]);
  const status = JSON.parse(fs.readFileSync(path.join(dir, 'nodes', 'code-audit.status.json'), 'utf8'));
  assert.ok('file_size_ceiling_bytes' in status, 'the status does not say whether a ceiling applied');
  assert.equal(status.file_size_ceiling_bytes, POSIX ? 4 * GiB : null);
  assert.equal(status.exit_code, 0, 'the bounded launch broke an ordinary child');
});

// ------------------------------------------------------------------------------------------------- real, posix
test('stage 5 (posix): the arguments arrive at the child exactly as given, through the real shell', { skip: POSIX_ONLY }, () => {
  const { cmd, args } = IMPLEMENTATIONS[process.platform === 'darwin' ? 'darwin' : 'linux'].proc.boundedLaunch(
    process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...AWKWARD]);
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), AWKWARD);
});

test('stage 5 (posix): a child writing past the ceiling is stopped by the kernel, and the file stops at the ceiling', { skip: POSIX_ONLY, timeout: 30_000 }, async (t) => {
  const d = tmp(t, 'q-ceiling-');
  const CEILING = 64 * 1024;
  const proc = IMPLEMENTATIONS[process.platform === 'darwin' ? 'darwin' : 'linux'].proc;
  // A writer that would go on to 8 MiB: past a 64 KiB ceiling, and far below anything that could hurt the disk if the
  // ceiling did not hold (the output cap is set out of reach, so only the ceiling can stop it).
  const writer = `const c = 'x'.repeat(4096); let n = 0; const w = () => { if (n++ < 2048) process.stdout.write(c, w); }; w();`;
  const { cmd, args, ceilingBytes } = proc.boundedLaunch(process.execPath, ['-e', writer], { ceilingBytes: CEILING });
  assert.equal(ceilingBytes, CEILING);
  const stdoutPath = path.join(d, 'out');
  const res = await runChild({
    cmd, args, cwd: d, env: process.env, stdoutPath, stderrPath: path.join(d, 'err'),
    timeoutMs: 20_000, outputCapBytes: 1024 * 1024 * 1024, spawnOptions: proc.killableSpawnOptions(),
  });
  const size = fs.statSync(stdoutPath).size;
  assert.ok(size <= CEILING, `the file grew to ${size} bytes past a ${CEILING}-byte ceiling`);
  assert.ok(size > 0, 'the child never wrote at all, so nothing was tested');
  // FROM BELOW TOO (ci-path-identity.plan.md stage 3b): the ceiling's block size was wrong on macOS by a factor of two.
  // A shell counting 512 where 1024 was assumed would stop the file at half, which the upper bound alone cannot see.
  assert.ok(size > CEILING / 2, `the file stopped at ${size} bytes, half or less of the ${CEILING}-byte ceiling: the block size is wrong`);
  assert.equal(res.timedOut, false, 'the child was ended by the clock, not by the ceiling');
  assert.ok(res.signal === 'SIGXFSZ' || (res.exitCode ?? 0) !== 0, `the writer was not stopped: ${JSON.stringify(res)}`);
});
