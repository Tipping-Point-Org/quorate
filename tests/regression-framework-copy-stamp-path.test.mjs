// G-10 of 20261121-233915-m3s7-b2-review: copyTrackedInto wrote the source checkout's absolute path, verbatim, as
// `copied_from` in .quorate-source.json, inside the directory the external reviewers read, so the operator's local
// path went to the panel's vendors. No reader uses it (lib/version.mjs reads `commit` and `dirty`); the stamp keeps what
// tells a copy from a mount and drops the path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyTrackedInto } from '../scripts/io/worktree.mjs';

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};

test('G-10: the framework copy\'s source stamp does not carry the source checkout\'s path', (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-fw-stamp-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const src = path.join(d, 'framework-checkout');
  fs.mkdirSync(path.join(src, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(src, 'scripts', 'a.mjs'), 'a');
  git(src, 'init', '-q'); git(src, 'add', '-A'); git(src, 'commit', '-qm', 'fw');
  const dest = path.join(d, 'dest');
  const r = copyTrackedInto(src, dest);
  assert.equal(r.ok, true, r.why);
  const text = fs.readFileSync(path.join(dest, '.quorate-source.json'), 'utf8');
  const stamp = JSON.parse(text);
  assert.match(stamp.commit, /^[0-9a-f]{40}$/, 'the stamp still names the commit copied');
  for (const spelling of [src, src.replace(/\\/g, '/'), JSON.stringify(src).slice(1, -1), 'framework-checkout']) {
    assert.equal(text.includes(spelling), false, `the stamp carries the source path (${spelling})`);
  }
});
