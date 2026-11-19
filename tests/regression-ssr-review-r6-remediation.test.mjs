// Remediation of review 20260929-185355-ssr-review-r6 (operator, 2026-09-29: "1 fix, 2 A, 3 as suggested, 4 as
// suggested"). Fixed: G-4 (the dry run counted a seed ready before its checks ran), G-5 (the forge-only record carried
// no refusals; option A: every seed record carries them), and G-7 pulled forward (the refusal test was satisfied by
// any ONE record, which is how G-5 got through).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const src = () => fs.readFileSync(path.join(REPO, 'scripts', 'bench-second-opinion.mjs'), 'utf8');

// Each `perSeed.push({ ... })` object literal, as text, found by balancing its braces.
function seedRecords(s) {
  const out = [];
  for (let i = s.indexOf('perSeed.push({'); i >= 0; i = s.indexOf('perSeed.push({', i + 1)) {
    let depth = 0; let j = s.indexOf('{', i);
    for (; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) break; }
    out.push({ line: s.slice(0, i).split('\n').length, text: s.slice(i, j + 1) });
  }
  return out;
}

// G-7: EVERY record, not any one — the old test matched a single push, so a second push without the field passed.
test('G-7, G-5: every seed record bench-second-opinion writes carries the seed\'s refusals', () => {
  const records = seedRecords(src());
  assert.ok(records.length >= 3, `expected the dry-run, forge-only and full records, found ${records.length}`);
  const missing = records.filter((r) => !/\brefused\s*:/.test(r.text)).map((r) => `bench-second-opinion.mjs:${r.line}`);
  assert.deepEqual(missing, [], 'a seed record written without its refusals');
});

// G-4: a seed is counted ready only once every dry-run check has passed — the capture probe is the last of them.
test('G-4: the dry run counts a seed as ready only after its checks pass', () => {
  const s = src();
  const probe = s.indexOf("capture reached its allow-list in this run dir");
  const row = s.indexOf("rows.push({ seed: c.seed, mutated: 'dry-run'");
  assert.ok(probe > 0 && row > 0, 'the probe or the dry-run row was not found');
  assert.ok(row > probe, 'the dry-run row is pushed before the placement and capture checks');
});
