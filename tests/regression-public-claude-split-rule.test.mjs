// G-11 of 20261123-003125-m3s7-b4-remediation-review-b (I-3 of m3-stage7-fixes.md): the public CLAUDE.md restated the
// lens cap rule split across a line break ("it degrades to" / "convention-only, capped at RISK"), so restatementsIn, which
// reads one physical line at a time, could not see it. Each pair of adjacent comment lines is read as one line here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, publishedFormIn } from './helpers.mjs';
import { gitSync } from '../scripts/io/git.mjs';
import { restatementsIn } from '../scripts/lib/rule-text.mjs';

// WHICHEVER FILE IS THE PUBLIC CLAUDE.md (operator, 2026-11-24: "Tests read whichever is the public CLAUDE.md
// (Recommended)"): publish/CLAUDE.public.md in this repository, and CLAUDE.md in the public snapshot, which ships
// publish/manifest.json but not publish/CLAUDE.public.md, whose text it ships as CLAUDE.md. Reading only publish/ made the
// snapshot's tests fail with ENOENT, and the publish refuse. helpers.mjs's publishedFormIn owns which tree is which.
export const publicClaudeMd = (root) => publishedFormIn(root, 'CLAUDE.md');

// G-2 and G-4 of 20261125-004142-m3-pr10-review: the source's own presence chose the tree, so a source tree that lost
// publish/CLAUDE.public.md read its private CLAUDE.md and passed. The snapshot ships publish/manifest.json without the
// source; a source tree is the one where a folder the manifest excludes stands, and there a missing source is refused.
test('the public CLAUDE.md is publish/CLAUDE.public.md in a source tree, CLAUDE.md in the snapshot, and refused when a source tree lost it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'q-public-claude-'));
  try {
    assert.equal(publicClaudeMd(tmp), 'CLAUDE.md', 'a tree with no publish/ reads its own CLAUDE.md');
    fs.mkdirSync(path.join(tmp, 'publish'));
    fs.writeFileSync(path.join(tmp, 'publish', 'manifest.json'),
      JSON.stringify({ exclude: ['.claude/requests'], replace: { 'CLAUDE.md': 'publish/CLAUDE.public.md' } }));
    assert.equal(publicClaudeMd(tmp), 'CLAUDE.md', 'the snapshot (publish/manifest.json, no excluded folder, no source) reads its CLAUDE.md');
    fs.mkdirSync(path.join(tmp, '.claude', 'requests'), { recursive: true });
    assert.throws(() => publicClaudeMd(tmp), /publish\/CLAUDE\.public\.md/,
      'a source tree (an excluded folder stands) with publish/CLAUDE.public.md missing must be refused, not read as CLAUDE.md');
    fs.writeFileSync(path.join(tmp, 'publish', 'CLAUDE.public.md'), '# x\n');
    assert.equal(publicClaudeMd(tmp), 'publish/CLAUDE.public.md');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// G-1 and G-4 of 20261125-013403-m3-pr10-remediation-review: a SOURCE TREE was one where an excluded path stood on disk,
// so a published checkout that acquired one through use (an archived run's .claude/reviews, untracked) read as a source
// tree and was refused for the publish/CLAUDE.public.md it deliberately does not ship. What git tracks decides: the
// snapshot tracks no excluded path and no replace source, a source tree tracks both, even after losing one from disk.
test('a published checkout that acquired an untracked excluded path is still the snapshot; a source tree is what git tracks', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'q-public-claude-git-'));
  const git = (...args) => { const r = gitSync(args, { cwd: tmp, encoding: 'utf8' }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); };
  try {
    git('init', '-q');
    fs.mkdirSync(path.join(tmp, 'publish'));
    fs.writeFileSync(path.join(tmp, 'publish', 'manifest.json'),
      JSON.stringify({ exclude: ['.claude/reviews', '.claude/requests'], replace: { 'CLAUDE.md': 'publish/CLAUDE.public.md' } }));
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# published\n');
    git('add', '-A');
    fs.mkdirSync(path.join(tmp, '.claude', 'reviews', 'run-1'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', 'reviews', 'run-1', 'gate.md'), 'x\n');
    assert.equal(publicClaudeMd(tmp), 'CLAUDE.md',
      'a snapshot with an untracked .claude/reviews of its own is still the snapshot, and reads its CLAUDE.md');
    fs.mkdirSync(path.join(tmp, '.claude', 'requests'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', 'requests', 'r.md'), 'x\n');
    fs.writeFileSync(path.join(tmp, 'publish', 'CLAUDE.public.md'), '# public\n');
    git('add', '-A');
    assert.equal(publicClaudeMd(tmp), 'publish/CLAUDE.public.md', 'a tree tracking an excluded path is a source tree');
    fs.rmSync(path.join(tmp, 'publish', 'CLAUDE.public.md'));
    assert.throws(() => publicClaudeMd(tmp), /publish\/CLAUDE\.public\.md/,
      'a source tree that lost publish/CLAUDE.public.md from disk must be refused, not read as CLAUDE.md');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the public CLAUDE.md restates no owned rule across two adjacent comment lines', () => {
  const file = publicClaudeMd(REPO_ROOT);
  const lines = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').split(/\r?\n/);
  const found = [];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const [a, b] = [lines[i], lines[i + 1]];
    if (!/^\s*#/.test(a) || !/^\s*#/.test(b)) continue;
    const joined = `${a.replace(/\s+$/, '')} ${b.replace(/^\s*#\s*/, '')}`;
    for (const r of restatementsIn(`${joined}\n`, file)) found.push(`${file}:${i + 1}-${i + 2} rule:${r.id}: ${r.text}`);
  }
  assert.deepEqual(found, []);
});
