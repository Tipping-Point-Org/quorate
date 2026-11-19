// G-13 of 20261105-181450-crsf-d1-remediation-2-review: spawn-node's freshness stat of a finding's evidence swallowed
// every error, so evidence that vanished or could not be read after the ownership check was accepted with its freshness
// never established. A failed stat now refuses the finding, naming the error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'spawn-node.mjs'), 'utf8');

test('G-13: a freshness stat that fails refuses the finding', () => {
  const at = SRC.indexOf('mtime = owner.stat(belowRun(evAbs)).mtimeMs;');
  assert.ok(at > 0, 'the freshness stat is still there');
  const line = SRC.slice(at, SRC.indexOf('\n', at));
  assert.doesNotMatch(line, /catch \{/, 'the stat\'s error is not discarded');
  assert.match(line, /catch \(e\) \{ why\.push\(/, 'the stat\'s error refuses the finding');
});
