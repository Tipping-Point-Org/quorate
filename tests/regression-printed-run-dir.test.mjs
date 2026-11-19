// regression-printed-run-dir.test.mjs — G-15 (G-3 its symptom) of 20261023-014400-rdt-delivery.
//
// new-run prints a run inside the repository relative to its --repo-root. remediate.mjs took that line as it stood and read
// run.json through it from its own working directory, recording a null followup_run_id and printing an unusable command
// for an in-repository reviews_dir; bench-lenses handed the same string to run-graph, which ran in another directory.
// One owner reads the line, against the repository the mint was given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { printedRunDir } from '../scripts/lib/reviews-root.mjs';
import { REPO_ROOT } from './helpers.mjs';

test('a relative run dir new-run printed resolves against the repository, not the working directory', () => {
  const repo = path.join(os.tmpdir(), 'some-repo');
  const out = 'resolved\nrun dir: .claude/reviews/20260101-000000-x\n20260101-000000-x\n';
  assert.equal(printedRunDir(out, repo), path.join(repo, '.claude', 'reviews', '20260101-000000-x'));
  const staged = path.join(os.tmpdir(), 'home', 'reviews', '20260101-000000-x');
  assert.equal(printedRunDir(`run dir: ${staged}\n`, repo), staged, 'an absolute line is kept as printed');
  assert.equal(printedRunDir('no such line', repo), null);
});

test('remediate and bench-lenses read new-run\'s printed run dir through the owner', () => {
  for (const f of ['remediate.mjs', 'bench-lenses.mjs']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', f), 'utf8');
    assert.ok(/\bprintedRunDir\(/.test(src), `${f} does not read the printed run dir through printedRunDir`);
    assert.ok(!/run dir:\\s\*/.test(src), `${f} still parses the "run dir:" line itself`);
  }
});
