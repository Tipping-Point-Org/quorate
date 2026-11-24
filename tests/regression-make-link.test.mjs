// ONE HELPER IS THE ONLY PLACE A TEST CATCHES A LINK FAILURE (link-failure-owner.plan.md stage 1; design LF-D1 A).
//
// Tests caught link failures themselves, and a census tried to judge each catch body by reading JavaScript by hand: three
// reviews in a row found a new way past it (any `throw` token; a diagnostic as a bypass; braces hiding a return). Now a
// link a test cannot make is answered in one place: makeLink makes it; on a platform's refusal it makes the named
// junction fallback and says so, or skips saying why; any other error is rethrown, so a fault in a test is never read as
// a platform's refusal. Each rule is held here through an injected fs, so every case runs on every platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLink, LINK_REFUSALS } from './helpers.mjs';

/** A test context that records what the helper said. */
const ctx = () => { const said = { diagnostics: [], skips: [] }; return { said, t: { diagnostic: (m) => said.diagnostics.push(m), skip: (m) => said.skips.push(m) } }; };
const err = (code) => Object.assign(new Error(code), { code });
/** An fs whose symlinkSync/linkSync answer by type: `refuse` maps a type to the code it fails with. */
const fakeFs = (refuse = {}) => {
  const calls = [];
  const answer = (kind) => (target, at, type) => { const ty = kind === 'hard' ? 'hard' : (type ?? 'file'); calls.push({ ty, target, at }); if (refuse[ty]) throw err(refuse[ty]); };
  return { calls, fs: { symlinkSync: answer('sym'), linkSync: answer('hard') } };
};

test('a link the platform allows is made, and nothing is said', () => {
  const { t, said } = ctx(); const f = fakeFs();
  assert.deepEqual(makeLink(t, { target: '/x/a.txt', at: '/r/l', type: 'file', fs: f.fs }), { kind: 'file symlink', target: '/x/a.txt' });
  assert.deepEqual([said.diagnostics, said.skips], [[], []]);
});

test('a refused file symlink falls back to a junction to the named directory, and says so', () => {
  const { t, said } = ctx(); const f = fakeFs({ file: 'EPERM' });
  const r = makeLink(t, { target: '/x/a.txt', at: '/r/l', type: 'file', fallback: { dir: '/x' }, fs: f.fs });
  assert.deepEqual(r, { kind: 'directory junction', target: '/x' });
  assert.deepEqual(f.calls.map((c) => [c.ty, c.target]), [['file', '/x/a.txt'], ['junction', '/x']], 'the junction pointed at the file, which a junction cannot');
  assert.deepEqual(said.diagnostics, ['link fallback: directory junction']);
  assert.deepEqual(said.skips, []);
});

test('a refused link with no fallback, or a refused fallback, skips saying why and returns null', () => {
  for (const [refuse, fallback] of [[{ file: 'EPERM' }, undefined], [{ file: 'EPERM', junction: 'EACCES' }, { dir: '/x' }]]) {
    const { t, said } = ctx(); const f = fakeFs(refuse);
    assert.equal(makeLink(t, { target: '/x/a.txt', at: '/r/l', type: 'file', fallback, fs: f.fs }), null);
    assert.equal(said.skips.length, 1);
    assert.match(said.skips[0], /refused.*E(PERM|ACCES)/);
  }
});

test('an error that is not a platform refusal is rethrown, never read as one', () => {
  const { t, said } = ctx(); const f = fakeFs({ file: 'ENOENT' });
  assert.throws(() => makeLink(t, { target: '/x/a.txt', at: '/missing/l', type: 'file', fallback: { dir: '/x' }, fs: f.fs }), /ENOENT/);
  assert.deepEqual([said.diagnostics, said.skips], [[], []], 'a test fault was answered as a platform refusal');
  assert.ok(!LINK_REFUSALS.includes('ENOENT'));
});

// G-3 of 20261120-235710-lfo-delivery: LINK_REFUSALS carried 'UNKNOWN', libuv's catch-all, which its own comment did not
// list, so a fault libuv could not classify was skipped as a platform's refusal: the silent skip this helper removes.
test('the refusals are exactly the five the helper names, and libuv\'s catch-all UNKNOWN is rethrown', () => {
  assert.deepEqual([...LINK_REFUSALS].sort(), ['EACCES', 'EINVAL', 'ENOTSUP', 'EPERM', 'EXDEV']);
  for (const fallback of [undefined, { dir: '/x' }]) {
    const { t, said } = ctx(); const f = fakeFs({ file: 'UNKNOWN' });
    assert.throws(() => makeLink(t, { target: '/x/a.txt', at: '/r/l', type: 'file', fallback, fs: f.fs }), /UNKNOWN/);
    assert.deepEqual([said.diagnostics, said.skips], [[], []], 'an unclassified fault was answered as a platform refusal');
  }
  const { t, said } = ctx(); const f = fakeFs({ file: 'EPERM', junction: 'UNKNOWN' });
  assert.throws(() => makeLink(t, { target: '/x/a.txt', at: '/r/l', type: 'file', fallback: { dir: '/x' }, fs: f.fs }), /UNKNOWN/);
  assert.deepEqual(said.skips, [], 'an unclassified fault in the fallback was answered as a refusal');
});

test('a hard link takes no fallback: refused, it skips', () => {
  const { t, said } = ctx(); const f = fakeFs({ hard: 'EXDEV' });
  assert.equal(makeLink(t, { target: '/x/a.txt', at: '/r/b.txt', type: 'hard', fallback: { dir: '/x' }, fs: f.fs }), null);
  assert.deepEqual(f.calls.map((c) => c.ty), ['hard'], 'a hard link fell back to a junction');
  assert.equal(said.skips.length, 1);
  const ok = fakeFs();
  assert.deepEqual(makeLink(ctx().t, { target: '/x/a.txt', at: '/r/b.txt', type: 'hard', fs: ok.fs }), { kind: 'hard link', target: '/x/a.txt' });
});
