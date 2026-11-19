// G-9 and G-10 of 20261110-202954-sfo-remediation-review-c: shared/external-reviewers.md restated two values another file
// owns (ARCHITECTURE A-1, one owner per fact): the vendor credential prefixes each adapter declares in
// scripts/reviewers.json's `env_prefixes` (`CODEX_`/`OPENAI_` for codex, `AGY_` for agy), and the panel arms' model, which
// scripts/lens-roster.json pins per arm under `panel_arms` (`gpt-5.6-sol`). A change to either owner left the doctrine
// stating the old value. The doctrine now points at the owners; the prefixes are held across shared/, the model in that one document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// Every value under a key named `key`, anywhere in the JSON.
function valuesOf(node, key, out = new Set()) {
  if (Array.isArray(node)) { for (const v of node) valuesOf(v, key, out); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) for (const x of [v].flat()) { if (typeof x === 'string' && x) out.add(x); }
      else valuesOf(v, key, out);
    }
  }
  return out;
}

// A PREFIX IN ANY SPELLING (G-8 and G-7 of 20261110-210841-sfo-remediation-2-review): this looked only for the backticked
// `CODEX_`, so `CODEX_*` stayed in two documents while it was green. A prefix is matched bare, starred or backticked, and
// not as the start of a longer name: CODEX_RUNTIME_FINDINGS.md is a file, not the prefix.
const restates = (text, prefix) => new RegExp(`(?<![A-Za-z0-9_])${prefix}(?![A-Za-z0-9])`).test(text);

test('G-9: no shared document restates, in any spelling, the vendor prefixes reviewers.json declares', () => {
  for (const spelled of ['`CODEX_`', 'CODEX_*', '`CODEX_*`/`OPENAI_*`', 'the CODEX_ prefix']) {
    assert.equal(restates(spelled, 'CODEX_'), true, `the check must find ${spelled}`);
  }
  assert.equal(restates('`CODEX_RUNTIME_FINDINGS.md`', 'CODEX_'), false, 'a longer name is not the prefix');
  const prefixes = valuesOf(JSON.parse(read('scripts/reviewers.json')), 'env_prefixes');
  assert.ok(prefixes.size > 0, 'reviewers.json declares no env_prefixes; this check found nothing to hold the doctrine to');
  const docs = fs.readdirSync(path.join(REPO_ROOT, 'shared')).filter((f) => f.endsWith('.md'));
  assert.ok(docs.includes('external-reviewers.md') && docs.includes('claude-md-contract.md'), 'the two documents that restated them are read');
  // A different fact in the same letters: the code index's refused env families, which no adapter's env_prefixes owns.
  const otherRule = /`ANTHROPIC_`\s+or\s+`CLAUDE_CODE_` families/g;
  const restated = docs.flatMap((f) => {
    const text = read(`shared/${f}`).replace(otherRule, '');
    return [...prefixes].filter((p) => restates(text, p)).map((p) => `${f}: ${p}`);
  });
  assert.deepEqual(restated, [], 'a shared document restates prefixes scripts/reviewers.json owns');
});

test('G-10: external-reviewers.md does not restate the model lens-roster.json pins for the panel arms', () => {
  const doc = read('shared/external-reviewers.md');
  const roster = JSON.parse(read('scripts/lens-roster.json'));
  assert.ok(roster.panel_arms, 'lens-roster.json has no panel_arms');
  const models = valuesOf(roster.panel_arms, 'model');
  assert.ok(models.size > 0, 'lens-roster.json pins no panel arm model; this check found nothing to hold the doctrine to');
  const restated = [...models].filter((m) => doc.includes(m));
  assert.deepEqual(restated, [], 'external-reviewers.md restates the panel arm model scripts/lens-roster.json owns');
});
