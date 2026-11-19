// regression-below-root.test.mjs — ci-path-identity.plan.md stage 1c, its second CI round (run 44233678619).
//
// Once the roots were resolved where they are read, a path a caller passed in, spelled through a link above the root
// (macOS's /var to /private/var), was "outside" the resolved root: external-review's --evidence-dir and --out, telemetry's
// ownerBelow, and the session records' folder key. belowRoot answers "where is this path below this root" with the
// root's own links followed and the names below it kept as given, so a link below the root is still there to refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { belowRoot } from '../scripts/io/finding-scope.mjs';
import { ownerBelow } from '../scripts/io/telemetry-record.mjs';
import { stopLogPath } from '../scripts/io/stop-log.mjs';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT as REPO } from './helpers.mjs';

const LINK = process.platform === 'win32' ? 'junction' : 'dir';

function layout(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-below-root-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, 'real');
  fs.mkdirSync(path.join(real, 'home', 'runs', 'r1'), { recursive: true });
  const link = path.join(base, 'link');
  fs.symlinkSync(real, link, LINK);
  return { base, real, link };
}

test('belowRoot: a path through a link above the root is below the resolved root, and the reverse', (t) => {
  const { real, link } = layout(t);
  const viaLink = belowRoot(path.join(real, 'home'), path.join(link, 'home', 'runs', 'r1'));
  assert.ok(viaLink, 'a run spelled through the link was not placed below the real home');
  assert.deepEqual(viaLink.segs, ['runs', 'r1']);
  assert.equal(viaLink.root, fs.realpathSync.native(path.join(real, 'home')));
  const viaReal = belowRoot(path.join(link, 'home'), path.join(real, 'home', 'runs', 'r1'));
  assert.ok(viaReal, 'a real run was not placed below a home spelled through the link');
  assert.deepEqual(viaReal.segs, ['runs', 'r1']);
  assert.equal(belowRoot(path.join(real, 'home'), path.join(real, 'elsewhere')), null, 'a path outside the root was placed below it');
});

test('belowRoot: a link BELOW the root that leads back to it stays among the names, for the A-30 checks to find', (t) => {
  const { real } = layout(t);
  const home = path.join(real, 'home');
  fs.symlinkSync(home, path.join(home, 'back'), LINK);
  const placed = belowRoot(home, path.join(home, 'back', 'runs'));
  assert.deepEqual(placed?.segs, ['back', 'runs'], 'the link below the root was taken for the root');
});

test('ownerBelow: a run directory spelled through a link above the root is owned below it, and a link below still refused', (t) => {
  const { real, link } = layout(t);
  const own = ownerBelow(path.join(link, 'home', 'runs', 'r1'), path.join(real, 'home'));
  assert.equal(own.exists([]), true);
  fs.symlinkSync(path.join(real, 'home', 'runs'), path.join(real, 'home', 'loop'), LINK);
  assert.throws(() => ownerBelow(path.join(link, 'home', 'loop', 'r1'), path.join(real, 'home')).exists([]), /link|junction/i);
});

test('stopLogPath: one repository spelled through a link and really is one record folder', (t) => {
  const { real, link, base } = layout(t);
  fs.mkdirSync(path.join(real, 'repo'));
  const home = path.join(base, 'h');
  assert.equal(stopLogPath(path.join(link, 'repo'), { home }), stopLogPath(path.join(real, 'repo'), { home }));
});

// ci-path-identity.plan.md stage 3b: the JavaScript extractor compared argv[1] as given with its own module path, which
// Node gives on its real path, so started through a link (macOS's /var) it did nothing and exited 0 with no output.
test('the JavaScript extractor started through a link answers, as it does started by its real path', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-extractor-link-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, 'real');
  fs.mkdirSync(real);
  fs.copyFileSync(path.join(REPO, 'extractors', 'javascript', 'extract.mjs'), path.join(real, 'extract.mjs'));
  fs.symlinkSync(real, path.join(base, 'link'), LINK);
  const r = spawnSync(process.execPath, [path.join(base, 'link', 'extract.mjs'), '--identity', '--root', base], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.trim().length > 0, 'the extractor started through a link printed nothing');
  assert.doesNotThrow(() => JSON.parse(r.stdout));
});
