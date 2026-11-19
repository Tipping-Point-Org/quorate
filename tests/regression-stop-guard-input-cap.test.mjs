// The stop guard's input is read to a cap (G-16 and G-17 of 20261024-235344-arp-remediation-2-review): readStdin joined
// every chunk with no limit, so a large enough hook payload was buffered whole before it was parsed. Past the cap the
// guard stops reading, says so, and allows the stop, as for any input it cannot use.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'stop-guard.mjs');

test('regression: an input past the cap is not buffered whole, and the stop is allowed', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-cap-'));
  try {
    // Not JSON on purpose, so nothing is recorded whichever way it is read; only the reason differs.
    const r = spawnSync(process.execPath, [GUARD, '--repo-root', repo], { input: 'x'.repeat(9 * 1024 * 1024), encoding: 'utf8' });
    assert.equal(r.status, 0, 'the guard never fails the session');
    assert.equal(r.stdout.trim(), '', 'nothing is blocked');
    assert.match(r.stderr, /larger than/, `the guard reads past its cap: ${r.stderr.slice(0, 200)}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
