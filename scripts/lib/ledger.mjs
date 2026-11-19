// ledger.mjs — pure decisions for the cross-run findings ledger.
//
// Runs are independent directories, so the same defect reported in run after run arrives each
// time as new information, and nothing shows what remediation actually closed. The ledger is the
// cross-run memory: mechanical deduplication of findings by location, with first-seen, last-seen
// and status. Bookkeeping, so it is script per the standing rule — and pure here so the dedup
// rules are tested without a run directory.

// ONE OWNER FOR THE LADDER (G-21). This was a private copy of the same four rungs decisions.mjs
// already exports — same values, same order, same directory, no import — and it is not decorative:
// `indexOf` drives openEntries' worst-first ordering and convergence's floor, so a rung this copy did
// not recognise returned -1, sorting below LOW and never counting above the floor. Adding a rung
// would have dropped findings out of the self-review loop's stop-rule while every other module went
// on counting them. Same shape as globDirPrefix and the atomic writer, both already consolidated.
import { SEVERITY_RUNGS as SEVERITY_ORDER } from './decisions.mjs';
import { redactClaim } from './redact.mjs';
import { ARCHIVED_REVIEWS } from './reviews-root.mjs';
import { scopeMatcher } from './reviewed-run.mjs';

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * WHERE THE CROSS-RUN LEDGER LIVES, and why it is not where the runs live.
 *
 * Run directories moved OUT of the repository under review: writing inside it forced four separate
 * places to remember to exclude the run directory, and two defects came from that class rather than
 * from any one exclusion. The ledger did not move with them, and the difference is what each IS.
 *
 * A run directory is one review's working artifacts - large, numerous, mostly gitignored evidence,
 * and meaningful only beside the tree it reviewed. The ledger is this project's MEMORY: one small
 * file recording what recurred across every fold, which entries were claimed fixed and never
 * confirmed, and which came back. It is tracked on purpose, so a clone carries it and a reader can
 * see what kept happening. Out of the tree it would exist only on the machine that produced it.
 *
 * Resolved from repoRoot rather than from `review.reviews_dir` - that coupling is exactly what this
 * replaces. Both paths that located the ledger derived it from the reviews directory, so pointing
 * runs out of the tree would have silently taken the memory along with them.
 */
export function ledgerPathFor(repoRoot) {
  return `${norm(repoRoot)}/${ARCHIVED_REVIEWS}/ledger.json`;
}

/** The repository whose ledger `ledgerPath` is — the inverse of `ledgerPathFor` — or null when it is not one (G-1). */
export function repoOfLedger(ledgerPath) {
  const p = norm(ledgerPath);
  const tail = `/${ARCHIVED_REVIEWS}/ledger.json`;
  if (!p.endsWith(tail)) return null;
  // A REPOSITORY AT A FILESYSTEM ROOT (G-6 of 20261013-042240-ledger-identity-remediation-4-review): the prefix left is
  // empty on POSIX, which read as no repository, and a bare `C:` on Windows, which is drive-RELATIVE. Both are the root.
  const repo = p.slice(0, -tail.length);
  if (repo === '') return '/';
  return /^[A-Za-z]:$/.test(repo) ? `${repo}/` : repo;
}

/**
 * Identity of a finding ACROSS runs. Claims are model prose and get reworded every run, so the
 * key is location, not text: file plus a line bucket. The bucket absorbs small drift as code
 * moves; two genuinely distinct defects landing in the same 10-line bucket of the same file WILL
 * collide and be counted once — named here as the known cost of a mechanical key, and preferable
 * to a text-similarity heuristic whose failures are invisible.
 *
 * DECLINED, deliberately, that the key is unstable under large edits (G-28). It is: an insertion of
 * more than one bucket-width above a finding moves it out of its own entry's reach, and the entry
 * splits into a "new" one plus a "silent" one. Three things make that the better trade:
 *   - the drift probe in mergeRun matches an adjacent bucket, and the entry re-anchors on every
 *     sighting, so ordinary edit-sized movement is already absorbed;
 *   - the failure is LOUD, not silent — a split shows up as one new entry and one silent entry in
 *     the same fold report, which is the pair an operator can recognise;
 *   - the alternatives are worse in kind. A text key reworded every run is no key at all, and a
 *     similarity threshold fails by silently merging two distinct defects, which is the one failure
 *     mode this ledger must not have.
 * Revisit only with a STABLE anchor the lenses actually emit (the enclosing symbol, say) — the
 * bench went this way for its seeds and it worked there because the corpus is authored. Findings are
 * not.
 *
 * Raised three times now, by two lenses across three runs (G-28, then G-20 and G-26 from
 * panel-codex-arch). Each describes the same trade correctly — the third adds the collision half
 * explicitly: two distinct findings inside one bucket share an entry, so one's disposition
 * overwrites the other's history — and none of them offers the stable anchor that would change the
 * answer. The collision is bounded by the same properties: a bucket is ten lines, two genuinely
 * distinct defects that close together are usually the same defect described twice, and the fold
 * report shows the entry's claim so a reader can see which finding it is tracking. Recorded here
 * rather than argued again next run; the condition that would flip it is a stable anchor the lenses
 * EMIT, not one this module could derive.
 *
 * AND THEN THE COLLISION HID A HIGH (2026-10-12, .claude/findings/2026-10-12-ledger-absorbs-a-high-into-a-declined-entry.md).
 * A confirmed HIGH at snapshot.mjs:102, whose raising node had said MEDIUM, resolved to an unrelated operator-declined
 * MEDIUM entry in the same bucket and stayed hidden: the fold read node findings at the node's severity, and a decline
 * came back only on a rise. "Two distinct defects that close together are usually the same defect" was measured then,
 * and was false for every same-or-lower hit after a dated decline (9 of 9, ledger-identity stage 1). The bucket STAYS —
 * the stable anchor is still the real fix and still not emitted — but what lands in it changed (ledger-identity.plan.md):
 * a sighting is a reconciled group at the severity the gate confirmed; a bucket two groups of one run share is flagged
 * (`stay_shared[]`) and a fix claim must cover every group; any hit on an operator decline brings it back (T4); and the
 * entry shows the newest claim with the earlier ones kept (`claims[]`).
 */
export function findingKey(f, bucket = 10) {
  const line = Number.isInteger(f?.line) ? f.line : 0;
  return `${norm(f?.file)}:${Math.floor(line / bucket) * bucket}`;
}

/** An operator decline a review brought back: above its declined severity (`severity_rose`) or at or below it
 * (`raised_again`, ledger-identity stage 1b). Open until the operator re-confirms (T15) or reopens (T17) it. */
export function declineReturned(e) {
  return e?.status === 'declined' && e.decided_by === 'operator' && (e.severity_rose === true || e.raised_again === true);
}

/**
 * WORK THE OPERATOR OWNS — the one definition of "open" (shared/ledger-transitions.md; the plan it came
 * from, .claude/requests/ledger-transitions.plan.md, passed plan-review on round 7).
 *
 * An entry is open until one of three exits, each naming who made it: a full fix claim confirmed by a
 * later silent review (`closed_by: claim+silence`); a decline the OPERATOR made or confirmed; a close by
 * the operator. So `fixed_claimed` and `partial` are open (a claim is not a fix, G-30), and so is a
 * decline an agent proposed — it leaves only when the operator confirms it (G-17) — and an operator
 * decline a review raised again (`declineReturned`: worse, or since 2026-10-12 at any severity), until the
 * operator re-confirms or reopens it.
 *
 * This replaced `OPEN_STATUSES`: openness depends on who decided, not on the status alone, so a list of
 * statuses no longer describes the open set. Every reader of "open work" calls this.
 */
export function isOpen(e) {
  // CLOSED IS THE LIST, OPEN IS THE DEFAULT (G-9 of 20260928-024309-ltr-review-r2): this ended in
  // `return false`, so a status it did not know counted as closed — the unsafe direction for a rule whose
  // point is that nothing leaves the open set undecided. The three exits are named; anything else is open.
  if (e?.status === 'fixed' || e?.status === 'closed') return false;
  if (e?.status === 'declined') return e.decided_by !== 'operator' || declineReturned(e);
  return true;
}

// The fields a claim, a close and a decision carry, named ONCE, so every transition that voids a claim
// or clears a decision clears the same fields (round 5 of the plan's review: half-cleared entries).
// `decisions[]` is none of these: the operator's decisions are history, and nothing clears it.
const CLAIM_FIELDS = ['claimed_in', 'claim_evidence', 'silent_at_claim', 'needs_operator', 'claimed_from'];
const CLOSE_FIELDS = ['closed_by', 'closed_in', 'verified_in', 'fixed_in', 'legacy', 'pre_transitions'];
const DECISION_FIELDS = ['decided_by', 'operator_quote', 'declined_severity', 'severity_rose', 'raised_again', 'decided_at', 'decided_in', 'kept_at', 'prior_status'];
const without = (e, ...sets) => {
  const out = { ...e };
  for (const set of sets) for (const f of set) delete out[f];
  return out;
};
const isAgentDecline = (e) => e?.status === 'declined' && e.decided_by !== 'operator';

const worse = (a, b) =>
  SEVERITY_ORDER.indexOf(String(b)) > SEVERITY_ORDER.indexOf(String(a)) ? b : a;

/**
 * Fold one run's kept findings into the ledger. Returns a NEW ledger plus the delta the operator
 * actually wants to read: what is new, what is recurring, and what previously-open entry this run
 * did not mention (silent this run — which is NOT evidence it is fixed; only remediation may mark
 * that, so the entry stays open and the silence is merely reported).
 */
/**
 * Did this run actually LOOK at that file?
 *
 * The run's reviewed paths under the one scope rule, reviewed-run.mjs's inScope — a run reviewing
 * `scripts` covers `scripts/lib/ledger.mjs`, a run reviewing three changed files covers exactly those
 * three, `.` covers the repository and a contract glob the files it matches (G-9 of
 * 20261031-022756-urr-remediation-review). An unmatched file is simply "not verified this run", which
 * leaves the claim standing rather than closing it.
 */
export function coveredByRun(file, surface) {
  return coverageOf(surface)(file);
}

// THE SURFACE, NORMALISED ONCE (G-12 of 20260928-162609-ltr-review-r4): the fold asked coveredByRun about every
// open entry, and each call renormalised the whole surface — E × S work for one answer per entry. Same rule.
// `.` and `..` RESOLVED before the prefix test (G-6 of 20260928-171758-ltr-review-r5): `scripts/../x.mjs`
// passed as inside `scripts`, so an entry the run never looked at could be recorded silent, which feeds exit 1.
// A path that climbs above the root keeps its leading `..`, which no surface prefix matches.
function segments(p) {
  const out = [];
  for (const s of norm(p).split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else out.push(s);
  }
  return out.join('/');
}

// THE SCOPE RULE IS reviewed-run.mjs's inScope, built once by its scopeMatcher (G-9, G-10 of
// 20261031-022756-urr-remediation-review): a literal prefix here made `.` an empty prefix and a glob literal text, so a full or glob sweep covered nothing in the ledger while
// usage-report credited it. Resolved here first; a path still climbing above the root is covered by nothing, and a
// blank scope covers nothing (only `.` is the whole repository).
function coverageOf(surface) {
  const matches = scopeMatcher((surface ?? []).filter((p) => String(p ?? '').trim()).map((p) => segments(p) || '.'));
  return (file) => {
    const f = segments(file);
    if (!f || f === '..' || f.startsWith('../')) return false;
    return matches(f);
  };
}

/**
 * Did the lens that RAISED this entry report cleanly in the confirming run?
 *
 * G-14: `reviewed` was one boolean for the whole run — true as soon as any non-intent node returned
 * OK. So an `--only doc-consistency-review` run over `scripts/**` confirmed a security-audit claim
 * about a credential leak by silence, from a lens that does not look for credential leaks and was
 * never asked to. That is silence counted as a verdict, in the one module written to stop exactly
 * that, and it is reachable by the ordinary narrow re-run an operator does after a fix.
 *
 * The entry already records WHICH nodes raised it, so the confirmation can be specific: at least
 * one of them must have reported OK here. An entry naming no node cannot be confirmed by any run —
 * conservative on purpose, since the alternative is confirming it by anyone's silence.
 *
 * A cross-family arm counts for its own claim. Two lenses that both raised an entry are an OR, not
 * an AND: either one looking again and staying silent is the independent confirmation I-55 asks
 * for, and requiring both would make a claim unconfirmable whenever the panel is off.
 */
function lensLooked(entry, okNodes) {
  const raisers = Array.isArray(entry?.nodes) ? entry.nodes : [];
  if (!raisers.length || !okNodes) return false;
  return raisers.some((n) => okNodes.has(n));
}

/**
 * @param {{run_id: string, at: string, findings: object[], surface?: string[]}} run
 *        `surface` is what the run actually reviewed (run.json's scope.paths); `reviewed` says the
 *        run was a review at all (its gate is not BLOCKED and some lens reported); and `okNodes` is
 *        the SET of node ids that reported OK, which is what decides whether the lens that raised a
 *        given claim was among them. All three are needed to CONFIRM a claimed fix: scope says the
 *        file was in front of a lens, `reviewed` says a lens was there, `okNodes` says it was the
 *        right one. Omitting any is safe and simply confirms nothing.
 */
/**
 * Which entry a finding belongs to — shared by the fold and by an observation, so both place a finding
 * the same way (it was a closure inside mergeRun; ledger-transitions extracted it for addObservation).
 *
 * An existing entry within one bucket-width of the finding, in the same file, is the same defect: a
 * finding at line 39 keys to :30, and one inserted line above moves it to :40 — an exact-key lookup
 * then split one unchanged defect into a "new" entry plus a "silent" one, which is worse than a
 * miscount (G-16). The probe stays mechanical: same file, adjacent bucket, line distance within the
 * bucket. One index, built once: the fallback used to scan every entry per finding (G-7). G-29 measured
 * the per-file scan as fast enough and declined to change it; G-10 of 20260928-162609-ltr-review-r4 was
 * fixed anyway, by the operator's decision, with the index keyed by file and line-bucket.
 */
function keyResolver(entries, bucket = 10) {
  // INDEXED BY FILE AND LINE-BUCKET (G-10 of 20260928-162609-ltr-review-r4): a miss scanned the file's whole
  // list, so F findings in one file cost F² probes. An entry within one bucket-width of a line sits in that
  // line's bucket or a neighbour, so three buckets are checked. The first-added match still wins, as before.
  const index = new Map();
  let order = 0;
  const slot = (file, line) => `${file}#${Math.floor((line ?? 0) / bucket)}`;
  const add = (e) => {
    const k = slot(e.file, e.line);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push({ e, n: order++ });
  };
  for (const e of Object.values(entries)) add(e);
  const resolve = (f, seen = new Set()) => {
    const exact = findingKey(f, bucket);
    if (entries[exact] || seen.has(exact)) return exact;
    const line = Number.isInteger(f.line) ? f.line : 0;
    const file = norm(f.file);
    const b = Math.floor(line / bucket);
    let best = null;
    for (const k of [b - 1, b, b + 1]) {
      for (const c of index.get(`${file}#${k}`) ?? []) {
        if (Math.abs((c.e.line ?? 0) - line) <= bucket && (!best || c.n < best.n)) best = c;
      }
    }
    return best ? best.e.key : exact;
  };
  return { resolve, add };
}

/**
 * A RUN'S SIGHTINGS, FROM WHAT THE GATE CONFIRMED (ledger-identity plan, stage 2). The fold read each OK node's kept
 * findings, at the severity the NODE gave: a reconciler-raised HIGH whose raising node said MEDIUM landed as MEDIUM, in
 * an unrelated operator-declined MEDIUM entry of the same bucket, and stayed hidden (2026-10-12). A sighting is now a
 * reconciled group: only `confirmed` and `symptom` groups, at the payload's severity — the decision the gate used, since
 * nothing after adjudication rewrites the payload and the gate's floor reads only it.
 *
 * `groups` is finding-groups.json, `payload` the merged evidence/reconcile/payload.json (null when absent). A group
 * the payload did not judge is a sighting with `decision: "unjudged"`, at the highest severity among its findings and
 * with that finding's claim (reconcile-missing-groups.plan.md stage 2; operator, 2026-10-23: "C"): unjudged groups must
 * not read as silence, and refusing the whole fold over one left every judged group off the ledger. Their ids are
 * returned as `unjudged`. A symptom carries its `root_cause_group`; the fold makes the two one sighting when both land
 * on one entry.
 */
const DECIDED = new Set(['confirmed', 'symptom', 'dropped', 'coincidence']);
const groupNumber = (id) => Number(/^G-(\d+)$/.exec(String(id))?.[1] ?? Number.MAX_SAFE_INTEGER);
export function sightingsFromReconcile(run_id, { groups, payload }) {
  const formed = Array.isArray(groups?.groups) ? groups.groups : null;
  if (!formed) return { ok: false, why: 'finding-groups.json holds no list of groups' };
  if (!formed.length) return { ok: true, sightings: [] };
  if (!Array.isArray(payload?.groups)) return { ok: false, why: `${formed.length} group(s) were formed and no reconcile payload judged them` };
  const judged = new Map(payload.groups.map((p) => [p?.group_id, p]));
  const unjudged = formed.filter((g) => !judged.has(g?.group_id)).map((g) => g?.group_id);
  const sightings = [];
  for (const g of [...formed].sort((a, b) => groupNumber(a.group_id) - groupNumber(b.group_id))) {
    if (!judged.has(g.group_id)) {
      // Nobody judged it: the severity its findings claimed, the highest of them, is all there is. A member severity the
      // gate does not use is refused, as a payload's is, rather than guessed.
      const members = Array.isArray(g.findings) ? g.findings : [];
      if (!members.length || members.some((m) => !SEVERITY_ORDER.includes(m?.severity))) {
        return { ok: false, why: `${g.group_id} was not judged, and its findings carry no severity the gate uses` };
      }
      let top = members[0];
      for (const m of members) if (SEVERITY_ORDER.indexOf(m.severity) > SEVERITY_ORDER.indexOf(top.severity)) top = m;
      sightings.push({
        run_id, group_id: g.group_id, file: norm(g.file), line: Number.isInteger(g.line) ? g.line : 0,
        severity: top.severity, decision: 'unjudged',
        claim: redactClaim(top.claim ?? '').slice(0, 300),
        nodes: [...new Set(members.map((m) => m?.node_id).filter(Boolean))],
      });
      continue;
    }
    const p = judged.get(g.group_id);
    if (!DECIDED.has(p.decision)) return { ok: false, why: `${g.group_id} has a decision the gate does not use (${JSON.stringify(p.decision)})` };
    if (!SEVERITY_ORDER.includes(p.severity)) return { ok: false, why: `${g.group_id} has a severity the gate does not use (${JSON.stringify(p.severity)})` };
    if (p.decision !== 'confirmed' && p.decision !== 'symptom') continue;
    const members = Array.isArray(g.findings) ? g.findings : [];
    // The claim of the highest-severity member, ties to the first: a member's words, never the reconciler's rationale.
    let top = null;
    for (const m of members) if (!top || SEVERITY_ORDER.indexOf(String(m?.severity)) > SEVERITY_ORDER.indexOf(String(top.severity))) top = m;
    sightings.push({
      run_id, group_id: g.group_id, file: norm(g.file), line: Number.isInteger(g.line) ? g.line : 0,
      severity: p.severity, decision: p.decision,
      claim: redactClaim(top?.claim ?? '').slice(0, 300),
      nodes: [...new Set(members.map((m) => m?.node_id).filter(Boolean))],
      ...(p.decision === 'symptom' && p.root_cause_group ? { root_cause_group: p.root_cause_group } : {}),
    });
  }
  return { ok: true, sightings, unjudged };
}

/**
 * THE ONE-TIME MIGRATION to ledger identity (plan stage 6), forward-only: no entry is rebuilt and no disposition is
 * touched. It records `identity_migrated_at` — the anchor stage 3 uses for a legacy decline with no `decided_at` — and
 * refuses a second time, naming the recorded time, because a later anchor would hide the hits between the two. It seeds
 * each entry's `claims[]` with its current claim, and its `sightings[]` empty.
 *
 * And it RECHECKS, listing and never applying. The ledger keeps no per-entry run list, so attribution is reconstructed:
 * a run counts for an entry when its time is after the entry's `decided_at` (an operator decline) or `stay_started`;
 * an entry with neither is skipped and counted. Each run's sightings (`runs[].sightings`, read by the caller; only judged
 * groups of a partially judged run, which is named) are resolved against the CURRENT keys, as the new fold resolves
 * them. A sighting above the entry's severity is listed as a `rise`; one at or below it on an operator decline as
 * `raised_again`. Listed only: a key or line that moved since that run can attribute a run's HIGH to an unrelated
 * entry, and applied, that would break an operator decline on no grounds. The operator reopens what they confirm.
 */
export function migrateIdentity(ledger, { at, runs = [] }) {
  if (ledger?.identity_migrated_at) {
    return { ok: false, why: `this ledger was migrated at ${ledger.identity_migrated_at}; a second migration would move the anchor undated declines are read against` };
  }
  const entries = {};
  for (const [k, e] of Object.entries(ledger?.entries ?? {})) {
    // `sightings[]` starts empty (the plan's stage 6), so a migrated entry no later run sights still has the record.
    entries[k] = e.claims && e.sightings ? e : {
      ...e,
      claims: e.claims ?? [{ run_id: e.last_seen ?? null, group_id: null, claim: e.claim ?? '' }],
      sightings: e.sightings ?? [],
    };
  }
  const resolver = keyResolver(ledger?.entries ?? {});
  const rank = (s) => SEVERITY_ORDER.indexOf(String(s));
  const listed = [];
  const skipped = [];
  const anchors = {};
  for (const e of Object.values(ledger?.entries ?? {})) {
    const declined = e.status === 'declined' && e.decided_by === 'operator';
    const field = declined ? 'decided_at' : 'stay_started';
    const time = Date.parse(e[field] ?? '');
    if (Number.isFinite(time)) anchors[e.key] = { field, time, declined };
    else skipped.push({ key: e.key, why: declined ? 'no decided_at and no stay_started' : 'no stay_started' });
  }
  for (const r of runs) {
    const t = runIdTime(r.run_id);
    if (t === null) continue;
    for (const s of r.sightings ?? []) {
      const key = resolver.resolve(s);
      const a = anchors[key];
      const e = ledger.entries[key];
      if (!a || !e || t <= a.time) continue;
      const kind = rank(s.severity) > rank(e.severity) ? 'rise' : (a.declined ? 'raised_again' : null);
      if (kind) listed.push({ key, run_id: r.run_id, group_id: s.group_id, severity: s.severity, held: e.severity, claim: s.claim, kind, anchor: a.field });
    }
  }
  listed.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : x.run_id < y.run_id ? -1 : x.run_id > y.run_id ? 1 : groupNumber(x.group_id) - groupNumber(y.group_id)));
  return {
    ok: true,
    ledger: { ...ledger, entries, identity_migrated_at: at },
    report: { listed, skipped: skipped.sort((x, y) => (x.key < y.key ? -1 : 1)), partial: runs.filter((r) => r.partial).map((r) => r.run_id).sort() },
  };
}

/** What `--summary` adds under an entry's claim (stage 4): that it is shared, and that it has held other claims. */
export function entryNotes(e) {
  const notes = [];
  const shared = e?.stay_shared ?? [];
  if (shared.length) notes.push(`shared by ${shared.join(', ')} — a fix claim must name every group`);
  const others = new Set((e?.claims ?? []).map((c) => c?.claim).filter((c) => c && c !== e?.claim));
  if (others.size) notes.push(`earlier claims differ: ${others.size} other (claims[])`);
  return notes;
}

// THE RAISED-AGAIN REFUSAL, ONE SOURCE (ledger-findings.plan.md stage 3; design D6): the phrase I-11 of the ledger-identity
// plan requires, written once; each refusing branch of markFixed adds only what it asks the operator.
const RAISED_AGAIN_PHRASE = 'a decline that was raised again';
const raisedAgain = (tail) => `${RAISED_AGAIN_PHRASE} ${tail}`;

export function mergeRun(ledger, { run_id, at, findings, sightings = null, surface = [], reviewed = false, okNodes = null }) {
  const covered = coverageOf(surface);
  const okSet = okNodes instanceof Set ? okNodes : new Set(okNodes ?? []);
  const entries = { ...(ledger?.entries ?? {}) };
  const seen = new Set();
  const fresh = [];
  const recurring = [];

  const resolver = keyResolver(entries);
  const grouped = Array.isArray(sightings);
  const folded = new Set(ledger?.runs_folded ?? []);
  const runTime = runIdTime(run_id);

  // A RE-FOLD APPLIES NOTHING (plan stage 3, amended 2026-10-13; operator: "A run in runs_folded (Recommended)"). A grouped
  // fold of a run this ledger has already folded is a re-fold: no transition, no silence, no `last_fold_at`. The test was
  // membership in each entry's `sightings[]`, which keeps 10, so an evicted run ran T2/T4 again (G-9 of
  // 20261013-023310-ledger-identity-remediation-2-review), a retained older one re-anchored the entry's line and key back
  // to its own (G-10), and `last_fold_at` moved every time (G-11). `sightings[]` is history, not the re-fold test.
  // EVERY FOLD, grouped or legacy (ledger-findings.plan.md stage 1; operator, 2026-10-14: D2 "Code follows T7"): the guard
  // covered only a grouped fold, so a legacy `findings` re-fold counted a run twice and raised its severity (T7 says no).
  if (folded.has(run_id)) {
    return { ledger, delta: { new: [], recurring: [], silent_this_run: [], shared: [], refold: true } };
  }

  // THE RUN'S MENTIONS, ONE PER ENTRY (ledger-identity plan, stage 3). A sighting is a reconciled group (stage 2); the
  // legacy `findings` input is each node's finding. Each is resolved to its entry FIRST — a new bucket indexed at once,
  // so a second mention within reach finds it (G-14) — and every mention of one entry is COMBINED before any
  // transition runs: the highest severity, with the claim and LINE of the mention carrying it (ties to numeric group
  // order, then input order), every group id, the union of nodes. So T2-T4 see a run once per entry, and the order of
  // groups cannot change the key, the line or whether a decline breaks.
  // RESOLVED IN NUMERIC GROUP ORDER (G-11 of 20261013-000416-ledger-identity-review): resolution in arrival order let a
  // new bucket be founded by whichever group came first, so on an empty ledger the entries a run created depended on
  // the order of its groups (I-7). The sort is stable, so the legacy `findings` input keeps its order.
  const mentions = (grouped
    ? sightings.map((s) => ({ ...s, nodes: s.nodes ?? [], groups: s.group_id ? [s.group_id] : [] }))
    : (findings ?? []).map((f) => ({ file: f.file, line: f.line, severity: f.severity ?? 'LOW', claim: f.claim, nodes: [f.node].filter(Boolean), groups: [] })))
    .sort((a, b) => groupNumber(a.groups[0]) - groupNumber(b.groups[0]));
  const provisional = new Set();
  const byKey = new Map();
  for (const m of mentions) {
    const key = resolver.resolve(m, provisional);
    if (!entries[key] && !provisional.has(key)) {
      provisional.add(key);
      resolver.add({ key, file: norm(m.file), line: Number.isInteger(m.line) ? m.line : 0 });
    }
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(m);
  }
  const rank = (s) => SEVERITY_ORDER.indexOf(String(s));
  const sharedKeys = [];
  const combined = [...byKey].map(([key, ms]) => {
    const ordered = [...ms].sort((a, b) => groupNumber(a.groups[0]) - groupNumber(b.groups[0]));
    let top = ordered[0];
    for (const m of ordered) if (rank(m.severity) > rank(top.severity)) top = m;
    // A symptom folded into its root on the same entry is ONE defect: the root's id stands for both. WALKED TO THE ROOT,
    // with a visited set (ledger-findings.plan.md stage 2; design D3): deleting while iterating left a chain G-3 -> G-2 ->
    // G-1 marked shared. A symptom folds when its chain reaches a root on this entry; one whose chain leaves the entry, or
    // closes into a cycle, stays its own group (as `bench-scoring.mjs` walks chains).
    const onEntry = new Set(ordered.flatMap((m) => m.groups));
    const rootOf = new Map(ordered.flatMap((m) => m.groups.map((g) => [g, m.root_cause_group ?? null])));
    const foldsHere = (g) => {
      const seen = new Set([g]);
      let r = rootOf.get(g);
      while (r && onEntry.has(r)) {
        if (seen.has(r)) return false;
        seen.add(r);
        const next = rootOf.get(r);
        if (!next) return true;
        r = next;
      }
      return false;
    };
    const ids = new Set([...onEntry].filter((g) => !foldsHere(g)));
    const group_ids = [...ids].sort((a, b) => groupNumber(a) - groupNumber(b));
    if (group_ids.length >= 2) sharedKeys.push(key);
    return {
      // UNJUDGED only when every mention of this entry in the run was (reconcile-missing-groups stage 2): one judged
      // group on the entry is a judgment about it.
      unjudged: ordered.every((m) => m.decision === 'unjudged'),
      key, file: top.file, line: top.line, severity: top.severity ?? 'LOW', claim: top.claim,
      nodes: [...new Set(ordered.flatMap((m) => m.nodes))], group_ids,
      // Every group's words, the shown one LAST (stage 4): the others' claims are history, not lost.
      said: [...ordered.filter((m) => m !== top), top].map((m) => ({ run_id, group_id: m.groups[0] ?? null, claim: redactClaim(m.claim ?? '').slice(0, 300) })),
    };
  });
  // `stay_shared[]` holds the run-qualified ids of every sighting in the entry's current stay that carried two or more
  // groups. A fix claim must name them all (T9/T10), since silence cannot say which finding it confirms.
  const sharedIds = (c) => (c.group_ids.length >= 2 ? c.group_ids.map((g) => `${run_id}:${g}`) : []);
  const withShared = (base, ids) => {
    const all = [...new Set([...(base ?? []), ...ids])];
    return all.length ? { stay_shared: all } : {};
  };
  // WHAT AN ENTRY SHOWS (stage 4): the newest claim, with the earlier ones kept in a bounded `claims[]`, so an entry
  // that two defects have passed through says so instead of showing whichever came first. A decline raised again shows
  // the new words too: what brought it back is what the operator decides on.
  const sighted = (prior, c) => (grouped ? {
    // An entry no review has judged says so until one does; a judged sighting clears it.
    unjudged: c.unjudged ? true : undefined,
    sightings: [...(prior?.sightings ?? []), { run_id, group_ids: c.group_ids, severity: c.severity, ...(c.unjudged ? { unjudged: true } : {}) }].slice(-10),
    claim: c.said[c.said.length - 1].claim,
    claims: [...(prior?.claims ?? []), ...c.said].slice(-10),
  } : {});

  for (const f of combined) {
    const { key } = f;
    const prior = entries[key];
    seen.add(key);

    if (!prior) {
      entries[key] = {
        key,
        file: norm(f.file),
        line: f.line ?? 0,
        severity: f.severity ?? 'LOW',
        status: 'open',
        first_seen: run_id,
        last_seen: run_id,
        times_seen: 1,
        claim: redactClaim(f.claim).slice(0, 300),
        nodes: f.nodes,
        at,
        last_seen_at: at,
        // T1 — the entry's first stay in the open set begins (3b: decisions count only within the current stay).
        ...(at ? { stay_started: at } : {}),
        // An entry CREATED by a shared sighting is the commonest shared case: its list starts with that sighting's ids.
        ...withShared([], sharedIds(f)),
        ...sighted(null, f),
      };
      fresh.push(key);
    } else if (!grouped && prior.last_seen === run_id) {
      // Re-folding the same run is idempotent bookkeeping, not a second sighting: an
      // innocent-looking repeat of the same --run-dir inflated times_seen and promoted a single
      // sighting up the most-seen ordering as though two runs had confirmed it (G-18).
      // The legacy node-findings input only, and only for a ledger whose runs_folded does not record the run (one written
      // before that list): every re-fold of a run it records returned above, before anything was applied.
      const severity = worse(prior.severity, f.severity ?? 'LOW');
      const rose = prior.status === 'declined' && prior.decided_by === 'operator'
        && rank(severity) > rank(prior.declined_severity ?? prior.severity);
      entries[key] = {
        ...prior,
        line: Number.isInteger(f.line) ? f.line : prior.line,
        severity,
        nodes: [...new Set([...(prior.nodes ?? []), ...f.nodes])],
        ...withShared(prior.stay_shared, sharedIds(f)),
        ...(rose ? { severity_rose: true } : {}),
      };
    } else if (prior.status === 'declined' && prior.decided_by === 'operator') {
      // T4 — A DECLINED FINDING RAISED AGAIN COMES BACK TO THE OPERATOR. Above its declined severity it is a rise
      // (`severity_rose`), as before. At or below it, it is `raised_again` (operator, 2026-10-12: "Resurface every hit
      // (Recommended)"), reversing the 2026-09-27 rule that it stays declined: stage 1 of the ledger-identity plan found
      // every such hit after a dated decline to be a DIFFERENT defect the bucket had absorbed. Only from a run NEWER
      // than the decision — its `decided_at`, or for a legacy undated decline the ledger's `identity_migrated_at` — and
      // never from a run this ledger has already folded: older evidence is what the decision was made on.
      const severity = worse(prior.severity, f.severity ?? 'LOW');
      const baseline = prior.declined_severity ?? prior.severity;
      const rose = rank(severity) > rank(baseline);
      const anchor = Date.parse(prior.decided_at ?? ledger?.identity_migrated_at ?? '');
      const again = !rose && !folded.has(run_id) && runTime !== null && Number.isFinite(anchor) && runTime > anchor;
      entries[key] = {
        ...prior,
        line: Number.isInteger(f.line) ? f.line : prior.line,
        severity,
        last_seen: run_id,
        last_seen_at: at ?? prior.last_seen_at,
        times_seen: prior.times_seen + 1,
        nodes: [...new Set([...(prior.nodes ?? []), ...f.nodes])],
        ...(rose ? { severity_rose: true } : {}),
        ...(again ? { raised_again: true } : {}),
        ...withShared(prior.stay_shared, sharedIds(f)),
        ...sighted(prior, f),
      };
      recurring.push(key);
    } else {
      // T2 and T3 — RAISED AGAIN. The recurrence disproves any fix claim (G-8 of
      // 20260927-220507-ledger-review-r2): the claim rode along in `...prior`, and the next silent review
      // closed the entry on a claim this very sighting had refuted. So the claim goes, always. A close
      // goes too, and a decision with it when the entry had been closed or an agent had proposed to
      // decline it; `decisions[]` stays — it is the operator's history, and nothing clears it.
      const wasDecided = ['fixed', 'closed'].includes(prior.status) || isAgentDecline(prior);
      const base = wasDecided ? without(prior, CLAIM_FIELDS, CLOSE_FIELDS, DECISION_FIELDS) : without(prior, CLAIM_FIELDS, CLOSE_FIELDS);
      // T3 — A CLOSED ENTRY REOPENED BEGINS A NEW STAY (3b). It is a field of its own because the close fields
      // just cleared were the only trace of where the old stay ended; an open entry raised again (T2) never
      // left the open set, so its stay goes on. Its shared ids go with the old stay, cleared BEFORE this run's are added.
      const newStay = ['fixed', 'closed'].includes(prior.status);
      const { stay_shared: priorShared, ...rest } = base;
      entries[key] = {
        ...rest,
        // Anything that had moved toward an exit is REOPENED, loudly — a regression the ledger exists to
        // make visible rather than count as new: a confirmed or claimed fix, a partial one, an operator's
        // close (G-15 of 20260927-211023-ledger-review), an agent's proposed decline. `open` and
        // `reopened` stay as they are.
        status: ['open', 'reopened'].includes(prior.status) ? prior.status : 'reopened',
        // Raised again: the silences recorded before meant nothing, so they no longer count toward stale.
        silent_in: [],
        line: Number.isInteger(f.line) ? f.line : prior.line,
        severity: worse(prior.severity, f.severity ?? 'LOW'),
        last_seen: run_id,
        // WHEN, not only which run (G-18 of 20260927-211023-ledger-review): an `observed-…` id carries no
        // time runIdTime can read, so a hand-added entry aged from its FIRST sighting however recently
        // it was seen again.
        last_seen_at: at ?? prior.last_seen_at,
        times_seen: prior.times_seen + 1,
        claim: redactClaim(f.claim ?? prior.claim).slice(0, 300),
        nodes: [...new Set([...(prior.nodes ?? []), ...f.nodes])],
        ...(newStay && at ? { stay_started: at } : {}),
        ...withShared(newStay ? [] : priorShared, sharedIds(f)),
        ...sighted(prior, f),
      };
      recurring.push(key);
    }
  }

  // Key and line move TOGETHER (G-8): re-anchoring line while the key stayed frozen let the two
  // diverge without bound, so a stale key exact-matched unrelated new defects while the real one
  // drifted out of its own probe's reach. When a sighting moves an entry's line into a different
  // bucket, the entry migrates to the new key; markFixed and every report always see the key
  // that matches where the defect currently is.
  // The renames are collected and applied to the run's key lists once, after the loop (G-8 of
  // 20261013-042240-ledger-identity-remediation-4-review): an indexOf per moved entry over each list was O(F^2).
  const moved = new Map();
  for (const key of Object.keys(entries)) {
    const e = entries[key];
    const trueKey = findingKey({ file: e.file, line: e.line });
    if (trueKey !== key && !entries[trueKey]) {
      entries[trueKey] = { ...e, key: trueKey };
      delete entries[key];
      moved.set(key, trueKey);
      // The OLD key stays in `seen` too: silent_this_run compares the PRIOR ledger's keys
      // against what this run touched, and a migrated entry was touched under its old name —
      // dropping it reported the very defect that just recurred as silent.
      if (seen.has(key)) seen.add(trueKey);
    }
  }
  if (moved.size) {
    for (const arr of [fresh, recurring, sharedKeys]) {
      for (let i = 0; i < arr.length; i++) if (moved.has(arr[i])) arr[i] = moved.get(arr[i]);
    }
  }

  // CONFIRMATION, the only thing that turns a claim into a fact.
  //
  // markFixed records `fixed_claimed` because it cannot verify anything by itself. This is where the
  // verification arrives: a later run reviewed the file, was really a review, and the LENS THAT
  // RAISED THE ENTRY reported OK. Bare absence still closes nothing — a lens that did not look is
  // indistinguishable from a defect that is gone, which is why all three conditions below are
  // required (G-30).
  //
  // THE GATE USED TO BE A CLAIM, AND THE CLAIM IS NOT THE EVIDENCE. This loop read
  // `status !== 'fixed_claimed' && status !== 'partial'` and skipped everything else, so a plain
  // `open` entry could never close however many runs looked straight at it. The three conditions
  // after that line ARE the evidence test; whether a human had typed a remediation claim is a fact
  // about bookkeeping, not about the code. Measured on ledger.json against run
  // 20260914-193203-branch-verify: 302 open entries, 88 covered by that run's 11-path surface, and
  // 86 clearing the full bar — 28% of the backlog unclosable by construction, which is what made the
  // open set unusable for deciding what to work on next.
  //
  // The relaxation is narrower than it looks and it is self-correcting. The bar is unchanged and is
  // the same one `fixed_claimed` had to clear; a promotion that was wrong is caught the next time any
  // lens raises the defect, because a recurrence from `fixed` is a LOUD `reopened` rather than a new
  // entry. `closed_by` records which of the two evidence shapes applied, so a close is auditable.
  //
  // AND THEN SILENCE ALONE STOPPED CLOSING ANYTHING (operator, 2026-09-27: "go with the design, 2
  // reviews or 14 days"). Review 20260927-200901-ars-r5 closed three DEFERRED entries this way over
  // code that had not changed, and nothing told the operator. The bar below is unchanged, but it now
  // closes only a CLAIMED fix. An unclaimed entry that clears it gets the review recorded in
  // `silent_in` — evidence the operator reads when `staleEntries` shows it — and stays open. The 28%
  // above is answered by surfacing, not by closing: nothing leaves the open set without a decision.
  const promoted = new Set();
  for (const e of Object.values(entries)) {
    if (!isOpen(e)) continue;
    if (seen.has(e.key)) continue;                       // still there; the recurrence loop reopened it
    if (e.claimed_in === run_id) continue;               // the claiming run cannot confirm itself
    if (!covered(e.file)) continue;                      // nobody looked; the claim stands unproven
    // AND THE RUN MUST HAVE ACTUALLY REVIEWED. Scope plus silence is not evidence when the lenses
    // that would have raised the defect never reported: a BLOCKED run, or one whose lens crashed,
    // covers the file on paper and looked at nothing (G-22). I-55 asks for independent confirmation,
    // and "the run said nothing because it did not run" is the silence-as-a-verdict this project
    // refuses everywhere else. The caller supplies the fact; absent, nothing is confirmed.
    if (!reviewed) continue;
    // AND IT MUST HAVE BEEN THE RIGHT LENS (G-14). A run-wide "somebody reported OK" let a narrow
    // re-run close a claim raised by a lens it never spawned — the same defect as counting a
    // BLOCKED run, one level finer, and reachable by the most ordinary workflow there is: fix a
    // thing, re-run the one lens you care about.
    if (!lensLooked(e, okSet)) continue;
    if (e.status === 'fixed_claimed' && e.claimed_in) {
      // T6 — EXIT 1 needs a FULL claim made on an entry the reviews had NOT already gone quiet about: a
      // claim on an entry already silent adds no evidence, so the silence after it confirms nothing and
      // the entry goes to the operator (`needs_operator`, set by the claim) instead of out.
      // G-10 of 20260928-004954-ledger-transitions-review: a claim never migrated has no silent_at_claim;
      // T5 never appends to a claimed entry, so its silent_in is the silence from before the claim.
      if ((e.silent_at_claim ?? (e.silent_in ?? []).length) > 0) continue;
      // Nor a claim the operator has to settle (3b): it shares its entry with another group's standing decision,
      // and silence cannot say which of the two findings it confirms — the :190 wrong close.
      if (e.needs_operator) continue;
      entries[e.key] = {
        ...e,
        status: 'fixed',
        fixed_in: e.claimed_in,
        verified_in: run_id,
        closed_by: 'claim+silence',
        // WHICH RUN CLOSED IT (G-10 of 20260927-220507-ledger-review-r2).
        closed_in: run_id,
      };
      promoted.add(e.key);
      continue;
    }
    // T5 — everything else open records the silence, once per run (a re-fold must not count it twice),
    // and stays open: an unclaimed entry, a `partial` one ("never" closes on silence), an agent's
    // proposed decline, a decline a review raised again (T4: at any severity).
    if (e.status === 'fixed_claimed') continue;
    entries[e.key] = { ...e, silent_in: [...new Set([...(e.silent_in ?? []), run_id])] };
  }

  const silent = Object.values(ledger?.entries ?? {})
    // A `fixed_claimed` entry that goes unmentioned is not "silent" — that silence is the
    // evidence promoteVerified is waiting for, and reporting it as an unanswered open entry would
    // tell the operator to act on the one thing that is going right.
    // Nor is an entry this fold just PROMOTED on that same silence: it would otherwise be reported
    // as unanswered open work in the very delta that closed it.
    .filter((e) => isOpen(e) && e.status !== 'fixed_claimed' && !seen.has(e.key) && !promoted.has(e.key))
    .map((e) => e.key);

  // THE RUNS THIS STORE HAS FOLDED, recorded independently of whether any of them produced a
  // finding (G-19, panel-codex-contract). `convergence` inferred the newest run from entry
  // timestamps, so a cycle that found NOTHING — the outcome the whole signal exists to detect —
  // left nothing to infer from, and the newest run fell back to an earlier one whose HIGH findings
  // were then counted as introduced by the latest cycle. The reading was worst exactly where it
  // mattered. A fold is a fact about the LEDGER; it does not become one by producing findings.
  //
  // Sorted and de-duplicated: run ids are timestamp-prefixed, so the last is the newest, and a
  // re-fold of the same run must not grow the list — the same idempotence mergeRun already has.
  const runsFolded = [...new Set([...(ledger?.runs_folded ?? []), run_id].filter(Boolean))].sort();
  return {
    // `last_fold_at`: when a REVIEW was last folded — the window the fold's list of operator decisions
    // reads. Only this function writes it; an observation or a disposition never moves it.
    ledger: { ...ledger, schema_version: 1, entries, runs_folded: runsFolded, last_fold_at: at ?? ledger?.last_fold_at },
    delta: {
      new: fresh.sort(), recurring: recurring.sort(), silent_this_run: silent.sort(),
      // An entry two or more of this run's groups landed on: one sighting of it, and a claim must name every group.
      ...(grouped ? { shared: combined.filter((c) => c.group_ids.length >= 2).map((c, n) => ({ key: sharedKeys[n], groups: c.group_ids })).sort((a, b) => (a.key < b.key ? -1 : 1)) } : {}),
    },
  };
}

/**
 * Only remediation closes an entry, explicitly and by key — absence from a run never does,
 * because a lens that did not look is indistinguishable from a defect that is gone.
 */
/**
 * Record a disposition. `fixed` is a CLAIM until a later run stops finding it.
 *
 * This wrote `status: 'fixed'` from a supplied key alone — no evidence, no confirmation — so a fix
 * that was never made, or was made and did not land, closed its entry and vanished from the
 * ledger's open set. The ledger is cross-run memory precisely so a recurring defect cannot be
 * forgotten, and an unverified close is the one write that defeats that (G-30).
 *
 * It cannot verify by itself: proving a fix landed means re-running the check that found it, which
 * belongs to remediate and its captures, not to a pure module. So it records what it actually
 * knows — a claim, by whom, with the evidence path offered for it — and `status: 'fixed'` is
 * reached only when a later run has been through the tree and did not raise it again.
 *
 * `declined` and `open` are first-class, because the doctrine has them and the skill's
 * fixed/partial/not-fixed vocabulary could not express either: a deliberate decision not to fix is
 * not a failed attempt, and conflating them loses the reason (G-58).
 */
// `closed` is the operator's explicit close of a stale entry (2026-09-27): not a fix claim and not a
// decision against acting — "this is gone, or no longer worth tracking", said by a person, with a reason.
// `withdraw` and `reopen` came with ledger-transitions: an agent's proposed decline withdrawn (or rejected
// by the operator), and the operator reopening a decided entry.
export const DISPOSITIONS = ['fixed_claimed', 'partial', 'declined', 'open', 'closed', 'withdraw', 'reopen'];

export function markFixed(ledger, keys, run_id, { disposition = 'fixed_claimed', evidence_path = null, reason: rawReason = null, at = null, operator_quote = null, groups = [] } = {}) {
  // THE SAME REDACTION AS A CLAIM (G-13 of 20260928-162609-ltr-review-r4): a reason and the operator's words go
  // into the tracked ledger and its append-only decisions[], and neither passed through redactClaim.
  const reason = rawReason == null ? null : redactClaim(rawReason);
  if (!DISPOSITIONS.includes(disposition)) {
    throw new Error(`disposition must be one of ${DISPOSITIONS.join('|')}, got ${JSON.stringify(disposition)}`);
  }
  // A decision without a reason is indistinguishable from one nobody looked at, which is the state this
  // vocabulary exists to separate — and a deferral without one is how `ledger.mjs:400` sat undecided.
  if (disposition !== 'fixed_claimed' && disposition !== 'partial' && !String(reason ?? '').trim()) {
    throw new Error(`a ${disposition} disposition must carry its reason`);
  }
  // THE OPERATOR'S WORDS decide who acted (G-12 of 20260927-220507-ledger-review-r2; operator: "b"): with
  // them a disposition is the operator's transition (T13–T17), without them an agent's (T9–T13). A close
  // records `closed_by: operator`, so it cannot be recorded without them at all. The words are not checked
  // yet (ledger-quote-verification.plan.md); an agent never writes words the operator did not say.
  const quote = redactClaim(String(operator_quote ?? '').trim()) || null;
  // A CLAIM IS AN AGENT'S (G-6(b), G-13(a) of 20260928-004954-ledger-transitions-review): the operator's words
  // on one were accepted, recorded nowhere, and printed as "the operator's" — refused instead.
  if (quote && (disposition === 'fixed_claimed' || disposition === 'partial')) {
    throw new Error('a fix claim is an agent\'s; the operator\'s words do not apply to it (drop --operator-quote)');
  }
  if (disposition === 'closed' && !quote) {
    throw new Error('a closed finding records closed_by operator, so it needs the operator\'s words (operator_quote)');
  }
  const entries = { ...(ledger?.entries ?? {}) };
  const missing = [];
  const refused = [];
  // ONE HISTORY FOR EVERY DISPOSITION (3a). decisions[] held only the operator's transitions, and an agent's
  // claim or deferral lived in `reason` alone — so the next disposition replaced it: 20 reasons, 2 holding the
  // operator's words, were erased that way (ledger-trust-boundaries.design.md §3). Each element says who acted
  // (`by`) and which review groups it concerns (`groups`, the input 3b compares).
  const groupList = [...new Set((groups ?? []).map(String).filter(Boolean))];
  const decision = (transition) => ({ transition, at, run: run_id, by: quote ? 'operator' : 'agent',
    ...(groupList.length ? { groups: groupList } : {}), quote, reason });
  const appended = (e, transition) => ({ decisions: [...(e.decisions ?? []), decision(transition)] });
  const decided = (e, transition) => ({ operator_quote: quote, decided_at: at, decided_in: run_id, ...appended(e, transition) });
  for (const key of keys) {
    if (!entries[key]) { missing.push(key); continue; }
    // A LEGACY DEFERRAL IS KEPT BEFORE ANYTHING CAN OVERWRITE IT (3b): T11 rewrites `deferred_in`, and every
    // disposition rewrites `reason`, so a deferral recorded only in those fields vanished at the next one.
    const e = keepLegacyDeferral(entries[key], at);
    const open = isOpen(e);
    const agentDecline = isAgentDecline(e);
    const rose = declineReturned(e);
    const refuse = (why) => { refused.push({ key, why }); };
    // The status a claim replaced, so a withdrawn or failed claim puts it back.
    const beforeClaim = ['fixed_claimed', 'partial'].includes(e.status) ? (e.claimed_from ?? 'open') : e.status;

    if (disposition === 'fixed_claimed' || disposition === 'partial') {
      // T9, T10 — an agent's claim.
      if (!open) { refuse(`${e.status} is decided; the operator can reopen it (reopen)`); continue; }
      if (agentDecline) { refuse('a proposed decline awaits the operator: withdraw it (withdraw), or the operator confirms it (declined)'); continue; }
      if (rose) { refuse(raisedAgain('is the operator\'s: re-confirm it (declined) or reopen it (reopen)')); continue; }
      const silentAtClaim = (e.silent_in ?? []).length;
      const noLens = !(e.nodes ?? []).length;
      // 3b — A CLAIM THAT DOES NOT COVER A STANDING DECISION goes to the operator: the entry holds another
      // group's deferral, proposed decline or keep, and a silent review could not tell which finding it
      // confirms. The r4 claim for the lock closed the r3 G-6 deferral this way (`findings-ledger.mjs:190`).
      // An element naming no group always counts as different (conservative, and said in the plan).
      const uncovered = standingDecisions(e).some((d) => !(d.groups ?? []).length || !d.groups.every((g) => groupList.includes(g)))
        // And every group of a SHARED sighting in this stay (ledger-identity, stage 3): a claim for G-1 alone would
        // otherwise let the next silent review close the unfixed G-2.
        || (e.stay_shared ?? []).some((g) => !groupList.includes(g));
      entries[key] = {
        ...without(e, CLAIM_FIELDS),
        status: disposition,
        claimed_in: run_id,
        // Kept even when null: the ABSENCE of an evidence path is itself the fact a reader needs.
        claim_evidence: evidence_path,
        claimed_from: beforeClaim,
        silent_at_claim: silentAtClaim,
        // Exit 1 is closed to a claim on an entry the reviews were already silent about, and to one with
        // no raising review lens (an observation's author never counts): the operator must decide it.
        ...(silentAtClaim > 0 || noLens || uncovered ? { needs_operator: true } : {}),
        // `reason` is only the LATEST element's (3a): a claim with none clears it rather than leave an older one
        // reading as current (G-9 of ltb-review-r2). The older reason stays in decisions[].
        reason: reason ?? undefined,
        ...appended(e, disposition === 'partial' ? 'T10' : 'T9'),
      };
      continue;
    }

    if (disposition === 'open' && !quote) {
      // T11 — a deferral, or a failed fix: an agent's act, so it restarts NO clock (G-20); it clears any
      // claim and puts back the status the claim replaced.
      if (!open) { refuse(`${e.status} is decided; the operator can reopen it (reopen)`); continue; }
      if (agentDecline) { refuse('a proposed decline awaits the operator: withdraw it (withdraw), or the operator confirms it (declined)'); continue; }
      if (rose) { refuse(raisedAgain('is the operator\'s: re-confirm it (declined) or reopen it (reopen)')); continue; }
      entries[key] = { ...without(e, CLAIM_FIELDS), status: beforeClaim, deferred_in: run_id, reason, ...appended(e, 'T11') };
      continue;
    }

    if (disposition === 'open') {
      // T14 — the operator's keep: the only transition that restarts both stale clocks.
      if (!open) { refuse(`${e.status} is decided; reopen it first (reopen)`); continue; }
      if (agentDecline) { refuse('a proposed decline is withdrawn (withdraw) or confirmed (declined), not kept'); continue; }
      if (rose) { refuse(raisedAgain('is re-confirmed (declined) or reopened (reopen), not kept')); continue; }
      entries[key] = { ...e, reason, kept_at: at, silent_in: [], ...decided(e, 'T14') };
      continue;
    }

    if (disposition === 'declined' && !quote) {
      // T12 — an agent's PROPOSED decline: open until the operator confirms it.
      if (!open) { refuse(`${e.status} is decided; the operator can reopen it (reopen)`); continue; }
      // G-9 of 20260928-171758-ltr-review-r5: each refusal names every way on, not only why it stopped.
      if (agentDecline) { refuse('already a proposed decline (a second would overwrite the status it replaced): withdraw it (withdraw), or the operator confirms it (declined)'); continue; }
      if (rose) { refuse(raisedAgain('is the operator\'s: they re-confirm it (declined) or reopen it (reopen)')); continue; }
      entries[key] = { ...without(e, CLAIM_FIELDS, CLOSE_FIELDS, DECISION_FIELDS), status: 'declined', decided_by: 'agent',
        declined_in: run_id, reason, prior_status: beforeClaim, ...appended(e, 'T12') };
      continue;
    }

    if (disposition === 'declined') {
      // T15 — the operator's decline: made, confirmed, or re-confirmed after a review raised it again (either flag).
      if (!open) { refuse(`${e.status} is decided; reopen it first (reopen)`); continue; }
      entries[key] = { ...without(e, CLAIM_FIELDS, CLOSE_FIELDS, DECISION_FIELDS), status: 'declined', decided_by: 'operator',
        declined_in: run_id, reason, declined_severity: e.severity, ...decided(e, 'T15') };
      continue;
    }

    if (disposition === 'withdraw') {
      // T13 — a proposed decline withdrawn by the agent, or rejected by the operator.
      if (!agentDecline) { refuse('only an agent\'s proposed decline can be withdrawn; an operator decision is reopened (reopen)'); continue; }
      entries[key] = { ...without(e, DECISION_FIELDS), status: e.prior_status ?? 'open', reason,
        ...(quote ? decided(e, 'T13') : appended(e, 'T13')) };
      continue;
    }

    if (disposition === 'closed') {
      // T16 — the operator's close.
      if (!open) { refuse(`${e.status} is decided; reopen it first (reopen)`); continue; }
      entries[key] = { ...without(e, CLAIM_FIELDS, DECISION_FIELDS), status: 'closed', closed_by: 'operator', closed_in: run_id,
        reason, ...decided(e, 'T16') };
      continue;
    }

    // T17 — reopen: the operator's, and the only way back into a decided entry. The claim goes with the
    // close, so no silent review can close it again on the old claim (G-8's rule).
    if (!quote) { refuse('reopening a decision is the operator\'s: give their words (operator_quote)'); continue; }
    // G-17 of 20260928-004954-ledger-transitions-review: a decline a review raised again is open only so the
    // operator sees it — it is still their decision, and reopening it is one of the two answers offered.
    if (open && !rose) { refuse('the entry is already open'); continue; }
    // T17 begins a new stay in the open set (3b), so no decision from before the reopen counts against a claim.
    entries[key] = { ...without(e, CLAIM_FIELDS, CLOSE_FIELDS, DECISION_FIELDS, ['stay_shared']), status: 'reopened', reason, silent_in: [],
      kept_at: at, ...(at ? { stay_started: at } : {}), ...decided(e, 'T17') };
  }
  // markFixed must not lose the fold record mergeRun keeps (G-19), nor `last_fold_at`: a disposition
  // never moves the window of operator decisions.
  // ALL OR NOTHING (G-6 of 20260928-004954-ledger-transitions-review): a command with a refused key applies
  // none of its keys, so a refusal never leaves the ledger half-changed behind an exit code of 1.
  if (refused.length) return { ledger, missing, refused };
  return { ledger: { ...ledger, schema_version: 1, entries, runs_folded: ledger?.runs_folded ?? [] }, missing, refused };
}

/**
 * T8, T8b — AN OBSERVATION (`--add`): an agent's note, not a review's sighting.
 *
 * It went through mergeRun, which treated it as a recurrence: it voided claims, cleared `silent_in`,
 * reopened closed entries and wrote its author into `nodes` — so an agent could add, claim and let the
 * next silent review close an entry it had just reset (round 4 of the ledger-transitions review). An
 * observation now clears no silence, restarts no clock, reopens nothing, never becomes a raising lens,
 * and never touches `last_fold_at` or `runs_folded`. On a closed entry it is a note, listed for the
 * operator. Which entry it belongs to is decided by the same rule the fold uses.
 */
export function addObservation(ledger, { file, line, severity = 'MEDIUM', claim, found_by = 'observed', at, run_id = null }) {
  const entries = { ...(ledger?.entries ?? {}) };
  const f = { file, line: Number.isInteger(line) ? line : 0 };
  const key = keyResolver(entries).resolve(f);
  const note = { found_by, observed_at: at, severity, claim: redactClaim(claim).slice(0, 300) };
  const prior = entries[key];
  if (!prior) {
    entries[key] = {
      key, file: norm(file), line: f.line, severity, status: 'open',
      first_seen: run_id ?? `observed-${String(at)}`, last_seen: run_id ?? `observed-${String(at)}`, times_seen: 1,
      claim: note.claim, nodes: [], at, last_seen_at: at, observations: [note],
      ...(at ? { stay_started: at } : {}),
    };
  } else {
    // NOT CAPPED (operator, 2026-09-28: "4a"). ec3c904 kept the newest 50 for G-15 of ltr-review-r4, and r5's
    // G-10 found the cap could drop a note on a closed entry before the operator had seen it — which T8b
    // promises. No entry in this ledger had held a single observation, so the cap guarded growth never seen.
    entries[key] = { ...prior, times_seen: (prior.times_seen ?? 0) + 1, observations: [...(prior.observations ?? []), note] };
  }
  return { ...ledger, schema_version: 1, entries, runs_folded: ledger?.runs_folded ?? [] };
}

/**
 * WHERE AN OBSERVATION WOULD LAND, AND WHETHER THAT ENTRY IS DECIDED (observation-guard-and-sibling-census.md, A).
 * The bucket key absorbs a different defect within 10 lines into the entry already there; on a decided entry the note
 * vanished into it, four times on 2026-10-15. `decided` names why, so `--add` refuses rather than reports afterwards:
 * the entry is not open, carries a pending claim, or holds a standing decision. Same rule as the append it guards.
 */
export function observationTarget(ledger, { file, line }) {
  const entries = ledger?.entries ?? {};
  const key = keyResolver(entries).resolve({ file, line: Number.isInteger(line) ? line : 0 });
  const e = entries[key] ?? null;
  let decided = null;
  if (e && !isOpen(e)) decided = `it is ${e.status}`;
  else if (e && ['fixed_claimed', 'partial'].includes(e.status)) decided = `it carries a pending ${e.status} claim`;
  else if (e && standingDecisions(e).length) decided = 'it holds a standing decision (a deferral, a proposed decline or a keep)';
  return { key, entry: e, decided };
}

/** Observations on entries that are closed — notes the operator should see (T8b). */
export function observedWhileClosed(ledger, since = ledger?.last_fold_at ?? null) {
  const out = [];
  for (const e of Object.values(ledger?.entries ?? {})) {
    if (isOpen(e)) continue;
    for (const o of e.observations ?? []) if (!since || String(o.observed_at) > String(since)) out.push({ key: e.key, ...o });
  }
  return out;
}

/**
 * The operator's decisions since the last REVIEW fold (`last_fold_at`) — read from `decisions[]`, which
 * nothing clears, so a decision a later recurrence wiped from the entry's fields is still listed. Until
 * the operator's words are verified (ledger-quote-verification.plan.md) this list is how they see every
 * decision recorded in their name.
 */
export function operatorDecisionsSince(ledger, since = ledger?.last_fold_at ?? null) {
  const out = [];
  for (const e of Object.values(ledger?.entries ?? {})) {
    // Only the OPERATOR's (3a): decisions[] now holds every disposition. An element with no `by` was written
    // before that, when only operator transitions wrote any, so it reads as the operator's.
    for (const d of e.decisions ?? []) {
      if ((d.by ?? 'operator') !== 'operator') continue;
      if (!since || String(d.at) > String(since)) out.push({ key: e.key, ...d });
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** Claims the operator must decide, because exit 1 is closed to them (T9's `needs_operator`). */
/** Open entries no review has judged: their severity is their findings' own (reconcile-missing-groups stage 2). */
export function unjudgedEntries(ledger) {
  return Object.values(ledger?.entries ?? {}).filter((e) => isOpen(e) && e.unjudged === true);
}

export function claimsNeedingOperator(ledger) {
  return Object.values(ledger?.entries ?? {}).filter((e) => isOpen(e) && e.needs_operator === true);
}

/**
 * THE MIGRATION to ledger-transitions, run once and idempotent (a second run changes nothing).
 * - A disproved fix claim still on a `reopened` entry (from before G-8's fix) is cleared, and so is a
 *   close's leftover fields on any open entry and on an operator decline.
 * - An observation's author moves out of `nodes` into `found_by`: it never counts as a raising lens. A
 *   claim left with no raising lens is flagged for the operator.
 * - A pending claim records `silent_at_claim`; an operator decline records `declined_severity`.
 * - LEGACY ("leave labelled"): a `fixed` entry closed by silence alone, and a `closed` one without the
 *   operator's words, keep their status and get `legacy: true`. A `fixed` entry with a claim and a
 *   verifying run but no `closed_by` is labelled with the shape it has, marked as closed before this rule.
 */
export function migrateTransitions(ledger) {
  const report = { changed: 0, legacy: 0, relabelled: 0, claims_cleared: 0, fields_cleared: 0, lens_moved: 0, no_raising_lens: 0 };
  const entries = {};
  const isObserver = (n) => /^observed/.test(String(n)) || /^remediate/.test(String(n));
  for (const [k, e] of Object.entries(ledger?.entries ?? {})) {
    let n = { ...e };
    const observers = (n.nodes ?? []).filter(isObserver);
    if (observers.length) {
      n.nodes = (n.nodes ?? []).filter((x) => !isObserver(x));
      n.found_by = [...new Set([...(Array.isArray(n.found_by) ? n.found_by : []), ...observers])];
      report.lens_moved++;
      if (!n.nodes.length) report.no_raising_lens++;
    }
    if (isOpen(n) || n.status === 'declined') {
      if (n.status === 'reopened' && n.claimed_in) { n = without(n, CLAIM_FIELDS); report.claims_cleared++; }
      if (CLOSE_FIELDS.some((f) => f in n)) { n = without(n, CLOSE_FIELDS); report.fields_cleared++; }
    }
    if (n.status === 'fixed_claimed' && n.silent_at_claim === undefined) n.silent_at_claim = (n.silent_in ?? []).length;
    // G-15 of 20260928-004954-ledger-transitions-review: the same rule a new claim follows (T9).
    if (n.status === 'fixed_claimed' && (!(n.nodes ?? []).length || n.silent_at_claim > 0)) n.needs_operator = true;
    if (n.status === 'declined' && n.decided_by === 'operator' && !n.declined_severity) n.declined_severity = n.severity;
    if (n.status === 'fixed' && !n.legacy && !n.pre_transitions && n.closed_by !== 'claim+silence') {
      if (!n.closed_by && n.claimed_in && n.verified_in) { n.closed_by = 'claim+silence'; n.pre_transitions = true; report.relabelled++; }
      else { n.legacy = true; report.legacy++; }
    }
    if (n.status === 'closed' && !n.operator_quote && !n.legacy) { n.legacy = true; report.legacy++; }
    if (JSON.stringify(n) !== JSON.stringify(e)) report.changed++;
    entries[k] = n;
  }
  return { ledger: { ...ledger, entries }, report };
}

/**
 * STALE: open entries the operator must decide (2026-09-27: "2 reviews or 14 days"). Silence no longer
 * closes an unclaimed entry, so without this the open set would only grow. An entry is stale when it
 * was silent in STALE_SILENT_REVIEWS reviews that looked at it, or when STALE_DAYS have passed since it
 * was last raised or last kept, whichever comes first. The operator then handles it, closes it
 * (disposition `closed`, with a reason), or keeps it (disposition `open`, which restarts both clocks).
 * `now` is supplied by the caller: this module reads no clock.
 */
export const STALE_SILENT_REVIEWS = 2;
export const STALE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC time a run id names (`YYYYMMDD-HHMMSS-slug`), or null for anything else. */
export function runIdTime(id) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(String(id ?? ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

export function staleEntries(ledger, { now, silentReviews = STALE_SILENT_REVIEWS, days = STALE_DAYS } = {}) {
  if (!Number.isFinite(now)) throw new Error('staleEntries: `now` (milliseconds) is required — this module reads no clock');
  const out = [];
  for (const e of openEntries(ledger)) {
    const silent = (e.silent_in ?? []).length;
    const kept = e.kept_at ? Date.parse(e.kept_at) : NaN;
    const raised = (e.last_seen_at ? Date.parse(e.last_seen_at) : NaN) || runIdTime(e.last_seen) || (e.at ? Date.parse(e.at) : NaN);
    const since = Math.max(Number.isFinite(kept) ? kept : -Infinity, Number.isFinite(raised) ? raised : -Infinity);
    let because = null;
    if (silent >= silentReviews) because = `silent in ${silent} reviews that looked at it (${e.silent_in.join(', ')})`;
    else if (since === -Infinity) because = 'no recorded time: it cannot age, so it is shown rather than left';
    else if (now - since >= days * DAY_MS) because = `${Math.floor((now - since) / DAY_MS)} days since it was last raised or kept`;
    if (because) out.push({ ...e, stale_because: because });
  }
  return out;
}

/**
 * Decisions that took an entry out of the open set without the operator's words (G-12 of
 * 20260927-220507-ledger-review-r2; operator, 2026-09-27: "b"): a decline a remediating agent made by
 * itself. Listed beside the stale entries until the operator confirms it (declined, with their words)
 * or reopens it (open). A decline recorded before this rule has no decided_by and is listed too.
 */
export function unconfirmedDecisions(ledger) {
  return Object.values(ledger?.entries ?? {})
    .filter((e) => e.status === 'declined' && e.decided_by !== 'operator')
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** What the operator reads: open work, worst first, most-seen first within a rung. */
export function openEntries(ledger) {
  return Object.values(ledger?.entries ?? {})
    .filter(isOpen)
    .sort((a, b) =>
      SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity) ||
      b.times_seen - a.times_seen ||
      a.key.localeCompare(b.key));
}

/**
 * The loop's convergence signal, computed from the ledger alone. A self-review loop never reaches
 * zero findings — held to its own maximal standard it always finds a LOW — so "done" is not an
 * empty ledger. It is: no open finding above the floor, and no NEW one introduced by the most
 * recent run. This function returns the facts a stop-rule reads; the operator (or a script) sets
 * the floor and the two-cycle patience.
 *
 * `bySeverity` counts open entries per rung. `newestRun` is the most recent run id that appears as
 * a first_seen among open entries — i.e. the last time the loop found something genuinely new.
 * `newAboveFloor` counts open entries first seen in that newest run at or above the floor: zero
 * means the newest cycle introduced nothing that clears the bar, which is the drained signal.
 */
export function convergence(ledger, { floor = 'HIGH', newest_run = null } = {}) {
  const open = Object.values(ledger?.entries ?? {}).filter(isOpen);
  const floorIdx = SEVERITY_ORDER.indexOf(floor);
  const bySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, BLOCKER: 0 };
  // WHICH RUN IS THE NEWEST is a fact about the LEDGER, not about the open set.
  //
  // This read the largest `first_seen` among OPEN entries, which is the newest run *that introduced
  // an open finding* — a different thing. The moment a cycle found nothing new (the outcome the
  // whole signal exists to detect) `newest_run` silently fell back to some earlier run, and
  // `new_above_floor_this_run` then counted that old run's introductions as this cycle's. The
  // reading was worst exactly where it mattered: a clean cycle could report new work (G-31).
  //
  // Every entry the ledger holds records the runs that touched it, so the newest run is the largest
  // id across all of them, open or closed. Run ids are timestamp-prefixed, so they order as strings.
  // A caller that knows the run it just folded should pass it — that is better than any inference.
  // THE FOLD RECORD FIRST, because it is the only source that knows about a cycle which found
  // nothing (G-19). The entry scan below remains for ledgers written before `runs_folded` existed.
  // ONLY A REVIEW CYCLE CAN BE THE NEWEST (G-19 of 20260927-211023-ledger-review). Ids are compared as
  // text, and a hand-added `observed-…` id (or a `(manual)` disposition) sorts after every date-prefixed
  // run id, so one note filed with --add became "the newest cycle" and its entries were counted as new.
  // Excluded by what they ARE rather than required to look like a dated id: a fixture's `run-2` is a
  // cycle too, and requiring a date broke the convergence tests that use such ids.
  const isCycle = (id) => Boolean(id) && !String(id).startsWith('observed-') && !String(id).startsWith('(');
  let newestRun = newest_run;
  for (const id of ledger?.runs_folded ?? []) {
    if (isCycle(id) && (newestRun === null || id > newestRun)) newestRun = id;
  }
  for (const e of Object.values(ledger?.entries ?? {})) {
    for (const id of [e.first_seen, e.last_seen, e.claimed_in, e.verified_in]) {
      if (isCycle(id) && (newestRun === null || id > newestRun)) newestRun = id;
    }
  }
  for (const e of open) {
    if (e.severity in bySeverity) bySeverity[e.severity]++;
  }
  const aboveFloor = open.filter((e) => SEVERITY_ORDER.indexOf(e.severity) >= floorIdx);
  const newAboveFloor = aboveFloor.filter((e) => e.first_seen === newestRun).length;
  return {
    floor,
    open_total: open.length,
    by_severity: bySeverity,
    open_above_floor: aboveFloor.length,
    newest_run: newestRun,
    new_above_floor_this_run: newAboveFloor,
    // The drained signal: the newest cycle introduced nothing at or above the floor. Two
    // consecutive such cycles is the recommended stop — the caller tracks the second.
    drained: newAboveFloor === 0 && aboveFloor.length === 0,
  };
}

// SECRET-SHAPED TEXT NEVER REACHES THE TRACKED LEDGER (G-12 of 20260928-032057-ltr-review-r3): redaction has ONE
// owner, lib/redact.mjs (ledger-trust-boundaries, 1b), re-exported here for the callers that import it from the ledger.
export { redactClaim } from './redact.mjs';

// A run id's time as the ISO string `at`, `stay_started` and `last_fold_at` use; null for an id with no time,
// such as the bare `(manual)` older dispositions wrote. A raw run id compared as text sorts after every ISO
// time, so an unconverted one would read as newer than everything.
function runIsoTime(id) {
  const ms = runIdTime(id);
  if (ms !== null) return new Date(ms).toISOString();
  const m = /^\(manual (\d{4}-\d{2}-\d{2}T[^)]+)\)$/.exec(String(id ?? ''));
  return m ? m[1] : null;
}

// A deferral recorded only as `deferred_in` and `reason`, with no T11 element for that run: what every deferral
// looked like before 3a.
function legacyDeferral(e) {
  if (!e?.deferred_in) return null;
  if ((e.decisions ?? []).some((d) => d.transition === 'T11' && d.run === e.deferred_in)) return null;
  const when = runIsoTime(e.deferred_in);
  return { transition: 'T11', by: 'agent', run: e.deferred_in, ...(when ? { at: when } : { at_unknown: true }), reason: e.reason ?? null, legacy: true };
}

/** The entry with its legacy deferral kept as a history element (`recorded_at` = when it was kept), or unchanged. */
export function keepLegacyDeferral(e, at) {
  const d = legacyDeferral(e);
  if (!d) return e;
  return { ...e, decisions: [...(e.decisions ?? []), { ...d, ...(d.at_unknown ? { recorded_at: at } : {}) }] };
}

const STANDING = new Set(['T11', 'T12', 'T14']);

/**
 * THE DECISIONS THAT SAY THE FINDING STILL STANDS, in the entry's current stay (3b): a deferral (T11), an
 * agent's proposed decline (T12) not since withdrawn (T13), an operator keep (T14). A decline or close ends the
 * entry itself, so it never meets a later claim.
 *
 * The stay began at `stay_started` (T1, T3, T17); an element counts when its time is on or after it. With no
 * `stay_started` — an entry written before this rule, in this ledger or a consumer's — every element counts,
 * which is conservative. An element with no date counts if it was recorded within the stay. A legacy deferral
 * not yet kept as an element is read here too, so a consumer's ledger is guarded without a migration.
 */
export function standingDecisions(e) {
  const all = [...(e?.decisions ?? [])];
  const legacy = legacyDeferral(e);
  if (legacy) all.push(legacy);
  const since = e?.stay_started ?? null;
  const inStay = (d) => {
    if (!since) return true;
    if (d.at) return String(d.at) >= String(since);
    if (d.recorded_at) return String(d.recorded_at) >= String(since);
    return true;   // undated and never kept: no way to place it before the stay, so it counts
  };
  const out = [];
  // A T12 is withdrawn by any LATER T13: one index of the last T13, not a copied suffix scanned per T12 (G-9 of
  // 20261013-042240-ledger-identity-remediation-4-review: O(D^2) in the decision history).
  const lastT13 = all.findLastIndex((x) => x.transition === 'T13');
  all.forEach((d, i) => {
    if (!STANDING.has(d.transition) || !inStay(d)) return;
    if (d.transition === 'T12' && i < lastT13) return;
    out.push(d);
  });
  return out;
}
