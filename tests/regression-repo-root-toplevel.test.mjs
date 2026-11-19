// regression-repo-root-toplevel.test.mjs — G-12, G-16, G-17 of 20261023-014400-rdt-delivery.
//
// new-run, run-graph and spawn-node took the repository to be the literal working directory when --repo-root was absent,
// where capture, run-checks, remediate and findings-ledger take git's toplevel of it. Run from a subdirectory of the
// repository, a run that is the repository's own was refused as another repository's, or the command acted on the
// subdirectory as though it were the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, repoRunDir, runScript } from './helpers.mjs';

const SUBDIR = path.join(REPO_ROOT, 'tests');
const REFUSED_AS_OTHER_REPO = /is not one of .*'s runs|the repository this command runs for/;

test('spawn-node from a subdirectory admits the repository\'s own run (git\'s toplevel, not the working directory)', () => {
  const { dir } = repoRunDir({ prefix: 'quorate-toplevel-spawn-' });
  // --output-cap-mb 0 is refused on the line after admission, so nothing is spawned either way.
  const r = runScript('spawn-node.mjs', ['--run-dir', dir, '--node-id', 'x', '--mode', 'lens', '--output-cap-mb', '0'], { cwd: SUBDIR });
  assert.doesNotMatch(r.output, REFUSED_AS_OTHER_REPO, 'the run was judged against the subdirectory');
  assert.match(r.output, /--output-cap-mb must be a positive number/, r.output.slice(-600));
});

test('new-run --remediates from a subdirectory admits the repository\'s own run', () => {
  const { dir } = repoRunDir({ prefix: 'quorate-toplevel-mint-' });
  const r = runScript('new-run.mjs', ['--remediates', dir, '--no-verify-reviewers', '--no-verify-sandbox'], { cwd: SUBDIR });
  assert.notEqual(r.status, 0, 'an unfinished review was accepted for remediation');
  assert.doesNotMatch(r.output, REFUSED_AS_OTHER_REPO, `the run was judged against the subdirectory: ${r.output.slice(-600)}`);
});

test('no entry script defaults the repository to the literal working directory', () => {
  for (const f of ['new-run.mjs', 'run-graph.mjs', 'spawn-node.mjs']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', f), 'utf8');
    assert.ok(!/path\.resolve\(args\.repoRoot \?\? process\.cwd\(\)\)/.test(src), `${f} defaults to the working directory`);
    assert.ok(/callerRepoRoot\(args\.repoRoot\)/.test(src), `${f} does not ask git for the toplevel`);
  }
});
