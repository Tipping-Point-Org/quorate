// arms-read-surface, Stage 3 (plan; request criteria 2 and 8). In a consumer's mount the framework is a
// submodule, so the arms' snapshot holds only its pointer and the framework is COPIED into the arms'
// directory by copyTrackedInto. That copy must pass the same source check as the snapshot — including
// the hard-link case it lacked — and its listing must not fail on output size (G-3 of
// 20260926-060936-m0-close-r3, the same defect as the snapshot's listing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyTrackedInto } from '../scripts/io/worktree.mjs';

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 30 });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
function framework(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-fw-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const src = path.join(d, 'framework');
  fs.mkdirSync(path.join(src, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(src, 'scripts', 'a.mjs'), 'a');
  git(src, 'init', '-q');
  return { d, src };
}

test('criterion 8: a framework file hard-linked to a file outside the framework is left out and named', (t) => {
  const { d, src } = framework(t);
  fs.writeFileSync(path.join(d, 'secret.txt'), 'OUTSIDE-HARD');
  fs.linkSync(path.join(d, 'secret.txt'), path.join(src, 'scripts', 'linked.txt'));
  git(src, 'add', '-A'); git(src, 'commit', '-qm', 'fw');
  const dest = path.join(d, 'dest');
  const r = copyTrackedInto(src, dest);
  assert.equal(r.ok, true, r.why);
  assert.equal(fs.existsSync(path.join(dest, 'scripts', 'linked.txt')), false, 'the outside bytes are not copied');
  assert.ok((r.refused ?? []).some((x) => x.rel === 'scripts/linked.txt' && /hard link/.test(x.why)), JSON.stringify(r.refused));
  assert.ok(fs.existsSync(path.join(dest, 'scripts', 'a.mjs')), 'the rest is copied');
});

// CRITERION 2, WITHOUT 12,000 FILES (test-suite-cost.md): every git spawn in worktree.mjs goes through the one capped
// helper, and copyTrackedInto honours the cap it is given — a 16-byte one fails, the default copies.
test('criterion 2: the framework copy\'s listing is capped, and the cap is honoured', (t) => {
  const { d, src } = framework(t);
  const mod = fs.readFileSync(new URL('../scripts/io/worktree.mjs', import.meta.url), 'utf8');
  // Through the engine's one git owner since engine-git-env stage 2, so no direct spawn is left beside the helper.
  assert.equal(mod.split('\n').filter((l) => /spawnSync\('git'/.test(l)).length, 0, 'a direct git spawn in worktree.mjs');
  const direct = mod.split('\n').filter((l) => /\bgitSync\(/.test(l));
  assert.equal(direct.length, 1, `one capped git spawn in worktree.mjs, found: ${direct.map((l) => l.trim()).join(' | ')}`);
  assert.match(direct[0], /maxBuffer/);
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(src, 'scripts', `f${i}.mjs`), '');
  git(src, 'add', '-A'); git(src, 'commit', '-qm', 'fw');
  assert.equal(copyTrackedInto(src, path.join(d, 'tiny'), { listingMaxBuffer: 16 }).ok, false, 'a 16-byte cap was not honoured');
  const r = copyTrackedInto(src, path.join(d, 'dest'));
  assert.equal(r.ok, true, r.why);
  assert.equal(fs.readdirSync(path.join(d, 'dest', 'scripts')).filter((n) => /^f\d+\.mjs$/.test(n)).length, 20);
});

// CRITERION 2's cap, under load (ledgered 2026-10-27 as intermittent, then failing two full runs in a row): past maxBuffer
// spawnSync sets error ENOBUFS and kills git, but a git that had already exited keeps status 0 with its whole output, and
// copyTrackedInto read status alone. Measured on a 20-file listing with a 16-byte cap: all 1,150 bytes, ENOBUFS every
// time, status null only when the kill landed first. The race cannot be forced, so the rule is pinned on that shape.
test('criterion 2: a git spawn that erred past its cap never reads as a success, whatever its status', async () => {
  const { erredIsFailure } = await import('../scripts/lib/spawn-result.mjs');
  const raced = { status: 0, signal: null, error: Object.assign(new Error('spawnSync git ENOBUFS'), { code: 'ENOBUFS' }), stdout: 'x'.repeat(1150) };
  assert.equal(erredIsFailure(raced).status, null, 'an ENOBUFS result with status 0 read as a success');
  assert.equal(erredIsFailure({ status: 0, error: undefined }).status, 0, 'a clean exit is untouched');
  assert.equal(erredIsFailure({ status: 128, error: raced.error }).status, 128, 'a failure keeps its own status');
  const owner = fs.readFileSync(new URL('../scripts/io/git.mjs', import.meta.url), 'utf8');
  assert.match(owner, /const run = \(args, opts, commit\) => erredIsFailure\(spawnSync\('git'/, 'the git owner does not apply the rule');
});
