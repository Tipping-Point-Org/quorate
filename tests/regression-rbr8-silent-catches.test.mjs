// Three catches that swallowed an error with only a comment (G-6, G-7, G-9 of 20261103-005954-rbr-remediation-7-review;
// disk-first §6 silent_error_swallowing):
//   - decide.mjs's exit-time scratch cleanup discarded a failure to list or remove the seat-evidence scratch, so the
//     process exited without naming the error or the path left behind (G-6);
//   - decide.mjs's revote released its claim inside a silent catch and then said "the revote can be run again", which a
//     claim left behind makes false: the next revote is held on EEXIST (G-7);
//   - findings-ledger.mjs read gate.json and reported only ECONFINED, so a gate that exists but is malformed or
//     unreadable was indistinguishable from no gate at all (G-9). Missing stays silent; anything else is said.
// Source checks: the three sites run only at process exit, after a subagent, or inside a whole fold, and each catch's
// body is what the finding names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G-6: the scratch cleanup at exit names a failure and the path it leaves', () => {
  const src = read('scripts/decide.mjs');
  const at = src.indexOf("const scratchName = `${process.pid}-${id}-evidence`;");
  assert.ok(at > 0, 'the scratch is not where this test looks');
  const block = src.slice(at, src.indexOf('const runSeat', at));
  assert.doesNotMatch(block, /catch\s*\{\s*\/\*[^*]*\*\/\s*\}/, 'the cleanup swallows its error with only a comment');
  const c = block.match(/catch\s*\((\w+)\)\s*\{(.*)$/m);
  assert.ok(c, 'the cleanup has no catch that binds the error');
  assert.match(c[2], /console\.error\(/, 'the cleanup catch does not report');
  assert.match(c[2], new RegExp(`${c[1]}\\b`), 'the report does not carry the error');
  assert.match(c[2], /scratchRoot/, 'the report does not name the path left behind');
});

test('G-7: a claim that cannot be released is said, and the revote is not called runnable again', () => {
  const src = read('scripts/decide.mjs');
  const at = src.indexOf("if (author?.status !== 'ok' || !note) {");
  assert.ok(at > 0, 'the release is not where this test looks');
  const block = src.slice(at, src.indexOf("held(() => owner.replace(D(opts.revote, 'revote', 'revote-note.md')", at));
  assert.doesNotMatch(block, /catch\s*\{\s*\/\*[^*]*\*\/\s*\}/, 'the release swallows its error with only a comment');
  const c = block.match(/catch\s*\((\w+)\)\s*\{(.*)$/m);
  assert.ok(c, 'the release has no catch that binds the error');
  assert.match(c[2], /die\(/, 'a failed release does not stop with its own message');
  assert.doesNotMatch(c[2], /can be run again/, 'a failed release still says the revote can be run again');
  assert.match(c[2], /by hand/, 'a failed release does not say the claim must be removed');
});

test('G-9: a gate that exists but cannot be read is said; only a missing one is silent', () => {
  const src = read('scripts/findings-ledger.mjs');
  const at = src.indexOf("const gate = JSON.parse(foldOwner.read(['gate.json']));");
  assert.ok(at > 0, 'the gate read is not where this test looks');
  const block = src.slice(at, src.indexOf('lockLedger();', at));
  assert.match(block, /ENOENT/, 'the catch does not tell a missing gate from a broken one');
  const reports = block.match(/console\.error\(/g) ?? [];
  assert.ok(reports.length >= 2, 'only a refusal is reported; a malformed or unreadable gate is silent');
  assert.match(block, /e\.message|e\?\.message/, 'the report of a broken gate does not carry its error');
});
