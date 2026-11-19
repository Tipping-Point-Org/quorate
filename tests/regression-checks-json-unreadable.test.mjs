// G-10 of 20261024-032927-rrs-remediation-review: the gate read checks.json's results inside `try { ... } catch
// { return []; }`, so a corrupt or unreadable checks.json read as "no results" and the gate dropped its disclosures of
// checks that did not run to their end, with nothing said. An absent file is a pre-flight that wrote none; a file that
// is present and cannot be read is a gap, and is named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../scripts/lib/preflight-cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-10: a corrupt checks.json is named, not read as no results', () => {
  assert.equal(typeof lib.checksResults, 'function', 'one pure owner decides what checks.json\'s text yields');
  const bad = lib.checksResults('{ not json');
  assert.deepEqual(bad.results, []);
  assert.match(bad.error ?? '', /checks\.json/, 'the unreadable file is reported');
  const absent = lib.checksResults(null);
  assert.deepEqual({ results: absent.results, error: absent.error }, { results: [], error: null }, 'an absent file is no results, no gap');
  const ok = lib.checksResults(JSON.stringify({ results: [{ check: 'test', outcome: 'timeout' }] }));
  assert.equal(ok.error, null);
  assert.equal(ok.results.length, 1);
  const src = fs.readFileSync(path.join(root, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.doesNotMatch(src, /checks\.json'\), 'utf8'\)\)\.results \?\? \[\]; \} catch \{ return \[\]; \}/,
    'run-graph no longer swallows the read');
});
