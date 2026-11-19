// Which build of the framework produced a run.
//
// Step 2 of docs/plans/framework-extraction.md. Not a defect found in the field — a gap that only
// becomes visible with a second consumer: run.json recorded the contract, the base commit, the host
// and the auth mode, and nothing about the orchestrator. While the framework WAS the repository
// that was implicit. Once it is a submodule shared across projects, two projects can report
// different verdicts for identical code and the record cannot say why.
//
// The failure this guards against is not an absent stamp — it is a CONFIDENTLY WRONG one: reading
// the reviewed project's commit and labelling it the framework's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { frameworkStamp, stampIsAttributable } from '../scripts/io/version.mjs';
import { resolveFrameworkDirs } from '../scripts/io/locate.mjs';
import { SCRIPTS_DIR, withTempDir } from './helpers.mjs';

const dirs = resolveFrameworkDirs(SCRIPTS_DIR);

test('the stamp reports this framework, from the framework tree', () => {
  const s = frameworkStamp(dirs.frameworkRoot, { layout: dirs.layout });
  assert.equal(s.name, 'quorate');
  assert.match(s.version, /^\d+\.\d+\.\d+/, 'VERSION must hold a semver');
  assert.match(s.commit, /^[0-9a-f]{40}$/, 'a real commit, not a placeholder');
  assert.equal(typeof s.dirty, 'boolean');
  assert.equal(s.layout, dirs.layout);
});

// THE POINT OF THE WHOLE THING. The stamp must come from the framework's tree — never from
// whatever repository happens to be under review.
test('regression: the stamp does not read the reviewed project\'s commit', () => {
  withTempDir((dir) => {
    const run = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    run('init', '-q');
    run('config', 'user.email', 't@t');
    run('config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, 'README.md'), 'a different project\n');
    run('add', '-A');
    run('commit', '-qm', 'unrelated project');
    const otherHead = run('rev-parse', 'HEAD').stdout.trim();

    const s = frameworkStamp(dirs.frameworkRoot, { layout: dirs.layout });
    assert.notEqual(s.commit, otherHead,
      'the framework stamp must not follow the tree under review');
  });
});

// A missing VERSION or absent git metadata must degrade to a RECORDED unknown. A run that dies
// because the framework was installed from a tarball is worse than one that says so.
test('regression: unresolvable fields are recorded as unknown, never guessed', () => {
  withTempDir((dir) => {
    const s = frameworkStamp(dir);              // no VERSION, not a git repo
    assert.equal(s.version, 'unknown');
    assert.equal(s.commit, 'unknown');
    assert.equal(s.dirty, null, 'null means "nobody could check" — distinct from false');
    assert.equal(stampIsAttributable(s), false);
  });
});

test('dirty:null and dirty:false are distinguishable', () => {
  // A finding attributed to commit X, from a tree modified underneath it, is misattributed. So is
  // one where nobody looked. Those are different claims and must not collapse into one falsy value.
  assert.equal(stampIsAttributable({ commit: 'a'.repeat(40), dirty: false }), true);
  assert.equal(stampIsAttributable({ commit: 'a'.repeat(40), dirty: true }), false);
  assert.equal(stampIsAttributable({ commit: 'a'.repeat(40), dirty: null }), false);
});

test('regression: VERSION exists and is a bare semver', () => {
  const raw = fs.readFileSync(path.join(dirs.frameworkRoot, 'VERSION'), 'utf8');
  assert.match(raw.trim(), /^\d+\.\d+\.\d+$/,
    'the stamp, and later plugin.json, read this file — keep it a bare version string');
  assert.ok(raw.endsWith('\n'), 'trailing newline, so the file is diff-friendly');
});

// Guards the duplication that step 5 introduces: `.claude-plugin/plugin.json` will carry a version
// too, and two sources of truth drift. Inert until that file exists, then load-bearing.
test('when plugin.json exists, its version must equal VERSION', (t) => {
  const manifest = path.join(dirs.frameworkRoot, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifest)) { t.skip('plugin.json is absent'); return; }
  const version = fs.readFileSync(path.join(dirs.frameworkRoot, 'VERSION'), 'utf8').trim();
  const declared = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
  assert.equal(declared, version, 'plugin.json and VERSION must not drift');
});
