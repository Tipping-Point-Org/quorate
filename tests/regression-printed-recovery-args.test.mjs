// What this guards (20261108-032104-si-remediation-4-review):
// G-11/G-12: remediate.mjs printed recovery and retry commands with the repository and run paths raw inside double quotes,
//   so a path holding `$(...)` or a backtick ran that text when the command was pasted into a POSIX shell. briefArg had
//   been applied to the node's capture command only.
// G-5: a run directory holding a shell-active character threw an uncaught error out of nodeBriefLines, not a diagnostic.
// G-10: removing a restored set-aside copy swallowed every error, so a stale copy was left with nothing said.
// G-1: bench-repair-pass read a failed `git ls-tree` of the head as every file absent at head, counting it wholly added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as decisions from '../scripts/lib/decisions.mjs';
const { printedArg } = decisions;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('printedArg quotes an ordinary path and withholds one a shell would act on', () => {
  assert.equal(typeof printedArg, 'function', 'a printed command needs a shell-neutral argument owner');
  assert.equal(printedArg('C:\\Users\\Ada Lovelace\\r'), '"C:/Users/Ada Lovelace/r"');
  for (const bad of ['/home/x/$(touch pwned)', '/home/x/`id`', '/home/x/"q', '/home/x/a\nb']) {
    const out = printedArg(bad);
    assert.ok(!/[`$]/.test(out.slice(1, -1)) && !out.slice(1, -1).includes('"') && !/[\r\n]/.test(out), `withheld: ${out}`);
    assert.match(out, /^".*"$/);
  }
});

// G-3 of 20261108-060730-si-remediation-6-review-b: cmd.exe expands %NAME% inside double quotes, so a path holding one could
// change a pasted recovery command, its value carrying a quote and metacharacters. A lone percent sign expands to nothing.
test('G-3: a path holding a %NAME% expansion is withheld from a printed command and refused from a brief', () => {
  for (const bad of ['C:/Users/%TEMP%/r', 'C:/%A B%/r', '/home/x/%PATH%']) {
    const out = printedArg(bad);
    assert.ok(!out.includes('%'), `printed with its expansion: ${out}`);
    assert.match(out, /^".*"$/);
    assert.throws(() => decisions.briefArg(bad), /cannot be quoted safely/, `briefArg let ${bad} through, unlike printedArg`);
  }
  for (const fine of ['C:/Users/100%/r', 'C:/a%b/r']) assert.equal(printedArg(fine), `"${fine}"`, 'one percent sign expands nothing');
});

test('no printed command in remediate.mjs interpolates a path raw inside double quotes', () => {
  const src = read('scripts', 'remediate.mjs');
  const raw = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /"\$\{(repo|runDir|finalDir|followAdmission\.dir)\}"/.test(l));
  assert.deepEqual(raw, [], 'each printed path goes through printedArg');
});

// G-9, G-11 of 20261108-043341-si-remediation-5-review-b: the framework script's path, and the remediation_start reread from
// run.json, were interpolated unquoted into the printed recovery commands, so a space in the install path split the command.
test('no printed command in remediate.mjs interpolates the framework script path or remediation_start raw', () => {
  const src = read('scripts', 'remediate.mjs');
  const lines = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*\/\//.test(l));
  const rawScript = lines.filter(([, l]) => /node \$\{path\.join\(FRAMEWORK\.scriptsDir/.test(l));
  assert.deepEqual(rawScript, [], 'the framework script path goes through printedArg');
  // Raw is any interpolation of it not opened as printedArg's own argument (`printedArg(\`${...}..HEAD\`)`).
  const rawStart = lines.filter(([, l]) => /(?<!printedArg\(`)\$\{(done|run|readRun\(runDir\))\.remediation_start[^}]*\}/.test(l));
  assert.deepEqual(rawStart, [], 'remediation_start goes through printedArg');
});

test('the node brief refuses a shell-active run directory with a diagnostic, not an uncaught throw', () => {
  const src = read('scripts', 'remediate.mjs');
  const body = src.slice(src.indexOf('function nodeBriefLines()'), src.indexOf('function nodeRuntime()'));
  assert.match(body, /try\s*\{[^}]*briefArg\(runDir\)[\s\S]*?catch\s*\(e\)\s*\{\s*die\(/, 'briefArg(runDir) is caught and turned into die()');
});

test('a failed removal of a restored set-aside copy is named, not swallowed', () => {
  // The write-back moved out of the runner (runner-test-seam.plan.md stage 1), and its half of this test is run, not read
  // (stage 4): tests/regression-set-aside-behaviour.test.mjs "a failed removal of a restored entry's copy is named, and an
  // absent copy is not". The runner must not grow the empty catch back.
  assert.ok(!read('scripts', 'remediate.mjs').includes('catch { /* absent, or kept: the record says restored */ }'), 'the empty catch is the defect');
});

test('the bench reads a failed ls-tree of the head as unknown, not absent', () => {
  const src = read('scripts', 'bench-repair-pass.mjs');
  assert.ok(!/headLs && headLs\.status === 0 \? lsTreeEntries\(headLs\.stdout\) : new Map\(\)/.test(src), 'a failed read became an empty map');
  assert.match(src, /headFailed[\s\S]{0,400}git ls-tree of the head failed/);
  // The same class in the candidate's rebuild: a failed cat-file was reported as "git no longer holds" every blob.
  assert.match(src, /if \(batch\.status !== 0\) return done\(\{ status: 'error'/, 'a failed cat-file --batch-check reads as missing blobs');
});
