// G-9 of 20261029-235315-rdr-remediation-4-review (panel-codex-arch, MEDIUM). restorePreflightEvidence took a raw run
// directory and built its own `confined` owner on it, so its root was never proven to be the one admitRun returned: a
// second authority contract beside writePreflightCache, which already takes the caller's owner (G-10 of
// 20261029-224143-rdr-remediation-3-review). It now takes the admitted run's owner and refuses a path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confined } from '../scripts/io/confined-path.mjs';
import { restorePreflightEvidence } from '../scripts/io/preflight-cache.mjs';
import { preflightEvidenceDir } from '../scripts/lib/preflight-cache.mjs';

function setup(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-restore-owner-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const reviews = path.join(base, 'reviews');
  const run = path.join(reviews, 'run-1');
  fs.mkdirSync(run, { recursive: true });
  const src = preflightEvidenceDir(reviews, 'c'.repeat(64));
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'test.log'), 'cached\n');
  return { reviews, run };
}

test('G-9: restorePreflightEvidence refuses a raw run path, its root never admitted', (t) => {
  const { reviews, run } = setup(t);
  assert.throws(() => restorePreflightEvidence(reviews, 'c'.repeat(64), run), TypeError, 'a raw path was wrapped in an owner here');
  assert.equal(fs.existsSync(path.join(run, 'evidence')), false, 'something was written through the raw path');
});

test('G-9: restorePreflightEvidence restores through the caller\'s owner', (t) => {
  const { reviews, run } = setup(t);
  assert.equal(restorePreflightEvidence(reviews, 'c'.repeat(64), confined(run)), true);
  assert.equal(fs.readFileSync(path.join(run, 'evidence', 'pre-flight', 'test.log'), 'utf8'), 'cached\n');
});
