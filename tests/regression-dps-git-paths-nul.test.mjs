// G-1 of 20261110-010058-dps-remediation-2-review: scripts/decide.mjs read `git ls-files` as newline-delimited text and
// trim()med each path, so a tracked path with leading or trailing whitespace ("config ") folded onto another name
// ("config"), and an ignored file of that name skipped the seat copies' credential screen as though git tracked it.
// Every path list decide.mjs takes from git is now read NUL-delimited (-z), untrimmed and unquoted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const src = fs.readFileSync(path.join(ROOT, 'scripts/decide.mjs'), 'utf8');

test('every path list decide.mjs reads from git is NUL-delimited and untrimmed', () => {
  const lines = src.split('\n').filter((l) => /gitOut\(\[\s*'(ls-files|diff)'/.test(l) && !/--stat/.test(l));
  assert.ok(lines.length >= 3, `expected the untracked, tracked and changed lists, found ${lines.length}`);
  for (const l of lines) {
    assert.match(l, /'-z'/, `a path list read without -z: ${l.trim()}`);
    assert.doesNotMatch(l, /split\('\\n'\)|\.trim\(\)/, `a path list split on newlines or trimmed: ${l.trim()}`);
  }
  assert.doesNotMatch(src, /untrackedFiles,\s*\]\.map\(\(s\) => s\.trim\(\)\)/, 'the changed files are still trimmed');
});
