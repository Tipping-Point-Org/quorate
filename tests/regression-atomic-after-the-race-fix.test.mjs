// THE RACE FIX BROUGHT FOUR PROBLEMS OF ITS OWN (run 20260914-193203-branch-verify).
//
// The reconciler's words: "The atomic-write change fixes its races but introduces its own problems."
// Three of the four are cross-family corroborated, and every one is a consequence of the cure rather
// than of the disease:
//
//   G-17  Unique temp names removed the self-cleaning property the old fixed `${p}.tmp` had by
//         accident: the next write reclaimed it. Now a throw from writeFileSync or fsyncSync — ENOSPC,
//         EIO, or JSON.stringify on a cyclic object, which runs INSIDE the try — orphans a new file
//         every time, because only durableRename's failure branch removed the temp. The docstring
//         claimed the opposite: "it does not leave the scratch file behind".
//         (code-audit · opus, panel-codex-code, panel-codex-security — two families.)
//   G-15  It put `process.platform`, `Date.now()`, `process.pid` and a module-level `let tmpSeq` into
//         scripts/lib, where A-2 says a function reads nothing from module state or the environment
//         and takes what it needs as parameters. The convention was already in this very file:
//         `freeEvidenceName(dir, base, ext, exists = fs.existsSync)` — injected, with a default.
//   G-16  `while (Date.now() < until) {}` burns CPU for up to 5ms × (1+…+19) = 950 ms per contended
//         write, and the spinning waiter competes with the handle holder it is waiting on.
//         (perf-audit · opus and panel-codex-perf — two families.)
//   G-13  The docstring says EACCES "must surface on the first attempt" while TRANSIENT_RENAME
//         retries it, and cites "§6 treats as worse" for a hang-versus-crash ranking §6 does not
//         contain — §6 is a flat set of six invariants and "hang" is not one of them.
//
// G-13 is the same defect as G-1 in ARCHITECTURE.md, committed by the same author on the same day:
// a citation to something that is not there, written while fixing something else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { writeJsonAtomic, writeTextAtomic, tempFor, durableRename } from '../scripts/io/atomic.mjs';
import { win32 } from '../scripts/platform/win32/index.mjs';
import { linux } from '../scripts/platform/linux/index.mjs';

const withDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-atomic-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

// ---------------------------------------------------------------- G-17
test('a write that throws leaves no orphaned temp file', () => {
  withDir((dir) => {
    const p = path.join(dir, 'run.json');
    const cyclic = { name: 'run' };
    cyclic.self = cyclic;                     // JSON.stringify throws INSIDE the try

    assert.throws(() => writeJsonAtomic(p, cyclic), /circular|cyclic/i);
    assert.deepEqual(fs.readdirSync(dir), [],
      'the old fixed `${p}.tmp` was reclaimed by the next write; a unique name never is, so every '
      + 'failed write leaves litter a reader can mistake for the artifact');
  });
});

test('a failed write does not destroy the previous file', () => {
  withDir((dir) => {
    const p = path.join(dir, 'run.json');
    writeJsonAtomic(p, { good: true });
    const cyclic = {}; cyclic.self = cyclic;
    assert.throws(() => writeJsonAtomic(p, cyclic));
    assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { good: true },
      'the whole point of tmp/rename: a failed write leaves the old content intact');
    assert.deepEqual(fs.readdirSync(dir), ['run.json']);
  });
});

// ---------------------------------------------------------------- G-15
test('the environment is injected, not read from module scope', () => {
  // A-2: a lib function takes what it needs as a parameter. Proven by BEHAVIOUR — a caller can say
  // which platform it is on — rather than by reading the source for the absence of `process.`.
  const seen = [];
  const err = Object.assign(new Error('busy'), { code: 'EPERM' });
  const rename = () => { throw err; };

  // On a non-win32 platform the transient codes are NOT retried: one attempt, then rethrow.
  // The platform arrives as its implementation's facts (os-platform-adapters stage 2), not a name.
  assert.throws(() => durableRename('a.tmp', 'a', {
    transientCodes: linux.transientRenameCodes, rename, remove: () => {}, sleep: (ms) => seen.push(ms),
  }), /busy/);
  assert.deepEqual(seen, [], 'no backoff on a platform whose rename is atomic');

  // On win32 it retries and sleeps between attempts.
  assert.throws(() => durableRename('a.tmp', 'a', {
    transientCodes: win32.transientRenameCodes, rename, remove: () => {}, sleep: (ms) => seen.push(ms),
  }), /busy/);
  assert.ok(seen.length > 1, 'win32 retries the transient codes');
});

test('tempFor takes its entropy as parameters and stays unique', () => {
  const a = tempFor('x', { pid: 111, rand: () => 'aaaaaa' });
  const b = tempFor('x', { pid: 111, rand: () => 'bbbbbb' });
  assert.notEqual(a, b, 'two writers to one target must not choose one scratch name');
  assert.match(a, /^x\./);
  assert.match(a, /\.tmp$/);

  // No module-level counter: the same inputs give the same name, so nothing carries state between
  // calls. That is what A-2 asks for, and it also makes this testable without a filesystem.
  assert.equal(tempFor('x', { pid: 111, rand: () => 'aaaaaa' }), a,
    'a pure function of its inputs — a module-level `let` would make this differ');
});

// ---------------------------------------------------------------- G-16
test('the backoff does not busy-spin', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'atomic.mjs'), 'utf8')
    .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/while\s*\(\s*Date\.now\(\)/.test(src),
    'a spinning waiter competes for CPU with the handle holder it is waiting on, for up to 950 ms');
  assert.match(src, /Atomics\.wait/,
    'a synchronous sleep that actually yields — the callers are synchronous, so this must not become async');
});

// ---------------------------------------------------------------- G-13
test('the docstring does not contradict the code it describes', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'atomic.mjs'), 'utf8');
  const retried = [...src.matchAll(/TRANSIENT_RENAME = new Set\(\[([^\]]*)\]/g)][0]?.[1] ?? '';

  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    if (!retried.includes(code)) continue;
    assert.ok(!new RegExp(`${code}[^.]{0,120}must surface on the first attempt`).test(src),
      `${code} is in TRANSIENT_RENAME and therefore IS retried; the prose says it is not`);
  }
});

test('no citation to a ranking §6 does not contain', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'atomic.mjs'), 'utf8');
  assert.ok(!/§6 treats as worse/.test(src),
    '§6 is a flat set of six invariants — data_loss, credential_exposure, memory_unsafety, '
    + 'crash_on_valid_input, unbounded_resource_growth, silent_error_swallowing — with no ranking '
    + 'between them, and "hang" is not among them. Same defect as G-1 in ARCHITECTURE.md.');
});

// The race the whole change exists to fix must still be fixed.
test('the original race stays fixed', () => {
  withDir((dir) => {
    const p = path.join(dir, 'latest.txt');
    writeTextAtomic(p, 'a\n');
    writeTextAtomic(p, 'b\n');
    assert.equal(fs.readFileSync(p, 'utf8'), 'b\n');
    assert.deepEqual(fs.readdirSync(dir), ['latest.txt'], 'no scratch file survives a success either');
  });
});
