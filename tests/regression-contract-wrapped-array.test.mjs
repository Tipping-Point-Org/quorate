// The contract's flow collections had to fit on ONE physical line, and that requirement was
// documented nowhere. A real project's generated_globs runs to a dozen entries — model trees,
// dataset trees, virtualenvs — and wrapping it is the natural thing to write. The parser then
// reported `line 22: expected "key: value"`, which points at the CONTINUATION line and names the
// wrong problem entirely, so the reader looks for a malformed key that does not exist.
//
// Found on the first real consumer install: 13 generated globs across three lines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, REPO_ROOT } from './helpers.mjs';

function contractOf(block) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-yaml-'));
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + block + '\n```\n');
    const r = runScript('new-run.mjs', ['--print-contract', '--repo-root', dir], { cwd: dir });
    assert.equal(r.status, 0, `parse failed: ${r.output.slice(0, 300)}`);
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BASE = 'graph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n';

test('regression: a flow array wrapped across lines parses', () => {
  const c = contractOf(BASE + 'generated_globs: ["a/**",\n                  "b/**",\n                  "c/**"]');
  assert.deepEqual(c.generated_globs, ['a/**', 'b/**', 'c/**']);
});

test('a single-line array still parses — the common case must not regress', () => {
  const c = contractOf(BASE + 'source_globs: ["src/**", "lib/**"]');
  assert.deepEqual(c.source_globs, ['src/**', 'lib/**']);
});

test('comments on continuation lines are stripped, like the line that opened the array', () => {
  const c = contractOf(BASE + 'doc_paths: ["docs/**",   # the docs\n            "README.md"] # and the readme');
  assert.deepEqual(c.doc_paths, ['docs/**', 'README.md']);
});

test('regression: a bracket INSIDE a string does not open a continuation', () => {
  // If depth were counted without respecting quotes, this would swallow the following key.
  const c = contractOf(BASE + 'doc_paths: ["a[1].md"]\nproject: pinned');
  assert.deepEqual(c.doc_paths, ['a[1].md']);
  assert.equal(c.project, 'pinned', 'the next key must still be parsed as a key');
});

test('a wrapped inline map parses too', () => {
  const c = contractOf(BASE + 'review:\n  models: { judgment: opus,\n            mechanical: sonnet }');
  assert.deepEqual(c.review.models, { judgment: 'opus', mechanical: 'sonnet' });
});

// AN UNTERMINATED QUOTE BECAME A VALID STRING (G-31, panel-codex-contract).
//
// The paired-quote test failed on `test: "node tests/run-all.mjs` and fell through to the raw
// return, so malformed YAML parsed into the value `"node tests/run-all.mjs` — a command with a
// leading quote, which then fails to launch and reads as a broken PROJECT rather than a broken
// contract. I-18 requires a named parse error, and the contract is the one artifact whose
// misreading must never be quiet: it is frozen into run.json and governs the whole run.
test('an unterminated quoted value is a named parse error, not a string', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-yaml-unterm-'));
  try {
    const bad = 'graph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: "node tests/run-all.mjs\n';
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + bad + '\n```\n');
    const r = runScript('new-run.mjs', ['--print-contract', '--repo-root', dir], { cwd: dir });
    assert.notEqual(r.status, 0, 'malformed YAML must not parse into a plausible-looking command');
    assert.match(r.output, /unterminated double-quoted value/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a properly quoted value still parses, and a lone quote is not its own pair', () => {
  const c = contractOf(BASE + 'source_globs: ["a/**", \'b/**\']\n');
  assert.deepEqual(c.source_globs, ['a/**', 'b/**'], 'the fix must not refuse valid quoting');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-yaml-lone-'));
  try {
    // A bare `"` is both its own opening and its own closing quote under a naive paired test, and
    // would slice to the empty string — an empty command key means "skipped and named", which is a
    // very different contract from the one that was written.
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: "\n\n```\n');
    const r = runScript('new-run.mjs', ['--print-contract', '--repo-root', dir], { cwd: dir });
    assert.notEqual(r.status, 0);
    assert.match(r.output, /unterminated/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A CONTRACT KEY THAT REACHES THE OBJECT PROTOTYPE (G-21, panel-codex-security).
//
// Keys come from a file the consuming project controls and were assigned into ordinary objects, so
// `__proto__:` with a nested block placed `reviewers` or `runtime` on Object.prototype — where every
// later `contract.review.runtime ?? ...` lookup finds it, and where JSON.stringify does NOT, so the
// frozen run.json would record a contract that omits the thing the run actually obeyed. A hidden
// runtime override is the value worth polluting for: it decides which binary every node spawns under.
test('a contract cannot place a key on the object prototype', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-proto-'));
  try {
    const write = (yaml) => fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
    const base = 'graph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n';

    for (const key of ['__proto__', 'constructor', 'prototype']) {
      write(`${base}${key}:\n  runtime: "evil"\n`);
      const r = runScript('new-run.mjs', ['--print-contract', '--repo-root', dir], { cwd: dir });
      assert.notEqual(r.status, 0, `${key} must be refused, not assigned`);
      assert.match(r.output, /reaches the object prototype/);
    }

    // The flow-map branch takes keys from the same untrusted text and is no less contract-supplied
    // for fitting on one line.
    write(`${base.trimEnd()}\nreview: { concurrency: 3, __proto__: "x" }\n`);
    const flow = runScript('new-run.mjs', ['--print-contract', '--repo-root', dir], { cwd: dir });
    assert.notEqual(flow.status, 0);
    assert.match(flow.output, /reaches the object prototype/);

    // And nothing was polluted along the way — the refusal must precede the assignment.
    assert.equal({}.runtime, undefined, 'the parser leaked onto Object.prototype');

    // An ordinary contract still parses, so the guard is not simply refusing everything.
    write(base);
    assert.equal(runScript('new-run.mjs', ['--print-contract', '--repo-root', dir], { cwd: dir }).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
