// preflight-reuse-by-hash.md (operator, 2026-10-12: "Hash decides when declared (Recommended)", "Git's file list
// (Recommended)"). Every review on 2026-10-11 re-ran the full suite, most of them right after the same suite had run on
// the same content: a dirty file that was not an input (continue.bat) invalidated the cache, and the input set held
// git-ignored files (the suite runner's own tests/.run-all-tap-*.txt), so a leftover changed the hash.
//
// Behaviour, end to end: preflight.mjs --run seeds the cache in a throwaway repository, then preflight.mjs answers FRESH
// (exit 0) or STALE (exit 3) after each change. The checks are `node ok.js`, so nothing is spent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript } from './helpers.mjs';

function project(t, { declared = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-pfhash-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'ok.js'), '');
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'not an input\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'src/*.tap\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 6', 'project: pfhash',
    'commands:', '  build: "node ok.js"', '  test: "node ok.js"', 'source_globs: ["src/**"]', 'ui:', '  surface: none',
    ...(declared ? ['review:', '  preflight_inputs: ["src/**", "ok.js", "CLAUDE.md"]'] : []), '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'init');
  const env = { QUORATE_HOME: path.join(base, 'home') };
  const pf = (args = []) => runScript('preflight.mjs', args, { cwd: repo, env });
  const seeded = pf(['--run']);
  assert.equal(seeded.status, 0, `precondition: the seed ran\n${seeded.output.slice(-600)}`);
  return { repo, env, pf, home: env.QUORATE_HOME };
}

const fresh = (r) => { assert.match(r.output, /\bFRESH\b/, r.output.slice(-600)); assert.equal(r.status, 0); };
const stale = (r, why) => { assert.match(r.output, /\bSTALE\b/, r.output.slice(-600)); assert.match(r.output, why); };

test('AC1: with a declared set, a dirty file outside it does not invalidate the result', (t) => {
  const p = project(t);
  fs.writeFileSync(path.join(p.repo, 'notes.txt'), 'edited, still not an input\n');
  fresh(p.pf());
});

// AC2 and AC3 pin behaviour that already holds: the cache is keyed by the hash, so a changed input finds no entry.
test('AC2: with a declared set, a changed input invalidates — tracked or untracked-not-ignored', (t) => {
  const p = project(t);
  fs.writeFileSync(path.join(p.repo, 'src', 'a.js'), 'export const a = 2;\n');
  stale(p.pf(), /no earlier pre-flight result for these inputs/);
  fs.writeFileSync(path.join(p.repo, 'src', 'a.js'), 'export const a = 1;\n');
  fresh(p.pf());
  fs.writeFileSync(path.join(p.repo, 'src', 'b.js'), 'export const b = 1;\n');
  stale(p.pf(), /no earlier pre-flight result for these inputs/);
});

test('AC3: with an inferred set, a dirty tree still invalidates', (t) => {
  const p = project(t, { declared: false });
  fs.writeFileSync(path.join(p.repo, 'notes.txt'), 'edited\n');
  stale(p.pf(), /dirty/);
});

test('AC4: an ignored file under a declared glob does not change the hash', (t) => {
  const p = project(t);
  fs.writeFileSync(path.join(p.repo, 'src', 'leftover.tap'), 'TAP output a killed run left behind\n');
  fresh(p.pf());
});

test('AC5: the cache entry records the resolved input files, ignored ones excluded', (t) => {
  const p = project(t);
  const cacheDir = (() => {
    const found = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name === '.preflight-cache') found.push(f); else walk(f); }
    } };
    walk(p.home);
    return found[0];
  })();
  assert.ok(cacheDir, 'no .preflight-cache under the engine home');
  const entry = JSON.parse(fs.readFileSync(path.join(cacheDir, fs.readdirSync(cacheDir).find((n) => n.endsWith('.json'))), 'utf8'));
  assert.deepEqual([...entry.input_files].sort(), ['CLAUDE.md', 'ok.js', 'src/a.js']);
});

test('AC6: the contract document and QUORATE.md state the narrowed rule and git\'s file list', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const contract = read('shared/claude-md-contract.md');
  assert.match(contract, /the hash alone decides/);
  assert.match(contract, /input_files/);
  assert.doesNotMatch(contract, /a changed input, and a dirty\nworktree, the second regardless of what moved/);
  assert.match(read('QUORATE.md'), /git's list under your globs/);
});

// ------------------------------------------------------------------ 20261012-031702-preflight-reuse-review
const cacheDirOf = (home) => {
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name === '.preflight-cache') found.push(f); else walk(f); }
  } };
  walk(home);
  return found[0];
};

// G-4: git lists a submodule as ONE gitlink entry, so every file inside it fell out of the git-filtered set. With the
// dirty rule skipped for a declared set, an edit inside the submodule then reused a stale result.
test('G-4: a file inside a submodule stays an input; editing it makes the result stale', (t) => {
  const p = project(t);
  const git = (...a) => spawnSync('git', a, { cwd: p.repo, encoding: 'utf8' });
  fs.mkdirSync(path.join(p.repo, 'src', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(p.repo, 'src', 'sub', 'x.js'), 'export const x = 1;\n');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  git('update-index', '--add', '--cacheinfo', `160000,${head},src/sub`);   // a gitlink, as a submodule records
  git('commit', '-qm', 'gitlink');
  assert.equal(p.pf(['--run']).status, 0, 'precondition: reseeded with the gitlink in place');
  fs.writeFileSync(path.join(p.repo, 'src', 'sub', 'x.js'), 'export const x = 2;\n');
  stale(p.pf(), /no earlier pre-flight result for these inputs/);
});

// G-3: the listing had no maxBuffer, so a repository past 1 MiB of paths silently fell back to the walk. The cap is a
// parameter: a tiny one must make the listing fail (proving the call uses it), and the default must not.
test('G-3: the git listing uses the configured cap — a tiny one fails over to the walk, the default does not', async (t) => {
  const p = project(t);
  const { preflightInputSet } = await import('../scripts/io/preflight-cache.mjs');
  const contract = { review: { preflight_inputs: ['src/**', 'ok.js', 'CLAUDE.md'] } };
  assert.equal(preflightInputSet({ repoRoot: p.repo, contract, listingMaxBuffer: 16 }).listedBy, 'walk',
    'a 16-byte cap did not stop the listing, so the call does not use the cap');
  assert.equal(preflightInputSet({ repoRoot: p.repo, contract }).listedBy, 'git');
});

// G-10: run-checks listed the files a second time, after the caller hashed them, so the recorded list could describe a
// different tree from the hash. A list that does not hash to the entry's key is recorded as unknown (null), not as fact.
// Since G-10 of 20261114-032609-m2-7b-remediation-review the inputs are hashed again after the checks, so a key that does
// not name the content is not written at all: no entry can carry a list that does not hash to its key.
test('G-10: a key that is not the hash of the inputs writes no entry, so no list is recorded against it', (t) => {
  const p = project(t);
  const reviewsRoot = path.dirname(cacheDirOf(p.home));
  const runId = '20260101-000000-preflight-seed';
  const runDir = path.join(reviewsRoot, runId);
  fs.mkdirSync(path.join(runDir, 'evidence'), { recursive: true });
  const contract = { commands: { build: 'node ok.js', test: 'node ok.js' }, review: { preflight_inputs: ['src/**', 'ok.js', 'CLAUDE.md'] } };
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: runId, kind: 'preflight-seed', repo_root: p.repo,
    dirty: false, contract, contract_source: 'CLAUDE.md', host: { cwd: p.repo }, stamps: [] }));
  const wrong = 'f'.repeat(64);
  const r = runScript('run-checks.mjs', ['--run-dir', runDir, '--repo-root', p.repo, '--input-hash', wrong], { cwd: p.repo, env: p.env });
  const entryPath = path.join(reviewsRoot, '.preflight-cache', `${wrong}.json`);
  assert.ok(fs.existsSync(path.join(runDir, 'checks.json')), `precondition: the checks ran\n${r.output.slice(-600)}`);
  assert.ok(!fs.existsSync(entryPath), 'an entry was written under a key that does not name the inputs');
  assert.match(r.output, /not caching this result/);
});

// G-8 of 20261114-042824-m2-7b-remediation-2-review: the hash came on argv and its file list from run.json, two values
// travelling apart, and run-checks recombined them unchecked. A list is taken only from run.json's record of WHICH hash it
// was taken over; a list recorded with no hash, or another one, is unknown (null), never the passed hash's list.
test('G-8: a file list run.json does not record against the passed hash is not recorded as that hash\'s list', async (t) => {
  const p = project(t);
  const { preflightInputHash } = await import('../scripts/io/preflight-cache.mjs');
  const reviewsRoot = path.dirname(cacheDirOf(p.home));
  const runId = '20260101-000001-preflight-seed';
  const runDir = path.join(reviewsRoot, runId);
  fs.mkdirSync(path.join(runDir, 'evidence'), { recursive: true });
  const contract = { commands: { build: 'node ok.js', test: 'node ok.js' }, review: { preflight_inputs: ['src/**', 'ok.js', 'CLAUDE.md'] } };
  const { hash } = preflightInputHash({ repoRoot: p.repo, contract, contractSource: 'CLAUDE.md', reviewsDir: reviewsRoot });
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: runId, kind: 'preflight-seed', repo_root: p.repo,
    dirty: false, contract, contract_source: 'CLAUDE.md', host: { cwd: p.repo }, stamps: [],
    checks_input_files: ['not-an-input.js'] }));
  const r = runScript('run-checks.mjs', ['--run-dir', runDir, '--repo-root', p.repo, '--input-hash', hash], { cwd: p.repo, env: p.env });
  const entry = JSON.parse(fs.readFileSync(path.join(reviewsRoot, '.preflight-cache', `${hash}.json`), 'utf8'));
  assert.equal(entry.run_id, runId, `precondition: this run wrote the entry\n${r.output.slice(-600)}`);
  assert.equal(entry.input_files, null, `a list not recorded against this hash was cached as its list: ${JSON.stringify(entry.input_files)}`);
});

// G-1, G-12 (+ G-8, G-13, G-14) of 20261012-031702-preflight-reuse-review: the rule's owner (disk-first §7), the stamp
// consequence every lens brief carries, and two skills still required a clean worktree for every reuse.
test('G-12 and its copies: no document still requires a clean worktree for a declared set', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert.doesNotMatch(read('prompts/_templates/stamp-consequences.json'), /identical set of inputs on a clean worktree/);
  const protocol = read('shared/disk-first-protocol.md');
  assert.doesNotMatch(protocol, /The two invalidation rules are INDEPENDENT and both hold/);
  assert.match(protocol, /For a DECLARED set listed by git the hash alone decides/);
  assert.doesNotMatch(read('skills/full-review/SKILL.md'), /Two\nconditions invalidate it and they are independent/);
  assert.doesNotMatch(read('skills/version-gate/SKILL.md'), /hashed identically with a clean worktree/);
});

// G-2 of 20261012-035748-preflight-reuse-r2: baf10421 kept every walked file under a gitlink, so a file the SUBMODULE
// ignores entered the hash, breaking "never an ignored file". A real submodule's files come from its own git listing.
test('G-2: a file the submodule itself ignores is not an input; its tracked files still are', (t) => {
  const p = project(t);
  const sub = path.join(p.repo, 'src', 'sub');
  fs.mkdirSync(sub, { recursive: true });
  const sgit = (...a) => spawnSync('git', a, { cwd: sub, encoding: 'utf8' });
  sgit('init', '-q'); sgit('config', 'user.email', 'x@x'); sgit('config', 'user.name', 'x');
  fs.writeFileSync(path.join(sub, '.gitignore'), '*.tap\n');
  fs.writeFileSync(path.join(sub, 'x.js'), 'export const x = 1;\n');
  sgit('add', '-A'); sgit('commit', '-qm', 'sub');
  const git = (...a) => spawnSync('git', a, { cwd: p.repo, encoding: 'utf8' });
  git('update-index', '--add', '--cacheinfo', `160000,${sgit('rev-parse', 'HEAD').stdout.trim()},src/sub`);
  git('commit', '-qm', 'submodule');
  assert.equal(p.pf(['--run']).status, 0, 'precondition: reseeded with the submodule in place');
  fs.writeFileSync(path.join(sub, 'leftover.tap'), 'ignored by the submodule\n');
  fresh(p.pf());
  fs.writeFileSync(path.join(sub, 'x.js'), 'export const x = 2;\n');
  stale(p.pf(), /no earlier pre-flight result for these inputs/);
});

// G-4 of 20261012-042500-preflight-reuse-r3: a798d569 listed a submodule's own files but not ITS submodules, so a file in
// a nested submodule fell out of the hash again. The listing recurses: each repository lists its own files and descends
// into its own gitlinks; a gitlink with no repository behind it keeps the walk.
test('G-4 (r3): a file in a nested submodule stays an input; the nested one\'s ignored files do not', (t) => {
  const p = project(t);
  const repoAt = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
    const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    g('init', '-q'); g('config', 'user.email', 'x@x'); g('config', 'user.name', 'x');
    return g;
  };
  const sub = path.join(p.repo, 'src', 'sub');
  const deep = path.join(sub, 'deep');
  const dgit = repoAt(deep);
  fs.writeFileSync(path.join(deep, '.gitignore'), '*.tap\n');
  fs.writeFileSync(path.join(deep, 'y.js'), 'export const y = 1;\n');
  dgit('add', '-A'); dgit('commit', '-qm', 'deep');
  const sgit = repoAt(sub);
  fs.writeFileSync(path.join(sub, 'x.js'), 'export const x = 1;\n');
  sgit('add', 'x.js');
  sgit('update-index', '--add', '--cacheinfo', `160000,${dgit('rev-parse', 'HEAD').stdout.trim()},deep`);
  sgit('commit', '-qm', 'sub');
  const git = (...a) => spawnSync('git', a, { cwd: p.repo, encoding: 'utf8' });
  git('update-index', '--add', '--cacheinfo', `160000,${sgit('rev-parse', 'HEAD').stdout.trim()},src/sub`);
  git('commit', '-qm', 'nested submodules');
  assert.equal(p.pf(['--run']).status, 0, 'precondition: reseeded with the nested submodules in place');
  fs.writeFileSync(path.join(deep, 'leftover.tap'), 'ignored by the nested submodule\n');
  fresh(p.pf());
  fs.writeFileSync(path.join(deep, 'y.js'), 'export const y = 2;\n');
  stale(p.pf(), /no earlier pre-flight result for these inputs/);
});
