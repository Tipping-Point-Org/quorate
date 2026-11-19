// G-8 of 20261018-203604-review-review: plan-review's round settings were checked only by `spawn-node --mode gate`, and
// nothing calls that mode — plan-review runs as the session's subagent, before any run directory exists — so the G-4 check
// ran in no round. The operator's decision (2026-10-18: "Caller-run check (Recommended)"): the caller checks the verdict's
// `settings` with a script that runs gateSettingsErrors on the verdict file, and the skill and the contract doc stop saying
// plan-review is spawned `--mode gate`. G-11 is its symptom. The check compares an echo of the brief: it catches a verdict
// that misreports its settings, not a round run at others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, runScript } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

function withVerdict(verdict, fn) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-g8-'));
  try {
    const file = path.join(d, 'verdict.json');
    fs.writeFileSync(file, typeof verdict === 'string' ? verdict : JSON.stringify(verdict));
    return fn(file);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

// Since two-ledger-mediums AC3 the check reads `spawned_with`, the spawner's stamp, not the echoed `settings`.
test('check-plan-verdict: a verdict whose stamp matches the pin passes; a mismatch, none, or unreadable refuses', () => {
  const ok = { schema_version: 1, verdict: 'PASS', settings: { model: 'opus', effort: 'low' },
    spawned_with: { model: 'opus', effort: 'low', backend_models: ['claude-opus-5-5'] } };
  withVerdict(ok, (f) => {
    const r = runScript('check-plan-verdict.mjs', ['--verdict', f, '--model', 'opus', '--effort', 'low']);
    assert.equal(r.status, 0, r.output);
  });
  withVerdict({ ...ok, spawned_with: { ...ok.spawned_with, model: 'sonnet' } }, (f) => {
    const r = runScript('check-plan-verdict.mjs', ['--verdict', f, '--model', 'opus', '--effort', 'low']);
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /spawned_with\.model is "sonnet", but the reviewer was pinned to "opus"/);
  });
  withVerdict({ schema_version: 1, verdict: 'PASS' }, (f) => {
    assert.equal(runScript('check-plan-verdict.mjs', ['--verdict', f, '--model', 'opus', '--effort', 'low']).status, 1);
  });
  withVerdict('{not json', (f) => {
    assert.equal(runScript('check-plan-verdict.mjs', ['--verdict', f, '--model', 'opus', '--effort', 'low']).status, 2);
  });
  withVerdict(ok, (f) => {
    assert.equal(runScript('check-plan-verdict.mjs', ['--verdict', f, '--model', 'opus']).status, 2, 'an unstated pin is refused, not defaulted');
  });
});

test('plan-review and the contract doc name the caller-run check, and no longer say plan-review is spawned --mode gate', () => {
  const skill = flat(read('skills/plan-review/SKILL.md'));
  assert.match(skill, /check-plan-verdict\.mjs/, 'the skill does not name the check the caller runs');
  assert.doesNotMatch(skill, /--mode gate/);
  const row = read('shared/claude-md-contract.md').split('\n').find((l) => l.startsWith('| `plan-review/SKILL.md` |'));
  assert.ok(row, 'the contract doc has no plan-review row');
  assert.match(row, /check-plan-verdict\.mjs/);
  assert.doesNotMatch(row, /Spawned `--mode gate`/);
  const roster = JSON.parse(read('scripts/lens-roster.json'));
  const entry = roster.not_graph_nodes.find((n) => n.id === 'plan-review');
  assert.doesNotMatch(entry.why, /spawned --mode gate/);
});
