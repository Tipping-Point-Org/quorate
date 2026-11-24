// A REFUSED INPUT STARTS NO ARM AND NO JUDGE, AND IS RECORDED SO (G-30, G-31, G-34 of
// 20261121-204740-m3s7-b1-remediation-review; I-4 of .claude/requests/m3-stage7-fixes.md). Three legs:
//   G-30: the shadowed lens's SKILL.md was read by egressReadFile inline in the prompt's construction, so a link, a second
//         name, an oversize or unreadable file escaped spawnPanelArm before the arm had any status;
//   G-31: an arm whose prompt external-review refused was recorded BLOCKED with launched:true;
//   G-34: a judge was OK or DEGRADED, with no BLOCKED for a refused or absent prompt, and always launched:true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../scripts/run-graph.mjs', import.meta.url), 'utf8');

test('G-30: the shadowed SKILL.md is read before the prompt is built, and a refusal writes a not-launched status', () => {
  assert.doesNotMatch(src, /skillMarkdown: egressReadFile\(/, 'SKILL.md is still read inside the prompt expression');
  const at = src.indexOf('try { armSkill = egressReadFile(skillPath');
  assert.ok(at >= 0, 'SKILL.md is not read in a guarded statement');
  const block = src.slice(at, at + 700);
  assert.match(block, /refusedOrAbsent\(e\)/);
  assert.match(block, /writeStatusStub\(arm\.id, 'BLOCKED', \{ launched: false/);
  assert.match(block, /return;/);
});

test('G-31: an arm recorded BLOCKED by armUnreachableState is not recorded launched', () => {
  const at = src.indexOf("if (probe.state !== 'reachable') {");
  assert.ok(at >= 0, 'the unreachable-arm branch is gone');
  const block = src.slice(at, at + 800);
  assert.doesNotMatch(block, /writeStatusStub\(arm\.id, armUnreachableState\(probe\), \{[^}]*?launched: true/, 'a BLOCKED arm is written launched:true');
  assert.match(block, /launched: unreachable !== 'BLOCKED'/);
});

test('G-34: a judge has a BLOCKED state for a refused prompt, and is then not launched', () => {
  assert.doesNotMatch(src, /state: tbProbe\.state === 'reachable' \? 'OK' : 'DEGRADED'/, 'a judge is only OK or DEGRADED');
  assert.match(src, /const tbState = tbProbe\.state === 'reachable' \? 'OK' : armUnreachableState\(tbProbe\);/);
  assert.match(src, /state: tbState,/);
  assert.match(src, /launched: tbState !== 'BLOCKED', started_at: tbStartedAt/);
});

test('the BLOCKED rule both use: a refused or absent prompt file, and nothing else', async () => {
  const { armUnreachableState } = await import('../scripts/lib/reviewer-probe.mjs');
  assert.equal(armUnreachableState({ state: 'unavailable', reason: 'prompt file refused: a link' }), 'BLOCKED');
  assert.equal(armUnreachableState({ state: 'unavailable', reason: 'prompt file not found: x' }), 'BLOCKED');
  assert.equal(armUnreachableState({ state: 'unavailable', reason: 'timed out' }), 'DEGRADED');
});
