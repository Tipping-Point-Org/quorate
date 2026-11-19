// .claude/requests/skill-subagent-pins.md (operator, 2026-10-18: "do 1 but leave 2 for later"). The engine pins every
// lens's model and effort from the contract and every arm's from the roster; the skills that spawn a model themselves did
// not, so one skill ran at different settings for different users (story-pipeline's operator: "every lens,task,skill
// ... should have a defined model/effort specified"). Each spawning skill now names both, by key, and says the pin is
// unmeasured for its task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const skill = (name) => fs.readFileSync(path.join(REPO_ROOT, 'skills', name, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');

for (const name of ['claim-check', 'candidate-pool', 'plan-review']) {
  test(`AC1: ${name} names the subagent's model AND effort by contract key, and says the pin is unmeasured`, () => {
    const s = skill(name);
    assert.match(s, /review\.models\.judgment/, 'the model key is not named');
    assert.match(s, /review\.effort\.judgment/, 'the effort key is not named');
    assert.match(s, /unmeasured for this task/, 'the pin does not say it is unmeasured for the task');
  });
}

// G-6 of 20261018-195709-pins-review: this test checked only that one sentence was gone and that `panel_arms` appeared
// somewhere, so deleting the mandatory-flag sentence left it green. G-1 of the same review: `panel_arms` holds codex shadow
// arms only, no source for agy and an ambiguous one for codex; the request's decision moves the pins to `proposers`.
test('AC2: candidate-pool requires --model and --effort for every external proposer, from the roster', () => {
  const s = skill('candidate-pool');
  assert.doesNotMatch(s, /Leaving them unset is allowed/);
  const pin = s.match(/Pin the external models too:([^]*?)Left unset/);
  assert.ok(pin, 'candidate-pool has no external-pin instruction');
  assert.match(pin[1], /`--model`/, 'the instruction does not name --model');
  assert.match(pin[1], /`--effort`/, 'the instruction does not name --effort');
  assert.match(pin[1], /required/, 'the instruction does not say the pins are required');
  assert.match(pin[1], /`proposers`/, 'the roster entry the external pins come from is not named');
  assert.doesNotMatch(s, /panel_arms/, 'panel_arms holds codex shadow arms only: no source for agy, ambiguous for codex');
});

const roster = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

test('G-1: the roster declares a proposer pin for each reviewer candidate-pool polls, agy\'s effort null with the reason', () => {
  const p = roster().proposers;
  assert.ok(p && typeof p === 'object', 'lens-roster.json has no proposers block');
  for (const reviewer of ['codex', 'agy']) {
    assert.equal(typeof p[reviewer]?.model, 'string', `${reviewer} has no proposer model`);
    assert.ok(p[reviewer].model.trim(), `${reviewer}'s proposer model is empty`);
    assert.ok('effort' in p[reviewer], `${reviewer}'s proposer entry does not declare an effort`);
  }
  assert.equal(typeof p.codex.effort, 'string');
  assert.equal(p.agy.effort, null, 'agy rejects --effort, so its proposer effort is null');
  assert.match(String(p.agy.$effort ?? ''), /--effort/, 'agy\'s null effort carries its reason beside it');
});

test('G-1: check-reviewers probes propose at the proposer pins candidate-pool passes', async () => {
  const { proposeCombinations } = await import('../scripts/lib/reviewer-probe.mjs');
  const combos = proposeCombinations({ proposers: { codex: { model: 'm-propose', effort: 'e-propose' } } }, () => true);
  assert.ok(combos.some((c) => c.reviewer === 'codex' && c.model === 'm-propose' && c.effort === 'e-propose'),
    `a proposer pin was not probed in propose: ${JSON.stringify(combos)}`);
});

test('AC3: no spawning skill writes a model name or an effort value literally', () => {
  for (const name of ['claim-check', 'candidate-pool', 'plan-review']) {
    const s = skill(name);
    assert.doesNotMatch(s, /--effort (low|medium|high|xhigh|max)\b/, `${name} writes an effort literally`);
    assert.doesNotMatch(s, /--model (opus|sonnet|haiku|gpt-[\w.-]+)\b/, `${name} writes a model literally`);
  }
});
