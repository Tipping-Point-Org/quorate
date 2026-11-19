// G-7 of 20261017-031552-ogsc-review: shared/claude-md-contract.md owns the remediation node's payload shape, and it
// still listed the shape from before the census (observation-guard-and-sibling-census.md, B): the schema in
// scripts/spawn-node.mjs required search_sites, not_in_class and unmatched_spellings, and the owner named none of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const FIELDS = ['search_sites', 'not_in_class', 'unmatched_spellings'];

test('G-7: the owning contract documents every census field the remediation schema requires', () => {
  const row = SRC('shared/claude-md-contract.md').split('\n').find((l) => l.startsWith('| `remediation/PROMPT.md` |')) ?? '';
  assert.ok(row, 'the remediation node has no row in the contract');
  for (const f of FIELDS) assert.ok(row.includes(f), `the contract's remediation payload omits ${f}`);
  assert.match(row, /evidence\/remediation-census\/payload\.json/, 'where the follow-up review reads the census is not said');
});

// G-6 of 20261017-040138-ogsc-remediation-review: the row named scripts/lib/remediation-chain.mjs as the one definition
// of CENSUS_FIELDS after 900c7ea2 moved it to a leaf module, so a maintainer was sent to a file that has none.
test('G-6: the file the contract names as the owner of CENSUS_FIELDS is the one that defines it', () => {
  const row = SRC('shared/claude-md-contract.md').split('\n').find((l) => l.startsWith('| `remediation/PROMPT.md` |')) ?? '';
  const named = row.match(/`CENSUS_FIELDS` in `([^`]+)`/)?.[1];
  assert.ok(named, 'the contract does not name where CENSUS_FIELDS is defined');
  assert.ok(/^export const CENSUS_FIELDS\b/m.test(SRC(named)), `${named} does not define CENSUS_FIELDS`);
});
