// G-11 and G-12 of 20261122-193909-llo-delivery (panel-codex-contract, panel-codex-security): copyOutOfRun created the
// cache's evidence folder and wrote each file as it walked, never asking hardLinkReason. A hard-linked evidence file put
// another file's bytes into the shared cache, and a link found late left the files before it written. The copy is now
// judged whole before anything is written: a link or a hard-linked file is refused, and the cache holds nothing of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePreflightCache, preflightEvidenceDir } from '../scripts/io/preflight-cache.mjs';
import { confined } from '../scripts/io/confined-path.mjs';
import { makeLink } from './helpers.mjs';

function setup(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-pfc-first-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const run = path.join(base, 'run');
  const ev = path.join(run, 'evidence', 'pre-flight');
  fs.mkdirSync(ev, { recursive: true });
  const reviews = path.join(base, 'reviews');
  fs.mkdirSync(reviews);
  return { base, run, ev, reviews };
}

test('G-12: a hard-linked evidence file is refused, and its bytes never reach the cache', (t) => {
  const { base, run, ev, reviews } = setup(t);
  fs.writeFileSync(path.join(base, 'secret.txt'), 'secret');
  if (!makeLink(t, { target: path.join(base, 'secret.txt'), at: path.join(ev, 'b.log'), type: 'hard' })) return;
  const hash = 'e'.repeat(64);
  assert.throws(() => writePreflightCache(reviews, hash, { run_id: 'r', results: [] }, { evidenceFrom: { owner: confined(run), segs: ['evidence', 'pre-flight'] } }),
    /hard.link/);
  assert.equal(fs.existsSync(path.join(preflightEvidenceDir(reviews, hash), 'b.log')), false, 'a hard-linked file was copied into the cache');
});

test('G-11: a refused entry leaves no partial evidence folder in the cache', (t) => {
  const { base, run, ev, reviews } = setup(t);
  fs.writeFileSync(path.join(ev, 'a.log'), 'ok');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'secret');
  if (!makeLink(t, { target: path.join(base, 'secret.txt'), at: path.join(ev, 'z.log'), type: 'hard' })) return;
  const hash = 'f'.repeat(64);
  assert.throws(() => writePreflightCache(reviews, hash, { run_id: 'r', results: [] }, { evidenceFrom: { owner: confined(run), segs: ['evidence', 'pre-flight'] } }));
  assert.equal(fs.existsSync(preflightEvidenceDir(reviews, hash)), false, 'the copy wrote before it judged what it copies');
});

test('a clean evidence tree is still copied whole', (t) => {
  const { run, ev, reviews } = setup(t);
  fs.mkdirSync(path.join(ev, 'sub'));
  fs.writeFileSync(path.join(ev, 'a.log'), 'ok');
  fs.writeFileSync(path.join(ev, 'sub', 'b.log'), 'two');
  const hash = '9'.repeat(64);
  writePreflightCache(reviews, hash, { run_id: 'r', results: [] }, { evidenceFrom: { owner: confined(run), segs: ['evidence', 'pre-flight'] } });
  assert.equal(fs.readFileSync(path.join(preflightEvidenceDir(reviews, hash), 'sub', 'b.log'), 'utf8'), 'two');
});
