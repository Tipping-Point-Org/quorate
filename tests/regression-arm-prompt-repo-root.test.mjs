// THE ARM IS NOT TOLD WHERE THE OPERATOR'S CHECKOUT IS (G-10 of 20261115-013659-pbr-1b-delivery). The external arm's prompt
// carries the lens's run brief, and that brief names `repository_root` as this host's absolute checkout path. The arm
// reviews a filtered snapshot; a sandbox that does not confine reads (codex read-only on Windows) lets it follow the named
// path to files the snapshot withholds, ignored or excluded, and send them to its vendor. The arm is told its working
// directory is the repository it reviews, and the host path does not reach its prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArmShadowPrompt } from '../scripts/io/review-prompts.mjs';

const SKILL = ['---', 'name: code-audit', '---', '', '# code-audit', 'Find defects.'].join('\n');
const HOST = 'C:\\Users\\someone\\work\\checkout';
const BRIEF = ['# Brief — code-audit', '', 'run_id: r1', 'node_id: code-audit', 'mode: lens', 'base_commit: abc',
  `repository_root: ${HOST}`, 'doctrine_path: shared/disk-first-protocol.md', '', '## Scope', 'src/app.js', ''].join('\n');

test('the arm\'s prompt does not carry the operator checkout\'s absolute repository_root', () => {
  const prompt = buildArmShadowPrompt({ lensId: 'code-audit', skillMarkdown: SKILL, runBrief: BRIEF, reviewer: 'codex', intentMode: 'forbidden' });
  assert.ok(!prompt.includes(HOST), 'the host checkout path reached the external arm\'s prompt');
  assert.ok(!/someone/.test(prompt), 'a part of the host path reached the prompt');
  assert.match(prompt, /^repository_root: .*directory you review/m, 'the arm is not told which directory is the repository');
  assert.match(prompt, /^## Scope\nsrc\/app\.js/m, 'the rest of the brief did not reach the arm');
});
