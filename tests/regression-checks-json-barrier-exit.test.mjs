// G-6 and G-3 of 20261024-041845-rrs-remediation-2-review. The pre-flight failure exit in run-graph read checks.json
// inside a bare `catch {}` of its own, so a corrupt or unreadable file there dropped the gate's disclosure of unfinished
// checks with nothing said, and the parsing rule had two copies (checksResults was the gate-time one). And checksResults
// read a present file whose `results` was missing or null as an empty valid list (`?? []`): every writer records
// `results`, so that shape is malformed, not "no checks".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../scripts/lib/preflight-cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-3: a present checks.json with no results list is an error, not an empty one', () => {
  for (const text of ['{}', '{"results":null}', 'null']) {
    const r = lib.checksResults(text);
    assert.deepEqual(r.results, [], text);
    assert.match(r.error ?? '', /checks\.json/, `${text} is named as malformed`);
  }
  assert.deepEqual(lib.checksResults(JSON.stringify({ results: [] })).error, null, 'an empty list that was written is fine');
});

test('G-6: checksResults also yields the failed barrier, so the failure exit needs no parser of its own', () => {
  const r = lib.checksResults(JSON.stringify({ barrier_failed: 'build', results: [{ check: 'build', outcome: 'timeout' }] }));
  assert.equal(r.barrier_failed, 'build');
  assert.equal(lib.checksResults(null).barrier_failed, null);
});

test('G-6: the pre-flight failure exit reads checks.json through the one owner and names a read error', () => {
  const src = fs.readFileSync(path.join(root, 'scripts', 'run-graph.mjs'), 'utf8');
  const start = src.indexOf('if (r.status === 1) {');
  assert.ok(start > 0, 'the barrier-failure exit is found');
  const exit = src.slice(start, src.indexOf('process.exit(1);', start));
  assert.doesNotMatch(exit, /JSON\.parse\(/, 'no second parser of checks.json on the failure exit');
  assert.doesNotMatch(exit, /catch \{/, 'no swallowed read on the failure exit');
  assert.match(exit, /readChecksJson\(\)/, 'the shared reader is used');
  assert.match(exit, /\.error\b/, 'its error reaches not_checked[]');
});
