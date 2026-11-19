// Remediation of review 20260927-052117-ars-r3 (the arms' directory, reviewed with the panel): each test
// names the group it pins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildArmsSurface } from '../scripts/io/snapshot.mjs';

const SECRET = 'OUTSIDE-CONTENT';
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
function sandbox(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-arsr3-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const outside = path.join(d, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'creds.txt'), SECRET);
  const repo = path.join(d, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  return { d, outside, repo, base: git(repo, 'rev-parse', 'HEAD') };
}
const build = (s, extra = {}) => buildArmsSurface({ repoRoot: s.repo, headCommit: git(s.repo, 'rev-parse', 'HEAD'),
  baseCommit: s.base, dir: path.join(s.d, 'arms'), maxBytes: 1n << 30n, ...extra });
/** Temporarily set environment variables for the builder, which inherits process.env. */
function withEnv(t, vars) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

test('G-4: a link at the base that the working state deleted is not in the base the arm is given', (t) => {
  const s = sandbox(t);
  // committed by plumbing (no link privilege needed): a 120000 entry whose target text is an outside path
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: s.repo, input: path.join(s.outside, 'creds.txt'), encoding: 'utf8' }).stdout.trim();
  git(s.repo, 'update-index', '--add', '--cacheinfo', `120000,${blob},gone.lnk`);
  git(s.repo, 'commit', '-qm', 'base with a link');
  s.base = git(s.repo, 'rev-parse', 'HEAD');
  git(s.repo, 'rm', '-q', '--cached', 'gone.lnk');
  git(s.repo, 'commit', '-qm', 'the link deleted');
  const r = build(s);
  assert.equal(r.ok, true, r.why);
  const listed = spawnSync('git', ['ls-tree', '-r', '--name-only', s.base], { cwd: r.dir, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.doesNotMatch(listed.stdout, /gone\.lnk/, 'the base the arm reads still holds the link entry');
});

test('G-6: the arm keeps its diff when the global git config turns replace refs off', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.repo, 'a.txt'), 'changed');
  const r = build(s);
  assert.equal(r.ok, true, r.why);
  const cfg = path.join(s.d, 'global.gitconfig');
  fs.writeFileSync(cfg, '[core]\n\tuseReplaceRefs = false\n');
  const diff = spawnSync('git', ['diff', '--stat', s.base, 'HEAD'], { cwd: r.dir, encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: cfg } });
  assert.equal(diff.status, 0, `the arm's diff against the base fails: ${diff.stderr}`);
  assert.match(diff.stdout, /a\.txt/);
});

test('G-7: a configured git template does not reach the arms\' repository', (t) => {
  const s = sandbox(t);
  const tmpl = path.join(s.d, 'template');
  fs.mkdirSync(tmpl);
  fs.writeFileSync(path.join(tmpl, 'from-template'), SECRET);
  withEnv(t, { GIT_TEMPLATE_DIR: tmpl });
  const r = build(s);
  assert.equal(r.ok, true, r.why);
  assert.equal(fs.existsSync(path.join(r.dir, '.git', 'from-template')), false, 'the template was copied into the arms\' .git');
});

test('G-7: the final check looks inside .git too', (t) => {
  const s = sandbox(t);
  const r = build(s, { beforeAssert: (dir) => { fs.linkSync(path.join(s.outside, 'creds.txt'), path.join(dir, '.git', 'planted')); } });
  assert.equal(r.ok, false, 'a hard link inside .git passed the final check');
  assert.match(r.why, /hard link/);
});

test('G-2: a file name that is not valid UTF-8 is left out and named, and the build still succeeds', { skip: (process.platform === 'win32' && 'NTFS names are UTF-16; no non-UTF-8 name can exist')
  || (process.platform === 'darwin' && 'APFS refuses a name that is not valid UTF-8 (EILSEQ, CI run 44220656481); no such name can exist') }, (t) => {
  const s = sandbox(t);
  const raw = Buffer.concat([Buffer.from(s.repo + path.sep), Buffer.from([0x62, 0x61, 0x64, 0xff, 0x2e, 0x74, 0x78, 0x74])]);  // "bad\xff.txt"
  fs.writeFileSync(raw, 'bad name');
  const r = build(s);
  assert.equal(r.ok, true, r.why);
  assert.ok(r.withheld.some((w) => /UTF-8/.test(w.why)), JSON.stringify(r.withheld));
  const shown = fs.readdirSync(r.dir);
  assert.deepEqual(shown.filter((n) => n.startsWith('bad')), [], 'the undecodable name was written into the arms\' directory');
});
