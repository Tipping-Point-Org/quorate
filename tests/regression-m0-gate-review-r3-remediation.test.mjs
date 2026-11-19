// Remediation of review 20260930-212919-m0-gate-review-r3 (operator's answer: "Fix all; make it loud (Recommended)"):
// G-22, G-10, G-5 and G-21 with its symptoms G-11 and G-28 — each a gap in a fix made earlier the same day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateGlob } from '../scripts/lib/contract-glob.mjs';
import { runScript, REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

// G-22: the doc correction of G-5 (the node allow-list is not closed) missed one sentence.
test('G-22: the contract doc no longer calls the node allow-list closed', () => {
  assert.doesNotMatch(read('shared', 'claude-md-contract.md'), /CLOSED allow-list/, 'a sentence still calls the list closed');
});

function mint(t, docPaths) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-docgrant-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  const yaml = [
    'graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""',
    `doc_paths: [${docPaths.map((g) => JSON.stringify(g)).join(', ')}]`,
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  return runScript('new-run.mjs',
    ['--slug', 'docgrant', '--repo-root', dir, '--no-request', '--no-verify-sandbox', '--full-sweep', 'docs'], { cwd: dir });
}

// G-10: a brace list with no `*` took the literal-file branch before the brace refusal, and became a grant for a file
// that does not exist.
test('G-10: a brace pattern with no wildcard is refused too, naming it', (t) => {
  const r = mint(t, ['docs/{a,b}.md']);
  assert.notEqual(r.status, 0, 'a brace list without a star was accepted as a literal file');
  assert.match(r.output, /docs\/\{a,b\}\.md/);
});

// G-5: the walk root was cut at the last `/` only, so a backslash glob kept no base and the absolute test never saw it.
// Through the one validator since contract-glob-grammar stage 2.
test('G-5: a backslash absolute or UNC glob leaves the repository', () => {
  assert.match(validateGlob('C:\\outside\\*.md') ?? '', /absolute/, 'a drive-letter backslash glob passed');
  assert.match(validateGlob('\\\\host\\share\\*.md') ?? '', /absolute/, 'a UNC glob passed');
  assert.equal(validateGlob('docs\\*.md'), null, 'a relative backslash glob is inside');
});

// G-21 (and G-11): a doc glob with no directory before its wildcard is never granted to the intent node — correctly,
// since its base would be the whole repository — but it was skipped in silence while the doc promised every glob.
test('G-21: a doc glob with no directory prefix is named when it is not granted', (t) => {
  const r = mint(t, ['**/*.md', 'docs/*.md']);
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /\*\*\/\*\.md[^\n]*not granted to the intent node/, 'the empty-prefix glob was skipped in silence');
});

test('G-21: the doc says an empty-prefix doc glob is not granted to the intent node', () => {
  // The wiring half — every skip the module reports reaches the run's not-checked record — matched run-graph's source
  // and is now DRIVEN: regression-cgg-r3-remediation.test.mjs runs run-graph with a fake runtime and reads the skip of a
  // `**/*.md` doc glob from the gate (G-23 of 20261001-155615-cgg-review-r3). The documentation half stays here.
  assert.match(read('shared', 'claude-md-contract.md'), /no directory before its first wildcard[\s\S]{0,300}not granted/);
});

