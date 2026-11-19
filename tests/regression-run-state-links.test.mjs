// G-4 of 20261105-013235-ar-d1-c-remediation-review: runFolder compared lexical paths only, so an engine home that is a
// link into the repository passed the in-repository refusal, and a link standing at session-runs below the home sent the
// run's state outside it. Junctions are used, so the test runs on Windows without privilege; elsewhere, directory symlinks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runFolder } from '../scripts/io/run-state.mjs';

const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');

test('G-4: a home that is a link into the repository is refused', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsl-')));
  try {
    const repo = path.join(base, 'repo'); fs.mkdirSync(path.join(repo, 'inside'), { recursive: true });
    const home = path.join(base, 'home'); link(path.join(repo, 'inside'), home);
    assert.throws(() => runFolder(repo, { home }), /inside the repository/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('G-4: a link at session-runs below the home is refused', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsl-')));
  try {
    const repo = path.join(base, 'repo'); fs.mkdirSync(repo);
    const home = path.join(base, 'home'); fs.mkdirSync(home);
    const outside = path.join(base, 'outside'); fs.mkdirSync(outside);
    link(outside, path.join(home, 'session-runs'));
    assert.throws(() => runFolder(repo, { home }), /link/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('G-4: a plain home outside the repository is admitted', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsl-')));
  try {
    const repo = path.join(base, 'repo'); fs.mkdirSync(repo);
    const home = path.join(base, 'home');
    assert.ok(runFolder(repo, { home }).startsWith(path.join(home, 'session-runs')));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
