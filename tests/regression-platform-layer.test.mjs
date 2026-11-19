// .claude/requests/os-platform-adapters.md, stage 1: the platform layer exists, every operating
// system implements its interface, and an unsupported one is an error — learned at install and
// pre-flight rather than mid-review.
//
// All three implementations are plain modules, so every one of them is loaded and checked on EVERY
// host. A win32-only branch that nobody runs on win32 is how a platform-specific defect survives a
// green suite on the other two.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { interfaceGaps } from '../scripts/platform/interface.mjs';
import { loadPlatform, IMPLEMENTATIONS, UnsupportedPlatformError } from '../scripts/platform/index.mjs';
import { win32 } from '../scripts/platform/win32/index.mjs';
import { linux } from '../scripts/platform/linux/index.mjs';
import { macos } from '../scripts/platform/macos/index.mjs';
import { posixProc } from '../scripts/platform/posix/index.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const PLATFORM_DIR = path.join(ROOT, 'scripts', 'platform');

test('criteria 1 and 12: one folder per operating system, plus common and posix', () => {
  for (const d of ['common', 'posix', 'win32', 'linux', 'macos']) {
    assert.ok(fs.existsSync(path.join(PLATFORM_DIR, d, 'index.mjs')), `scripts/platform/${d}/ exists`);
  }
});

test('criterion 3: every operating system implements the whole interface', () => {
  for (const impl of [win32, linux, macos]) {
    assert.deepEqual(interfaceGaps(impl), [], `${impl.name} implements the interface`);
  }
  // The check can fail — an interface check that passes everything is not one.
  assert.ok(interfaceGaps({ id: 'x' }).length > 10, 'an empty implementation is reported with every gap');
});

test('criterion 8: an operating system with no implementation is an error naming it', () => {
  assert.throws(() => loadPlatform('freebsd'), (e) => e instanceof UnsupportedPlatformError
    && e.platform === 'freebsd' && /freebsd/.test(e.message));
  // Not a fallback: a near relative of a supported OS is refused too.
  assert.throws(() => loadPlatform('openbsd'), UnsupportedPlatformError);
});

test('Node\'s names map to the folders, and each supported id loads', () => {
  assert.equal(loadPlatform('win32').name, 'win32');
  assert.equal(loadPlatform('linux').name, 'linux');
  assert.equal(loadPlatform('darwin').name, 'macos');
  // `id` stays Node's name because reviewers.json keys tool grants by process.platform values.
  assert.equal(loadPlatform('darwin').id, 'darwin');
  assert.deepEqual(Object.keys(IMPLEMENTATIONS).sort(), ['darwin', 'linux', 'win32']);
});

test('the per-OS facts are the behaviours the engine has today', () => {
  // Case: NTFS and APFS fold case by default, ext4 does not (G-8 of 20260924-172034-post-med4).
  assert.deepEqual([win32.caseInsensitiveFs, linux.caseInsensitiveFs, macos.caseInsensitiveFs], [true, false, true]);
  // Detached: the POSIX group kill needs a new process group; on Windows `detached` means a new console.
  assert.deepEqual([win32, linux, macos].map((p) => p.proc.killableSpawnOptions().detached), [false, true, true]);
  // npm shims need a shell only on Windows.
  assert.deepEqual([win32.needsShellForShims, linux.needsShellForShims, macos.needsShellForShims], [true, false, false]);
  // Transient rename errors are retried only on Windows — the set lib/atomic.mjs has today.
  assert.deepEqual([...win32.transientRenameCodes].sort(), ['EACCES', 'EBUSY', 'EPERM']);
  assert.equal(linux.transientRenameCodes.size + macos.transientRenameCodes.size, 0);
});

test('criterion 9: the tree kill linux and macos share is written ONCE, and neither OS imports the other', () => {
  assert.equal(linux.proc.killTree, posixProc.killTree, 'linux uses the posix implementation');
  assert.equal(macos.proc.killTree, posixProc.killTree, 'macos uses the same function, not a copy');
  assert.notEqual(win32.proc.killTree, posixProc.killTree, 'win32 has its own');
  for (const [os, other] of [['linux', 'macos'], ['macos', 'linux']]) {
    const src = fs.readFileSync(path.join(PLATFORM_DIR, os, 'index.mjs'), 'utf8');
    assert.doesNotMatch(src, new RegExp(`from '\\.\\./${other}/`), `${os}/ does not import ${other}/`);
  }
});

test('criterion 7: inside the layer, only index.mjs tests the operating system', () => {
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs') && p !== path.join(PLATFORM_DIR, 'index.mjs')
        && /process\.platform/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(ROOT, p));
    }
  };
  walk(PLATFORM_DIR);
  assert.deepEqual(offenders, [], 'an implementation that re-tests the OS has two owners for one decision');
});

// Criterion 11, BEHAVIOURALLY: the real scripts, started as if on an unsupported operating system.
// `--import` preloads a module that redefines process.platform before the script's own code runs.
const AS_FREEBSD = 'data:text/javascript,Object.defineProperty(process,"platform",{value:"freebsd"})';

for (const script of ['check-install.mjs', 'preflight.mjs']) {
  test(`criterion 11: ${script} stops on an unsupported operating system, naming it`, () => {
    const r = spawnSync(process.execPath, ['--import', AS_FREEBSD, path.join(ROOT, 'scripts', script)], {
      cwd: ROOT, encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(r.status, 2, `${script} exits 2 — stderr: ${r.stderr}`);
    assert.match(r.stderr, /does not support the operating system 'freebsd'/);
  });
}

// Criterion 2, stage 2: the engine outside the platform layer is OS-independent. Comment lines are
// excluded — explaining WHY a behaviour is per-OS is documentation, not a branch.
test('criterion 2: no engine file outside scripts/platform/ reads process.platform', () => {
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (p !== PLATFORM_DIR) walk(p); continue; }
      if (!/\.(mjs|js)$/.test(e.name)) continue;
      fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/process\.platform/.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${path.relative(ROOT, p)}:${i + 1}`);
      });
    }
  };
  walk(path.join(ROOT, 'scripts'));
  walk(path.join(ROOT, '.claude', 'hooks'));
  assert.deepEqual(offenders, [], 'decide through hostPlatform() (scripts) or a platform parameter (lib/)');
});

// Criterion 7: the operating system is tested ONCE per process. check-install and preflight called
// loadPlatform() for their early check while everything after them called hostPlatform(), which
// loaded it a second time — the check and the instance were two different events. Only the layer
// itself calls loadPlatform; everything else goes through the memoised hostPlatform().
test('criterion 7: only the platform layer calls loadPlatform; everything else reuses hostPlatform()', () => {
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (p !== PLATFORM_DIR) walk(p); continue; }
      if (!/\.(mjs|js)$/.test(e.name)) continue;
      fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/loadPlatform\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${path.relative(ROOT, p)}:${i + 1}`);
      });
    }
  };
  walk(path.join(ROOT, 'scripts'));
  walk(path.join(ROOT, '.claude', 'hooks'));
  assert.deepEqual(offenders, []);
});
