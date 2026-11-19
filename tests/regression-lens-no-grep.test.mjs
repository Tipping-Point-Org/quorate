// stop-owner-grep-state-roots.plan.md stage 3, G-17 of 20261022-200543-ciss-d1-review-2 (raised three times), decided B by
// the operator (2026-10-22: "ok, continue", to the question whose suggestion was B): every lens was granted the runtime's
// bare `Grep`, which no policy rule can confine to the repository (probed live: a path-scoped allow does not scope the
// tool, and a deny removes it). So lenses no longer get it; content search goes through `git grep` under capture.mjs,
// repository-scoped by construction and leaving evidence a finding can cite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

test('G-17: the node runtime grants a lens no Grep', async () => {
  const { builtinReviewers } = await import('../scripts/io/reviewers.mjs');
  const tools = builtinReviewers().claude.node_runtime.tools;
  assert.ok(!tools.lens_allow.includes('Grep'), `the lens allow-list still grants Grep: ${JSON.stringify(tools.lens_allow)}`);
  for (const t of tools.content_tools ?? []) {
    assert.ok(!tools.lens_allow.includes(t), `the lens allow-list grants the content tool ${t}`);
  }
  // The lens policy is built from that list alone, never a literal tool name (adapter-tool-lists.plan.md).
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  const block = src.slice(src.indexOf('function buildNodeSettings'), src.indexOf('function buildIntentSettings'));
  assert.match(block, /toolList\(NODE_RUNTIME, 'lens_allow'\)/);
  const code = block.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /'Grep'/, 'the lens policy names Grep itself');

  // G-7 / G-10 of 20261105-212751-sogsr-delivery: absence from lens_allow is not a refusal. Under `defaultMode: manual` an
  // unlisted read-only tool still runs, and only a DENY entry removes Grep (probed; new-run.mjs). So the lens's rendered
  // deny set must carry every content tool, and the lens policy must render its deny from that set.
  const { rawTable } = await import('../scripts/io/reviewers.mjs');
  const { denyToolsFor } = await import('../scripts/lib/decisions.mjs');
  const runtime = builtinReviewers()[rawTable().default_node_runtime];
  const content = runtime.node_runtime.grants?.content_tools ?? runtime.node_runtime.tools?.content_tools ?? [];
  assert.ok(content.includes('Grep'), `the runtime declares Grep a content tool: ${JSON.stringify(content)}`);
  const deny = denyToolsFor('node', runtime);
  for (const t of content) assert.ok(deny.includes(t), `the lens deny set omits the content tool ${t}: ${JSON.stringify(deny)}`);
  assert.match(block, /denyToolsFor\('node', NODE_RUNTIME\)/, 'the lens policy renders its deny from the node deny set');
});

// G-12: the guard flags a prompt that tells a lens to USE Grep, not one that forbids it or records its removal.
const NEGATION = /\b(no|not|never|without|nor)\b[^.;]*\bGrep\b|\bGrep\b[^.;]*\b(removed|denied|is not available)\b/i;
function instructsGrep(line) {
  return /\bGrep\b/.test(line) && !NEGATION.test(line);
}

test('G-17: no node prompt tells a lens to use Grep; content search is git grep through capture', () => {
  // G-12: the guard itself — an instruction to use Grep is flagged, a prohibition is not.
  assert.equal(instructsGrep('Use Grep to find every caller.'), true);
  assert.equal(instructsGrep('Search with the Grep tool for the symbol.'), true);
  assert.equal(instructsGrep('Do not use Grep; search with `git grep` through capture.mjs.'), false);
  assert.equal(instructsGrep('A lens has no Grep: content search goes through capture.mjs.'), false);
  assert.equal(instructsGrep('Never reach for Grep here.'), false);
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.md$/.test(e.name)) {
        fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (instructsGrep(line)) offenders.push(`${path.relative(REPO_ROOT, p)}:${i + 1}`);
        });
      }
    }
  };
  walk(path.join(REPO_ROOT, 'prompts'));
  assert.deepEqual(offenders, [], 'a node prompt still tells a lens to use the Grep tool');
  // G-11: the positive half the title names. The prompts that search content route it through `git grep` under capture.mjs.
  for (const rel of ['prompts/arch-review/PROMPT.md', 'prompts/doc-consistency-review/PROMPT.md']) {
    const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.match(text, /`git grep[^`]*` through `capture\.mjs`/, `${rel} does not route content search through git grep under capture.mjs`);
  }
});

test('G-17: the doctrine records the decision, not an open residual', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8');
  assert.doesNotMatch(doc, /the current\s+choice is \*\*Grep stays\*\*/, 'disk-first-protocol still records Grep as kept');
  assert.match(doc, /\*\*No `Grep` for a lens/);
  assert.match(doc, /`git grep`/);
});
