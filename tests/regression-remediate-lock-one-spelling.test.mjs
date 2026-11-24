// THE LOCK'S NAME AND ITS CHECK HAVE ONE OWNER (G-1, G-3 of 20261121-204740-m3s7-b1-remediation-review; I-7 of
// .claude/requests/m3-stage7-fixes.md): archive-run took and released remediate.lock through lib/remediate-lock.mjs but
// checked it with its own runHas(REMEDIATE_LOCK), and archive-run and remediate.mjs both spelled the name as a literal in
// their archive skip lists and lock reads, so a rename in the owner would leave callers checking or skipping another file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// Code only: a comment may name the file.
const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

for (const file of ['scripts/archive-run.mjs', 'scripts/remediate.mjs']) {
  test(`${file} spells the lock's name only through REMEDIATE_LOCK`, () => {
    const hits = code(read(file)).split('\n').filter((l) => /['"`]remediate\.lock['"`]/.test(l));
    assert.deepEqual(hits, [], `a second spelling of the lock's name in ${file}`);
  });
}

test('archive-run checks the lock through the owner, remediateLockHeld', () => {
  const src = code(read('scripts/archive-run.mjs'));
  assert.match(src, /remediateLockHeld\(/, 'archive-run does not ask the owner whether the lock is held');
  assert.doesNotMatch(src, /runHas\(REMEDIATE_LOCK\)/, 'archive-run still checks the lock with its own helper');
});
