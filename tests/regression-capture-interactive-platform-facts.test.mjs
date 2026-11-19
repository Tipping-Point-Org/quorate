// HOW A COMMAND IS FOUND AND LAUNCHED IS THE PLATFORM'S TO SAY (G-5 of 20261116-221234-m2-9a-high-2).
// scripts/io/capture-interactive.mjs branched on `platform === 'win32'` in resolveCommand and launchFor: path.win32, a
// hard-coded PATHEXT default, and `.cmd`/`.bat` routed through cmd.exe, beside the platform's own needsShellForShims.
// ARCHITECTURE §2's Platform row puts what differs by operating system behind scripts/platform/; the module now reads
// the facts (pathFlavor, pathListDelimiter, executableExts, shimExts, needsShellForShims) from the implementation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { IMPLEMENTATIONS } from '../scripts/platform/index.mjs';
import { interfaceGaps, PLATFORM_FACTS } from '../scripts/platform/interface.mjs';
import { launchFor, resolveCommand } from '../scripts/io/capture-interactive.mjs';

test('the interface declares the command-search facts', () => {
  for (const k of ['pathFlavor', 'pathListDelimiter', 'executableExts', 'shimExts']) assert.ok(k in PLATFORM_FACTS, k);
});

test('every implementation states them', () => {
  for (const p of Object.values(IMPLEMENTATIONS)) assert.deepEqual(interfaceGaps(p), [], p.id);
  const { win32, linux, darwin } = IMPLEMENTATIONS;
  assert.equal(win32.pathFlavor, 'win32');
  assert.equal(win32.pathListDelimiter, ';');
  assert.deepEqual([...win32.executableExts], ['.COM', '.EXE', '.BAT', '.CMD']);
  assert.deepEqual([...win32.shimExts], ['.cmd', '.bat']);
  for (const p of [linux, darwin]) {
    assert.equal(p.pathFlavor, 'posix');
    assert.equal(p.pathListDelimiter, ':');
    assert.deepEqual([...p.executableExts], []);
    assert.deepEqual([...p.shimExts], []);
  }
});

test('capture-interactive names no operating system and carries no PATHEXT default', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'capture-interactive.mjs'), 'utf8');
  assert.doesNotMatch(src, /===\s*'win32'/);
  assert.doesNotMatch(src, /\.COM;\.EXE/);
  assert.doesNotMatch(src, /\\.\(cmd\|bat\)/);
});

test('a platform answered by its facts: darwin resolves as posix, win32 shims go through the shell', () => {
  const exists = (p) => p === '/usr/bin/git';
  assert.equal(resolveCommand('git', { cwd: '/w', env: { PATH: '/usr/bin' }, platform: 'darwin', exists }), '/usr/bin/git');
  const W = path.win32;
  const bin = W.join('C:', W.sep, 'bin');
  const shim = W.join(bin, 'npm.CMD');
  const l = launchFor(['npm', 'x'], { cwd: W.join('C:', W.sep, 'w'), env: { PATH: bin, PATHEXT: '.EXE;.CMD' }, platform: 'win32', exists: (p) => p === shim });
  assert.equal(l.resolved, shim);
  assert.equal(l.shell, true);
  // An .exe on the same platform takes no shell.
  const exe = W.join(bin, 'node.EXE');
  assert.equal(launchFor(['node', 'x'], { cwd: bin, env: { PATH: bin, PATHEXT: '.EXE;.CMD' }, platform: 'win32', exists: (p) => p === exe }).shell, false);
});
