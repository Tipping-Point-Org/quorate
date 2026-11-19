// Remediation of run 20260930-205455-invoke-security-audit-g6-g7-high (operator's answers: "Fix as related work
// (Recommended)" for G-3; "Correct docs now, enforce next (Recommended)" for G-5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateGlob } from '../scripts/lib/contract-glob.mjs';
import { runScript, mintedRunDir, REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

// G-3, first half: the refusal judged only the text before the first wildcard, so a `..` after it passed — and the
// grant, rendered from the whole glob, climbed out of the repository.
// Through the one validator since contract-glob-grammar stage 2. One assertion changed meaning by decision: a `..`
// BEFORE the wildcard was judged by depth and accepted; the grammar (design 1A) refuses every `..` segment.
test('G-3: a `..` after a wildcard is refused — nothing lexical can say how far it climbs', () => {
  assert.match(validateGlob('docs/*/../../../elsewhere/*.md') ?? '', /\.\./, 'a post-wildcard `..` passed the refusal');
  assert.match(validateGlob('docs/**/../x.md') ?? '', /\.\./);
  assert.match(validateGlob('docs/../shared/**') ?? '', /\.\./, 'a `..` before the wildcard is refused too, by the grammar');
  assert.equal(validateGlob('docs/**/README.md'), null);
});

function mint(t, docPaths) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-docgrant-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'docs', 'sub'), { recursive: true });
  const yaml = [
    'graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""',
    `doc_paths: [${docPaths.map((g) => JSON.stringify(g)).join(', ')}]`,
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  return runScript('new-run.mjs',
    ['--slug', 'docgrant', '--repo-root', dir, '--no-request', '--no-verify-sandbox', '--full-sweep', 'docs'], { cwd: dir });
}

test('G-3: new-run refuses a doc glob whose `..` follows a wildcard, naming it', (t) => {
  const r = mint(t, ['docs/*/../../../elsewhere/*.md']);
  assert.notEqual(r.status, 0, 'the contract was accepted');
  assert.match(r.output, /doc_paths: docs\/\*\/\.\.\/\.\.\/\.\.\/elsewhere\/\*\.md/);
});

// G-3, second half: every wildcard glob other than a trailing `*.ext` became a RECURSIVE grant on its base directory.
test('G-3: a doc glob is never widened: nothing is granted in place', (t) => {
  const r = mint(t, ['docs/*', 'docs/README*', 'docs/**/README.md']);
  assert.equal(r.status, 0, r.output);
  // Since contract-glob-grammar stage 4 nothing is granted in place: the intent node reads a sandbox of copies of exactly
  // what each glob matches (tests/regression-doc-snapshot.test.mjs drives that copy on a real repository). The claim —
  // never wider than the glob — is now held by copying, so what remains here is that no rule widens it.
  const allow = JSON.parse(fs.readFileSync(path.join(mintedRunDir(r.output), 'intent-settings.json'), 'utf8')).permissions.allow;
  const docs = allow.filter((a) => /docs/.test(a));
  assert.deepEqual(docs, [], `a doc glob is still granted in place: ${docs.join(' | ')}`);
});

test('G-3: a brace pattern, which a permission rule cannot express, is refused by name', (t) => {
  const r = mint(t, ['docs/*.{md,rst}']);
  assert.notEqual(r.status, 0, 'a doc glob the grant cannot express was accepted');
  assert.match(r.output, /docs\/\*\.\{md,rst\}/);
});

// G-5: the doctrine and the code asserted a closed allow-list that unverified-claims.md records as measured false.
test('G-5: neither the protocol nor new-run claims the node allow-list is closed', () => {
  assert.doesNotMatch(read('shared', 'disk-first-protocol.md'), /the allow-list is CLOSED/, 'the protocol claims a closed allow-list');
  assert.doesNotMatch(read('scripts', 'new-run.mjs'), /allow-list\s*(\/\/\s*)?is a CLOSED set/, 'new-run claims a closed allow-list');
});
