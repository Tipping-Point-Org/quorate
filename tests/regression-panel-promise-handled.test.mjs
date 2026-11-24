// THE PANEL'S PROMISE HAS A HANDLER FROM THE MOMENT IT STARTS (G-26 of 20261121-193516-m3s7-b1-review). run-graph starts
// the external arms' pool and awaits it only after the lens fan-out ends; with no handler attached between, a rejection in
// that window is unhandled, and Node ends the orchestrator before the gate or the later catch runs. A no-op `.catch`
// marks it handled while the later `await panelPromise` still sees the rejection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'scripts', 'run-graph.mjs'), 'utf8');

test('panelPromise is marked handled on the statement after it starts', () => {
  const start = src.indexOf('const panelPromise = runPool(');
  assert.ok(start >= 0, 'panelPromise was not found');
  const next = src.slice(start).split('\n').slice(1).find((l) => l.trim() && !l.trim().startsWith('//'));
  assert.match(next ?? '', /^panelPromise\.catch\(\(\) => \{[^}]*\}\);/, `the next statement is not a handler: ${next}`);
});

test('a promise with a no-op catch still rejects at its await', async () => {
  const p = Promise.reject(new Error('arm'));
  p.catch(() => {});
  await assert.rejects(p, /arm/);
});
