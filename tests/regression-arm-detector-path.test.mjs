// G-15 of 20261122-014737-m3s7-b2-review-2 (I-4 of .claude/requests/m3-stage7-fixes.md). The arm brief's
// inert-feature detector command was read with `node (\S*find-inert-features.mjs)`, so a framework path holding a space
// was cut and the arm silently got no detector command; and a detector outside repository_root was dropped with no word,
// so the arm was never told the sweep its rules require could not be handed over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripCaptureSection } from '../scripts/io/review-prompts.mjs';

const brief = (root, detector) => [
  '# Brief', '', `repository_root: ${root}`, '', '## Scope', 'scripts/**', '',
  '## Evidence',
  `  node cap.mjs --run-dir ${root}/.claude/reviews/20260101-000000-x --node x --name inert-sweep -- node ${detector}`,
  '', '## Threat model', 'kept', '',
].join('\n');

test('a repository root holding a space still hands the arm its detector, relative', () => {
  const out = stripCaptureSection(brief('C:/my proj', 'C:/my proj/.claude/skills/quorate/scripts/find-inert-features.mjs'));
  assert.match(out, /`node \.claude\/skills\/quorate\/scripts\/find-inert-features\.mjs`/,
    `a root with a space cut the detector path and the arm got no command: ${out}`);
  assert.ok(!out.includes('C:/my proj/.claude'), 'and gives no absolute coordinate');
});

test('a detector path holding a space is handed over quoted, whole', () => {
  const out = stripCaptureSection(brief('C:/proj', 'C:/proj/my tools/scripts/find-inert-features.mjs'));
  assert.match(out, /`node "my tools\/scripts\/find-inert-features\.mjs"`/,
    `a detector path with a space was cut or left unquoted: ${out}`);
});

test('a detector outside the repository is said to be absent, never dropped silently', () => {
  const out = stripCaptureSection(brief('C:/proj', 'D:/elsewhere/quorate/scripts/find-inert-features.mjs'));
  assert.ok(!out.includes('D:/elsewhere'), 'the outside path is not handed over');
  assert.match(out, /inert-feature detector[\s\S]*not_checked/,
    `the arm was not told the detector is not in its working directory: ${out}`);
});
