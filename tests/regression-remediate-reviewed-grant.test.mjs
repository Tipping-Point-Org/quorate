// regression-remediate-reviewed-grant.test.mjs — G-14 of 20261023-014400-rdt-delivery.
//
// remediate.mjs handed the write-capable remediation node the raw remediation_frame.run_dir as --add-dir, while the chain
// walk before it found the reviewed run by its id. A frame keeping a valid run_id and naming any existing directory
// exposed that directory to the node. The grant is the directory admitRun admits as that run, or nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

test('the reviewed run is granted to the node only as admitted, never as the frame\'s raw path', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  const grant = src.split('\n').find((l) => l.includes("'--add-dir', repo")) ?? '';
  assert.ok(grant, 'the --add-dir grant was not found');
  assert.ok(!/frame\.run_dir/.test(grant), `the raw frame path is granted: ${grant.trim()}`);
  assert.ok(/reviewedGrant\b/.test(grant), `the grant does not use the admitted reviewed run: ${grant.trim()}`);
  // Since run-dir-descendants.plan.md stage 3 the reviewed run is admitted once, by reviewedDir(), and every read and the
  // grant take that one admitted directory.
  assert.ok(/const reviewedGrant = reviewedDir\(\);/.test(src), 'the grant does not take the one admission');
  assert.ok(/const a = frame\?\.run_dir \? admitRun\(\{ runDir: frame\.run_dir, repoRoot: repo \}\) : null;\s*reviewedDirCache = a\?\.ok && a\.record\?\.run_id === frame\.run_id \? a\.dir : null;/.test(src),
    'reviewedGrant is not the admitted directory of the frame\'s run');
});
