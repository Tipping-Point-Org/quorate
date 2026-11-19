// G-9 of 20261022-025041-cid1a-remediation-review: mint validated only the adapters the contract declares, so a built-in
// adapter's malformed probe_timeout_minutes (in a working tree or an engine mount whose reviewers.json was edited) was
// refused only at the reviewer's call. Mint validates every adapter in the merged table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('mint runs adapterErrors over every adapter in the merged table, built-ins included', () => {
  const src = fs.readFileSync(new URL('../scripts/new-run.mjs', import.meta.url), 'utf8');
  assert.match(src, /Object\.entries\(RUNTIME_TABLE\)\.flatMap\(\(\[name, a\]\) => adapterErrors\(name, a\)\)/,
    'mint validates only the declared adapters');
});
