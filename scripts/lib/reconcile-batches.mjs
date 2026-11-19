// reconcile-batches.mjs — how the barrier's finding groups are split when there are too many for one
// reconcile, and how the batches' payloads are merged back into the one payload everything downstream reads.
//
// WHY THERE ARE BATCHES AT ALL. The reconcile output schema caps `groups` at RECONCILE_MAX_GROUPS. A
// whole-product sweep of story-pipeline (run 20261005-235247-product-sweep) produced 156 groups; the
// reconciler judged 80 and left 76 neither confirmed nor dropped. Raising the cap was rejected: ~1k output
// tokens per group puts 156 groups past what one reply can carry (operator, 2026-10-06: "Batch by file").
// The batches run inside the ONE reconcile node (operator: "One node, batches inside"), so nothing that
// reads reconcile's status or payload has to know they exist.
//
// Pure: no I/O. The caller writes the files and spawns the node.

import { usableCost } from './decisions.mjs';

/** The most groups one reconcile reply may carry — the output schema's maxItems reads this. */
export const RECONCILE_MAX_GROUPS = 80;

/**
 * Partition groups into batches of at most `max`, keeping each FILE's groups in one batch where possible,
 * because a `symptom` names its root cause by id and that link can only be made inside one batch. Files are
 * packed greedily in the order given (the barrier sorts by file). A single file with more than `max` groups
 * is split across batches; those are returned in `splitFiles` so the run can say a link may be missing.
 *
 * Returns { batches: group[][], splitFiles: string[] }. One batch when everything fits — the unbatched case.
 */
export function reconcileBatches(groups, max = RECONCILE_MAX_GROUPS) {
  if (!Number.isInteger(max) || max < 1) throw new Error(`reconcileBatches: max must be a positive integer, got ${max}`);
  const byFile = [];
  for (const g of groups) {
    const last = byFile[byFile.length - 1];
    if (last && last.file === g.file) last.groups.push(g);
    else byFile.push({ file: g.file, groups: [g] });
  }
  const batches = [];
  const splitFiles = [];
  let current = [];
  const flush = () => { if (current.length) { batches.push(current); current = []; } };
  for (const { file, groups: fg } of byFile) {
    if (fg.length > max) {
      flush();
      splitFiles.push(file);
      for (let i = 0; i < fg.length; i += max) batches.push(fg.slice(i, i + max));
      continue;
    }
    if (current.length + fg.length > max) flush();
    current.push(...fg);
  }
  flush();
  return { batches: batches.length ? batches : [[]], splitFiles };
}

/**
 * THE ONE RULE FOR A BATCHED BARRIER'S MONEY AND TIME (round 3 of the consumer-use review; operator, 2026-10-07:
 * "One rule"). Two patches had each left a hole: an unknown-cost batch was charged nothing, so the next was granted the
 * whole budget again (G-10), and the merged status could read unlaunched and be charged nothing (G-6).
 *
 * The share: of what the barrier has left (budget not yet charged, time not yet used), a batch is granted the fraction
 * its groups are of the groups left, but never less than a FLOOR -- the smaller of RECONCILE_BATCH_FLOOR_MINUTES and an
 * even share per batch left. The budget follows the same fraction as the time.
 * - An even share PER BATCH (G-15 of 20261007-073125-reconcile-batches-review) gave story-pipeline's 80-group batch
 *   17.5 of 35 minutes beside a 2-group batch, and it was killed (run 20261008-003626-round2-review).
 * - A share with no floor (G-7 of 20261008-021115-batch-share-review) gave a 2-group batch AHEAD of a 79-group one
 *   0.86 of 35 minutes, under a reconcile node's measured 39-61 s. The floor bounds what a hung small batch can take
 *   from the large one at 5 minutes; the even-share cap keeps it from taking a short barrier whole (operator,
 *   2026-10-08: "D").
 * The last batch gets all that is left.
 */
export const RECONCILE_BATCH_FLOOR_MINUTES = 5;

export function batchFraction({ groupsInBatch, groupsLeft, batchesLeft, minutesLeft, floorMinutes }) {
  if (!(groupsLeft > 0) || !(groupsInBatch > 0)) return 0;
  const proportional = Math.min(groupsInBatch, groupsLeft) / groupsLeft;
  const even = batchesLeft > 0 ? 1 / batchesLeft : 1;
  const floor = Number.isFinite(minutesLeft) && minutesLeft > 0 && floorMinutes > 0 ? Math.min(even, floorMinutes / minutesLeft) : 0;
  return Math.min(1, Math.max(proportional, floor));
}

/** A fraction of what is left. Infinity (uncapped) stays Infinity. */
export function batchShare(left, fraction) {
  if (!(fraction > 0)) return 0;
  if (!Number.isFinite(left)) return left;
  return left * fraction;
}

/**
 * The charge: a batch's cost when known; nothing when it never launched; otherwise its whole grant — the most it could
 * have spent. null only when that grant is unbounded, where there is no ceiling to charge against.
 */
export function batchCharge({ cost, launched, grant }) {
  const usable = usableCost(cost);   // a negative or non-finite cost is unknown (lib/decisions.mjs, one owner)
  if (usable !== null) return usable;
  if (launched === false) return 0;
  return Number.isFinite(grant) ? grant : null;
}

/**
 * ONE BATCH'S REPLY, CHECKED AGAINST THE BATCH IT WAS GIVEN (design §2; G-3 of 20261007-050929-consumer-use-r4).
 * The merge used to pass every row through. Now: a row for an id outside the batch is dropped (`foreign`), a second row
 * for an id is dropped (`repeated`), and an id with no row is reported (`missing`). Nothing is fatal — the operator kept
 * coverage gaps "named, never fatal" (G-16) — but every gap is named, with its batch.
 */
export function validateBatchReply(batch, payload) {
  const given = new Set(batch.map((g) => g.group_id));
  const seen = new Set();
  const rows = [];
  const foreign = [];
  const repeated = [];
  for (const row of payload?.groups ?? []) {
    const id = row?.group_id;
    if (!given.has(id)) { foreign.push(id); continue; }
    if (seen.has(id)) { repeated.push(id); continue; }
    seen.add(id);
    rows.push(row);
  }
  const missing = batch.map((g) => g.group_id).filter((id) => !seen.has(id));
  return { rows, foreign, repeated, missing };
}

/**
 * A ROOT-CAUSE LINK MUST NAME A GROUP THE SAME REPLY JUDGED (design §3). A batch sees only its own groups, so a link
 * outside them is a guess; on any barrier, a link to an id no row carries points at nothing. Such a link is cleared —
 * the row keeps its decision and rationale — and returned as `{ from, to }` so the run can name it.
 */
export function checkRootLinks(rows) {
  const judged = new Set(rows.map((r) => r.group_id));
  const cleared = [];
  const out = rows.map((r) => {
    if (!r.root_cause_group || judged.has(r.root_cause_group)) return r;
    cleared.push({ from: r.group_id, to: r.root_cause_group });
    return { ...r, root_cause_group: '' };
  });
  return { rows: out, cleared };
}

/**
 * THE RENDER'S COVERAGE CHECK, OWNED HERE (A-1): every group the run produced judged exactly once, and no row for a group
 * it did not produce. Ids in `alreadyNamed` — named per batch by validateBatchReply — are left out, so a gap is named
 * once, by whichever check saw it first.
 */
export function coverageGaps(groupIds, rows, alreadyNamed = []) {
  const skip = new Set(alreadyNamed);
  const known = new Set(groupIds);
  const seen = new Map();
  for (const r of rows) seen.set(r.group_id, (seen.get(r.group_id) ?? 0) + 1);
  return {
    missing: groupIds.filter((id) => !seen.has(id) && !skip.has(id)),
    duplicated: [...seen.entries()].filter(([id, n]) => n > 1 && !skip.has(id)).map(([id]) => id),
    unknown: [...seen.keys()].filter((id) => !known.has(id) && !skip.has(id)),
  };
}

/**
 * The re-ask's groups file for its batch `n` (from 1), run-relative: run-graph writes it and the cleanup below clears
 * the pattern (G-9 of rmg-delivery). One file per batch since the re-ask runs through the barrier's batch loop
 * (reconcile-reask-shape.plan.md stage 1). Both are built from RECONCILE_REASK_GROUPS, the one name (G-1, G-2 of
 * 20261024-024945-rrs-delivery: the pattern was spelled twice, here and in RECONCILE_ARTIFACTS).
 */
export const RECONCILE_REASK_GROUPS = 'finding-groups.reask-*.json';
export const reaskGroupsFile = (n) => RECONCILE_REASK_GROUPS.replace('*', String(n));

/** The barrier's groups file for its batch `n` (from 1), run-relative, from the one pattern the cleanup clears (G-4 of
 * 20261024-032927-rrs-remediation-review: run-graph spelled it as a template of its own). */
export const RECONCILE_BATCH_GROUPS = 'finding-groups.batch-*.json';
export const batchGroupsFile = (n) => RECONCILE_BATCH_GROUPS.replace('*', String(n));

/**
 * WHAT ONE RE-ASK ATTEMPT RECORDS ABOUT ITSELF, from reconcileBatchLoop's result: its state, the batches it launched
 * (and planned), and the known part of the status's cost once its charges are added. Pure.
 * A failed batch's state is the attempt's; one cut short by time or budget is BLOCKED, as the barrier records the same
 * exhaustion (G-6 of 20261024-024945-rrs-delivery: it read OK with groups still missing). `batches` counts what was
 * launched, `batches_planned` what was partitioned, and the known cost adds each batch's usable cost (G-7).
 */
export function reaskOutcome({ planned, done, exhausted }) {
  const state = batchLoopState({ done, exhausted });
  // THE RE-ASK'S OWN, not a composite with the first reply's (I-9; G-2 of 20261024-064941-rrr-delivery): the re-ask is its
  // own node, and the first reply's cost stays on the first reply's status.
  return { state, batches: launchedBatches(done), batches_planned: planned, total_cost_usd_known: knownCost(done) };
}

/**
 * THE KNOWN PART OF A BATCH LOOP'S COST: each entry's usable cost, an unknown one adding nothing. The one owner, for the
 * re-ask and the barrier's batched status alike (G-7 of 20261024-072605-rrr-remediation-review: the reduce was spelled
 * in run-graph twice beside this one). Pure.
 */
export const knownCost = (done) => done.reduce((a, d) => a + (usableCost(d.status.total_cost_usd) ?? 0), 0);

/**
 * THE SUMMED DURATION OF A BATCH LOOP: each entry's measured duration, one with none (a refused spawn) adding nothing.
 * The one owner, for the re-ask and the barrier's batched status alike (G-5 of 20261024-080423-rrr-remediation-2-review:
 * the re-ask's was null as soon as one batch had none, so the batches that ran lost theirs). Pure.
 */
export const knownDuration = (done) => done.reduce((a, d) => {
  const ms = d.status.duration_ms;
  return a + (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : 0);
}, 0);

/**
 * WHY A RE-ASK ATTEMPT WAS NOT LAUNCHED, as the gate says it: its `why` when time or budget stopped it, else its
 * validator errors, where a refused spawn records its cause (G-7 of 20261024-080423-rrr-remediation-2-review: the gate
 * read only `why`, null for a refused spawn, and said "not re-asked" with no reason). Null when it has neither. Pure.
 */
export const reaskWhy = (attempt) => attempt.why
  || ((attempt.validator_errors ?? []).length ? attempt.validator_errors.join('; ') : null);

/**
 * THE ATTEMPT RECORD OF A RE-ASK THAT LAUNCHED NO BATCH, with the fields every attempt carries (G-8 of
 * 20261024-064941-rrr-delivery). `node` is the re-ask node's aggregated status when a spawn was refused, null when nothing
 * reached a spawn. Its state is that status's, so the attempt and the status it points at cannot disagree (G-8 of
 * 20261024-072605-rrr-remediation-review); `NOT-LAUNCHED` only when there is no status. Pure.
 */
export function notLaunchedAttempt({ missing, planned, why, node }) {
  return { node: 'reconcile-reask', groups: missing, batches: 0, batches_planned: planned, state: node?.state ?? 'NOT-LAUNCHED', why,
    judged: [], missing, total_cost_usd: node?.total_cost_usd ?? null, total_cost_usd_known: node?.total_cost_usd_known ?? 0,
    duration_ms: node?.duration_ms ?? null, report_sha256: node?.report_sha256 ?? null,
    ...(node?.validator_errors?.length ? { validator_errors: node.validator_errors } : {}) };
}

/**
 * THE REPORT FIELDS OF THE LAST BATCH WHOSE REPLY WAS USED, not of the last spawned (G-7 of 20261024-064941-rrr-delivery):
 * a failed batch ends the loop, and its reply is never merged. reconcileBatchLoop's entries; null fields when none was
 * used. Pure, and the one owner, so a test drives the choice (G-11 of 20261024-072605-rrr-remediation-review).
 */
export const lastUsedReport = (done) => [...done].reverse().find((d) => d.status.state === 'OK' && d.payload)?.report
  ?? { report_path: null, report_sha256: null };

/**
 * HOW MANY OF reconcileBatchLoop's ENTRIES LAUNCHED: the loop also records a refused spawn, as `launched: false` (G-14 of
 * 20261024-032927-rrs-remediation-review). The one owner of that count, so the re-ask and the barrier merge cannot
 * disagree about it (G-8 of 20261024-041845-rrs-remediation-2-review). Pure.
 */
export const launchedBatches = (done) => done.filter((d) => d.status.launched !== false).length;

/**
 * WHEN A RESUMED RE-ASK'S BARRIER CLOCK STARTED (G-11 of 20261024-032927-rrs-remediation-review): the resume's `now` less
 * the first reply's recorded duration, so the re-ask gets the barrier's time left after that reply, as its budget is
 * already the barrier's less that reply's charge. An unknown duration takes nothing: no time is known to be used. Pure.
 */
export function reaskResumeStart({ now, firstStatus }) {
  const used = firstStatus?.duration_ms;
  return Number.isFinite(used) && used > 0 ? now - used : now;
}

/**
 * THE STATE OF A RUN OF reconcileBatchLoop, one rule for the barrier and the re-ask (G-3 of
 * 20261024-032927-rrs-remediation-review: the re-ask read an OK batch with no payload as OK while the barrier recorded it
 * DEGRADED). The first batch that failed or wrote no payload ends the loop and gives the state, DEGRADED when it reported
 * OK; otherwise time or budget running out is BLOCKED; otherwise OK.
 */
export function batchLoopState({ done, exhausted }) {
  const failed = done.find((d) => d.status.state !== 'OK' || !d.payload);
  if (failed) return failed.status.state === 'OK' ? 'DEGRADED' : failed.status.state;
  return exhausted ? 'BLOCKED' : 'OK';
}

/**
 * THE RE-ASK ATTEMPTS A RECONCILE STATUS RECORDS (reconcile-reask-shape.plan.md stage 2; design RA-D2 A, operator,
 * 2026-10-24: "2 A then"): a list, one attempt per run under A, so a later change to once per invocation (B) adds a
 * guard, not a new shape for every reader. A status written before the list (one object) reads as one attempt; none
 * reads as []. Pure.
 */
export const reaskAttempts = (status) => {
  const r = status?.reask;
  if (Array.isArray(r)) return r;
  return r && typeof r === 'object' ? [r] : [];
};

/**
 * EVERY ARTIFACT A RECONCILE OR ITS CALIBRATION WRITES THAT A LATER STEP READS OR REUSES (design §5; G-8 of
 * 20261007-050929-consumer-use-r4). A fresh reconcile clears them all, so a resumed run never reuses a mix of attempts.
 * Run-relative; a trailing `/` is a directory, `*` one path segment. Reconcile's own captured evidence other than its
 * payload is deliberately absent; a test keeps the list complete against what run-graph writes.
 */
export const RECONCILE_ARTIFACTS = Object.freeze([
  'reconciled.md',
  // The re-ask's groups file and its kept reply and status (reconcile-missing-groups.plan.md stage 1).
  RECONCILE_REASK_GROUPS,
  'evidence/reconcile-reask/',
  // The re-ask's own node (reconcile-reask-record.plan.md stage 1): its brief and its aggregated status.
  'nodes/reconcile-reask-brief.md',
  'nodes/reconcile-reask.status.json',
  'nodes/reconcile-brief.md',
  'evidence/reconcile/payload.json',
  'reconcile-divergence.json',
  'evidence/reconcile-batches/',
  RECONCILE_BATCH_GROUPS,
  'nodes/reconcile-b-brief.md',
  'nodes/reconcile-b.status.json',
  'evidence/reconcile-b/',
]);

/**
 * WHEN A RESUME MAY REUSE THE RECONCILE ON DISK, owned here (the fourth place the rules lived): only when this resume
 * re-ran nothing, the reconcile reported OK, and its render and payload are both present. Anything else re-reconciles,
 * the expensive-but-correct direction.
 */
export function reconcileReusable({ resume, nothingReRun, statusState, artifactsPresent }) {
  return Boolean(resume) && nothingReRun === true && statusState === 'OK' && artifactsPresent === true;
}

/**
 * Merge the batches' validated payloads into one reconcile payload. `groups` is the concatenation;
 * `intent_intact` holds only if every batch said so; the summary keeps each batch's, under a heading naming
 * the groups it judged, so no batch's account is lost or presented as covering the others.
 */
export function mergeReconcilePayloads(payloads, { runId, batches }) {
  if (payloads.length !== batches.length) {
    throw new Error(`mergeReconcilePayloads: ${payloads.length} payload(s) for ${batches.length} batch(es)`);
  }
  const span = (b) => (b.length ? `${b[0].group_id}–${b[b.length - 1].group_id}` : '(none)');
  return {
    schema_version: 1,
    run_id: runId,
    intent_intact: payloads.every((p) => p?.intent_intact === true),
    groups: payloads.flatMap((p) => p?.groups ?? []),
    summary: payloads.map((p, i) =>
      `### Batch ${i + 1} of ${payloads.length} (${batches[i].length} groups, ${span(batches[i])})\n\n${p?.summary ?? ''}`,
    ).join('\n\n'),
  };
}

/**
 * THE REPLY AND ITS RE-ASK, MERGED (reconcile-missing-groups.plan.md stage 1). The groups a reconcile reply left out are
 * asked again once, alone; their validated rows join the first reply's, and the summary keeps both accounts, the
 * re-ask's under a heading naming the groups it was given, so neither is presented as covering the other.
 */
export function mergeReask(first, reask, { asked }) {
  const ids = asked.map((g) => g.group_id);
  return {
    ...first,
    intent_intact: first?.intent_intact === true && (reask ? reask.intent_intact === true : true),
    groups: [...(first?.groups ?? []), ...(reask?.groups ?? [])],
    summary: `${first?.summary ?? ''}\n\n### Re-ask (${ids.length} group(s) the reply left out: ${ids.join(', ')})\n\n`
      + `${reask?.summary ?? '(no reply)'}`,
  };
}
