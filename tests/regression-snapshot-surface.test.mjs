// arms-read-surface, Stage 1 (.claude/requests/arms-read-surface.md, plan Stage 1). The directory an
// external reviewer reads is built from a snapshot of the working state, and git itself puts outside
// content into that snapshot: on Windows, `git add -A` walks through a junction and stores the file
// behind it as an ordinary blob, and a hard link to an outside file is stored as that file's bytes
// (both measured in Stage 0). This is the decision that leaves such entries out and names them —
// "leave out and name" (operator, 2026-09-26), not a refused snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { judgeSnapshotEntries } from '../scripts/lib/snapshot-surface.mjs';

const ROOT = path.resolve('/virtual/repo');
const at = (rel) => path.join(ROOT, ...rel.split('/'));
const file = (rel, over = {}) => ({ path: rel, mode: '100644', real: at(rel), dev: '1', ino: String(rel.length * 7919), nlink: '1', ...over });
const judge = (entries) => judgeSnapshotEntries({ realRepoRoot: ROOT, entries });
const why = (r, p) => r.withheld.find((w) => w.path === p)?.why ?? null;

test('an ordinary file inside the repository is admitted', () => {
  const r = judge([file('src/a.mjs'), file('README.md')]);
  assert.deepEqual(r.admitted, ['src/a.mjs', 'README.md']);
  assert.deepEqual(r.withheld, []);
});

test('a file reached through a junction is left out and named', () => {
  const r = judge([file('linked/creds.txt', { real: path.resolve('/elsewhere/creds.txt') })]);
  assert.deepEqual(r.admitted, []);
  assert.match(why(r, 'linked/creds.txt'), /outside the repository/);
});

test('a symlink entry is left out and named — as text it carries nothing usable, and can name an outside path', () => {
  const r = judge([file('docs', { mode: '120000' })]);
  assert.deepEqual(r.admitted, []);
  assert.match(why(r, 'docs'), /symbolic link/);
});

test('an entry whose real location cannot be established is left out, not assumed inside', () => {
  const r = judge([file('gone.txt', { real: null })]);
  assert.match(why(r, 'gone.txt'), /could not be resolved/);
});

test('a hard link is admitted only when every one of its links is in the snapshot', () => {
  const inner = { dev: '9', ino: '123456789012345678901', nlink: '2' };   // beyond a JS number's exact range
  const both = judge([file('a.txt', inner), file('b.txt', inner)]);
  assert.deepEqual(both.admitted, ['a.txt', 'b.txt'], 'a pair that stays inside the repository is kept');
  const outside = judge([file('hardlink.txt', { dev: '9', ino: '42', nlink: '2' })]);
  assert.deepEqual(outside.admitted, []);
  assert.match(why(outside, 'hardlink.txt'), /1 of 2 links/);
  // Same inode number on a DIFFERENT device is a different file.
  const twoDevices = judge([file('x', { dev: '1', ino: '5', nlink: '2' }), file('y', { dev: '2', ino: '5', nlink: '2' })]);
  assert.deepEqual(twoDevices.admitted, [], 'grouping is by (dev, ino), not by ino alone');
});

test('the decision is pure: nothing but its arguments', () => {
  assert.throws(() => judgeSnapshotEntries({ realRepoRoot: ROOT, entries: [file('a', { nlink: 2 })] }), /string/,
    'counts and ids arrive as strings, so an inode beyond 2^53 is never rounded into another file\'s');
});

// The size cap's value (operator, 2026-09-27: "B with 1024 MB default"): a contract key read like
// preflight_cache_max_mb — absent = 1024 MB, "" = uncapped, a number = that many megabytes.
test('review.panel_snapshot_max_mb: absent, "" and a number', async () => {
  const { panelSnapshotMaxBytes } = await import('../scripts/lib/snapshot-surface.mjs');
  assert.equal(typeof panelSnapshotMaxBytes, 'function');
  assert.equal(panelSnapshotMaxBytes({ review: {} }), 1024n * 1024n * 1024n);
  assert.equal(panelSnapshotMaxBytes({}), 1024n * 1024n * 1024n);
  assert.equal(panelSnapshotMaxBytes({ review: { panel_snapshot_max_mb: '' } }), null, 'uncapped by declaration');
  assert.equal(panelSnapshotMaxBytes({ review: { panel_snapshot_max_mb: 2 } }), 2n * 1024n * 1024n);
  for (const bad of [0, -1, 'lots', 'NaN']) {
    assert.throws(() => panelSnapshotMaxBytes({ review: { panel_snapshot_max_mb: bad } }), /panel_snapshot_max_mb/);
  }
});

// G-9 of review 20260927-153422-ars-r4: only absent, "" or a number is a declaration. `null` read as
// uncapped, and `Number()` turned `true` into 1 MB and `[2]` into 2 MB.
test('review.panel_snapshot_max_mb: null, a boolean or a list is refused, a numeric string is a number', async () => {
  const { panelSnapshotMaxBytes } = await import('../scripts/lib/snapshot-surface.mjs');
  for (const bad of [null, true, false, [2], ' ', '0x10', '1e3']) {
    assert.throws(() => panelSnapshotMaxBytes({ review: { panel_snapshot_max_mb: bad } }), /panel_snapshot_max_mb/, JSON.stringify(bad));
  }
  assert.equal(panelSnapshotMaxBytes({ review: { panel_snapshot_max_mb: '2' } }), 2n * 1024n * 1024n, 'the contract parser may deliver it as text');
  assert.equal(panelSnapshotMaxBytes({ review: { panel_snapshot_max_mb: 1.5 } }), BigInt(Math.floor(1.5 * 1024 * 1024)));
});
