// G-5 of 20261122-044843-m3s7-b3-remediation-review (I-2 of .claude/requests/m3-stage7-fixes.md): every call from
// bench-lenses into the run-artifacts readers passes an owner, never a raw directory string. Only readNodeStatus had
// moved to confined(runDir); collectRun was still handed admitted.dir, runDir and spendRun.dir, which the callee
// accepts through ownerOf's string branch, so the bench call sites never moved to owners.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('bench-lenses passes an owner to every run-artifacts reader call', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-lenses.mjs'), 'utf8');
  const imported = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/io\/run-artifacts\.mjs'/);
  assert.ok(imported, 'the run-artifacts import was not found');
  const readers = imported[1].split(',').map((s) => s.trim()).filter((n) => n && n !== 'refusalLines');
  assert.ok(readers.includes('collectRun'), `collectRun is no longer imported: ${readers}`);
  let calls = 0;
  for (const name of readers) {
    for (const m of src.matchAll(new RegExp(`\\b${name}\\(([^)\\n]*)`, 'g'))) {
      calls++;
      assert.match(m[1], /^\s*confined\(/, `${name}(${m[1]}...) passes a raw directory string, not an owner`);
    }
  }
  assert.ok(calls >= 4, `expected at least four reader calls, found ${calls}`);
});
