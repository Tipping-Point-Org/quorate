// EVERY TREE COPY IS JUDGED BEFORE IT WRITES (link-leaving-owner.plan.md stage 3; design LL-D4: refuse and name). cpSync and
// fs.promises.cp keep a link as a link and copy a hard-linked file's content, so a copy checked nothing at the run archive
// and the bench's preservation (design divergence 4), and the pre-flight cache and decision copies checked links but not
// hard links. Driven on real links; a kind the platform refuses is skipped by name through makeLink.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeLink } from './helpers.mjs';
import { archiveRun } from '../scripts/io/reviews-root.mjs';
import { restorePreflightEvidence } from '../scripts/io/preflight-cache.mjs';
import { preflightEvidenceDir } from '../scripts/lib/preflight-cache.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

function base(t) {
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'q-copies-'));
  t.after(() => fs.rmSync(b, { recursive: true, force: true }));
  const outside = path.join(b, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'from elsewhere');
  return { b, outside };
}
function stagedRun(b) {
  const from = path.join(b, 'staged', 'run-1');
  fs.mkdirSync(path.join(from, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(from, 'run.json'), '{}');
  fs.writeFileSync(path.join(from, 'nodes', 'a.status.json'), '{}');
  fs.mkdirSync(path.join(b, 'repo', '.claude', 'reviews'), { recursive: true });
  return { from, tmp: path.join(b, 'repo', '.claude', 'reviews', '.run-1.tmp'), to: path.join(b, 'repo', '.claude', 'reviews', 'run-1') };
}

test('the run archive refuses a link out, naming it, and writes nothing', (t) => {
  const { b, outside } = base(t);
  const plan = stagedRun(b);
  if (!makeLink(t, { target: outside, at: path.join(plan.from, 'nodes', 'out'), type: 'dir', fallback: { dir: outside } })) return;
  assert.throws(() => archiveRun(plan), /nodes\/out in the run is a link or junction leading out/);
  assert.equal(fs.existsSync(plan.to), false, 'nothing archived');
  assert.equal(fs.existsSync(plan.tmp), false, 'no partial copy left');
  assert.ok(fs.existsSync(path.join(plan.from, 'run.json')), 'the staged run stays whole');
});

test('the run archive refuses a hard-linked file, naming it', (t) => {
  const { b, outside } = base(t);
  const plan = stagedRun(b);
  if (!makeLink(t, { target: path.join(outside, 'secret.txt'), at: path.join(plan.from, 'nodes', 'same.txt'), type: 'hard' })) return;
  assert.throws(() => archiveRun(plan), /nodes\/same\.txt in the run is a hard-linked file/);
  assert.equal(fs.existsSync(plan.to), false);
});

test('a withheld folder is not judged, and an ordinary run archives as before', (t) => {
  const { b, outside } = base(t);
  const plan = stagedRun(b);
  fs.mkdirSync(path.join(plan.from, 'evidence'));
  if (!makeLink(t, { target: outside, at: path.join(plan.from, 'evidence', 'out'), type: 'dir', fallback: { dir: outside } })) return;
  const moved = archiveRun(plan, { withholdEvidence: true });
  assert.equal(moved.to, plan.to);
  assert.ok(fs.existsSync(path.join(plan.to, 'nodes', 'a.status.json')));
  assert.equal(fs.existsSync(path.join(plan.to, 'evidence', 'out')), false, 'the withheld evidence is not copied');
});

test('the pre-flight cache refuses a hard-linked file in a cached entry, and installs nothing', (t) => {
  const { b, outside } = base(t);
  const reviews = path.join(b, 'reviews');
  const run = path.join(b, 'run');
  fs.mkdirSync(run);
  const src = preflightEvidenceDir(reviews, 'c'.repeat(64));
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'test.log'), 'cached\n');
  if (!makeLink(t, { target: path.join(outside, 'secret.txt'), at: path.join(src, 'leak.log'), type: 'hard' })) return;
  assert.throws(() => restorePreflightEvidence(reviews, 'c'.repeat(64), confined(run)),
    (e) => e.code === 'ECONFINED' && /a hard-linked file stands in the cached evidence/.test(e.message));
  assert.equal(fs.existsSync(path.join(run, 'evidence', 'pre-flight', 'leak.log')), false);
});
