// THE "LEFT OUT OF YOUR SANDBOX" SECTION IS A PROMPT, SO IT LIVES IN THE PROMPT LIBRARY (G-6 of
// 20261115-013659-pbr-1b-delivery; ARCHITECTURE.md §2). leftOutSection wrote its heading and the instruction to the intent
// node inline in run-graph.mjs, a second owner of model-facing prose a prompt author could not find. The section's
// rendering into a real brief is held by the run test in regression-prompt-bound-run-reads.test.mjs; this holds the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { renderTemplate } from '../scripts/lib/template.mjs';

const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
const TEMPLATE = 'prompts/_templates/left-out-of-sandbox.md';

test('the left-out section\'s words are in the prompt library, with one slot for the list', () => {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, TEMPLATE)), `${TEMPLATE} does not exist`);
  const out = renderTemplate(read(TEMPLATE), { items: '- doc snapshot a.md: refused' }, TEMPLATE);
  assert.match(out, /^## Left out of your sandbox/m);
  assert.match(out, /not derivable/);
  assert.match(out, /- doc snapshot a\.md: refused/);
});

test('run-graph renders the section from the template and holds none of its prose', () => {
  const src = read('scripts/run-graph.mjs');
  const at = src.indexOf('function leftOutSection(nodeId) {');
  assert.ok(at > 0, 'leftOutSection is not where this test looks');
  const body = src.slice(at, src.indexOf('\n}\n', at));
  assert.match(body, /templateText\('left-out-of-sandbox\.md'/, 'leftOutSection does not render the template');
  assert.doesNotMatch(src, /## Left out of your sandbox/, 'the heading is still written in run-graph.mjs');
  assert.doesNotMatch(src, /have bounded as not derivable/, 'the instruction is still written in run-graph.mjs');
});
