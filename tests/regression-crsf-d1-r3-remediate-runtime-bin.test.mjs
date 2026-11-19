// G-10 of 20261105-181450-crsf-d1-remediation-2-review: remediate.mjs stored the generic node-runtime override as
// `claudeBin` and passed it on as `args.claudeBin`, so the orchestration named one vendor (ARCHITECTURE.md §4). Only the
// legacy flag kept that spelling until 2026-11-11 (operator: "A. Rename, keep an alias (Recommended)"): remediate.mjs now
// reads --runtime-bin through the pair's one owner and forwards it in the new spelling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'remediate.mjs'), 'utf8');

test('G-10: remediate.mjs names the runtime override runtimeBin, and no vendor-named spelling of it', () => {
  // The old name built at run time, so the census of old spellings (regression-runtime-bin-rename) still holds this file.
  assert.doesNotMatch(SRC, new RegExp(['claude', 'Bin'].join('')), 'the runtime override is still named after one vendor');
  assert.match(SRC, /args\.runtimeBin = runtimeBinArg\(v\)/, 'the flag is not read through its one owner');
  assert.match(SRC, /\.\.\.runtimeBinArgv\(args\.runtimeBin\)/, 'the override is not forwarded in the new spelling');
});
