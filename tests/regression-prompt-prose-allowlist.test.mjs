// G-20 — THE GUARD COULD NOT FAIL ON PROSE THAT DID NOT EXIST WHEN IT WAS WRITTEN.
//
// `regression-prompts-out-of-scripts` asserts `!src.includes(<three strings that were already moved>)`.
// It confirms a past migration stayed migrated. It is structurally incapable of failing on an ADDITION,
// which is the only moment a guard matters — so when seven paragraphs of model-facing prose were added
// to `codex-prompts.mjs` on 2026-09-13, under a line 27 reading "THE PROMPTS LIVE IN
// prompts/_templates/, NOT IN THIS FILE", the suite stayed green.
//
// This is the same shape as three other defects in this repository: the node-kind blacklists that
// silently admitted any new kind, and `forbidden-tail` guarding flags by name while `git blame -S`
// walked past. A BLACKLIST FAILS EXACTLY WHEN SOMETHING IS ADDED.
//
// So this is a WHITELIST. Every long string literal in the prompt library must be named below with a
// reason, or the suite goes red. A legitimate long string — a thrown diagnostic, an error message — is
// admitted by being named, which is what makes the rule mechanical rather than a judgement about what
// counts as "prose". Adding a sentence a model will read becomes a decision with someone's name on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

// Long enough that no identifier, path or format fragment reaches it, short enough that a sentence
// cannot hide under it. A model-facing instruction is never this short.
const MAX_LITERAL = 60;

// The prompt library is now THREE modules (G-21 of 20260925-015614-platform-review): codex-prompts.mjs
// was renamed review-prompts.mjs after template loading and stamp notes left it (consumer-owned-
// configuration AC 6). The guard follows the code into all three rather than losing the two that moved.
const LIBS = ['review-prompts.mjs', 'template.mjs', 'stamp-notes.mjs'].map((f) => path.join(REPO_ROOT, 'scripts', 'lib', f));
const readLibs = () => LIBS.map((p) => fs.readFileSync(p, 'utf8')).join('\n');

/**
 * Strings that may exceed the bound, each with the reason it is not model-facing prose.
 * A new entry here is a decision. An unlisted long string is a failure.
 */
const ALLOWED = new Map([
  ['prompt template ${name} is missing at ${p}: ${e.message}',
    'a thrown diagnostic for a missing template — read by a developer, never by a model'],
  ['no description for schema field \'${name}\' in prompts/_templates/schema-fields.json',
    'a thrown diagnostic naming the file to fix'],
  ['no consequence for run stamp \'${stamp}\' in prompts/_templates/stamp-consequences.json',
    'a thrown diagnostic; the model-facing half lives in the JSON it names'],
  [' — a stamp a node cannot act on states nothing (I-49)',
    'the tail of the diagnostic above'],
  // lib/template.mjs joined the scan with G-21; renderTemplate's two thrown diagnostics were already there.
  ['with an unfilled slot is a document a model follows literally',
    'renderTemplate\'s thrown diagnostic for an unfilled slot — read by a developer, never by a model'],
  ['the prose and the caller have drifted, which is how a brief stops carrying a rule',
    'renderTemplate\'s thrown diagnostic for an unused value'],
  ['supplied but the template has no such slot',
    'the head of the same diagnostic, written as its own template literal'],
]);

/** Every string literal in the file, outside comments. */
function literals(src) {
  const out = [];
  let inBlock = false;
  src.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('/*') || t.startsWith('/**')) inBlock = true;
    if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
    if (t.startsWith('//') || t.startsWith('*')) return;
    for (const m of t.matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
      const text = m[1] ?? m[2] ?? '';
      if (text.length > MAX_LITERAL) out.push({ line: i + 1, text });
    }
  });
  return out;
}

test('no unnamed long string literal survives in the prompt library', () => {
  const found = LIBS.flatMap((p) => literals(fs.readFileSync(p, 'utf8')));
  const unlisted = found.filter((f) => ![...ALLOWED.keys()].some((k) => f.text.includes(k) || k.includes(f.text)));

  assert.deepEqual(unlisted.map((u) => `${u.line}: ${u.text.slice(0, 70)}`), [],
    `model-facing prose belongs in prompts/_templates/ (ARCHITECTURE.md §2, and this file's own line 27).\n`
    + 'If one of these is genuinely not prose — a thrown diagnostic, say — add it to ALLOWED with the\n'
    + 'reason. That is the point: admitting a long string becomes a decision instead of a default.');
});

// THE WHITELIST MUST NOT BECOME A SECOND BLACKLIST. An entry kept after its string is gone is how an
// allow-list rots into a list of things nobody checks.
test('every allow-list entry still corresponds to a real string', () => {
  const src = readLibs();
  for (const [text, why] of ALLOWED) {
    assert.ok(src.includes(text), `ALLOWED names a string no longer in the file: "${text.slice(0, 50)}" (${why})`);
  }
});

// The prose that WAS in the file must be in the templates, not merely deleted from here.
test('the intent instructions moved to templates rather than vanishing', () => {
  const dir = path.join(REPO_ROOT, 'prompts', '_templates');
  for (const name of ['arm-intent-inlined.md', 'arm-intent-unavailable.md', 'arm-evidence-contract.md']) {
    const p = path.join(dir, name);
    assert.ok(fs.existsSync(p), `${name} must hold the prose removed from codex-prompts.mjs`);
    assert.ok(fs.readFileSync(p, 'utf8').trim().length > 0, `${name} is empty — a blank prompt asks a node to do nothing`);
  }
  // And the sentences a model actually reads are still reaching it.
  assert.match(fs.readFileSync(path.join(dir, 'arm-intent-inlined.md'), 'utf8'), /intent-grounded/);
  assert.match(fs.readFileSync(path.join(dir, 'arm-intent-unavailable.md'), 'utf8'), /not_checked/);
  // G-3 of 20261105-212751-sogsr-delivery: external-review's reply contract (the schema hint and the `status` field) was
  // model-facing prose in orchestration code; the prompt library owns every sentence a model reads (ARCHITECTURE.md §2).
  const er = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  assert.doesNotMatch(er, /MUST also contain|EXACTLY ONE JSON object/, 'external-review.mjs still writes the reply contract inline');
  const reply = path.join(dir, 'reviewer-reply-contract.md');
  assert.ok(fs.existsSync(reply), 'the reply contract must live in the prompt library');
  assert.match(fs.readFileSync(reply, 'utf8'), /"status": one of "ok" \| "refused" \| "incomplete"[\s\S]*\{\{schema\}\}|\{\{schema\}\}[\s\S]*"status": one of "ok" \| "refused" \| "incomplete"/);
});
