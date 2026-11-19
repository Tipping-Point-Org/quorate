// G-16 of 20261029-235315-rdr-remediation-4-review (panel-codex-code, LOW). run-graph read the reconciler's payload.json
// through the run's owner inside `catch { return null; }`, so an ECONFINED refusal (a link standing at the payload) became
// "absent or unreadable" in the gate's diagnostic: the gate still blocked, but the cause it named was the wrong one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adjudicationFloor } from '../scripts/lib/decisions.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-16: a refused payload is named as refused, not as absent', () => {
  const r = adjudicationFloor({ groupCount: 2, reconcileState: 'OK', payloadText: null, payloadRefused: 'a link stands at it' });
  assert.match(r.refused ?? '', /refused/, 'a refused payload is reported as absent or unreadable');
  assert.match(r.refused, /a link stands at it/, 'the refusal reason is dropped');
  assert.match(adjudicationFloor({ groupCount: 2, reconcileState: 'OK', payloadText: null }).refused, /absent or unreadable/);
});

test('G-16: run-graph passes the owner\'s refusal to adjudicationFloor', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const at = src.indexOf('const adjudication = adjudicationFloor(');
  const call = src.slice(src.lastIndexOf('\n\n', at), src.indexOf('});', at));
  assert.match(call, /ECONFINED/, 'the payload read still discards ECONFINED');
  assert.match(call, /payloadRefused/, 'the refusal does not reach adjudicationFloor');
});
