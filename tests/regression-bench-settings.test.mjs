// G-18, G-7, G-20 of run 20260923-144706-session-bench.
//
// I-10 of `.claude/requests/model-and-effort-reevaluation.md`: "No model name or effort is
// introduced as a literal in a script", and A-9 extends that to vendor names. `bench-second-opinion`
// carried three — `?? 'opus'` at the spawn, `j.reviewer === 'codex'` choosing the default judge, and
// `?? 'claude'` naming the forge's CLI. The last is the SAME defect spawn-node already fixed and
// wrote down: "`args.runtime ?? 'claude'` put the one thing the adapter table exists to remove back
// into the orchestrator." The bench was the copy that was missed.
//
// The source scan below is not a G-59 grep-shaped proxy for behaviour. The claim IS about source
// text, so scanning it is the instrument rather than a stand-in for one — and the only behavioural
// route to the spawn's model argument is a paid `claude -p`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BENCH = path.join(ROOT, 'scripts', 'bench-second-opinion.mjs');

test('bench-second-opinion introduces no model, effort or vendor literal', () => {
  const src = fs.readFileSync(BENCH, 'utf8');
  // Comments are prose ABOUT the rule and must be able to quote the literal they forbid — the
  // paragraph above `defaultNodeRuntime` in spawn-node does exactly that. Only code is scanned.
  const code = src
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s+\/\/[^'"`]*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const banned = [
    [/\?\?\s*'opus'/, "a baked-in model fallback: lens-roster.json's default_models.judgment is the declared answer to an absent key"],
    [/\?\?\s*'sonnet'/, 'a baked-in model fallback'],
    [/reviewer\s*===\s*'codex'/, 'the default judge chosen by one vendor\'s name instead of a declared default'],
    [/\?\?\s*'claude'/, 'the node runtime named in the script instead of read from the adapter table'],
  ];
  const hits = banned.filter(([re]) => re.test(code)).map(([re, why]) => `${re} — ${why}`);
  assert.deepEqual(hits, [], `model/vendor literals in scripts/bench-second-opinion.mjs:\n  ${hits.join('\n  ')}`);
});

// ---------------------------------------------------------------- the decisions, as decisions
// The scan above says the literals are gone. These say what replaced them behaves, which the scan
// cannot: a `?? 'opus'` deleted and a wrong lookup put in its place passes a grep and fails a bench.

test('defaultJudge reads `default_judge`, and refuses to pick when several are declared', async () => {
  const { defaultJudge } = await import('../scripts/lib/bench-settings.mjs');
  const judges = [{ id: 'adj-agy', reviewer: 'agy' }, { id: 'adj-codex', reviewer: 'codex' }];

  const picked = defaultJudge(judges, { default_judge: 'adj-codex' });
  assert.equal(picked.ok, true);
  assert.equal(picked.judge.id, 'adj-codex');

  // NOT judges[0]. File order is not a decision anyone made, and silently taking it is how the
  // vendor literal this replaces got there in the first place.
  const undeclared = defaultJudge(judges, {});
  assert.equal(undeclared.ok, false);
  assert.match(undeclared.why, /does not pick a vendor/);

  // One adjudicator is not a choice, so no declaration is needed.
  assert.equal(defaultJudge([judges[1]], {}).judge.id, 'adj-codex');

  const wrong = defaultJudge(judges, { default_judge: 'adj-nobody' });
  assert.equal(wrong.ok, false);
  assert.match(wrong.why, /not in adjudicators/);
});

test('judgmentSetting prefers the candidate, then the frozen contract, then the roster default', async () => {
  const { judgmentSetting } = await import('../scripts/lib/bench-settings.mjs');
  const frozen = { review: { models: { judgment: 'frozen-model' }, effort: { judgment: 'high' } } };
  const rosterDefaults = { judgment: 'roster-model' };

  const inForce = judgmentSetting({ frozen, rosterDefaults });
  assert.deepEqual(
    [inForce.model, inForce.effort, inForce.is_candidate],
    ['frozen-model', 'high', false],
  );
  assert.deepEqual(inForce.source, { model: 'frozen-contract', effort: 'frozen-contract' });

  // The comparison I-3 asks for is impossible unless a candidate can override the setting in force.
  const cand = judgmentSetting({ candidate: { model: 'cheaper', effort: 'low' }, frozen, rosterDefaults });
  assert.deepEqual([cand.model, cand.effort, cand.is_candidate], ['cheaper', 'low', true]);
  assert.deepEqual(cand.source, { model: 'candidate', effort: 'candidate' });

  // Effort alone is a candidate too: model and effort are separate knobs (AC2).
  const effortOnly = judgmentSetting({ candidate: { effort: 'low' }, frozen, rosterDefaults });
  assert.deepEqual([effortOnly.model, effortOnly.effort, effortOnly.is_candidate], ['frozen-model', 'low', true]);

  assert.equal(judgmentSetting({ frozen: {}, rosterDefaults }).model, 'roster-model');

  // The refusal that `?? 'opus'` used to swallow.
  const nothing = judgmentSetting({ frozen: {}, rosterDefaults: {} });
  assert.equal(nothing.ok, false);
  assert.match(nothing.why, /will not invent one/);

  // An absent EFFORT is not the same class as an absent model: several runtimes take no effort flag.
  const noEffort = judgmentSetting({ frozen: { review: { models: { judgment: 'm' } } } });
  assert.deepEqual([noEffort.ok, noEffort.model, noEffort.effort], [true, 'm', null]);
});

test('the roster declares the default judge the bench relies on', () => {
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  assert.ok(roster.default_judge, 'lens-roster.json must declare default_judge');
  assert.ok((roster.adjudicators ?? []).some((j) => (j.id ?? j.reviewer) === roster.default_judge),
    `default_judge '${roster.default_judge}' names no declared adjudicator`);
});

// ------------------------------------------------------------------- G-7: the candidate setting
// AC1/AC2 of `.claude/requests/model-and-effort-reevaluation.md`, as I-3: "Every benched comparison
// runs the setting in force against lower settings, with model and effort varied as separate
// knobs." The harness took `--from --seed --judge --tolerance --keep --dry-run --rule --forge-only
// --rejudge --mutation --forged` and nothing else, so it could only ever measure `second-opinion`
// at the frozen setting — and the comparison the whole request exists for was unreachable for this
// position. Rejecting `--model` with "unknown argument" was the before-state.
import { spawnSync } from 'node:child_process';

const runBench = (argv) => spawnSync(process.execPath,
  [path.join(ROOT, 'scripts', 'bench-second-opinion.mjs'), ...argv],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GRAPH_NODE_DEPTH: '0' } });

test('the bench accepts a candidate model and effort as separate knobs', () => {
  // `--from` names a file that does not exist, so each invocation dies immediately AFTER argv
  // parsing and before any seed work. The assertion is about the parser, and running seven seeds'
  // dry runs three times to learn one fact about argv is the delegation trade this repository
  // already has a rule about.
  for (const argv of [['--model', 'sonnet'], ['--effort', 'low'], ['--model', 'sonnet', '--effort', 'high']]) {
    const r = runBench([...argv, '--from', 'no-such-result.json']);
    assert.doesNotMatch(r.stderr, /unknown argument/,
      `${argv.join(' ')} must be a candidate setting, not an unknown argument`);
    assert.match(r.stderr, /no bench result to mutate/,
      'it must get past argv parsing and fail on the missing result file instead');
  }
});

test('--rejudge refuses a candidate setting: nothing is spawned, so nothing ran at it', () => {
  const r = runBench(['--model', 'sonnet', '--rejudge', 'somewhere', '--from', 'no-such-result.json']);
  // Argv order does not decide which refusal fires; both are refusals, and either one means the
  // pass cannot label a re-scored report with a setting it was never produced at.
  assert.notEqual(r.status, 0, 'a candidate under --rejudge must refuse');
});

// AC2 bounds the search space, and the bound is asymmetric ON PURPOSE: "at the CURRENT model, only
// efforts LOWER than the one in force are tried — the question is whether cheaper suffices, so a
// higher effort on the same model answers nothing. At a SIMPLER model, ANY effort is admissible
// including a higher one, because a lower model at high effort against a higher model at low effort
// is a real trade and ruling it out by symmetry would hide it."
test('candidateAdmissible enforces AC2\'s asymmetric search space', async () => {
  const { candidateAdmissible } = await import('../scripts/lib/bench-settings.mjs');
  const ladder = ['low', 'medium', 'high', 'xhigh', 'max'];
  const inForce = { model: 'opus', effort: 'medium' };

  assert.equal(candidateAdmissible({ candidate: { model: 'opus', effort: 'low' }, inForce, ladder }).ok, true);

  const higher = candidateAdmissible({ candidate: { model: 'opus', effort: 'high' }, inForce, ladder });
  assert.equal(higher.ok, false);
  assert.match(higher.why, /answers nothing/);

  const same = candidateAdmissible({ candidate: { model: 'opus', effort: 'medium' }, inForce, ladder });
  assert.equal(same.ok, false, 'the setting in force is not a candidate against itself');

  // A DIFFERENT model opens the whole ladder, higher included.
  assert.equal(candidateAdmissible({ candidate: { model: 'sonnet', effort: 'max' }, inForce, ladder }).ok, true);
  assert.equal(candidateAdmissible({ candidate: { model: 'sonnet', effort: 'low' }, inForce, ladder }).ok, true);

  // An effort outside the runtime's declared vocabulary is a typo that would otherwise be spent on.
  const bogus = candidateAdmissible({ candidate: { model: 'opus', effort: 'lowish' }, inForce, ladder });
  assert.equal(bogus.ok, false);
  assert.match(bogus.why, /lowish/);

  // WITHOUT A DECLARED LADDER THERE IS NO 'LOWER', and inventing one would put an effort ordering
  // in a script — the literal class this whole module exists to keep out. Refuse, and say so.
  const noLadder = candidateAdmissible({ candidate: { model: 'opus', effort: 'low' }, inForce, ladder: [] });
  assert.equal(noLadder.ok, false);
  assert.match(noLadder.why, /no declared effort order/);
});

test('the claude node runtime declares its effort vocabulary AND that it ascends', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'reviewers.json'), 'utf8'));
  const eff = raw.reviewers?.claude?.node_runtime?.effort ?? {};
  assert.ok(Array.isArray(eff.values) && eff.values.length > 1, 'the runtime must declare its efforts');
  // ORDER IS A SEPARATE CLAIM FROM MEMBERSHIP. The list read as ascending, but the note called it
  // "the closed set this CLI parses" — a set. Reading an order out of array position would be the
  // same shape of unstated assumption this repository keeps paying for, so it is declared.
  assert.equal(eff.ascending, true,
    'AC2 needs to know which effort is LOWER; declare `ascending` rather than inferring it from order');
});

// ------------------------------------------------------------------ G-20: the admission gate
// I-7 and I-8. Before this, a bench result carried recall, caught and false alarms and stopped, so
// the only way to read two settings against each other was to compare aggregate recall by eye —
// which is exactly what AC8 forbids ("one seed flipping is 10-14% of the result").

// THE VOCABULARY COMES FROM THE SCORER, never from memory. The first draft of these helpers
// invented `caught`/`missed`/`false-alarm`, none of which any artifact contains — and because the
// gate had invented the same words, every test agreed with the code about a contract neither had
// read. A six-seed baseline then scored `seeds in force: 0` on the first live run.
const { IDENTIFIED: S_HIT, NOT_IDENTIFIED: S_MISS } = await import('../scripts/lib/second-opinion-scoring.mjs');
const seedRow = (seed, caught, falseAlarm = false, usage = null, ms = null) => ({
  seed,
  mutated: { state: caught ? S_HIT : S_MISS },
  control: { state: falseAlarm ? S_HIT : S_MISS },
  // FLAT, as `splitSpend` writes it. The first draft nested both under a per-node map that no
  // artifact has — the same invented-shape mistake as the state vocabulary, in the same file.
  spent: { usage: usage ?? null, duration_ms: ms },
});

test('a seed the current setting catches and the candidate misses REJECTS it, by name', async () => {
  const { admissionVerdict } = await import('../scripts/lib/bench-settings.mjs');
  const current = { seeds: [seedRow('a', true), seedRow('b', true), seedRow('c', true)] };
  const candidate = { seeds: [seedRow('a', true), seedRow('b', false), seedRow('c', true)] };

  const g = admissionVerdict({ current, candidate, fpTolerance: 0 });
  assert.equal(g.verdict, 'rejected');
  assert.deepEqual(g.regressed, ['b'], 'the regressing seed must be NAMED, not summarised as a rate');
  assert.equal(g.seeds_in_force, 3, 'the seed count travels with the verdict (AC8)');
});

test('a trade is still a rejection, however the totals look', async () => {
  const { admissionVerdict } = await import('../scripts/lib/bench-settings.mjs');
  // Aggregate recall is IDENTICAL at 2/3 either way. AC8: "A setting that trades one seed for
  // another is NOT adopted, however the totals look" — the clause an aggregate comparison passes.
  const current = { seeds: [seedRow('a', true), seedRow('b', true), seedRow('c', false)] };
  const candidate = { seeds: [seedRow('a', true), seedRow('b', false), seedRow('c', true)] };

  const g = admissionVerdict({ current, candidate, fpTolerance: 0 });
  assert.equal(g.verdict, 'rejected');
  assert.deepEqual(g.regressed, ['b']);
  assert.deepEqual(g.gained, ['c']);
  assert.match(g.why, /does NOT offset/);
});

test('no declared FP tolerance means UNDECIDED, never admitted', async () => {
  const { admissionVerdict } = await import('../scripts/lib/bench-settings.mjs');
  const current = { seeds: [seedRow('a', true), seedRow('b', true)] };
  const candidate = { seeds: [seedRow('a', true), seedRow('b', true)] };

  const g = admissionVerdict({ current, candidate });   // no fpTolerance
  assert.equal(g.verdict, 'undecided',
    'a gate that passes a clause it never evaluated is the failure mode I-7 exists to prevent');
  assert.equal(g.undecided_clause, 'false-positive rise');
  // The reason is the point: the request says "material" and quantifies nothing, and the run that
  // raised this recorded the same gap. Defaulting would put a number nobody chose in a gate.
  assert.match(g.why, /quantifies nothing/);

  // Declared, and the same data now decides.
  assert.equal(admissionVerdict({ current, candidate, fpTolerance: 0 }).verdict, 'admitted');
});

test('recall held but false alarms rose past the declared tolerance — rejected', async () => {
  const { admissionVerdict } = await import('../scripts/lib/bench-settings.mjs');
  const current = { seeds: [seedRow('a', true), seedRow('b', true)] };
  const candidate = { seeds: [seedRow('a', true, true), seedRow('b', true, true)] };

  assert.equal(admissionVerdict({ current, candidate, fpTolerance: 1 }).verdict, 'rejected');
  assert.equal(admissionVerdict({ current, candidate, fpTolerance: 2 }).verdict, 'admitted');
});

test('a seed that was NOT RUN cannot regress', async () => {
  const { admissionVerdict } = await import('../scripts/lib/bench-settings.mjs');
  // 'b' is absent from the candidate entirely — a corpus gap, not a detection failure. Counting it
  // as missed would reject a setting for something it was never asked to do.
  const current = { seeds: [seedRow('a', true), seedRow('b', true)] };
  const candidate = { seeds: [seedRow('a', true)] };

  const g = admissionVerdict({ current, candidate, fpTolerance: 0 });
  // THIS ASSERTION USED TO READ `regressed: ['b']`, with the reasoning that calling it a regression
  // was the way to keep the gap visible. The first live pass disproved it: a one-seed candidate run
  // against a six-seed baseline then reports five REGRESSIONS, which says the candidate failed to
  // catch what nobody asked it about. Unmeasured is its own state, and it still blocks admission.
  assert.deepEqual(g.regressed, [], 'never run is not missed');
  assert.deepEqual(g.unmeasured, ['b']);
  assert.equal(g.verdict, 'undecided', 'a partly-run corpus cannot support "no seed regressed"');
  assert.deepEqual(g.scored, { current: 2, candidate: 1 });
});

test('preferredSetting decides by dominance and the 10% tiebreak, and surfaces a genuine trade', async () => {
  const { preferredSetting } = await import('../scripts/lib/bench-settings.mjs');
  const res = (tok, ms, fa) => ({ seeds: [seedRow('a', true, fa, { input_tokens: tok }, ms)] });

  const dom = preferredSetting({ current: res(1000, 100, false), candidate: res(500, 50, false) });
  assert.equal(dom.rule, 'dominance');
  assert.equal(dom.preferred, 'candidate');

  // A REAL TIEBREAK NEEDS NON-DOMINANCE, and the first draft of this fixture did not have it:
  // 950 tokens AND faster is simple dominance, which fires first and correctly. The tiebreak is for
  // a candidate that costs slightly MORE tokens (1000 -> 1050, 5%) and is faster, where neither
  // side dominates and the standing 10%-band rule decides. The 10% is the REQUEST'S number.
  const tie = preferredSetting({ current: res(1000, 100, false), candidate: res(1050, 40, false) });
  assert.equal(tie.rule, 'tiebreak-10pct');
  assert.equal(tie.preferred, 'candidate');

  // Far fewer tokens but much slower, outside the band: not the tool's call.
  const trade = preferredSetting({ current: res(1000, 50, false), candidate: res(400, 900, false) });
  assert.equal(trade.rule, 'genuine-trade');
  assert.equal(trade.preferred, null, 'I-8 names resolving this here as a failure mode');
  assert.match(trade.why, /exchange rate/);

  // An absent metric is absent, never imputed as zero (AC4).
  const blind = preferredSetting({ current: res(1000, null, false), candidate: res(400, 50, false) });
  assert.equal(blind.rule, 'undecidable');
  assert.match(blind.why, /never imputed/);

  const notAdmitted = preferredSetting({ current: res(1000, 100, false), candidate: res(1, 1, false), admitted: false });
  assert.equal(notAdmitted.rule, 'not-admitted');
});

test('positionRecord distinguishes NOT BENCHED from measured-and-kept, and cites the run', async () => {
  const { admissionVerdict, positionRecord } = await import('../scripts/lib/bench-settings.mjs');
  const cur = { model: 'opus', effort: 'medium' };

  // AC10: a position nobody benched is NAMED as not benched. An omitted row reads as "measured and
  // fine" while meaning "nobody looked", which is the whole reason this vocabulary is specified.
  const none = positionRecord({ position: 'second-opinion', current: cur });
  assert.equal(none.verdict, 'not benched');
  assert.equal(none.measured_by, null);

  const gate = admissionVerdict({
    current: { seeds: [seedRow('a', true), seedRow('b', true)] },
    candidate: { seeds: [seedRow('a', true), seedRow('b', false)] },
    fpTolerance: 0,
  });
  const kept = positionRecord({
    position: 'second-opinion', current: cur, candidate: { model: 'opus', effort: 'low' },
    gate, measuredBy: 'bench/results/2026-09-23.json',
  });
  assert.equal(kept.verdict, 'not similar');
  assert.equal(kept.outcome, 'measured and kept', 'AC10: unchanged is MEASURED AND KEPT, not untouched');
  assert.equal(kept.setting, 'opus/medium');
  assert.equal(kept.candidate, 'opus/low');
  assert.equal(kept.measured_by, 'bench/results/2026-09-23.json',
    'a verdict nobody can trace to a run is an assertion');
  assert.deepEqual(kept.regressed, ['b']);
});

// ------------------------------------------------------- G-20: the gate has to be REACHABLE
// A decision layer nobody can run is the same absence as one that does not exist. These drive
// scripts/bench-admit.mjs end to end over written files, because the library tests above prove the
// rules and prove nothing about whether a person can get an answer out of them.

import os from 'node:os';

const writeResult = (dir, name, body) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(body, null, 2));
  return p;
};
const runAdmit = (argv) => spawnSync(process.execPath,
  [path.join(ROOT, 'scripts', 'bench-admit.mjs'), ...argv], { cwd: ROOT, encoding: 'utf8' });

const baseResult = (extra) => ({
  schema_version: 1, mutation: 'misanchor', injection_rule: 'rewrite', mutated_from: 'src.json', ...extra,
});
const row = (seed, caught, falseAlarm = false) => ({
  seed,
  mutated: { state: caught ? S_HIT : S_MISS },
  control: { state: falseAlarm ? S_HIT : S_MISS },
  spent: { usage: { 'second-opinion': { input_tokens: 1000 } }, durations: { 'second-opinion': 100 } },
  setting: { model: 'opus', effort: 'medium', in_force: { model: 'opus', effort: 'medium' } },
});

test('bench-admit reports a verdict, names regressed seeds, and exits non-zero on REJECTED', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-admit-'));
  try {
    const cur = writeResult(tmp, 'cur.json', baseResult({ candidate: null, seeds: [row('a', true), row('b', true)] }));
    const cand = writeResult(tmp, 'cand.json', baseResult({
      candidate: { model: 'opus', effort: 'low' }, seeds: [row('a', true), row('b', false)],
    }));

    const r = runAdmit(['--current', cur, '--candidate', cand, '--fp-tolerance', '0']);
    assert.match(r.stdout, /REJECTED/);
    assert.match(r.stdout, /REGRESSED:\s+b/, 'the regressing seed is named, not summarised as a rate');
    assert.match(r.stdout, /seeds in force: 2/, 'the seed count travels with the verdict (AC8)');
    assert.equal(r.status, 1, 'a rejected candidate must be a non-zero exit, so a script can gate on it');
    // A-20 / I-9: the bench tooling editing the contract or roster is a named failure mode.
    assert.match(r.stdout, /it does not adopt/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('bench-admit says UNDECIDED, not admitted, when no FP tolerance is declared', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-admit-'));
  try {
    const cur = writeResult(tmp, 'cur.json', baseResult({ candidate: null, seeds: [row('a', true)] }));
    const cand = writeResult(tmp, 'cand.json', baseResult({
      candidate: { model: 'sonnet', effort: 'high' }, seeds: [row('a', true)],
    }));

    const bare = runAdmit(['--current', cur, '--candidate', cand]);
    assert.match(bare.stdout, /UNDECIDED/);
    assert.doesNotMatch(bare.stdout, /ADMITTED/);
    assert.equal(bare.status, 0, 'undecided is not a failure, it is an unanswered question');

    const declared = runAdmit(['--current', cur, '--candidate', cand, '--fp-tolerance', '0']);
    assert.match(declared.stdout, /ADMITTED/, 'the same data decides once a tolerance is declared');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('bench-admit refuses two results that measured different things', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-admit-'));
  try {
    // A misanchor pass against a drop pass compares detection of two different error SHAPES. The
    // difference between the files would read as a setting difference — the "judged against a
    // mutation it never saw" error this harness has already made once, one level up.
    const cur = writeResult(tmp, 'cur.json', baseResult({ candidate: null, seeds: [row('a', true)] }));
    const cand = writeResult(tmp, 'cand.json', baseResult({
      mutation: 'drop', candidate: { model: 'sonnet' }, seeds: [row('a', true)],
    }));

    const r = runAdmit(['--current', cur, '--candidate', cand, '--fp-tolerance', '0']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /disagree on `mutation`/);
    assert.match(r.stderr, /not the setting/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ------------------------------------------------- the candidate needs its own file, like the rest
// FOUND WHILE ABOUT TO SPEND ON IT. The first candidate pass was to be `--model sonnet --from
// <the opus baseline>`, and the result path had no candidate discriminator — so it would have
// written over the very file it was meant to be compared against, destroying the baseline by the
// act of producing the other half of the comparison.
//
// This is the FOURTH instance of one class in this file, and the comment directly above the path
// enumerates three: `--seed` (two single-seed runs, the second replacing the first), `--rejudge`,
// and per-mutation (a deflate pass silently replacing the misanchor paragraphs). Adding a knob to
// this harness means adding it to the filename, and that had not been generalised — each fix
// treated its own case.

test('a candidate setting gets its own result file, and cannot overwrite the baseline', async () => {
  const { resultBasename } = await import('../scripts/lib/bench-settings.mjs');

  const baseline = resultBasename({ stamp: '2026-09-21T16-35', mutation: 'misanchor' });
  assert.equal(baseline, '2026-09-21T16-35-second-opinion.json',
    'misanchor at the setting in force keeps the bare name, so existing references stay valid');

  const cand = resultBasename({ stamp: '2026-09-21T16-35', mutation: 'misanchor', candidate: { model: 'sonnet' } });
  assert.notEqual(cand, baseline, 'a candidate pass must not write over the setting it is compared against');
  assert.match(cand, /sonnet/, 'the filename says which setting produced it');

  // Model and effort are separate knobs, so two candidates differing only in effort are two results.
  const a = resultBasename({ stamp: 's', mutation: 'misanchor', candidate: { model: 'sonnet', effort: 'low' } });
  const b = resultBasename({ stamp: 's', mutation: 'misanchor', candidate: { model: 'sonnet', effort: 'high' } });
  assert.notEqual(a, b);

  // Effort alone is a candidate too, and must not collide with the baseline.
  assert.notEqual(resultBasename({ stamp: 's', mutation: 'misanchor', candidate: { effort: 'low' } }),
    resultBasename({ stamp: 's', mutation: 'misanchor' }));

  // The existing discriminators still compose rather than being replaced.
  assert.match(resultBasename({ stamp: 's', mutation: 'drop', candidate: { model: 'sonnet' } }), /\.drop\./);
  assert.match(resultBasename({ stamp: 's', mutation: 'misanchor', rejudge: true }), /\.rejudge\./);

  // A MODEL NAME IS NOT A FILENAME. Vendors ship slashes, dots and spaces in model labels — agy's
  // pinned judge is literally `Gemini 3.1 Pro (High)` — and a path separator arriving here would
  // write outside RESULTS_DIR.
  const nasty = resultBasename({ stamp: 's', mutation: 'misanchor', candidate: { model: '../../etc/passwd' } });
  assert.doesNotMatch(nasty, /[\\/]/, 'no path separator may survive into the basename');
  const spacey = resultBasename({ stamp: 's', mutation: 'misanchor', candidate: { model: 'Gemini 3.1 Pro (High)' } });
  assert.doesNotMatch(spacey, /[ ()]/, 'a vendor label is slugged, not pasted');
});

// ------------------------------------------------- the gate read a vocabulary nothing ever writes
// FOUND BY THE FIRST LIVE PASS, which is what the pass was for. `bench-admit` on a real baseline
// that caught SIX seeds reported `seeds in force: 0` and "no seed regressed" — a gate that compared
// nothing against nothing and passed.
//
// The cause is a vocabulary spelled twice. `lib/second-opinion-scoring.mjs` EXPORTS the states
// (`IDENTIFIED = 'identified'`, `NOT_IDENTIFIED = 'not-identified'`) and every artifact carries
// `mutated.state: "identified"`. The gate looked for `'caught'` — a word that appears in the
// summary block and never in a seed's state — so it matched nothing, on every file, always.
//
// The unit tests did not catch it because THEY USED THE SAME INVENTED WORD. A fixture built from
// memory is self-consistent with the code that shares the memory, and agrees with it about a
// contract neither one has read. So these tests read the REAL result files off disk: a fixture that
// comes from the artifact cannot drift from the artifact.

const REAL_BASELINE = path.join(ROOT, 'bench', 'results', '2026-09-21T16-35-42-060Z-second-opinion.json');

test('caughtSeeds reads the vocabulary the scorer EXPORTS, not one spelled from memory', async (t) => {
  const { caughtSeeds } = await import('../scripts/lib/bench-settings.mjs');
  const { IDENTIFIED, NOT_IDENTIFIED } = await import('../scripts/lib/second-opinion-scoring.mjs');

  // The states are the scorer's to define. If these constants ever change value, this test fails
  // here rather than leaving a gate silently matching nothing.
  assert.equal(IDENTIFIED, 'identified');
  assert.equal(NOT_IDENTIFIED, 'not-identified');

  const synthetic = {
    seeds: [
      { seed: 'hit', mutated: { state: IDENTIFIED } },
      { seed: 'miss', mutated: { state: NOT_IDENTIFIED } },
      // NOT SCOREABLE, and not a miss: the judge voted identified with no checkable citation.
      // Counting it either way invents a measurement nobody made.
      { seed: 'unverified', mutated: { state: 'unverified' } },
      { seed: 'novote', mutated: { state: 'no-vote' } },
    ],
  };
  assert.deepEqual([...caughtSeeds(synthetic)], ['hit']);

  // AND AGAINST THE REAL FILE, which is the half that would have caught this.
  if (!fs.existsSync(REAL_BASELINE)) return t.skip('no baseline result in this checkout');
  const real = JSON.parse(fs.readFileSync(REAL_BASELINE, 'utf8'));
  assert.equal(caughtSeeds(real).size, real.summary.caught,
    'the gate must agree with the result file\'s own caught count — it read 0 of 6 and said "no seed regressed"');
  assert.ok(caughtSeeds(real).size > 0, 'a gate that matches nothing passes vacuously');
});

test('a seed the candidate never MEASURED is not a seed it missed', async (t) => {
  const { admissionVerdict } = await import('../scripts/lib/bench-settings.mjs');
  const { IDENTIFIED, NOT_IDENTIFIED } = await import('../scripts/lib/second-opinion-scoring.mjs');
  const row = (seed, state) => ({ seed, mutated: { state }, control: { state: NOT_IDENTIFIED } });

  const current = { seeds: [row('a', IDENTIFIED), row('b', IDENTIFIED), row('c', IDENTIFIED)] };

  // A ONE-SEED PASS. The other two were never run — the exact shape of the first live candidate
  // pass. Reporting them as regressed says the candidate FAILED to catch what it was never asked
  // about, and reporting nothing at all would admit a setting on a third of the evidence.
  const partial = admissionVerdict({ current, candidate: { seeds: [row('a', IDENTIFIED)] }, fpTolerance: 0 });
  assert.equal(partial.verdict, 'undecided');
  assert.deepEqual(partial.regressed, [], 'unmeasured is not missed');
  assert.deepEqual(partial.unmeasured, ['b', 'c']);
  // Wording tightened once real data showed 'never measured' was wrong for a seed that RAN and
  // came back unscoreable. These two were never attempted, so NEVER RUN is the accurate half.
  assert.match(partial.why, /NEVER RUN: b, c/);
  assert.deepEqual(partial.absent, ['b', 'c']);
  assert.deepEqual(partial.unscoreable, []);

  // A REAL regression is still a rejection, and is named separately from a coverage gap.
  const lost = admissionVerdict({
    current, candidate: { seeds: [row('a', IDENTIFIED), row('b', NOT_IDENTIFIED), row('c', IDENTIFIED)] }, fpTolerance: 0,
  });
  assert.equal(lost.verdict, 'rejected');
  assert.deepEqual(lost.regressed, ['b']);
  assert.deepEqual(lost.unmeasured, []);

  // Full coverage, nothing lost: the FP clause decides, as before.
  const full = admissionVerdict({
    current, candidate: { seeds: [row('a', IDENTIFIED), row('b', IDENTIFIED), row('c', IDENTIFIED)] }, fpTolerance: 0,
  });
  assert.equal(full.verdict, 'admitted');
});

test('a baseline predating the setting field is labelled unrecorded, not `?`', async () => {
  const { settingLabel } = await import('../scripts/lib/bench-settings.mjs');
  assert.equal(settingLabel({ model: 'sonnet' }), 'sonnet');
  assert.equal(settingLabel({ model: 'opus', effort: 'medium' }), 'opus/medium');
  // The first live comparison printed "sonnet against ?", because the baseline was produced before
  // the result file carried its setting. Honest, and unreadable.
  assert.equal(settingLabel(null), 'unrecorded');
  assert.equal(settingLabel({ model: null }), 'unrecorded');
});

// ------------------------------------------------- the dominance metrics read a shape nothing has
// THE SAME DEFECT AS `caughtSeeds`, one function along, and found the same way: by looking at a real
// file instead of at what I remembered. `splitSpend` writes a seed's `spent` as
//
//     { second_opinion_usd, forge_usd, total_usd, duration_ms, usage: { input_tokens, ... } }
//
// — a FLAT usage object and a FLAT duration. `totalTokens` iterated `Object.values(spent.usage)` as
// though it were a per-node map, so it walked the numbers, skipped every one as "not an object",
// and returned null; `totalDuration` read `spent.durations`, a key no artifact has. Both returned
// null on every real result, so `preferredSetting` answered `undecidable` on every real comparison
// and would have gone on doing it silently — an honest-sounding verdict that was really a bug.

const REAL_FILES = [
  path.join(ROOT, 'bench', 'results', '2026-09-21T16-35-42-060Z-second-opinion.json'),
  path.join(ROOT, 'bench', 'results', '2026-09-21T16-35-42-060Z-second-opinion.sonnet.json'),
];

test('totalTokens and totalDuration read the shape splitSpend actually writes', async (t) => {
  const { totalTokens, totalDuration } = await import('../scripts/lib/bench-settings.mjs');

  const present = REAL_FILES.filter((f) => fs.existsSync(f));
  if (!present.length) return t.skip('no bench results in this checkout');

  for (const f of present) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const tok = totalTokens(j);
    const dur = totalDuration(j);
    assert.ok(Number.isFinite(tok) && tok > 0,
      `${path.basename(f)}: tokens must be readable — null makes every dominance verdict 'undecidable'`);
    assert.ok(Number.isFinite(dur) && dur > 0, `${path.basename(f)}: duration must be readable`);

    // Cross-checked against the file's own numbers rather than against the same code that read them.
    const byHand = j.seeds.reduce((a, s) => a + Object.entries(s.spent.usage)
      .filter(([k, v]) => Number.isFinite(v) && k.endsWith('_tokens'))
      .reduce((b, [, v]) => b + v, 0), 0);
    assert.equal(tok, byHand, 'the sum must be the file\'s own token counts');
    assert.equal(dur, j.seeds.reduce((a, s) => a + s.spent.duration_ms, 0));
  }
});

test('an absent metric is still absent — null, never a silent zero', async () => {
  const { totalTokens, totalDuration, preferredSetting } = await import('../scripts/lib/bench-settings.mjs');
  // AC4: "A USD figure may appear only where the vendor actually returns one, and its absence is
  // recorded rather than imputed." A zero here would let a result with no usage data DOMINATE one
  // that reported honestly.
  assert.equal(totalTokens({ seeds: [{ seed: 'a', spent: {} }] }), null);
  assert.equal(totalDuration({ seeds: [{ seed: 'a', spent: {} }] }), null);
  assert.equal(totalTokens({ seeds: [] }), null);

  const blind = { seeds: [{ seed: 'a', spent: {} }] };
  const seeing = { seeds: [{ seed: 'a', spent: { duration_ms: 10, usage: { input_tokens: 5 } } }] };
  assert.equal(preferredSetting({ current: seeing, candidate: blind }).rule, 'undecidable');
});


// ------------------------------------------------ `source` collapsed two knobs into one answer
// FOUND IN THE opus/low ARTIFACT. Every seed recorded `source: "frozen-contract"` beside
// `effort: "low"` and `in_force.effort: "medium"` — the effort WAS the candidate, and the field
// that exists to say where the setting came from said it came from the contract.
//
// It was not lying about the model, which is the trap: `source` described the model only, while
// sitting in a block whose subject is the whole setting. A reader checking that one field concludes
// nothing was overridden. AC2's whole point is that model and effort are SEPARATE KNOBS, and one
// scalar cannot answer for both.
test('judgmentSetting records where each knob came from, separately', async () => {
  const { judgmentSetting } = await import('../scripts/lib/bench-settings.mjs');
  const frozen = { review: { models: { judgment: 'opus' }, effort: { judgment: 'medium' } } };
  const rosterDefaults = { judgment: 'roster-model' };

  const effortOnly = judgmentSetting({ candidate: { effort: 'low' }, frozen, rosterDefaults });
  assert.deepEqual(effortOnly.source, { model: 'frozen-contract', effort: 'candidate' },
    'the effort was overridden and the model was not — one word cannot say that');

  const modelOnly = judgmentSetting({ candidate: { model: 'sonnet' }, frozen, rosterDefaults });
  assert.deepEqual(modelOnly.source, { model: 'candidate', effort: 'frozen-contract' });

  const both = judgmentSetting({ candidate: { model: 'sonnet', effort: 'low' }, frozen, rosterDefaults });
  assert.deepEqual(both.source, { model: 'candidate', effort: 'candidate' });

  const neither = judgmentSetting({ frozen, rosterDefaults });
  assert.deepEqual(neither.source, { model: 'frozen-contract', effort: 'frozen-contract' });
  assert.equal(neither.is_candidate, false);

  // The roster default is a third origin and must not read as the contract's.
  const fallback = judgmentSetting({ frozen: {}, rosterDefaults });
  assert.deepEqual(fallback.source, { model: 'roster-default', effort: null },
    'an absent effort has no origin to name — null, not a borrowed one');
});


// ------------------------------------- "never measured" was wrong for a seed that ran and reported
// FOUND ON REAL DATA, the drop/opus-low pass. `numeric-bundle-pager` came back `unverified`: the
// judge voted identified and cited "g-2: i dispute the drop..." — a quote that is NOT in the report.
// So the node ran, produced an audit, and the JUDGE failed to substantiate its own vote.
//
// The gate called that seed "never measured by it", which is wrong twice: it was measured, and the
// failure was the instrument's rather than the candidate's. Both states still block admission — an
// unscoreable seed cannot support "no seed regressed" any more than an absent one can — but a
// reader deciding what to re-run needs to know which they have. An absent seed means run it; an
// unscoreable one means the judge could not settle it and re-running may land the same way.
test('an unscoreable seed is reported as ran-but-unscoreable, not as never measured', async () => {
  const { admissionVerdict } = await import('../scripts/lib/bench-settings.mjs');
  const { IDENTIFIED, NOT_IDENTIFIED } = await import('../scripts/lib/second-opinion-scoring.mjs');
  const row = (seed, state) => ({ seed, mutated: { state }, control: { state: NOT_IDENTIFIED } });

  const current = { seeds: [row('a', IDENTIFIED), row('b', IDENTIFIED), row('c', IDENTIFIED)] };

  // 'b' RAN and came back unverified; 'c' was never attempted.
  const g = admissionVerdict({
    current,
    candidate: { seeds: [row('a', IDENTIFIED), row('b', 'unverified')] },
    fpTolerance: 0,
  });
  assert.equal(g.verdict, 'undecided');
  assert.deepEqual(g.regressed, [], 'the judge failing to substantiate is not the node missing');
  assert.deepEqual(g.unscoreable, ['b'], 'it ran; the judge could not settle it');
  assert.deepEqual(g.absent, ['c'], 'it was never attempted');
  // Kept as the union so existing readers of `unmeasured` still see everything blocking admission.
  assert.deepEqual(g.unmeasured, ['b', 'c']);
  assert.match(g.why, /could not be scored|unscoreable/i);
  assert.match(g.why, /never (run|attempted|measured)/i,
    'both halves are named, because they call for different next steps');
});


// ============================================ two harnesses, one gate, and a vacuous pass averted
// `bench-lenses` and `bench-second-opinion` write different artifacts. The gate was written against
// one and, handed the other, read no seeds and printed:
//
//     ADMITTED — every one of the 0 seed(s) the setting in force catches is still caught
//
// A vacuous pass — the same shape as the `'caught'` vocabulary bug, through a different door.
// Found BEFORE a $22 lens sweep rather than after, which is the only reason it never became a
// number someone quoted.
//
// These read the REAL archived sweeps and cross-check against figures RESULTS.md already published,
// which is the strongest fixture available: a reader that cannot reproduce a number someone wrote
// down months ago is wrong about the shape, and says so without anyone having to notice.

const LENS_XHIGH = path.join(ROOT, 'bench', 'results', '2026-09-20T23-00-58-339Z.json');
const LENS_MEDIUM = path.join(ROOT, 'bench', 'results', '2026-09-20T23-46-34-579Z.json');

test('readBenchResult reads a lens sweep, and reproduces its published numbers', async (t) => {
  const { readBenchResult } = await import('../scripts/lib/bench-settings.mjs');
  if (!fs.existsSync(LENS_XHIGH) || !fs.existsSync(LENS_MEDIUM)) return t.skip('archived sweeps absent');

  const x = readBenchResult(JSON.parse(fs.readFileSync(LENS_XHIGH, 'utf8')));
  const m = readBenchResult(JSON.parse(fs.readFileSync(LENS_MEDIUM, 'utf8')));
  assert.equal(x.kind, 'lenses');

  // RESULTS.md, 2026-09-20: "recall 7/7 at both, false-positive candidates 13 -> 8 ...
  // summed node wall-clock 100.7 -> 48.6 min".
  assert.deepEqual([x.caught.size, m.caught.size], [7, 7]);
  assert.deepEqual([x.fp, m.fp], [13, 8], 'the false-positive candidate counts RESULTS.md published');
  assert.equal((x.duration / 60000).toFixed(1), '100.7');
  assert.equal((m.duration / 60000).toFixed(1), '48.6');

  // THE SETTING COMES FROM THE PER-NODE RECORDS, never from `config.declared_effort`, which on
  // these two files is the PREVIOUS setting both times: the xhigh sweep records `high` and the
  // medium sweep records `xhigh`. Reading it would attribute every number to the wrong setting.
  assert.deepEqual(x.setting, { model: 'opus', effort: 'xhigh' });
  assert.deepEqual(m.setting, { model: 'opus', effort: 'medium' });
  const rawX = JSON.parse(fs.readFileSync(LENS_XHIGH, 'utf8'));
  assert.notEqual(rawX.config.declared_effort.judgment, x.setting.effort,
    'this file is exactly why the per-node record is the one to read');
});

test('a file that is neither shape is refused, not compared', async () => {
  const { readBenchResult, admissionVerdict } = await import('../scripts/lib/bench-settings.mjs');

  for (const junk of [{ hello: 'world' }, { seeds: [] }, { scores: [] }, null, 'nope']) {
    assert.equal(readBenchResult(junk).ok, false, `${JSON.stringify(junk)} is not a bench result`);
  }
  assert.match(readBenchResult({}).why, /neither shape/);

  // And the library degrades to EMPTY rather than throwing, so the CLI's refusal is a message
  // rather than a stack trace. Empty can never say "no seed regressed": there is no baseline.
  const g = admissionVerdict({ current: { hello: 'world' }, candidate: { hello: 'world' }, fpTolerance: 0 });
  assert.equal(g.seeds_in_force, 0, 'nothing in force means nothing was compared');
});

test('the gate reproduces the xhigh-to-medium decision made by hand before it existed', async (t) => {
  const { admissionVerdict, preferredSetting } = await import('../scripts/lib/bench-settings.mjs');
  if (!fs.existsSync(LENS_XHIGH) || !fs.existsSync(LENS_MEDIUM)) return t.skip('archived sweeps absent');

  const current = JSON.parse(fs.readFileSync(LENS_XHIGH, 'utf8'));
  const candidate = JSON.parse(fs.readFileSync(LENS_MEDIUM, 'utf8'));

  const gate = admissionVerdict({ current, candidate, fpTolerance: 0 });
  assert.equal(gate.verdict, 'admitted');
  assert.equal(gate.seeds_in_force, 7);
  assert.deepEqual(gate.regressed, []);
  assert.deepEqual(gate.unscoreable, []);
  assert.deepEqual(gate.absent, []);
  assert.equal(gate.false_alarms.rise, -5, 'fp FELL, 13 -> 8');
  assert.match(gate.fp_label, /false-positive candidates/,
    'a lens fp is not the same quantity as a control false alarm, and the gate names which it counted');

  const pref = preferredSetting({ current, candidate, admitted: true });
  assert.equal(pref.rule, 'dominance');
  assert.equal(pref.preferred, 'candidate',
    'medium was better on tokens, node-minutes AND false-positive candidates — which is the '
    + 'decision the operator actually made that day, reached here from the raw files');
});


// ============================== the difference has to BE the setting, and nothing checked that
// Found by spending $5.28 on a lens sweep at `low` and then discovering it could not be compared to
// anything. Three variables had moved, not one:
//
//   effort         medium -> low     the intended one
//   corpus_commit  07db3f6b -> 8c23dbd6   bench-lenses seeds whatever HEAD is when it runs, so two
//                                        sweeps on different days review DIFFERENT CODE
//   reporters      11 nodes -> 14    the newer sweep carried three codex panel arms
//
// The reporter set is the damaging one. A seed the lens MISSED and an arm CAUGHT still scores as
// caught, so an unmatched panel masks exactly the regression the gate exists to find — and tokens,
// wall-clock and false-positive candidates are inflated by the extra nodes besides.
//
// bench-lenses already refuses this one level down: --score-only will not recompute an anchor
// against today's checkout, calling it "the cross-tree comparison this rework exists to make
// impossible". Nothing enforced the same rule between two whole sweeps.

const LENS_MEDIUM_0920 = path.join(ROOT, 'bench', 'results', '2026-09-20T23-46-34-579Z.json');
const LENS_XHIGH_0920 = path.join(ROOT, 'bench', 'results', '2026-09-20T23-00-58-339Z.json');
const LENS_LOW_0923 = path.join(ROOT, 'bench', 'results', '2026-09-23T20-28-31-915Z.json');

test('two sweeps of the same tree with the same reporters are comparable', async (t) => {
  const { comparabilityErrors } = await import('../scripts/lib/bench-settings.mjs');
  if (!fs.existsSync(LENS_MEDIUM_0920) || !fs.existsSync(LENS_XHIGH_0920)) return t.skip('sweeps absent');
  const current = JSON.parse(fs.readFileSync(LENS_XHIGH_0920, 'utf8'));
  const candidate = JSON.parse(fs.readFileSync(LENS_MEDIUM_0920, 'utf8'));
  assert.deepEqual(comparabilityErrors({ current, candidate }), [],
    'same corpus commit, same 11 nodes, one effort each — this pair IS a comparison');
});

test('a different tree or a different reporter set is refused, with the reason', async (t) => {
  const { comparabilityErrors } = await import('../scripts/lib/bench-settings.mjs');
  if (!fs.existsSync(LENS_MEDIUM_0920) || !fs.existsSync(LENS_LOW_0923)) return t.skip('sweeps absent');
  const current = JSON.parse(fs.readFileSync(LENS_MEDIUM_0920, 'utf8'));
  const candidate = JSON.parse(fs.readFileSync(LENS_LOW_0923, 'utf8'));

  const bad = comparabilityErrors({ current, candidate });
  assert.ok(bad.some((b) => /different corpus_commit/.test(b)), 'the trees differ');
  assert.ok(bad.some((b) => /panel-codex-code/.test(b)), 'the reporter sets differ, and it names which');
  assert.ok(bad.some((b) => /masks the regression/.test(b)),
    'the reason an unmatched panel matters must travel with the refusal — that is the half a reader '
    + 'would not re-derive');
  // NOT "more than one effort". That clause was removed after it refused a VALID pair: the medium
  // baseline legitimately reads mixed(low|medium), because second-opinion carries an adopted
  // `effort: low` override in lens-roster.json and is therefore a CONTROL held constant on both
  // sides. Internal uniformity was the wrong question; the right one is whether the DIFFERENCE is
  // one coherent change. The tree and the reporter set are the real grounds here, and both hold.
  assert.ok(bad.length >= 2, 'the tree and the reporter set are each a refusal on their own');
});

test('comparability is judged on facts, not on filenames', async () => {
  const { comparabilityErrors } = await import('../scripts/lib/bench-settings.mjs');
  // `effort` is a parameter because two sweeps at the SAME setting are not a comparison — the rule
  // added after a real pair proved the old one wrong. A fixture that did not vary it was asserting
  // something the gate should refuse.
  const mk = (commit, nodes, effort = 'low') => ({
    config: { corpus_commit: commit },
    scores: [{ seed: 's', caught: true, fp_candidates: {} }],
    runs: [{ nodes: Object.fromEntries(nodes.map((n) => [n, { model: 'opus', effort }])) }],
  });
  assert.deepEqual(
    comparabilityErrors({ current: mk('aaa', ['code-audit'], 'medium'), candidate: mk('aaa', ['code-audit'], 'low') }),
    [], 'same tree, same reporter, one setting moved — this is a comparison');
  assert.equal(
    comparabilityErrors({ current: mk('aaa', ['code-audit'], 'medium'), candidate: mk('bbb', ['code-audit'], 'low') }).length,
    1, 'a different tree is a refusal even when the setting moved cleanly');
  assert.equal(
    comparabilityErrors({ current: mk('aaa', ['code-audit'], 'medium'), candidate: mk('aaa', ['code-audit', 'panel-codex-code'], 'low') }).length,
    1, 'an extra reporter is a refusal even when the setting moved cleanly');

  // A NODE HELD CONSTANT ACROSS BOTH SIDES IS A CONTROL, NOT A CONTAMINANT — the case that broke
  // the old rule. `second-opinion` at low in a medium sweep AND in a low sweep is exactly what an
  // adopted per-node override looks like, and the comparison is still about the nodes that moved.
  const mixed = (a, b) => ({
    config: { corpus_commit: 'aaa' },
    scores: [{ seed: 's', caught: true, fp_candidates: {} }],
    runs: [{ nodes: { 'code-audit': { model: 'opus', effort: a }, 'second-opinion': { model: 'opus', effort: b } } }],
  });
  assert.deepEqual(comparabilityErrors({ current: mixed('medium', 'low'), candidate: mixed('low', 'low') }), [],
    'six nodes moving while one is pinned on both sides is one knob, not two');

  // AND A PAIR WHERE NOTHING MOVED IS NOT A COMPARISON.
  const same = comparabilityErrors({ current: mixed('low', 'low'), candidate: mixed('low', 'low') });
  assert.equal(same.length, 1);
  assert.match(same[0], /same sweep twice, not a comparison/);

  // A MISSING corpus_commit IS NOT A MISMATCH. second-opinion results carry head_commit per seed
  // and are guarded by the mutation check instead; refusing them here would break a working path.
  // Settings that DIFFER, so this isolates the corpus_commit claim. The first version gave both
  // sides none, which the same-setting rule (G-4) now refuses — correctly, and for a different
  // reason than the one this assertion is about.
  const soSeed = (candidate) => ({
    candidate,
    seeds: [{
      seed: 'a',
      mutated: { state: 'identified' },
      setting: { model: 'opus', effort: 'medium', in_force: { model: 'opus', effort: 'medium' } },
    }],
  });
  assert.deepEqual(comparabilityErrors({ current: soSeed(null), candidate: soSeed({ model: 'sonnet' }) }), []);
});

// ------------------------------------------- G-4: a baseline compared with itself said ADMITTED
// Raised by `panel-codex-code` against run 20260924-004905-today-review, confirmed against source.
// Passing the same second-opinion result as both inputs produced:
//
//     WARNING — the candidate file records no `candidate` setting ...
//     == ADMITTED — unrecorded against unrecorded
//
// exit 0. A warning is not a refusal, and "unrecorded against unrecorded" is a hint a reader has to
// notice. The lens shape was already covered — `comparabilityErrors` refuses when no node moved —
// but that check reads `runs[].nodes`, which a second-opinion result does not have. One shape
// guarded, the other not, from a rule that should never have been shape-specific.
test('two results at the SAME setting are refused, whichever harness wrote them', async () => {
  const { comparabilityErrors } = await import('../scripts/lib/bench-settings.mjs');
  const { IDENTIFIED, NOT_IDENTIFIED } = await import('../scripts/lib/second-opinion-scoring.mjs');
  const so = (candidate) => ({
    mutation: 'misanchor',
    candidate,
    seeds: [{
      seed: 'a',
      mutated: { state: IDENTIFIED },
      control: { state: NOT_IDENTIFIED },
      setting: { model: 'opus', effort: 'medium', in_force: { model: 'opus', effort: 'medium' } },
    }],
  });

  const selfCompare = comparabilityErrors({ current: so(null), candidate: so(null) });
  assert.ok(selfCompare.length, 'the same setting on both sides is not a comparison');
  assert.match(selfCompare[0], /same setting|nothing to attribute|not a comparison/i);

  // A REAL candidate still compares.
  assert.deepEqual(
    comparabilityErrors({ current: so(null), candidate: so({ model: 'sonnet' }) }), [],
    'a candidate that names a different setting is exactly what the gate is for');
});

// ------------------------------------------------ G-22: the denominator was the caught count
// `panel-codex-contract` against run 20260924-004905-today-review: "seeds_in_force is assigned from
// the number of seeds caught by the current setting rather than the number of corpus seeds in
// force; any baseline miss makes the reported denominator too small."
//
// AC8's last sentence is why this field exists at all: "the number of seeds in force is reported
// with every result so the reader can weigh it" — at n=7 one seed is 14% of the result. A
// denominator that silently shrinks when the BASELINE misses something makes the result look
// better-supported than it is, in the direction that flatters.
//
// It went unnoticed because every pass so far had a baseline that caught everything, so the two
// quantities were equal in all real data. They are different quantities and now have different names.
test('seeds_in_force is the corpus, not the count the baseline happened to catch', async () => {
  const { admissionVerdict } = await import('../scripts/lib/bench-settings.mjs');
  const { IDENTIFIED, NOT_IDENTIFIED } = await import('../scripts/lib/second-opinion-scoring.mjs');
  const row = (seed, state) => ({ seed, mutated: { state }, control: { state: NOT_IDENTIFIED } });

  // The baseline MISSES 'c'. The corpus is still three seeds.
  const current = { seeds: [row('a', IDENTIFIED), row('b', IDENTIFIED), row('c', NOT_IDENTIFIED)] };
  const candidate = { seeds: [row('a', IDENTIFIED), row('b', IDENTIFIED), row('c', IDENTIFIED)] };

  const g = admissionVerdict({ current, candidate, fpTolerance: 0 });
  assert.equal(g.seeds_in_force, 3, 'three seeds are in force; the baseline caught two of them');
  assert.equal(g.caught_in_force, 2, 'the regression basis is its own quantity with its own name');
  assert.deepEqual(g.gained, ['c'], 'the candidate caught one the baseline missed');
  assert.equal(g.verdict, 'admitted', 'nothing regressed, so a seed GAINED does not block');

  // And the message must not quote the corpus size where it means the caught set.
  assert.match(g.why, /2 seed\(s\) the setting in force catches/,
    'the sentence is about what the baseline CATCHES, so it must use that number');
});

// -------------------------------------------- G-16: a run id became part of a filesystem path
// `panel-codex-security` against run 20260924-004905-today-review: "runJson.run_id is joined into
// the staging path without slug or containment validation before recursive copying; a crafted
// preserved run can supply .. segments and make the dry-run or live benchmark overwrite files
// outside its staging directory."
//
// LOW because the input is a preserved run the operator chose from their own disk, so it takes a
// crafted run.json to exploit — but the bench reads run.json from a directory it did not create,
// and `path.join(stagingParent, runJson.run_id)` treats an attacker-controlled string as a path.
// capture.mjs already refuses a run directory that is not inside a permitted container; this is the
// same rule one layer earlier, where the path is BUILT rather than accepted.
test('a run id is one path segment, or it is not a run id', async () => {
  const { isSafeRunId } = await import('../scripts/lib/reviews-root.mjs');

  assert.equal(isSafeRunId('20260924-004905-today-review'), true);
  assert.equal(isSafeRunId('20260921-163546-bench-numeric-bundle-pager'), true);

  // TRAVERSAL, in the spellings a filesystem actually honours.
  // Separators built rather than escaped — a heredoc ate them twice writing this file, which is
  // exactly the class of silent corruption `briefArg` exists for one directory over.
  const SEP = String.fromCharCode(92);
  for (const bad of ['..', '../escape', `a/..${SEP}..`, 'x/y', `x${SEP}y`, '.', '']) {
    assert.equal(isSafeRunId(bad), false, `${JSON.stringify(bad)} must not be joined into a path`);
  }
  // Absolute paths replace the join target entirely rather than extending it.
  assert.equal(isSafeRunId(`C:${SEP}Windows`), false);
  assert.equal(isSafeRunId('/etc'), false);
  // Non-strings are not run ids either.
  for (const bad of [null, undefined, 42, {}]) assert.equal(isSafeRunId(bad), false);
});

// ------------------------------------- G-3: the forge told its child it was a top-level process
// `panel-codex-arch` against run 20260924-021736-post-remediation, verified in source.
//
// The forge is a DIRECT agentic child — `claude -p`, not routed through spawn-node — and it was
// handed `GRAPH_NODE_DEPTH: '0'`. Zero means top level, so a graph-starting command reachable
// through an incomplete or changed tool-denial configuration would see itself as the root of the
// world and sail past the §8 recursion guard. Tool denial was the only barrier left, and this
// file's own comments say why that is not enough: the deny list is "the union of every tool name
// this runtime DECLARES", so a tool the adapter does not name cannot be denied by that route.
//
// The OTHER spawn in this file passes '0' correctly, under the comment "spawn-node adds the +1".
// One site delegates the increment and one had to do it itself; only the second was wrong.
test('the forge hands its child a depth ABOVE its own, not zero', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'bench-second-opinion.mjs'), 'utf8');

  // The bench refuses to run at all above depth 0, so DEPTH + 1 is 1 in practice — but the
  // expression is what matters: a literal '0' is a claim about the child's position that the
  // parent is not entitled to make.
  assert.ok(src.includes("GRAPH_NODE_DEPTH: String(DEPTH + 1)"),
    'the directly-spawned forge must increment, because nothing downstream will do it for it');

  // And the spawn-node call must NOT increment, because spawn-node does.
  const viaSpawnNode = src.split('\n').some((l) =>
    l.includes("GRAPH_NODE_DEPTH: '0'") && l.includes('spawn-node adds the +1'));
  assert.ok(viaSpawnNode,
    'the delegated site keeps 0 and says why; two sites, two rules, and only one was wrong');
});

// ----------------------------- G-4: a precondition that fired after it had already made a mess
// `panel-codex-code` against run 20260924-021736-post-remediation, verified in source: the
// isSafeRunId rejection I added an hour earlier sat AFTER `mkdtempSync(wt)` and
// `mkdtempSync(stagingParent)` and BEFORE the `try/finally`. So an unsafe preserved run_id threw
// past the per-seed catch, leaked two temp directories, skipped both cleanup paths, and aborted
// every remaining seed of the pass.
//
// The guard was right and its POSITION was wrong — a precondition belongs with the other
// preconditions. Two lines below where run.json is parsed, the head_commit check already does this
// correctly: `notRun.push(...)` then `return say(...)`, so the seed is reported NOT RUN and the
// pass continues. This now matches it.
test('an unsafe run id is a per-seed NOT RUN, decided before anything is created', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'bench-second-opinion.mjs'), 'utf8');
  const at = (needle) => src.indexOf(needle);

  // run.json is read through the shared strict reader since G-7 of 20260929-145942-ssr-review-r2.
  const parse = at('const runJson = record.record');
  const guard = at('isSafeRunId(runJson.run_id)');
  const firstMkdtemp = at('fs.mkdtempSync(');
  assert.ok(parse > -1 && guard > -1 && firstMkdtemp > -1);

  assert.ok(guard > parse, 'it needs run.json to have been read');
  assert.ok(guard < firstMkdtemp,
    'and it must decide BEFORE any directory exists, or rejecting leaves one behind');

  // The same shape as its sibling precondition, not a throw past the per-seed catch.
  const block = src.slice(guard, guard + 700);
  assert.ok(block.includes('notRun.push'), 'an unusable seed is reported, not thrown');
  assert.ok(block.includes('return say('), 'and the remaining seeds still run');
  assert.ok(!block.slice(0, block.indexOf('return say(')).includes('throw new Error'),
    'throwing here is what aborted the pass and skipped cleanup');
});

// ------------------ G-7: an absent price became zero, and a vendor name was baked into an artifact
// Two defects at one line, raised by two arms and NOT corroboration of each other — the reconciler
// said so explicitly.
//
// (panel-codex-contract) `?? 0` summed every absent per-seed USD as zero and always emitted a
// number, so a pass where the vendor returned no price is indistinguishable from one that cost
// nothing. I-6 says absence is RECORDED, not imputed — the same rule `splitSpend` already follows
// when it keeps an absent cost as null rather than 0.
//
// (panel-codex-arch) `$note: 'Anthropic only'` is a vendor literal persisted into the result, while
// the forge runtime is selected from the adapter table at run time. Change the default runtime and
// the artifact durably attributes that spend to the wrong vendor, fixable only by an orchestration
// edit — I-4 and ARCHITECTURE §4.
test('summed spend reports absence instead of imputing zero', async () => {
  const { sumSpend } = await import('../scripts/lib/bench-settings.mjs');

  assert.deepEqual(sumSpend([{ spent: { a: 1.5 } }, { spent: { a: 2.25 } }], 'a'),
    { total: 3.75, absent: 0, seeds: 2 });

  // ONE ABSENT VALUE MAKES THE TOTAL A PARTIAL, and it says so rather than quietly shrinking.
  const partial = sumSpend([{ spent: { a: 1.5 } }, { spent: {} }], 'a');
  assert.equal(partial.total, 1.5);
  assert.equal(partial.absent, 1, 'the count of seeds that reported no price travels with the total');

  // ALL ABSENT IS NULL, NOT ZERO. "$0.00" and "the vendor returned nothing" are different claims.
  assert.deepEqual(sumSpend([{ spent: {} }, { spent: {} }], 'a'), { total: null, absent: 2, seeds: 2 });
  assert.deepEqual(sumSpend([], 'a'), { total: null, absent: 0, seeds: 0 });
});

test('the spend note names the runtime that was actually billed, not a literal', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'bench-second-opinion.mjs'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.ok(!/\$note: 'Anthropic only/.test(code),
    'a vendor literal persisted in a result attributes spend to whoever was hardcoded, not whoever ran');
  assert.ok(/FORGE_RUNTIME_NAME/.test(code),
    'the note must come from the runtime the adapter table selected');
});

// G-22 of run 20260924-145430-post-med2 — `panel-codex-code`, verified in source.
//
// `Number(tbEnvelope?.total_cost_usd)` then `Number.isFinite(spent)`. `Number(null)` is 0 and 0 is
// finite — so a judge whose vendor explicitly reported `total_cost_usd: null` was counted as having
// cost zero and never reached `unmeasured`. The comment directly above that tally states the intent
// the code defeats: "unmeasured names the judges whose vendor reported nothing, because a total
// that silently omits them reads as cheaper than it was."
//
// SECOND TIME THIS COERCION CLASS HAS BITTEN TODAY. `?? 0` in the bench aggregate turned an
// unpriced seed into a free one (G-7); this turns an unpriced judge into a free one. Same mistake,
// two spellings, so the decision is extracted once rather than spelled a third time.
test('a null price is unmeasured, not zero', async () => {
  const { measuredUsd } = await import('../scripts/lib/decisions.mjs');

  // ABSENT IS NOT FREE. These are the spellings a vendor actually returns for "no figure".
  for (const absent of [null, undefined, '', '   ', NaN, {}, []]) {
    assert.equal(measuredUsd(absent), null, `${JSON.stringify(absent)} is an absence, not a price`);
  }

  // A REAL ZERO IS A REAL PRICE and must survive — a cached call genuinely costing nothing is a
  // measurement, and refusing it would be the same error in the other direction.
  assert.equal(measuredUsd(0), 0);
  assert.equal(measuredUsd(1.25), 1.25);
  assert.equal(measuredUsd('2.50'), 2.5, 'a numeric string is a figure the vendor did report');
  assert.equal(measuredUsd(-1), null, 'a negative price is not a price');
});
