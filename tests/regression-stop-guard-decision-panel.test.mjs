// autonomous-run.plan.md stage 6: with `review.decision_panel: on` (and the external panel the panel needs), a question
// with options goes to scripts/decide.mjs instead of the operator, and the stop guard holds that, since prose did not hold
// (autonomous-run-pauses.md criterion 5). A `Stop: question` with options is blocked once unless it names a decision
// record (decided or postponed by the panel) or a reserved category; without options, or with the flag off, the guard is
// as it was. Driven both through guardDecision and through the hook, as Claude Code drives it, against a fixture contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardDecision } from '../scripts/io/stop-record.mjs';
import { sessionHookEnv } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASK = 'Which cache bound?\n- **A. Size cap (suggested).** Pro: x. Con: y.\n- **B. Age cap.** Pro: x. Con: y.\n';
const at = (msg, extra = {}) => ({ last_assistant_message: msg, background_tasks: [], stop_hook_active: false, ...extra });

test('flag on: a question with options and no decision record is blocked once, pointing at decide.mjs', () => {
  const d = guardDecision(at(`${ASK}Stop: question`), { decisionPanel: 'on' });
  assert.equal(d.block, true);
  assert.match(d.reason, /decide\.mjs/);
  assert.equal(d.record.kind, 'to-panel-blocked');
  const again = guardDecision(at(`${ASK}Stop: question`, { stop_hook_active: true }), { decisionPanel: 'on' });
  assert.equal(again.block, false, 'blocked once only');
  assert.equal(again.record.kind, 'to-panel-after-block');
});

test('flag on: a decision record id, or a reserved category, lets the question stop', () => {
  assert.equal(guardDecision(at(`${ASK}The panel postponed it: 20261031-201500-a1b2c3.\nStop: question`), { decisionPanel: 'on' }).block, false);
  assert.equal(guardDecision(at(`${ASK}This is reserved: category \`approval\`.\nStop: question`), { decisionPanel: 'on' }).block, false);
  assert.equal(guardDecision(at(`${ASK}Stop: reserved`), { decisionPanel: 'on' }).block, false,
    'a reserved stop is the operator\'s by its marker');
  assert.equal(guardDecision(at(`${ASK}A near-id 2026103-201500-a1b2c3 is not one.\nStop: question`), { decisionPanel: 'on' }).block, true);
});

test('flag on: a question without options is not the panel\'s, and the existing rule still applies to it', () => {
  const d = guardDecision(at('Shall I go on?\nStop: question'), { decisionPanel: 'on' });
  assert.equal(d.block, true);
  assert.doesNotMatch(d.reason, /decide\.mjs/);
  assert.match(d.reason, /options and a suggestion/);
});

test('flag off, or absent: a question with options stops as before', () => {
  assert.equal(guardDecision(at(`${ASK}Stop: question`), { decisionPanel: 'off' }).block, false);
  assert.equal(guardDecision(at(`${ASK}Stop: question`)).block, false);
});

function withRepo(contractYaml, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-dp-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-dp-repo-'));
  try {
    if (contractYaml !== null) fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# x\n\n\`\`\`yaml\n${contractYaml}\n\`\`\`\n`);
    fn({ home, repo });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
}
function hook({ home, repo }, input) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stop-guard.mjs'), '--repo-root', repo], {
    input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'Stop', ...input }),
    encoding: 'utf8', env: sessionHookEnv({ QUORATE_HOME: home }), windowsHide: true,
  });
  return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}
const contract = (review) => `graph_contract_version: 6\nproject: fixture\nreview:\n${review}`;

test('the hook reads the flag from the contract; on needs the external panel; an unreadable contract allows the stop', () => {
  withRepo(contract('  external_panel: true\n  decision_panel: on\n'), (ctx) => {
    const r = hook(ctx, at(`${ASK}Stop: question`));
    assert.equal(r.status, 0);
    assert.equal(r.out?.decision, 'block');
    assert.match(r.out.reason, /decide\.mjs/);
  });
  withRepo(contract('  external_panel: false\n  decision_panel: on\n'), (ctx) => {
    assert.equal(hook(ctx, at(`${ASK}Stop: question`)).out, null, 'the panel cannot run without the external panel');
  });
  withRepo(contract('  external_panel: true\n  decision_panel: maybe\n'), (ctx) => {
    const r = hook(ctx, at(`${ASK}Stop: question`));
    assert.equal(r.status, 0);
    assert.equal(r.out, null, 'a value the reader refuses never fails the session');
  });
  withRepo(null, (ctx) => assert.equal(hook(ctx, at(`${ASK}Stop: question`)).out, null));
});
