// contract-glob-grammar.plan.md, stage 2: ONE validator, at mint and at pre-flight, for every contract glob key and
// every doc_roles value, and for --full-sweep paths. It replaces contractGlobsLeavingRepo, which judged only the walk
// root (so `docs/*/../x` and `docs/?.md` passed) and only the outside-the-repository question.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cg from '../scripts/lib/contract-glob.mjs';
import { runScript, REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

test('contractGlobErrors names every refused entry, by key, across every glob key and doc_roles value', () => {
  assert.equal(typeof cg.contractGlobErrors, 'function', 'no validator covers every contract glob key');
  const errs = cg.contractGlobErrors({
    source_globs: ['src/**', 'src/?.ts'], test_globs: ['../t/**'], doc_paths: ['docs/{a,b}.md', 'docs/**'],
    generated_globs: ['/abs/**'], review: { preflight_inputs: ['ok/**', 'x/[ab]/**'] },
    doc_roles: { architecture: 'docs/*/../../ARCH.md', roadmap: 'ROADMAP.md', spec: '' },
  });
  const keys = errs.map((e) => e.split(' — ')[0]).sort();
  assert.deepEqual(keys, [
    'doc_paths: docs/{a,b}.md', 'doc_roles.architecture: docs/*/../../ARCH.md', 'generated_globs: /abs/**',
    'review.preflight_inputs: x/[ab]/**', 'source_globs: src/?.ts', 'test_globs: ../t/**',
  ].sort());
  for (const e of errs) assert.match(e, / — \S/, `no reason given: ${e}`);
  assert.deepEqual(cg.contractGlobErrors({ source_globs: ['src/**'], doc_roles: { spec: '' } }), [], 'an empty role is not a glob');
});

test('this repository\'s contract and the template\'s are inside the grammar', () => {
  // This repository's, through the real mint (a dry run spawns nothing).
  const r = runScript('new-run.mjs', ['--dry-run', '--full-sweep', 'scripts'], { cwd: REPO_ROOT });
  assert.equal(r.status, 0, r.output);
  // The template's, entry by entry.
  const tpl = read('CLAUDE.template.md');
  for (const line of tpl.split('\n').filter((l) => /^(source_globs|test_globs|doc_paths|generated_globs):/.test(l))) {
    for (const g of JSON.parse(line.slice(line.indexOf('['), line.indexOf(']') + 1))) assert.equal(cg.validateGlob(g), null, `template: ${g}`);
  }
});

function repoWith(t, contractLines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-cgv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""', ...contractLines].join('\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  return dir;
}

test('new-run refuses a contract carrying a form outside the grammar, naming the key and the entry', (t) => {
  const dir = repoWith(t, ['source_globs: ["src/?.ts"]']);
  const r = runScript('new-run.mjs', ['--slug', 'cgv', '--repo-root', dir, '--no-request', '--no-verify-sandbox', '--full-sweep', 'src'], { cwd: dir });
  assert.notEqual(r.status, 0, 'a `?` glob was accepted');
  assert.match(r.output, /source_globs: src\/\?\.ts/);
});

// The plan's disposition of r4's G-2: --print-contract serves the hooks, which read commands; a glob refusal there would
// block a push over a key the push does not use. Every path that mints still refuses (the test above).
test('--print-contract still prints a contract whose globs are outside the grammar', (t) => {
  const dir = repoWith(t, ['source_globs: ["src/?.ts"]']);
  const r = runScript('new-run.mjs', ['--print-contract', '--repo-root', dir], { cwd: dir });
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(JSON.parse(r.stdout).source_globs, ['src/?.ts']);
});

test('new-run refuses a --full-sweep path outside the grammar, naming it', (t) => {
  const dir = repoWith(t, ['source_globs: ["src/**"]']);
  const r = runScript('new-run.mjs', ['--slug', 'cgv', '--repo-root', dir, '--no-request', '--no-verify-sandbox', '--full-sweep', '../elsewhere'], { cwd: dir });
  assert.notEqual(r.status, 0, 'a --full-sweep path leaving the repository was accepted');
  assert.match(r.output, /--full-sweep[^\n]*\.\.\/elsewhere/);
});

test('new-run and preflight refuse through the one validator, and the old one is gone', () => {
  for (const f of ['new-run.mjs', 'preflight.mjs']) {
    assert.match(read('scripts', f), /contractGlobErrors\(contract\)[\s\S]{0,200}die\(/, `${f} does not refuse through the validator`);
    assert.doesNotMatch(read('scripts', f), /contractGlobsLeavingRepo/, `${f} still calls the old validator`);
  }
  assert.doesNotMatch(read('scripts', 'lib', 'walk-rules.mjs'), /export function (contractGlobsLeavingRepo|globLeavesRepo)/,
    'a second validator still exists');
});
