// THE ARM THAT COULD NOT SEE THE ASK (observed, run 20260913-222312-arch-declared).
//
// `contract-audit` is the only lens declaring `intent: "required"` — the only one that may cite I-n,
// and the one whose whole question is "did the code do what was asked?". Its Codex shadow was the one
// node structurally unable to read the ask: the run brief says "intent.md: read it. Every finding you
// emit MUST cite an I-n criterion from it", and an external arm is forbidden the run directory.
//
// It refused rather than guessed, which is the right answer to a broken prompt:
//
//   "The authoritative intent.md criteria were not provided inline and the external-arm rules
//    prohibit reading the run directory, so the declared request was reviewed but complete I-n
//    coverage could not be verified."
//
// The engine handled that correctly — it read the not_checked[] entry naming the reviewer and refused
// to treat the empty candidates[] as a clean pass. So the defect was never in the gate; it was that
// the one arm whose corroboration mattered most could never be asked the question.
//
// The cure sends the criteria INTO the prompt rather than letting the arm out to fetch them:
// containment of the run directory is built by construction and is not weakened to fix a prompt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { criteriaSection, inlineIntentSection, buildArmShadowPrompt } from '../scripts/io/review-prompts.mjs';

// AMENDED after G-22. Every call below now passes `intentMode: 'required'`, because these tests were
// written believing emptiness could stand in for intent policy — the belief that WAS the defect. They
// passed against the broken code and would have gone on passing, which is the class §4 exists to catch:
// a test agreeing with whatever its author assumed. What they cover is unchanged and still needed; what
// they no longer do is silently assert that a forbidden arm should be told its criteria went missing.
// tests/regression-arm-forbidden-intent-block.test.mjs covers the case they got wrong.

// The intent document that actually shipped: criteria, then a sources section carrying an absolute
// path to a DIFFERENT private project of the operator's. That path is why this cuts at the heading
// instead of inlining the whole file.
const INTENT = [
  '# Intent',
  '',
  '## Criteria',
  '',
  '### I-1',
  'A disputed finding group is voted on by a judge SET of at least two first-order judges.',
  '',
  '### I-2',
  'Each judge declares its family, because reviewer is only a transport.',
  '',
  '## Sources and limits',
  '',
  '- Criteria I-1..I-9 are limited to what the request quotes.',
  '  C:\\work\\story-pipeline\\.claude\\skills\\adjudication-panel is outside the declared documents.',
  '',
].join('\n');

const BRIEF = [
  '# Brief',
  '',
  'node_id: contract-audit',
  '',
  '## Intent',
  'intent_sha256: abc123',
  'intent.md: read it. Every finding you emit MUST cite an I-n criterion from it.',
  '',
  '## Scope',
  'scope derived from the diff',
  '',
].join('\n');

test('the criteria section is extracted, and the rest of intent.md is not', () => {
  const crit = criteriaSection(INTENT);
  assert.match(crit, /### I-1/);
  assert.match(crit, /### I-2/);
  assert.ok(!/Sources and limits/.test(crit), 'the cut stops at the next heading');

  // THE POINT OF CUTTING AT THE HEADING. This prompt is bound for a third-party cloud, and the
  // operator's other project's filesystem layout is not a review criterion.
  assert.ok(!/story-pipeline/.test(crit),
    'an absolute path to an unrelated private project must not ride along to a vendor');
  assert.ok(!crit.includes('F:\\'), 'no absolute path leaves in the criteria');

  assert.equal(criteriaSection('# Intent\n\nno criteria here\n'), '',
    'no section means state the gap, never inline a guess');
  assert.equal(criteriaSection(null), '');
});

test('the arm is given the criteria instead of an order it cannot obey', () => {
  const out = inlineIntentSection(BRIEF, criteriaSection(INTENT), { intentMode: 'required' });

  // The instruction that caused the refusal is gone.
  assert.ok(!/intent\.md: read it/.test(out), 'an arm cannot read the run directory');
  assert.match(out, /You may not read intent\.md, and you do not need to/);
  // The criteria are actually present, and the citation duty survives.
  assert.match(out, /### I-1/);
  assert.match(out, /do not present a\s+finding as intent-grounded/);
  // Everything after the section is untouched.
  assert.match(out, /## Scope\nscope derived from the diff/);
});

test('absent criteria produce a stated gap, never a silent one', () => {
  const out = inlineIntentSection(BRIEF, '', { intentMode: 'required' });
  assert.match(out, /criteria were NOT supplied/);
  assert.match(out, /record this exact gap/);
  // The failure this replaces was an arm inferring criteria and reporting coverage over them.
  // Matched across the line break rather than at a fixed one: the sentence now lives in
  // prompts/_templates/arm-intent-unavailable.md, where a prompt author may rewrap it freely. A test
  // pinned to one author's line wrapping fails on an edit that changed nothing a model reads.
  assert.match(out, /Do not infer the\s+criteria from the documents/);
  assert.ok(!/intent\.md: read it/.test(out));
  assert.match(out, /## Scope/, 'the rest of the brief still arrives');
});

test('a brief with no Intent section is returned untouched, not guessed at', () => {
  const bare = '# Brief\n\n## Scope\nnothing else\n';
  assert.equal(inlineIntentSection(bare, criteriaSection(INTENT), { intentMode: 'required' }), bare);
});

test('buildArmShadowPrompt threads the criteria through both replacements', () => {
  const skill = ['---', 'name: contract-audit', '---', '', '# contract-audit', 'Judge conformance.'].join('\n');
  const briefWithEvidence = `${BRIEF}\n## Evidence\nRun capture.mjs at C:\\work\\quorate\\.claude\\reviews\\r1\n\n## Stamps\nnone\n`;
  const prompt = buildArmShadowPrompt({
    lensId: 'contract-audit',
    skillMarkdown: skill,
    runBrief: briefWithEvidence,
    reviewer: 'codex',
    intentCriteria: criteriaSection(INTENT),
    intentMode: 'required',
  });

  assert.match(prompt, /### I-1/, 'the criteria reached the arm');
  // BOTH internal-only instructions replaced. Either one left intact is an order the arm must refuse.
  assert.ok(!/intent\.md: read it/.test(prompt));
  assert.ok(!/reviews[\\/]r1/.test(prompt), 'the run directory path is still withheld (G-27)');
  assert.match(prompt, /You have no capture channel/);
});

test('only a lens that requires intent gets the criteria', () => {
  // The roster is the owner of this fact, and the wiring reads it rather than naming contract-audit.
  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  const requiring = (roster.lenses ?? []).filter((l) => l.intent === 'required').map((l) => l.id);
  assert.deepEqual(requiring, ['contract-audit'],
    'if another lens gains intent: required, this wiring covers it with no edit');

  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(src, /shadowedLens\?\.intent === 'required'/,
    'the condition must be read from the roster, not hardcoded to a lens name');
  assert.ok(!/arm\.shadows === 'contract-audit'/.test(src),
    'naming the lens would silently skip the next lens that requires intent');

  // An arm still may not READ the file. Inlining is a different channel, and the expected entry that
  // forbids the read stays true — a test here because loosening it would look like the same fix.
  assert.match(src, /intent: 'forbidden'/,
    'the arm records intent: forbidden — the criteria arrive in the prompt, not by a read');

  // ONE lookup of the shadowed lens. There were two, thirty lines apart.
  assert.equal((src.match(/const shadowedLens = LENSES\.find/g) ?? []).length, 1,
    'two lookups of one fact is the A-1 breach waiting for an edit to miss a copy');
});
