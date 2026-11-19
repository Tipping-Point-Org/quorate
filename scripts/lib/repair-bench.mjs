// WHAT THE REPAIR-PASS BENCH ADDS UP TO (remediation-repair-pass.plan.md stage 4). Pure: the cases scripts/bench-repair-pass.mjs
// measured (each case's result.json), rendered as the slots of prompts/_templates/repair-bench-results.md. Every figure
// is printed beside the number of cases it is drawn from, because three cases are a sample, not a rate.
import { failingTestsWithFiles, RUN_JSON_FAILING_NAMES } from './full-check.mjs';
import { usageTokensOnce } from './bench-settings.mjs';

const min = (ms) => (Number.isFinite(ms) ? `${(ms / 60000).toFixed(1)} min` : 'n/a');
const usd = (x) => (Number.isFinite(x) ? `$${x.toFixed(2)}` : 'n/a');
// A figure one of whose parts was not read is unknown, NaN, printed n/a: summed as 0 it understated the cost (G-9 of
// 20261102-024315-rrp-delivery). Within one node's usage, an absent cache field is a zero the vendor left out.
const sum = (xs) => xs.reduce((n, x) => n + (Number.isFinite(x) ? x : NaN), 0);
// Input and output are required: one of them missing is an unread figure (G-8 of 20261102-033648-rrp-remediation-review).
// Each counted key once, by the one owner of which keys count (G-3 of 20261114-195905-m2-pred1-remediation-2-review): four
// fixed Claude keys dropped agy's cache_read_tokens.
export const passTokens = (u) => {
  if (!u || !Number.isFinite(u.input_tokens) || !Number.isFinite(u.output_tokens)) return NaN;
  return usageTokensOnce(u);
};
const tokens = passTokens;

/**
 * One full check's time, every declared check's `duration_ms` summed: null when any of them was not read, so the table
 * prints n/a rather than an understated time (G-4 of 20261102-033648-rrp-remediation-review). `results`: run.json's
 * full_checks[].results.
 */
export function checkMs(results) {
  const xs = Object.values(results ?? {}).map((x) => x?.duration_ms);
  return xs.length && xs.every(Number.isFinite) ? xs.reduce((n, x) => n + x, 0) : null;
}

// How many of a check's failing names scripts/remediate.mjs keeps in run.json: owned by lib/full-check.mjs (G-9 of
// 20261102-161123-rbr-delivery), re-exported for this module's readers.
export { RUN_JSON_FAILING_NAMES };

/**
 * A check's failing tests, whole, sorted, or null when they cannot be known (G-3 of 20261102-033648-rrp-remediation-
 * review): read from its log when the log was read (`logText`), otherwise run.json's copy, which is whole only when it
 * is shorter than the RUN_JSON_FAILING_NAMES it is cut to. `test`: run.json's results.test.
 */
export function failingOf(test, logText) {
  const byKey = (x, y) => key(x).localeCompare(key(y));
  if (logText !== null && logText !== undefined) return failingTestsWithFiles(logText).sort(byKey);
  const names = Array.isArray(test?.failing_names) ? test.failing_names : null;
  return names && names.length < RUN_JSON_FAILING_NAMES ? names.map((name) => ({ name, file: null })).sort(byKey) : null;
}

// One failing test as { name, file }: a name alone (an older result.json, or run.json's copy) has no file.
const entry = (x) => (x && typeof x === 'object' ? { name: String(x.name), file: x.file ?? null } : { name: String(x), file: null });
const key = (x) => `${entry(x).name}\u0000${entry(x).file ?? ''}`;

/**
 * Two checks failed the same way: both known, not empty, and the same tests. Each test is its name AND its file where
 * both sides name every file (G-9 of 20261102-060316-rrp-remediation-3-review: a name failing in two files compared equal
 * to it failing in one); where either side lacks a file, as run.json's copy does, the names are compared.
 */
export function sameFailures(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return false;
  const withFiles = [...a, ...b].every((x) => entry(x).file !== null);
  const set = (xs) => JSON.stringify([...new Set(xs.map((x) => (withFiles ? key(x) : entry(x).name)))].sort());
  return set(a) === set(b);
}

/**
 * Every file the repair passes changed, or null when a pass's change set was not known (G-3 of
 * 20261102-060316-rrp-remediation-3-review: a recorded null read as no change, so the diff understated the repair).
 */
export function changedFiles(passes = []) {
  if (passes.some((p) => !Array.isArray(p?.changed))) return null;
  return [...new Set(passes.flatMap((p) => p.changed))];
}

/**
 * The added and removed lines of each `{ before, after }` blob pair (a hash, or null for absent), in ONE batch (G-4 of
 * 20261111-192009-runtime-bin-remediation-review: the bench started a `git diff --numstat` per file). The before blobs go
 * in one flat tree and the after blobs in another, each pair under its index as the entry name, and one
 * `git diff-tree --numstat` between the two answers every pair: three git calls whatever the number of files. `run(args,
 * input)` is the git runner, so this stays free of I/O. Each answer is `{ added, removed, why }`: an entry the diff does
 * not name is unchanged (0, 0); a binary file's "-" counts, an answer that does not line up, or any failed call is
 * unknown (`added`/`removed` null, `why` saying which), never 0 lines (G-7 of 20261102-161123-rbr-delivery).
 */
export function numstatOfBlobPairs(run, pairs = []) {
  if (!pairs.length) return [];
  const unknown = (why) => pairs.map(() => ({ added: null, removed: null, why }));
  const tree = (side) => {
    const input = pairs.map((p, i) => (p[side] ? `100644 blob ${p[side]}\t${i}\0` : '')).join('');
    const r = run(['mktree', '-z'], input);
    return r.status === 0 ? { hash: String(r.stdout).trim() } : { why: `git mktree exited ${r.status}` };
  };
  const before = tree('before');
  if (!before.hash) return unknown(before.why);
  const after = tree('after');
  if (!after.hash) return unknown(after.why);
  const d = run(['diff-tree', '-r', '-z', '--no-renames', '--numstat', before.hash, after.hash], null);
  if (d.status !== 0) return unknown(`git diff-tree exited ${d.status}`);
  const out = pairs.map(() => ({ added: 0, removed: 0, why: null }));
  for (const rec of String(d.stdout ?? '').split('\0').filter(Boolean)) {
    const m = /^(\S+)\t(\S+)\t(\d+)$/.exec(rec);
    const i = m ? Number(m[3]) : -1;
    if (!m || i >= pairs.length) return unknown(`git diff-tree answered ${JSON.stringify(rec)}, not one of the pairs`);
    out[i] = /^\d+$/.test(m[1]) && /^\d+$/.test(m[2])
      ? { added: Number(m[1]), removed: Number(m[2]), why: null }
      : { added: null, removed: null, why: `numstat ${JSON.stringify([m[1], m[2]])}` };
  }
  return out;
}

/**
 * What a case's record says when its worktree could not be removed (G-4 of 20261102-060316-rrp-remediation-3-review):
 * nothing when it was; otherwise an `error`, whatever it measured, with the status it had and the path left behind, so a
 * leftover worktree is a failed case rather than a line on stderr.
 */
export function afterCleanup(result, { removed, worktree }) {
  if (removed) return {};
  return { status: 'error', status_before_cleanup: result?.status ?? null, worktree_left: worktree,
    why: `${result?.why ? `${result.why}; ` : ''}its worktree ${worktree} could not be removed` };
}

/**
 * The refusal was reproduced (G-3 of 20261102-044855-rrp-remediation-2-review): the reproducing run reached its
 * --measure-only end (`exit` 0: a killed or crashed run may already have written a matching check), its check (`check`,
 * run.json's full_checks entry) failed on the recorded names (`failing`, `recorded`), and refused on the same keys the
 * original check did (`recordedRefusals`), only test: a replay that lost another original refusal is not that refusal.
 */
export function reproduced({ exit, check, failing, recorded, recordedRefusals }) {
  if (exit !== 0 || !check || !sameFailures(failing, recorded)) return false;
  const keys = (xs) => JSON.stringify([...new Set(xs)].sort());
  const now = (check.refusals ?? []).map((r) => r.key);
  return now.length > 0 && now.every((k) => k === 'test') && keys(now) === keys(recordedRefusals ?? []);
}

/**
 * What the repair run's case is (G-4 of 20261102-044855-rrp-remediation-2-review): a run that did not reach its
 * --measure-only end (which exits 0) is an `error` whether or not it recorded a pass, read before the pass count, so a
 * crash before the first pass is never an ordinary `no-pass`; then `no-pass` when none was offered; else `measured`.
 */
export function repairRunOutcome({ exit, passes }) {
  if (exit !== 0) return 'error';
  return passes > 0 ? 'measured' : 'no-pass';
}

// A diff rebuilt after the run (`diff_rebuilt`, with its `source`) is shown in place of the bench's own, marked, and the
// totals say why: the first run's bench compared a file outside the candidate with an empty file.
const diffCell = (r) => {
  const d = r.diff_rebuilt ?? r.diff;
  return d ? `${d.files} file(s), +${d.added} -${d.removed}${r.diff_rebuilt ? ' (rebuilt)' : ''}` : 'n/a';
};

/** `results`: every case's result.json. Returns { cases, rows, outcomes, totals, not_measured }. */
export function repairBenchSummary(results = []) {
  // A case measured again replaces its earlier result (`superseded_by`, set on the earlier one): listed apart, never
  // counted with the rest.
  const sorted = [...results].sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  const all = sorted.filter((r) => !r.superseded_by);
  const superseded = sorted.filter((r) => r.superseded_by)
    .map((r) => `- ${r.case}, measured ${r.started_at}: ${r.status}, green after ${r.green_after ?? 'n/a'}; superseded by ${r.superseded_by}: ${r.superseded_why ?? ''}`).join('\n') || '- none';
  const measured = all.filter((r) => r.status === 'measured');
  const rows = all.map((r) => {
    const passes = r.passes ?? [];
    const nodeMs = sum(passes.map((p) => p.node_ms));
    const checkMs = sum([r.reproduce?.check_ms, ...passes.map((p) => p.check_ms)]);
    const cost = sum(passes.map((p) => p.cost_usd));
    const tok = sum(passes.map((p) => tokens(p.usage)));
    return `| ${r.case} | ${r.status}${r.why && r.status !== 'measured' ? `: ${String(r.why).replace(/\|/g, '/').slice(0, 160)}` : ''} | `
      + `${(r.recorded_failing ?? []).length} | ${r.green_after ?? 'n/a'} | ${passes.length} | ${min(nodeMs)} | ${min(checkMs)} | `
      + `${diffCell(r)} | ${passes.length && Number.isFinite(tok) ? tok : 'n/a'} | ${passes.length ? usd(cost) : 'n/a'} | ${min(r.wall_ms)} |`;
  });
  const n = measured.length;
  // Counted once, read per bucket: a filter per bucket was O(M²) in the cases (G-11 of 20261102-161123-rbr-delivery).
  const counts = new Map();
  for (const r of measured) counts.set(r.green_after, (counts.get(r.green_after) ?? 0) + 1);
  const after = (k) => counts.get(k) ?? 0;
  // Every pass a case went green on gets its bucket, at whatever --cap it ran (G-10 of 20261102-024315-rrp-delivery).
  // A green_after past its case's own cap is no pass the bench ran, so it sizes nothing (G-9 of 20261102-033648-rrp-
  // remediation-review): a hand-edited 4294967296 threw, and smaller large numbers could exhaust memory.
  // Every result.json the bench writes records its cap; one without it is bounded by nothing it recorded.
  const inCap = (r) => Number.isInteger(r.green_after) && r.green_after >= 1 && (!Number.isInteger(r.cap) || r.green_after <= r.cap);
  // The buckets are passes 1-3 and each other pass a case went green on, so the list is sized by the cases, never by a
  // recorded number (G-7 of 20261102-044855-rrp-remediation-2-review: with no cap, a large green_after sized it). A
  // green_after that is neither in its cap nor 'never' is still a measured case, counted in a bucket of its own, so the
  // buckets add up to n.
  const keys = [...new Set([1, 2, 3, ...measured.filter(inCap).map((r) => r.green_after)])].sort((a, b) => a - b);
  const outside = measured.filter((r) => !inCap(r) && r.green_after !== 'never').length;
  const outcomes = n
    ? keys.map((k) => `- green after pass ${k}: ${after(k)} of ${n}`).concat([`- never green within the cap: ${after('never')} of ${n}`],
      outside ? [`- green after a pass outside its recorded cap, or not a pass: ${outside} of ${n}`] : []).join('\n')
    : '- no case measured yet';
  // A pass that ended the passes is named with its reason, so a case never green says why.
  const ended = measured.flatMap((r) => (r.passes ?? []).filter((p) => p.outcome === 'refused')
    .map((p) => `- ${r.case}, pass ${p.pass} not admitted: ${String(p.why ?? '').replace(/\|/g, '/').slice(0, 400)}`));
  const allPasses = measured.flatMap((r) => r.passes ?? []);
  const totals = [
    `- cases attempted: ${all.length}; measured: ${n}; not measured: ${all.length - n}`,
    `- repair passes run: ${allPasses.length} (n = ${n} case(s))`,
    `- repair node time: ${min(sum(allPasses.map((p) => p.node_ms)))} over ${allPasses.length} pass(es)`,
    `- full-check time, reproduction included: ${min(sum(measured.flatMap((r) => [r.reproduce?.check_ms, ...(r.passes ?? []).map((p) => p.check_ms)])))} (n = ${n})`,
    `- repair node vendor cost: ${usd(sum(allPasses.map((p) => p.cost_usd)))} over ${allPasses.length} pass(es), as each node's own output reports it`,
    `- wall time, every case: ${min(sum(all.map((r) => r.wall_ms)))} (n = ${all.length})`,
    ...(all.some((r) => r.diff_rebuilt) ? [`- (rebuilt): ${all.filter((r) => r.diff_rebuilt).length} case(s) whose diff was rebuilt after the run: ${all.find((r) => r.diff_rebuilt).diff_rebuilt.source}`] : []),
  ].join('\n');
  const notMeasured = all.filter((r) => r.status !== 'measured').map((r) => `- ${r.case}: ${r.status} — ${r.why ?? ''}`).join('\n') || '- none';
  return { cases: String(all.length), rows: rows.join('\n') || '| none | | | | | | | | | | |', outcomes: [outcomes, ...ended].join('\n'), totals, not_measured: notMeasured, superseded };
}
