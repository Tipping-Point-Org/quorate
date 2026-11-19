// decision-records.plan.md stage 2 (and stage 1's verification): `review.grounding_floor`, the floor of ARCHITECTURE.md
// A-22, is one of the basis values whose one owner is disk-first-protocol §4, held as the enum of scripts/verdict.schema.json.
// Absent, it is `measurement` (the operator's ruling of 2026-09-13). The reader takes the value set from that owner, never
// a copy, and the architecture's statement of the default and the reader's agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { groundingFloorOf, GROUNDING_FLOOR_DEFAULT } from '../scripts/lib/autonomous-keys.mjs';
import { basisValues } from '../scripts/io/basis-values.mjs';

const BASES = basisValues();

test('the basis values come from the verdict schema, the machine copy of disk-first §4', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'verdict.schema.json'), 'utf8'));
  const found = JSON.stringify(schema).match(/"enum":\["intent"[^\]]*\]/);
  assert.ok(found, 'the schema carries the basis enum');
  assert.deepEqual(BASES, JSON.parse(found[0].slice('"enum":'.length)));
  assert.ok(BASES.includes('measurement') && BASES.includes('convention'));
});

test('review.grounding_floor: absent is measurement, any basis value is accepted, anything else is refused', () => {
  assert.equal(GROUNDING_FLOOR_DEFAULT, 'measurement');
  assert.equal(groundingFloorOf({}, BASES), 'measurement');
  assert.equal(groundingFloorOf(undefined, BASES), 'measurement');
  for (const b of BASES) assert.equal(groundingFloorOf({ grounding_floor: b }, BASES), b);
  for (const bad of ['executed', '', 'MEASUREMENT', 3, null]) {
    assert.throws(() => groundingFloorOf({ grounding_floor: bad }, BASES), /grounding_floor/, JSON.stringify(bad));
  }
  assert.throws(() => groundingFloorOf({}, []), /basis values/, 'a missing value set is refused, never guessed');
});

test('ARCHITECTURE.md §7, the contract doc and this repository\'s contract state the same default', () => {
  const arch = fs.readFileSync(path.join(REPO_ROOT, 'ARCHITECTURE.md'), 'utf8');
  assert.match(arch, /`review\.grounding_floor` takes one of §4's basis values; absent, it is `measurement`/);
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  assert.match(doc, /\*\*`grounding_floor`[^\n]*/);
  assert.match(doc, /grounding_floor[\s\S]{0,600}\*\*Absent means\s+`measurement`\*\*/);
  const mine = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(mine, /^\s+grounding_floor: measurement\b/m);
});
