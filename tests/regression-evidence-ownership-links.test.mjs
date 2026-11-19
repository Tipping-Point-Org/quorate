// G-19 of 20261025-104155-srf-remediation-3-review: spawn-node judged a finding's evidence_path with an inline
// `startsWith(evOwn + path.sep)` on the lexical path, then existsSync, which follows links. A link beneath
// evidence/<node>/ onto a fresh file outside the run passed both, so outside content counted as the node's own evidence,
// and the inline test was a second containment rule beside the owner, isWithin. Ownership is now decided by
// lib/finding-scope.mjs's evidenceOwnershipError, lexically and through links, and the spawner calls it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { evidenceOwnershipError } from '../scripts/io/finding-scope.mjs';

test('regression: a link beneath evidence/<node>/ onto a file outside the run is not that node\'s evidence', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-g19-run-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-g19-outside-'));
  const own = path.join(runDir, 'evidence', 'lens');
  const link = path.join(own, 'j');
  try {
    fs.mkdirSync(own, { recursive: true });
    fs.writeFileSync(path.join(own, 'real.log'), 'captured\n');
    fs.writeFileSync(path.join(outside, 'fake.log'), 'not this node\'s\n');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');

    assert.equal(evidenceOwnershipError(runDir, 'lens', 'evidence/lens/real.log'), null, 'the node\'s own capture is admitted');
    assert.match(evidenceOwnershipError(runDir, 'lens', 'evidence/lens/j/fake.log') ?? '', /through a link/,
      'a path whose own form passes but which resolves outside the run is refused');
    assert.match(evidenceOwnershipError(runDir, 'lens', 'evidence/other/x.log') ?? '', /outside evidence\/lens\//);
    assert.match(evidenceOwnershipError(runDir, 'lens', 'evidence/lens') ?? '', /outside evidence\/lens\//,
      'the directory itself is not a file this node captured');
    assert.match(evidenceOwnershipError(runDir, 'lens', 'evidence/lens/missing.log') ?? '', /does not exist/);
    assert.equal(evidenceOwnershipError(runDir, 'lens', ''), 'no evidence_path');
  } finally {
    try { fs.unlinkSync(link); } catch { /* not made */ }
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

// G-20 of 20261025-104155-srf-remediation-3-review: a node's stdout envelope was read and parsed to bill it, then read and
// parsed again to judge it, and a third time on a failure, the same bytes each time. It is read once.
test('regression: the spawner reads a node\'s stdout envelope once', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  // Through the owner since run-dir-reads.plan.md stage 4: the one read names evidence/<node>/stdout.json as segments.
  assert.equal(src.match(/owner\.read\(\['evidence', nodeId, 'stdout\.json'\]\)/g)?.length ?? 0, 1, 'one read of stdout.json serves billing, failure and envelope');
  assert.doesNotMatch(src, /readFileSync\(stdoutPath/, 'stdout.json is read raw again');
});

test('regression: the spawner asks the owner, and keeps no lexical containment test of its own', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  assert.doesNotMatch(src, /startsWith\(evOwn \+ path\.sep\)/, 'the inline lexical evidence-ownership test is gone');
  assert.match(src, /evidenceOwnershipError\(/, 'spawn-node calls the owner');
});
