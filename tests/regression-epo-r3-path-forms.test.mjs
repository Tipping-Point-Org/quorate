// G-5 of 20261104-082659-epo-remediation-2-review: lib/evidence-path.mjs read `\\?\C:\...` (an extended-length spelling) as
// a UNC server named '?', so it matched no root and a valid evidence path was refused; and it upper-cased a drive letter
// whatever the caller's case rule, so `f:` and `F:` compared equal when the caller said case matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEvidencePath, rootEvidencePath } from '../scripts/lib/evidence-path.mjs';

test('an extended-length spelling of a path in the repository is that path', () => {
  const r = rootEvidencePath('\\\\?\\F:\\work\\repo\\.claude\\reviews\\r1\\evidence\\x.log', { repoRoot: 'F:/work/repo', caseInsensitive: true });
  assert.equal(r.refused, undefined, `refused: ${r.refused}`);
  assert.equal(r.inRepo, true);
  assert.equal(r.rel, '.claude/reviews/r1/evidence/x.log');
});

test('an extended-length UNC spelling is the UNC path', () => {
  const r = runEvidencePath('\\\\?\\UNC\\srv\\share\\runs\\r1\\evidence\\remediation\\a.log', { runDir: '//srv/share/runs/r1', caseInsensitive: true });
  assert.equal(r.refused, undefined, `refused: ${r.refused}`);
  assert.equal(r.path, 'evidence/remediation/a.log');
});

test('a device-namespace spelling of a run path is that path', () => {
  const r = runEvidencePath('\\\\.\\C:\\runs\\r1\\evidence\\remediation\\a.log', { runDir: 'C:\\runs\\r1', caseInsensitive: true });
  assert.equal(r.refused, undefined, `refused: ${r.refused}`);
  assert.equal(r.path, 'evidence/remediation/a.log');
});

test('the drive letter is under the caller\'s case rule', () => {
  const sensitive = runEvidencePath('f:/runs/r1/evidence/remediation/a.log', { runDir: 'F:/runs/r1', caseInsensitive: false });
  assert.ok(sensitive.refused, 'f: is not F: when the caller says case matters');
  const insensitive = runEvidencePath('f:/runs/r1/evidence/remediation/a.log', { runDir: 'F:/runs/r1', caseInsensitive: true });
  assert.equal(insensitive.path, 'evidence/remediation/a.log');
  const r = rootEvidencePath('f:/work/repo/x.log', { repoRoot: 'F:/work/repo', caseInsensitive: false });
  assert.ok(r.refused, 'a lower-case drive is below no root spelled F: under a case-sensitive rule');
});
