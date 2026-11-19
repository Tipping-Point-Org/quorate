// G-4 and G-5 of 20261104-171128-epo-remediation-3-review.
// G-4: runtimeCall, the panel's generic node-runtime seam, emitted spawn-subagent's provider-named `--claude-bin` flag,
// so this layer knew a vendor-named downstream interface (ARCHITECTURE A-9). It emits the runtime-neutral
// `--runtime-bin`, which spawn-subagent accepts beside the old spelling.
// G-5: isCapturedArtifact accepted a raw spelling and normalized it itself, a second intake beside the declared one
// (rootEvidencePath at the question's and the answer's intake). It takes the owner's result only and refuses a string.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runtimeCall, isCapturedArtifact } from '../scripts/lib/decision-panel.mjs';
import { RUNTIME_BIN_ALIAS } from '../scripts/lib/argv-specs.mjs';
import { rootEvidencePath } from '../scripts/lib/evidence-path.mjs';

const REPO = path.resolve(os.tmpdir(), 'epo4-repo');
const SURFACE = path.resolve(os.tmpdir(), 'epo4-surface');

test('G-4: runtimeCall names no provider in the argv it builds', () => {
  const { argv } = runtimeCall({ scripts: '/s', promptFile: 'p', out: 'o', result: 'r', repoRoot: REPO, surface: SURFACE, runtimeBin: 'fake.mjs' });
  assert.ok(!argv.includes(`--${RUNTIME_BIN_ALIAS}`), `the generic seam emits a provider-named flag: ${argv.join(' ')}`);
  assert.equal(argv[argv.indexOf('--runtime-bin') + 1], 'fake.mjs');
});

test('G-4: spawn-subagent accepts the runtime-neutral flag the seam emits', () => {
  const src = fs.readFileSync(new URL('../scripts/spawn-subagent.mjs', import.meta.url), 'utf8');
  // Through the pair's one owner since 2026-11-11 (lib/argv-specs.mjs RUNTIME_BIN, io/runtime-bin.mjs runtimeBinArg).
  assert.match(src, /args\.runtimeBin = runtimeBinArg\(values\)/, 'spawn-subagent does not read --runtime-bin');
});

test('G-5: isCapturedArtifact refuses a raw spelling: normalization is the intake\'s', () => {
  const o = { repoRoot: REPO, caseInsensitive: false };
  assert.throws(() => isCapturedArtifact('.claude/reviews/20261101-000000-r/evidence/x.txt', o), /owner's result/);
  assert.equal(isCapturedArtifact(rootEvidencePath('.claude/reviews/20261101-000000-r/evidence/x.txt', o), o), true);
});
