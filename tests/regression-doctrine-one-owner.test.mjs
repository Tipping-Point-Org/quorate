// G-64: A NODE COULD BE TOLD ONE DOCTRINE PATH AND HANDED A SNAPSHOT OF A DIFFERENT DIRECTORY.
//
// Two resolvers, one fact, and they disagreed on the middle entry:
//
//   DOCTRINE_PATH (what the brief tells the node)
//     frameworkRoot/shared -> repoRoot/.claude/skills/quorate/shared -> repoRoot/shared
//   the intent sandbox snapshot (what the node is actually given)
//     frameworkRoot/shared -> repoRoot/.claude/skills/SHARED        -> repoRoot/shared
//
// The snapshot probed the ANCESTOR engine's layout where the brief probes the documented consumer
// mount. Worse, it matched on the directory merely EXISTING, while DOCTRINE_PATH requires
// disk-first-protocol.md to be in it -- so any consumer folder named `shared` qualified to be
// copied into the sandbox as "the doctrine", under filenames the node reads as authoritative.
//
// It never fired, because frameworkRoot/shared is probed first and always exists in a real mount.
// That is an ORDERING THAT HAPPENS TO HOLD, not a boundary -- the engine's own words about the
// sibling case -- and it held only while the framework's own doctrine directory was intact.
//
// WHAT IT COST ANYWAY, WITHOUT EVER FIRING: this divergence is the entire reason
// `.claude/skills/shared` was on a "legacy engine" watch list that stamped SKILLS-SHADOWED on every
// run. Measured on a real consumer, the check was firing on a LIVE adjudication panel --
// adjudicate-panel.py invoked by that project's own skill, external-review.ps1 pinned by a passing
// unit test, modified three days before. It reads directory NAMES, never contents, so no action
// short of renaming a working subsystem could clear it. A stamp an operator cannot clear is one
// they learn to skip, which is the failure this project keeps writing down.
//
// One owner now: the snapshot copies DOCTRINE_DIR, the directory DOCTRINE_PATH resolved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');

test('the doctrine directory is resolved exactly once', () => {
  assert.match(graph, /const DOCTRINE_DIR = \[/,
    'the resolution must be a named value the snapshot can reuse, not a list inlined twice');
  assert.match(graph, /const DOCTRINE_PATH = DOCTRINE_DIR/,
    'and the path the brief carries must be derived FROM that directory, so the two cannot drift');
});

test('the intent sandbox snapshots the directory the brief actually names', () => {
  assert.match(graph, /const shared = DOCTRINE_DIR;/,
    'the snapshot must copy the resolved directory rather than re-deriving its own');
});

test('nothing resolves the ancestor engine layout any more', () => {
  // The precise string that made a consumer's own `shared/` reachable. Its absence is the fix.
  const live = graph
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  assert.ok(!/['"`].*\.claude\/skills\/shared/.test(live),
    'no EXECUTABLE line may name .claude/skills/shared — it is the ancestor engine\'s layout, and '
    + 'probing it let a consumer directory that merely shared the name be copied in as doctrine');
});

test('the resolution still requires the doctrine to BE there, not just the folder', () => {
  // The snapshot's old list matched on existsSync(dir). DOCTRINE_PATH matched on the file inside.
  // Sharing one owner means the weaker test is gone, and that is the half worth pinning: a
  // directory is admitted because it contains the protocol, not because of what it is called.
  assert.match(graph, /DOCTRINE_DIR = \[[\s\S]*?\]\.find\(\(d\) => fs\.existsSync\(path\.join\(d, 'disk-first-protocol\.md'\)\)\)/,
    'the directory must be selected by containing disk-first-protocol.md');
});

test('a legacy directory no longer stamps a run', () => {
  const mint = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  // The stamp is for genuine NAME collisions, which --inline-skill mitigates but does not close:
  // a node can still invoke a colliding name during its work. A legacy directory nothing reads
  // tells a gate reader nothing true, so it is printed and not stamped.
  assert.match(mint, /if \(shadowed\.length\) \{[\s\S]*?stamps\.push\('SKILLS-SHADOWED'\)/,
    'a real name collision still stamps');
  assert.ok(!/shadowed\.length \|\| legacy\.length/.test(mint),
    'but a legacy directory must not, now that nothing resolves it');
  assert.match(mint, /does not affect the run and is not stamped/,
    'and the note must say so plainly, so nobody reads it as work to do');
});
