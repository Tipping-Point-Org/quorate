// A FOLLOW-UP OF A TEST-ONLY REMEDIATION CAN BE MINTED (G-13 of 20261121-204740-m3s7-b1-remediation-review; I-11 of
// .claude/requests/m3-stage7-fixes.md): new-run derived scope from changed files matching source_globs only, and
// --follows-remediation neither supplied a scope nor was exempted, so a remediation whose commits touched only test files
// (a finding about a test) died with "no source files in the diff" and its follow-up review could not be minted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../scripts/new-run.mjs', import.meta.url), 'utf8');

test('a --follows-remediation run with only test files changed is scoped to them, not refused', () => {
  const at = src.indexOf('let scope;');
  const die = src.indexOf('no source files in the diff vs', at);
  assert.ok(at >= 0 && die > at, 'the scope derivation is not where this test looks');
  const chain = src.slice(at, die);
  assert.match(chain, /\} else if \(followsRemediation && changedTests\.length\) \{/, 'a test-only follow-up still reaches the refusal');
  assert.match(chain, /paths: changedTests, changed_files: changedTests/);
  assert.match(src, /const changedTests = diffed\.filter\(\(p\) => isTestPath\(p, contract\) && !isGeneratedPath\(p, contract\)\);/);
});

test('the test-file rule it uses is the path owner\'s, which a test-only change matches', async () => {
  const { isTestPath, matchesSourceGlobs } = await import('../scripts/lib/finding-scope.mjs');
  const contract = { source_globs: ['scripts/**'], test_globs: ['tests/**'] };
  assert.equal(isTestPath('tests/regression-x.test.mjs', contract), true);
  assert.equal(matchesSourceGlobs('tests/regression-x.test.mjs', contract), false, 'the premise: a test file is no source file');
});
