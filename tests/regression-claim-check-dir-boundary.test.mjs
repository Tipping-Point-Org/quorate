// Review 20261019-042251-review-review, the check directory of `claim-check.mjs`:
//  - G-2: `--new` asked git about `draft.md` alone, so a partial ignore rule (one naming that file) passed while
//    result.json, arm.json and the transcript copy stayed one `git add` from a commit.
//  - G-3 (G-4 its symptom): the directory a mode was given was resolved with no containment check, so `--check` deleted six
//    fixed filenames, and the rules step wrote two, in any directory holding a draft.md or result.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, withTempDir } from './helpers.mjs';

const SCRIPT = path.join(SCRIPTS_DIR, 'claim-check.mjs');
const env = () => { const e = { ...process.env }; delete e.GRAPH_NODE_DEPTH; return e; };
const run = (repo, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, env: env(), encoding: 'utf8' });

function gitRepo(dir) {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
  return repo;
}

test('G-2: --new refuses an ignore rule that covers draft.md and not the rest of the check directory', () => {
  withTempDir((dir) => {
    const repo = gitRepo(dir);
    const parent = path.join(repo, '.claude', 'claim-checks');
    fs.mkdirSync(parent, { recursive: true });
    // The repository's own .gitignore, which --new leaves alone: it ignores the draft and nothing else.
    fs.writeFileSync(path.join(parent, '.gitignore'), 'draft.md\n');
    const r = run(repo, ['--new', 'partial']);
    assert.notEqual(r.status, 0, `--new succeeded where git would commit result.json: ${r.stdout}`);
    assert.match(r.stderr, /not ignored/i);
    assert.deepEqual(fs.readdirSync(parent).filter((n) => n !== '.gitignore'), [], 'a check directory was left where git would add it');
  });
});

test('G-2: --new still succeeds where the whole check directory is ignored', () => {
  withTempDir((dir) => {
    const repo = gitRepo(dir);
    const r = run(repo, ['--new', 'whole']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(r.stdout.trim()));
  });
});

const outsideDir = (repo) => {
  const d = path.join(repo, 'notes');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'draft.md'), 'a draft\n');
  fs.writeFileSync(path.join(d, 'checked.md'), 'the operator\'s own file\n');
  fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ claims: [] }));
  return d;
};

test('G-3: --check refuses a directory outside .claude/claim-checks/ and deletes nothing in it', () => {
  withTempDir((dir) => {
    const repo = gitRepo(dir);
    const d = outsideDir(repo);
    const r = run(repo, [d, '--check']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /claim-checks/);
    assert.equal(fs.existsSync(path.join(d, 'checked.md')), true, 'checked.md outside the check root was deleted');
    assert.equal(fs.existsSync(path.join(d, 'result.json')), true, 'result.json outside the check root was deleted');
  });
});

test('G-3: --check refuses a path that climbs out of .claude/claim-checks/', () => {
  withTempDir((dir) => {
    const repo = gitRepo(dir);
    const d = outsideDir(repo);
    fs.mkdirSync(path.join(repo, '.claude', 'claim-checks'), { recursive: true });
    const r = run(repo, [path.join(repo, '.claude', 'claim-checks', '..', '..', 'notes'), '--check']);
    assert.notEqual(r.status, 0);
    assert.equal(fs.existsSync(path.join(d, 'checked.md')), true, 'a traversal reached a directory outside the check root');
  });
});

test('G-3: the rules step refuses a directory outside .claude/claim-checks/ and writes nothing there', () => {
  withTempDir((dir) => {
    const repo = gitRepo(dir);
    const d = outsideDir(repo);
    const r = run(repo, [d]);
    assert.notEqual(r.status, 0);
    assert.equal(fs.existsSync(path.join(d, 'checked.json')), false, 'the rules step wrote outside the check root');
    assert.equal(fs.readFileSync(path.join(d, 'checked.md'), 'utf8'), 'the operator\'s own file\n', 'checked.md was overwritten');
  });
});
