// regression-ciss-s7-run-json-link.test.mjs — G-13 of 20261030-124823-ciss-stage7.
//
// admitRun realpathed the run directory and then read run.json with a raw readFileSync, so a run.json standing as a link
// was followed and the linked record configured the caller, against A-30's rule that a standing link below a run is
// refused. The platform is wrapped so the link is reported by lstat on every OS, with no privilege to make a real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { admitRun, defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const host = hostPlatform();
const PROJECT = 'admit-link-test';
const ID = '20260101-000000-run';

function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-admit-link-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const home = path.join(base, 'home');
  const repo = path.join(base, 'repo');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  const dir = path.join(defaultReviewsRoot({ project: PROJECT, repoRoot: repo, home }), ID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: ID, repo_root: repo }));
  return { home, repo, dir };
}

// The host platform, with lstat reporting the named file as a link (or a directory).
function ioWhere(name, kind) {
  const fsw = { ...host.fs };
  fsw.lstatSync = (p, ...rest) => {
    const st = host.fs.lstatSync(p, ...rest);
    if (path.basename(String(p)) !== name) return st;
    return { ...st, isSymbolicLink: () => kind === 'link', isFile: () => false, isDirectory: () => kind === 'dir' };
  };
  return { ...host, fs: fsw };
}

test('a run.json that is a link is refused, not followed', (t) => {
  const w = world(t);
  const r = admitRun({ runDir: w.dir, repoRoot: w.repo, home: w.home, project: PROJECT, io: ioWhere('run.json', 'link') });
  assert.equal(r.ok, false, 'a linked run.json was admitted');
  assert.equal(r.check, 'record');
  assert.match(r.why, /link/);
});

test('a run.json that is not a file is refused', (t) => {
  const w = world(t);
  const r = admitRun({ runDir: w.dir, repoRoot: w.repo, home: w.home, project: PROJECT, io: ioWhere('run.json', 'dir') });
  assert.equal(r.ok, false);
  assert.equal(r.check, 'record');
});

test('a plain run.json is still admitted', (t) => {
  const w = world(t);
  const r = admitRun({ runDir: w.dir, repoRoot: w.repo, home: w.home, project: PROJECT, io: host });
  assert.equal(r.ok, true, r.why);
});
