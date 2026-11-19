// G-22 — THE WITHHELD BLOCK OF EVERY intent:forbidden ARM WAS OVERWRITTEN.
//
// Raised by code-audit, contract-audit, arch-review (as G-20) and panel-codex-code in run
// 20260914-004236-postfix-timeout-criteria — cross-family corroborated, and verified in the run's own
// artifacts before this test was written.
//
// `buildCodexShadowPrompt` called `inlineIntentSection` on EVERY arm, and that function decided what to
// write by asking whether `criteria` was empty. But run-graph fills criteria only for a lens declaring
// `intent: 'required'`, so empty meant two different things:
//
//   'this lens may not cite intent'          <- correct for a forbidden arm
//   'intent.md could not be read'            <- what every forbidden arm was told
//
// So the correct withheld block ("You may not read intent.md. Echo intent_sha as the empty string. You
// may not emit intent_ref.") was replaced by "the criteria were NOT supplied ... you therefore cannot
// verify I-n coverage ... record this exact gap in not_checked[]". In the run that found it, all five
// non-contract arm prompts carried that text and three status files carried the false gap it ordered.
//
// The harm is not the wrong sentence. It is that a REAL read failure on the contract arm became
// indistinguishable from four manufactured ones — the engine reads an arm's not_checked[] when deciding
// whether an empty result is clean, so fabricated gaps are load-bearing.
//
// The cure is one owner for the question: the lens's intent MODE decides, and emptiness decides nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { inlineIntentSection, buildArmShadowPrompt, criteriaSection } from '../scripts/io/review-prompts.mjs';

// Exactly what run-graph.mjs:718 writes for a lens that may not read intent.md.
const WITHHELD = 'intent_sha256: (withheld)\n'
  + 'You may not read intent.md. Echo intent_sha as the empty string. You may not emit intent_ref.';

const forbiddenBrief = [
  '# Brief', '', 'node_id: code-audit', '', '## Intent', WITHHELD, '', '## Scope', 'derived from the diff', '',
].join('\n');

const requiredBrief = [
  '# Brief', '', 'node_id: contract-audit', '', '## Intent',
  'intent_sha256: abc123',
  'intent.md: read it. Every finding you emit MUST cite an I-n criterion from it.',
  '', '## Scope', 'derived from the diff', '',
].join('\n');

const CRITERIA = '### I-1\nA disputed group is voted on by at least two judges.';

test('a forbidden arm keeps its withheld block, untouched', () => {
  const out = inlineIntentSection(forbiddenBrief, '', { intentMode: 'forbidden' });

  assert.match(out, /You may not read intent\.md\. Echo intent_sha as the empty string\./,
    'the withheld block run-graph wrote must survive');
  // The three phrases that manufactured the false gap.
  assert.ok(!/NOT supplied/i.test(out), 'a forbidden arm was never promised criteria');
  assert.ok(!/cannot verify I-n coverage/i.test(out));
  assert.ok(!/record this exact gap/i.test(out));
  assert.match(out, /## Scope/, 'the rest of the brief still arrives');
});

test('a required arm with criteria is given them', () => {
  const out = inlineIntentSection(requiredBrief, CRITERIA, { intentMode: 'required' });
  assert.match(out, /### I-1/);
  assert.ok(!/intent\.md: read it/.test(out), 'the order it cannot obey is gone');
  assert.match(out, /do not present a\s+finding as intent-grounded/);
});

// THE ONE CASE THAT MUST STILL REPORT A GAP. A required lens whose criteria could not be read is a real
// failure, and it has to stay distinguishable from the four that were being fabricated beside it.
test('a required arm WITHOUT criteria still reports the real gap', () => {
  const out = inlineIntentSection(requiredBrief, '', { intentMode: 'required' });
  assert.match(out, /criteria were NOT supplied/);
  assert.match(out, /record this exact gap/);
});

test('buildArmShadowPrompt routes on intent mode, not on emptiness', () => {
  const skill = ['---', 'name: code-audit', '---', '', '# code-audit', 'Judge correctness.'].join('\n');

  const forbidden = buildArmShadowPrompt({
    lensId: 'code-audit', skillMarkdown: skill, runBrief: forbiddenBrief,
    reviewer: 'codex', intentMode: 'forbidden',
  });
  assert.match(forbidden, /You may not read intent\.md\. Echo intent_sha as the empty string\./);
  assert.ok(!/NOT supplied/i.test(forbidden),
    'this is the exact text all five non-contract arms received in 20260914-004236');

  const required = buildArmShadowPrompt({
    lensId: 'contract-audit', skillMarkdown: skill, runBrief: requiredBrief,
    reviewer: 'codex', intentMode: 'required', intentCriteria: CRITERIA,
  });
  assert.match(required, /### I-1/);
});

// The caller must PASS the mode. A default that guesses would rebuild the defect: the whole failure was
// one function inferring intent policy from a value that did not carry it.
test('run-graph hands the arm its shadowed lens intent mode', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(src, /intentMode: shadowedLens\?\.intent/,
    'the mode is read from the roster and passed, never re-derived inside the prompt library');

  const lib = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'review-prompts.mjs'), 'utf8');
  const fn = lib.slice(lib.indexOf('export function inlineIntentSection'));
  assert.ok(!/criteria\s*\)\s*\.trim\(\)\s*\?/.test(fn.slice(0, 1200))
    || /intentMode/.test(fn.slice(0, 1200)),
    'emptiness must not be what selects the wording');
});

// The five prompts from the run that found this are still on disk. They are the before-state, and this
// asserts the evidence has not been quietly rewritten to make the fix look better.
test('the artifacts that recorded the defect are preserved', (t) => {
  const dir = path.join(REPO_ROOT, '.claude', 'reviews', '20260914-004236-postfix-timeout-criteria', 'nodes');
  if (!fs.existsSync(dir)) { t.skip('a fresh clone has no run history'); return; }
  const hit = ['arch', 'code', 'docs', 'perf', 'security']
    .map((a) => path.join(dir, `panel-codex-${a}-prompt.md`))
    .filter((p) => fs.existsSync(p) && /criteria were NOT supplied/.test(fs.readFileSync(p, 'utf8')));
  assert.equal(hit.length, 5,
    'the five arm prompts carrying the defect are evidence of the prior run and must not be edited');
});

// G-14 of run 20260924-123916-verbatim-guards — `panel-codex-arch` and `panel-codex-contract`.
//
// Generic panel orchestration imported `buildCodexShadowPrompt` and then used it for whichever
// `arm.reviewer` the adapter table selected. I-4 and ARCHITECTURE §4 keep vendor identity in
// adapter DATA, names included — and this one is in the orchestration interface itself, which is
// the boundary the adapter table exists to make swappable.
//
// The MODULE path carries the same vendor name and is deliberately NOT renamed here: it is already
// tracked work under `.claude/requests/consumer-owned-configuration.md` AC 6, whose Expected
// surface names "scripts/lib/codex-prompts.mjs — the vendor name and the non-prompt exports". A
// 1800-reference rename inside a remediation pass is unreviewed work riding on a reviewed decision.
test('the shadow-prompt builder is named for the role it serves, not for a vendor', async () => {
  const mod = await import('../scripts/io/review-prompts.mjs');
  assert.equal(typeof mod.buildArmShadowPrompt, 'function',
    'the orchestration interface must not carry a vendor name');
  assert.equal(mod.buildCodexShadowPrompt, undefined,
    'and the vendor-named export must be gone, not aliased — an alias keeps the name alive');

  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.ok(!/buildCodexShadowPrompt/.test(src), 'run-graph must not import or call it by that name');
});
