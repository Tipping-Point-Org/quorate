// G-4 and G-5 of 20261122-204359-llo-remediation-review (panel-codex-security, panel-codex-code, panel-codex-contract):
// writePreflightCache made, removed and wrote the cache's own folder through raw paths, so a junction at
// `.preflight-cache` sent the delete and the write outside the reviews root (A-30); and it deleted an entry's evidence
// BEFORE the copy judged its source, so a refused copy destroyed evidence that was valid, and two writers of one hash
// interleaved in one folder. The cache is now written through an owner rooted at the reviews folder, and the evidence
// is staged into a folder of its own and renamed into place only once the copy has succeeded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePreflightCache, readPreflightCache, preflightEvidenceDir, preflightCachePath } from '../scripts/io/preflight-cache.mjs';
import { confined } from '../scripts/io/confined-path.mjs';
import { makeLink } from './helpers.mjs';

function setup(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-pfc-dest-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const run = path.join(base, 'run');
  const ev = path.join(run, 'evidence', 'pre-flight');
  fs.mkdirSync(ev, { recursive: true });
  const reviews = path.join(base, 'reviews');
  fs.mkdirSync(reviews);
  const from = () => ({ owner: confined(run), segs: ['evidence', 'pre-flight'] });
  return { base, run, ev, reviews, from };
}

test('G-5: a refused copy keeps the evidence the entry already had', (t) => {
  const { base, ev, reviews, from } = setup(t);
  const hash = 'a'.repeat(64);
  fs.writeFileSync(path.join(ev, 'build.log'), 'good');
  writePreflightCache(reviews, hash, { run_id: 'r1', results: [] }, { evidenceFrom: from() });
  // The next run's evidence holds a link out: its copy is refused.
  fs.mkdirSync(path.join(base, 'outside'));
  if (!makeLink(t, { target: path.join(base, 'outside'), at: path.join(ev, 'out'), type: 'dir', fallback: { dir: path.join(base, 'outside') } })) return;
  assert.throws(() => writePreflightCache(reviews, hash, { run_id: 'r2', results: [] }, { evidenceFrom: from() }));
  assert.equal(fs.readFileSync(path.join(preflightEvidenceDir(reviews, hash), 'build.log'), 'utf8'), 'good',
    'the entry\'s valid evidence was deleted before the new copy was judged');
});

test('G-5: a write leaves one whole evidence folder and no staging folder beside it', (t) => {
  const { ev, reviews, from } = setup(t);
  const hash = 'b'.repeat(64);
  fs.writeFileSync(path.join(ev, 'old.log'), 'old');
  writePreflightCache(reviews, hash, { run_id: 'r1', results: [] }, { evidenceFrom: from() });
  fs.rmSync(path.join(ev, 'old.log'));
  fs.writeFileSync(path.join(ev, 'new.log'), 'new');
  writePreflightCache(reviews, hash, { run_id: 'r2', results: [] }, { evidenceFrom: from() });
  const dest = preflightEvidenceDir(reviews, hash);
  // The cache's writer mark (G-5 of 20261122-214154-llo-remediation-2-review) is the cache's, never a copied log.
  assert.deepEqual(fs.readdirSync(dest).filter((n) => n !== '.quorate-cache-writer'), ['new.log'], 'the evidence is not exactly the last copy');
  assert.deepEqual(fs.readdirSync(path.dirname(dest)).sort(), [`${hash}.evidence`, `${hash}.json`]);
});

test('G-4: a junction at .preflight-cache is refused, and nothing is written or removed outside the reviews root', (t) => {
  const { base, ev, reviews, from } = setup(t);
  const hash = 'c'.repeat(64);
  const outside = path.join(base, 'elsewhere');
  fs.mkdirSync(path.join(outside, `${hash}.evidence`), { recursive: true });
  fs.writeFileSync(path.join(outside, `${hash}.evidence`, 'keep.txt'), 'keep');
  if (!makeLink(t, { target: outside, at: path.join(reviews, '.preflight-cache'), type: 'dir', fallback: { dir: outside } })) return;
  fs.writeFileSync(path.join(ev, 'build.log'), 'x');
  assert.throws(() => writePreflightCache(reviews, hash, { run_id: 'r', results: [] }, { evidenceFrom: from() }), /link|junction|confined/i);
  assert.equal(fs.readFileSync(path.join(outside, `${hash}.evidence`, 'keep.txt'), 'utf8'), 'keep', 'the delete followed the junction');
  assert.equal(fs.existsSync(path.join(outside, `${hash}.json`)), false, 'the entry was written through the junction');
});

test('G-4: with no evidence, the entry JSON is still not written through a junction', (t) => {
  const { base, reviews } = setup(t);
  const hash = 'd'.repeat(64);
  const outside = path.join(base, 'elsewhere');
  fs.mkdirSync(outside);
  if (!makeLink(t, { target: outside, at: path.join(reviews, '.preflight-cache'), type: 'dir', fallback: { dir: outside } })) return;
  assert.throws(() => writePreflightCache(reviews, hash, { run_id: 'r', results: [] }), /link|junction|confined/i);
  assert.equal(fs.existsSync(path.join(outside, `${hash}.json`)), false);
  assert.equal(fs.existsSync(preflightCachePath(reviews, hash)), false);
});

// G-3 of 20261122-214154-llo-remediation-2-review (panel-codex-arch, panel-codex-security): the old evidence was removed
// before the staged copy was renamed in, so a failed rename left the old JSON, a reusable entry, citing evidence that was
// gone. A failed rename now leaves the entry exactly as it was: its JSON and its evidence.
test('G-3: a rename that fails leaves the entry whole, its JSON citing evidence that is still there', (t) => {
  const { ev, reviews, from } = setup(t);
  const hash = 'e'.repeat(64);
  fs.writeFileSync(path.join(ev, 'build.log'), 'good');
  writePreflightCache(reviews, hash, { run_id: 'r1', results: [] }, { evidenceFrom: from() });
  const rename = (a, b) => {
    if (a.endsWith('.tmp')) throw Object.assign(new Error('injected rename failure'), { code: 'EIO' });
    fs.renameSync(a, b);
  };
  assert.throws(() => writePreflightCache(reviews, hash, { run_id: 'r2', results: [] }, { evidenceFrom: from(), rename }), /injected/);
  assert.equal(JSON.parse(fs.readFileSync(preflightCachePath(reviews, hash), 'utf8')).run_id, 'r1', 'the old entry\'s JSON was lost');
  assert.equal(fs.readFileSync(path.join(preflightEvidenceDir(reviews, hash), 'build.log'), 'utf8'), 'good',
    'the entry\'s JSON was left citing evidence that a failed rename removed');
  assert.deepEqual(fs.readdirSync(path.dirname(preflightEvidenceDir(reviews, hash))).sort(), [`${hash}.evidence`, `${hash}.json`],
    'a staged or set-aside folder was left beside the entry');
});

// G-5 (with G-4 its symptom) of 20261122-214154-llo-remediation-2-review (panel-codex-code, panel-codex-security,
// panel-codex-arch): evidence and JSON were published separately, so a writer whose JSON landed after another writer's
// evidence left one run's results citing another run's logs. Built from the state two such writers leave: B's evidence,
// then A's JSON written over B's. The entry must not be reused as A's results with B's logs.
test('G-5: a JSON that landed beside another writer\'s evidence is not reused', (t) => {
  const { ev, reviews, from } = setup(t);
  const hash = 'f'.repeat(64);
  fs.writeFileSync(path.join(ev, 'build.log'), 'A');
  writePreflightCache(reviews, hash, { run_id: 'rA', results: [] }, { evidenceFrom: from() });
  const jsonA = fs.readFileSync(preflightCachePath(reviews, hash));
  fs.writeFileSync(path.join(ev, 'build.log'), 'B');
  writePreflightCache(reviews, hash, { run_id: 'rB', results: [] }, { evidenceFrom: from() });
  fs.writeFileSync(preflightCachePath(reviews, hash), jsonA);   // A's JSON, last, beside B's evidence
  assert.equal(fs.readFileSync(path.join(preflightEvidenceDir(reviews, hash), 'build.log'), 'utf8'), 'B');
  assert.notEqual(readPreflightCache(reviews, hash)?.run_id, 'rA', 'A\'s results were reused citing B\'s logs');
});
