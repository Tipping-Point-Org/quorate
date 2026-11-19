// .claude/requests/two-ledger-mediums.md, AC2-AC3 (story-pipeline's finding, 2026-10-19; operator: "The two MEDIUMs
// first, then item 3 (Recommended)"). A plan-review verdict's `settings` were an echo of the brief, so check-plan-verdict
// proved the brief was read, not that the run used those settings. spawn-subagent is the spawner: it stamps
// `spawned_with` — the model and effort it passed, and the models the backend reports in modelUsage — into the result,
// and check-plan-verdict checks that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, SCRIPTS_DIR, runScript } from './helpers.mjs';

const contract = () => JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'new-run.mjs'), '--print-contract'],
  { cwd: REPO_ROOT, encoding: 'utf8' }).stdout).review;

function withDir(fn) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-spawned-with-'));
  try { return fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

test('AC2: spawn-subagent --result stamps spawned_with from its own pins and the envelope\'s modelUsage', () => {
  withDir((d) => {
    const bin = path.join(d, 'fake.mjs');
    fs.writeFileSync(bin, "process.stdout.write(JSON.stringify({ type: 'result', is_error: false, "
      + "result: '{\"verdict\": \"PASS\"}', modelUsage: { 'backend-model-x': { inputTokens: 1 } } }));");
    const prompt = path.join(d, 'p.md');
    fs.writeFileSync(prompt, 'x');
    const result = path.join(d, 'verdict.json');
    const env = { ...process.env };
    delete env.GRAPH_NODE_DEPTH;
    const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'spawn-subagent.mjs'), '--prompt-file', prompt,
      '--out', path.join(d, 'e.json'), '--result', result, '--repo-root', REPO_ROOT, '--runtime-bin', bin], { cwd: REPO_ROOT, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(fs.readFileSync(result, 'utf8'));
    const c = contract();
    // effort_from added 2026-10-20 with spawn-subagent --effort: without it the stamp could not tell an override apart.
    assert.deepEqual(out.spawned_with, { model: c.models.judgment, effort: c.effort.judgment, effort_from: 'contract',
      backend_models: ['backend-model-x'] });
    assert.equal(out.verdict, 'PASS', 'the answer itself is kept');
  });
});

const check = (verdict, pin = ['--model', 'opus', '--effort', 'low']) => withDir((d) => {
  const f = path.join(d, 'verdict.json');
  fs.writeFileSync(f, JSON.stringify(verdict));
  return runScript('check-plan-verdict.mjs', ['--verdict', f, ...pin]);
});
const stamped = { model: 'opus', effort: 'low', backend_models: ['claude-opus-5-5'] };

test('AC3: check-plan-verdict accepts a spawner-stamped verdict that matches the pin', () => {
  const r = check({ schema_version: 1, verdict: 'PASS', settings: { model: 'opus', effort: 'low' }, spawned_with: stamped });
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /claude-opus-5-5/, 'the backend-attested model is not reported');
});

test('AC3: an echo alone, a different stamp, or an empty backend list is refused', () => {
  assert.equal(check({ schema_version: 1, verdict: 'PASS', settings: { model: 'opus', effort: 'low' } }).status, 1,
    'a verdict with only the reviewer\'s echo was accepted');
  assert.equal(check({ schema_version: 1, verdict: 'PASS', spawned_with: { ...stamped, effort: 'high' } }).status, 1);
  assert.equal(check({ schema_version: 1, verdict: 'PASS', spawned_with: { ...stamped, backend_models: [] } }).status, 1);
});

// G-1 of 20261019-211650-two-mediums-review (operator: "Alias contained in every backend id (Recommended)"): any non-empty
// backend_models passed, so a round the backend served with another model was accepted as spawned at the pin.
// G-1 of 20261019-214353-review-review (operator: "At least one matches; name the rest (Recommended)"): requiring EVERY id
// to carry the pin refused a legitimate round whose modelUsage lists a helper model (haiku beside opus). One matching id
// attests the round; the others are printed as also reported; no matching id is refused.
test('G-1: a round is attested by one id that contains the pin; the rest are named, not refused', () => {
  const other = check({ schema_version: 1, verdict: 'PASS', spawned_with: { ...stamped, backend_models: ['claude-sonnet-5-5'] } });
  assert.equal(other.status, 1, 'a round served by another model was accepted');
  assert.match(other.output, /claude-sonnet-5-5/, 'the id that does not match is not named');
  const helper = check({ schema_version: 1, verdict: 'PASS',
    spawned_with: { ...stamped, backend_models: ['claude-opus-5-5', 'claude-haiku-5-5'] } });
  assert.equal(helper.status, 0, `a round with a helper model beside the pinned one was refused: ${helper.output}`);
  assert.match(helper.output, /also reported[^\n]*claude-haiku-5-5/, 'the helper id is not named as also reported');
  assert.equal(check({ schema_version: 1, verdict: 'PASS', spawned_with: { ...stamped, backend_models: ['Claude-Opus-5-5'] } }).status, 0,
    'the comparison is not case-insensitive');
});

test('G-1: the attestation rule is a pure function in scripts/lib/', async () => {
  const decisions = await import('../scripts/lib/decisions.mjs');
  assert.equal(typeof decisions.backendAttestation, 'function', 'the rule is not in scripts/lib/decisions.mjs');
  assert.deepEqual(decisions.backendAttestation(['claude-opus-5-5', 'claude-haiku-5-5'], 'Opus'),
    { matched: ['claude-opus-5-5'], others: ['claude-haiku-5-5'], errors: [] });
  assert.equal(decisions.backendAttestation(['claude-sonnet-5-5'], 'opus').errors.length, 1);
  assert.equal(decisions.backendAttestation([], 'opus').errors.length, 1);
  assert.equal(decisions.backendAttestation(undefined, 'opus').errors.length, 1);
});

test('AC3: the plan-review skill says the spawner stamps the settings', () => {
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'plan-review', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(skill, /spawned_with/);
  assert.match(skill, /at least one/i, 'the skill does not state that one matching backend id attests the round (G-1)');
});
