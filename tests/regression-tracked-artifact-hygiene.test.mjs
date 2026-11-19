// WHAT GETS COMMITTED IS A DECISION, AND IT WAS BEING MADE BY ACCIDENT.
//
// The reviews tree is split on purpose: `nodes/` and the canary records are TRACKED (27 canary
// records sit in this repository's history), while `evidence/` is gitignored precisely because it
// holds content. The rule that follows has been paid for twice already:
//
//   * run-checks.mjs strips `stderr_tail` from the tracked checks.json, because a captured
//     command's output may hold "a connection string, an environment dump, a token inside an error".
//   * external-review.mjs refuses any write path git would keep.
//
// And then broken twice more in one change set, both times by writing a subprocess's free text into
// a tracked artifact: the tie-break's status file (raised as a HIGH by security-audit on the sweep
// of that very commit) and both canary records. The canaries had never actually leaked -- every
// spawn succeeded and the field was null -- which is exactly why nobody looked: a loaded field in a
// tracked file reads identically to a safe one until the day it fires.
//
// This test is the rule rather than the instances: a tracked artifact may carry verdicts, counts,
// exit codes and PATHS. Free text out of a subprocess goes where git does not follow.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

test('the tracked/ignored split in a run directory is what this rule rests on', (t) => {
  // Asserted from git, not from a substring of .gitignore: what matters is the answer git gives.
  const ignored = spawnSync('git', ['check-ignore', '-q', '.claude/reviews/anyrun/evidence/x.log'],
    { cwd: REPO_ROOT });
  assert.equal(ignored.status, 0, 'evidence/ must be ignored, or there is nowhere safe to put text');
  // And the sibling records really are kept, which is what makes the rule necessary.
  const tracked = spawnSync('git', ['ls-files', '--', '.claude/reviews/*/sandbox-canary.json'],
    { cwd: REPO_ROOT, encoding: 'utf8' });
  // The public mirror tracks no run at all (ROADMAP D2), so there is no exposure there to show; said, not passed silently.
  // Asked of git, not of the folder: the suite's own tests write runs into .claude/reviews/ there.
  const anyRun = spawnSync('git', ['ls-files', '--', '.claude/reviews/'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
  if (!anyRun) {
    t.skip('no tracked runs: .claude/reviews/ is kept out of the public mirror (ROADMAP D2)');
    return;
  }
  assert.ok(tracked.stdout.trim().length > 0, 'canary records are committed; that is the exposure');
});

test('regression: no subprocess stderr is written into a TRACKED artifact', () => {
  // SCOPED TO THE KNOWN TRACKED RECORDS, and stated that way rather than as a global property. An
  // early version flagged every field named `stderr` anywhere in the file and caught spawnCapture's
  // own RETURN value -- an in-memory object, not an artifact. A test that has to be explained away on
  // each hit stops being read.
  //
  // TWO DEFECTS IN THIS TEST, both found by extending the canary record by seven lines:
  //
  //  * the window was `at + 2600`, so the closing `}),` of the stashed-detail call fell outside it,
  //    the excision below matched nothing, and a stashed field read as a committed one. The same
  //    slice a little longer would have failed the other way — ending before a real stderr field and
  //    passing on a record it never looked at.
  //  * `writeJson(path.join(nodesDir, ...status.json...)` has THREE call sites in run-graph and
  //    `indexOf` returns the first, which is `writeStatusStub` — the generic stub writer. So the row
  //    labelled "tiebreak status" has never once examined a tie-break status record, and it passed
  //    throughout the commit where a judge's vendor stderr really was being written into the tracked
  //    file. A guard that names the wrong object is worse than no guard: it reports the class as
  //    covered.
  //
  // Both are gone: the literal is delimited by matching its own braces, and EVERY status write site
  // is checked, because a defect in any of them is the same defect.
  const literalAt = (src, anchor, from = 0) => {
    const at = src.indexOf(anchor, from);
    if (at < 0) return null;
    const open = src.indexOf('{', at + anchor.length - 1);
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return { at, body: src.slice(open, i + 1), next: i }; }
    }
    return null;
  };

  const records = [
    // Written by the minted run's owner since run-dir-descendants.plan.md stage 2; the record's literal follows the name.
    ['scripts/new-run.mjs', 'sandbox-canary.json', "['sandbox-canary.json'],"],
    ['scripts/new-run.mjs', 'intent-canary.json', "['intent-canary.json'],"],
    // writeTrackedJson since ledger-trust-boundaries 1b: the status is a tracked write, redacted.
    ['scripts/run-graph.mjs', 'node status', 'writeTrackedJson(path.join(nodesDir, `${nodeId}.status.json`)'],
  ];
  let checked = 0;
  for (const [file, label, anchor] of records) {
    const src = read(...file.split('/'));
    let from = 0;
    let found = 0;
    for (;;) {
      const lit = literalAt(src, anchor, from);
      if (!lit) break;
      found++;
      from = lit.next;
      // Comments stripped, so the prose explaining the fix does not trip the check that the fix is in
      // place. The stash call is lexically INSIDE the literal -- `diagnostics:
      // stashCanaryDetail('...', { probe_stderr: ... })` -- and that nesting is the point: the field
      // exists, bound for a path git ignores. Excised, so what remains is only what gets committed.
      const obj = lit.body
        .replace(/stashCanaryDetail\([\s\S]*?\n\s*\}\),/g, 'diagnostics: <stashed>,')
        .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      const line = src.slice(0, lit.at).split('\n').length;
      assert.ok(!/^\s*\w*stderr\w*:/m.test(obj),
        `${file}:${line}: this ${label} record carries a stderr field, and git keeps that file`);
      assert.ok(!/^\s*probe_error:/m.test(obj),
        `${file}:${line}: this ${label} record carries a subprocess error string, and git keeps that file`);
      checked++;
    }
    assert.ok(found > 0, `could not find the ${label} write site in ${file}`);
  }
  // Non-vacuity: three anchors, and the status one has several call sites. A brace matcher that
  // returned null everywhere would satisfy every assertion above.
  assert.ok(checked >= 5, `only ${checked} tracked record(s) examined — the anchors stopped matching`);
});

test("regression: the tracked records cite a PATH to their diagnostics", () => {
  // Moving the text out is only half of it: a reader of the tracked record has to be able to find
  // it, or the fix trades a leak for an undiagnosable refusal -- and the run refuses to spawn when
  // these fail, so that record is the only thing pointing anywhere.
  const nr = read('scripts', 'new-run.mjs');
  assert.match(nr, /const stashCanaryDetail = /, 'one owner for parking canary diagnostics');
  assert.equal((nr.match(/diagnostics: stashCanaryDetail\(/g) ?? []).length, 2,
    'both canary records -- sandbox and intent -- must name their detail file');
  assert.match(nr, /evidence\/canary\/intent-canary-detail\.json, which git does not track/,
    'and the refusal message must send the reader to it');

  const rg = read('scripts', 'run-graph.mjs');
  assert.match(rg, /failure_detail: `evidence\/\$\{nodeId\}\/failure\.json`/,
    'the tie-break status file names its detail rather than quoting it');
  assert.match(rg, /vendor's stderr can carry a credential and this file is tracked/,
    'and says why, so the next person does not helpfully inline it again');
});
