// stdin-folder-owner.plan.md stages 1-3 (design SF-D1 A, SF-D2 A, operator 2026-11-10). io/stdin-file.mjs made each
// child's stdin folder in the SHARED temporary directory, so its stale-folder sweep had to guess from a name which
// folders were its own: G-4 of 20261110-022503-dps-remediation-4-review (any old `quorate-stdin-*` folder removed
// recursively, an unrelated `quorate-stdin-backup` with it) and G-6 of 20261110-025747-dps-remediation-5-review (narrowed
// to mkdtemp's shape and a content test, which `backup`, six letters, empty or holding a `stdin` file, still passes).
// Now each call's folder is made EXCLUSIVELY under `<engine home>/stdin/`, through `confined`, so every folder there is one
// this module made, and the sweep removes what is older than a day there with no name or content test; nothing outside
// that folder is ever touched, a link in it is reported and not followed, and an engine home that cannot be written
// refuses the spawn instead of falling back to the temporary directory. The suite's own processes write to the test
// home, never the operator's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confined } from '../scripts/io/confined-path.mjs';
import { stdinFrom, sweepStaleStdin, STALE_STDIN_MS, STDIN_FOLDER } from '../scripts/io/stdin-file.mjs';
import { quorateHome } from '../scripts/io/reviews-root.mjs';
import { rootSpelling } from '../scripts/io/finding-scope.mjs';
import { TEST_HOME, REPO_ROOT } from './helpers.mjs';

const LATER = () => Date.now() + STALE_STDIN_MS + 60_000;
const tmp = (t, p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const old = (p) => { const past = new Date(Date.now() - STALE_STDIN_MS - 3_600_000); fs.utimesSync(p, past, past); };

// ------------------------------------------------------------------------------------------------ the exclusive create
test('confined.dirNew makes a new folder, and refuses a name already taken, never reusing it', (t) => {
  const root = tmp(t, 'sfo-dirnew-');
  const owner = confined(root);
  const made = owner.dirNew(['stdin', 'a']);
  assert.equal(made, path.join(root, 'stdin', 'a'));
  assert.ok(fs.statSync(made).isDirectory());
  fs.writeFileSync(path.join(made, 'mine'), 'x');
  assert.throws(() => owner.dirNew(['stdin', 'a']), (e) => e.code === 'ECONFINED' && e.refusal === 'taken', 'an existing folder was accepted');
  assert.ok(fs.existsSync(path.join(made, 'mine')), 'the existing folder was disturbed');
});

test('stdinFrom never reuses a folder name already in stdin/: a taken name is skipped for a new one', (t) => {
  const home = tmp(t, 'sfo-taken-');
  fs.mkdirSync(path.join(home, 'stdin', 'taken-1'), { recursive: true });
  fs.writeFileSync(path.join(home, 'stdin', 'taken-1', 'stdin'), 'another call\'s prompt');
  const names = ['taken-1', 'fresh-2'];
  const s = stdinFrom('mine', { home, sweep: () => [], newName: () => names.shift() });
  const r = s.release();
  assert.equal(path.basename(r.dir), 'fresh-2', `the taken name was reused: ${r.dir}`);
  assert.equal(fs.readFileSync(path.join(home, 'stdin', 'taken-1', 'stdin'), 'utf8'), 'another call\'s prompt');
});

// ------------------------------------------------------------------------------------------------ where the folder is
test('stdinFrom makes its folder below <engine home>/stdin and nowhere else, the temporary directory included', (t) => {
  const home = tmp(t, 'sfo-home-');
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('quorate-stdin-')));
  const s = stdinFrom('a prompt', { home, sweep: () => [] });
  const inside = fs.readdirSync(path.join(home, STDIN_FOLDER));
  assert.equal(inside.length, 1, `not one folder of its own under stdin/: ${inside}`);
  assert.equal(fs.readFileSync(path.join(home, STDIN_FOLDER, inside[0], 'stdin'), 'utf8'), 'a prompt');
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('quorate-stdin-') && !before.has(n));
  assert.deepEqual(after, [], 'a stdin folder was made in the temporary directory');
  const r = s.release();
  assert.equal(path.dirname(r.dir), path.join(home, STDIN_FOLDER));
  assert.equal(r.removed, true);
});

test('an engine home that cannot be written refuses the spawn, naming the path, with no fall-back to the temporary directory', (t) => {
  const base = tmp(t, 'sfo-nohome-');
  const home = path.join(base, 'home-is-a-file');
  fs.writeFileSync(home, 'not a folder');
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('quorate-stdin-')));
  assert.throws(() => stdinFrom('a prompt', { home, sweep: () => [] }), (e) => String(e.message).includes(home), 'the refusal does not name the home');
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('quorate-stdin-') && !before.has(n));
  assert.deepEqual(after, [], 'it fell back to the temporary directory');
});

test('the suite writes to its own engine home, never the operator\'s', () => {
  // TEST_HOME on its real path, as quorateHome() returns it (8.3 long, CI run 43281517496; links above it followed since ci-path-identity stage 1c).
  assert.equal(path.resolve(quorateHome()), rootSpelling(path.resolve(TEST_HOME)), `a test process's engine home is ${quorateHome()}`);
  assert.notEqual(path.resolve(quorateHome()), path.resolve(os.homedir(), '.quorate'), 'the suite writes the operator\'s engine home');
});

// ------------------------------------------------------------------------------------------------ the sweep
test('G-6: a quorate-stdin-backup in the temporary directory, empty or holding a stdin file, old, is untouched', (t) => {
  const home = tmp(t, 'sfo-g6-home-');
  const fakeTmp = tmp(t, 'sfo-g6-tmp-');
  for (const name of ['quorate-stdin-backup', 'quorate-stdin-backu2']) fs.mkdirSync(path.join(fakeTmp, name));
  fs.writeFileSync(path.join(fakeTmp, 'quorate-stdin-backu2', 'stdin'), 'not a prompt of ours');
  for (const name of ['quorate-stdin-backup', 'quorate-stdin-backu2']) old(path.join(fakeTmp, name));
  // Both entry points: the sweep itself, and the call that starts it, with the temporary directory pointed at fakeTmp.
  sweepStaleStdin({ home, tmp: fakeTmp, now: LATER(), write: () => {} });
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  try {
    process.env.TMPDIR = fakeTmp; process.env.TEMP = fakeTmp; process.env.TMP = fakeTmp;
    stdinFrom('x', { home }).release();
  } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  assert.ok(fs.existsSync(path.join(fakeTmp, 'quorate-stdin-backup')), 'an unrelated empty folder was deleted');
  assert.ok(fs.existsSync(path.join(fakeTmp, 'quorate-stdin-backu2', 'stdin')), 'an unrelated folder holding a stdin file was deleted');
});

test('the sweep removes every folder in stdin/ older than a day, whatever its name or contents, and leaves a young one', (t) => {
  const home = tmp(t, 'sfo-sweep-');
  const dir = path.join(home, STDIN_FOLDER);
  fs.mkdirSync(path.join(dir, 'any-name', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'any-name', 'nested', 'f'), 'x');
  fs.mkdirSync(path.join(dir, 'young'));
  old(path.join(dir, 'any-name'));
  const removed = sweepStaleStdin({ home, now: Date.now(), write: () => {} });
  assert.deepEqual(removed, ['any-name']);
  assert.deepEqual(fs.readdirSync(dir), ['young'], 'a young folder, possibly a live child\'s stdin, was removed');
});

test('a link planted in stdin/ is reported and not followed, nor removed through', (t) => {
  const home = tmp(t, 'sfo-link-');
  const elsewhere = tmp(t, 'sfo-elsewhere-');
  fs.writeFileSync(path.join(elsewhere, 'precious'), 'kept');
  fs.mkdirSync(path.join(home, STDIN_FOLDER), { recursive: true });
  const link = path.join(home, STDIN_FOLDER, 'planted');
  fs.symlinkSync(elsewhere, link, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => { try { fs.unlinkSync(link); } catch { /* removed */ } });
  old(elsewhere);
  const lines = [];
  const removed = sweepStaleStdin({ home, now: LATER(), write: (l) => lines.push(l) });
  assert.deepEqual(removed, [], 'a link was counted as a removed folder');
  assert.ok(fs.existsSync(path.join(elsewhere, 'precious')), 'the sweep followed the link and removed what it leads to');
  assert.equal(lines.length, 1, `the link was not reported: ${lines}`);
  assert.match(lines[0], /planted/);
  assert.match(lines[0], /link/);
});

test('a read of a folder that fails other than ENOENT is reported, never read as gone; ENOENT says nothing', (t) => {
  const home = tmp(t, 'sfo-readerr-');
  fs.mkdirSync(path.join(home, STDIN_FOLDER, 'f1'), { recursive: true });
  const real = confined(home);
  const failing = (code) => ({ ...real, stat: () => { const e = new Error(`${code}: refused`); e.code = code; throw e; } });
  const lines = [];
  assert.deepEqual(sweepStaleStdin({ home, owner: failing('EACCES'), now: LATER(), write: (l) => lines.push(l) }), []);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /f1/);
  assert.match(lines[0], /EACCES/);
  const quiet = [];
  sweepStaleStdin({ home, owner: failing('ENOENT'), now: LATER(), write: (l) => quiet.push(l) });
  assert.deepEqual(quiet, []);
});

// ------------------------------------------------------------------------------------------------ one owner of the text
// G-4 of 20261110-193817-sfo-delivery: shared/external-reviewers.md restated where the stdin file is made (the engine
// home's `stdin/`, a folder for each call alone), which shared/adapter-contract.md, "How the prompt reaches the CLI", owns.
// Two tellings of one mechanism drift; the reviewers' document points at the owner and says nothing of the folder.
test('G-4: only shared/adapter-contract.md says where a child\'s stdin file is made; external-reviewers.md points at it', () => {
  const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
  const owner = read('shared/adapter-contract.md');
  assert.match(owner, /<engine home>\/stdin\//, 'the owner no longer states the stdin folder\'s location');
  const reviewers = read('shared/external-reviewers.md');
  const at = reviewers.indexOf('## How the prompt reaches each reviewer');
  assert.ok(at >= 0, 'external-reviewers.md\'s prompt-channel section was not found');
  const section = reviewers.slice(at, reviewers.indexOf('\n## ', at + 1));
  assert.ok(section.includes('scripts/io/stdin-file.mjs') && section.includes('"How the prompt reaches the CLI"'),
    'external-reviewers.md no longer points at the stdin file\'s owner');
  assert.doesNotMatch(section, /stdin\/`|engine home|made\s+for that call/,
    'external-reviewers.md restates the stdin folder\'s location or per-call exclusivity, which adapter-contract.md owns');
});
