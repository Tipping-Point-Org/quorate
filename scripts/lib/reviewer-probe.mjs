// THE REVIEWER PREFLIGHT'S PURE HALF (reviewer-preflight.plan.md, stage 1; design decided, operator 2026-10-09: D1
// "Everything that matters (Recommended)", D3 "Key change or age (Recommended)"). The ask, 2026-10-08: "no fallback.
// preflight test for what is needed and fails if something is missing. if the use decides to use agy or orther model
// preflight should be ran again". A probe proves one COMBINATION works — adapter, its definition, model, effort, mode,
// schema route, the CLI's version, the host — and its record counts only for that combination, and only while young
// enough. No I/O, no clock, no environment: the caller passes `now`, the host and the records (scripts/io/reviewer-probe.mjs).

import crypto from 'node:crypto';
import { UNAVAILABLE_ROLES } from './decisions.mjs';
import { PROBE_LIMITS } from './reviewers.mjs';
import { minutes, TIMER_MAX_MS } from './check-timeout.mjs';
import { reviewSchema, proposeSchema, tieBreakSchema, claimCheckSchema, decideSchema, validateStrict } from './reviewer-schemas.mjs';

/** JSON with keys sorted at every level, so an adapter's hash does not move with the order its fields were written. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** The adapter's DEFINITION, hashed: an edited adapter (a flag, a schema route, a declared override) is probed again. */
export const adapterHash = (adapter) => sha(canonical(adapter ?? {})).slice(0, 16);

/**
 * THE CODE THAT RUNS AND JUDGES A PROBE, relative to the framework root (story-pipeline, 2026-10-16; operator: "Hash of the
 * probe's code"). A record vouches for a probe only if this code is the same: without it in the key, a fixed working
 * tree's passing records hid a pinned engine's broken probe for 24 hours. The call and the probe (external-review), the
 * key, the prompts and the pass rule (reviewer-probe), the version command and the record (io/reviewer-probe), the argv
 * (decisions), the response readers (reviewers), the schemas and their validator (reviewer-schemas), the tie-break
 * prompt's owner (review-prompts, template), and the probe and tie-break templates. The schemas and the I/O half were
 * missing (G-9 of 20261016-193355-sp-bugs-review), and so was everything the probe loads beyond this file's direct
 * imports: the tie-break probe's participants (adjudication), the spawn and the kill (spawn-capture, stop-child, the
 * platform's process adapter) — G-9 of 20261016-204040-sp-bugs-remediation-review. The probe is external-review run
 * again, so every module it and the I/O half load, followed through their imports, is held to this list by a test.
 */
export const PROBE_CODE_FILES = [
  'scripts/external-review.mjs', 'scripts/lib/reviewer-probe.mjs', 'scripts/io/reviewer-probe.mjs', 'scripts/lib/decisions.mjs',
  'scripts/lib/reviewers.mjs', 'scripts/lib/reviewer-schemas.mjs', 'scripts/lib/review-prompts.mjs', 'scripts/lib/template.mjs',
  'scripts/lib/adjudication.mjs', 'scripts/lib/node-depth.mjs', 'scripts/lib/check-timeout.mjs', 'scripts/lib/capabilities.mjs', 'scripts/lib/census.mjs', 'scripts/lib/contract-glob.mjs', 'scripts/lib/contract-source.mjs',
  'scripts/lib/contract-version.mjs', 'scripts/lib/finding-scope.mjs', 'scripts/lib/io-param.mjs', 'scripts/lib/locate.mjs',
  'scripts/lib/paths.mjs', 'scripts/lib/reviews-root.mjs', 'scripts/lib/stop-vocabulary.mjs', 'scripts/lib/walk-rules.mjs',
  // external-review builds the vendor call's entry (runtime-call-telemetry.plan.md stage 3).
  'scripts/lib/call-entry.mjs',
  // capabilities and decisions read an adapter's tool lists through it (adapter-tool-lists.plan.md stage 2).
  'scripts/lib/tool-lists.mjs',
  // io/git.mjs holds every git result to it: one that erred never reads as exit 0 (telemetry-run-time, 2026-10-27).
  'scripts/lib/spawn-result.mjs',
  // spawn-capture hands a reviewer its stdin through it (decision-panel-seats.plan.md stage 2).
  'scripts/io/stdin-file.mjs',
  // external-review reads a reviewer's prompt through the egress owner (hardlink-egress.plan.md stage 2).
  'scripts/io/egress-read.mjs', 'scripts/lib/egress-read.mjs',
  // The egress owner reads the seat copy's per-file bound, and external-review writes its answer every byte through
  // write-all (G-6 and G-4 of 20261112-050334-hl-review-b).
  'scripts/io/seat-copies.mjs', 'scripts/io/write-all.mjs',
  'scripts/io/atomic.mjs', 'scripts/io/contract-reader.mjs', 'scripts/io/finding-scope.mjs', 'scripts/io/review-prompts.mjs',
  'scripts/io/reviewers.mjs', 'scripts/io/reviews-root.mjs', 'scripts/io/spawn-capture.mjs', 'scripts/io/stop-child.mjs',
  'scripts/io/template.mjs', 'scripts/platform/index.mjs', 'scripts/platform/interface.mjs', 'scripts/platform/common/index.mjs',
  'scripts/platform/posix/index.mjs', 'scripts/platform/linux/index.mjs', 'scripts/platform/macos/index.mjs',
  'scripts/platform/win32/index.mjs',
  'prompts/_templates/reviewer-probe-propose.md', 'prompts/_templates/reviewer-probe-review.md',
  'prompts/_templates/tie-break.md', 'prompts/_templates/tie-break-constraints.md', 'prompts/_templates/tie-break-excerpt-missing.md',
  'prompts/_templates/tie-break-excerpt.md',
  'prompts/_templates/tie-break-no-positions.md', 'prompts/_templates/tie-break-no-votes.md',
  // Read into every tie-break probe by buildTieBreakPrompt (G-12 of 20261016-214749-sp-bugs-remediation-2-review); a test
  // holds this list to every template building the probe's prompts opens.
  'prompts/_templates/brief-feedback.md',
  // The claim-check mode (claim-check-cross-family.plan.md stage 2): its probe prompt, and the result-shape check
  // external-review loads through io/claim-check.mjs and reviewer-schemas loads for the mode's enums.
  'prompts/_templates/reviewer-probe-claim-check.md', 'scripts/io/claim-check.mjs', 'scripts/lib/claim-check.mjs',
  // The decide mode (autonomous-run.plan.md stage 4): its probe prompt, and the seat-answer shape check external-review
  // loads from lib/decision-panel.mjs.
  'prompts/_templates/reviewer-probe-decide.md', 'scripts/lib/decision-panel.mjs', 'scripts/lib/evidence-path.mjs',
  // The quota classifier external-review loads (autonomous-run.plan.md stage 7 part 2).
  'scripts/lib/quota.mjs',
  // The redaction quota.mjs runs on a reset text it cuts from a CLI's raw output, and the secret shapes it is built from.
  'scripts/lib/redact.mjs', 'scripts/lib/secret-shapes.mjs',
  // The command-line parser and the specs it reads (entrypoint-argv.plan.md stage 3): the probe child's argv is parsed
  // by them, so a change to either can change what the probe accepts.
  'scripts/lib/argv.mjs', 'scripts/lib/argv-specs.mjs',
  // The engine's one git owner (engine-git-env.plan.md stage 2), which io/reviews-root.mjs and external-review.mjs run git
  // through, and the pool its gitAsync spawns with.
  'scripts/io/git.mjs', 'scripts/io/pool.mjs', 'scripts/lib/pool.mjs',
  // The rule registry the schema descriptions' slots are filled from (evidence-rules-text-owner.plan.md stage 2), its
  // imports, and the template it fills them with.
  'scripts/lib/rule-text.mjs', 'scripts/lib/scope-constructs.mjs', 'prompts/_templates/rule-no-red.md',
  // The one owner of a path below an admitted directory (run-dir-descendants.plan.md stage 2), which every evidence write
  // of external-review goes through.
  'scripts/io/confined-path.mjs', 'scripts/lib/confined-path.mjs',
  // The torn-tail repair io/stop-child.mjs runs before appending its kill log (G-8 chain, remediation 3).
  'scripts/io/torn-tail.mjs',
  // The record lock it appends under (stop-record-bounds-and-kill-log.plan.md stage 1, KL-D1 B), and the lock's content
  // and staleness rule it reads.
  'scripts/io/record-lock.mjs', 'scripts/lib/session-record.mjs',
];

/** The hash of PROBE_CODE_FILES' contents; `read(rel)` returns a file's text (or '' when absent). Pure. */
export function probeCodeHash(read) {
  return sha(PROBE_CODE_FILES.map((f) => `${f}\0${read(f) ?? ''}`).join('\0\0')).slice(0, 16);
}

/** The fields a probe record is keyed by (D1), in this order; `state` and what follows are its result. */
export const KEY_FIELDS = ['adapter', 'adapter_hash', 'model', 'effort', 'mode', 'route', 'cli_version', 'host', 'probe_code_hash'];

/** A combination's key: a hash of exactly KEY_FIELDS, so a change to any one of them is a different key. */
export function probeKey(combination) {
  const picked = Object.fromEntries(KEY_FIELDS.map((k) => [k, combination?.[k] ?? '']));
  return sha(canonical(picked)).slice(0, 32);
}

/**
 * The adapter's own limits, each falling back to reviewers.json's `probe_defaults` — configuration, never a literal
 * here. Returns milliseconds for the three and the two derived bounds: `staleMs`, a holder's maximum work (its version
 * command plus one probe), after which its lock may be reclaimed; and `checkBoundMs`, the mint's bound on one check —
 * a wait on a holder that dies at its limit, then the check's own version command and probe, plus the margin.
 */
export function probeLimits(adapter, defaults) {
  const pick = (k) => {
    const v = adapter?.[k] ?? defaults?.[k];
    // The minutes limit through its owner, which takes a digit string as adapterErrors does (G-18 of
    // 20261022-013653-cid1a-delivery): the two helpers refuse alike.
    if (k === 'probe_timeout_minutes' && v !== undefined) return minutes('reviewers.probe_timeout_minutes', v);
    if (!(typeof v === 'number' && Number.isFinite(v) && v > 0)) {
      throw new Error(`probeLimits: ${k} is neither declared by the adapter nor in probe_defaults`);
    }
    return v;
  };
  const [probeMin, versionSec, marginSec] = PROBE_LIMITS.map(pick);
  const probeMs = probeMin * 60_000;
  const versionMs = versionSec * 1000;
  const marginMs = marginSec * 1000;
  // EVERY TERM NAMED, FROM CONFIGURATION (G-4 of 20261009-222911-reviewer-preflight-review). The probe child runs its
  // own version command and the vendor call, plus the margin for starting it; a lock holder's work is one such child;
  // and a check is its version command, a wait on a holder (staleMs + margin), its own probe child and the margin.
  // The bound was 2 x (version + probe) + margin while the child carried a 30 s literal of its own, so a slow but legal
  // check could be killed as having overrun.
  const probeChildMs = versionMs + probeMs + marginMs;
  const staleMs = probeChildMs;
  const checkBoundMs = versionMs + (staleMs + marginMs) + probeChildMs + marginMs;
  // THE SUMS FIT A TIMER TOO (G-12 of 20261010-082146-reviewer-preflight-r8): each limit is bounded alone, and these add
  // several together.
  if (checkBoundMs > TIMER_MAX_MS) {
    // The one owner of this sum (probe-limit-sum.design.md): each term is named, so the refusal says which to lower.
    throw new Error(`probeLimits: the probe limits do not fit one timer together: 3 x version (${versionSec} s) + 2 x probe `
      + `(${probeMin} min) + 4 x margin (${marginSec} s) = ${checkBoundMs} ms, above a Node timer's ${TIMER_MAX_MS} ms; lower the probe limits`);
  }
  return { probeMs, versionMs, marginMs, probeChildMs, staleMs, checkBoundMs };
}

/**
 * Whether a record re-read under the lock was written WHILE this process waited for it (G-3 of
 * 20261010-082146-reviewer-preflight-r8): dated at or after the wait began, and not after now — a future-dated record
 * passed the first test alone and skipped the re-probe the age rule had just demanded.
 */
export function writtenWhileWaiting(record, { startedAt, now }) {
  const at = Date.parse(record?.checked_at);
  return Number.isFinite(at) && at >= startedAt && at <= now;
}

/**
 * `review.reviewer_probe_max_age_hours`, read: absent → 24; `""` → no age limit (null); a positive number → it.
 * Anything else throws — a malformed key is refused where the contract is parsed, never guessed at here.
 */
export function maxAgeHoursOf(value) {
  if (value === undefined) return 24;
  if (value === '') return null;
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!(Number.isFinite(n) && n > 0)) {
    throw new Error(`review.reviewer_probe_max_age_hours must be "" or a positive number of hours, got ${JSON.stringify(value)}`);
  }
  return n;
}

/**
 * Whether a record lets a call proceed without probing (D3): it is this combination's, it PASSED, and it is no older
 * than `maxAgeHours` (null: no age limit). A failed record never counts — it is re-probed, never trusted.
 */
export function recordCounts(record, combination, { now, maxAgeHours }) {
  if (!record || record.state !== 'passed' || record.key !== probeKey(combination)) return false;
  if (maxAgeHours === null) return true;
  const at = Date.parse(record.checked_at);
  if (!Number.isFinite(at) || !Number.isFinite(now)) return false;
  // NOT FROM THE FUTURE (G-6 of 20261009-232840-reviewer-preflight-r1): a negative age counted for as long as the clock lagged.
  // STRICTLY YOUNGER (G-15 of 20261010-051458-reviewer-preflight-r4): at the limit, a record stops counting.
  return at <= now && now - at < maxAgeHours * 3_600_000;
}

/**
 * Whether a probe's envelope PASSED for its mode. Shape alone is not enough: unavailable() emits a RISK verdict, an
 * empty candidates array, or `supports: null` (scripts/external-review.mjs), and classifyPanelProbe's `reachable`
 * accepts any parseable envelope. So a pass carries no not_checked item naming the reviewer as unavailable
 * (UNAVAILABLE_ROLES), a status of `ok` where the envelope has one, and its mode's own answer.
 */
export function probePassed(mode, envelope, { participants = null } = {}) {
  if (!envelope || typeof envelope !== 'object') return false;
  const unavailable = new RegExp(`^(${UNAVAILABLE_ROLES.join('|')}) '`);
  if ((envelope.not_checked ?? []).some((n) => n && typeof n.item === 'string' && unavailable.test(n.item.trim()))) return false;
  if (envelope.status !== undefined && envelope.status !== 'ok') return false;
  // THE ANSWER IT ASKED FOR (G-12 of 20261010-055800-reviewer-preflight-r5): the review probe asks for verdict PASS, so a
  // RISK — what an unreadable or refusing answer is normalised to — is not a reviewer shown to work.
  if (mode === 'review') return envelope.verdict === 'PASS';
  // AT LEAST ONE (G-5 of 20261010-034246-reviewer-preflight-r3): an empty pool is a mark of a proposer that did not run, and
  // the probe asks for exactly one candidate.
  // EXACTLY THE ONE IT ASKED FOR (G-9 of 20261010-071234-reviewer-preflight-r7): one candidate named "probe" — any other
  // non-empty pool is a proposer that ignored or mangled the instruction.
  if (mode === 'propose') return Array.isArray(envelope.candidates) && envelope.candidates.length === 1 && envelope.candidates[0]?.name === 'probe';
  // A VOTE OUTSIDE THE POSITIONS IS ILLEGIBLE, NOT A RULING (G-7 of m0-gate-review, held by check-tiebreak until stage 4):
  // with the dispute's participants given, `supports` must name one of them, or 'neither'.
  if (mode === 'tie-break') {
    const s = typeof envelope.supports === 'string' ? envelope.supports.trim() : '';
    return s.length > 0 && (!participants || [...participants, 'neither'].includes(s));
  }
  // EXACTLY THE ONE CLAIM IT ASKED FOR (claim-check-cross-family.plan.md stage 2): the probe asks for one claim whose id is
  // "probe", so a result that dropped it, or a refused shape (result null), is not a checker shown to work.
  // EVERY VALUE IT PRESCRIBES (G-13 of 20261103-191032-dr-remediation-3-review), as the decide probe checks its: a
  // transport that corrupts the verdict, grade, citations or operator_only of the claim is not a checker shown to work.
  if (mode === 'claim-check') {
    const claims = envelope.result?.claims;
    if (!(Array.isArray(claims) && claims.length === 1)) return false;
    const c = claims[0] ?? {};
    const empty = (a) => Array.isArray(a) && a.length === 0;
    return c.id === 'probe' && c.text === 'probe' && c.kind === 'other' && c.grade === 'inferred' && c.verdict === 'stands'
      && c.operator_only === false && empty(c.citations) && c.trigger === ''
      && c.search?.looked_for === 'probe' && empty(c.search?.where) && c.search?.found === ''
      && c.counter_question?.question === 'probe' && c.counter_question?.answer === '';
  }
  // EXACTLY THE ANSWER IT ASKED FOR (autonomous-run.plan.md stage 4): entry E1, reason "probe". A seat that chose
  // otherwise, or was recorded as silence (result null), is not a seat shown to work.
  // AND THE CITATION IT ASKED FOR (G-16 of 20261101-065930-dr-delivery): a transport or mapping that drops `citations`
  // is not a seat shown to answer the whole shape.
  if (mode === 'decide') {
    const r = envelope.result;
    return r?.choice === 'E1' && r?.reason === 'probe' && r?.what_would_change === 'probe'
      && Array.isArray(r?.citations) && r.citations.length === 1 && r.citations[0] === 'probe';
  }
  return false;
}

// ---------------------------------------------------------------------------------------- what a probe sends
// The smallest task that still exercises the whole path: the reviewer must read the prompt, obey a schema instruction
// and answer in the mode's envelope (the prompts are prompts/_templates/reviewer-probe-*.md). Moved from
// check-panel.mjs and check-tiebreak.mjs, which the preflight replaces.

/** The review probe's schema: the shape run-graph consumes, with nothing to find. */
export const PROBE_REVIEW_SCHEMA = JSON.stringify({
  schema_version: 1, verdict: 'PASS|RISK|FAIL', findings: [], checked_clean: ['transport'], not_checked: [],
});

/** The propose probe's schema; with --candidate-fields it is enforced natively, without them it is prompt-and-scan. */
export const PROBE_PROPOSE_SCHEMA = JSON.stringify({ candidates: 'array', not_checked: 'array' });
export const PROBE_CANDIDATE_FIELDS = 'name';

/**
 * The tie-break probe's synthetic dispute: a lens and an arm disagree about a loop, with the excerpt in the prompt, so
 * the judge needs no tree. The arm's position is attributed to `armSource` (a real panel vendor) under `armNodeId`, so
 * the `party` path is exercised as in production. Rendered by the caller through the shared adjudicationBrief and
 * buildTieBreakPrompt — the same owners run-graph uses — never re-typed.
 */
export function probeDispute({ armSource, armNodeId }) {
  return {
    group_id: 'G-0',
    file: 'scripts/lib/example.mjs',
    line: 12,
    rationale: 'a lens and an arm disagree about whether the loop stops at the first match',
    findings: [
      { node_id: 'code-audit', source: null, severity: 'HIGH', basis: 'convention',
        claim: 'the loop returns on the first match, so later matches are never considered' },
      { node_id: armNodeId, source: armSource, severity: 'MEDIUM', basis: 'convention',
        claim: 'the loop continues after a match and the last match wins' },
    ],
    excerpt: {
      ok: true, from: 10, to: 14, of: 40,
      body: [
        '  for (const item of items) {',
        '    if (!match(item)) continue;',
        '>   return item;                 // returns immediately',
        '  }',
        '  return null;',
      ].join('\n'),
    },
  };
}

/** The not_checked subject run-graph recognises for an unavailable reviewer in each mode (UNAVAILABLE_ROLES). */
export const unavailableSubject = (mode, reviewer) => `${
  mode === 'tie-break' ? 'tie-breaker' : mode === 'propose' ? 'external proposer'
    : mode === 'claim-check' ? 'claim checker' : mode === 'decide' ? 'decision seat' : 'external reviewer'} '${reviewer}'`;

// ---------------------------------------------------------------------------------------- the checks that run it
// Two callers run `external-review --preflight-only` for many combinations — new-run at mint (stage 3) and
// check-reviewers on demand (stage 4) — and they must agree on WHICH combinations and on what a child's exit MEANS, or
// the command an operator runs to check the panel tests a different set than the mint that refuses it.

/**
 * The distinct reviewer combinations a run can call: the roster's panel arms in review mode and its adjudicators in
 * tie-break mode, with the model and effort run-graph will pass (trimmed; '' = the CLI's ambient default). Order kept,
 * duplicates dropped.
 */
export function rosterCombinations(roster) {
  const out = new Map();
  for (const [mode, list] of [['review', roster?.panel_arms], ['tie-break', roster?.adjudicators]]) {
    for (const e of list ?? []) {
      if (!e?.reviewer) continue;
      const c = { reviewer: e.reviewer, model: String(e.model ?? '').trim(), effort: String(e.effort ?? '').trim(), mode };
      out.set(JSON.stringify(c), c);
    }
  }
  return [...out.values()];
}

/**
 * THE PROPOSE COMBINATIONS check-reviewers adds (story-pipeline, 2026-10-16): each distinct reviewer, model and effort the
 * roster uses, where its adapter takes propose, on both routes. candidate-pool and request's critique call propose with
 * those reviewers, and nothing probed the mode, so a check reported "all passed" while every propose call was refused.
 * Not part of the mint's set: no graph run calls propose. `supports(reviewer)` answers whether the adapter takes propose.
 * The roster's `proposers` pins are included: they are what candidate-pool passes (G-1 of 20261018-195709-pins-review).
 */
export function proposeCombinations(roster, supports) {
  const out = new Map();
  const proposers = Object.entries(roster?.proposers ?? {})
    .filter(([name, e]) => !name.startsWith('$') && e && typeof e === 'object')
    .map(([reviewer, e]) => ({ reviewer, model: String(e.model ?? '').trim(), effort: String(e.effort ?? '').trim() }));
  for (const c of [...rosterCombinations(roster), ...proposers]) {
    if (!supports(c.reviewer)) continue;
    for (const route of ['prompt-and-scan', 'native']) {
      const p = { reviewer: c.reviewer, model: c.model, effort: c.effort, mode: 'propose', route };
      out.set(JSON.stringify(p), p);
    }
  }
  return [...out.values()];
}

/**
 * THE CLAIM CHECKER'S COMBINATION (claim-check-cross-family.plan.md stage 6): the roster's `claim_checker` pin, in
 * claim-check mode, on the native route its strict schema always takes. Not part of the mint's set, like propose: no
 * graph run calls it, and external-review probes it before its own first call. `supports(reviewer)` answers whether the
 * adapter takes the mode.
 */
export function claimCheckCombinations(roster, supports) {
  const c = roster?.claim_checker;
  if (!c || typeof c !== 'object' || !c.reviewer || !supports(c.reviewer)) return [];
  return [{ reviewer: c.reviewer, model: String(c.model ?? '').trim(), effort: String(c.effort ?? '').trim(), mode: 'claim-check', route: 'native' }];
}

/**
 * THE DECISION PANEL'S COMBINATIONS (autonomous-run.plan.md stage 4): each external seat of the roster's `decision_panel`
 * at its pin, in decide mode, on the native route its strict schema takes. Not part of the mint's set: no graph run calls
 * it, and external-review probes it before its own first call. `supports(reviewer)` answers whether the adapter takes
 * the mode.
 */
export function decideCombinations(roster, supports) {
  const seats = Array.isArray(roster?.decision_panel?.seats) ? roster.decision_panel.seats : [];
  return seats.filter((s) => s && typeof s === 'object' && s.reviewer && supports(s.reviewer))
    .map((s) => ({ reviewer: s.reviewer, model: String(s.model ?? '').trim(), effort: String(s.effort ?? '').trim(), mode: 'decide', route: 'native' }));
}

/** The `--preflight-only` argv for one combination; `extra` carries a caller's own flags (seams, --reprobe). */
export const preflightArgv = (script, c, extra = []) => [script, '--preflight-only', '--reviewer', c.reviewer,
  ...(c.model ? ['--model', c.model] : []), ...(c.effort ? ['--effort', c.effort] : []), '--mode', c.mode,
  ...(c.route === 'native' ? ['--candidate-fields', PROBE_CANDIDATE_FIELDS] : []), ...extra];

/** How a combination is named to an operator. */
export const combinationLabel = (c) => [c.reviewer, c.model || '(ambient model)', c.effort || '(ambient effort)', c.mode,
  ...(c.route ? [c.route] : [])].join('/');

/**
 * What one check child's exit means: `{ record }` for a pass, `{ failed: <reason> }` otherwise. A check that could not
 * run is not a check that passed — exit 5 is the probe's own reason, exit 2 the child's usage message, any other exit or
 * a crash is named with its exit, and a child stopped at its bound says so (with a survivor the stop could not confirm).
 * Pure: the caller ran the child and hands over what it saw.
 */
export function preflightOutcome({ status, signal = null, stdout = '', stderr = '', timedOut = false, error = null, survivor = null, boundMs }) {
  const lastLine = (s) => String(s ?? '').trim().split('\n').filter(Boolean).at(-1) ?? '';
  if (timedOut) {
    const left = survivor ? ` (and it could not be confirmed stopped: pid ${survivor.pid}, ${survivor.outcome})` : '';
    return { failed: `the check overran its bound of ${boundMs / 1000} s${left}` };
  }
  if (error && status === null) return { failed: `the check could not start: ${error.code ?? error.message}` };
  if (status === 0) {
    try {
      const rec = JSON.parse(lastLine(stdout));
      if (rec?.state === 'passed' && rec.key) return { record: rec };
    } catch { /* named below */ }
    return { failed: 'the check exited 0 without a passing record' };
  }
  if (status === 5) {
    let reason = null;
    try {
      reason = (JSON.parse(stdout).not_checked ?? []).map((n) => n?.reason).find((s) => /reviewer preflight failed/.test(s ?? ''));
    } catch { /* named below */ }
    return { failed: reason ?? `the check refused the reviewer: ${lastLine(stdout) || lastLine(stderr)}` };
  }
  if (status === 2) return { failed: `usage: ${lastLine(stderr).replace(/^external-review: /, '')}` };
  return { failed: `the check exited ${status ?? `on signal ${signal ?? '?'}`}${lastLine(stderr) ? `: ${lastLine(stderr)}` : ''}` };
}

/**
 * THE CALLS THAT FAILED AFTER THEIR COMBINATION PASSED AT MINT (stage 5, D4): the panel was shown to work before the
 * run, and part of it did not answer during it — a timeout, an unparseable answer, a refusal at call time because the
 * record aged out and the re-probe failed. Their ids, for PANEL-DEGRADED, which caps the gate at RISK.
 *
 * Only a combination the mint recorded as passed counts: a run with no record (minted before the preflight, or with the
 * panel off) or with "skipped" (--no-verify-reviewers, capped already by REVIEWERS-UNVERIFIED) was promised nothing, and
 * this rule says nothing about it. `calls`: [{ id, reviewer, model, effort, mode, ok }], model and effort '' when ambient.
 */
export function panelDegraded({ preflight, calls = [] }) {
  if (!Array.isArray(preflight)) return [];
  // THE ROUTE TOO (G-10 of 20261010-085904-reviewer-preflight-r9): it is part of a probed combination, so a failed call on
  // a route the mint never checked was never promised.
  const id = (adapter, model, effort, mode, route) => JSON.stringify([adapter, String(model ?? '').trim(), String(effort ?? '').trim(), mode, route ?? null]);
  const passed = new Set(preflight.filter((e) => e?.state === 'passed').map((e) => id(e.adapter, e.model, e.effort, e.mode, e.route)));
  return calls.filter((c) => !c.ok && passed.has(id(c.reviewer, c.model, c.effort, c.mode, c.route))).map((c) => c.id);
}

/**
 * The status files that could not be read and still degrade the panel (G-18 of 20261029-201447-rdr-remediation-review).
 * An unreadable status cannot show its call answered, but it degrades only a panel the mint promised (a combination
 * passed its preflight, as panelDegraded requires), and only when it is a panel node's: an unreadable lens, reconcile or
 * second-opinion status is that node's problem, not the panel's. `unread` is [{ node, label }], node null when the
 * listing itself failed; `panel(id)` says whether a node is an arm or a judge. A POSITIVE test (G-14 of
 * 20261029-224143-rdr-remediation-3-review): a negative list built from the lens rows counted every node it did not
 * name, reconcile and second-opinion among them, as the panel's. Returns the labels that count.
 */
export function panelUnread({ preflight, unread = [], panel }) {
  if (!Array.isArray(preflight) || !preflight.some((e) => e?.state === 'passed')) return [];
  if (typeof panel !== 'function') throw new TypeError('panelUnread: panel(id) is required');
  return unread.filter((u) => !u.node || panel(u.node)).map((u) => u.label);
}

/**
 * The reason an arm or judge was refused by its preflight, or null (G-11 of 20261009-232840-reviewer-preflight-r1). A
 * refusal's reason is the engine's own sentence, `reviewer preflight failed for <combination>: <why>`, and the plan
 * requires the node's status to carry it; any other unavailability keeps pointing at the gitignored failure detail,
 * where a vendor's stderr belongs.
 */
export function preflightRefusal(reason) {
  const r = typeof reason === 'string' ? reason.trim() : '';
  return r.startsWith('reviewer preflight failed for ') ? r : null;
}

/**
 * The state an arm whose reviewer did not answer is recorded in (G-5 of 20261115-045745-pbr-1b-remediation-5-review;
 * ARCHITECTURE.md A-30: a refused required input is recorded BLOCKED). external-review says a refused prompt-file read
 * as `prompt file refused: <why>` and an absent one as `prompt file not found: <path>`; the prompt is the arm's required
 * input, so that arm is BLOCKED; any other
 * unreachable, unavailable or malformed answer stays DEGRADED, a panel that lost one opinion.
 */
export function armUnreachableState(probe) {
  const r = typeof probe?.reason === 'string' ? probe.reason.trim() : '';
  // An absent prompt file is a refusal's class too (G-23 of 20261117-013640-m2-9a-final; A-30).
  const promptRefused = r.startsWith('prompt file refused: ') || r.startsWith('prompt file not found: ');
  return probe?.state === 'unavailable' && promptRefused ? 'BLOCKED' : 'DEGRADED';
}

/**
 * Whether a panel arm's or judge's status records a reviewer that did NOT answer (G-18 of
 * 20261010-051458-reviewer-preflight-r4) — the only kind of call PANEL-DEGRADED counts. An arm SKIPPED before launch,
 * or one whose reviewer answered but had its findings rejected on scope, is not a failed call. Every launched arm and
 * judge records `reviewer_answered`; a status written before that field existed — or none at all, a crashed worker's synthesized BLOCKED — falls back to "not SKIPPED, not OK, and
 * not the scope rejection".
 */
export function panelCallFailed(status) {
  if (!status || typeof status !== 'object') return false;
  if (typeof status.reviewer_answered === 'boolean') return !status.reviewer_answered;
  // ONLY A SKIPPED ARM was deliberately never launched (G-17 of 20261010-055800-reviewer-preflight-r5): an arm whose
  // worker threw before writing its status reads back as a synthesized BLOCKED with no `launched`, and is a reviewer
  // that did not answer.
  if (status.state === 'SKIPPED' || status.state === 'OK') return false;
  return !(status.validator_errors ?? []).some((e) => /rejected on scope/.test(String(e)));
}

/**
 * The schema route a call in `mode` takes — 'native' when its schema is one the vendor can enforce, else
 * 'prompt-and-scan' (G-10 of 20261010-085904-reviewer-preflight-r9). ONE owner, because the route is part of a probed
 * combination: the probe keys its record by it, and PANEL-DEGRADED must match a failed call against it.
 */
export function schemaRoute(mode, { participants = null, candidateFields = null } = {}) {
  const schema = mode === 'propose' ? proposeSchema(candidateFields)
    : mode === 'tie-break' ? tieBreakSchema({ participants })
      : mode === 'claim-check' ? claimCheckSchema()
        : mode === 'decide' ? decideSchema()
          : reviewSchema();
  return schema && !validateStrict(schema).length ? 'native' : 'prompt-and-scan';
}
