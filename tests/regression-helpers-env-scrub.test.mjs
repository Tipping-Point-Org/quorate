// G-37 of 20261122-232627-m3s7-b4-review (I-22 of m3-stage7-fixes.md): runScript spread the developer's whole environment
// into every child script and cleared only GRAPH_NODE_DEPTH and QUORATE_RUN_ID, so under a direct `node --test` run
// ANTHROPIC_API_KEY and every other secret-shaped variable reached the scripts under test, against the helper's own
// comment. The test runs a real child through runScript and reads the environment it was given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';

test('runScript gives a child script no inherited secret-shaped variable or runtime auth; a caller\'s own env still wins', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-helpers-env-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'print-env.mjs');
  fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(Object.keys(process.env).map((k) => k.toUpperCase())));\n');
  const planted = { ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 'b', GITHUB_TOKEN: 'ghp', DB_PASSWORD: 'p' };
  const saved = {};
  for (const [k, v] of Object.entries(planted)) { saved[k] = process.env[k]; process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  // An absolute path, not one relative to scripts/: on a Windows runner the temporary directory is on C: and the checkout
  // on D:, and path.relative across drives is absolute (CI run 45109110896).
  // The value through a call, not a literal (operator, 2026-11-19: "Build the fakes at runtime (Recommended)"): a
  // credential-shaped name followed by a literal is what the public CI's secret scan flags, whatever the value is.
  const r = runScript(script, [], { env: { CALLER_TOKEN: String('mine') } });
  assert.equal(r.status, 0, r.stderr);
  const keys = new Set(JSON.parse(r.stdout));
  for (const k of Object.keys(planted)) assert.equal(keys.has(k), false, `${k} reached the child script`);
  assert.ok(keys.has('CALLER_TOKEN'), 'a variable the caller passed was dropped');
  assert.ok(keys.has('QUORATE_HOME'), 'the suite home was lost');
});
