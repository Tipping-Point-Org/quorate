// run-dir-descendants.plan.md stage 5 (G-17, with G-16 and G-28, of 20261024-122231-rdt-remediation-3-review): the
// read-only git set's deny-list knew flags by name alone, and three read a file at any path only in one subcommand:
// `git grep -f <file>` (patterns from a file), `git blame -S <revs-file>`, and `git ls-files -X <file>` (--exclude-from).
// capture.mjs let each through. The deny-list now takes the subcommand; the same letter elsewhere stays allowed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { forbiddenTail } from '../scripts/lib/forbidden-tail.mjs';
import { repoRunDir, runScript } from './helpers.mjs';

test('G-17: each subcommand-only read is refused, bundled or long, in its own subcommand', () => {
  for (const [sub, tail] of [
    ['grep', ['-f', '/etc/hosts']], ['grep', ['-nf/etc/hosts']], ['grep', ['--file=/etc/hosts']], ['grep', ['--fil', '/etc/hosts']],
    ['blame', ['-S', '/tmp/revs', 'a.js']], ['blame', ['-wS/tmp/revs', 'a.js']],
    ['ls-files', ['-X', '/tmp/patterns']], ['ls-files', ['-oX/tmp/patterns']],
  ]) {
    assert.ok(forbiddenTail(sub, tail), `git ${sub} ${tail.join(' ')} reads a file at any path and was let through`);
  }
});

test('G-17: the same letters in another subcommand are not refused, and the global escapes still are', () => {
  assert.equal(forbiddenTail('log', ['-S', 'needle']), null, 'git log -S is the pickaxe search, not a file read');
  assert.equal(forbiddenTail('grep', ['-F', '-n', 'needle']), null, 'grep -F (fixed strings) is not -f');
  assert.equal(forbiddenTail('grep', ['--files-with-matches', 'needle']), null, 'a real grep option the rule must not refuse');
  assert.equal(forbiddenTail('diff', ['-f']), null);
  assert.ok(forbiddenTail('log', ['--output=/tmp/x']), 'a global escape is still refused through the new function');
  assert.ok(forbiddenTail('grep', ['-nOcat', 'x']), 'and a bundled global one');
});

test('G-17: capture refuses git grep -f end to end, and writes no evidence', () => {
  const { dir } = repoRunDir({ prefix: 'quorate-capture-grep-f-' });
  const r = runScript('capture.mjs', ['--run-dir', dir, '--node', 'lens', '--name', 'probe', '--', 'git', 'grep', '-f', 'CLAUDE.md', 'x']);
  assert.notEqual(r.status, 0, r.output.slice(-400));
  assert.match(r.output, /'-f' lets a read-only inspection/);
  // The folder is made before the command is checked; no log is written into it.
  const ev = path.join(dir, 'evidence', 'lens');
  assert.deepEqual(fs.existsSync(ev) ? fs.readdirSync(ev) : [], [], 'nothing was captured');
});
