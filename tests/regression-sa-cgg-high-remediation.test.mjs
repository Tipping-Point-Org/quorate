// Remediation of run 20261001-031029-invoke-security-audit-cgg-high (operator's answer: "Fix the three introduced
// (Recommended)"): G-1, G-3 and G-4, each introduced by contract-glob-grammar's own stages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as rr from '../scripts/io/reviews-root.mjs';
import { confined } from '../scripts/io/confined-path.mjs';
import { createSnapshot, snapshotDocGlobs, pruneUnder } from '../scripts/io/doc-snapshot.mjs';
import { REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
const tmp = (t) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-sacgg-'))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

// G-3: git was asked about a stand-in named `.quorate-ignore-probe`; a .gitignore ignoring only dotfiles under evidence/
// said "ignored" while the real logs stayed trackable. Git is now asked about the run's actual evidence files.
test('G-3: evidence is archived only if git ignores every real evidence file, not a dotfile stand-in', (t) => {
  const root = tmp(t);
  const repo = path.join(root, 'repo');
  const reviews = path.join(repo, '.claude', 'reviews');
  fs.mkdirSync(reviews, { recursive: true });
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  const evidence = path.join(root, 'staged', 'run-1', 'evidence');
  fs.mkdirSync(path.join(evidence, 'node'), { recursive: true });
  fs.writeFileSync(path.join(evidence, 'node', 'test.log'), 'captured\n');
  fs.writeFileSync(path.join(reviews, '.gitignore'), '*/evidence/.*\n');   // only dotfiles under evidence/
  assert.equal(rr.evidenceIgnoredByGit(reviews, 'run-1', confined(path.dirname(evidence))), false, 'a dotfile-only rule was read as covering the logs');
  fs.writeFileSync(path.join(reviews, '.gitignore'), '*/evidence/\n');
  assert.equal(rr.evidenceIgnoredByGit(reviews, 'run-1', confined(path.dirname(evidence))), true, 'the full rule was not read as covering them');
  assert.doesNotMatch(read('scripts', 'io', 'reviews-root.mjs'), /\.quorate-ignore-probe/, 'the stand-in name is still asked about');
});

// G-4: the doc snapshot pruned the staging root but not the in-repository archive root, so a doc glob over
// .claude/reviews could copy archived runs' artifacts into the intent sandbox.
test('G-4: a doc glob over the archive root copies no archived run into the sandbox', (t) => {
  const d = tmp(t);
  for (const f of ['.claude/notes.md', '.claude/reviews/old-run/reconciled.md']) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), f);
  }
  const snapDir = path.join(d, '.snap');
  const snap = createSnapshot(snapDir);
  snapshotDocGlobs({ repoRoot: d, docPaths: ['.claude/**'], snap, prune: pruneUnder([path.join(d, 'staging'), path.join(d, '.claude', 'reviews')]) });
  const copied = fs.readdirSync(snapDir);
  assert.equal(copied.length, 1, `copied: ${copied.join(', ')}`);
  assert.ok(!copied.some((n) => /reconciled/.test(n)), 'an archived run reached the intent sandbox');
});

// REMOVED, both for the reason G-25 of 20261001-034021-cgg-remediation-review gave: they matched source text, so an
// equivalent rewrite failed them and a broken behaviour with the same spelling passed. The G-4 wiring test matched the
// `pruneUnder([...])` call in each caller; the roots are now decided inside snapshotIntentDocs, and
// regression-cgg-r2-remediation.test.mjs drives that on a real tree. The G-1 test matched the shape of the guarded
// readdirSync; the walk now takes its readdir as an argument, and the same file drives a failing one.
