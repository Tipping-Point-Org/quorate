// claim-check-cross-family.plan.md stage 1 (operator, 2026-10-18: "Roster entry, codex adjudicator pin (Recommended)").
// With the panel on, claim-check's checker runs in the other family, and which reviewer, model and effort it runs at is
// configuration: a model name is meaningful only paired with its CLI, so it lives in the roster beside `proposers`,
// never in a script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { supportsMode } from '../scripts/lib/reviewers.mjs';

const roster = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
const table = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'reviewers.json'), 'utf8')).reviewers;

test('the roster declares the claim checker\'s reviewer, model and effort, marked unmeasured', () => {
  const r = roster();
  const c = r.claim_checker;
  assert.ok(c && typeof c === 'object', 'lens-roster.json has no claim_checker entry');
  for (const key of ['reviewer', 'model']) assert.ok(typeof c[key] === 'string' && c[key].trim(), `claim_checker.${key} is missing`);
  assert.ok('effort' in c, 'claim_checker declares no effort');
  assert.match(String(r.$claim_checker ?? ''), /unmeasured/i, 'the pin does not say it is unmeasured for claim checking');
});

test('it starts at that reviewer\'s adjudicator pin', () => {
  const r = roster();
  const judge = r.adjudicators.find((a) => a.reviewer === r.claim_checker.reviewer);
  assert.ok(judge, `no adjudicator for ${r.claim_checker.reviewer}`);
  assert.equal(r.claim_checker.model, judge.model);
  assert.equal(r.claim_checker.effort ?? null, judge.effort ?? null);
});

test('its reviewer is an adapter that serves the claim-check mode', () => {
  const adapter = table()[roster().claim_checker.reviewer];
  assert.ok(adapter, 'the claim checker names no adapter in reviewers.json');
  assert.ok(supportsMode(adapter, 'claim-check'), 'its adapter does not take the claim-check mode');
});

test('no script writes the claim checker\'s model literally', () => {
  const model = roster().claim_checker.model;
  const dir = path.join(REPO_ROOT, 'scripts');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes(model), `scripts/${f} writes ${model}`);
  }
});
