// regression-ciss-s7-diff-outside.test.mjs — G-4 of 20261030-124823-ciss-stage7.
//
// capture.mjs refused the literal `--no-index`, but git ENTERS no-index mode on its own when `git diff` is given a path
// outside the working tree, so `git diff <outside> <outside>` read files from anywhere into a node's evidence. A path
// argument of `git diff` that resolves outside the repository is refused now, whatever its spelling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, REPO_ROOT, repoRunDir } from './helpers.mjs';

const MARK = 'OUTSIDE_THE_REPOSITORY_7f3a';

function world(t) {
  const out = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-diff-outside-')));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.writeFileSync(path.join(out, 'a.txt'), `${MARK} one\n`);
  fs.writeFileSync(path.join(out, 'b.txt'), `${MARK} two\n`);
  const { base, dir } = repoRunDir({ runId: '20260101-000000-diffout', prefix: 'quorate-diffout-' });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { out, dir };
}

const evidenceHolds = (dir) => {
  const ev = path.join(dir, 'evidence');
  if (!fs.existsSync(ev)) return false;
  return fs.readdirSync(ev, { recursive: true }).some((n) => {
    const p = path.join(ev, String(n));
    return fs.statSync(p).isFile() && fs.readFileSync(p, 'utf8').includes(MARK);
  });
};

for (const [label, args] of [
  ['absolute paths', (w) => [path.join(w.out, 'a.txt'), path.join(w.out, 'b.txt')]],
  ['after --', (w) => ['--', path.join(w.out, 'a.txt'), path.join(w.out, 'b.txt')]],
  ['relative paths that climb out', (w) => [path.relative(REPO_ROOT, path.join(w.out, 'a.txt')), path.relative(REPO_ROOT, path.join(w.out, 'b.txt'))]],
]) {
  test(`capture refuses git diff of ${label} outside the repository (implicit no-index)`, (t) => {
    const w = world(t);
    const r = runScript('capture.mjs', ['--run-dir', w.dir, '--node', 't', '--name', 'probe', '--', 'git', 'diff', ...args(w)]);
    assert.notEqual(r.status, 0, `git diff read outside the repository: ${r.output}`);
    assert.match(r.output, /refusing/i);
    assert.equal(evidenceHolds(w.dir), false, 'a file from outside the repository reached the evidence');
  });
}

test('git diff of refs and paths inside the repository is still admitted', (t) => {
  const w = world(t);
  const r = runScript('capture.mjs', ['--run-dir', w.dir, '--node', 't', '--name', 'probe', '--', 'git', 'diff', '--stat', 'HEAD', '--', 'scripts/capture.mjs']);
  assert.equal(r.status, 0, r.output);
});
