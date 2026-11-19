// regression-minutes-at-mint.test.mjs — code-index-d1-part-a.plan.md stage 2 (design note A-D2, A-D3, Verification 2-3).
//
// Every reader of a minutes value now reads it through lib/check-timeout.mjs, and new-run refuses a bad one at mint. Before:
// node_timeout_minutes fell back to 15 at four readers and 30 at two; an arm's non-numeric timeout_minutes reached
// spawnCapture as NaN and set no timer at all; and no value but reviewers.json's probe limit had an upper bound, so above
// 35,791 minutes a timer fired after about 1 ms (G-12 of 20261021-202611-ciss-d1-remediation-4-review).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';
import { minutes, MINUTES, TIMER_MAX_MINUTES, timerMs } from '../scripts/lib/check-timeout.mjs';
import { remediationTimeoutMinutes } from '../scripts/lib/remediation-chain.mjs';

const read = (...p) => fs.readFileSync(new URL(`../${p.join('/')}`, import.meta.url), 'utf8');

function repoWith(t, contractLines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-mint-minutes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', ...contractLines].join('\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  return dir;
}
const mint = (dir) => runScript('new-run.mjs', ['--dry-run', '--repo-root', dir, '--no-request', '--no-verify-sandbox', '--full-sweep', 'src'], { cwd: dir });

test('new-run refuses every contract minutes key above the maximum, naming it, and accepts the maximum', (t) => {
  const keys = Object.keys(MINUTES).filter((k) => k.startsWith('review.')).map((k) => k.slice('review.'.length));
  assert.ok(keys.length >= 5, `the registry lists ${keys.length} contract keys; the five *_timeout_minutes are the floor`);
  for (const key of keys) {
    const over = mint(repoWith(t, ['review:', `  ${key}: ${TIMER_MAX_MINUTES + 1}`]));
    assert.notEqual(over.status, 0, `${key}: ${TIMER_MAX_MINUTES + 1} was accepted at mint`);
    assert.match(over.output, new RegExp(`review\\.${key} [^\\n]*at most ${TIMER_MAX_MINUTES}`), over.output);
    const at = mint(repoWith(t, ['review:', `  ${key}: ${TIMER_MAX_MINUTES}`]));
    assert.doesNotMatch(at.output, /a limit in minutes cannot be used/, `${key}: ${TIMER_MAX_MINUTES} was refused`);
  }
});

test('new-run refuses a consumer lens limit above the maximum through the loader run-graph uses', (t) => {
  const dir = repoWith(t, ['lenses:', '  local-lens:', '    instructions: "lens.md"', `    timeout_minutes: ${TIMER_MAX_MINUTES + 1}`]);
  const r = mint(dir);
  assert.notEqual(r.status, 0, 'a consumer lens limit the timer cannot hold was accepted at mint');
  assert.match(r.output, /local-lens[^\n]*timeout_minutes[^\n]*at most 35791/, r.output);
  assert.match(read('scripts', 'new-run.mjs'), /consumerLenses\(\{ declared: contract\.lenses/, 'new-run does not load consumer lenses');
});

test('the roster new-run checks at mint: every lens, arm and barrier entry, and the shipped values pass', () => {
  const src = read('scripts', 'new-run.mjs');
  for (const field of ['lenses', 'panel_arms', 'barrier_nodes']) {
    assert.match(src, new RegExp(`ROSTER_FOR_DEFAULTS\\.${field} \\?\\? \\[\\]\\)[\\s\\S]{0,160}?check\\(`), `new-run does not check roster.${field}`);
  }
  const roster = JSON.parse(read('scripts', 'lens-roster.json'));
  for (const l of roster.lenses ?? []) minutes('roster.lens.timeout_minutes', l.timeout_minutes, 1);
  for (const a of roster.panel_arms ?? []) minutes('roster.arm.timeout_minutes', a.timeout_minutes, 1);
});

test('A-D2: the node limit has one absent default, 30, and no reader carries its own', () => {
  assert.equal(minutes('review.node_timeout_minutes', undefined), 30);
  assert.equal(remediationTimeoutMinutes({}, {}), 30);
  assert.throws(() => remediationTimeoutMinutes({}, { node_timeout_minutes: 0.5 }), /whole number/, 'G-22: a fraction is still refused for remediation');
  for (const f of ['run-graph.mjs', 'spawn-subagent.mjs', 'spawn-node.mjs', 'external-review.mjs', 'bench-second-opinion.mjs']) {
    const src = read('scripts', f);
    assert.doesNotMatch(src, /node_timeout_minutes'?,\s*(15|30)\)|timeoutMinutes \?\? (15|30)|node_timeout_minutes \?\? (15|30)/,
      `${f} still carries its own fallback for the node limit`);
  }
});

test('an arm limit that is not a number is refused, not run with no timer', () => {
  assert.throws(() => minutes('roster.arm.timeout_minutes', 'abc', 30), /roster\.arm\.timeout_minutes/);
  assert.doesNotMatch(read('scripts', 'run-graph.mjs'), /Number\(arm\.timeout_minutes/, 'run-graph still coerces an arm limit with Number()');
});

test('a backstop beyond a limit at the maximum is held at what a timer can hold', () => {
  assert.equal(timerMs(TIMER_MAX_MINUTES, 2), 2 ** 31 - 1);
  assert.equal(timerMs(30, 2), 32 * 60_000);
  assert.doesNotMatch(read('scripts', 'run-graph.mjs'), /\+ 2\) \* 60_000/, 'run-graph still sets a backstop that can overflow');
});
