// G-2 of 20261112-063354-hl-remediation-4-review: decide.mjs --pending queued one console.log per waiting decision and then
// called process.exit(0), so on a POSIX pipe (a pager, another tool) the listing could be cut short and omit decisions
// waiting on the operator. --sample lists the same way. Both now write the whole listing through writeAllSync before they
// exit, as --json does (G-3 of 20261112-054852-hl-remediation-3-review). Lexical, like that test: the property is which
// writer the block uses before its exit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const decide = fs.readFileSync(path.join(REPO_ROOT, 'scripts/decide.mjs'), 'utf8');
const block = (head) => {
  const at = decide.indexOf(head);
  assert.ok(at >= 0, `decide.mjs has no ${head}`);
  const end = decide.indexOf('process.exit(0);', at);
  return decide.slice(at, end);
};

for (const head of ['if (opts.pending) {', 'if (opts.sample) {']) {
  test(`${head} writes its whole listing every byte before the process exits`, () => {
    const b = block(head);
    assert.doesNotMatch(b, /console\.log\(/, `${head}: the listing is queued with console.log before process.exit`);
    assert.match(b, /writeAllSync\(1, [^;]*\{ retry: \['EAGAIN'\] \}\);/, `${head}: the listing is not written through writeAllSync`);
  });
}
