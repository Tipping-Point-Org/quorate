// The runner admits a group's red and green only from a test file that group lists in its own `files`
// (lib/remediation-chain.mjs, evidenceProblem: "<file> is not a test file this group commits"), and it refuses every
// group sharing a cluster with one it does not commit (admitGroups). The node's prompt stated neither. Two remediations
// in a row committed nothing because of it (20261025-003016-arp-remediation-3: G-14, G-11, G-16; 20261025-005844-
// arp-remediation-3b: G-12, G-14, G-16, G-19 each ran its red against a test file it did not list), and four this week
// lost a fixed cluster to a declined or not-fixed group placed in it (rdt-remediation-3 c4, arp-remediation-2 c2,
// arp-remediation-3, -3b). The prompt is where the node learns the rules, so both are held there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prompt = fs.readFileSync(path.join(ROOT, 'prompts', 'remediation', 'PROMPT.md'), 'utf8').replace(/\s+/g, ' ');

test('regression: the prompt says a red and its green run a test file the group lists in its files', () => {
  assert.match(prompt, /red and (its|the) green .{0,80}test file .{0,60}(this|the) group lists in its `files`/i);
  assert.match(prompt, /not a test file this group commits/, 'the prompt names the refusal the node will see');
});

test('regression: the prompt says a group that is not fixed takes a cluster of its own', () => {
  assert.match(prompt, /(declined|not fixed|not-fixed).{0,120}cluster of its own/i);
});
