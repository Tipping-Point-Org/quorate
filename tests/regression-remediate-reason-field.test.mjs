// THE REMEDIATION RUNNER READS THE STOP REASON FROM THE ADAPTER'S FIELD (G-19 of 20261121-193516-m3s7-b1-review). The
// runner held a node's `limit` claim to the runtime's terminal reason by reading the literal `.terminal_reason` from the
// node's stdout envelope, while the field is the runtime adapter's `node_runtime.exit.reason_field` (ARCHITECTURE.md A-9;
// spawn-node reads it through nodeExitMapping). On a runtime whose field is spelled otherwise the reason was recorded as
// null and a true `limit: turns` claim was refused. This holds the read site to the one accessor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeExitMapping } from '../scripts/lib/decisions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'scripts', 'remediate.mjs'), 'utf8');

test('the runner does not read a literal .terminal_reason from the envelope', () => {
  assert.doesNotMatch(src, /\)\)\.terminal_reason\b/, 'the envelope field is read by its literal name');
});

test('the runner reads the reason through nodeExitMapping of the run\'s runtime adapter', () => {
  assert.match(src, /import \{[^}]*\bnodeExitMapping\b[^}]*\} from '\.\/lib\/decisions\.mjs';/);
  assert.match(src, /nodeExitMapping\(nodeRuntimeAdapter\(\)\)\.reasonField/);
  assert.match(src, /nodeRecord\.terminal_reason = reasonField \? \(envelope\?\.\[reasonField\] \?\? null\) : null;/);
});

test('the accessor answers a renamed field, which a literal read would miss', () => {
  const rt = { node_runtime: { exit: { reason_field: 'stop_cause' } } };
  assert.equal(nodeExitMapping(rt).reasonField, 'stop_cause');
});
