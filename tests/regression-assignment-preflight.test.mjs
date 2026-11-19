// An invalid model or effort must fail at MINT, not two hours later on a node nobody runs often.
//
// Most nodes launch in the first minute. The tie-breaker launches only when a lens and an external
// arm explicitly contradict each other; `ui-audit` only when a project declares a UI surface. A
// typo in either one's model or effort therefore surfaces late, on the rare node, after the run has
// already spent its quota — and it arrives looking like a transport failure rather than like a
// misspelling in a config file. That is the worst diagnostic shape a failure can have, and it is
// the shape this framework spent a week eliminating from its own panel (a 15-minute arm timeout
// that read as a broken transport for weeks).
//
// WHAT IS AN ERROR AND WHAT IS A WARNING, because getting that wrong makes the check harmful:
//
//   * An EFFORT vocabulary is a CLOSED SET. The CLI parses a fixed enum and rejects anything else,
//     so checking it here cannot produce a false refusal.
//   * A MODEL list is not closed. Vendors ship new models constantly, and a preflight that blocks a
//     model released last week is a worse failure than the crash it prevents. Unknown model =
//     warning, never fatal.
//
// The sharp case is neither, and it was live in this repository: agy takes `--effort` for most
// models and REJECTS it for names that already carry the effort in the label — such as the pinned
// tie-breaker `Gemini 3.1 Pro (High)`. Two documents disagreed about this for weeks
// (shared/external-reviewers.md said agy takes --effort; the roster note said it is rejected for
// these names), both were half right, and nothing enforced either.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import { validateAssignment, validateRoster } from '../scripts/lib/capabilities.mjs';

const TABLE = builtinReviewers();
const resolve = (n) => TABLE[n];
const ROSTER = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(ROSTER));

test('the shipped roster is valid', () => {
  // The live assertion. If this fails, the framework is about to spawn something its own adapter
  // table says will be refused.
  const { errors } = validateRoster(ROSTER, resolve, { defaultRuntime: 'claude' });
  assert.deepEqual(errors, []);
});

test('an effort the runtime does not parse is an error', () => {
  const r = validateAssignment(TABLE.claude, { model: 'opus', effort: 'turbo', name: 'claude', label: 'lens x' });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /not an effort 'claude' accepts \(low\|medium\|high\|xhigh\|max\)/,
    'and the message must list what IS accepted — a refusal that does not say what to write instead '
    + 'sends the reader to the source');
});

test('an effort assigned to a model that already encodes one is an error', () => {
  // THE CASE THAT WOULD HAVE FIRED HOURS IN. An adjudicator spawns only on a genuine cross-family
  // dispute, which this repository has produced twice in its whole history.
  const bad = clone();
  const agy = bad.adjudicators.find((j) => j.reviewer === 'agy');
  assert.ok(agy, 'the judge set must contain the agy entry this case is about');
  agy.effort = 'high';
  const { errors } = validateRoster(bad, resolve, { defaultRuntime: 'claude' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /adjudicator/);
  assert.match(errors[0], /already encodes its effort/);
});

test('regression: EVERY adjudicator is preflighted, not just the first', () => {
  // The judge set replaced a `tie_breaker` singleton, and a preflight that checked one entry would
  // let a second judge's pairing fail on the rarest node in the graph, hours into a run.
  const bad = clone();
  assert.ok(bad.adjudicators.length >= 2, 'this test needs a set, not a singleton');
  // A DETECTABLE fault, on a NON-FIRST entry. The first attempt gave the last judge a nonsense
  // effort LEVEL, which this preflight does not check — deliberately, since it refuses to be strict
  // about vocabularies vendors change — so the test passed for the wrong reason and proved nothing
  // about iteration. `codex-review` takes no reasoning effort at all, and that it does check.
  // It REPLACES the codex judge rather than joining it: codex-review is family openai like codex (one family rule,
  // runtime-call-telemetry.plan.md stage 1), so two of them would rightly add a second error, two judges of one family.
  bad.adjudicators = [...bad.adjudicators.filter((j) => j.reviewer !== 'codex'),
    { id: 'adj-last', reviewer: 'codex-review', model: 'm', effort: 'high' }];
  assert.ok(bad.adjudicators.length >= 2 && bad.adjudicators.at(-1).id === 'adj-last', 'the faulty judge is not the first');
  const { errors } = validateRoster(bad, resolve, { defaultRuntime: 'claude' });
  assert.equal(errors.length, 1, 'the LAST judge in the set must still be checked');
  assert.match(errors[0], /adjudicator adj-last/);
  assert.match(errors[0], /takes no reasoning effort/);
});

test('an effort given to an adapter that takes none is an error', () => {
  const r = validateAssignment(TABLE['codex-review'], { model: 'm', effort: 'high', name: 'codex-review', label: 'arm x' });
  assert.match(r.errors[0], /'codex-review' takes no reasoning effort/,
    'the message must name the ADAPTER, not its binary — codex and codex-review share a cmd, and an '
    + 'error pointing at the wrong config line costs more than the crash it replaced');
});

test('an unknown model is a WARNING, never an error', () => {
  // A preflight that refuses a model the vendor shipped last week is worse than the crash it is
  // preventing. This is the one place the check deliberately declines to be strict.
  const withList = { ...TABLE.claude, known_models: ['opus', 'sonnet'] };
  const r = validateAssignment(withList, { model: 'opus-4.9-brand-new', effort: 'high', name: 'claude', label: 'lens x' });
  assert.deepEqual(r.errors, [], 'an unknown model must not stop a run');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /check the spelling/);
});

test('a reviewer nobody declared is named, not resolved to nothing', () => {
  const bad = clone();
  bad.panel_arms[0].reviewer = 'grok';
  const { errors } = validateRoster(bad, resolve, { defaultRuntime: 'claude' });
  assert.match(errors[0], /arm panel-codex-arch: no adapter named 'grok'/);
});

test('a lens with an assignment but no resolvable runtime says so plainly', () => {
  // It used to report `no adapter named 'null'`, which sends a reader looking for an adapter by
  // that name.
  //
  // THE ASSIGNMENT IS PUT THERE BY THIS TEST, not borrowed from the shipped roster. It used to rely
  // on whichever lens happened to carry a per-lens `effort`, which was code-audit's `medium` -- so
  // retiring that pin on 2026-09-20 (the sweep made medium the contract-wide default and a per-lens
  // copy a second owner of one fact) deleted this test's subject and the assertion failed. A
  // validator test that depends on production config passing through a particular shape is testing
  // the config, and it fails for a reason that has nothing to do with the behaviour it names.
  const bad = clone();
  bad.lenses[0] = { ...bad.lenses[0], effort: 'medium' };
  const { errors } = validateRoster(bad, resolve, {});   // no default supplied
  assert.ok(errors.some((e) => /no runtime resolved/.test(e)));
  assert.ok(!errors.some((e) => /named 'null'/.test(e)));
});

test('an unparseable rejection pattern is the adapter author\'s bug, and is reported', () => {
  const broken = { cmd: 'x', effort: { style: 'flag', flag: '-e', rejected_when_model_matches: '([' } };
  const r = validateAssignment(broken, { model: 'm', effort: 'high', name: 'x', label: 'arm y' });
  assert.match(r.errors[0], /unparseable effort\.rejected_when_model_matches/,
    'a malformed pattern must not pass silently as "no rule" — that is a check that quietly stops checking');
});

test('the mint wires the preflight, and treats errors as fatal', () => {
  // NOT AN END-TO-END MUTATION TEST, deliberately. The obvious version writes a broken roster into
  // scripts/, runs new-run, and restores it — and it passed. It is also unsafe: check-counted-facts
  // spawns an inner `node --test` over the whole suite, so every test file runs TWICE and
  // CONCURRENTLY during a full run, and a second test reading scripts/lens-roster.json while this
  // one has it broken fails for a reason that has nothing to do with what it was testing. That is
  // the third instance of that hazard today; the behaviour is covered by the pure checks above, and
  // what remains to pin is the wiring.
  const code = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(code.includes('validateRoster('), 'new-run must check every assignment before anything spawns');
  const at = code.indexOf('validateRoster(');
  const block = code.slice(at, at + 500);
  assert.match(block, /if \(errors\.length\)/, 'errors must stop the mint');
  assert.match(block, /die\(/, 'and stop it loudly');
  assert.match(block, /for \(const w of warnings\)/, 'while warnings are printed and the run continues');
});

test('spawn-node validates effort against the RUNTIME, not a hardcoded list', () => {
  const code = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/'xhigh'/.test(code),
    'the effort vocabulary was a hardcoded array here — one CLI\'s set applied to every node, so a '
    + 'runtime with a different one had valid values refused and invalid ones passed through');
  assert.ok(code.includes('validateAssignment('), 'it asks the runtime now');
});
