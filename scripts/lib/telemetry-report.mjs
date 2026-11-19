// telemetry-report.mjs — WHAT THE RECORDS ADD UP TO (telemetry-records.plan.md stage 4). Pure: the records arrive parsed,
// the figures leave as data, and a renderer turns them into the text `telemetry.mjs report` prints. Every figure carries
// its sample size; no threshold is built in and nothing is recommended (criteria 2-5 are M2 item 6's second plan).
// Tokens are summed per usage FIELD and per FAMILY, never across families: two vendors' "input tokens" are not one unit.

import { taskRan } from './telemetry-record.mjs';
import { addUsage } from './reviewers.mjs';

// Criterion 7's other half: every count the artifacts already record beyond the report's figures (the stage 1 inventory),
// printed by `report --fields` so the list is report output.
export const OTHER_COUNTS = Object.freeze([
  'findings and rejected findings per node', 'validator errors per node', 'stdout and stderr bytes per node',
  'permission denials per node', 'subagent statistics per node', 'reviewer preflight results per run',
  'stamps per run', 'the gate verdict per run', "the reconciler's decision and severity per group",
  'remediation clusters committed and refused', 'report-check and commit-check outcomes', 'commit retries',
  'claim-check claims by grade, and kind disagreements', 'bench recall, false-positive candidates and unscored spend',
]);

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A record's date: its `started_at`, else the date its run id begins with (`20261025-...`, a bench stamp `2026-09-24T...`).
 * Null when neither says, and such a record is kept by a --since filter only when no date is asked for.
 */
export function recordDate(r) {
  const s = Date.parse(r?.started_at ?? '');
  if (Number.isFinite(s)) return s;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(String(r?.run_id ?? ''));
  return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`) : null;
}

/** Keeps a record when it is of `kind` (if given) and dated on or after `since` (an ISO date, if given). */
export function selectRecords(records, { since = null, kind = null } = {}) {
  const from = since ? Date.parse(since) : null;
  if (since && !Number.isFinite(from)) throw new Error(`--since ${since} is not a date`);
  return records.filter((r) => (!kind || r.kind === kind) && (from === null || (recordDate(r) ?? -Infinity) >= from));
}

// ---------------------------------------------------------------------------- where a run's time goes
// telemetry-run-time.plan.md stage 1 (operator, 2026-10-27: "I noticed the run itself took 30 minutes"): a run's own start
// and end were in every record and in no figure. A phase is the wall-clock span of its tasks, first start to last end,
// because its tasks overlap; the time no task covers is reported too, so an untimed phase still shows as a gap.

/** Which task kinds make each phase, in the order a run goes through them. */
export const PHASES = Object.freeze({
  preflight: ['check'], intent: ['intent-capture', 'request-capture'], fanout: ['lens', 'arm'],
  barrier: ['reconcile', 'reask', 'second-opinion', 'adjudicator'], remediation: ['remediation'],
});
const PHASE_LABEL = { preflight: 'pre-flight', intent: 'intent', fanout: 'fan-out', barrier: 'barrier', remediation: 'remediation node' };

const at = (s) => { const n = Date.parse(s ?? ''); return Number.isFinite(n) ? n : null; };
const ran = taskRan;
const intervalOf = (t) => { const s = at(t.started_at), e = at(t.ended_at); return s !== null && e !== null && e >= s ? [s, e] : null; };
const spanOf = (ivs) => (ivs.length ? Math.max(...ivs.map((i) => i[1])) - Math.min(...ivs.map((i) => i[0])) : null);

/** The length of the union of intervals, clipped to [lo, hi]. */
function covered(ivs, lo, hi) {
  const xs = ivs.map(([s, e]) => [Math.max(s, lo), Math.min(e, hi)]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let total = 0; let cur = null;
  for (const [s, e] of xs) {
    if (!cur || s > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [s, e]; } else cur[1] = Math.max(cur[1], e);
  }
  return cur ? total + cur[1] - cur[0] : 0;
}

/**
 * One record's timeline: the run's duration, each phase's span and its untimed task count, the fan-out's lens and arm
 * spans, and the time no task covers. Skipped tasks are left out. A duration the record cannot give is null, never 0.
 */
export function runTimeline(record) {
  const s = at(record?.started_at), e = at(record?.ended_at);
  const run_ms = s !== null && e !== null && e >= s ? e - s : null;
  const tasks = (record?.tasks ?? []).filter(ran);
  const phases = {};
  for (const [phase, kinds] of Object.entries(PHASES)) {
    const own = tasks.filter((t) => kinds.includes(t.task_kind));
    if (!own.length) continue;
    const ivs = own.map(intervalOf).filter(Boolean);
    phases[phase] = { span_ms: spanOf(ivs), untimed: own.length - ivs.length };
    if (phase === 'fanout') {
      phases[phase].lens_span_ms = spanOf(own.filter((t) => t.task_kind === 'lens').map(intervalOf).filter(Boolean));
      phases[phase].arm_span_ms = spanOf(own.filter((t) => t.task_kind === 'arm').map(intervalOf).filter(Boolean));
    }
  }
  const all = tasks.map(intervalOf).filter(Boolean);
  // A record with no tasks (a suite run's) has no time a task could cover: null, not its whole duration.
  const uncovered_ms = run_ms === null || !tasks.length ? null : run_ms - covered(all, s, e);
  return { run_ms, phases, uncovered_ms };
}

/**
 * The figures: per kind the record count; the tie-break count; per family groups raised, confirmed and corroborated;
 * claim-check discards and revisions; per task (by kind, and per lens or arm id) time and tokens, with sample sizes; per
 * kind the run time and, per phase, its span; and the skipped tasks, counted apart from every duration.
 */
export function reportFigures(records) {
  const byKind = {};
  const families = {};
  let familyRuns = 0;
  let tieBreaks = 0; let runsAdjudicated = 0;
  const claims = { checks: 0, total: 0, dissolved: 0, downgraded: 0, questions: 0 };
  const tasks = {};
  const skipped = {};
  const runTime = {};
  const suiteFiles = {};
  let development = 0;
  // The decision panel's decisions (autonomous-run.plan.md stage 8): outcome and agreement, reversals counted against the
  // decisions the panel took, the operator's sample marks, and the rounds; every figure with its n.
  const decisions = { n: 0, by_outcome: {}, by_agreement: {}, revoted: 0, overruled: { n: 0, count: 0 },
    sample: { n: 0, agree: 0, differ: 0 }, rounds: [], moderator_rounds: 0 };
  for (const r of records) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    if (r.kind === 'decision') {
      decisions.n += 1;
      decisions.by_outcome[r.outcome] = (decisions.by_outcome[r.outcome] ?? 0) + 1;
      decisions.by_agreement[r.agreement] = (decisions.by_agreement[r.agreement] ?? 0) + 1;
      if (r.revoted) decisions.revoted += 1;
      if (r.outcome === 'majority') { decisions.overruled.n += 1; if (r.overruled) decisions.overruled.count += 1; }
      if (r.sample === 'agree' || r.sample === 'differ') { decisions.sample.n += 1; decisions.sample[r.sample] += 1; }
      if (typeof r.rounds === 'number') decisions.rounds.push(r.rounds);
      decisions.moderator_rounds += typeof r.moderator_rounds === 'number' ? r.moderator_rounds : 0;
    }
    const tl = runTimeline(r);
    const rt = (runTime[r.kind] ??= { n: 0, runs: [], phases: {}, uncovered: [], mint: [], fromMint: 0, queued: { lens: [], arm: [] } });
    rt.n += 1;
    // Stage 2: the mint is its own figure, and a record that still starts at the mint is counted, not hidden.
    if (typeof r.mint?.duration_ms === 'number') rt.mint.push(r.mint.duration_ms);
    if (r.started_from === 'mint') rt.fromMint += 1;
    for (const t of r.tasks ?? []) {
      if (ran(t) && rt.queued[t.task_kind] && typeof t.queued_ms === 'number') rt.queued[t.task_kind].push(t.queued_ms);
    }
    if (tl.run_ms !== null) rt.runs.push(tl.run_ms);
    if (tl.uncovered_ms !== null) rt.uncovered.push(tl.uncovered_ms);
    for (const [phase, p] of Object.entries(tl.phases)) {
      const ph = (rt.phases[phase] ??= { spans: [], untimed: 0 });
      if (p.span_ms !== null) ph.spans.push(p.span_ms);
      ph.untimed += p.untimed;
    }
    // The suite's records (stage 3): each test file's duration, per file across runs.
    for (const f of r.kind === 'suite' && Array.isArray(r.files) ? r.files : []) {
      if (typeof f?.file === 'string' && typeof f.duration_ms === 'number') (suiteFiles[f.file] ??= []).push(f.duration_ms);
    }
    if (r.development_data === true) development += 1;
    // A run counts toward the family figures only when it held reconciled groups: a remediation's record has none.
    const pf = r.findings?.per_family;
    if (pf && (r.findings.groups ?? 0) > 0) {
      familyRuns += 1;
      for (const [fam, c] of Object.entries(pf)) {
        const f = (families[fam] ??= { raised: 0, confirmed: 0, corroborated: 0 });
        f.raised += c.raised ?? 0; f.confirmed += c.confirmed ?? 0; f.corroborated += c.corroborated ?? 0;
      }
    }
    if (r.claims) {
      claims.checks += 1;
      for (const k of ['total', 'dissolved', 'downgraded', 'questions']) claims[k] += typeof r.claims[k] === 'number' ? r.claims[k] : 0;
    }
    const adj = (r.tasks ?? []).filter((t) => t.task_kind === 'adjudicator');
    if (adj.length) { runsAdjudicated += 1; tieBreaks += adj.length; }
    for (const t of r.tasks ?? []) {
      // Grouped by kind, and for a lens or an arm by its id too: "time and tokens per lens".
      const keys = [`${t.task_kind}`];
      if (t.task_kind === 'lens' || t.task_kind === 'arm') keys.push(`${t.task_kind}:${t.id}`);
      // A SKIPPED task is not a run: counted apart, in no duration (it pulled every lens median toward zero).
      if (!ran(t)) { for (const key of keys) skipped[key] = (skipped[key] ?? 0) + 1; continue; }
      for (const key of keys) {
        const fam = t.family ?? 'none';
        const e = (tasks[key] ??= {});
        const g = (e[fam] ??= { n: 0, timed: 0, durations: [], usage: {}, with_usage: 0, cost_usd: 0, priced: 0 });
        g.n += 1;
        if (typeof t.duration_ms === 'number') { g.timed += 1; g.durations.push(t.duration_ms); }
        if (addUsage(g.usage, t.usage)) g.with_usage += 1;
        if (typeof t.cost_usd === 'number') { g.cost_usd += t.cost_usd; g.priced += 1; }
      }
    }
  }
  for (const e of Object.values(tasks)) {
    for (const g of Object.values(e)) {
      g.duration_ms = { total: g.durations.reduce((a, b) => a + b, 0), median: median(g.durations) };
      delete g.durations;
    }
  }
  const stat = (xs) => ({ n: xs.length, total: xs.reduce((a, b) => a + b, 0), median: median(xs) });
  const run_time = Object.fromEntries(Object.entries(runTime).map(([k, rt]) => [k, {
    records: rt.n, run_ms: stat(rt.runs), uncovered_ms: stat(rt.uncovered),
    mint_ms: stat(rt.mint), from_mint: rt.fromMint,
    queued: Object.fromEntries(Object.entries(rt.queued).map(([q, xs]) => [q, stat(xs)])),
    phases: Object.fromEntries(Object.entries(rt.phases).map(([p, ph]) => [p, { ...stat(ph.spans), untimed: ph.untimed }])),
  }]));
  return {
    records: records.length, by_kind: byKind, development_records: development,
    tie_breaks: { judges: tieBreaks, runs: runsAdjudicated },
    families: { runs: familyRuns, per_family: families },
    claims, tasks, skipped, run_time,
    decisions: { ...decisions, rounds: stat(decisions.rounds) },
    // The slowest test files by their median over the suite records that timed them, ten at most.
    suite_files: Object.entries(suiteFiles).map(([file, xs]) => ({ file, ...stat(xs) }))
      .sort((a, b) => b.median - a.median).slice(0, SLOWEST_FILES),
  };
}

const mins = (ms) => (ms == null ? 'n/a' : `${(ms / 60000).toFixed(1)} min`);
const SLOWEST_FILES = 10;

/** The text `telemetry.mjs report` prints: each figure beside its sample size. */
export function renderReport(fig, { locations = [], fields = false, label = null } = {}) {
  const L = [];
  L.push(`telemetry report — ${fig.records} record(s)${label ? ` (${label})` : ''}`);
  if (fig.development_records) {
    L.push(`  ${fig.development_records} of them made by the framework reviewing itself: development data, for improving the tool,`,
      '  not a measure of how it serves a consuming project.');
  }
  if (locations.length) {
    L.push('', 'Where the records were looked for:');
    for (const l of locations) L.push(`  ${String(l.found).padStart(5)}  ${l.where}${l.unreadable ? `  (UNREADABLE: ${l.unreadable})` : ''}`);
  }
  L.push('', 'Records by kind:');
  for (const [k, n] of Object.entries(fig.by_kind)) L.push(`  ${String(n).padStart(5)}  ${k}`);
  if (fig.run_time && Object.keys(fig.run_time).length) {
    L.push('', 'Run time per kind (a run\'s own start to its end; a phase is its tasks\' first start to last end):');
    for (const [k, rt] of Object.entries(fig.run_time)) {
      L.push(`  ${k.padEnd(12)} n=${rt.run_ms.n}  total ${mins(rt.run_ms.n ? rt.run_ms.total : null)}, median ${mins(rt.run_ms.median)}`
        // Every record with no duration, its start, its end or both missing (G-8 of 20261027-071443-trt-delivery); a zero
        // is rendered too, beside its n, never left out (G-6 of 20261027-083759-trt-remediation-review).
        + `  (${rt.records - rt.run_ms.n} record(s) with no duration: a start or an end missing)`);
      for (const phase of Object.keys(PHASES)) {
        const ph = rt.phases[phase];
        if (!ph) continue;
        L.push(`    ${PHASE_LABEL[phase].padEnd(24)} n=${ph.n} timed  median ${mins(ph.median)}  (untimed ${ph.untimed} task(s))`);
      }
      if (rt.uncovered_ms.n) L.push(`    ${'not covered by any task'.padEnd(24)} n=${rt.uncovered_ms.n}  median ${mins(rt.uncovered_ms.median)}`);
      for (const [q, s] of Object.entries(rt.queued ?? {})) {
        if (s.n) L.push(`    ${`${q} wait for a slot`.padEnd(24)} n=${s.n}  median ${mins(s.median)}`);
      }
      if (rt.mint_ms?.n) L.push(`    ${'mint (its own command)'.padEnd(24)} n=${rt.mint_ms.n}  median ${mins(rt.mint_ms.median)}`);
      // A zero is rendered too, for the kinds whose record has a start of its own (G-2 of
      // 20261027-094343-trt-remediation-2-review): left out, it read as a figure never computed.
      if ((k === 'review' || k === 'remediation') && typeof rt.from_mint === 'number') L.push(`    (${rt.from_mint} record(s) start at the mint: written before run-graph recorded its own start)`);
    }
  }
  if (fig.suite_files?.length) {
    L.push('', `Suite: the ${fig.suite_files.length} slowest test file(s), by median over the suite runs that timed each:`);
    for (const f of fig.suite_files) L.push(`  ${mins(f.median).padStart(9)}  n=${f.n}  ${f.file}`);
  }
  L.push('', `Tie-breaks: ${fig.tie_breaks.judges} judge call(s) in ${fig.tie_breaks.runs} run(s)`);
  L.push('', `Findings per family (n = ${fig.families.runs} run(s) with reconciled groups):`);
  for (const [fam, c] of Object.entries(fig.families.per_family)) {
    L.push(`  ${fam.padEnd(12)} raised ${c.raised}, confirmed ${c.confirmed}, corroborated by the other family ${c.corroborated}`);
  }
  const c = fig.claims;
  L.push('', `Claim checks (n = ${c.checks}): ${c.total} claim(s), ${c.dissolved} discarded (dissolved), `
    + `${c.downgraded + c.questions} revised (${c.downgraded} downgraded, ${c.questions} turned into questions)`);
  const d = fig.decisions;
  if (d) {
    const list = (o) => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
    L.push('', `Decisions (n = ${d.n}): by outcome ${list(d.by_outcome)}; by agreement ${list(d.by_agreement)}`);
    L.push(`  revoted ${d.revoted}; rounds per decision n=${d.rounds.n}, median ${d.rounds.median ?? 'n/a'}; moderator extensions ${d.moderator_rounds}`);
    L.push(`  overruled by the operator: ${d.overruled.count} of ${d.overruled.n} decision(s) the panel took`);
    L.push(`  sampled (n = ${d.sample.n}): ${d.sample.agree} agree, ${d.sample.differ} would have chosen differently`);
  }
  L.push('', 'Time and tokens per task (per family; tokens per usage field, never summed across families):');
  for (const key of Object.keys(fig.tasks).sort()) {
    for (const [fam, g] of Object.entries(fig.tasks[key])) {
      L.push(`  ${key.padEnd(34)} ${fam.padEnd(10)} n=${g.n}  time: ${mins(g.duration_ms.total)} total, median ${mins(g.duration_ms.median)} (n=${g.timed})`
        + `  cost: ${g.priced ? `$${g.cost_usd.toFixed(2)} (n=${g.priced}, vendor-reported)` : 'none reported'}`);
      const u = Object.entries(g.usage);
      if (u.length) L.push(`  ${''.padEnd(34)} ${''.padEnd(10)} tokens (n=${g.with_usage}): ${u.map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
  }
  // Per kind AND per lens or arm (shared/telemetry.md): a kind's total was dropped whenever an id under it was listed (G-10
  // of 20261027-071443-trt-delivery).
  const sk = Object.entries(fig.skipped ?? {});
  if (sk.length) {
    L.push('', 'Skipped (not runs, left out of every time above):');
    for (const [k, n] of sk.sort()) L.push(`  ${k.padEnd(34)} ${n}`);
  }
  if (fields) {
    L.push('', 'Other counts the artifacts already record (criterion 7):');
    for (const f of OTHER_COUNTS) L.push(`  - ${f}`);
  }
  return `${L.join('\n')}\n`;
}
