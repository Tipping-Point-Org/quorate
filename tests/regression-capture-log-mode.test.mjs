// CAPTURE'S RAW LOGS ARE CREATED OWNER-ONLY (G-6 of 20261121-193516-m3s7-b1-review). capture.mjs created each log with
// owner.create(...) and no mode, so the file took the default 0666 less umask: on POSIX commonly 0644, readable by every
// local user, while it holds the output of commands run with the operator's credentials. io/capture-interactive.mjs and
// io/stdin-file.mjs already pass 0o600; the plain capture did not. The mode is held at the call, which is what every
// platform can check (win32 has no POSIX modes to read back).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('capture.mjs creates its log with an explicit owner-only mode', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'capture.mjs'), 'utf8');
  const call = src.match(/owner\.create\(\['evidence', opts\.node, logName\],[^\n]*/);
  assert.ok(call, 'the log create call was not found');
  assert.match(call[0], /\{ mode: 0o600 \}\);/, `the log is created without an owner-only mode: ${call[0]}`);
});
