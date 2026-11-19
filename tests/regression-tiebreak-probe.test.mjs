// The tie-break path is the one this framework can least afford to leave unexercised, and the one
// nothing exercises.
//
// An arm's transport runs on every panel sweep, while the tie-breaker fires ONLY when a lens and an
// external arm explicitly contradict each other. This repository has produced a genuine dispute TWICE
// in its history, and the 2026-09-10 sweep reconciled 66 groups with zero disputed — so a defect there
// sits in a green tree until the moment a cross-family disagreement actually needs deciding.
//
// The operator put it exactly: "the sweep is being run to test the code, so if the tie-breaker is
// not fired then it is also not tested." A dispute cannot be summoned on demand. It can be
// simulated. check-tiebreak.mjs did that until reviewer-preflight stage 4; the simulation is now the
// tie-break PROBE inside external-review.mjs (runProbe, with lib/reviewer-probe.mjs's probeDispute),
// which every judge must pass before it is called, and check-reviewers.mjs runs it on demand.
//
// WHAT THESE TESTS PIN is everything about that probe that can be checked without spending: that it
// renders the real prompt through the real builders, that its dispute has an answer, that it
// distinguishes "round-tripped" from "actually ruled" — because a reviewer that answers without
// filling `supports` is the precise defect tie-break mode was created to fix — and that the judges it
// checks are the CONFIGURED ones. Refusing to spend unasked and the depth guard are
// regression-reviewer-preflight's, for check-reviewers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, REPO_ROOT } from './helpers.mjs';
import { buildTieBreakPrompt } from '../scripts/io/review-prompts.mjs';
import { probeDispute, probePassed, rosterCombinations } from '../scripts/lib/reviewer-probe.mjs';

const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
const ER = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
// From probeInput, which builds the probe's input for runProbe and for a --probe-run child's check (G-2 of
// 20261020-172345-argv-remediation-review), through the end of runProbe.
const PROBE = ER.slice(ER.indexOf('function probeInput('), ER.indexOf('\n}\n', ER.indexOf('function runProbe(')));

test('it checks the CONFIGURED adjudicators, every one, and refuses a reviewer it does not know', () => {
  // check-panel shipped a declared reviewer unprobed because it read only the built-in table, and the singleton
  // tie_breaker this replaced meant a panel whose SECOND vendor was misconfigured passed and failed on the rarest node.
  const judges = rosterCombinations(roster).filter((c) => c.mode === 'tie-break').map((c) => c.reviewer);
  assert.deepEqual(judges, (roster.adjudicators ?? []).filter((j) => j?.reviewer).map((j) => j.reviewer),
    'every declared judge, from lens-roster.json');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'check-reviewers.mjs'), 'utf8');
  assert.match(src, /rosterCombinations\(roster\)/, 'check-reviewers takes them from the same function as the mint');
  assert.ok(!/'agy'|'codex'/.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')),
    'no vendor name may appear in a decision there');
  const r = runScript('check-reviewers.mjs', ['--reviewer', 'nosuchreviewer'], { env: { QUORATE_LIVE: '1' } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not in the adapter table/);
});

test('the synthetic dispute has a determinable answer, and a WRONG ruling still passes the probe', () => {
  // A probe whose question had no right answer would report "did not rule" for a reviewer behaving perfectly —
  // indistinguishable from a broken transport. And a wrong ruling is a model signal, not a transport defect: the
  // probe passes on any legible vote, so a bad day does not refuse a working judge.
  const group = probeDispute({ armSource: 'codex', armNodeId: 'panel-codex-code' });
  assert.match(group.excerpt.body, /returns immediately/, 'the excerpt must settle the question');
  const participants = group.findings.map((f) => f.node_id);
  assert.equal(probePassed('tie-break', { status: 'ok', supports: 'code-audit' }, { participants }), true);
  assert.equal(probePassed('tie-break', { status: 'ok', supports: 'panel-codex-code' }, { participants }), true,
    'the wrong answer is still a ruling');
});

test('round-tripping is not the same as ruling', () => {
  // THE DEFECT TIE-BREAK MODE EXISTS TO FIX. Squeezed into the review envelope, every measured tie-break came back
  // `verdict PASS, findings: 0` — a ruling with no field to put the ruling in. Reporting that as passed would hide it.
  assert.equal(probePassed('tie-break', { status: 'ok', verdict: 'PASS', findings: [] }), false,
    'a vote requires `supports`, not merely a reachable transport');
  assert.equal(probePassed('tie-break', { status: 'refused', supports: 'neither' }), false, 'a refusal is not a ruling');
});

test('the prompt it sends is the real one, fully rendered', () => {
  // If the probe built its own prompt, it would exercise a path no run takes — the thing it exists
  // to prevent. This renders through the same builder run-graph uses.
  const prompt = buildTieBreakPrompt({
    // NO REVIEWER. The brief is blind — one rendering handed to every judge verbatim, because a
    // panel whose members read differently worded questions measures the wording rather than the
    // dispute. It used to open "You are <vendor>, the independent tie-breaker", which was both a
    // per-judge document and a statement that this judge's vote decides.
    groupId: 'G-0',
    judgeCount: (roster.adjudicators ?? []).length,
    file: 'scripts/lib/example.mjs',
    line: 12,
    rationale: 'a lens and an arm disagree',
    findings: [{ node_id: 'code-audit', claim: 'a' }, { node_id: 'panel-codex-code', claim: 'b' }],
    excerpt: { ok: true, from: 10, to: 14, of: 40, body: '  return item;' },
  });
  assert.ok(!/\{\{[a-z_]+\}\}/i.test(prompt), 'no unfilled slot may reach a reviewer');
  assert.match(prompt, /supports/, 'it must ask for the field the ruling goes in');
  // 'Judge constraints' since G-17: the fragment was titled for the role the brief spends a
  // paragraph denying, and landed three lines after the denial.
  assert.match(prompt, /# Judge constraints/, 'and carry the constraints for THIS mode');
  // And the probe renders through it, from the shared brief — not a prompt of its own.
  assert.ok(PROBE.includes('buildTieBreakPrompt('), 'the probe must use that builder');
  assert.match(PROBE, /adjudicationBrief\(\{ group, excerpt: group\.excerpt \}\)/, 'from the brief run-graph builds');
});

test('a reachable tie-breaker is described by the field its mode HAS', async () => {
  // FOUND BY THE FIRST LIVE RUN. The probe reported `state reachable — verdict undefined`: a
  // tie-break envelope carries `supports` and has no verdict at all, so the classifier was
  // describing a field the mode does not define. Harmless to the state, and exactly the kind of
  // wrong-but-passing detail that teaches a reader to stop reading the reason.
  const { classifyPanelProbe } = await import('../scripts/lib/decisions.mjs');
  const tie = classifyPanelProbe(
    { schema_version: 1, source: 'agy', status: 'ok', supports: 'code-audit', not_checked: [] }, 'agy',
  );
  assert.equal(tie.state, 'reachable');
  assert.equal(tie.reason, 'supports code-audit');
  assert.ok(!/verdict/.test(tie.reason), 'a tie-break has no verdict to report');

  // And a review envelope is unchanged — the fix must not describe the wrong field in the other
  // direction.
  const review = classifyPanelProbe(
    { schema_version: 1, source: 'codex', verdict: 'PASS', findings: [], not_checked: [] }, 'codex',
  );
  assert.equal(review.reason, 'verdict PASS');
});

// PRESENT-BUT-EMPTY WAS READ AS TOP LEVEL (G-6, contract-audit against I-16).
//
// `Number('')` and `Number(' ')` are both 0, so a GRAPH_NODE_DEPTH that is present and says nothing
// passed `Number.isInteger(0) && 0 >= 0` and was treated as depth zero — in all seven scripts
// carrying the guard, whose own header claims it "fails CLOSED on a value it cannot read". The only
// test for the case used 'yes', which coerces to NaN and takes the other branch, so the empty-string
// path was untested everywhere. Nothing in the engine emits an empty value: this failed open only to
// a corrupted or externally supplied environment, which is precisely the case a guard like this is
// for.
test('every depth-guarded script refuses an empty GRAPH_NODE_DEPTH', async () => {
  const guarded = ['run-graph.mjs', 'external-review.mjs', 'spawn-node.mjs', 'new-run.mjs',
    'run-checks.mjs', 'check-reviewers.mjs', 'bench-lenses.mjs'];

  for (const script of guarded) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', script), 'utf8');
    // One owner since entrypoint-argv.plan.md stage 2: each script reads the depth through nodeDepth, and nodeDepth is
    // what refuses the blank value (its case table, tests/regression-node-depth.test.mjs).
    assert.match(src, /nodeDepth\(process\.env\)/, `${script} parses the depth itself rather than through nodeDepth`);
  }
  // The behaviour, not its spelling: the parse's text changed with G-9 of 20261020-151402-argv-delivery.
  const { nodeDepth } = await import('../scripts/lib/node-depth.mjs');
  for (const value of ['', '   ']) assert.equal(nodeDepth({ GRAPH_NODE_DEPTH: value }).depth, null, `nodeDepth reads ${JSON.stringify(value)} as a depth`);

  // And end to end for the ones that reach the guard before any other argument check.
  for (const script of ['run-graph.mjs', 'external-review.mjs', 'spawn-node.mjs']) {
    for (const value of ['', '   ']) {
      // mayFanOut: the depth guard is the FIRST thing each script does, so nothing is derived and
      // nothing is spawned. helpers.mjs's spend guard refuses run-graph without it.
      const r = runScript(script, ['--run-dir', '.'], { env: { GRAPH_NODE_DEPTH: value }, mayFanOut: true });
      assert.equal(r.status, 3, `${script} must exit 3 on ${JSON.stringify(value)}, got ${r.status}`);
      assert.match(r.output, /not a non-negative integer/);
    }
    // A real depth still works, so the guard is not refusing everything.
    const ok = runScript(script, ['--run-dir', '.'], { env: { GRAPH_NODE_DEPTH: '0' }, mayFanOut: true });
    assert.notEqual(ok.status, 3, `${script} must accept a well-formed depth`);
  }
});

test('regression: a tie-break that did not rule records WHY, like the arms already do', () => {
  // Measured in the story-pipeline sandbox fixture, on the first full consumer-mount run:
  // tiebreak-G-17 and tiebreak-G-32 both came back DEGRADED with `ruling: null`, no error, no
  // validator_errors and no stderr -- two contradictions left unadjudicated with nothing at all
  // to say why, on a run whose agy transport had round-tripped thirty minutes earlier.
  //
  // The cause was three INDEPENDENT `try { JSON.parse(r.stdout) } catch { DEGRADED / null }`
  // blocks over the same string. Each threw its diagnostic away separately, at the exact moment
  // it became the only evidence there was. The panel ARMS do this correctly -- panel-codex-docs
  // explained itself in one line in that same gate -- so one of the two external spawn sites had
  // been taught to keep its diagnostics and the other had not.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const block = src.slice(src.indexOf('const JUDGES ='));

  // ONE parse, named, so the three consumers cannot disagree about the same bytes. Comment lines
  // are excluded, because the prose explaining the fix necessarily quotes the code it removed --
  // the same exclusion the sibling vendor-threading test makes, for the same reason.
  const code = block.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.equal((code.match(/JSON\.parse\(r\.stdout\)/g) ?? []).length, 1,
    'exactly one parse: three independent ones is three chances to disagree about the same bytes');
  assert.match(block, /const tbEnvelope = /);
  assert.match(block, /const tbProbe = classifyPanelProbe\(tbEnvelope, judge\.reviewer\)/,
    'classified against the judge that answered, not against a single configured vendor');

  // The reason survives into the artifact, under the key the arms use and the gate reads.
  // Both branches name the judge: one refused by its preflight (G-11 of 20261009-232840), and any other unavailability.
  assert.match(block, /validator_errors: \[preflightRefusal\(tbProbe\.reason\)\s*\?\s*`adjudicator '\$\{judge\.reviewer\}' refused before its call/,
    'and the artifact names WHICH judge was refused -- with a panel, "the adjudicator" is ambiguous');
  assert.match(block, /: `adjudicator '\$\{judge\.reviewer\}' unavailable/,
    'and the artifact names WHICH judge was unavailable -- with a panel, "the adjudicator" is ambiguous');
  assert.match(block, /stderr_excerpt:/, 'a vendor that dies before emitting an envelope says so on stderr');
  assert.match(block, /stdout_excerpt: tbEnvelope \? null :/,
    'the unparseable bytes are kept, and withheld when they parsed -- the envelope is then the record');

  // And into reconciled.md, which second-opinion audits and the gate summarises. "(tie-breaker did
  // not answer)" covered missing, refused, timed out and unparseable -- four problems with four
  // different fixes, handed to the reader as one sentence.
  // And into reconciled.md, per judge. "(tie-breaker did not answer)" covered missing, refused,
  // timed out and unparseable -- four problems with four different fixes -- and with a panel it also
  // hid WHICH judge was silent, which decides whether the group has a second vote at all.
  assert.match(block, /no vote — \$\{judge\.reviewer\} \$\{tbProbe\.state\}: \$\{tbProbe\.reason\}/);
});
