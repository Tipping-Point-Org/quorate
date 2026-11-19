// G-9 of 20261114-195905-m2-pred1-remediation-2-review: the intent sandbox's forbidden source roots are each glob's cover
// prefix, and a directory inside a root was refused as exposing source. For a glob that matches only its own folder's
// files (`*.mjs`, `src/*.mjs`), that refused every subdirectory, none of whose files it matches: with a root-only glob the
// prefix is the repository root, so a plain doc directory such as shared/ was refused. A glob that reaches below its
// prefix (`**/*.mjs`, `src/**`) still forbids every directory inside it (tests/regression-intent-add-dir-leading-wildcard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRunDir, runScript, REPO_ROOT } from './helpers.mjs';
import { coversBelowPrefix } from '../scripts/lib/contract-glob.mjs';

function stagedRunDir(globs) {
  const { dir } = repoRunDir({ prefix: 'quorate-g9-', json: { contract: { source_globs: globs }, stamps: [] } });
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

test('which globs reach below their prefix', () => {
  assert.equal(coversBelowPrefix('*.mjs'), false);
  assert.equal(coversBelowPrefix('scripts/*.mjs'), false);
  assert.equal(coversBelowPrefix('**/*.mjs'), true);
  assert.equal(coversBelowPrefix('scripts/**'), true);
  assert.equal(coversBelowPrefix('scripts/*/x.mjs'), true);
  assert.equal(coversBelowPrefix('scripts'), true, 'a bare name may be a directory: everything below it');
});

test('G-9: a plain directory under a root-only glob is not refused as source', () => {
  const dir = stagedRunDir(['*.mjs']);
  try {
    const r = spawnIntent(dir, path.join(REPO_ROOT, 'shared'));
    assert.equal(r.status, 0, `shared/ holds no file '*.mjs' matches:\n${r.output.slice(-400)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('and a glob that reaches below its prefix beside it still forbids the directory', () => {
  const dir = stagedRunDir(['*.mjs', 'shared/**']);
  try {
    const r = spawnIntent(dir, path.join(REPO_ROOT, 'shared'));
    assert.notEqual(r.status, 0, `shared/** covers shared/:\n${r.output.slice(-400)}`);
    assert.match(r.output, /would expose the source tree/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
