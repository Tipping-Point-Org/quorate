// EVERY LENS WAS TOLD TO READ A DIFFERENT REQUEST FROM THE ONE THE RUN RECORDED.
//
// `doc_roles.request` says what the REPOSITORY declares. `run.json.request` says what THIS RUN is
// judged against, and new-run.mjs resolves it as `explicit || declared` — so `--request <path>`
// overrides the contract, which is the documented way to point a run at a different ask without
// editing CLAUDE.md.
//
// Every brief built its "Declared documents" block straight from `contract.doc_roles`, at three
// separate sites in run-graph. So the override reached run.json and reached intent-capture, and
// never reached the briefs.
//
// MEASURED on run 20260915-191832-p1-rederive, minted with --request:
//
//   run.json.request : .claude/requests/per-functionality-auth-selection.md
//   8 lens briefs    : .claude/requests/adjudication-merge-for-disputes.md   <- a COMPLETED ask
//
// The cost is bounded and worth stating exactly, because overstating it is its own defect: the
// CRITERIA came from the right request (I-38/39/40 are in that run's intent.md and contract-audit
// cited them), so no lens judged against the wrong criteria. What broke is that a lens which goes
// and READS the named file reads a finished ask, and a lens reasoning about which request it is
// judging has two answers available in its own artifacts. Reported three times, status reopened.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { effectiveDocRoles } from '../scripts/lib/decisions.mjs';

const DECLARED = { architecture: 'ARCHITECTURE.md', roadmap: '', request: '.claude/requests/old.md' };

test('the run request wins over the declared one', () => {
  const roles = effectiveDocRoles(DECLARED, '.claude/requests/new.md');
  assert.equal(roles.request, '.claude/requests/new.md',
    'a run minted with --request is judged against that file, so that is the file its briefs name');
  assert.equal(roles.architecture, 'ARCHITECTURE.md', 'no other role may move');
  assert.equal(roles.roadmap, '', 'an empty role stays empty rather than being dropped');
});

test('with no run request the contract stands unchanged', () => {
  assert.deepEqual(effectiveDocRoles(DECLARED, null), DECLARED);
  assert.deepEqual(effectiveDocRoles(DECLARED, '   '), DECLARED,
    'blank is absent — it must not blank out a declared request');
  assert.deepEqual(effectiveDocRoles(DECLARED), DECLARED);
});

test('it does not mutate the contract it was handed', () => {
  const src = { ...DECLARED };
  effectiveDocRoles(src, '.claude/requests/new.md');
  assert.equal(src.request, '.claude/requests/old.md',
    'the contract snapshot is the record of what the repository declared; editing it in place would '
    + 'make run.json disagree with contract.snapshot.md and lose which was which');
});

test('an absent doc_roles is an empty set, not a crash', () => {
  assert.deepEqual(effectiveDocRoles(undefined, null), {});
  assert.deepEqual(effectiveDocRoles(null, '.claude/requests/new.md'), { request: '.claude/requests/new.md' });
});

// THE PROPERTY, not a name in the source. Asserting the ABSENCE of direct access is what makes this
// different from the guard that let G-63 ship: that one asserted a string was PRESENT, which a
// comment satisfied. A raw read of contract.doc_roles anywhere in run-graph is the defect itself.
test('run-graph never builds a brief from the contract doc_roles directly', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8')
    .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  // Passing it INTO the owner is the correct use, so only a read OUTSIDE that call counts. The
  // first version of this assertion counted every occurrence and so failed against the fixed
  // code — a test that goes red for its own reason proves nothing about the defect it names.
  const raw = (src.match(/(?<!effectiveDocRoles\()contract\.doc_roles/g) ?? []).length;
  assert.equal(raw, 0,
    `run-graph reads contract.doc_roles directly ${raw} time(s). Each one is a brief that ignores `
    + '--request. The three sites that had this were 727, 829 and 1416, and a fix applied to one of '
    + 'them is exactly how this defect survived three sightings.');
  assert.match(src, /effectiveDocRoles\(/, 'the briefs must come from the one owner');
});
