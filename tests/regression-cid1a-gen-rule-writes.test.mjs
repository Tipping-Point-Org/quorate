// G-4 of 20261022-013653-cid1a-delivery: gen-rule-text wrote each stale file with a bare writeFileSync INSIDE the loop
// that was still parsing the later files, so a malformed region further down the list exited 2 with the earlier files
// already rewritten; and it followed a symbolic link to wherever it pointed, outside --root included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, makeLink } from './helpers.mjs';

const OPEN = '<!-- rule:degraded-cap subject="`arch-review`, degraded" verdict_ceiling="RISK" severity_ceiling="MEDIUM" -->';
const CLOSE = '<!-- /rule:degraded-cap -->';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-gen-rule-w-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]',
    'doc_paths: ["docs/**"]', 'test_globs: ["tests/**"]'].join('\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  fs.mkdirSync(path.join(dir, 'docs'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

test('a malformed region later in the list leaves every earlier stale file as it was', (t) => {
  const dir = fixture(t);
  const stale = `${OPEN}old words${CLOSE}\n`;
  fs.writeFileSync(path.join(dir, 'docs', 'a.md'), stale);
  fs.writeFileSync(path.join(dir, 'docs', 'z.md'), `${OPEN}never closed\n`);
  const r = runScript('gen-rule-text.mjs', ['--root', dir], { cwd: dir });
  assert.notEqual(r.status, 0, r.output);
  assert.equal(fs.readFileSync(path.join(dir, 'docs', 'a.md'), 'utf8'), stale, 'a.md was rewritten before the run failed');
});

test('a stale file reached through a symbolic link is refused, and its target is not written', (t) => {
  const dir = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-gen-rule-out-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const stale = `${OPEN}old words${CLOSE}\n`;
  fs.writeFileSync(path.join(outside, 'target.md'), stale);
  const link = makeLink(t, { target: path.join(outside, 'target.md'), at: path.join(dir, 'docs', 'link.md'), type: 'file' });
  if (!link) { t.skip('this platform cannot create a symbolic link here'); return; }
  const r = runScript('gen-rule-text.mjs', ['--root', dir], { cwd: dir });
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /link\.md/);
  assert.equal(fs.readFileSync(path.join(outside, 'target.md'), 'utf8'), stale, 'the link\'s target outside --root was written');
});

// G-4 of 20261022-025041-cid1a-remediation-review: the guard above spelled containment as "the relative path's first
// segment is '..'", and on win32 path.relative to another drive is an absolute path, so a file under a junction onto
// another volume passed it. Containment has one owner, escapesAfterRealpath (lib/finding-scope.mjs).
test('gen-rule-text asks the containment owner, which refuses a target on another drive', () => {
  const src = fs.readFileSync(new URL('../scripts/gen-rule-text.mjs', import.meta.url), 'utf8');
  assert.match(src, /escapesAfterRealpath\(/, 'gen-rule-text spells containment itself rather than asking its owner');
  assert.doesNotMatch(src, /\[0\] === '\.\.'/, 'a leading-.. test misses a relative path that is absolute');
});

test('the containment owner refuses a real path on another drive', { skip: process.platform !== 'win32' && 'drive letters are win32' }, async () => {
  const { escapesAfterRealpath } = await import('../scripts/lib/finding-scope.mjs');
  const real = { 'F:\\repo': 'F:\\repo', 'F:\\repo\\docs\\a.md': 'D:\\elsewhere\\a.md' };
  const io = { fs: { realpathSync: (p) => real[p], readFileSync: () => { throw new Error('not read'); } } };
  assert.equal(escapesAfterRealpath('F:\\repo', 'F:\\repo\\docs\\a.md', io), true);
});
