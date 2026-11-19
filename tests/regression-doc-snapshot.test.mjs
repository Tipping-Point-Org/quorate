// contract-glob-grammar.plan.md, stage 4, as revised by the operator (2026-10-01: "B: copy only matched docs
// (Recommended)", "Inside the chosen fix (Recommended)"): the intent node reads only its sandbox, which holds the run's
// contract snapshot and, for every doc glob, exactly the documents matchesGlob admits — copied, never granted in place.
// Stage 2b measured why: the Read rules granted nothing on Windows and --add-dir granted whole directories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSnapshot, snapshotDocGlobs } from '../scripts/io/doc-snapshot.mjs';
import { runScript, mintedRunDir, REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

function repo(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-docsnap-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  for (const f of ['docs/a.md', 'docs/README.md', 'docs/sub/b.md', 'docs/pic.png', 'src/app.js', 'NOTES.md']) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), f);
  }
  return d;
}

function snapshot(d, docPaths) {
  const snapDir = path.join(d, '.snap');
  const skips = [];
  const snap = createSnapshot(snapDir, { onSkip: (s) => skips.push(s) });
  snapshotDocGlobs({ repoRoot: d, docPaths, snap, onSkip: (s) => skips.push(s) });
  const copied = fs.existsSync(snapDir) ? fs.readdirSync(snapDir).sort() : [];
  return { copied, skips };
}

test('a doc glob copies exactly what it matches: `*` stays in its segment', (t) => {
  const { copied } = snapshot(repo(t), ['docs/*.md']);
  assert.equal(copied.length, 2, `copied: ${copied.join(', ')}`);
  assert.ok(copied.every((n) => !/sub/.test(n)), 'docs/sub/b.md was copied for docs/*.md');
});

test('a literal directory copies every document below it, and only documents', (t) => {
  const { copied } = snapshot(repo(t), ['docs']);
  assert.equal(copied.length, 3, `copied: ${copied.join(', ')}`);
  assert.ok(copied.every((n) => n.endsWith('.md')), 'a non-document was copied');
});

test('a glob with a partial segment walks from its directory: docs/README* finds docs/README.md', (t) => {
  const { copied } = snapshot(repo(t), ['docs/README*']);
  assert.equal(copied.length, 1, `copied: ${copied.join(', ')}`);
});

test('a single declared file is copied', (t) => {
  assert.equal(snapshot(repo(t), ['NOTES.md']).copied.length, 1);
});

test('every doc glob the snapshot cannot honour is recorded — none is silent (r5 G-8, G-9)', (t) => {
  const { skips } = snapshot(repo(t), ['**/*.md', 'missing/**']);
  const items = skips.map((s) => s.item).sort();
  assert.deepEqual(items, ['doc_paths **/*.md', 'doc_paths missing/**']);
  for (const s of skips) assert.match(s.reason, /\S/);
});

// The wiring: run-graph builds the intent sandbox through the module, live-mounts nothing, and puts the contract
// snapshot inside it; new-run grants no document by Read rule; the canary reads a declared document from the sandbox.
// REMOVED (G-22 of 20261001-155615-cgg-review-r3): "run-graph builds the intent sandbox by copying" (G-21).
// It matched source text, so an equivalent rewrite failed it and a broken wiring with the same spelling passed. The
// property is now DRIVEN in regression-cgg-r3-remediation.test.mjs, through a fake runtime passed with --runtime-bin,
// which logs what the node was actually handed.

test('new-run\'s intent policy grants no document and no run directory by Read rule', (t) => {
  const d = repo(t);
  const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: ["docs/*.md", "NOTES.md"]'].join('\n');
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  const r = runScript('new-run.mjs', ['--slug', 'snap', '--repo-root', d, '--no-request', '--no-verify-sandbox', '--full-sweep', 'src'], { cwd: d });
  assert.equal(r.status, 0, r.output);
  const allow = JSON.parse(fs.readFileSync(path.join(mintedRunDir(r.output), 'intent-settings.json'), 'utf8')).permissions.allow;
  assert.deepEqual(allow.filter((a) => /^Read\(/.test(a)), [], `the intent policy still grants by Read rule: ${allow.join(' | ')}`);
});

test('the intent canary reads a declared document from the sandbox the real node gets', () => {
  const s = read('scripts', 'new-run.mjs');
  assert.match(s, /snapshotIntentDocs\(\{/, 'the canary does not build the intent sandbox');   // its owner since G-25
  assert.doesNotMatch(s, /a path-scoped rule does not GRANT a read outside/, 'the misdiagnosis stands uncorrected');
});

test('the intent prompt says where its documents are', () => {
  const p = read('prompts', 'intent-capture', 'PROMPT.md');
  assert.doesNotMatch(p, /your working directory is the run directory/, 'the prompt names the wrong working directory');
  assert.match(p, /contract\.snapshot\.md[^\n]*(sandbox|working directory)/);
});
