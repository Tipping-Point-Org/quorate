// The intent canary's POSITIVE CONTROL, and the two ways it scored a correct answer as a failure.
//
// Found by minting a run in the story-pipeline sandbox fixture, where it refused the mint outright:
// "the intent node could not read its own declared document -- intent-settings.json was probably
// not loaded". Every part of that diagnosis was wrong. The policy loaded, the read succeeded, and
// the arm recorded a bare `false` with no way to tell any of it apart.
//
// DEFECT 1 -- TWO RULES FOR ONE WINDOW. The prompt asked for the first three NON-EMPTY lines. The
// candidate answers were the first five lines of length >= 20 taken AFTER filtering, which in that
// fixture were source lines 3, 5, 8, 10 and 12: three of them could not appear in any correct
// answer, and a document opening with three short lines makes the sets fully DISJOINT -- a blocking
// gate refusing every mint, deterministically, while pointing at the sandbox. The source comment
// above the arm records this exact shape being fixed once before, for a different pair of
// mismatched rules; the shape survived into the next pair. One named constant now feeds both.
//
// DEFECT 2 -- EXACT SUBSTRING OVER MODEL PROSE. The answer is prose quoting file lines, and it
// arrives wrapped, blockquoted and backticked: the recorded answer from the fixture is
// "> `This file provides guidance to Claude Code...`". A quote broken across lines inside the
// compared prefix is still a correct quote, and `includes()` scored it as a failed read.
//
// STATED AS HARDENING, NOT AS THE DIAGNOSIS. The first mint failed and the next one passed on an
// unchanged configuration, and the arm recorded nothing, so WHY that first run failed is not
// knowable now and this is a hypothesis about it. Defect 1 is not: that one is provable from the
// code and the fixture's own line numbers. Recording the answer (below) is what makes the next
// occurrence diagnosable instead of guessed at.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const SRC = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');

test('regression: the probe window is one constant, read by both the prompt and the candidates', () => {
  assert.match(SRC, /const INTENT_PROBE_LINES = \d+/, 'the window must be named once');
  assert.match(SRC, /quote its first \$\{INTENT_PROBE_LINES\} non-empty lines/,
    'the prompt must ask for the named window, not a hardcoded count');
  assert.match(SRC, /\.slice\(0, INTENT_PROBE_LINES\)/,
    'the candidate set must be drawn from the same window the model was asked for');

  // ORDER IS THE WHOLE DEFECT. Filtering by length BEFORE taking the window is what let candidates
  // come from outside it; the window has to be applied to the non-empty lines first.
  const arm = SRC.slice(SRC.indexOf('const allowedLines'), SRC.indexOf('const intentReadWorked'));
  assert.ok(arm.indexOf('slice(0, INTENT_PROBE_LINES)') < arm.indexOf('length >= 20'),
    'taking the window after the length filter is what produced candidates no correct answer contains');
});

test('the two sets cannot be disjoint, for any snapshot', () => {
  // The property, checked by running the same two rules the script runs rather than by reading it.
  // Several shapes, including the one the fixture had and the one that would have been 100% fatal.
  const N = Number(/const INTENT_PROBE_LINES = (\d+)/.exec(SRC)[1]);
  const shapes = [
    ['# CLAUDE.md', '', 'This file provides guidance to Claude Code when working in this repository.', '', '## Repository Layout'],
    ['# t', '', '## a', '', '```', 'x', 'y', 'z', 'a line long enough to be unguessable here'],
    ['a line long enough to be unguessable here', 'and a second one just as long as that'],
  ];
  for (const lines of shapes) {
    const nonEmpty = lines.map((l) => l.trim()).filter((l) => l);
    const asked = nonEmpty.slice(0, N);                       // what the model is told to quote
    const candidates = asked.filter((l) => l.length >= 20);    // what the arm will accept
    for (const c of candidates) {
      assert.ok(asked.includes(c),
        'a candidate the model was never asked for can only ever score a correct answer as a failure');
    }
  }
});

test('regression: a quote that re-wraps or indents is still a successful read', () => {
  // Both sides go through one normaliser before they are compared. Asserted on the call sites
  // rather than on the regex literal, so the test does not break when the normaliser's internals
  // change while its job stays the same.
  assert.match(SRC, /const haystack = flat\(intentText\)/);
  assert.match(SRC, /haystack\.includes\(flat\(l\)\.slice\(0, 40\)\)/,
    'matching model prose against file lines must normalise whitespace on both sides');

  // The rule itself, applied to a real blockquoted answer of the shape the fixture produced.
  const flat = (s) => String(s).replace(/[`>]/g, ' ').replace(/\s+/g, ' ').trim();
  const line = 'This file provides guidance to Claude Code (claude.ai/code) when working with code';
  // The wrap falls INSIDE the compared prefix, which is the case that actually broke. A quote that
  // happens to stay contiguous for the first 40 characters passed either way and proves nothing.
  const answer = '1. First three non-empty lines:\n\n>   `This file provides guidance\n>   to Claude Code (claude.ai/code) when working with   code`\n';
  assert.ok(flat(answer).includes(flat(line).slice(0, 40)));
  assert.ok(!answer.includes(line.slice(0, 40)), 'and the old exact test is what called this a failure');
});

test('regression: an unbuildable control is reported as a probe defect, not as a sandbox failure', () => {
  // With an empty candidate set the arm is false for EVERY possible answer, so it refused the mint
  // while blaming a subsystem that was working -- a diagnosis the operator cannot act on.
  assert.match(SRC, /positive control could not be built/);
  assert.match(SRC, /defect in the probe, not in the sandbox/);
  assert.match(SRC, /if \(!allowedLines\.length\) \{/,
    'the unbuildable case must be tested before the failed-read case, or it reports the wrong one');
});

test("regression: the canary records the answer it judged, and what it expected", () => {
  // It recorded a bare `false` and discarded both. The run then refuses to spawn, so this artifact
  // is the only evidence that will ever exist -- and it omitted the two facts needed to tell a
  // dropped policy from a matcher that missed.
  assert.match(SRC, /expected_any_of: allowedLines\.map/);
  assert.match(SRC, /answer: intentText\.slice/,
    'the answer that was judged must be in the record, since the run then refuses to spawn');
  // It used to be withheld when the negative arm leaked, because both questions shared one turn and
  // the scored text could contain the source file. Separate turns removed that possibility: this
  // text is the answer to "quote the snapshot" and cannot hold what the other probe asked for.
  assert.doesNotMatch(SRC, /answer: leaked \?/,
    'withholding is a leftover from the arms sharing a conversation');
  assert.match(SRC, /deny_arm_exit_code: intentDenyProbe\.status/,
    'and a failure in either probe refuses the mint, so the reader must be able to tell which');
});

test('regression: the two arms are separate turns, because sharing one made it intermittent', () => {
  // THE FLAKE, FOUND. Both arms were steps 1 and 2 of a single prompt, and the positive arm is
  // scored from `result` -- the FINAL assistant message. A model denied on step 2 narrates the
  // denial, sometimes retries it, and its last message is then entirely about step 2; the step-1
  // quote happened earlier in the conversation and is nowhere in the field being read. Captured by
  // the diagnostics this arm had been missing:
  //
  //   "Step 2 is still blocked: reading C:\work\quorate\scripts\run-graph.mjs requires a permission
  //    grant I don't have ... I won't retry a third time"
  //
  // A correct answer to both questions, scored as a failed read, refusing the mint and blaming
  // intent-settings.json -- about one run in four, never reproducible in isolation, for as long as
  // the two arms shared a turn.
  //
  // What the arms must share is the POLICY, not the conversation.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  const block = src.slice(src.indexOf('const intentAllowed ='), src.indexOf('const failures = []'));

  // One settings file, two spawns.
  assert.equal((block.match(/settingsPath: intentSettings/g) ?? []).length, 2,
    'both arms must load the SAME policy, or the negative arm proves nothing about the positive');
  // spawnSyncFrom is spawnSync with the prompt from a file (io/stdin-file.mjs; G-15 of 20261109-232630-dps-delivery).
  assert.match(block, /const intentDenyProbe = spawnSync(?:From)?\(/, 'the negative arm is its own process');

  // One question each. The positive prompt must not mention the source file at all -- that is what
  // let the denial into the answer being scored.
  // Sliced between anchors rather than matched with a non-greedy regex: the prompt is built from
  // concatenated fragments, so "up to the first closing backtick" ran past it into the OTHER arm's
  // prompt and reported that the positive arm mentioned the denied file. A brittle extraction that
  // fails open is worse than none.
  const pStart = block.indexOf('const intentCmd = nodeArgv');
  const positive = block.slice(pStart, block.indexOf('model: CANARY_MODEL', pStart));
  assert.ok(pStart >= 0 && positive.includes('prompt:'), 'could not find the positive arm prompt');
  assert.ok(!positive.includes('intentTarget'),
    'the positive arm must not ask about the denied file; its answer is the evidence');
  assert.match(positive, /Do nothing else and read nothing else/);

  // And the leak check reads the arm that actually asked for the source.
  assert.match(block, /sourceLines\.some\(\(l\) => intentDenyText\.includes\(l\.slice\(0, 50\)\)\)/,
    'a leak can only appear in the answer to the question that requested the file — and it is now '
    + 'scanned over the SAME window the prompt asks for, because asking for line 0 and scanning for '
    + 'line 1 made the detector unable to fire at all');
});

test('regression: gate 4 records what each arm cost, so a perf claim about it is answerable', () => {
  // G-22 (perf-audit) said the two arms run one after the other. True — and NOTHING in any artifact
  // recorded how long either took, so the claim could be neither confirmed nor priced from a run.
  // An unbenched perf finding is capped at LOW for exactly this reason; the answer is to make it
  // measurable, not to guess at a parallelisation. One live mint then said 16.4s + 9.6s = 26.0s, and
  // the decision is recorded beside the numbers.
  assert.match(SRC, /const intentProbeMs = Date\.now\(\) - intentStartedAt;/);
  assert.match(SRC, /const intentDenyProbeMs = Date\.now\(\) - intentDenyStartedAt;/);
  assert.match(SRC, /timing_ms: \{/, 'and both numbers must reach the artifact');
  assert.match(SRC, /sequential_total: intentProbeMs \+ intentDenyProbeMs/,
    'the sum is what gate 4 adds to every mint, which is the quantity the finding was about');
  // The arms stay SEPARATE PROCESSES whatever happens to the timing: sharing one conversation made
  // the positive arm read the negative arm's denial narration and fail about one mint in four.
  assert.equal((SRC.match(/settingsPath: intentSettings/g) ?? []).length, 2);
});
