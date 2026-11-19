// A FAILURE AT ANY STEP OF A SET-ASIDE LOSES NO EDIT (runner-test-seam.plan.md stage 2, design RT-D2 A). Every review of the
// set-aside-identity chain found one more step whose failure had not been tried: a put-back that threw past die (G-8 of
// 20261108-065111-si-remediation-7-review), a kill while copying (G-14 of 20261107-184037-co-delivery), a removal Windows
// refused. Each was found by a reviewer reading the code, one step at a time. This sweep fails every capability call of one
// set-aside and its write-back in turn, then does what the runner does next, and holds that every edit is either back in the
// working tree or in a copy the manifest names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setAsideRefused, writeBackSetAside, SetAsideError } from '../scripts/io/set-aside.mjs';
import { setAsideRecovery } from '../scripts/lib/remediation-chain.mjs';
import { setAsideFixture, realCapabilities, faulting, isInjected } from './tools/set-aside-capabilities.mjs';

// A tracked file the node modified (put back by checkout) and a file the node made (put back by removal), in a refused
// cluster beside a committable one.
const EDITS = { 'tests/b.js': 'b, from the node\n', 'tests/c.js': 'c, from the node\n' };
const SPEC = { committed: { 'src/a.js': 'a\n', 'tests/b.js': 'committed b\n' }, working: EDITS };
const CLUSTERS = [{ id: 'c1', committable: true, accepted: ['src/a.js'] }, { id: 'c2', committable: false, accepted: ['tests/b.js', 'tests/c.js'] }];

// One run of the set-aside and its write-back under `failAt` (null: none), then the runner's own recovery: the write-back
// from the record the run saved, as the next invocation's does (setAsideRecovery), with capabilities that do not fail.
function runOnce(t, failAt) {
  const f = setAsideFixture(t, SPEC);
  const real = realCapabilities(f);
  const { caps, calls } = faulting(real.caps, { failAt });
  const outcome = { failAt, set: 'completed', back: null };
  const accept = (err) => {
    if (isInjected(err)) return 'injected';
    if (err instanceof SetAsideError) return `SetAsideError: ${err.message}`;
    throw err;   // anything else is a defect the module let through
  };
  let done = null;
  try { done = setAsideRefused(caps, CLUSTERS, {}); } catch (err) { outcome.set = accept(err); }
  if (done?.record) {
    try { outcome.back = writeBackSetAside(caps, done.record.dir.join('/')); } catch (err) { outcome.back = accept(err); }
  }
  const pending = setAsideRecovery(real.record);
  const recovered = pending ? writeBackSetAside(realCapabilities(f, { record: real.record }).caps, pending.dir) : [];
  return { f, calls, outcome, record: real.record, recovered };
}

// Every edit is in the working tree, or in the copy of it the manifest under the recorded folder names.
function lostEdits({ f, record }) {
  const dir = record.set_aside_dir ? path.join(f.runDir, ...record.set_aside_dir.split('/')) : null;
  let manifest = null;
  try { if (dir) manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { /* no manifest */ }
  const lost = [];
  for (const [p, bytes] of Object.entries(EDITS)) {
    let inTree = null;
    try { inTree = fs.readFileSync(path.join(f.repo, ...p.split('/')), 'utf8'); } catch { /* absent */ }
    if (inTree === bytes) continue;
    const entry = manifest?.entries?.find((e) => e.path === p);
    let copy = null;
    try { if (entry) copy = fs.readFileSync(path.join(dir, 'files', entry.copy), 'utf8'); } catch { /* no copy */ }
    if (copy === bytes) continue;
    lost.push(`${p}: the tree holds ${JSON.stringify(inTree)}, and ${entry ? `its copy holds ${JSON.stringify(copy)}` : 'no manifest entry names it'}`);
  }
  return lost;
}

test('the sweep: a fault at each capability call of a set-aside and its write-back, in turn, loses no edit', (t) => {
  const clean = runOnce(t, null);
  assert.deepEqual(clean.outcome, { failAt: null, set: 'completed', back: [] }, 'the unfaulted run did not set aside and write back');
  assert.deepEqual(lostEdits(clean), []);
  assert.equal(clean.record.set_aside.every((e) => e.restored), true);
  const n = clean.calls.length;
  // Not a sweep of nothing: the classification's git calls, the copies, the put-back and the write-back are all counted.
  for (const step of ['git ls-tree', 'git hash-object', 'owner.create', 'owner.replace', 'git checkout', 'tree.remove', 'tree.replace', 'run.save']) {
    assert.ok(clean.calls.includes(step), `the count saw no ${step}: ${clean.calls.join(', ')}`);
  }
  const seen = new Set();
  const failures = [];
  for (let i = 1; i <= n; i += 1) {
    const r = runOnce(t, i);
    assert.ok(r.calls.length >= i, `call ${i} was never reached, so it was not failed (${r.calls.length} calls)`);
    seen.add(r.outcome.set.startsWith('SetAsideError') ? 'SetAsideError' : r.outcome.set);
    const lost = lostEdits(r);
    if (lost.length) failures.push(`fault at call ${i} (${clean.calls[i - 1]}), ${JSON.stringify(r.outcome)}: ${lost.join('; ')}`);
  }
  assert.deepEqual(failures, [], `edits lost after a fault:\n${failures.join('\n')}`);
  // The three outcomes the module may give a fault are each met somewhere in the sweep.
  assert.deepEqual([...seen].sort(), ['SetAsideError', 'completed', 'injected'], `outcomes seen: ${[...seen].join(', ')}`);
});

test('the sweep\'s instrument: a record whose manifest names no copy of an edit that left the tree is a lost edit', (t) => {
  const r = runOnce(t, null);
  fs.writeFileSync(path.join(r.f.repo, 'tests', 'b.js'), 'committed b\n');
  assert.match(lostEdits(r).join('\n'), /tests\/b\.js: the tree holds "committed b\\n", and no manifest entry names it/);
});

// THE PUT-BACK GUARD SAYS WHAT IT READ (found by the sweep above, runner-test-seam.plan.md stage 3): a read that failed, or a
// path no longer a file, was reported as "changed after it was copied aside", sending the operator to look for an edit that
// was never made. Each now names what it found; the edit and its copy are kept exactly as before.
const guardStat = (calls) => calls.indexOf('tree.stat', calls.indexOf('owner.replace')) + 1;   // the guard's first read
function faultTheGuard(t, error) {
  const clean = runOnce(t, null);
  const at = guardStat(clean.calls);
  assert.ok(at > 0, `no stat after the manifest: ${clean.calls.join(', ')}`);
  const f = setAsideFixture(t, SPEC);
  const real = realCapabilities(f);
  const { caps } = faulting(real.caps, { failAt: at, error });
  let err = null;
  try { setAsideRefused(caps, CLUSTERS, {}); } catch (e) { err = e; }
  return { f, err, record: real.record };
}
const guardTail = 'so it was not put back to HEAD for the full check; its earlier bytes are kept under evidence/remediation-runner/set-aside-1 and the next run of this command writes back only what still matches';
function assertKept({ f, record }) {
  for (const [p, bytes] of Object.entries(EDITS)) assert.equal(fs.readFileSync(path.join(f.repo, ...p.split('/')), 'utf8'), bytes, `${p} was put back or lost`);
  const dir = path.join(f.runDir, ...record.set_aside_dir.split('/'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const e of manifest.entries) assert.equal(fs.readFileSync(path.join(dir, 'files', e.copy), 'utf8'), EDITS[e.path], `the copy of ${e.path} was not kept`);
}

test('the put-back guard: a read that fails is named as a failed read, not as a change', (t) => {
  const r = faultTheGuard(t, null);
  assert.ok(r.err instanceof SetAsideError, `not a SetAsideError: ${r.err?.stack ?? r.err}`);
  assert.equal(r.err.message, `tests/b.js could not be read (EINJECTED), ${guardTail}`);
  assertKept(r);
});

test('the put-back guard: a path that is no longer a file is named as what it is now, not as a change', (t) => {
  const r = faultTheGuard(t, () => Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }));
  assert.ok(r.err instanceof SetAsideError, `not a SetAsideError: ${r.err?.stack ?? r.err}`);
  assert.equal(r.err.message, `tests/b.js is now absent, ${guardTail}`);
  assertKept(r);
});

test('the put-back guard: an edit made after the copy is still named as a change', (t) => {
  const f = setAsideFixture(t, SPEC);
  const real = realCapabilities(f);
  const caps = { ...real.caps, owner: { ...real.caps.owner, replace(segs, ...rest) {
    const out = real.caps.owner.replace(segs, ...rest);
    if (segs.at(-1) === 'manifest.json') fs.writeFileSync(path.join(f.repo, 'tests', 'b.js'), 'an edit made after the copy\n');
    return out;
  } } };
  let err = null;
  try { setAsideRefused(caps, CLUSTERS, {}); } catch (e) { err = e; }
  assert.ok(err instanceof SetAsideError, `not a SetAsideError: ${err?.stack ?? err}`);
  assert.equal(err.message, `tests/b.js changed after it was copied aside, ${guardTail}`);
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'b.js'), 'utf8'), 'an edit made after the copy\n');
});
