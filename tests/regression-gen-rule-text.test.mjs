// regression-gen-rule-text.test.mjs — code-index-d1-part-a.plan.md stage 4 (design note A-D4′, Verification 4).
//
// The degraded-cap rule had dozens of statements and no owner, and each review round fixed one copy (G-5, G-11, G-17 of
// the ciss-d1 reviews). Its sentence now lives once, in prompts/_templates/rule-degraded-cap.md, and reaches a document as
// a marked region that scripts/gen-rule-text.mjs writes; --check names a stale region and a restatement outside one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript } from './helpers.mjs';
import { regionsIn, regenerate, restatementsIn, expectedBody, syntaxFor, RULES } from '../scripts/lib/rule-text.mjs';
import { readTemplate } from '../scripts/io/template.mjs';

const templates = { 'rule-degraded-cap.md': readTemplate('rule-degraded-cap.md') };
const OPEN = '<!-- rule:degraded-cap subject="`arch-review`, degraded" verdict_ceiling="RISK" severity_ceiling="MEDIUM" -->';
const CLOSE = '<!-- /rule:degraded-cap -->';
const fresh = () => expectedBody({ id: 'degraded-cap', inline: true, args: { subject: '`arch-review`, degraded', verdict_ceiling: 'RISK', severity_ceiling: 'MEDIUM' } }, templates);

test('the sentence states the cap and its exception, filled from the region\'s slots', () => {
  const s = fresh();
  assert.match(s, /^`arch-review`, degraded: its verdict is capped at `RISK` and its findings at `MEDIUM` — except a §6 invariant/);
  assert.throws(() => expectedBody({ id: 'degraded-cap', inline: true, args: { subject: 'x' } }, templates), /no value for/,
    'a region missing a slot renders nothing rather than a blank');
  assert.throws(() => expectedBody({ id: 'no-such-rule', inline: true, args: {} }, templates), /no rule is registered/);
});

test('regions are found inline and on their own lines, in Markdown, JavaScript and Python', () => {
  assert.equal(regionsIn(`a ${OPEN}old${CLOSE} b`, 'x.md')[0].body, 'old');
  const block = regionsIn(`x\n${OPEN}\nold line\n${CLOSE}\n`, 'x.md')[0];
  assert.equal(block.inline, false);
  assert.equal(block.body, 'old line\n');
  assert.equal(regionsIn('// rule:minutes-table\nconst a = 1;\n// /rule:minutes-table\n', 'x.mjs')[0].body, 'const a = 1;\n');
  assert.equal(regionsIn('# rule:minutes-table\nA = 1\n# /rule:minutes-table\n', 'x.py')[0].body, 'A = 1\n');
  assert.equal(syntaxFor('x.json'), null, 'JSON has no comments, so no region lives in it');
  assert.throws(() => regionsIn(`${OPEN}never closed`, 'x.md'), /opened and never closed/);
});

test('regenerate rewrites a stale region, leaves a fresh one, and names what it changed', () => {
  const text = `stale ${OPEN}old words${CLOSE}\nfresh ${OPEN}${fresh()}${CLOSE}\n`;
  const r = regenerate(text, 'x.md', templates);
  assert.deepEqual(r.stale.map((s) => s.line), [1]);
  assert.equal(regenerate(r.text, 'x.md', templates).stale.length, 0, 'a second pass finds nothing to rewrite');
});

test('a restatement outside a region is found; inside one, or carrying the exception, it is not', () => {
  const text = [
    'arch-review then cannot `FAIL`.',
    `ok ${OPEN}${fresh()}${CLOSE}`,
    'it is capped at `RISK`, except a §6 invariant, which is never capped.',
  ].join('\n');
  assert.deepEqual(restatementsIn(text, 'x.md').map((r) => r.line), [1]);
  assert.ok(RULES['degraded-cap'].restates.length >= 4, 'the phrase list is the test\'s seed and must not empty out');
});

test('--check over a fixture tree names the stale region and the restatement, and passes the fresh region', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-gen-rule-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]',
    'doc_paths: ["docs/**"]', 'test_globs: ["tests/**"]'].join('\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'docs', 'stale.md'), `${OPEN}old words${CLOSE}\n`);
  fs.writeFileSync(path.join(dir, 'docs', 'fresh.md'), `${OPEN}${fresh()}${CLOSE}\n`);
  fs.writeFileSync(path.join(dir, 'docs', 'restates.md'), 'A degraded lens cannot `FAIL`.\n');
  fs.writeFileSync(path.join(dir, 'tests', 'quotes.md'), 'A degraded lens cannot `FAIL`.\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });

  const check = runScript('gen-rule-text.mjs', ['--check', '--root', dir], { cwd: dir });
  assert.equal(check.status, 1, check.output);
  assert.match(check.output, /docs\/stale\.md:1: rule:degraded-cap differs/);
  assert.match(check.output, /docs\/restates\.md:1: restates rule:degraded-cap/);
  assert.doesNotMatch(check.output, /docs\/fresh\.md/);
  assert.doesNotMatch(check.output, /tests\/quotes\.md/, 'a test file quotes a phrase to pin it; test_globs are not scanned');

  const write = runScript('gen-rule-text.mjs', ['--root', dir], { cwd: dir });
  assert.equal(write.status, 0, write.output);
  assert.equal(fs.readFileSync(path.join(dir, 'docs', 'stale.md'), 'utf8'), `${OPEN}${fresh()}${CLOSE}\n`);
  const again = runScript('gen-rule-text.mjs', ['--check', '--root', dir], { cwd: dir });
  assert.doesNotMatch(again.output, /differs/);
});
