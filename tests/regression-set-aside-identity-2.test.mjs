// WHAT THE SET-ASIDE'S CHECKS COMPARE, AND HOW A REFUSAL IS TOLD (remediation 20261107-230553-si-remediation-2 of review
// 20261107-224233-si-remediation-review). G-16: the check before the put-back compared only the hash, so a chmod made after
// the copy passed it. G-18: the check after the write-back compared kind and hash, never the mode, so a wrong-mode write was
// recorded restored and its copy removed. G-14: the candidate paths reached `git ls-tree` as pathspecs, so a tracked name
// with `[c]` in it could be read as new and removed. G-11: any nonzero rev-parse after a commit read as "absent", so a git
// failure on a deleted file was recorded as a match. G-1 (G-3, G-7): three readers still matched confined-path's English
// rather than its refusal tag.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
const src = read('scripts', 'remediate.mjs');
// committedDiffers stays in the runner, and is read there.
const at = (text, name, from = 0) => {
  const i = text.indexOf(`\nfunction ${name}(`, from);
  return i >= 0 ? i : text.indexOf(`\nexport function ${name}(`, from);
};
const runnerFnOf = (name, next) => {
  const a = at(src, name);
  const b = at(src, next, a + 1);
  assert.ok(a >= 0 && b > a, `${name} is not found before ${next}`);
  return src.slice(a, b);
};
const code = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// G-16, G-18 and G-14 matched scripts/io/set-aside.mjs's source. REPLACED (runner-test-seam.plan.md stage 4) by the tests of
// the same names in tests/regression-set-aside-behaviour.test.mjs, which run the module: a mode changed after the copy stops
// the put-back (G-16, with tests/regression-set-aside-faults.test.mjs's put-back guard rows for a failed read and a path no
// longer a file), a write read back at another mode is not restored (G-18), and every path after `--` on the `git` channel
// is literal, a bracketed name put back to HEAD (G-14).

test('G-11: a failed rev-parse after a commit is not read as an absent path', () => {
  // An anchor that stays in the runner: pathState moved to scripts/io/set-aside.mjs (runner-test-seam.plan.md stage 1).
  const fn = code(runnerFnOf('committedDiffers', 'setAsideFinisher'));
  assert.doesNotMatch(fn, /got\.status === 0 \? got\.stdout\.trim\(\) : 'absent'/, 'any nonzero rev-parse still reads as absent');
  // Absent only when git says the path is not in HEAD's tree; otherwise the file is named as unverified. One ls-tree for
  // the cluster since G-8 of 20261108-021347-si-remediation-2-review, and a failed one names every file unverified.
  assert.match(fn, /'ls-tree', '-z', 'HEAD', '--', \.\.\.files\.map\(\(p\) => `:\(literal\)\$\{p\}`\)/);
  assert.match(fn, /if \(ls\.status !== 0\) return files\.map\(/, 'a failed ls-tree is not named for every file');
  assert.match(fn, /could not be read/);
  assert.match(fn, /entries\.get\(p\)\?\.hash \?\? 'absent'/, 'a path HEAD\'s tree does not list is not read as absent');
});

test('G-5: setAsidePlan and setAsideCandidates consider clusters by one predicate; G-4: the doc names the Maps, not callbacks', () => {
  const lib = read('scripts', 'lib', 'remediation-chain.mjs');
  const plan = lib.slice(lib.indexOf('export function setAsidePlan('), lib.indexOf('export function setAsideRestoreNeeded('));
  const cand = lib.slice(lib.indexOf('export function setAsideCandidates('), lib.indexOf('export function setAsidePlan('));
  assert.match(cand, /setAsideConsidered/, 'setAsideCandidates does not use the shared predicate');
  assert.match(plan, /setAsideConsidered/, 'setAsidePlan re-derives which clusters it considers');
  assert.doesNotMatch(plan, /c\.committable/, 'setAsidePlan still tests committable itself');
  const at = lib.indexOf('export function setAsideCandidates(');
  const docs = lib.slice(lib.lastIndexOf('WHICH REFUSED CLUSTERS ARE SET ASIDE', at), lib.indexOf('export function setAsideRestoreNeeded('));
  assert.doesNotMatch(docs, /`kindOf\(path\)` is the caller's/, 'the doc still describes the removed kindOf callback');
  assert.doesNotMatch(docs, /`hashNow\(path\)`|`modeNow\(path\)`/, 'the doc still describes the removed hashNow/modeNow callbacks');
});

test('G-1 (G-3, G-7): no reader of confined-path matches its English; each branches on the refusal tag', () => {
  const sites = [['scripts', 'bench-repair-pass.mjs'], ['scripts', 'lib', 'finding-scope.mjs'], ['scripts', 'lib', 'run-artifacts.mjs'], ['scripts', 'remediate.mjs'],
    ['scripts', 'io', 'set-aside.mjs']];
  for (const s of sites) {
    const text = code(read(...s));
    for (const prose of ['already taken', 'link or junction', 'not a directory', 'not a file']) {
      assert.doesNotMatch(text, new RegExp(`/${prose}/\\.test\\(`), `${s.join('/')} still matches "${prose}" against a message`);
    }
  }
  const owner = read('scripts', 'lib', 'confined-path.mjs');
  for (const l of owner.split('\n').filter((x) => /throw refused\(/.test(x))) {
    if (/not a directory/.test(l)) assert.match(l, /'not-a-directory'\)/, `a not-a-directory refusal carries no tag: ${l.trim()}`);
    if (/this is not a file/.test(l)) assert.match(l, /'not-a-file'\)/, `a not-a-file refusal carries no tag: ${l.trim()}`);
  }
});
