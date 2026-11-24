// G-10 and G-2 of 20261123-020742-m3s7-b4-remediation-3-review: the G-12 remediation removed "the shared file wins" from
// shared/external-reviewers.md, which now says the settings are what runs and a disagreement is a defect, not a
// precedence. The rule survived in shared/claude-md-contract.md's file table (G-10) and in the second-opinion prompt
// (G-2), so a reader, and the second-opinion node, were told a precedence the engine does not use. Every document and
// prompt is searched, in the spellings the rule took, not only the two lines the review named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(md|json)$/.test(e.name)) out.push(rel);
  }
  return out;
}

// The rule's spellings: the shared file, external-reviewers.md, or this file "wins", "takes precedence" or "prevails"
// over CLAUDE.md or the contract on model policy.
const STALE = [
  /shared file wins/i,
  /external-reviewers\.md[^.\n]{0,80}\b(wins|takes precedence|prevails)\b/i,
  /disagree on model policy[^.\n]{0,80}\b(wins|takes precedence|prevails)\b/i,
];

test('no document or prompt says the model-policy file wins over the settings', () => {
  const files = [...walk('shared'), ...walk('prompts'), ...walk('skills'), 'CLAUDE.md', 'QUORATE.md', 'ARCHITECTURE.md',
    'CLAUDE.template.md'].filter((f) => fs.existsSync(path.join(REPO_ROOT, f)));
  const hits = [];
  for (const f of files) {
    fs.readFileSync(path.join(REPO_ROOT, f), 'utf8').split(/\r?\n/).forEach((ln, i) => {
      if (STALE.some((re) => re.test(ln))) hits.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], 'a stale model-policy precedence rule');
});

// G-11: the policy promised more than spawn-node checked; it now checks every node, and the documents say so.
test('the documents describe the refused-model check as applying to every node', () => {
  const er = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'external-reviewers.md'), 'utf8');
  assert.doesNotMatch(er, /refusing a lens whose model/, 'external-reviewers.md still says only a lens is refused');
  assert.match(er, /refusing any node whose model/);
  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  assert.doesNotMatch(roster.$lens_models_refused, /refuses --mode lens when/, 'the roster comment still says lens only');
});
