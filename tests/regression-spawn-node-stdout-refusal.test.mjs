// G-18 of 20261029-235315-rdr-remediation-4-review (panel-codex-docs, MEDIUM). spawn-node read the node's stdout.json
// through the run's owner inside a bare `catch {}`, whose comment said a refused read is recorded as no-output: an
// ECONFINED refusal (a link standing at the output) was reported as a node that wrote nothing. The brief read in the same
// file already told the two apart. The read is a step inside a live node spawn, so its shape is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');

test('G-18: a refused stdout.json read is named, not recorded as no output', () => {
  const at = src.indexOf("owner.read(['evidence', nodeId, 'stdout.json']");
  assert.ok(at >= 0, 'the stdout.json read was not found');
  const line = src.slice(src.lastIndexOf('\n', at), src.indexOf('\n', at));
  assert.doesNotMatch(line, /catch\s*\{/, 'the stdout.json read swallows every error, a refusal included');
  const after = src.slice(at, at + 1200);
  assert.match(after, /ECONFINED/, 'a refusal is not told apart from a missing file');
  assert.match(after, /validator_errors\.push\([^)]*refused/, 'a refused output is not recorded in the status');
});
