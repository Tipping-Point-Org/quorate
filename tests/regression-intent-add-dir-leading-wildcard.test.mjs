// G-25 (and its symptom G-26) of 20261114-174045-m2-pred1-review, I-3 of its intent: spawn-node derived the intent
// sandbox's forbidden source roots as `source_globs.map(coverPrefix).filter(Boolean)`. A glob that starts with a wildcard
// (`**/*.mjs`) has the empty prefix, which `filter(Boolean)` dropped with no record, so for such a contract no source root
// was checked at all: an --add-dir inside the repository, or a link in the floor onto the source tree, passed every guard.
// The empty prefix is the repository root, the root such a glob covers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRunDir, runScript, REPO_ROOT } from './helpers.mjs';

function stagedRunDir() {
  const { dir } = repoRunDir({ prefix: 'quorate-g25-', json: { contract: { source_globs: ['**/*.mjs'] }, stamps: [] } });
  fs.mkdirSync(path.join(dir, 'sandbox', 'intent-capture'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'intent-settings.json'), JSON.stringify({ permissions: { deny: ['Grep'] } }));
  return dir;
}

function spawnIntent(dir, addDir) {
  return runScript('spawn-node.mjs', [
    '--run-dir', dir, '--repo-root', REPO_ROOT,
    '--node-id', 'intent-capture', '--mode', 'intent', '--prompt', 'x',
    '--settings', path.join(dir, 'intent-settings.json'),
    '--add-dir', addDir,
    '--print-cmd',
  ]);
}

test('G-25: a link in the floor onto source is refused when the source glob starts with a wildcard', () => {
  const dir = stagedRunDir();
  const floor = path.join(dir, 'sandbox', 'intent-capture');
  const link = path.join(floor, 'src');
  try {
    fs.symlinkSync(path.join(REPO_ROOT, 'scripts'), link, process.platform === 'win32' ? 'junction' : 'dir');
    const r = spawnIntent(dir, floor);
    assert.notEqual(r.status, 0, `a link onto scripts/ under a '**/*.mjs' contract must be refused:\n${r.output.slice(-400)}`);
    assert.match(r.output, /source tree/);
  } finally {
    try { fs.unlinkSync(link); } catch { /* not made */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('G-25: a directory inside the repository is refused when the source glob starts with a wildcard', () => {
  const dir = stagedRunDir();
  try {
    const r = spawnIntent(dir, path.join(REPO_ROOT, 'scripts'));
    assert.notEqual(r.status, 0, `scripts/ under a '**/*.mjs' contract exposes source:\n${r.output.slice(-400)}`);
    assert.match(r.output, /would expose the source tree/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('and the sandbox floor itself is still admitted', () => {
  const dir = stagedRunDir();
  try {
    const r = spawnIntent(dir, path.join(dir, 'sandbox', 'intent-capture'));
    assert.equal(r.status, 0, `the floor must survive the guard:\n${r.output.slice(-400)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
