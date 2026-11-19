// Remediation of review 20260929-195848-ssr-review-r7 (operator, 2026-09-29: "1 fix, 2 as suggested, 3 yes").
// G-6: every refusal is visible in stdout AND the result file (the run's intent, I-7). The end-of-run summary printed
// refusals only for NOT RUN seeds, so a scored seed's node refusals reached the result file and stderr but never
// stdout. The same gap was in bench-lenses, outside that review's scope, so both use one helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as artifacts from '../scripts/lib/run-artifacts.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const src = (f) => fs.readFileSync(path.join(REPO, 'scripts', f), 'utf8');

test('G-6: refusalLines names every seed\'s refusals — scored and NOT RUN alike — once each', () => {
  assert.equal(typeof artifacts.refusalLines, 'function', 'there is no one owner of the end-of-run refusal summary');
  const lines = artifacts.refusalLines([
    { seed: 'scored-seed', refused: { 'nodes/code-audit.status.json': 'records a node_id other than "code-audit"' } },
    { seed: 'clean-seed', refused: {} },
    { seed: 'not-run-seed', reason: 'run.json refused', refused: { 'run.json': 'run.json does not exist' } },
    { seed: 'scored-seed', refused: { 'nodes/code-audit.status.json': 'records a node_id other than "code-audit"' } },
    { seed: 'no-field' },
  ]);
  assert.equal(lines.length, 2, `one line per distinct refusal: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.includes('scored-seed') && l.includes('nodes/code-audit.status.json') && l.includes('node_id')), 'a scored seed\'s refusal is missing');
  assert.ok(lines.some((l) => l.includes('not-run-seed') && l.includes('run.json')), 'a NOT RUN seed\'s refusal is missing');
});

test('G-6: every end-of-run summary in bench-second-opinion prints the refusals, beside its NOT RUN lines', () => {
  const s = src('bench-second-opinion.mjs');
  const sites = [...s.matchAll(/for \(const n of notRun\) console\.log\(`   NOT RUN/g)].map((m) => m.index);
  assert.equal(sites.length, 3, 'expected the dry-run, forge-only and full summaries');
  for (const i of sites) {
    assert.match(s.slice(i, i + 400), /refusalLines\(\[\.\.\.perSeed, \.\.\.notRun\]\)/, `the summary at offset ${i} does not print the refusals of scored seeds`);
  }
});

test('G-6: bench-lenses\' closing summary prints every seed\'s refusals — scored, unscored spend and NOT RUN', () => {
  const s = src('bench-lenses.mjs');
  const end = s.slice(s.indexOf("console.log(`\\nbench-lenses: "));
  assert.match(end, /refusalLines\(\[\.\.\.perSeedRuns, \.\.\.unscoredSpend, \.\.\.notRun\]\)/, 'bench-lenses prints no refusal for a scored seed');
});
