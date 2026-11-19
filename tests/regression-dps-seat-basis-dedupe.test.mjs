// G-5 of 20261110-022503-dps-remediation-4-review: seatBasis checked every citation in turn with no dedupe, so a seat's
// answer citing one path C times did C identical synchronous resolutions and realpaths. Each distinct citation is now
// checked once, and its outcome given again for each repeat, so the result is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { seatBasis } from '../scripts/lib/decision-panel.mjs';

const HOST = hostPlatform();
const BENCH = '.claude/reviews/20261101-000000-r/evidence/bench.txt';

test('G-5: a citation repeated in one answer is resolved once, and each repeat keeps its place in the result', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-basis-dedupe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ...path.dirname(BENCH).split('/')), { recursive: true });
  fs.writeFileSync(path.join(root, ...BENCH.split('/')), 'measured: 12 ms\n');
  let calls = 0;
  // The platform is frozen, so the count is an object over it rather than a proxy of it.
  const real = HOST.fs.realpathSync;
  const counted = Object.create(HOST.fs);
  Object.defineProperty(counted, 'realpathSync', {
    value: Object.assign((...a) => { calls += 1; return real.apply(HOST.fs, a); }, { native: real.native }),
  });
  const io = { ...HOST, fs: counted };
  const once = seatBasis([BENCH], { repoRoot: root, io, evidence: [BENCH] });
  const perCitation = calls;
  assert.ok(perCitation > 0, 'the counter saw no realpath: the test no longer observes the check');
  calls = 0;
  const many = seatBasis([BENCH, BENCH, BENCH, BENCH, 'no/such.txt', 'no/such.txt'], { repoRoot: root, io, evidence: [BENCH] });
  assert.equal(calls, perCitation, `${calls} realpaths for one distinct in-repository citation repeated four times; one citation takes ${perCitation}`);
  assert.equal(many.basis, once.basis);
  assert.deepEqual(many.resolved, [once.resolved[0], once.resolved[0], once.resolved[0], once.resolved[0]]);
  assert.equal(many.refused.length, 2, 'each repeat of a refused citation is still named');
  assert.deepEqual(many.refused[0], many.refused[1]);
  assert.equal(many.refused[0].path, 'no/such.txt');
});
