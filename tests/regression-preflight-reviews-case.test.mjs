// THE REVIEWS FOLDER IS LEFT OUT OF THE PRE-FLIGHT INPUTS IN ANY SPELLING (G-11 of 20261029-201447-rdr-remediation-review,
// panel-codex-arch, MEDIUM). preflightInputSet pruned the reviews folder with its own `startsWith(reviewsAbs + sep)`,
// which does not fold case, beside the host-bound isWithin that owns the rule and does. On a filesystem that folds case,
// a reviews folder named in another case than the walk found it was not pruned, and generated run files became inputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withTempDir, REPO_ROOT } from './helpers.mjs';
import { preflightInputSet } from '../scripts/io/preflight-cache.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

test('G-11: preflight-cache decides containment through the isWithin owner, not a startsWith of its own', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'preflight-cache.mjs'), 'utf8');
  assert.doesNotMatch(src, /startsWith\(reviewsAbs/, 'a local containment check that does not fold case');
  assert.match(src, /isWithin\(reviewsAbs, /);
});

test('G-11: on a filesystem that folds case, a reviews folder named in another case is still left out', { skip: !hostPlatform().caseInsensitiveFs && 'this filesystem does not fold case' }, () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'export {};\n');
    fs.mkdirSync(path.join(dir, 'Reviews', 'run'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Reviews', 'run', 'x.json'), '{}\n');
    const set = preflightInputSet({ repoRoot: dir, contract: { review: { preflight_inputs: ['src/**', 'Reviews/**'] } },
      reviewsDir: path.join(dir, 'reviews') });
    assert.ok(set.relFiles.includes('src/a.mjs'), `precondition: the walk found the source: ${set.relFiles}`);
    assert.deepEqual(set.relFiles.filter((f) => /^reviews\//i.test(f)), [], 'the reviews folder is generated output, never an input');
  });
});
