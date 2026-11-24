// THE remediate.lock PROTOCOL HAS ONE OWNER (G-3 of 20261121-193516-m3s7-b1-review). archive-run.mjs created, checked and
// removed the lock with its own code beside remediate.mjs's, so the two copies could drift apart in the lock's name, its
// record and which refusal means "held". Both now go through lib/remediate-lock.mjs; neither names the lock in an owner
// call of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

for (const file of ['scripts/remediate.mjs', 'scripts/archive-run.mjs']) {
  test(`${file} takes, tests and releases the lock only through lib/remediate-lock.mjs`, () => {
    const src = read(file);
    const own = src.split('\n').filter((l) => /\.(create|exists|remove|replace)\(\[\s*'remediate\.lock'/.test(l));
    assert.deepEqual(own, [], `${file} spells the lock protocol itself`);
    assert.match(src, /from '\.\/lib\/remediate-lock\.mjs';/);
    assert.match(src, /takeRemediateLock\(/);
    assert.match(src, /releaseRemediateLock\(/);
  });
}

test('the owner answers alike for both callers', async () => {
  const m = await import('../scripts/lib/remediate-lock.mjs');
  assert.equal(m.REMEDIATE_LOCK, 'remediate.lock');
  assert.deepEqual(JSON.parse(m.remediateLockRecord({ pid: 1, startedAt: 't', phase: 'archiving' })), { pid: 1, started_at: 't', phase: 'archiving' });
  assert.equal(m.remediateLockTaken({ code: 'EEXIST' }), true);
  assert.equal(m.remediateLockTaken({ code: 'ECONFINED', refusal: 'taken' }), true);
  assert.equal(m.remediateLockTaken({ code: 'ECONFINED', refusal: 'link' }), false);
  const calls = [];
  const owner = { create: (s, d) => calls.push(['create', s, d]), remove: (s) => { calls.push(['remove', s]); return true; }, exists: (s) => { calls.push(['exists', s]); return false; } };
  m.takeRemediateLock(owner, { pid: 2, startedAt: 'u', phase: 'started' });
  assert.equal(m.remediateLockHeld(owner), false);
  assert.equal(m.releaseRemediateLock(owner), true);
  assert.deepEqual(calls.map((c) => [c[0], c[1]]), [['create', ['remediate.lock']], ['exists', ['remediate.lock']], ['remove', ['remediate.lock']]]);
});
