// A FAILED PRE-FLIGHT BARRIER MUST EXIT, NOT CRASH.
//
// `tearDownPanelWorktree` is registered as a `process.on('exit')` handler near the top of
// run-graph.mjs and reads `panelWorktree`. That variable was declared `let` ~870 lines below, beside
// the other panel-surface facts — and a `let` is in the temporal dead zone until its declaration
// EXECUTES, not until the file is parsed. So any exit before that line made the handler throw
// `ReferenceError: Cannot access 'panelWorktree' before initialization`.
//
// The reachable path is the one that matters most in a verification system: `runPreflight` calls
// process.exit when a barrier check fails, well above the old declaration. Every run BLOCKED at the
// barrier therefore printed its correct verdict and then died in a stack trace, losing the exit code
// a git hook or a calling script reads. Found by bench-second-opinion, whose resume re-runs the
// barrier inside a seeded worktree.
//
// run-graph.mjs's own source records this defect class twice already (`alreadyOk`, and the
// `tbStartedAt`/`judgeId` pair). These tests pin the ordering rather than the symptom, because the
// symptom needs a full failing run to reproduce and the ordering is the thing that must hold.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'run-graph.mjs'), 'utf8').split('\n');

const lineOf = (re) => {
  const i = SRC.findIndex((l) => re.test(l));
  assert.notEqual(i, -1, `run-graph.mjs no longer contains ${re}`);
  return i + 1;
};

test('panelWorktree is declared above the exit handler that reads it', () => {
  // The ordering IS the fix. Declared below, the handler throws on every exit that happens before
  // the declaration line runs — which is every barrier failure.
  const decl = lineOf(/^let panelWorktree = null;/);
  // The exit handlers are installed by stopHeldOnExit since stopping-a-child stage 3; that call is the registration.
  const handler = lineOf(/^stopHeldOnExit\(\{/);
  assert.ok(decl < handler,
    `panelWorktree is declared at ${decl} but its exit handler is registered at ${handler}; `
    + 'a value read from a handler must be declared above the handler');
});

test('and above the function body that dereferences it', () => {
  const decl = lineOf(/^let panelWorktree = null;/);
  const fn = lineOf(/^function tearDownPanelWorktree\(\) \{/);
  assert.ok(decl < fn, `panelWorktree is declared at ${decl}, after tearDownPanelWorktree at ${fn}`);
});

test('the temporal dead zone this pins is real, not a style preference', () => {
  // Demonstrated rather than asserted, so a reader who doubts the rule can see the failure mode
  // without reproducing a blocked run: a `let` read before its declaration line executes throws,
  // where a `var` or a hoisted function would not.
  assert.throws(() => {
    // eslint-disable-next-line no-unused-vars
    const read = () => tooLate;
    read();
    let tooLate = null;
  }, ReferenceError);
});
