// .claude/requests/reviewer-path-entries.md (G-6 of 20261016-224651-sp-bugs-remediation-3b-review, reproduced 2026-10-17):
// a reviewer CLI launched by its bare name, with its credentials, from inside the reviewed tree, was resolved through a
// PATH entry that is relative (`.`) or leads into that tree (`npm run` adds `<project>\node_modules\.bin`), so a planted
// `codex.cmd` ran in its place. NoDefaultCurrentDirectoryInExePath (G-8) stops only cmd.exe's implicit lookup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shellLaunchEnv } from '../scripts/lib/reviewers.mjs';
import { cliVersion } from '../scripts/io/reviewer-probe.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const SRC = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const WIN = { id: 'win32', caseInsensitiveFs: true, caseInsensitiveEnv: true };
const POSIX = { id: 'linux', caseInsensitiveFs: false, caseInsensitiveEnv: false };
// These paths are spellings, not files: none resolves, so each is judged on its spelling.
const NO_LINKS = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };

test('AC1: relative, empty and in-tree entries are dropped, the rest kept in order (Windows spelling, case folded)', () => {
  const env = { Path: ['.', 'C:\\Tools', '', 'node_modules\\.bin', 'f:\\REPO\\node_modules\\.bin', '\\rooted-no-drive',
    'D:\\snap\\x', 'C:\\Windows\\System32'].join(';'), OTHER: 'kept' };
  const { env: out, dropped } = shellLaunchEnv(env, true, { platform: WIN, inside: ['F:\\repo', 'D:\\snap'], realpath: NO_LINKS });
  assert.equal(out.Path, 'C:\\Tools;C:\\Windows\\System32');
  assert.equal(dropped, 6);
  assert.equal(out.OTHER, 'kept');
  assert.equal(out.NoDefaultCurrentDirectoryInExePath, '1', 'the G-8 switch is still set under a shell');
});

test('AC1: the POSIX spelling, and no shell: the PATH is filtered all the same', () => {
  const env = { PATH: ['.', '/usr/bin', 'bin', '/repo/node_modules/.bin', '/repository-next-door/bin'].join(':') };
  const { env: out, dropped } = shellLaunchEnv(env, false, { platform: POSIX, inside: ['/repo'], realpath: NO_LINKS });
  assert.equal(out.PATH, '/usr/bin:/repository-next-door/bin', 'a sibling directory sharing a prefix is not inside');
  assert.equal(dropped, 3);
  assert.equal(out.NoDefaultCurrentDirectoryInExePath, undefined);
});

test('AC1: the rule is required, not optional: a caller that names no directories is refused', () => {
  assert.throws(() => shellLaunchEnv({ PATH: '/usr/bin' }, false), /inside/);
});

test('AC2: the version probe does not run a codex.cmd planted in the tree it stands in, with "." on PATH', { skip: process.platform !== 'win32' && 'cmd.exe resolution is Windows-only' }, (t) => {
  const tree = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-planted-')));
  fs.writeFileSync(path.join(tree, 'codex.cmd'), '@echo PLANTED-RAN\r\n');
  const cwd = process.cwd();
  process.chdir(tree);
  // Out of the tree before it is removed: Windows refuses to delete the directory a process stands in.
  t.after(() => { process.chdir(cwd); fs.rmSync(tree, { recursive: true, force: true }); });
  const env = { ...process.env, PATH: `.;${process.env.PATH ?? process.env.Path ?? ''}` };
  delete env.Path;
  const r = cliVersion({ cmd: 'codex', version_argv: ['--version'], needs_shell_on_windows: true },
    { versionMs: 30_000 }, { platform: hostPlatform(), env, inside: [tree] });
  assert.doesNotMatch(String(r.version ?? r.reason ?? ''), /PLANTED-RAN/, 'the planted file ran in the reviewer\'s place');
});

test('AC3: external-review launches the vendor with the filtered PATH, naming the repository and the snapshot', () => {
  const src = SRC('scripts/external-review.mjs');
  assert.match(src, /shellLaunchEnv\(reviewerScrubbedEnv, useShell, \{[^}]*inside: [^}]*\[[^\]]*surfaceDir/);
  assert.match(src, /const spawnOpts = \{[\s\S]*?env: launch\.env,/, 'the spawn does not use the filtered environment');
  assert.match(src, /if \(launch\.dropped\) console\.error\(/, 'the count of dropped entries is not said');
});

test('AC4: shellLaunchEnv\'s comment no longer claims the switch holds for every lookup', () => {
  const src = SRC('scripts/lib/reviewers.mjs');
  assert.doesNotMatch(src, /it holds for every lookup the shim's own cmd\.exe makes too/);
});

// G-5 of 20261017-060636-rpe-review: I-2 judges an entry by its real path. Compared on the spelling only, a directory
// outside the repository that is a link (a junction, on Windows) into it was kept, and a planted codex.cmd ran through it.
test('G-5: an entry outside every named directory that LINKS into one is dropped (a real junction or symlink)', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-path-link-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'bin'), { recursive: true });
  const link = path.join(base, 'tools');
  fs.symlinkSync(path.join(repo, 'bin'), link, process.platform === 'win32' ? 'junction' : 'dir');
  const sep = process.platform === 'win32' ? ';' : ':';
  const { env: out, dropped } = shellLaunchEnv({ PATH: [link, base].join(sep) }, false,
    { platform: hostPlatform(), inside: [repo], realpath: (p) => fs.realpathSync.native(p) });
  assert.equal(out.PATH, base, 'the linked entry was kept');
  assert.equal(dropped, 1);
});

test('G-5: a named directory reached through a link is compared by its real path too (Windows spelling)', () => {
  const real = { 'c:\\tools': 'F:\\repo\\bin', 'e:\\via-link': 'D:\\snap' };
  const realpath = (p) => { const r = real[p.toLowerCase()]; if (r) return r; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  const env = { Path: ['C:\\Tools', 'D:\\snap\\bin', 'C:\\Windows'].join(';') };
  const { env: out, dropped } = shellLaunchEnv(env, false, { platform: WIN, inside: ['F:\\repo', 'E:\\via-link'], realpath });
  assert.equal(out.Path, 'C:\\Windows');
  assert.equal(dropped, 2);
});

test('G-5: the real-path resolver is required, so a caller cannot judge on the spelling alone', () => {
  assert.throws(() => shellLaunchEnv({ PATH: '/usr/bin' }, false, { platform: POSIX, inside: ['/repo'] }), /realpath/);
});

// G-2 of 20261017-060636-rpe-review: I-1 names the operator's repository. Both launches named only process.cwd(), so run
// from a subdirectory an absolute entry elsewhere in the repository (<root>/node_modules/.bin) survived.
test('G-2: the version probe drops an entry in the repository when it stands in a subdirectory of it', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-path-top-')));
  const cwd = process.cwd();
  t.after(() => { process.chdir(cwd); fs.rmSync(base, { recursive: true, force: true }); });
  const init = spawnSync('git', ['init', '-q', base], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const bin = path.join(base, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(base, 'sub'));
  process.chdir(path.join(base, 'sub'));
  const seen = [];
  const spawn = (cmd, argv, opts) => { seen.push(opts.env.PATH); return { status: 0, stdout: 'v1\n', stderr: '' }; };
  const sep = process.platform === 'win32' ? ';' : ':';
  cliVersion({ cmd: 'codex', version_argv: ['--version'] }, { versionMs: 1000 },
    { spawn, platform: { ...hostPlatform(), needsShellForShims: false }, env: { PATH: [bin, os.tmpdir()].join(sep) } });
  assert.equal(seen[0], os.tmpdir(), 'an entry inside the git toplevel was kept');
});

test('G-2: external-review names the git toplevel among the directories the reviewer\'s PATH may not lead into', () => {
  const src = SRC('scripts/external-review.mjs');
  assert.match(src, /shellLaunchEnv\(reviewerScrubbedEnv, useShell, \{[^}]*inside: reviewerLaunchExclusions\(\[surfaceDir\]\)/);
});

// G-1 of 20261017-060636-rpe-review: the version probe did not name --surface, so it and the call filtered differently.
test('G-1: the preflight\'s version probe names the snapshot, as the call does', () => {
  const src = SRC('scripts/external-review.mjs');
  const call = src.slice(src.indexOf('cliVersion(ADAPTER, limits, {'), src.indexOf('if (!version.ok)'));
  assert.match(call, /inside: \[args\.surface && path\.resolve\(args\.surface\)\]\.filter\(Boolean\)/);
});

// G-4 of 20261017-060636-rpe-review: I-5 wants the dropped count said. The probe computed it and discarded it, so a
// preflight refused because the CLI was reachable only through a dropped entry did not say filtering caused it.
test('G-4: a failed version probe says how many PATH entries were left out', () => {
  const spawn = () => ({ error: Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }), status: null });
  const r = cliVersion({ cmd: 'codex', version_argv: ['--version'] }, { versionMs: 1000 },
    { spawn, platform: { ...hostPlatform(), needsShellForShims: false }, env: { PATH: 'relative-a' } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /1 PATH entry relative or inside the repository was left out/);
});

// G-6 of 20261017-064450-rpe-remediation-review: the repository root was asked of a bare `git`, launched before any PATH
// filtering, with the whole environment and no timeout, and a failed answer meant "no repository": run where `git` is not
// reachable, or is a planted one that exits non-zero, an entry elsewhere in the repository survived.
test('G-6: the repository is named from a subdirectory even when no git can be found on PATH', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-path-nogit-')));
  const cwd = process.cwd();
  const savedPath = process.env.PATH;
  t.after(() => { process.env.PATH = savedPath; process.chdir(cwd); fs.rmSync(base, { recursive: true, force: true }); });
  const init = spawnSync('git', ['init', '-q', base], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const bin = path.join(base, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(base, 'sub'));
  process.chdir(path.join(base, 'sub'));
  const empty = path.join(base, 'empty');
  fs.mkdirSync(empty);
  process.env.PATH = empty;
  const seen = [];
  const spawn = (cmd, argv, opts) => { seen.push(opts.env.PATH); return { status: 0, stdout: 'v1\n', stderr: '' }; };
  const sep = process.platform === 'win32' ? ';' : ':';
  cliVersion({ cmd: 'codex', version_argv: ['--version'] }, { versionMs: 1000 },
    { spawn, platform: { ...hostPlatform(), needsShellForShims: false }, env: { PATH: [bin, os.tmpdir()].join(sep) } });
  assert.equal(seen[0], os.tmpdir(), 'with git unreachable the repository was not named, and its entry was kept');
});

test('G-6: finding the repository launches nothing, so nothing PATH resolves runs before the filter', () => {
  const src = SRC('scripts/io/reviewer-probe.mjs');
  const fn = src.slice(src.indexOf('export function reviewerLaunchExclusions'), src.indexOf('export const launchRealpath'));
  assert.doesNotMatch(fn, /spawn/);
});

// G-10 of 20261017-064450-rpe-remediation-review: I-2 judges an existing entry by where it leads. The entry's spelling was
// compared as well, so a link inside the repository leading out of it was dropped; and only the first PATH-like key was
// filtered, so an environment carrying both PATH and Path launched with one of them untouched.
test('G-10: an entry spelled inside a named directory that leads outside it is kept (judged on its real path)', () => {
  const real = { 'f:\\repo\\tools': 'C:\\Tools' };
  const realpath = (p) => { const r = real[p.toLowerCase()]; if (r) return r; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  const env = { Path: ['F:\\repo\\tools', 'F:\\repo\\node_modules\\.bin', 'C:\\Windows'].join(';') };
  const { env: out, dropped } = shellLaunchEnv(env, false, { platform: WIN, inside: ['F:\\repo'], realpath });
  assert.equal(out.Path, 'F:\\repo\\tools;C:\\Windows');
  assert.equal(dropped, 1);
});

test('G-10: every PATH-like key is filtered where the environment ignores case', () => {
  const env = { PATH: ['.', 'C:\\Tools'].join(';'), Path: ['F:\\repo\\bin', 'C:\\Windows'].join(';') };
  const { env: out, dropped } = shellLaunchEnv(env, false, { platform: WIN, inside: ['F:\\repo'], realpath: NO_LINKS });
  assert.equal(out.PATH, 'C:\\Tools');
  assert.equal(out.Path, 'C:\\Windows');
  assert.equal(dropped, 2);
});

// G-8 of 20261017-064450-rpe-remediation-review: I-5 wants the dropped count said. A passing version probe returned only
// the version, and --preflight-only exits before the call that reports it, so a check could filter entries silently.
test('G-8: a passing version probe returns how many PATH entries were left out', () => {
  const spawn = () => ({ status: 0, stdout: 'v1\n', stderr: '' });
  const r = cliVersion({ cmd: 'codex', version_argv: ['--version'] }, { versionMs: 1000 },
    { spawn, platform: { ...hostPlatform(), needsShellForShims: false }, env: { PATH: 'relative-a' } });
  assert.equal(r.ok, true);
  assert.equal(r.dropped, 1);
});

// G-9 of 20261017-173539-rpe-remediation-3-review: an adapter with no version_argv returned before the PATH filter ran,
// so its preflight reported no dropped entries on every branch, failures and --preflight-only included.
test('G-9: an adapter that declares no version command still returns how many PATH entries were left out', () => {
  const spawn = () => { throw new Error('nothing is launched for an undeclared version command'); };
  const r = cliVersion({ cmd: 'codex' }, { versionMs: 1000 },
    { spawn, platform: { ...hostPlatform(), needsShellForShims: false }, env: { PATH: 'relative-a' } });
  assert.equal(r.ok, true);
  assert.equal(r.version, 'undeclared');
  assert.equal(r.dropped, 1);
});

test('G-8: --preflight-only says the dropped count before it exits', () => {
  const src = SRC('scripts/external-review.mjs');
  const block = src.slice(src.indexOf('if (args.preflightOnly) {', src.indexOf('await reviewerPreflight()')), src.indexOf('process.exit(0);', src.indexOf('await reviewerPreflight()')));
  assert.match(block, /if \(check\.dropped\) console\.error\(`external-review: \$\{droppedNote\(check\.dropped\)\}`\)/);
});

// G-12 of 20261017-064450-rpe-remediation-review: the doctrine called reviewerEnv() the single owner of the arm's
// environment after shellLaunchEnv began rewriting its PATH.
test('G-12: shared/external-reviewers.md names shellLaunchEnv as the owner of the reviewer\'s PATH', () => {
  const doc = SRC('shared/external-reviewers.md');
  const section = doc.slice(doc.indexOf('### What the arm\'s environment is'), doc.indexOf('Two rules follow'));
  assert.match(section, /`shellLaunchEnv\(\)` in `scripts\/lib\/reviewers\.mjs`/);
  assert.doesNotMatch(section, /is the single owner of that decision/);
});
