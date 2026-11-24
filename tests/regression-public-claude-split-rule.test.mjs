// G-11 of 20261123-003125-m3s7-b4-remediation-review-b (I-3 of m3-stage7-fixes.md): the public CLAUDE.md restated the
// lens cap rule split across a line break ("it degrades to" / "convention-only, capped at RISK"), so restatementsIn, which
// reads one physical line at a time, could not see it. Each pair of adjacent comment lines is read as one line here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { restatementsIn } from '../scripts/lib/rule-text.mjs';

// WHICHEVER FILE IS THE PUBLIC CLAUDE.md (operator, 2026-11-24: "Tests read whichever is the public CLAUDE.md
// (Recommended)"): publish/CLAUDE.public.md in this repository, and CLAUDE.md in the public snapshot, which ships that file
// as its CLAUDE.md and has no publish/ folder (the publish manifest excludes it). Reading only publish/ made the snapshot's
// tests fail with ENOENT, and the publish refuse.
export const publicClaudeMd = (root) => (fs.existsSync(path.join(root, 'publish', 'CLAUDE.public.md')) ? 'publish/CLAUDE.public.md' : 'CLAUDE.md');

test('the public CLAUDE.md is publish/CLAUDE.public.md where publish/ exists, and CLAUDE.md in a tree without it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'q-public-claude-'));
  try {
    assert.equal(publicClaudeMd(tmp), 'CLAUDE.md', 'a tree with no publish/ (the snapshot) reads its own CLAUDE.md');
    fs.mkdirSync(path.join(tmp, 'publish'));
    fs.writeFileSync(path.join(tmp, 'publish', 'CLAUDE.public.md'), '# x\n');
    assert.equal(publicClaudeMd(tmp), 'publish/CLAUDE.public.md');
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
