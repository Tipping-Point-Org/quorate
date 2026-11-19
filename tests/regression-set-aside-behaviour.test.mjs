// THE SET-ASIDE'S PROPERTIES, RUN RATHER THAN READ (runner-test-seam.plan.md stage 4, design RT-D4 A). Each review of the
// set-aside-identity chain confirmed a test that matched scripts/remediate.mjs's text in place of running it (G-21, G-22 of
// 20261107-224233-si-remediation-review; G-15 of 20261108-032104; G-7, G-8, G-9 of 20261108-050415; the design's list), and a
// source match passes a rewrite that keeps the spelling and fails one that keeps the behaviour. These tests import
// scripts/io/set-aside.mjs and run it over the real capabilities, each property shown failing on a mutation of the module
// (rts-stage4-red-*.log). The tests they replace are named where those stood.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import diagnosticsChannel from 'node:diagnostics_channel';
import { createHash } from 'node:crypto';
import { setAsideCapabilities, setAsideRefused, writeBackSetAside, SetAsideError, SET_ASIDE_CHANNELS } from '../scripts/io/set-aside.mjs';
import { setAsideAtHead, setAsideMayOverwrite, setAsideRestoredPaths, setAsideRecovery } from '../scripts/lib/remediation-chain.mjs';
import { setAsideFixture, realCapabilities } from './tools/set-aside-capabilities.mjs';

const read = (f, p) => { try { return fs.readFileSync(path.join(f.repo, ...p.split('/')), 'utf8'); } catch { return null; } };
const copiesOf = (f, record) => fs.readdirSync(path.join(f.runDir, ...record.set_aside_dir.split('/'), 'files')).sort();
const refused = (paths) => [{ id: 'c2', committable: false, accepted: paths }];
function listen(t, names) {
  const events = [];
  const subs = names.map((k) => [k, (m) => events.push({ ev: k, ...m })]);
  for (const [k, fn] of subs) diagnosticsChannel.subscribe(SET_ASIDE_CHANNELS[k], fn);
  t.after(() => { for (const [k, fn] of subs) diagnosticsChannel.unsubscribe(SET_ASIDE_CHANNELS[k], fn); });
  return events;
}
// A stat of `p` that reports its mode with the owner-execute bit flipped, once `armed()` says so: a chmod the platform may
// not let a test make (Windows keeps no exec bit), seen exactly as the module reads it.
const flippedMode = (tree, p, armed) => ({ ...tree, stat(segs, ...rest) {
  const st = tree.stat(segs, ...rest);
  if (segs.join('/') !== p || !armed()) return st;
  return Object.create(st, { mode: { value: st.mode ^ 0o100 } });
} });

// ------------------------------------------------------------------------------------- classification, through git
// Replaces regression-set-aside-identity's "stage 1 (G-6)" and "G-8 of 20261108-032104-si-remediation-4-review" source
// matches: the plan's batched count, held through the `git` channel.
const THREE = ['tests/b.js', 'tests/c.js', 'tests/d.js'];
const TRACKED = { committed: { 'src/a.js': 'a\n', 'tests/b.js': 'b0\n', 'tests/c.js': 'c0\n', 'tests/d.js': 'd0\n' },
  working: { 'tests/b.js': 'b1\n', 'tests/c.js': 'c1\n', 'tests/d.js': 'd1\n' } };

test('G-6: classifying three refused files starts one ls-tree naming all three and one hash-object --stdin-paths, no git process per file', (t) => {
  const f = setAsideFixture(t, TRACKED);
  const events = listen(t, ['git', 'copy']);
  const { caps } = realCapabilities(f);
  const r = setAsideRefused(caps, refused(THREE), {});
  const classifying = events.slice(0, events.findIndex((e) => e.ev === 'copy')).map((e) => e.args);
  assert.deepEqual(classifying.map((a) => a[0]), ['ls-tree', 'hash-object'], `classification's git calls: ${JSON.stringify(classifying)}`);
  for (const p of THREE) assert.ok(classifying[0].includes(`:(literal)${p}`), `the one ls-tree does not name ${p}`);
  assert.deepEqual(classifying[1], ['hash-object', '--stdin-paths']);
  // G-8 of 20261108-032104: HEAD's blob comes from that ls-tree, not a rev-parse per file.
  assert.deepEqual(events.filter((e) => e.ev === 'git' && e.args[0] === 'rev-parse'), [], 'a rev-parse during the set-aside');
  assert.ok(r.record.entries.every((e) => /^[0-9a-f]{40,64}$/.test(e.head_blob)), 'HEAD\'s blob is not recorded');
});

// Replaces the source half of regression-set-aside-identity's "G-6 of 20261107-220617-si-delivery".
test('G-6 of 20261107-220617-si-delivery: a failed ls-tree reads every refused file as unreadable, never as new, and nothing is touched', (t) => {
  const f = setAsideFixture(t, TRACKED);
  const { caps } = realCapabilities(f);
  const failing = { ...caps, git: (argv, opts) => (argv[0] === 'ls-tree' ? { status: 128, stdout: '', stderr: 'fatal: injected' } : caps.git(argv, opts)) };
  const r = setAsideRefused(failing, refused(THREE), {});
  assert.equal(r.record, null, 'a file was set aside on a failed ls-tree');
  assert.deepEqual(r.kept, [{ id: 'c2', why: 'tests/b.js is a unreadable; tests/c.js is a unreadable; tests/d.js is a unreadable' }]);
  for (const p of THREE) assert.equal(read(f, p), `${p.slice(6, 7)}1\n`, `${p} was removed or put back`);
});

// Replaces the source half of regression-set-aside-identity's "G-7 of 20261107-220617-si-delivery".
test('G-7 of 20261107-220617-si-delivery: only the refused clusters\' files are classified; a committable cluster\'s are not read', (t) => {
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n' }, working: { 'src/a.js': 'fixed\n', 'tests/b.js': 'b1\n' } });
  const events = listen(t, ['classified']);
  const { caps } = realCapabilities(f);
  setAsideRefused(caps, [{ id: 'c1', committable: true, accepted: ['src/a.js'] }, ...refused(['tests/b.js'])], {});
  assert.deepEqual([...events[0].states.keys()], ['tests/b.js'], 'a committable cluster\'s file was classified');
  assert.equal(read(f, 'src/a.js'), 'fixed\n', 'the committable cluster\'s edit was touched');
});

// Replaces regression-set-aside-identity-2's "G-14" source matches (its kindsOfPaths regex and its loop over the section).
test('G-14: every git call of a set-aside and its write-back that names a path after `--` names it literally; a bracketed name is put back to HEAD, not removed', (t) => {
  const name = 'tests/[b].js';
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n', [name]: 'committed\n' }, working: { [name]: 'from the node\n' } });
  const events = listen(t, ['git']);
  const { caps } = realCapabilities(f);
  const r = setAsideRefused(caps, refused([name]), {});
  assert.deepEqual(r.record.entries.map((e) => [e.path, e.kind]), [[name, 'modified']], 'a tracked bracketed name was read as new');
  assert.equal(read(f, name), 'committed\n', 'not put back to HEAD');
  assert.deepEqual(writeBackSetAside(caps, r.record.dir.join('/')), []);
  assert.equal(read(f, name), 'from the node\n');
  const withPaths = events.filter((e) => e.args.includes('--'));
  assert.deepEqual([...new Set(withPaths.map((e) => e.args[0]))].sort(), ['checkout', 'diff', 'ls-tree'], 'the ls-tree, the checkout and the diff were not all seen');
  for (const e of withPaths) {
    for (const a of e.args.slice(e.args.indexOf('--') + 1)) assert.match(a, /^:\(literal\)/, `git ${e.args.join(' ')} takes a path as a pathspec`);
  }
});

// Replaces regression-set-aside-identity's "G-12" source match. NTFS refuses a line break in a file name.
test('G-12: a path holding a line break is read as unreadable alone; the other files are still hashed in one batch', (t) => {
  if (process.platform === 'win32') { t.skip('NTFS cannot hold a line break in a file name; Linux and macOS run this case'); return; }
  const odd = 'tests/a\nb.js';
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n', 'tests/c.js': 'c0\n' }, working: { [odd]: 'odd\n', 'tests/c.js': 'c1\n' } });
  const events = listen(t, ['classified']);
  const { caps } = realCapabilities(f);
  const r = setAsideRefused(caps, [...refused([odd]), { id: 'c3', committable: false, accepted: ['tests/c.js'] }], {});
  assert.deepEqual(r.kept, [{ id: 'c2', why: `${odd} is a unreadable` }]);
  assert.ok(events[0].states.get('tests/c.js').worktree_blob, 'the other file lost its hash to the line break');
  assert.deepEqual(r.record.entries.map((e) => e.path), ['tests/c.js']);
});

// ------------------------------------------------------------------------------------------- the copy and the put-back
// Replaces the source half of regression-set-aside-identity's "G-8, G-9 of 20261107-220617-si-delivery".
test('G-8 of 20261107-220617-si-delivery: a file whose stat moved between classification and its copy is refused, with nothing copied or put back', (t) => {
  const f = setAsideFixture(t, TRACKED);
  const grow = ({ files }) => { if (files.includes('tests/c.js')) fs.appendFileSync(path.join(f.repo, 'tests', 'c.js'), 'grown\n'); };
  diagnosticsChannel.subscribe(SET_ASIDE_CHANNELS.classified, grow);
  t.after(() => diagnosticsChannel.unsubscribe(SET_ASIDE_CHANNELS.classified, grow));
  const { caps, record } = realCapabilities(f);
  let err = null;
  try { setAsideRefused(caps, refused(THREE), {}); } catch (e) { err = e; }
  assert.ok(err instanceof SetAsideError, `not refused: ${err?.stack ?? 'it completed'}`);
  assert.equal(err.message, 'tests/c.js changed after it was classified, so it was not set aside; nothing was put back');
  assert.equal(read(f, 'tests/b.js'), 'b1\n', 'a file was put back');
  assert.deepEqual(record.set_aside, []);
  assert.deepEqual(copiesOf(f, record), ['1'], 'a copy was made of the file that moved');
});

// Replaces regression-set-aside-identity-2's "G-16" source match.
test('G-16: a mode changed after the copy, the bytes unchanged, stops the put-back as a change', (t) => {
  const f = setAsideFixture(t, TRACKED);
  const { caps } = realCapabilities(f);
  let manifest = false;
  const watched = { ...caps,
    owner: { ...caps.owner, replace(segs, ...rest) { const o = caps.owner.replace(segs, ...rest); if (segs.at(-1) === 'manifest.json') manifest = true; return o; } },
    tree: flippedMode(caps.tree, 'tests/b.js', () => manifest) };
  let err = null;
  try { setAsideRefused(watched, refused(THREE), {}); } catch (e) { err = e; }
  assert.ok(err instanceof SetAsideError, `not refused: ${err?.stack ?? 'it completed'}`);
  assert.match(err.message, /^tests\/b\.js changed after it was copied aside, so it was not put back to HEAD for the full check/);
  assert.equal(read(f, 'tests/b.js'), 'b1\n');
});

// Replaces the source half of regression-set-aside-modes-and-die's "G-11".
test('G-11: the record is handed to the finisher\'s holder before the first path is put back', (t) => {
  const f = setAsideFixture(t, TRACKED);
  const { caps } = realCapabilities(f);
  const holder = {};
  const seen = [];
  const watched = { ...caps, git: (argv, opts) => { if (argv[0] === 'checkout') seen.push(Boolean(holder.record)); return caps.git(argv, opts); } };
  setAsideRefused(watched, refused(THREE), holder);
  assert.deepEqual(seen, [true, true, true], 'a path was put back before the holder had the record');
});

// --------------------------------------------------------------------------------------------------- the write-back
// Replaces regression-set-aside-write-back's "G-8" source matches.
test('G-8 of 20261107-195640-co-remediation-2-review: each entry records its file\'s mode, and the write-back hands that mode to replace', (t) => {
  const f = setAsideFixture(t, TRACKED);
  const { caps, record } = realCapabilities(f);
  const r = setAsideRefused(caps, refused(THREE), {});
  assert.ok(record.set_aside.every((e) => Number.isInteger(e.mode)), `an entry with no mode: ${JSON.stringify(record.set_aside)}`);
  const modes = [];
  const watched = { ...caps, tree: { ...caps.tree, replace(segs, data, opts) { modes.push([segs.join('/'), opts?.mode]); return caps.tree.replace(segs, data, opts); } } };
  assert.deepEqual(writeBackSetAside(watched, r.record.dir.join('/')), []);
  assert.deepEqual(modes, r.record.entries.map((e) => [e.path, e.mode]));
});

// Replaces regression-set-aside-identity-2's "G-18" source match.
test('G-18: a write-back whose file reads back with another mode is not restored; its copy is kept and the mode recorded', (t) => {
  const f = setAsideFixture(t, TRACKED);
  const { caps, record } = realCapabilities(f);
  const r = setAsideRefused(caps, refused(['tests/b.js']), {});
  let written = false;
  const watched = { ...caps, tree: { ...flippedMode(caps.tree, 'tests/b.js', () => written),
    replace(segs, ...rest) { const o = caps.tree.replace(segs, ...rest); written = true; return o; } } };
  const failed = writeBackSetAside(watched, r.record.dir.join('/'));
  assert.deepEqual(failed.map((x) => [x.path, x.why]), [['tests/b.js', 'its hash differs after writing']]);
  assert.equal(record.set_aside[0].restored, false);
  assert.equal(record.set_aside[0].written_mode, r.record.entries[0].mode ^ 0o100, 'the mode the write left is not recorded');
  assert.deepEqual(copiesOf(f, record), ['1'], 'the copy was removed');
});

// Replaces regression-set-aside-identity's "G-13" source matches.
test('G-13: a retry overwrites only what a failed write-back left, at the mode it left; a chmod since is not the runner\'s', (t) => {
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n' }, working: { 'tests/c.js': 'c, from the node\n' } });
  const { caps, record } = realCapabilities(f);
  const r = setAsideRefused(caps, refused(['tests/c.js']), {});
  const dir = r.record.dir.join('/');
  let first = true;
  const wrong = { ...caps, tree: { ...caps.tree, replace(segs, data, opts) {
    if (!first) return caps.tree.replace(segs, data, opts);
    first = false;
    return caps.tree.replace(segs, Buffer.concat([Buffer.from(data), Buffer.from('a byte the write did not put there\n')]), opts);
  } } };
  assert.deepEqual(writeBackSetAside(wrong, dir).map((x) => x.why), ['its hash differs after writing']);
  assert.ok(record.set_aside[0].written_sha256 && Number.isInteger(record.set_aside[0].written_mode), `the failed write is not recorded: ${JSON.stringify(record.set_aside[0])}`);
  const chmodded = { ...caps, tree: flippedMode(caps.tree, 'tests/c.js', () => true) };
  assert.deepEqual(writeBackSetAside(chmodded, dir).map((x) => x.why), ['it changed since it was set aside, so it was not overwritten'], 'a chmod since the failed write was overwritten');
  // THE SKIP KEEPS WHAT THE FAILED WRITE LEFT (found by this test in runner-test-seam stage 4,
  // rts-stage4-finding-written-state-dropped.log): the skipped write-back recorded the entry without written_sha256 and
  // written_mode, so once the chmod was undone the retry refused the runner's own failed write as a change.
  assert.ok(record.set_aside[0].written_sha256 && Number.isInteger(record.set_aside[0].written_mode), `the skip dropped what the failed write left: ${JSON.stringify(record.set_aside[0])}`);
  assert.deepEqual(writeBackSetAside(caps, dir), [], 'the retry after the chmod was undone did not overwrite what the failed write left');
  assert.equal(read(f, 'tests/c.js'), 'c, from the node\n');
});

// Replaces the source half of regression-set-aside-write-back's "G-7": the record 85f45c55 wrote, read through lib.
test('G-7 of 20261107-195640-co-remediation-2-review: a failed write-back left in the older record shape is still overwritten by the retry', (t) => {
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n' }, working: { 'tests/c.js': 'c, from the node\n' } });
  const { caps, record } = realCapabilities(f);
  const r = setAsideRefused(caps, refused(['tests/c.js']), {});
  const dir = r.record.dir.join('/');
  fs.writeFileSync(path.join(f.repo, 'tests', 'c.js'), 'what a failed write left\n');
  const left = record.set_aside.map((e) => ({ ...e, restored: false,
    written_sha256: createHash('sha256').update(fs.readFileSync(path.join(f.repo, 'tests', 'c.js'))).digest('hex') }));
  for (const k of Object.keys(record)) delete record[k];
  Object.assign(record, { set_aside: { dir, entries: left } });   // the 85f45c55 shape
  assert.deepEqual(writeBackSetAside(caps, dir), [], 'the older record\'s written bytes were not honoured');
  assert.equal(read(f, 'tests/c.js'), 'c, from the node\n');
});

// Replaces regression-set-aside-identity's "G-14" source match.
test('G-14 of 20261108-021347-si-remediation-2-review: a partial write-back removes the copy of every restored entry, one already matching its copy included', (t) => {
  const f = setAsideFixture(t, TRACKED);
  const { caps, record } = realCapabilities(f);
  const r = setAsideRefused(caps, refused(['tests/b.js', 'tests/c.js']), {});
  fs.writeFileSync(path.join(f.repo, 'tests', 'c.js'), 'c1\n');            // already back, as after an interrupted write-back
  fs.writeFileSync(path.join(f.repo, 'tests', 'b.js'), 'an edit meanwhile\n');   // not the runner's to overwrite
  const failed = writeBackSetAside(caps, r.record.dir.join('/'));
  assert.deepEqual(failed.map((x) => x.path), ['tests/b.js']);
  assert.deepEqual(copiesOf(f, record), ['1'], 'the restored entry\'s copy was kept, or the skipped one\'s removed');
});

// G-2 of 20261108-222629-rts-delivery: which state a write-back may overwrite is lib's, so it is tested by calling it.
test('G-2 of 20261108-222629-rts-delivery: setAsideAtHead and setAsideMayOverwrite decide from values already read', () => {
  const facts = { blobs: new Map([['a', 'h1'], ['m', 'h1']]), modeChanged: new Set(['m']) };
  const tracked = (p) => ({ path: p, kind: 'modified', head_blob: 'h1' });
  const file = { kind: 'file', sha256: 's1', mode: 0o644 };
  assert.equal(setAsideAtHead({ path: 'n', kind: 'new' }, { kind: 'absent' }, facts), true, 'a new file put back is absent');
  assert.equal(setAsideAtHead({ path: 'n', kind: 'new' }, file, facts), false, 'a new file still there');
  assert.equal(setAsideAtHead({ path: 'a', kind: 'modified' }, { kind: 'absent' }, facts), false, 'a manifest before head_blob is not taken as at HEAD on a path now absent (G-3 of 20261108-234028)');
  assert.equal(setAsideAtHead(tracked('a'), { kind: 'directory' }, facts), false, 'a non-file is not at HEAD');
  assert.equal(setAsideAtHead(tracked('a'), file, facts), true);
  assert.equal(setAsideAtHead(tracked('m'), file, facts), false, 'HEAD\'s blob at another mode');
  assert.equal(setAsideAtHead(tracked('z'), file, facts), false, 'a batch that answered nothing');
  assert.equal(setAsideMayOverwrite(tracked('a'), file, facts, undefined), true, 'at HEAD');
  assert.equal(setAsideMayOverwrite(tracked('z'), file, facts, undefined), false, 'neither at HEAD nor left by a write');
  assert.equal(setAsideMayOverwrite(tracked('z'), file, facts, { sha256: 's1', mode: 0o644 }), true, 'what a failed write left');
  assert.equal(setAsideMayOverwrite(tracked('z'), file, facts, { sha256: 's1', mode: null }), true, 'a record keeping no mode');
  assert.equal(setAsideMayOverwrite(tracked('z'), file, facts, { sha256: 's1', mode: 0o755 }), false, 'a chmod since is not the runner\'s');
  assert.equal(setAsideMayOverwrite(tracked('z'), file, facts, { sha256: 's2', mode: 0o644 }), false, 'other bytes are not the runner\'s');
});

test('G-5 of 20261108-222629-rts-delivery: setAsideRestoredPaths reads both record shapes, and only the folder asked about', () => {
  const entries = [{ path: 'a', restored: true }, { path: 'b', restored: false }];
  assert.deepEqual([...setAsideRestoredPaths({ set_aside_dir: 'd', set_aside: entries }, 'd')], ['a']);
  assert.deepEqual([...setAsideRestoredPaths({ set_aside: { dir: 'd', entries } }, 'd')], ['a'], 'the 85f45c55 record');
  assert.deepEqual([...setAsideRestoredPaths({ set_aside_dir: 'other', set_aside: entries }, 'd')], [], 'another folder');
  assert.deepEqual([...setAsideRestoredPaths({}, 'd')], []);
});

// G-5 of 20261108-222629-rts-delivery: a retried pass re-judged every entry from its bytes, so a file already handed back, its
// copy gone, was failed again if the operator had since edited it or reset it to HEAD, and the run could not get past recovery.
test('G-5 of 20261108-222629-rts-delivery: a retried write-back leaves an entry the last pass restored alone, whatever is at its path now', (t) => {
  for (const [row, now] of [['edited', 'c, edited after it was handed back\n'], ['reset to HEAD', 'c0\n'], ['removed', null]]) {
    const f = setAsideFixture(t, TRACKED);
    const { caps, record } = realCapabilities(f);
    const r = setAsideRefused(caps, refused(['tests/b.js', 'tests/c.js']), {});
    const dir = r.record.dir.join('/');
    fs.writeFileSync(path.join(f.repo, 'tests', 'b.js'), 'an edit meanwhile\n');   // skipped, so the pass is partial
    assert.deepEqual(writeBackSetAside(caps, dir).map((x) => x.path), ['tests/b.js'], row);
    assert.deepEqual(record.set_aside.map((e) => [e.path, e.restored]), [['tests/b.js', false], ['tests/c.js', true]], row);
    // The operator undoes the edit that blocked b, and changes c, which is theirs again.
    fs.writeFileSync(path.join(f.repo, 'tests', 'b.js'), 'b0\n');
    if (now === null) fs.rmSync(path.join(f.repo, 'tests', 'c.js')); else fs.writeFileSync(path.join(f.repo, 'tests', 'c.js'), now);
    assert.deepEqual(writeBackSetAside(caps, dir), [], `${row}: the entry already handed back was failed again`);
    assert.equal(read(f, 'tests/b.js'), 'b1\n', `${row}: the skipped entry was not written back`);
    assert.equal(read(f, 'tests/c.js'), now, `${row}: the entry already handed back was changed`);
    assert.deepEqual(record.set_aside.map((e) => [e.path, e.restored]), [['tests/b.js', true], ['tests/c.js', true]], row);
    assert.equal(fs.existsSync(path.join(f.runDir, ...dir.split('/'))), false, `${row}: the folder was not removed`);
  }
});

// Replaces the source half of regression-printed-recovery-args's "a failed removal of a restored set-aside copy is named".
test('a failed removal of a restored entry\'s copy is named, and an absent copy is not', (t) => {
  for (const [code, named] of [['EBUSY', true], ['ENOENT', false]]) {
    const f = setAsideFixture(t, TRACKED);
    const { caps, lines } = realCapabilities(f);
    const r = setAsideRefused(caps, refused(['tests/b.js', 'tests/c.js']), {});
    fs.writeFileSync(path.join(f.repo, 'tests', 'b.js'), 'an edit meanwhile\n');
    const failing = { ...caps, owner: { ...caps.owner, remove(segs, ...rest) {
      if (segs.at(-2) === 'files') throw Object.assign(new Error(`${code}: injected`), { code });
      return caps.owner.remove(segs, ...rest);
    } } };
    assert.deepEqual(writeBackSetAside(failing, r.record.dir.join('/')).map((x) => x.path), ['tests/b.js']);
    const said = lines.filter((l) => /could not remove the copy of it/.test(l));
    if (named) assert.deepEqual(said, [`remediate: wrote back tests/c.js, but could not remove the copy of it under ${r.record.dir.join('/')} in the run directory (EBUSY); delete it by hand`]);
    else assert.deepEqual(said, [], 'an absent copy was reported');
  }
});

// ------------------------------------------------------------------------------------------------ the one read
// Replaces regression-set-aside-identity's "G-4 of 20261108-043341-si-remediation-5-review-b" source match.
test('G-4 of 20261108-043341-si-remediation-5-review-b: withFileBytes hands the callback the Buffer its read returned, and makes another view one', (t) => {
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n' } });
  const { caps } = realCapabilities(f);
  const returned = [];
  const base = (view) => ({ ...caps.tree, read(segs, enc) { const b = view(fs.readFileSync(path.join(f.repo, ...segs))); returned.push(b); return b; } });
  const built = (tree) => setAsideCapabilities({ ...caps, tree });   // the shipped builder, over a tree whose read is watched
  const same = built(base((b) => b)).tree.withFileBytes(['src', 'a.js'], (bytes) => bytes === returned.at(-1));
  assert.equal(same, true, 'the read\'s Buffer was copied before the callback got it');
  const made = built(base((b) => new Uint8Array(b))).tree.withFileBytes(['src', 'a.js'], (bytes) => [Buffer.isBuffer(bytes), bytes.toString('utf8')]);
  assert.deepEqual(made, [true, 'a\n'], 'another byte view is not made a Buffer');
});

// Replaces the source half of regression-set-aside-modes-and-die's "G-3".
test('G-3 of 20261107-205850-co-remediation-4: an entry whose bytes match its copy but whose mode does not is not taken as restored', (t) => {
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n' }, working: { 'tests/c.js': 'c, from the node\n' } });
  const { caps, record } = realCapabilities(f);
  const r = setAsideRefused(caps, refused(['tests/c.js']), {});
  fs.writeFileSync(path.join(f.repo, 'tests', 'c.js'), 'c, from the node\n');   // the bytes back, by someone else
  const chmodded = { ...caps, tree: flippedMode(caps.tree, 'tests/c.js', () => true) };
  assert.deepEqual(writeBackSetAside(chmodded, r.record.dir.join('/')).map((x) => x.path), ['tests/c.js'], 'a mode-only difference was read as restored');
  assert.equal(record.set_aside[0].restored, false);
  assert.deepEqual(copiesOf(f, record), ['1'], 'the copy was removed though the mode was never put back');
});

// Replaces the source half of regression-set-aside-modes-and-die's "G-8" (atHead's rule that a non-file is not at HEAD).
test('G-8 of 20261107-205850-co-remediation-4: a put-back that leaves a directory where HEAD has a file stops the run, the bytes kept', (t) => {
  const f = setAsideFixture(t, TRACKED);
  const { caps, record } = realCapabilities(f);
  const dirInstead = { ...caps, git: (argv, opts) => {
    if (argv[0] !== 'checkout') return caps.git(argv, opts);
    const p = argv.at(-1).replace(':(literal)', '');
    fs.rmSync(path.join(f.repo, ...p.split('/')));
    fs.mkdirSync(path.join(f.repo, ...p.split('/')));
    return { status: 0, stdout: '', stderr: '' };
  } };
  let err = null;
  try { setAsideRefused(dirInstead, refused(['tests/b.js']), {}); } catch (e) { err = e; }
  assert.ok(err instanceof SetAsideError, `not refused: ${err?.stack ?? 'it completed'}`);
  assert.match(err.message, /^tests\/b\.js does not match HEAD's blob [0-9a-f]+ after it was put back for the full check/);
  assert.deepEqual(copiesOf(f, record), ['1'], 'the bytes were not kept');
});

// G-3 of 20261108-234028-rts-remediation-review-b: a tracked entry in a manifest written before head_blob existed was taken as
// at HEAD whatever its path held, so recovering it replaced a later edit with the stale copy, and that edit was gone.
function legacySetAside(t) {
  const f = setAsideFixture(t, TRACKED);
  const { caps, record, lines } = realCapabilities(f);
  const r = setAsideRefused(caps, refused(['tests/b.js']), {});
  const dir = r.record.dir.join('/');
  const manifest = path.join(f.runDir, ...r.record.dir, 'manifest.json');
  const held = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const e of held.entries) delete e.head_blob;
  fs.writeFileSync(manifest, JSON.stringify(held));
  for (const e of record.set_aside) delete e.head_blob;
  return { f, caps, record, lines, dir };
}

test('G-3 of 20261108-234028: a later edit at a path in a manifest with no head_blob is kept, its copy with it, and the path named', (t) => {
  const { f, caps, record, dir } = legacySetAside(t);
  fs.writeFileSync(path.join(f.repo, 'tests', 'b.js'), 'the operator\'s later edit\n');
  const failed = writeBackSetAside(caps, dir);
  assert.equal(read(f, 'tests/b.js'), 'the operator\'s later edit\n', 'the stale copy replaced a later edit');
  assert.deepEqual(failed.map((x) => [x.path, x.why]), [['tests/b.js', 'it changed since it was set aside, so it was not overwritten']]);
  assert.deepEqual(copiesOf(f, record), ['1'], 'the copy was not kept');
});

test('G-3 of 20261108-234028: a tracked path deleted since, in a manifest with no head_blob, is named and not written over', (t) => {
  const { f, caps, dir } = legacySetAside(t);
  fs.rmSync(path.join(f.repo, 'tests', 'b.js'));
  assert.deepEqual(writeBackSetAside(caps, dir).map((x) => x.path), ['tests/b.js']);
  assert.equal(read(f, 'tests/b.js'), null, 'a deletion made since was undone by the stale copy');
});

test('G-3 of 20261108-234028: the older record is still recovered: a path git still holds, at the blob HEAD holds now, is written back', (t) => {
  const { f, caps, dir } = legacySetAside(t);
  assert.equal(read(f, 'tests/b.js'), 'b0\n', 'the fixture did not put the path back to HEAD');
  assert.deepEqual(writeBackSetAside(caps, dir), []);
  assert.equal(read(f, 'tests/b.js'), 'b1\n');
});

test('G-3 of 20261108-234028: setAsideAtHead holds an entry with no head_blob to the blob HEAD holds now, and to nothing when git did not answer', () => {
  const legacy = { path: 'a', kind: 'modified' };
  const file = { kind: 'file', sha256: 's1', mode: 0o644 };
  const facts = { blobs: new Map([['a', 'h1']]), modeChanged: new Set(), headNow: new Map([['a', 'h1']]) };
  assert.equal(setAsideAtHead(legacy, file, facts), true, 'the blob HEAD holds now');
  assert.equal(setAsideAtHead(legacy, { kind: 'absent' }, facts), false, 'a tracked path now absent');
  assert.equal(setAsideAtHead(legacy, file, { ...facts, blobs: new Map([['a', 'h2']]) }), false, 'a later edit');
  assert.equal(setAsideAtHead(legacy, file, { ...facts, modeChanged: new Set(['a']) }), false, 'a chmod since');
  assert.equal(setAsideAtHead(legacy, file, { blobs: new Map(), modeChanged: new Set(), headNow: new Map() }), false, 'neither batch answered');
});

// G-2 of 20261108-234028: a removal that failed during recovery threw, with no try around it in the runner, so the run ended in
// a stack rather than a recorded set-aside-unrestored and a printed reason. The same removal in the search for a free number.
const busyOwner = (caps) => ({ ...caps, owner: { ...caps.owner, remove() { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); } } });
function partialFolder(t) {
  const f = setAsideFixture(t, TRACKED);
  const dir = 'evidence/remediation-runner/set-aside-1';
  fs.mkdirSync(path.join(f.runDir, ...dir.split('/'), 'files'), { recursive: true });
  fs.writeFileSync(path.join(f.runDir, ...dir.split('/'), 'files', '1'), 'a partial copy\n');
  return { f, dir };
}

test('G-2 of 20261108-234028: a partial folder that cannot be removed is returned as a failure naming it, its record kept for the retry', (t) => {
  const { f, dir } = partialFolder(t);
  const { caps, record } = realCapabilities(f, { record: { set_aside_dir: dir, set_aside: [] } });
  const failed = writeBackSetAside(busyOwner(caps), dir);
  assert.equal(failed.length, 1, `not one failure: ${JSON.stringify(failed)}`);
  assert.equal(failed[0].path, dir);
  assert.match(failed[0].why, /could not be removed \(EBUSY\)/);
  assert.equal(record.set_aside_dir, dir, 'the record was dropped, so no retry would remove the copies');
  assert.deepEqual(writeBackSetAside(caps, dir), [], 'the retry did not remove them');
  assert.equal(record.set_aside_dir, null);
  assert.equal(fs.existsSync(path.join(f.runDir, ...dir.split('/'))), false);
});

test('G-2 of 20261108-234028: a folder left with no manifest that cannot be removed while a free number is sought is a refusal, nothing touched', (t) => {
  const { f } = partialFolder(t);
  const { caps } = realCapabilities(f);
  let err = null;
  try { setAsideRefused(busyOwner(caps), refused(['tests/b.js']), {}); } catch (e) { err = e; }
  assert.ok(err instanceof SetAsideError, `not a SetAsideError: ${err?.stack ?? 'it completed'}`);
  assert.match(err.message, /could not remove .*set-aside-1.*\(EBUSY\); nothing was put back/);
  assert.equal(read(f, 'tests/b.js'), 'b1\n', 'the edit was touched');
});

// The same mechanism at the set-aside's other run-directory writes, found by G-2's census: a copy, the manifest or the record
// that could not be written threw past the runner's catch of a SetAsideError, a stack with nothing yet put back.
for (const [what, fault] of [
  ['the copy', (caps) => ({ ...caps, owner: { ...caps.owner, create() { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); } } })],
  ['the manifest', (caps) => ({ ...caps, owner: { ...caps.owner, replace() { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); } } })],
  ['the record', (caps) => ({ ...caps, run: { ...caps.run, save() { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); } } })],
]) {
  test(`G-2 of 20261108-234028: ${what} that cannot be written is a refusal naming the code, and nothing is put back`, (t) => {
    const f = setAsideFixture(t, TRACKED);
    const { caps } = realCapabilities(f);
    let err = null;
    try { setAsideRefused(fault(caps), refused(['tests/b.js']), {}); } catch (e) { err = e; }
    assert.ok(err instanceof SetAsideError, `not a SetAsideError: ${err?.stack ?? 'it completed'}`);
    assert.match(err.message, /\(ENOSPC\); nothing was put back$/);
    assert.equal(read(f, 'tests/b.js'), 'b1\n', 'the edit was touched');
  });
}

// G-4 of 20261108-234028: the paths recovery reports are the ones this pass still has to write back. A path an earlier pass
// handed back was printed as written back by this one, though this one skipped it (setAsideRestoredPaths).
test('G-4 of 20261108-234028: setAsideRecovery names only the unrestored paths, in both record shapes', () => {
  const dir = 'evidence/remediation-runner/set-aside-1';
  const entries = [{ path: 'a', restored: true }, { path: 'b', restored: false }];
  assert.deepEqual(setAsideRecovery({ set_aside_dir: dir, set_aside: entries }), { dir, paths: ['b'] });
  assert.deepEqual(setAsideRecovery({ set_aside: { dir, entries } }), { dir, paths: ['b'] }, 'the 85f45c55 record');
});

test('G-4 of 20261108-234028: after a partial write-back, recovery names only what it still has to write back, not a path it hands over', (t) => {
  const f = setAsideFixture(t, TRACKED);
  const { caps, record } = realCapabilities(f);
  const r = setAsideRefused(caps, refused(['tests/b.js', 'tests/c.js']), {});
  fs.writeFileSync(path.join(f.repo, 'tests', 'c.js'), 'an edit meanwhile\n');
  assert.deepEqual(writeBackSetAside(caps, r.record.dir.join('/')).map((x) => x.path), ['tests/c.js']);
  fs.writeFileSync(path.join(f.repo, 'tests', 'b.js'), 'the operator\'s, once handed back\n');
  assert.deepEqual(setAsideRecovery(record).paths, ['tests/c.js']);
});

// G-7 of 20261108-234028: the plan defines the run capability as { dir, read(), save(fields) }; the runner and this module said
// { read, save }. The one builder now refuses the narrower shape, so the runner cannot ship it: every test that runs the
// runner goes through this refusal.
test('G-7 of 20261108-234028: the capabilities carry run.dir, and the one builder refuses a run capability without it', (t) => {
  const f = setAsideFixture(t, TRACKED);
  const { caps } = realCapabilities(f);
  assert.equal(caps.run.dir, f.runDir, 'the run capability has no dir');
  const { tree, owner, git, firstFree, log } = caps;
  assert.throws(() => setAsideCapabilities({ tree, owner, git, firstFree, log, run: { read: caps.run.read, save: caps.run.save } }), /run\.dir/);
});
