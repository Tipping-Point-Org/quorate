// THE RECOVERY'S REQUEST SEARCH READS EACH ENTRY LINK-AWARE (G-28 of 20261121-204740-m3s7-b1-remediation-review; I-3 of
// .claude/requests/m3-stage7-fixes.md): newestRequestDoc listed .claude/requests and then stat'ed and read each .md with
// raw fs calls, so a symbolic link or a hard link there was followed and its target could become the request a run is
// judged against. Only the write side and the collision bound had been fixed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../scripts/run-graph.mjs', import.meta.url), 'utf8');

test('newestRequestDoc stats by lstat, keeps plain files, and reads through the egress owner', () => {
  const at = src.indexOf('function newestRequestDoc() {');
  assert.ok(at >= 0, 'newestRequestDoc is gone');
  const body = src.slice(at, src.indexOf('\n}\n', at));
  assert.doesNotMatch(body, /fs\.statSync\(/, 'an entry is stat\'ed through its link');
  assert.doesNotMatch(body, /fs\.readFileSync\(/, 'an entry is read raw, following a link or a second name');
  assert.match(body, /fs\.lstatSync\(abs\)/);
  assert.match(body, /if \(!st\.isFile\(\)\) continue;/, 'a link is not skipped');
  assert.match(body, /text = egressReadFile\(c\.abs, 'utf8', \{ repoRoot \}\)/, 'the text is not read through the egress owner');
  assert.match(body, /if \(!refusedOrAbsent\(e\)\) throw e;/);
  assert.match(body, /continue;\s*\}/, 'a refused entry is not skipped');
});
