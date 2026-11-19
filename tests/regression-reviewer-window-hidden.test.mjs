// external-review.mjs spawns the external reviewer (codex, agy) with `spawnOpts`, and those options did not set
// `windowsHide`. Node's default is false, so on Windows each reviewer call could open a console window of its own: the
// operator saw agy's window appear on the desk during a request critique (2026-10-24, "why are you runnign agy in a
// window?"). The reviewer probe (io/reviewer-probe.mjs) already passed `windowsHide: true`; the call that does the
// actual review did not.
//
// Tested by shape, because the spawn needs a live reviewer CLI that the offline suite never invokes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'external-review.mjs'), 'utf8');

test('regression: the external reviewer is spawned with its window hidden', () => {
  const m = SRC.match(/const spawnOpts = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'the reviewer spawn options (const spawnOpts = { ... }) were not found; update this test with the code');
  assert.match(m[1], /windowsHide:\s*true/, 'spawnOpts must set windowsHide: true, or Windows opens a console per reviewer call');
  // Every reviewer call goes through those options: since stop-owner-grep-state-roots.plan.md stage 1 the three calls are
  // `r = await capture(...)`, and capture spawns with spawnOpts less Node's own timeout, encoding and buffer.
  const calls = SRC.match(/r = await capture\([^\n]*/g) ?? [];
  assert.ok(calls.length >= 3, `expected the three reviewer calls, found ${calls.length}`);
  const capture = SRC.match(/const capture = \([^\n]*\n[^\n]*/);
  assert.ok(capture, 'the reviewer call (const capture = ...) was not found; update this test with the code');
  assert.match(capture[0], /captureOpts/, 'the reviewer call does not spawn with the reviewer spawn options');
  assert.match(SRC, /const \{ timeout: _t, encoding: _e, maxBuffer: _m, \.\.\.captureOpts \} = spawnOpts;/);
});
