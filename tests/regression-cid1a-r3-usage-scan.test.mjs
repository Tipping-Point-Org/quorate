// G-7 of 20261022-034225-cid1a-remediation-2-review: usageFrom split the reviewer's whole buffered output into an array of
// lines before scanning for usage events, a second copy proportional to the output. Not measurable without a bench
// (commands.bench is empty), so the before-state is the code itself; the behaviour is pinned beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { usageFrom } from '../scripts/lib/reviewers.mjs';

const ADAPTER = { usage: { from: 'json-events', event: 'turn.completed', field: 'usage' } };

test('usageFrom scans the output in place, without splitting it into lines', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/lib/reviewers.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export function usageFrom'), src.indexOf('\n}\n', src.indexOf('export function usageFrom')));
  assert.doesNotMatch(body, /raw\.split\(/);
});

test('usageFrom still takes the last matching event, across CRLF, partial lines and no trailing newline', () => {
  const ev = (n) => JSON.stringify({ type: 'turn.completed', usage: { input_tokens: n } });
  assert.deepEqual(usageFrom(ADAPTER, `${ev(1)}\r\n{"type":"x"}\n{partial\n  ${ev(2)}`), { input_tokens: 2 });
  assert.deepEqual(usageFrom(ADAPTER, `${ev(3)}\n\n`), { input_tokens: 3 });
  assert.equal(usageFrom(ADAPTER, ''), null);
  assert.equal(usageFrom(ADAPTER, '{"type":"turn.completed"}'), null);
});
