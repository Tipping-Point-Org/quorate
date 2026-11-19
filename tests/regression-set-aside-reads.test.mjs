// A SET-ASIDE HOLDS ONE FILE'S BYTES AT A TIME, AND READS NONE TO CLASSIFY (runner-test-seam.plan.md stage 3, design RT-D3 A;
// I-10 and I-14 of set-aside-identity). The bound was held first by regexes over the runner's source, then by an `fs`
// preload over a whole-run child too noisy to measure one file, so it was set at three (G-13 of
// 20261108-080036-si-remediation-8-review). Every read of a set-aside path's or a copy's bytes now goes through a
// capability's withFileBytes, which hands the bytes out only inside a callback and announces each on bytes-open and
// bytes-close. These tests hold the shape (no other read, no two open at once, the read order) and measure the bound.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import diagnosticsChannel from 'node:diagnostics_channel';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { confined } from '../scripts/io/confined-path.mjs';
import { setAsideCapabilities, setAsideRefused, writeBackSetAside, SET_ASIDE_CHANNELS } from '../scripts/io/set-aside.mjs';
import { setAsideFixture, realCapabilities } from './tools/set-aside-capabilities.mjs';

const MODULE = path.join(REPO_ROOT, 'scripts', 'io', 'set-aside.mjs');

// ----------------------------------------------------------------------------------------------- the read census
// The module's reads of bytes, by the census rule of the stage: no tree.read or owner.read outside two exemptions, the body
// of withFileBytes in setAsideCapabilities (the one place bytes are read) and the manifest's own read. run.read() is the
// run record, not a path's bytes. EVERY SPELLING OF REACHING THE CAPABILITY'S read, not only calling it (G-10 of
// 20261108-222629-rts-delivery): a member with or without a call (.read, ?.read), a destructuring ({ read }, { read: r }) and a
// quoted name (['read'], Reflect.get). A local named `read` is none of these. What this cannot see, a name built at run time,
// the watched-reads test below holds on the paths a run takes.
const READ_REACH = /\.read\b|[{,]\s*read\b\s*[:,}]|['"`]read['"`]/;
const readSites = (text) => text.split('\n').map((l, i) => [l.trim(), i + 1])
  .filter(([l]) => l && !l.startsWith('//') && READ_REACH.test(l.replace(/\brun\.read\(\)/g, '')));
const EXEMPT = ['const raw = base.read(segs, null);', "try { manifest = JSON.parse(owner.read([...dir, 'manifest.json'])); } catch (err) {"];

test('census: the module reads bytes only in withFileBytes and the manifest\'s own read', () => {
  const text = fs.readFileSync(MODULE, 'utf8');
  assert.deepEqual(readSites(text).map(([l]) => l), EXEMPT, 'a read of bytes outside the two exemptions');
  const caps = text.slice(text.indexOf('export function setAsideCapabilities('), text.indexOf('\n}\n', text.indexOf('export function setAsideCapabilities(')));
  assert.ok(caps.includes(EXEMPT[0]), 'base.read is not inside setAsideCapabilities');
  assert.ok(caps.includes('withFileBytes(segs, fn)'), 'the read is not withFileBytes\'s');
});

test('census: a tree.read or owner.read added to the module is refused', () => {
  const text = fs.readFileSync(MODULE, 'utf8');
  for (const line of ['  const b = caps.tree.read(treeSegs(p), null);', '  const c = caps.owner.read([...dir, "files", e.copy], null);', '  const d = tree.read(segs);']) {
    assert.notDeepEqual(readSites(`${text}\n${line}\n`).map(([l]) => l), EXEMPT, `not seen: ${line}`);
  }
});

// G-10 of 20261108-222629-rts-delivery: the census matched only the literal `.read(`, so a read through an alias passed it.
test('census: a read through an alias, a destructuring or a computed name is refused', () => {
  const text = fs.readFileSync(MODULE, 'utf8');
  for (const line of ['  const read = caps.tree.read;', '  const read = caps.owner.read.bind(caps.owner);', '  const { read } = caps.tree;',
    '  const { read: r } = caps.owner;', "  const r = caps.tree['read'];", '  const r = caps.tree["read"];', '  const r = caps.tree?.read;',
    '  const r = caps.tree[`read`];', "  const r = Reflect.get(caps.tree, 'read');"]) {
    assert.notDeepEqual(readSites(`${text}\n${line}\n`).map(([l]) => l), EXEMPT, `not seen: ${line}`);
  }
});

// What no spelling census can hold: the capabilities' own read, watched as it runs, so a read reached by any spelling that
// the run takes is seen. A tree read outside an open withFileBytes, or any owner read but the manifest's, is named.
const readsOutsideBytes = (events) => {
  const out = [];
  let open = 0;
  for (const e of events) {
    if (e.ev === 'open') open += 1;
    else if (e.ev === 'close') open -= 1;
    else if (!open && !(e.root === 'owner' && e.path.endsWith('/manifest.json'))) out.push(`${e.root} ${e.path}`);
  }
  return out;
};

test('every read a set-aside and its write-back make of a path\'s or a copy\'s bytes is inside withFileBytes', (t) => {
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n', 'tests/b.js': 'committed b\n' }, working: { 'tests/b.js': 'b, from the node\n', 'tests/d.js': 'd, from the node\n' } });
  const events = [];
  const onOpen = () => events.push({ ev: 'open' });
  const onClose = () => events.push({ ev: 'close' });
  diagnosticsChannel.subscribe(SET_ASIDE_CHANNELS.bytesOpen, onOpen);
  diagnosticsChannel.subscribe(SET_ASIDE_CHANNELS.bytesClose, onClose);
  t.after(() => { diagnosticsChannel.unsubscribe(SET_ASIDE_CHANNELS.bytesOpen, onOpen); diagnosticsChannel.unsubscribe(SET_ASIDE_CHANNELS.bytesClose, onClose); });
  const watching = (root, base) => ({ ...base, read(segs, ...rest) { events.push({ ev: 'read', root, path: segs.join('/') }); return base.read(segs, ...rest); } });
  const caps = setAsideCapabilities({ ...realCapabilities(f).caps, tree: watching('tree', confined(f.repo)), owner: watching('owner', confined(f.runDir)) });
  const r = setAsideRefused(caps, [{ id: 'c2', committable: false, accepted: ['tests/b.js', 'tests/d.js'] }], {});
  assert.deepEqual(writeBackSetAside(caps, r.record.dir.join('/')), []);
  assert.ok(events.filter((e) => e.ev === 'read').length >= 6, `too few reads seen to hold anything: ${events.length}`);
  assert.deepEqual(readsOutsideBytes(events), []);
});

test('the watched reads\' instrument: a read outside an open callback is named, and the manifest\'s own is not', () => {
  const read = (root, p) => ({ ev: 'read', root, path: p });
  assert.deepEqual(readsOutsideBytes([{ ev: 'open' }, read('tree', 'a'), { ev: 'close' }, read('owner', 'd/manifest.json')]), []);
  assert.deepEqual(readsOutsideBytes([read('tree', 'a'), { ev: 'open' }, { ev: 'close' }, read('owner', 'd/files/1')]), ['tree a', 'owner d/files/1']);
});

// ----------------------------------------------------------------------------------- the shape, from the channels
const THREE = ['tests/b.js', 'tests/c.js', 'tests/d.js'];
function watched(t, names) {
  const events = [];
  const subs = names.map((k) => [k, (m) => events.push({ ev: k, ...m })]);
  for (const [k, fn] of subs) diagnosticsChannel.subscribe(SET_ASIDE_CHANNELS[k], fn);
  t.after(() => { for (const [k, fn] of subs) diagnosticsChannel.unsubscribe(SET_ASIDE_CHANNELS[k], fn); });
  return events;
}
// Three refused files, two tracked and modified (put back by checkout) and one new (put back by removal), set aside and
// written back over the real capabilities.
function threeFiles(t, events) {
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n', 'tests/b.js': 'committed b\n', 'tests/c.js': 'committed c\n' },
    working: { 'tests/b.js': 'b, from the node\n', 'tests/c.js': 'c, from the node\n', 'tests/d.js': 'd, from the node\n' } });
  const { caps } = realCapabilities(f);
  const r = setAsideRefused(caps, [{ id: 'c2', committable: false, accepted: THREE }], {});
  events.push({ ev: 'set-aside-done' });
  const failed = writeBackSetAside(caps, r.record.dir.join('/'));
  assert.deepEqual(failed, [], 'the write-back failed');
  for (const p of THREE) assert.match(fs.readFileSync(path.join(f.repo, ...p.split('/')), 'utf8'), /from the node/, `${p} was not written back`);
  return events;
}

// No two withFileBytes open at once: the depth of open callbacks, from bytes-open and bytes-close, never passes one, and
// each close names the file its open named.
const overlaps = (events) => {
  const out = [];
  const open = [];
  for (const e of events) {
    if (e.ev === 'bytesOpen') { if (open.length) out.push(`${e.root} ${e.path} opened while ${open.map((o) => `${o.root} ${o.path}`).join(', ')} was open`); open.push(e); }
    if (e.ev === 'bytesClose') { const o = open.pop(); if (!o || o.path !== e.path || o.root !== e.root) out.push(`${e.root} ${e.path} closed, not the one open`); }
  }
  if (open.length) out.push(`left open: ${open.map((o) => o.path).join(', ')}`);
  return out;
};

test('no overlap: across a set-aside and its write-back, no file\'s bytes are opened while another\'s are open', (t) => {
  const events = threeFiles(t, watched(t, ['bytesOpen', 'bytesClose']));
  assert.ok(events.filter((e) => e.ev === 'bytesOpen').length >= 9, `too few reads seen to hold anything: ${events.length}`);
  assert.deepEqual(overlaps(events), []);
});

test('no overlap\'s instrument: a read opened inside another is named', () => {
  const ev = (k, p, root = 'tree') => ({ ev: k, path: p, root });
  assert.deepEqual(overlaps([ev('bytesOpen', 'a'), ev('bytesClose', 'a'), ev('bytesOpen', 'b'), ev('bytesClose', 'b')]), []);
  assert.match(overlaps([ev('bytesOpen', 'a'), ev('bytesOpen', 'b', 'owner'), ev('bytesClose', 'b', 'owner'), ev('bytesClose', 'a')]).join(), /owner b opened while tree a was open/);
});

// Classification opens no bytes, and each refused file's bytes are opened once, before its own copy: up to the last copy,
// the reads between one copy and the next are exactly that file's, from the tree.
const readOrder = (events, files) => {
  const out = [];
  const lastCopy = events.map((e) => e.ev).lastIndexOf('copy');
  let since = [];
  const copied = [];
  for (const e of events.slice(0, lastCopy + 1)) {
    if (e.ev === 'bytesOpen') since.push(`${e.root} ${e.path}`);
    if (e.ev === 'copy') {
      if (since.join() !== `tree ${e.path}`) out.push(`before the copy of ${e.path}, the reads were [${since.join(', ')}], not its own one`);
      copied.push(e.path);
      since = [];
    }
  }
  if (copied.join() !== files.join()) out.push(`copies of [${copied.join(', ')}], not of [${files.join(', ')}]`);
  return out;
};

test('read order: classification opens no file\'s bytes, and each refused file is opened once, for its own copy', (t) => {
  const events = threeFiles(t, watched(t, ['bytesOpen', 'copy']));
  assert.deepEqual(readOrder(events, THREE), []);
});

test('read order\'s instrument: a read during classification, or a second read of a file, is named', () => {
  const open = (p) => ({ ev: 'bytesOpen', root: 'tree', path: p });
  const copy = (p) => ({ ev: 'copy', path: p });
  assert.deepEqual(readOrder([open('a'), copy('a'), open('b'), copy('b')], ['a', 'b']), []);
  assert.match(readOrder([open('b'), open('a'), copy('a'), open('b'), copy('b')], ['a', 'b']).join(), /before the copy of a, the reads were \[tree b, tree a\]/);
  assert.match(readOrder([open('a'), open('a'), copy('a')], ['a']).join(), /the reads were \[tree a, tree a\]/);
});

// ------------------------------------------------------------------------------------------- the empirical bound
// MEASURED on this machine before the bound was written (Windows 11, Node 24.13.1, 2026-11-08; five runs of
// `node --expose-gc tests/tools/set-aside-memory-child.mjs 4 8388608`): at every one of the 16 bytes-close events of each
// run, after a forced collection,
// arrayBuffers stood at exactly one file above the baseline, 0 bytes over (min 0, max 0). The bytes still referenced as a
// callback ends are that callback's file, whose frame has not yet returned. SLACK is 1 MiB above one file: far below a
// second file, so a callback that keeps its buffer, or two files read at once, fails here.
// SWEEPING IS SYNCHRONOUS IN THE CHILD (--no-concurrent-array-buffer-sweeping): under the full suite the first version of
// this test saw two files held at two of its samples. V8 frees an ArrayBuffer's memory on a background sweeper, so a forced
// collection can return before the previous file's bytes are counted as freed. Measured the same day with 32 children at
// once, twice: without the flag 29 and 10 of 32 runs went over the slack; with it, 0 and 0. The flag removes that lag, not
// a retention: a callback that keeps its buffer still fails (rts-stage3-red-keep-buffers.log).
const SIZE = 8 * 1024 * 1024;
const COUNT = 4;
const SLACK = 1024 * 1024;
const CHILD_FLAGS = ['--expose-gc', '--no-concurrent-array-buffer-sweeping'];
// A V8 FLAG, NOT A NODE ONE: checked on Node 24.13.1 only. A supported line whose V8 lacks it would refuse to start the
// child, so the test asks this node's V8 first and skips visibly, naming why, rather than failing at startup or measuring
// without it (which flakes under load, above).
const v8HasSweepFlag = () => /concurrent-array-buffer-sweeping/.test(spawnSync(process.execPath, ['--v8-options'], { encoding: 'utf8' }).stdout ?? '');

test('the one-file bound, measured: at each bytes-close the bytes still referenced are at most one file plus a slack', (t) => {
  if (!v8HasSweepFlag()) { t.skip(`this node's V8 (${process.versions.v8}) has no --no-concurrent-array-buffer-sweeping, which the measurement needs`); return; }
  const child = path.join(REPO_ROOT, 'tests', 'tools', 'set-aside-memory-child.mjs');
  const r = spawnSync(process.execPath, [...CHILD_FLAGS, child, String(COUNT), String(SIZE)], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(o.restored, true, 'the measured set-aside did not write every file back');
  assert.ok(o.samples.length >= COUNT * 2, `too few reads measured: ${o.samples.length}`);
  const over = o.samples.filter((s) => s.held > SIZE + SLACK);
  assert.deepEqual(over.map((s) => `${s.path}: ${s.held} bytes held`), [], `more than one file of ${SIZE} plus ${SLACK} held`);
});
