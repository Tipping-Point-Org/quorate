// G-20 and G-21 of run 20260925-200721-platform-remediated, both in run-graph's docReadDirs.
//
// G-20 (panel-codex-security): a declared doc directory that does not overlap source was LIVE-MOUNTED
// into the intent sandbox after only its root was checked. A link beneath it — docs/leak.md pointing
// at implementation, or at a file outside the repository — was then readable by the node that must
// not see source. Single-file doc paths were hardened (G-10 of post-med4); directories were not.
// A directory holding a link that leaves it is snapshotted instead, where every entry is judged.
//
// G-21 (panel-codex-code): the request snapshot sat inside `if (fs.existsSync(reqAbs))` with no
// else, so a request deleted between mint and intent was omitted in silence — intent derived without
// the approved request, and nothing in the gate said so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as scope from '../scripts/lib/finding-scope.mjs';

const R = path.resolve('/virtual/repo');
const at = (...p) => path.join(R, ...p);

/** A filesystem of plain dirs, files and links: path -> 'dir' | 'file' | { link: resolvedTarget }. */
function fakeIo(tree) {
  const node = (p) => tree[path.resolve(p)];
  const enoent = (p) => Object.assign(new Error(`ENOENT ${p}`), { code: 'ENOENT' });
  return { fs: {
    readFileSync() { throw new Error("not read by this function"); },
    readdirSync: (d) => Object.keys(tree).filter((p) => path.dirname(p) === path.resolve(d)).map((p) => path.basename(p)),
    lstatSync: (p) => { const n = node(p); if (n === undefined) throw enoent(p);
      return { isSymbolicLink: () => typeof n === 'object', isDirectory: () => n === 'dir', isFile: () => n === 'file' }; },
    realpathSync: (p) => { const n = node(p); if (n === undefined) throw enoent(p); return typeof n === 'object' ? n.link : path.resolve(p); },
  } };
}

test('G-20: a link beneath a doc directory that leaves it is found, however deep', () => {
  const io = fakeIo({
    [at('docs')]: 'dir', [at('docs', 'a.md')]: 'file', [at('docs', 'deep')]: 'dir',
    [at('docs', 'deep', 'leak.md')]: { link: at('scripts', 'secret.mjs') },
  });
  assert.equal(scope.firstLinkLeaving(at('docs'), io), 'deep/leak.md');
});

test('G-20: a link that stays inside the directory, and a dangling one, leave nothing', () => {
  const io = fakeIo({
    [at('docs')]: 'dir', [at('docs', 'a.md')]: 'file',
    [at('docs', 'alias.md')]: { link: at('docs', 'a.md') },
    [at('docs', 'gone.md')]: { link: null },
  });
  io.fs.realpathSync = ((real) => (p) => { if (path.resolve(p) === at('docs', 'gone.md')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return real(p); })(io.fs.realpathSync);
  assert.equal(scope.firstLinkLeaving(at('docs'), io), null);
  assert.throws(() => scope.firstLinkLeaving(at('docs')), /firstLinkLeaving: an io/);
});

const RUN_GRAPH = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
const fnBody = (name) => { const s = RUN_GRAPH.indexOf(`function ${name}(`); return RUN_GRAPH.slice(s, RUN_GRAPH.indexOf('\nfunction ', s + 1)); };

// STRONGER SINCE contract-glob-grammar stage 4: no doc directory is live-mounted at all, so no link beneath one can be
// read through the mount. Every entry is copied through the walk's one classifier, which judges a link by where it
// resolves (regression-snapshot-entry-target exercises it against real links).
// REMOVED (G-22 of 20261001-155615-cgg-review-r3): "docReadDirs live-mounts no doc directory" (G-20).
// It matched source text, so an equivalent rewrite failed it and a broken wiring with the same spelling passed. The
// property is now DRIVEN in regression-cgg-r3-remediation.test.mjs, through a fake runtime passed with --runtime-bin,
// which logs what the node was actually handed.

test('G-21: a request missing at intent time is refused and recorded, never skipped', () => {
  const fn = fnBody('docReadDirs');
  const branch = fn.slice(fn.indexOf("nodeId === 'intent-capture' && runJson.request?.path"));
  assert.doesNotMatch(branch.slice(0, 400), /if \(fs\.existsSync\(reqAbs\)\)/, 'no existence gate that skips in silence');
  assert.match(branch, /docSnapshotSkips\.push\(\{ item: `request /, 'a refusal reaches the gate');
});
