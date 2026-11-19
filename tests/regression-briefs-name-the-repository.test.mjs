// EVERY BRIEF NAMES THE REPOSITORY ITS NODE JUDGES (found 2026-10-20 on 20261020-043006-code-index-delivery).
//
// Since runs are staged under the engine's home, a node's working directory is the run directory, outside the
// repository. The reconciler said "the brief does not give the repository root, so I had to infer C:\work\quorate to check
// claims, and that limited how many groups I verified". It dropped 23 of 31 groups mostly unchecked, four of which held
// when checked. second-opinion reported the same gap. Earlier runs' reconciled.md carry it too
// (20261017-060636-rpe-review among them). A finding the judge cannot open is a finding it can only drop.
//
// So the lens brief, which second-opinion uses as well, and the reconcile brief each carry `repository_root`, filled
// by run-graph with the root it reviews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\r\n').join('\n');

test('the lens brief and the reconcile brief each carry repository_root', () => {
  for (const t of ['prompts/_templates/run-brief.md', 'prompts/_templates/reconcile-brief.md']) {
    assert.match(read(t), /^repository_root: \{\{repo_root\}\}$/m, `${t} does not name the repository`);
  }
});

test('the auxiliary brief second-opinion is given names the repository too', () => {
  const src = read('scripts/run-graph.mjs');
  const at = src.indexOf('function writeAuxBrief(');
  assert.notEqual(at, -1);
  // Rendered from aux-brief.md since G-25 of 20261021-162807-ciss-d1-review: the template names it, the writer fills it.
  assert.match(src.slice(at, src.indexOf('\n}\n', at)), /repository_root: repoRoot/, 'writeAuxBrief omits the repository root');
  assert.match(read('prompts/_templates/aux-brief.md'), /^repository_root: \{\{repository_root\}\}$/m, 'aux-brief.md does not name the repository');
});

test('run-graph fills repo_root in both renders with the root it reviews', () => {
  const src = read('scripts/run-graph.mjs');
  for (const name of ['run-brief.md', 'reconcile-brief.md']) {
    const at = src.indexOf(`renderTemplate(readTemplate('${name}'), {`);
    assert.notEqual(at, -1, `run-graph does not render ${name}`);
    const call = src.slice(at, src.indexOf('}),', at));
    assert.match(call, /repo_root: repoRoot\b/, `${name} is rendered without repo_root`);
  }
});
