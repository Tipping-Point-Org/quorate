// autonomous-run.plan.md stage 4: the decision panel's external seats are configuration, beside the claim checker and the
// proposers, because a model name is meaningful only paired with its CLI. The panel is three FAMILIES (autonomous-run.md
// criterion 1: Claude, Codex and agy), so every external seat must be of a family other than the node runtime's, which
// fills the Claude seat, and no two seats may share one: two seats of one family are one opinion counted twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { familyOfCall, supportsMode } from '../scripts/lib/reviewers.mjs';
import { rosterFamilyErrors } from '../scripts/lib/capabilities.mjs';
import { decideCombinations } from '../scripts/lib/reviewer-probe.mjs';

const roster = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
const raw = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'reviewers.json'), 'utf8'));

test('the roster declares the panel\'s seats, each at its reviewer\'s adjudicator pin, marked unmeasured', () => {
  const r = roster();
  const seats = r.decision_panel?.seats;
  assert.ok(Array.isArray(seats) && seats.length >= 2, 'lens-roster.json has no decision_panel seats');
  assert.match(String(r.$decision_panel ?? ''), /unmeasured/i);
  for (const s of seats) {
    const judge = r.adjudicators.find((a) => a.reviewer === s.reviewer);
    assert.ok(judge, `no adjudicator for ${s.reviewer}`);
    assert.equal(s.model, judge.model, s.reviewer);
    assert.equal(s.effort ?? null, judge.effort ?? null, s.reviewer);
  }
});

test('every seat is of a family other than the node runtime\'s, and no two seats share a family', () => {
  const t = raw();
  const table = t.reviewers;
  const runtime = t.default_node_runtime;
  const runtimeFamily = familyOfCall({ reviewer: runtime, model: '' }, table);
  assert.ok(runtimeFamily, `the node runtime '${runtime}' resolves no family`);
  const families = roster().decision_panel.seats.map((s) => familyOfCall(s, table));
  for (const [i, f] of families.entries()) {
    assert.ok(f, `seat ${i} resolves no family`);
    assert.notEqual(f, runtimeFamily, `seat ${i} is the node runtime's family: the Claude seat would be counted twice`);
  }
  assert.equal(new Set(families).size, families.length, `two seats share a family: ${families.join(', ')}`);
});

test('every seat\'s adapter takes the decide mode, and check-reviewers probes each one', () => {
  const table = raw().reviewers;
  const r = roster();
  for (const s of r.decision_panel.seats) assert.equal(supportsMode(table[s.reviewer], 'decide'), true, s.reviewer);
  const combos = decideCombinations(r, (name) => Boolean(table[name]) && supportsMode(table[name], 'decide'));
  assert.deepEqual(combos.map((c) => c.reviewer), r.decision_panel.seats.map((s) => s.reviewer));
  assert.ok(combos.every((c) => c.mode === 'decide' && c.route === 'native'));
  assert.match(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'check-reviewers.mjs'), 'utf8'), /decideCombinations\(/);
});

test('a seat whose declared family contradicts its adapter is refused like every roster role', () => {
  const table = raw().reviewers;
  const r = roster();
  r.decision_panel.seats[0] = { ...r.decision_panel.seats[0], family: 'not-its-family' };
  const errors = rosterFamilyErrors(r, (name) => table[name]);
  assert.ok(errors.some((e) => /decision_panel seat/.test(e)), JSON.stringify(errors));
});

test('no script writes a seat\'s model literally', () => {
  const dir = path.join(REPO_ROOT, 'scripts');
  for (const s of roster().decision_panel.seats) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
      assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes(s.model), `scripts/${f} writes ${s.model}`);
    }
  }
});
