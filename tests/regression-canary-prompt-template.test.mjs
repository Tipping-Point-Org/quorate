// G-17 of run 20260925-015614-platform-review (panel-codex-arch): new-run built the sandbox canary's
// instructions as an inline template literal, so the orchestration layer owned model-facing prose
// that ARCHITECTURE §2 assigns to the prompt library. The words moved to
// prompts/_templates/sandbox-canary.md; new-run keeps only the paths. The render was verified
// byte-identical to the literal it replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { slotsIn } from '../scripts/lib/template.mjs';

const ROOT = path.join(import.meta.dirname, '..');

test('G-17: the canary\'s words live in the prompt library, and new-run fills only the paths', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'prompts', '_templates', 'sandbox-canary.md'), 'utf8');
  assert.deepEqual(slotsIn(tpl).sort(), ['canary_path', 'capture_rel', 'run_dir', 'settings_path']);
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  assert.doesNotMatch(src, /Do exactly two things/, 'no second copy of the prose in orchestration');
  assert.match(src, /readTemplate\('sandbox-canary\.md'\)/);
});
