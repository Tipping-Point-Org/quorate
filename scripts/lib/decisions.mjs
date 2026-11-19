// decisions.mjs — the orchestration's pure decisions, extracted so they can be tested.
//
// Every function here was previously inline in spawn-node.mjs or run-graph.mjs, tangled with
// subprocess spawning and run-directory reads, and every one of them shipped a defect that a
// four-line test would have caught:
//
//   clampSeverity   silently disabled itself on a value it did not recognise, so every degraded
//                   lens ran uncapped while every artifact said otherwise.
//   classifyResult  checked for a payload before checking for a prose node, so the graph's one
//                   prose node could never report OK.
//   nodeSpend       read `launched: false` off a stub written for a node that HAD launched, so an
//                   interrupted run was charged $0 for work already billed.
//
// They are pure on purpose: no I/O, no environment, no clock. That is what makes them testable,
// and being testable is what makes the regression suite in ../tests possible.

import { contractNumber } from './check-timeout.mjs';
import { toolList } from './tool-lists.mjs';
import { runtimePromptVia, reviewerPromptVia } from './reviewers.mjs';
import { runtimeLaunch } from './argv-specs.mjs';

export const SEVERITY_RUNGS = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKER'];
export const VERDICTS = ['PASS', 'RISK', 'FAIL'];

/**
 * The contract command keys a NODE may execute through capture.mjs, and that new-run grants in the
 * node policy. One owner, because they must be the same set (G-7, arch-review).
 *
 * It was a byte-identical nine-element literal in two modules that never communicate: capture.mjs,
 * which decides what a node may run through the sanctioned evidence channel, and new-run.mjs, which
 * writes the allow rule for each declared command. Adding a tenth key and updating only one leaves
 * the command granted by the policy and refused by capture — which surfaces as the project's own
 * check appearing broken rather than as a missing allow-list entry, a misattribution this engine has
 * already paid for once.
 *
 * `run` is deliberately ABSENT. It launches the product, feature-verify is the only node that may,
 * and it does so through its own declared route rather than this one.
 */
export const EXECUTABLE_COMMAND_KEYS = Object.freeze([
  'build', 'test', 'test_product', 'lint', 'fmt_check', 'typecheck', 'bench', 'audit', 'deny',
]);

/**
 * Clamp one finding's severity into the band a degraded lens is allowed to claim.
 *
 * Unrecognised floor/ceiling values THROW rather than being skipped. The original guarded with
 * `RUNGS.includes(ceiling)` and fell through when it failed — which is exactly what happened on
 * every degraded lens, because a VERDICT ('RISK') was being passed to this SEVERITY parameter.
 * A cap that quietly does nothing when misconfigured is worse than no cap: it produces the
 * paperwork of a guarantee without the guarantee.
 */
export function clampSeverity(severity, { floor = null, ceiling = null } = {}) {
  if (floor !== null && !SEVERITY_RUNGS.includes(floor)) {
    throw new Error(`severity floor must be one of ${SEVERITY_RUNGS.join('|')}, got ${JSON.stringify(floor)}`);
  }
  if (ceiling !== null && !SEVERITY_RUNGS.includes(ceiling)) {
    throw new Error(
      `severity ceiling must be one of ${SEVERITY_RUNGS.join('|')}, got ${JSON.stringify(ceiling)}` +
      ` — a verdict like RISK is not a severity`,
    );
  }
  // An unknown severity floors to LOW rather than throwing: it arrives from a model, and the
  // schema already constrains it. Configuration is ours and fails loudly; model output is theirs
  // and degrades safely.
  let i = SEVERITY_RUNGS.indexOf(severity);
  if (i < 0) i = 0;
  if (floor !== null) i = Math.max(i, SEVERITY_RUNGS.indexOf(floor));
  if (ceiling !== null) i = Math.min(i, SEVERITY_RUNGS.indexOf(ceiling));
  return SEVERITY_RUNGS[Math.max(0, i)];
}

/**
 * Cap a node's verdict. Separate from severity: a severity is how bad ONE finding is, a verdict is
 * what the node concludes overall. Sharing one parameter is what let the severity clamp die
 * unnoticed.
 */
export function capVerdict(verdict, ceiling = null) {
  if (ceiling === null) return verdict;
  if (!VERDICTS.includes(ceiling)) {
    throw new Error(`verdict ceiling must be one of ${VERDICTS.join('|')}, got ${JSON.stringify(ceiling)}`);
  }
  const rank = (v) => (VERDICTS.includes(v) ? VERDICTS.indexOf(v) : 0);
  return rank(verdict) > rank(ceiling) ? ceiling : verdict;
}

/**
 * Which handling a finished node's result gets.
 *
 * ORDER IS THE CONTRACT. `prose` must be decided before `no-payload`, because a prose node has no
 * structured output BY DEFINITION — that is what schemaVariant 'none' means. Testing for a payload
 * first marked every prose node DEGRADED before reaching the branch written to handle it, and
 * second-opinion (the graph's only prose node) had therefore never once reported OK.
 */
export function classifyResult({ schemaVariant, isError = false, hasPayload = false, resultText = '' }) {
  if (isError) return { branch: 'error', state: 'DEGRADED', reason: 'envelope reports an error' };

  if (schemaVariant === 'none') {
    return resultText.trim()
      ? { branch: 'prose', state: 'OK', reason: null }
      : { branch: 'prose-empty', state: 'DEGRADED', reason: 'prose node returned an empty result' };
  }

  if (!hasPayload) {
    return {
      branch: 'no-payload',
      state: 'DEGRADED',
      reason: 'no structured_output in the envelope and result was not JSON',
    };
  }
  return { branch: 'schema', state: 'OK', reason: null };
}

/**
 * What one node contributes to the run's spend.
 *
 * A real reported cost always wins. Absent one, the node is charged the cap it was given IF it
 * launched — and `launched` is read as an explicit fact, never inferred from a timestamp, because
 * stubs carry timestamps too. Inferring it charged the cap to SKIPPED nodes that cost nothing
 * ($24.02 reported against $19.33 spent); the opposite error, treating a killed node as unlaunched,
 * charged $0 for work already billed.
 */
/**
 * A budget tier is UNCAPPED when its contract value is "" / "none" / null: the operator has
 * deliberately removed the dollar ceiling (the caps were never asked for). This is distinct from
 * the value being ABSENT (undefined), which keeps the conservative built-in default so a consumer
 * who copies the template stays bounded until they choose otherwise.
 */
export const isUncappedBudget = (v) => v === '' || v === 'none' || v === null;

/**
 * Resolve a budget tier to a number of dollars, or Infinity when uncapped. `dflt` is used only for
 * an absent (undefined) key. Infinity flows through every `spent >= cap` guard correctly (nothing
 * is ever >= Infinity) and is the signal the child-spawn uses to omit --budget-usd entirely.
 */
export function budgetOf(v, dflt) {
  if (v === undefined) return dflt;
  if (isUncappedBudget(v)) return Infinity;
  // A budget is a number or a numeric string and nothing else. Without this, Number([]) === 0
  // quietly admits an array as a $0 ceiling — coercion is exactly the class of leniency that
  // produced this defect in the first place.
  // A string is digits (G-9 of 20261030-124823-ciss-stage7): Number('  ') is 0, a $0 ceiling. contractNumber owns that
  // grammar and reads anything else as NaN, refused below.
  const n = contractNumber(v);
  // FAIL CLOSED on anything else. Falling through to Number(v) made a plausible contract typo
  // ("$4.00", "4 USD") yield NaN, and every consumer tests Number.isFinite — which cannot separate
  // NaN from the deliberate Infinity sentinel. The run therefore went FULLY UNCAPPED (spawn-node
  // got 'none', the `spent >= BUDGET_RUN` guard was dead because nothing compares >= NaN) while
  // new-run's stamp predicate did not recognise NaN and wrote no UNCAPPED-BUDGET stamp: an
  // unbounded run stamped as bounded, which is the one state this design exists to make
  // impossible (G-21, caught by the verify run that distrusted the fix). A typo is not consent to
  // spend without limit — refusing is the only safe reading.
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(
      `budget must be a non-negative number, "" or "none" for uncapped, or absent for the default — got ${JSON.stringify(v)}`,
    );
  }
  return n;
}

/**
 * The reconciler is the barrier, and it lives in roster.barrier_nodes, not roster.lenses — so it is
 * never in requiredNodes and the required-node check can never catch its silence. It is SILENT when
 * there were findings to adjudicate (groupCount > 0) and the skill is installed, yet it did not
 * report OK: a timeout, a blown budget, or unparseable output leaves its groups unadjudicated (on a
 * batched barrier, those from the failed batch onward; earlier batches' rulings are kept). The
 * gate must go BLOCKED then, not compute up to PASS from lens verdicts alone (G-51). No findings to
 * adjudicate (groupCount 0) is a legitimate SKIP, not silence.
 */
/**
 * Is this expected-row a node the LENS fan-out should spawn?
 *
 * Panel-arm rows live in `expected` because it is the run's pre-commitment record — "which nodes
 * were SUPPOSED to run" — but they are NOT lens nodes: they carry skill: null and are spawned by
 * spawnPanelArm, not spawn-node. Filtering on `present` alone put every arm into the fan-out, where
 * spawn-node died instantly with "one of --prompt or --skill-command is required": wasted spawns,
 * wasted concurrency slots, a brief written per arm that nothing reads, and an inflated lens count
 * (12 reported for 6 lenses). Harmless only while the panel ran strictly after the fan-out; once
 * the two overlap, the bogus spawn races the real arm spawn on the same node_id.
 */
/**
 * The kinds a node row or status can carry, OWNED HERE (G-9).
 *
 * `kind: 'tiebreak'` was renamed to 'adjudication' at every WRITE site in run-graph, and two readers
 * kept the old string: findings-ledger excluded `kind !== 'tiebreak'`, so an adjudicator's OK status
 * counted as a lens that had examined the code — and `okNodes` is what lets a remediation claim be
 * closed by the silence of the lens that raised it. A judge ruling on one dispute became evidence
 * that the code was reviewed.
 *
 * Both readers were blacklists, which is the shape that fails when a kind is ADDED: every blacklist
 * silently admits it. They are derived from the two lists below instead, and `kindsAreClassified`
 * refuses a kind that neither list mentions, so adding one is a decision rather than a default.
 *
 * Expected ROWS always carry a kind. STATUS files do not: a lens status has no `kind` field at all,
 * which is why both predicates must treat an absent kind as the ordinary reviewing node it is, and
 * why neither can be turned into a whitelist without rewriting every status writer first.
 */
export const NODE_KIND = Object.freeze({ lens: 'lens', arm: 'panel-arm', adjudication: 'adjudication' });

/** Kinds the LENS fan-out must not spawn: an arm is spawned by spawnPanelArm, a judge by the panel. */
export const NON_FAN_OUT_KINDS = Object.freeze([NODE_KIND.arm, NODE_KIND.adjudication]);

/** Kinds whose OK status is NOT evidence that anything examined the code under review. */
export const NON_REVIEW_KINDS = Object.freeze([NODE_KIND.adjudication]);

/** Every declared kind appears in each classification decision, as a member or deliberately not. */
export function kindsAreClassified() {
  const known = Object.values(NODE_KIND);
  return {
    fan_out: known.filter((k) => !NON_FAN_OUT_KINDS.includes(k)),
    reviews: known.filter((k) => !NON_REVIEW_KINDS.includes(k)),
    unknown: [...NON_FAN_OUT_KINDS, ...NON_REVIEW_KINDS].filter((k) => !known.includes(k)),
  };
}

/**
 * WHO PAYS FOR THIS NODE — declared once, derived everywhere (the BLOCKER, seen 3 times).
 *
 * `nodeSpend` charges an unknown-cost launched node the FULL node cap unless its status says
 * `auth_mode: 'external-vendor'`. That string was typed by hand at seven call sites in run-graph and
 * one in spawn-node, derived from nothing — so the next arm or judge type added without it is charged
 * the cap for money this account never spends. Six arms and two judges at the template's $4 node cap is
 * $32 against its $32 run ceiling, which would stop the guard launching REAL lenses to protect phantom
 * spend. It stayed open through three sightings, which is what a fact with seven owners does.
 *
 * This is G-9's cure applied to billing: the node-kind vocabulary had the same shape of defect, and the
 * fix was one owner plus a completeness check that REFUSES an unclassified kind rather than defaulting
 * it. Defaulting is what makes a new kind silently wrong.
 *
 * Billing is declared as its own list rather than reused from `NON_FAN_OUT_KINDS`, which happens to
 * hold the same two kinds today. "Not spawned by the fan-out" and "billed to someone else" are
 * different facts that coincide; coupling them would make the next non-fan-out, locally-billed kind
 * wrong for a reason nobody could see.
 */
export const AUTH_MODES = Object.freeze(['subscription', 'inherit', 'external-vendor']);

/** Kinds whose work is billed to the vendor's own account, so this run's ceiling must not charge them. */
export const EXTERNALLY_BILLED_KINDS = Object.freeze([NODE_KIND.arm, NODE_KIND.adjudication]);

/**
 * The auth mode for a node of this kind. An ABSENT kind is an ordinary node: a lens status carries no
 * `kind` field at all, which is why this must not throw on undefined.
 */
export function authModeFor(kind) {
  return EXTERNALLY_BILLED_KINDS.includes(kind) ? 'external-vendor' : 'subscription';
}

/** Every declared kind appears in exactly one billing list, or the gap is named. */
export function authModesAreClassified() {
  const known = Object.values(NODE_KIND);
  return {
    externally_billed: known.filter((k) => EXTERNALLY_BILLED_KINDS.includes(k)),
    locally_billed: known.filter((k) => !EXTERNALLY_BILLED_KINDS.includes(k)),
    unknown: EXTERNALLY_BILLED_KINDS.filter((k) => !known.includes(k)),
  };
}

export const isFanOutNode = (e) => Boolean(e?.present) && !NON_FAN_OUT_KINDS.includes(e?.kind);

/**
 * Did this status come from a node that actually looked at the code? The ledger's question, asked
 * one level away from the string.
 */
export const statusIsReview = (st) => st?.mode !== 'intent' && !NON_REVIEW_KINDS.includes(st?.kind);

export function reconcileSilent({ groupCount, reconcileInstalled, reconcileState }) {
  return groupCount > 0 && Boolean(reconcileInstalled) && reconcileState !== 'OK';
}

/**
 * Which entries of the did-not-report bucket block the gate (G-16 of 20260930-011534-m0-gate-review-r2). The gate read
 * each required node's STATUS FILE and never this bucket, so a required lens whose status said OK but whose
 * verdict.kept.json was missing or refused was listed as silent and still let the gate compute PASS.
 *
 * Blocking: a REQUIRED row of `expected`, and a node with no row at all — an aux node (reconcile, intent-capture,
 * second-opinion, intent.md), which a branch pushes here only after deciding its silence blocks. Not blocking: a
 * non-required row — an external arm, an adjudicator, or a lens the roster does not require in this run — whose
 * silence never blocked (the status check reads required rows only); an arm's unavailability is recorded rather than
 * fatal by design (shared/external-reviewers.md). A bucket that is not a list is refused: absent is not empty.
 */
export function blockingSilence({ didNotReport, expected = [] }) {
  if (!Array.isArray(didNotReport)) throw new Error('blockingSilence: did_not_report is not a list — absent is not empty');
  const rows = new Map((expected ?? []).map((e) => [e.node_id, e]));
  const ids = didNotReport.map((b) => b?.node_id).filter((id) => {
    const row = rows.get(id);
    return !row || row.required === true;
  });
  return [...new Set(ids)];
}

/**
 * The adjudication floor the reconciler's payload sets, or why it cannot be read (G-15 of the same review). A catch
 * returned PASS, so a corrupt payload — or none, from a reconciler that reported OK — dropped every upgrade the
 * adjudication made: the under-reporting direction, which is the one this system refuses to lose silently.
 *
 * Nothing to adjudicate, or a reconciler that did not report OK (reconcileSilent's case, blocked there), reads no
 * payload and floors at PASS. Otherwise `payloadText` null (absent or unreadable), unparseable, or without a `groups`
 * list is `{ refused }`, and the caller records the reconciler as not having reported.
 */
export function adjudicationFloor({ groupCount, reconcileState, payloadText, payloadRefused = null }) {
  if (!(groupCount > 0) || reconcileState !== 'OK') return { floor: 'PASS' };
  // A read the run's owner REFUSED is named as refused (G-16 of 20261029-235315-rdr-remediation-4-review), not as absent.
  if (payloadRefused) return { refused: `reconcile reported OK but its payload.json was refused: ${payloadRefused}` };
  if (payloadText == null) return { refused: 'reconcile reported OK but its payload.json is absent or unreadable' };
  let parsed;
  try { parsed = JSON.parse(payloadText); } catch (err) {
    return { refused: `reconcile payload.json will not parse (${String(err.message).split('\n')[0]})` };
  }
  if (!Array.isArray(parsed?.groups)) return { refused: 'reconcile payload.json carries no groups list' };
  // A DROPPED group carries no weight — the reconciler's one authority here, exercised by omission.
  return { floor: verdictFloorFromFindings(parsed.groups.filter((g) => g?.decision !== 'dropped')) };
}

/** How far, in lines, a finding may sit from its group's anchor in the same file to join that group. */
export const PROXIMITY_LINES = 3;

/**
 * Group findings by PROXIMITY (G-7 of 20261115-002137-pbr-remediation-2-review: moved here from run-graph's module scope,
 * so the rule is tested without loading the orchestrator). Sorted first by file, line, then node id, so the same inputs
 * group the same way on a re-run whatever order they arrived in. A finding joins the last group made in its file when it
 * is within PROXIMITY_LINES of that group's anchor (its first finding), and otherwise anchors a new group. Only a file's
 * last group can be in reach (G-7 of 20261114-235051-pbr-remediation-review): each line is at or past every anchor in its
 * file, and each anchor is more than PROXIMITY_LINES past the one before. A missing or non-numeric line is line 0.
 * Returns groups as { group_id, file, line, findings, nodes (a Set of node ids) }, numbered G-1 onward in sorted order.
 */
export function groupFindings(findings) {
  const sorted = [...findings].sort(
    (a, b) =>
      String(a.file).localeCompare(String(b.file)) ||
      (Number(a.line) || 0) - (Number(b.line) || 0) ||
      String(a.node_id).localeCompare(String(b.node_id)),
  );
  const groups = [];
  const lastGroupInFile = new Map();
  for (const f of sorted) {
    const line = Number(f.line) || 0;
    const last = lastGroupInFile.get(f.file);
    const g = last && Math.abs(last.line - line) <= PROXIMITY_LINES ? last : null;
    if (g) { g.findings.push(f); g.nodes.add(f.node_id); }
    else {
      const made = { group_id: `G-${groups.length + 1}`, file: f.file, line, findings: [f], nodes: new Set([f.node_id]) };
      groups.push(made);
      lastGroupInFile.set(f.file, made);
    }
  }
  return groups;
}

/**
 * Project a grouped finding into the shape finding-groups.json carries — the reconciler's ONLY
 * findings input. source and model MUST survive: they are set on arm findings (run-graph) and on
 * lens findings (spawn-node) precisely so reconcile can weigh cross-family agreement above two
 * same-family lenses. A field-by-field rebuild in the mapper dropped both, leaving cross-family
 * weighting to survive only on an undeclared node-id prefix (G-43/G-32).
 */
export function projectGroupFinding(f) {
  return {
    node_id: f.node_id, severity: f.severity, basis: f.basis, invariant: f.invariant ?? '',
    intent_ref: f.intent_ref ?? '', claim: f.claim, evidence_path: f.evidence_path,
    source: f.source ?? null, model: f.model ?? null,
  };
}

/**
 * A REPORTED COST THE RUN MAY ADD UP, or null when it is unusable: missing, not a number, infinite, or negative
 * (G-2 of 20261007-050929-consumer-use-r4 — a negative cost was trusted, and two places decided this). nodeSpend and
 * the batched barrier's charge (lib/reconcile-batches.mjs batchCharge) both ask here.
 */
export function usableCost(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * WHETHER THE RUN CAN AFFORD WHAT IS ABOUT TO LAUNCH, owned here for every launch (G-9 of consumer-use-r4): the fan-out
 * reserves a node cap, a reconcile the barrier cap, the --reconcile-twice calibration the barrier cap on top of it.
 * Admitted when `spent + reserve` stays within `budgetRun`; an uncapped reserve has no size, so only `spent` is compared
 * (that tier is stamped UNCAPPED-BUDGET). Returns null when admitted, otherwise the reason, for the gate.
 */
export function admitSpend({ spent, reserve, budgetRun, what = 'another node' }) {
  const r = Number.isFinite(reserve) ? reserve : 0;
  if (spent + r <= budgetRun) return null;
  return r
    ? `run budget cannot cover ${what}: $${spent.toFixed(2)} spent + $${r} reserved > $${budgetRun}`
    : `run budget exhausted before launch: $${spent.toFixed(2)} >= $${budgetRun}`;
}

export function nodeSpend(status, { budgetNode, budgetBarrier }) {
  const usable = usableCost(status?.total_cost_usd);
  if (usable !== null) return usable;
  if (status?.launched === false) return 0;
  // An EXTERNAL ARM costs this account nothing: it authenticates as the operator to a third-party
  // CLI and is billed there. Its status carries total_cost_usd: null, meaning "not knowable here"
  // rather than "free" — but the fallback below charges an unknown-cost node the full node cap, so
  // without this branch every arm would be billed against the run budget on a project that has
  // finite ceilings, six times a run, for money this account never spends. What IS knowable is on
  // the status as `usage`, in the tokens the operator's quota actually counts.
  if (status?.auth_mode === 'external-vendor') return 0;
  // The barrier is identified by MODE, matching the key run-graph uses to grant the barrier
  // budget at launch — with the node-id literal kept for statuses written before mode existed.
  // The two keys disagreed once: reconcile-b launched under the $7 barrier cap (mode) and was
  // accounted at the $4 node cap (id), so a killed calibration run under-counted the run's spend
  // by the difference and the run-budget guard authorised more than the contract had (G-15).
  const isBarrier = status?.mode === 'reconcile' || status?.node_id === 'reconcile';
  const cap = isBarrier ? budgetBarrier : budgetNode;
  // Uncapped run: there is no cap to charge an unknown-cost node against, and returning Infinity
  // would poison spentSoFar and the run's reported total. Charge 0 — the unknown-cost gap is
  // already visible in the node's own status.
  return Number.isFinite(cap) ? cap : 0;
}

/**
 * AN UNREADABLE STATUS IS AN UNKNOWN CHARGE, NOT NONE (G-3 of 20261023-231847-rmg-remediation-review): it could be any
 * node's, so it is charged the larger FINITE cap it could have spent under. Taking the larger cap before testing it
 * charged $0 whenever one tier was uncapped, though the other was finite. Both uncapped charges 0, as nodeSpend does.
 */
export function unreadableStatusCharge({ budgetNode, budgetBarrier }) {
  const finite = [budgetNode, budgetBarrier].filter((c) => Number.isFinite(c));
  return finite.length ? Math.max(...finite) : 0;
}

/**
 * The basis a lens may cite. There is no fallback, deliberately.
 *
 * A per-lens default table used to live in spawn-node.mjs, duplicating lens-roster.json — and it
 * did not merely go stale, it REVERSED a deliberate degradation, handing `architecture_doc` back
 * to a lens degraded specifically to lose it. The trailing default was worse: it granted
 * `invariant`, the only basis that can raise a non-waivable finding, to any node whose
 * configuration failed to arrive.
 */
export function resolveAllowedBasis(nodeId, override) {
  const list = Array.isArray(override)
    ? override
    : typeof override === 'string'
      ? override.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  if (!list.length) {
    throw new Error(
      `--allowed-basis is required for lens node '${nodeId}'. It is resolved from lens-roster.json ` +
      `by run-graph.mjs and written to nodes/expected.json; there is no fallback table here on purpose.`,
    );
  }
  return list;
}

// ---------------------------------------------------------------------------- inline-argv budget
//
// A reviewer whose adapter declares `prompt.via: argv` takes its prompt inline in argv; the shipped
// codex and agy adapters read theirs from stdin (agy as one stream-json line since
// decision-panel-seats.plan.md stage 3), which has no size limit. Windows CreateProcess accepts roughly 32767 characters for the
// whole command line, and a prompt past that either fails to spawn or arrives TRUNCATED — the
// reviewer then answers a question nobody asked, confidently, and the reconciler counts it as an
// arm that reported. That is the false corroboration the panel exists to prevent, so the size is
// a decision made before the spawn rather than a surprise during it.
//
// The budget sits below the platform limit on purpose: Windows counts the executable path, the
// other flags and the environment block alongside argv, and the true ceiling therefore is not the
// prompt's length alone.
export const INLINE_ARGV_BUDGET = 30_000;

export function fitsInlineArgv(text, budget = INLINE_ARGV_BUDGET) {
  // UTF-8 BYTES, while the Windows CreateProcess limit is ~32767 UTF-16 CHARACTERS (G-12). The
  // units differ, but the error is deliberately fail-SAFE: bytes over-count non-ASCII, so a
  // borderline prompt is refused early (and named in not_checked[]) rather than truncated and
  // sent — truncation is the outcome the budget exists to prevent. A false refusal needs ~30 KB
  // of heavily non-ASCII prompt; the 30 000 budget below the 32767 ceiling absorbs the rest.
  return Buffer.byteLength(text ?? '', 'utf8') <= budget;
}

// ---------------------------------------------------------------------------- panel probe result
//
// A live probe of an external arm has three outcomes, and collapsing any two of them hides the
// failure this repository cares most about. `external-review.mjs` always prints an envelope, and
// exits 0 or — for a reviewer that failed its preflight — 5 (reviewer-preflight stage 2), so exit
// status does not separate a reviewer that ran from one that did not; the envelope's shape is the signal.
//
//   'reachable'   the arm answered and its answer round-tripped as an envelope.
//   'unavailable' the arm did not run — missing from PATH, timed out, refused for size. The reason
//                 is already in not_checked[], and the run would have carried it.
//   'malformed'   an envelope came back that this repo's own contract cannot accept (wrong
//                 source, missing schema_version, unparseable stdout). This is OUR bug, not the
//                 reviewer's, and it is the class the offline suite structurally cannot see.
//
// The distinction matters because 'unavailable' is a fact about the operator's machine while
// 'malformed' is a fact about the shipped transport. Reporting both as "failed" would let a
// transport regression hide behind an uninstalled CLI.
/**
 * The exact `not_checked[].item` shapes `external-review.mjs` writes when a reviewer did not answer.
 *
 * ONE list, read by the emitters and by the classifier below. They were separate: the emitters wrote
 * `external reviewer '<n>'`, `external proposer '<n>'` and — once tie-break mode existed —
 * `tie-breaker '<n>'`, while the classifier matched only the first two.
 */
export const UNAVAILABLE_ROLES = ['external reviewer', 'external proposer', 'tie-breaker', 'claim checker', 'decision seat'];

/**
 * Why a reviewer CLI failed, in a form that may be COMMITTED (G-43, HIGH, two families).
 *
 * external-review built `exited N with no output: <400 bytes of stderr>` and put it in the envelope's
 * not_checked[].reason. classifyPanelProbe passed it on, run-graph stored it on the vote,
 * adjudication copied it into absent[].why, and it landed in nodes/adjudication.json, gate.json,
 * gate.md and reconciled.md — all four TRACKED. The engine already states the rule that breaks, in
 * run-graph's own comment: "a vendor's stderr can carry a credential and this file is tracked". The
 * status-file path had been fixed to a scrubbed message plus a pointer; every other path had not.
 *
 * The excerpt was never needed. external-review writes stdout AND the complete stderr to
 * `evidence/<node>/raw.log`, which `.claude/reviews/.gitignore` excludes by an evidence glob. So the
 * full text was already on the gitignored side and the tracked copy duplicated the one thing that
 * must not be duplicated there.
 *
 * Pure, and here rather than in external-review, so the rule has ONE owner and can be tested without
 * a vendor: give it a stderr containing a credential and assert the output does not.
 */
/**
 * Did the declared suite RUN, or merely fail to start?
 *
 * These were one case and the conflation forced a verdict. `run-checks` stamped TESTS-FAILING on any
 * non-zero exit and `run-graph` forces `gate = FAIL` on that stamp, outranking every lens — so the
 * first real consumer run reported "your code is broken" because a package was not installed:
 *
 *   ModuleNotFoundError: No module named 'storypipe'
 *   Interrupted: 224 errors during collection          (pytest exit 2, ZERO tests executed)
 *
 * Sixteen nodes were then told "The declared suite RAN AND FAILED ... report anything the failures
 * conceal", when there were no failures to conceal.
 *
 * THE EVIDENCE WAS ALREADY COLLECTED AND NOT COMBINED. The same checks.json recorded `exit_code: 2`
 * AND `tests_reported: null`, and the run carried both TESTS-FAILING and TESTS-UNCOUNTED side by side.
 * A suite that ran and failed REPORTS A COUNT; one that could not be collected reports none. That
 * pairing is what this function reads, and it deliberately needs no knowledge of any runner's exit
 * vocabulary — the runner is contract-declared and could be anything, so pytest's "2 means collection
 * error" is exactly the kind of fact this engine must not encode.
 *
 * The two outcomes belong in different places:
 *   ran and failed -> deterministic, reproducible, uncorrelated with any model's judgment. FORCES the gate.
 *   did not run    -> nothing was learned. Caps and is named in not_checked[], like UNTESTED.
 *
 * A ZERO exit is never "did not run", however uncountable: TESTS-UNCOUNTED already covers a suite that
 * passed while printing in a format nobody parses.
 */
export function classifySuiteOutcome({ exitCode, testsReported, testsFailing = null, timedOut = false, outcome } = {}) {
  // A SUITE THAT DID NOT FINISH IS FAILING ONLY ON A FAILING COUNT (G-3 of 20261018-035437-co-delivery). `testsReported`
  // is lib/test-count's TOTAL, and reading it here stamped a suite that printed only passing tests, then was stopped,
  // TESTS-FAILING and forced the gate. `testsFailing` is countFailures over the same log; null (not given, or no format
  // recognised) is unknown, which falls through to the unfinished stamps below rather than asserting a failure.
  const printedFailures = Number.isFinite(testsFailing) && testsFailing > 0;
  // THE CAPTURE'S OUTCOME, WHEN GIVEN (check-outcomes.plan.md stage 3): lib/capture-header's checkOutcome, which separates
  // what exit 124 alone could not. Without one, every rule below applies to the exit code as before, which keeps the
  // callers that pass none (and their pinned tests) meaning what they meant.
  if (outcome && outcome !== 'failed') {
    // G-48 ranks a printed failing count first for every way a suite can end: one that printed failures and was then
    // stopped, timed out or overflowed still failed, and so did one that exited 0 (G-25 of 20261020-094311-ciss-delivery).
    if (printedFailures) return { ran: true, stamp: 'TESTS-FAILING', forcesGate: true };
    if (outcome === 'passed') return { ran: true, stamp: null, forcesGate: false };
    if (outcome === 'timed-out') return { ran: null, stamp: 'TESTS-TIMED-OUT', forcesGate: false };
    // It started and did not finish (a signal, an overflow): whether it passed is unknown.
    if (outcome === 'incomplete') return { ran: null, stamp: 'TESTS-OUTCOME-UNKNOWN', forcesGate: false };
    // could-not-start: the runner never started, which TESTS-DID-NOT-RUN's consequence already says.
    return { ran: false, stamp: 'TESTS-DID-NOT-RUN', forcesGate: false };
  }
  const ok = outcome === 'failed' ? false : Number(exitCode) === 0;  // outcome-ok: no outcome given, the exit as before
  if (ok && !printedFailures) return { ran: true, stamp: null, forcesGate: false };

  // THREE CASES BEHIND A NON-ZERO EXIT, NOT TWO (G-32). This lumped `null` in with `0` and called
  // both "the runner never started". But `countTests` returns null for every format it does not
  // RECOGNISE — it knows cargo, node:test and pytest — so a red jest, vitest, mocha or go suite was
  // classified as one that never ran and lost the forced FAIL, which is the single verdict the gate
  // says outranks every lens. countTests states the rule this broke in its own docstring: "Unknown
  // must mean unknown"; this function was the caller turning that unknown into an assertion.
  //
  // The discriminator still needs no runner vocabulary, which is the property that must not be
  // traded away to fix this: a COUNT is evidence it ran, an explicit ZERO is evidence it did not,
  // and NULL is the absence of evidence either way. Only the third case is new.
  // A printed failing count is TESTS-FAILING whatever the outcome, total or none (G-2 of 20261018-041929-co-remediation-review;
  // operator, 2026-10-18: "Failing count only (Recommended)"). A suite the engine killed reads only that count (G-3), so a
  // timed-out legacy call with a total and no failing count is TESTS-TIMED-OUT; one that ended on its own with a total did
  // run and fail.
  if (printedFailures || (!timedOut && Number.isFinite(testsReported) && testsReported > 0)) {
    return { ran: true, stamp: 'TESTS-FAILING', forcesGate: true };
  }
  // THE ENGINE'S OWN FACT ABOUT ITS OWN ACTION (G-48), and it ranks below a count for the same
  // reason TESTS-FAILING does above: a suite that printed failures and was THEN killed still failed,
  // and routing it here would recreate G-32 one case over.
  //
  // It ranks ABOVE the unknown case below because it is strictly more specific. capture chose the
  // deadline, sent SIGKILL and wrote the exit code, so "too slow" is something only this engine can
  // report — and it is a different instruction to the operator than "could not start": size your
  // timeout, not check your install. Without this, a consumer suite longer than capture's ten-minute
  // default — which is ordinary — was diagnosed as a missing dependency.
  //
  // `timedOut` is a FLAG rather than an exit code because exit 124 is not proof: capture maps every
  // null spawnSync status to 124, which also covers a spawn failure and a 64 MiB output overflow.
  if (timedOut) return { ran: null, stamp: 'TESTS-TIMED-OUT', forcesGate: false };
  if (Number.isFinite(testsReported)) {
    // The runner SAID zero. That is a report, not a parse failure.
    return { ran: false, stamp: 'TESTS-DID-NOT-RUN', forcesGate: false };
  }
  // Non-zero exit, unparseable output. Whether it ran is unknown, so `ran` is null rather than a
  // guess: it must not force the gate (asserting failure on a log nobody read is the original defect
  // with its sign flipped) and it must not be silent (a stamp that caps is how "we could not tell"
  // reaches the reader instead of being rounded to success).
  return { ran: null, stamp: 'TESTS-OUTCOME-UNKNOWN', forcesGate: false };
}

/**
 * THE FAN-OUT WAS NARROWED BY THE OPERATOR, and the gate has to say so.
 *
 * `--only ui-audit` on this repository produced `# Gate — PASS · every node reported` having spawned
 * zero lenses for $0. Every part was individually defensible: `required` is false for a lens nobody
 * asked to run, so `did_not_report` is empty, so completeness reads "every node reported". The
 * composite was a clean bill of health for a review that did not happen, in the project whose one
 * rule is that silence is not a verdict.
 *
 * NOT in CAPPING_STAMPS, and the three precedents are exact: UNSWEPT-DIFF, UNCAPPED-BUDGET and
 * CONTRACT-PARTIAL are all declared operator choices that permit PASS and print their provenance.
 * The lens that ran is worth exactly what it is worth in a full review — the operator's own ruling
 * when rejecting a cap on /invoke: "the cap exists for reviewers that CANNOT produce a verifiable
 * evidence path. A lens with a run directory can, so there is nothing to cap."
 *
 * What the stamp buys is the headline. A reader of `Gate — PASS` learns the code passed a review; a
 * reader of `Gate — PASS · fan-out narrowed to arch-review` learns which review.
 */
export const FAN_OUT_NARROWED_STAMP = 'FAN-OUT-NARROWED';

/**
 * WHY A NODE EXITED NON-ZERO, when the runtime already said and the engine threw it away.
 *
 * Measured on the first real /invoke run: arch-review worked for seven minutes on story-pipeline,
 * captured three pieces of evidence, and died. The status recorded `validator_errors: ["exit code
 * 1"]`. Its own stdout.json, sitting beside it in the evidence directory, said:
 *
 *     "terminal_reason": "budget_exhausted",
 *     "subtype": "error_max_budget_usd",
 *     "errors": ["Reached maximum budget ($4)"]
 *
 * `exit code 1` is the same sentence for a node the operator's own dollar ceiling stopped mid-verdict
 * and a node whose prompt was malformed, and those need OPPOSITE responses: raise the ceiling, or
 * fix the node. This is the argument the timeout branch one case over already makes in full — "raise
 * the cap, or debug the hang" — applied to the exit that has no forensics at all.
 *
 * WHAT MAY REACH A TRACKED FILE. This lands in validator_errors, which renders into gate.json and
 * gate.md, so nothing here passes vendor text through. `terminal_reason` is admitted only when it
 * matches a bare lowercase token, which cannot carry a credential, a path or a connection string;
 * the dollar figure comes from this project's own contract. The runtime's `errors[]` strings are
 * deliberately NOT quoted, for the reason external-review already records about vendor stderr.
 *
 * The verdict is gone either way and this does not pretend otherwise — a node killed before it
 * emitted its envelope has none.
 */
// WHICH SPELLINGS MEAN A BOUND WAS REACHED is the runtime adapter's `node_runtime.exit` (G-9 of
// 20261103-040939-rbr-remediation-9-review; ARCHITECTURE.md A-9): its subtype field is `node_runtime.answer`'s, its
// reason field is `exit.reason_field`, and `exit.budget` / `exit.turns` list the subtypes and reasons of each bound. A
// runtime declaring none is described by its exit code alone; one not given is refused.
export function nodeExitMapping(runtime) {
  if (!runtime || typeof runtime !== 'object') throw new Error('nodeExitMapping: the runtime adapter is required; its node_runtime.exit names the terminal spellings');
  const nr = runtime.node_runtime ?? {};
  const field = (v) => (typeof v === 'string' && v ? v : null);
  const list = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : []);
  const bound = (b) => ({ subtypes: list(b?.subtypes), reasons: list(b?.reasons) });
  return { subtypeField: field(nr.answer?.subtype_field), reasonField: field(nr.exit?.reason_field),
    budget: bound(nr.exit?.budget), turns: bound(nr.exit?.turns) };
}

export function describeNodeExit({ exitCode, result = null, budgetUsd = null, runtime }) {
  const m = nodeExitMapping(runtime);
  const plain = `exit code ${exitCode}`;
  if (!result || typeof result !== 'object') return plain;
  const subtype = m.subtypeField && typeof result[m.subtypeField] === 'string' ? result[m.subtypeField] : null;
  const reason = m.reasonField && typeof result[m.reasonField] === 'string' ? result[m.reasonField] : null;
  const hit = (b) => (subtype !== null && b.subtypes.includes(subtype)) || (reason !== null && b.reasons.includes(reason));

  if (hit(m.budget)) {
    const cap = Number.isFinite(Number(budgetUsd)) && Number(budgetUsd) > 0 ? ` ($${budgetUsd})` : '';
    return `${plain}: the runtime stopped this node at the DOLLAR CEILING the contract declares${cap}, `
      + 'before it emitted a verdict. Whatever it captured is on disk and is not a verdict. Raise '
      + 'review.budget_usd_per_node or narrow the scope — this is a ceiling the operator set, not a '
      + 'defect in the node.';
  }
  if (hit(m.turns)) {
    return `${plain}: the runtime stopped this node at its TURN LIMIT before it emitted a verdict. `
      + 'Same shape as the budget ceiling: a bound was reached, not a fault found.';
  }
  // Anything else the runtime named. Bare token only — see the note above about tracked files.
  if (reason && /^[a-z][a-z0-9_]{0,47}$/.test(reason)) {
    return `${plain}: the runtime reported ${m.reasonField} "${reason}" and emitted no verdict`;
  }
  return plain;
}

/**
 * WHICH LENSES THIS RUN GAVE UP BY NARROWING, from the expected rows.
 *
 * Extracted rather than left inline for the reason this file exists: the rule has three cases and
 * two of them cannot be reached by an offline test without spawning a judgment-tier model. A test
 * that tried cost $2.81 before it was killed. A decision a test can CALL is the cure for a decision
 * a test can only pay to observe.
 *
 * `would_have_run` is the load-bearing half. Deselecting a lens whose CONDITION the contract does
 * not meet costs nothing — ui-audit under `ui.surface: none` was never going to run — and stamping
 * there would put the signal on runs that gave up nothing, which is how a stamp stops meaning
 * anything.
 */
export function narrowedFanOut(expected = []) {
  return (expected ?? []).filter((e) => e && e.deselected && e.would_have_run);
}

/**
 * STAMPS THAT CAP THE GATE AT RISK, declared once so the list can be tested.
 *
 * G-63 (HIGH, run 20260915-191832): `TESTS-DID-NOT-RUN` was introduced with three documents
 * promising it "caps like UNTESTED and is named in not_checked[]" — decisions.mjs:416, I-20, and
 * stamp-consequences.json — and NOTHING in run-graph read it. Its only occurrence there was a
 * comment SAYING it capped. So a suite that never started reached `PASS` when the lenses passed,
 * where before the change it forced FAIL: the fix for one wrong verdict produced the opposite wrong
 * verdict, and the stamp existed to carry a consequence it never had.
 *
 * G-85 is why it shipped green, and it is the reason this list is data rather than a condition
 * inline at the gate: the regression test asserted `assert.match(runGraphSource, /TESTS-DID-NOT-RUN/)`,
 * which the COMMENT satisfies. A source-shape assertion standing in for behaviour is exactly what
 * A-16 names, and the cure is a decision a test can call rather than a string a test can find.
 */
export const CAPPING_STAMPS = Object.freeze([
  'UNBUILT',
  'UNTESTED',
  // A run whose reviewed files moved cannot certify a location-based conclusion (G-44).
  'TREE-MOVED',
  // Nothing was learned from the suite, so nothing is asserted about it — the same position as
  // UNTESTED, which is what this stamp was introduced to mean and did not.
  'TESTS-DID-NOT-RUN',
  // The suite exited non-zero and its output could not be parsed, so whether it ran is unknown
  // (G-32). Capping is what stops "we could not tell" being rounded to success.
  'TESTS-OUTCOME-UNKNOWN',
  // The engine killed the suite at its own deadline (G-48). It started and did not finish, so it
  // establishes nothing either way.
  'TESTS-TIMED-OUT',
  // The contract declares older semantics than this engine implements, so a key spelled correctly
  // may mean something the operator never agreed to. Nothing else in a run can see this — the
  // consumer's file is byte-identical before and after the upgrade.
  'CONTRACT-STALE',
  // The declared build/test/lint commands DID NOT RUN, by request. This is the stamp that closes
  // the hole `--skip-preflight` left open: the flag omitted the barrier and stamped nothing, so a
  // gate went out silent about declared commands having produced no result. UNBUILT and UNTESTED do
  // not cover it — they fire only when a command is EMPTY IN THE CONTRACT.
  'CHECKS-SKIPPED',
  // A reused pre-flight result was judged fresh against an INFERRED set of inputs rather than a
  // declared one, so the freshness claim rests on a guess about what the declared checks read.
  //
  // Its sibling CHECKS-REUSED is deliberately NOT here, and the difference is the whole point.
  // INTENT-PINNED sets the precedent: reuse is uncapped there, and its stamp-consequences entry
  // gives the reason in four words — "the inputs are provably unchanged". That sentence covers a
  // declared input set and refuses to stretch over an inferred one. Declaring
  // review.preflight_inputs is what removes this ceiling.
  'CHECKS-INPUTS-INFERRED',
  // The mint did not check the external reviewers this run can call (--no-verify-reviewers): whether each passed its
  // preflight is unknown, so an arm or judge here was not shown to work before it was trusted (reviewer-preflight
  // stage 3).
  'REVIEWERS-UNVERIFIED',
  // An arm or judge whose combination PASSED its preflight at mint failed during the run (reviewer-preflight stage 5,
  // D4): the panel this run was promised, shown to work beforehand, did not all answer.
  'PANEL-DEGRADED',
]);

/** Does any stamp on this run cap its gate at RISK? */
export function stampCaps(stamps) {
  return (stamps ?? []).some((s) => CAPPING_STAMPS.includes(s));
}

/**
 * THE DOC ROLES A BRIEF SHOULD SHOW, which is not always what the contract declares.
 *
 * `doc_roles.request` says what the REPOSITORY declares; `run.json.request` says what THIS RUN is
 * actually judged against, and new-run resolves the latter as `explicit || declared` — so
 * `--request` overrides the contract. Every brief built its Declared-documents block straight from
 * `contract.doc_roles`, so a run minted with `--request` told all eight lenses to read a different
 * file from the one its own run.json named.
 *
 * Observed on run 20260915-191832-p1-rederive: run.json recorded
 * `per-functionality-auth-selection.md` while all 8 lens briefs named
 * `adjudication-merge-for-disputes.md` — a COMPLETED ask. The criteria themselves came from the
 * right request, so the cost is bounded: a lens that goes and reads the named file reads the wrong
 * document, and any lens reasoning about which ask it is judging has two answers available.
 *
 * One owner, because the same block is assembled at three separate sites in run-graph and a fix
 * applied to one is the shape of defect this file already records half a dozen times.
 */
export function effectiveDocRoles(docRoles, runRequestPath = null) {
  const roles = { ...(docRoles ?? {}) };
  const p = String(runRequestPath ?? "").trim();
  // Only the request role can diverge: it is the one new-run lets an argument override.
  if (p) roles.request = p;
  return roles;
}

/**
 * WHY A NODE HIT ITS CAP: still working, or hung? The status could not tell them apart.
 *
 * Observed on run 20260913-222312 -- arch-review wrote 17 capture files between 22:40 and 22:54 and
 * was killed at 22:55 with stdout_bytes: 0. It was producing evidence to the last minute. A node
 * that hung at minute one produced the identical status line, `timed out after N ms; process tree
 * killed`, and the two need OPPOSITE responses: raise the cap, or debug the hang.
 *
 * The verdict itself is gone and this does not pretend otherwise. A process killed before it emitted
 * its envelope has no verdict to salvage, and assembling one from partial captures would be the
 * fabrication this system exists to refuse. What is recoverable is the shape of the work that was
 * under way, which is exactly what the operator's next decision turns on -- and the 15 -> 30 cap
 * raise was argued from a hand-read of file timestamps in a run directory, which is not something a
 * consumer will ever do.
 *
 * Pure: the caller stats the directory and hands over names and mtimes.
 */
export function timeoutForensics({ files = [], killedAtMs = null } = {}) {
  const list = (files ?? []).filter((f) => Number.isFinite(f?.mtimeMs));
  if (!list.length) {
    return {
      files: 0,
      idle_ms: null,
      last_write: null,
      why: 'no evidence was captured before the kill, so the node produced nothing for the whole '
        + 'window -- a hang or a node that never started work, not a narrow overrun',
    };
  }
  const last = Math.max(...list.map((f) => f.mtimeMs));
  const idle = Number.isFinite(killedAtMs) ? Math.max(0, killedAtMs - last) : null;
  const mins = idle === null ? null : Math.round(idle / 60_000);
  // The gap is reported in MINUTES alongside the raw value because the cap the operator sets is in
  // minutes: a number they cannot compare against the dial they turn is a number they will not use.
  const gap = idle === null
    ? 'the kill time is unknown'
    : (mins >= 1
      ? `its last write was ${mins} minute(s) before the kill`
      : 'it was still producing evidence when the kill landed');
  return {
    files: list.length,
    idle_ms: idle,
    last_write: new Date(last).toISOString(),
    why: `${list.length} evidence file(s) were captured before the kill and ${gap}. `
      + 'They remain on disk. The envelope does not: a node killed before it emitted one has no '
      + 'verdict to recover, so this run is missing what that node would have said.',
  };
}

export function vendorFailureReason({ status, rawLogRel = null, hadOutput = false } = {}) {
  // No log path means nothing to cite. §3 forbids citing evidence that does not exist, and a dangling
  // path reads as a file someone deleted rather than one that was never created.
  const where = rawLogRel
    ? `detail in ${rawLogRel} (gitignored, not quoted here: a vendor's stderr can carry a credential`
      + ' and the files this reason reaches are tracked)'
    : 'no raw log was written, so the vendor output was not captured anywhere';
  // A failed process's output is not its answer (G-5 of 20261109-232630-dps-delivery): a nonzero exit is refused
  // whatever it wrote, and the reason says it wrote something, so "no output" is not claimed of a stream that had some.
  return hadOutput
    ? `exited ${status} after writing output, which is not taken as its answer - ${where}`
    : `exited ${status} with no output - ${where}`;
}

export function classifyPanelProbe(envelope, reviewer) {
  if (!envelope || typeof envelope !== 'object') {
    return { state: 'malformed', reason: 'no parseable envelope on stdout' };
  }
  if (envelope.schema_version !== 1) {
    return { state: 'malformed', reason: `schema_version ${JSON.stringify(envelope.schema_version)}` };
  }
  if (envelope.source !== reviewer) {
    return { state: 'malformed', reason: `envelope source ${JSON.stringify(envelope.source)} != ${reviewer}` };
  }
  // Match the EXACT item `unavailable()` writes — `external reviewer 'codex'` / `external
  // proposer 'codex'` — not merely an item mentioning the reviewer's name. A substring test read
  // any entry containing the word as proof the arm never ran, so once the adapter began naming an
  // unpinned runtime (`codex model`, `codex reasoning effort`) a perfectly reachable arm that had
  // returned PASS was reported `unavailable`. Caught by a live probe on 2026-08-31, which is
  // precisely the class of defect the offline suite cannot see: both arms round-tripped.
  // Built from the SHARED role list, not a literal alternation. The alternation was
  // `(reviewer|proposer)`; external-review then grew a third mode whose failure marker reads
  // `tie-breaker '<name>'`, matched nothing, and a tie-break whose reviewer was missing, refused or
  // denied egress was recorded state OK — a silent adjudication reading exactly like one that
  // happened (G-44). One owner, so an emitter and its classifier cannot describe the same failure
  // differently again.
  const subject = new RegExp(`^(${UNAVAILABLE_ROLES.join('|')}) '${reviewer}'$`);
  const named = (envelope.not_checked ?? []).find(
    (n) => n && typeof n.item === 'string' && subject.test(n.item.trim()),
  );
  if (named) return { state: 'unavailable', reason: named.reason ?? 'unstated' };
  // THE FIELD THAT MODE ACTUALLY HAS. A review envelope carries `verdict`; a TIE-BREAK envelope
  // carries `supports` and has no verdict at all — so a reachable tie-breaker was reported as
  // "verdict undefined", a reason describing a field the mode does not define. Harmless to the
  // state, and exactly the kind of wrong-but-passing detail that teaches a reader to skim the
  // reason. Found by the first live run of check-tiebreak.mjs (2026-09-10).
  if (typeof envelope?.supports === 'string' && envelope.supports) {
    return { state: 'reachable', reason: `supports ${envelope.supports}` };
  }
  return { state: 'reachable', reason: `verdict ${envelope.verdict}` };
}

// --------------------------------------------------------------------- external reviewer argv
// Pure so the exact command line can be asserted offline. The panel is the one place where a
// wrong flag costs real money to discover, and the transport is only exercised behind an explicit
// QUORATE_LIVE opt-in — so the argv has to be checkable without launching anything.
//
// Neither field is defaulted here. A model name is only meaningful paired with a reviewer, so the
// pairing is declared in config (scripts/lens-roster.json panel_arms) and threaded down; unset
// means "the CLI's ambient default", which external-review.mjs reports in not_checked[].
//
// codex takes -c model_reasoning_effort=<level>; agy takes --effort <level>. The two CLIs also
// disagree on the level vocabulary (agy: low|medium|high), which is a reason to keep the value in
// config beside the reviewer that has to accept it rather than normalising it here.
// `schemaFile`/`outFile` switch the reviewer into NATIVE structured output, which is what lets the
// answer be read from a file instead of recovered from progress chatter by a hand-written scanner.
// The two CLIs spell it differently and deliver it differently: codex writes the final message to
// `outFile`, agy returns a JSON wrapper on stdout whose `structured_output` holds the object. Both
// were probed 2026-08-31; neither is documented to this level.
export function reviewerArgv({
  adapter, reviewer, model = '', effort = '', sandbox = true, schemaFile = '', outFile = '',
  timeoutMinutes = null, mode = null,
}) {
  // RENDERED FROM DATA, not branched per vendor. This was a `switch` over three hardcoded names, so
  // `reviewer` was configurable only in the sense that you could pick one of three — while the
  // standing requirement is that models and efforts live in config, and the vendor is the same class
  // of fact. Swapping a CLI meant editing eight files.
  //
  // The adapter is PASSED IN rather than loaded here: this module is the pure layer (no I/O, no
  // environment, no clock), and reading scripts/reviewers.json belongs to the caller. lib/reviewers
  // .mjs does that loading; this function only renders.
  const a = adapter;
  if (!a || !a.cmd) throw new Error(`reviewerArgv: no adapter for reviewer '${reviewer ?? '(unnamed)'}'`);

  const m = String(model ?? '').trim();
  const e = String(effort ?? '').trim();
  const schema = String(schemaFile ?? '').trim();
  const out = String(outFile ?? '').trim();

  const argv = [...(a.base_argv ?? [])];

  if (m && a.model_flag) argv.push(a.model_flag, m);

  // The two CLIs disagree on how an effort is spelled AND on its vocabulary, which is why the value
  // stays beside the model in the roster instead of being normalised into some common scale here.
  if (e) {
    const style = a.effort?.style ?? 'none';
    if (style === 'flag') argv.push(a.effort.flag, e);
    else if (style === 'config-kv') argv.push(a.effort.flag, `${a.effort.key}="${e}"`);
  }

  // The arm is a reviewer with no authorized write step, so the runtime is made to match the prompt
  // boundary rather than relying on the model to honour it.
  if (sandbox && (a.sandbox_argv ?? []).length) argv.push(...a.sandbox_argv);
  if ((a.always_argv ?? []).length) argv.push(...a.always_argv);
  // A BARE LISTING ALLOWED, FOR THE DECIDE MODE ONLY (decision-panel-seats.plan.md stage 6; operator, 2026-11-11: "A. Allow
  // listing only (Recommended)"): headless agy denied the listing its model began with, so a seat answered nothing. A
  // per-call settings object (never the CLI's saved settings), allowing exactly the adapter's listing lines.
  const listing = a.listing_allow;
  if (listing && Array.isArray(listing.modes) && listing.modes.includes(mode) && Array.isArray(listing.commands) && listing.commands.length) {
    argv.push(listing.flag, JSON.stringify({ permissions: { allow: listing.commands.map((c) => `command(${c})`) } }));
  }

  // THE ANSWER'S FILE WITHOUT A SCHEMA (story-pipeline, 2026-10-16): a reviewer whose answer arrives in a file gets that
  // file on the prompt-and-scan path too. Its stdout may be a transport stream (codex under --json) in which the answer is
  // string-escaped, and a scan of it found no proposal in a correct one.
  if (!schema && out && a.schema?.style === 'output-schema-file' && a.schema.out_flag) argv.push(a.schema.out_flag, out);
  if (schema) {
    const st = a.schema?.style ?? 'none';
    if (st === 'output-schema-file') {
      argv.push(a.schema.schema_flag, schema);
      if (out && a.schema.out_flag) argv.push(a.schema.out_flag, out);
    } else if (st === 'json-schema-inline-wrapper') {
      // The schema flag and the output format travel together, or the wrapper never appears.
      argv.push(a.schema.schema_flag, schema, ...(a.schema.extra_argv ?? []));
    }
  }

  // THE DEADLINE, FOR EVERY PROMPT CHANNEL AND INSIDE THIS BUILDER (G-11, arch-review).
  //
  // `timeout_flag` is documented in reviewers.json as a general adapter key, and external-review
  // appended it in the argv-prompt branch ONLY — the stdin and no-schema branches dropped it
  // silently — and appended it AFTER this function returned, the one builder declared pure "so the
  // exact command line can be asserted offline", precisely because the panel is where a wrong flag
  // costs real money to discover. It held together by coincidence: agy was both the sole declarer
  // of the key and the sole argv-prompt vendor. A stdin adapter declaring it got no vendor-side
  // deadline at all, fell through to quorate's outer hard kill, and returned nothing where the
  // vendor would have returned a partial or refusing answer — undetectable by any offline
  // assertion, because the flag was added after the assertion's subject had been built.
  const mins = Number(timeoutMinutes);
  if (a.timeout_flag && Number.isFinite(mins) && mins > 0) argv.push(a.timeout_flag, `${Math.round(mins)}m`);

  // stdin has no argv size limit, which is why a vendor that can read it does.
  if (reviewerPromptVia(a) === 'stdin' && a.prompt.argv_marker) argv.push(a.prompt.argv_marker);

  return { cmd: a.cmd, argv };
}

// ------------------------------------------------------------------- contract command argv
// How a declared contract command becomes an argv, in ONE place. `commands.shell` empty means
// argv-split with no shell — the safe default the contract documents — and a declared shell is a
// prefix the repo pays for explicitly. This existed identically in run-checks.mjs and (after a
// remediation that copied rather than shared it, G-1) in the pre-push hook; two owners of shell
// semantics is how the same contract string got parsed permissively at one entry point and
// safely at the other.
export function contractArgv(cmdString, shellPrefix = '') {
  const prefix = String(shellPrefix ?? '').trim();
  const cmd = String(cmdString ?? '').trim();
  return prefix ? [...prefix.split(/\s+/), cmd] : cmd.split(/\s+/);
}

// -------------------------------------------------------- external-reviewer subprocess env
// The environment an external reviewer CLI (codex, agy) is allowed to inherit, in ONE place.
// A reviewer is a third-party agentic binary that transmits what it observes to its own cloud,
// so its environment is an ALLOW-LIST, never a deny-list: a deny-list cannot bound an open set of
// secrets, and every secret the operator's shell carries — GITHUB_TOKEN, AWS keys, DATABASE_URL,
// ANTHROPIC_* — leaks the moment one is unlisted. It gets what a process needs to execute, the
// reviewer vendors' own config/credentials (whose CLI this is), and the depth guard. Nothing else.
//
// This lived as an inline IIFE at the panel-arm spawn, and the tie-break added a SECOND spawn of
// the same child without it — reintroducing the exact credential_exposure the inline version
// closed (panel run G-36, a BLOCKER). A boundary with two call sites and one owner cannot drift;
// a boundary copy-pasted can, and did. Returns { env, passed } — `passed` is the attribution
// record every reviewer spawn writes to its status.
const REVIEWER_ENV_EXACT = new Set([
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'ComSpec', 'windir', 'OS',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'ALLUSERSPROFILE',
  'USERNAME', 'USERDOMAIN', 'HOMEDRIVE', 'HOMEPATH', 'NUMBER_OF_PROCESSORS',
  'LANG', 'LC_ALL', 'TERM', 'SHELL',
]);
const REVIEWER_ENV_EXACT_FOLDED = new Set([...REVIEWER_ENV_EXACT].map((n) => n.toUpperCase()));
// Each reviewer vendor gets ONLY its own credential prefixes. Passing all three to every reviewer
// handed an agy process the operator's OpenAI/Codex keys and a codex process the operator's AGY
// keys — a secret crossing a vendor boundary it has no business crossing, on every arm and every
// tie-break spawn (G-21, panel-codex-security). OPENAI_ rides with codex because codex IS the
// OpenAI CLI; that fact, like every other per-vendor fact, is declared in scripts/reviewers.json.
//
// THERE WAS A SECOND COPY OF THAT TABLE HERE, hardcoding codex/codex-review/agy as a fallback for
// callers that had not resolved an adapter. Every caller in the engine resolves one, so the
// fallback was reached by nothing but a test — a vendor list that could silently disagree with the
// adapter table while looking authoritative, in the module that decides which credentials cross a
// process boundary. The adapters-as-data work was reported as removing every hardcoded vendor
// name; this one survived it, in the file where it mattered most.

// WHERE THE ENGINE KEEPS ITS STATE, handed back to every external-review child after reviewerEnv (G-12 of
// 20261010-063310-reviewer-preflight-r6): the vendor allow-list drops these, so an arm or judge read a different probe
// store from the mint's and could refuse its own --run-dir under a custom home. They locate the engine, not a vendor;
// external-review re-applies the allow-list at its last hop, so neither reaches a reviewer CLI. One owner, because
// bench-second-opinion's judge had kept the drop after run-graph fixed it (G-10 of 20261030-171256-ciss-c-review).
const ENGINE_LOCATION_KEYS = ['QUORATE_HOME', 'QUORATE_REVIEWER_PROBES'];
export function engineLocationEnv(sourceEnv) {
  return Object.fromEntries(ENGINE_LOCATION_KEYS.filter((k) => sourceEnv?.[k]).map((k) => [k, sourceEnv[k]]));
}

export function reviewerEnv(reviewer, sourceEnv, { depth, prefixes = null, names = null } = {}) {
  // NO `= process.env` DEFAULT (G-8, panel-codex-contract). This is the pure decision layer — I-1
  // says inputs arrive as explicit caller-supplied values, and §2 calls it "no I/O, no clock, no
  // environment". A default made the machine's environment reachable by omission, and arch-review
  // put the cost plainly for the sibling case: "a test that forgets the argument gets the machine's
  // real environment instead of failing". For a function that decides WHICH CREDENTIALS reach a
  // third-party reviewer, that is the worst available default.
  //
  // Every caller already passed it, so nothing relied on the default — only a mistake could.
  // An explicit `{}` remains a legitimate input; only OMISSION is refused.
  if (sourceEnv === undefined) {
    throw new Error('reviewerEnv requires an explicit sourceEnv: the pure layer does not read '
      + 'process.env, and a forgotten argument must fail rather than inherit the machine');
  }
  // THE PREFIXES COME FROM THE ADAPTER, and there is no second source. A caller that supplies none
  // gets NONE, which is the fail-closed direction and the same answer an unrecognised reviewer has
  // always received: an arm that cannot authenticate is a visible DEGRADED, a leaked key is not.
  // EVERY NAME startsWith(''), SO AN EMPTY PREFIX IS THE WHOLE ENVIRONMENT (G-16,
  // panel-codex-security + security-audit). `env_prefixes` is contract-supplied — a consuming
  // project declares its own reviewers — so `env_prefixes: [""]` forwards GITHUB_TOKEN, AWS keys,
  // DATABASE_URL and everything else through both external-review hops to a third-party agentic CLI,
  // under an allow-list whose whole reason for existing is that "a deny-list cannot bound an open set
  // of secrets". One empty string turns the allow-list into no list.
  //
  // Dropped rather than refused, because this function is the pure layer and has no way to fail a
  // run: an adapter that declares nothing usable gets NOTHING, which is the same fail-closed answer
  // an unrecognised reviewer has always received — a visible DEGRADED rather than a silent leak.
  // new-run's adapter validation is where a bad declaration should be named at mint.
  // A PREFIX MUST REACH A NAMESPACE BOUNDARY (G-10, panel-codex-security). Any non-empty string was
  // accepted, so a contract declaring `env_prefixes: ["A"]` forwarded ANTHROPIC_*, AWS_* and AZURE_*
  // to a third-party reviewer. The contract says what to REVIEW; it was never meant to say what may
  // leave the machine.
  //
  // The rule is not an arbitrary length. Every prefix this engine ships ends at a separator —
  // CODEX_, OPENAI_, AGY_, ANTHROPIC_, CLAUDE_ — because a credential namespace ENDS somewhere, and
  // one that stops short of its boundary is a wildcard wearing a namespace's clothes. This refuses
  // "A" and "ANTHROPIC" while accepting every shipped declaration unchanged.
  const resolved = (Array.isArray(prefixes) ? prefixes : [])
    .filter((p) => typeof p === 'string' && /^[A-Za-z][A-Za-z0-9]*_$/.test(p.trim()))
    .map((p) => p.trim());

  // THE DEPTH IS THE CALLER'S DECISION, because the two callers spawn different things and need
  // different answers. Getting this wrong took down the entire panel for a full run:
  //
  //   run-graph -> external-review.mjs   must be depth 0. external-review is the orchestrator's
  //                                      panel spawner and carries its own guard, "a graph node may
  //                                      not spawn panel arms" — the guard exists so a LENS cannot
  //                                      start arms, not to stop the orchestrator. Hand it 1 and all
  //                                      six arms exit 3 before doing anything.
  //
  //   external-review -> codex/agy       must be depth + 1. The vendor is an agentic CLI running
  //                                      with the repository as its working directory; at 0 it could
  //                                      invoke new-run.mjs or bench-lenses.mjs and find the
  //                                      recursion guard satisfied — an unbounded fan-out with a
  //                                      bill attached, which is exactly what §8 exists to prevent.
  //
  // G-26 said "reviewerEnv assigns GRAPH_NODE_DEPTH=0 to the VENDOR process", and it was right. The
  // fix applied the increment one layer too high, where the same function also produces the env for
  // external-review itself. A single hardcoded value cannot be correct for both, so neither gets to
  // be implicit: `depth` is required, and the caller states which side of that boundary it is on.
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error(
      `reviewerEnv needs an explicit non-negative integer depth — got ${JSON.stringify(depth)}. ` +
      `run-graph spawning external-review.mjs passes 0 (it is the orchestrator's own spawner); ` +
      `external-review spawning a vendor CLI passes its own depth + 1 (§8).`,
    );
  }
  // EXACT names from a consumer-declared reviewer (G-12): matched whole, never as a prefix.
  // Every match is FOLDED (G-8 of 20261023-214545-ger-remediation-review): Windows keeps a variable's stored case
  // (`OpenAI_API_KEY`) and the CLI reads it case-insensitively, so an exact comparison omitted the credential.
  const exact = new Set((Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)).map((n) => n.toUpperCase()));
  const folded = resolved.map((p) => p.toUpperCase());
  const env = { GRAPH_NODE_DEPTH: String(depth) };
  const passed = [];
  for (const [k, v] of Object.entries(sourceEnv)) {
    const K = String(k).toUpperCase();
    if (REVIEWER_ENV_EXACT_FOLDED.has(K) || exact.has(K) || folded.some((p) => K.startsWith(p))) {
      env[k] = v;
      passed.push(k);
    }
  }
  return { env, passed };
}

// --------------------------------------------------------------- child-process secret scrub
// A node is an agentic child that can invoke declared project commands (through
// capture.mjs), so an unrelated secret in the operator's shell — GITHUB_TOKEN, AWS_*,
// DATABASE_URL, signing keys — crossing into it is a real exposure (G-42). Unlike the external
// panel, this child is the operator's OWN vendor and MUST keep its Claude/Anthropic auth and its
// toolchain env to function, so a strict allow-list is not available without breaking the spawn.
//
// This is a PATTERN scrub, not a five-name deny-list: it removes anything that looks like a
// secret by name, which bounds the open set far better than enumerating known variables, while
// an explicit keep-set preserves exactly the credentials the child needs. Residual, named
// honestly: a secret whose variable name matches none of these patterns (an opaque name like
// `FOO`) still crosses — the pattern scrub narrows the hole, the panel's allow-list closes it,
// and the two differ because only one child is a third party.
//
// JWT and PAT (G-2 of 20260930-021623-invoke-security-audit-g6-g7): GITHUB_PAT and CI_JOB_JWT crossed. PAT is matched
// only as a whole `_`-delimited token, because as a substring it takes PATH, and then no toolchain resolves.
const SECRET_NAME = /(TOKEN|SECRET|_KEY|APIKEY|API_KEY|PASSWORD|PASSWD|CREDENTIAL|_AUTH|PRIVATE|SIGNING|AWS_|GCP_|AZURE_|DATABASE_URL|CONN(ECTION)?_?STRING|SESSION|JWT|(?:^|_)PAT(?:_|$))/i;
/** Does this variable name look like a secret, by the same shape the child scrub drops? (code-index.plan.md stage 3) */
export const isSecretShapedName = (name) => SECRET_NAME.test(String(name));
// Kept despite matching: the vendor's own auth, in every form the CLI accepts. Without these the
// child cannot authenticate at all.
const CHILD_ENV_KEEP = new Set([
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
]);

// WHICH AUTH A RUNTIME'S CHILD KEEPS is that runtime adapter's `node_runtime.session_env.keep_auth` when the caller names
// the runtime it is about to start (G-10 of 20261103-040939-rbr-remediation-9-review; ARCHITECTURE.md A-9): the fixed
// set above deleted another runtime's credentials before its adapter could act, and let these cross into its child. A
// runtime declaring none keeps none. Called with no runtime, the set above still decides (ledgered: the capture, commit
// and candidate scrubs remove it from processes that start no runtime).
// The auth a runtime's child keeps, as a folded name test: the runtime adapter's keep_auth when one is given, the fixed
// set above when none is. One owner for scrubChildEnv and commandEnvFor, so the two refuse a runtime alike (G-4 of
// 20261114-032609-m2-7b-remediation-review).
function runtimeAuthTest(runtime, who) {
  if (runtime === undefined) return isRuntimeAuth;
  if (!runtime || typeof runtime !== 'object') throw new Error(`${who}: a runtime given must be its adapter; its node_runtime.session_env.keep_auth names the auth its child keeps`);
  const declared = runtime.node_runtime?.session_env?.keep_auth;
  const folded = new Set((Array.isArray(declared) ? declared : []).filter((n) => typeof n === 'string' && n).map((n) => n.toUpperCase()));
  return (k) => folded.has(String(k).toUpperCase());
}
export function scrubChildEnv(sourceEnv, { runtime } = {}) {
  const keeps = runtimeAuthTest(runtime, 'scrubChildEnv');
  const env = {};
  const scrubbed = [];
  for (const [k, v] of Object.entries(sourceEnv)) {
    // The keep-set is matched folded, as the secret test is (G-9 of 20261023-214545-ger-remediation-review).
    if (SECRET_NAME.test(k) && !keeps(k)) { scrubbed.push(k); continue; }
    env[k] = v;
  }
  return { env, scrubbed };
}

/**
 * The environment of a command capture.mjs runs (G-23 of 20261008-214527-remediate-rebuild-review). The run pin never
 * crosses into it. In a REMEDIATION run the command may run code the remediator wrote, so it also loses the runtime's
 * own auth variables (CHILD_ENV_KEEP) — the node needs them to talk to its runtime; the code it wrote does not. A review's
 * captured command keeps its environment otherwise: a project's own suite may need its own keys, and that is the
 * project's business, not this engine's.
 */
// Removed by name FOLDED, on every platform (G-3 of 20261014-143305-ccb-remediation-review): Windows keeps a variable's
// stored case (`Anthropic_Api_Key`) and every child reads it case-insensitively, so an exact delete let it cross.
const isRuntimeAuth = (k) => CHILD_ENV_KEEP.has(String(k).toUpperCase());
const isRunPin = (k) => String(k).toUpperCase() === 'QUORATE_RUN_ID';
// WHICH AUTH IS THE RUNTIME'S is the run's runtime adapter's keep_auth when the caller gives it (G-4 of
// 20261114-032609-m2-7b-remediation-review): the fixed set named only Anthropic's, so another runtime's key, such as
// OPENAI_API_KEY, reached code the remediator wrote. The fixed set is removed too, as it always was.
export function commandEnvFor(sourceEnv, { remediation = false, runtime } = {}) {
  const runtimeAuth = runtimeAuthTest(runtime, 'commandEnvFor');
  const env = {};
  for (const [k, v] of Object.entries(sourceEnv ?? {})) {
    if (isRunPin(k) || (remediation && (isRuntimeAuth(k) || runtimeAuth(k)))) continue;
    env[k] = v;
  }
  return env;
}

/**
 * The environment of a REMEDIATION COMMIT: git and the consumer's hooks (remediation-commit-env; operator, 2026-10-11:
 * "Scrub secret names (Recommended)"; G-2 of 20261011-144207-commit-recovery-design-r7). commandEnvFor's reason for
 * keeping the environment — a project's suite may need its own keys — is about a review's captured command, not a
 * commit, and the hooks inherited every operator secret. Secret-shaped names go, as for a node (scrubChildEnv), and so
 * do the runtime's auth and the run pin. Kept although `_AUTH` matches them, because none is a secret and the commit
 * needs them: SSH_AUTH_SOCK (a socket path; SSH-agent commit signing) and GIT_AUTHOR_ / GIT_COMMITTER_ NAME, EMAIL and
 * DATE (the commit's identity — stripped, git would silently fall back to its config for the author; by name, not by
 * prefix, G-1 of 20261012-005825-commit-env-r2), and GIT_CONFIG_KEY_<n>, which `_KEY`
 * matches: dropped, it left GIT_CONFIG_COUNT and the VALUEs as a tuple git rejects, and every git call of the commit
 * failed (G-2 of 20261011-235046-commit-env-review). The VALUEs were never matched; the tuple now crosses whole.
 */
// The identity by NAME, not by prefix: a prefix let GIT_AUTHOR_TOKEN through (G-1 of 20261012-005825-commit-env-r2).
const gitIdentity = (k) => /^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL|DATE)$/.test(k);
// Folded, as SECRET_NAME is: Windows keeps a variable's stored case, and an exact match scrubbed Ssh_Auth_Sock (G-9 of
// 20261023-205906-ger-delivery).
const commitEnvKeeps = (k) => {
  const u = String(k).toUpperCase();
  return u === 'SSH_AUTH_SOCK' || gitIdentity(u) || /^GIT_CONFIG_KEY_\d+$/.test(u);
};
// The scrub both boundaries share: the runtime's auth, the run pin, and every secret-shaped name `keeps` does not name.
function envLessSecrets(sourceEnv, keeps) {
  const env = {};
  for (const [k, v] of Object.entries(sourceEnv)) {
    if (isRuntimeAuth(k) || isRunPin(k)) continue;
    if (SECRET_NAME.test(k) && !keeps(k)) continue;
    env[k] = v;
  }
  return env;
}
export function commitEnvFor(sourceEnv) {
  return envLessSecrets(sourceEnv, commitEnvKeeps);
}

/**
 * The environment of EVERY git process the engine starts (engine-git-env.plan.md stage 1; operator, 2026-10-23,
 * G-D1 A): the commit's scrub, less SSH_AUTH_SOCK unless `commit` (only `git commit` may sign with the agent; status,
 * add and hash-object run clean filters, which never need it), and GRAPH_NODE_DEPTH at least 1, so a hook, filter or
 * fsmonitor git runs cannot start graph work past §8's guard. Three reviews running found a git call outside the
 * runner's scoped wrapper carrying the operator's environment; scripts/io/git.mjs is the one caller.
 */
// Folded, as isRuntimeAuth is: Windows keeps a variable's stored case, and a second spelling would cross beside ours.
const isName = (name) => (k) => String(k).toUpperCase() === name;
export function gitEnvFor(sourceEnv, { commit = false } = {}) {
  const env = envLessSecrets(sourceEnv ?? {}, commitEnvKeeps);
  const depth = Object.entries(env).find(([k]) => isName('GRAPH_NODE_DEPTH')(k))?.[1];
  for (const k of Object.keys(env)) {
    if (isName('GRAPH_NODE_DEPTH')(k) || (!commit && isName('SSH_AUTH_SOCK')(k))) delete env[k];
  }
  const d = Number(depth);
  env.GRAPH_NODE_DEPTH = String(Number.isInteger(d) && d > 1 ? d : 1);
  return env;
}

/**
 * The environment of the remediation runner's CANDIDATE CHECKS, which run tests the remediator wrote: a policy of its
 * own, not the commit's (G-1 of 20261014-000825-rv-delivery-remediation-2-review; remediation-verification.plan.md stage
 * 4, operator, 2026-10-14: "Own policy, drop git auth (Recommended)"). It began as the scrub above keeping only the git
 * identity, and is now the allow-list below; either way SSH_AUTH_SOCK and the scoped GIT_CONFIG_COUNT / KEY_<n> /
 * VALUE_<n> tuple, which the commit keeps because git needs them to commit, never cross — a VALUE may carry a credential
 * (an http.extraheader).
 */
// NOW AN ALLOW-LIST (candidate-check-boundaries.plan.md stage 2; operator, 2026-10-14: D1 "Allow-list (Recommended)").
// The deny-list above missed one more variable in each of three rounds — the runtime's auth, secret-shaped names,
// SSH_AUTH_SOCK and the git-config tuple, then GIT_CONFIG_PARAMETERS — so a name now crosses only when it is one of the
// platform's process basics, the git identity, or declared in review.candidate_env. RESERVED names never cross, declared
// or not: what the runner removes or sets itself.
// The runtime's auth comes from its one owner, CHILD_ENV_KEEP, so the two lists cannot drift (G-1 of
// 20261014-022857-ccb-delivery).
const CANDIDATE_RESERVED = [...CHILD_ENV_KEEP, 'QUORATE_RUN_ID',
  'GRAPH_NODE_DEPTH', 'QUORATE_COUNT_FILE', 'QUORATE_FACTS_FILE', 'SSH_AUTH_SOCK'];
const isReservedCandidateName = (name) => {
  const u = String(name).toUpperCase();
  return CANDIDATE_RESERVED.includes(u) || u.startsWith('GIT_CONFIG');
};
// An entry is a name, or a `NAME_*` prefix; matched by the platform's environment case rule.
const envEntryMatches = (entry, name, ci) => {
  const e = ci ? entry.toUpperCase() : entry;
  const n = ci ? name.toUpperCase() : name;
  return e.endsWith('*') ? n.startsWith(e.slice(0, -1)) : n === e;
};
// WHAT THE ENGINE'S OWN CAPTURE NEEDS: capture.mjs runs IN this environment (it is the process the runner starts), and
// finds the run's staging root through QUORATE_HOME; dropped, an operator who sets it gets every candidate check refused.
// A path, not a secret (found by stage 2's end-to-end test, where capture exited 2 before the command ran).
const CANDIDATE_ENGINE_ENV = ['QUORATE_HOME'];
export function candidateEnvFor(sourceEnv, { basics, declared = [], caseInsensitiveEnv } = {}) {
  if (!Array.isArray(basics) || typeof caseInsensitiveEnv !== 'boolean') {
    throw new Error('candidateEnvFor: the platform\'s basics (processEnvBasics) and caseInsensitiveEnv are required');
  }
  const allowed = [...basics, ...CANDIDATE_ENGINE_ENV];
  const env = {};
  for (const [k, v] of Object.entries(sourceEnv ?? {})) {
    if (isReservedCandidateName(k)) continue;
    // A declared entry never admits a secret-shaped name, under a prefix included (G-14 of 20261020-105833-ciss-remediation-2-review).
    const isDeclared = !isSecretShapedName(k) && (declared ?? []).some((e) => envEntryMatches(e, k, caseInsensitiveEnv));
    if (gitIdentity(caseInsensitiveEnv ? k.toUpperCase() : k) || isDeclared || allowed.some((e) => envEntryMatches(e, k, caseInsensitiveEnv))) env[k] = v;
  }
  return env;
}

/**
 * Why `review.candidate_env` is refused, or [] (candidate-check-boundaries.plan.md stage 2): a list of names
 * (`[A-Za-z_][A-Za-z0-9_]*`) or `NAME_*` prefixes, no duplicates (compared case-folded), and no entry that admits a
 * RESERVED name — `GIT_*` or `GIT_CONFIG_PARAMETERS` is refused with that reason. Absent or [] declares none.
 */
export function candidateEnvErrors(value, key = 'review.candidate_env') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [`${key} must be a list of variable names, not ${JSON.stringify(value)}`];
  const errors = [];
  const seen = new Set();
  const probes = [...CANDIDATE_RESERVED, 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];
  for (const e of value) {
    if (typeof e !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$|^[A-Za-z_][A-Za-z0-9_]*_\*$/.test(e)) {
      errors.push(`${key}: ${JSON.stringify(e)} is not a variable name or a NAME_* prefix`);
      continue;
    }
    const folded = e.toUpperCase();
    if (seen.has(folded)) { errors.push(`${key}: ${e} is declared twice`); continue; }
    seen.add(folded);
    const hit = probes.find((r) => envEntryMatches(folded, r, true) || (folded.endsWith('*') && r.startsWith(folded.slice(0, -1))));
    if (hit || isReservedCandidateName(e)) {
      errors.push(`${key}: ${e} admits ${hit ?? e}, which the runner always removes or sets itself`);
    } else if (isSecretShapedName(e.replace(/\*$/, ''))) {
      // The secret shape is refused here, its one owner, not by each key that takes this grammar (G-14 of
      // 20261020-105833-ciss-remediation-2-review): only code_index's env applied it, so review.candidate_env took MY_API_KEY.
      errors.push(`${key}: ${e} is a secret-shaped name, which code the remediator or an extractor runs never needs`);
    }
  }
  return errors;
}

/**
 * The environment of a SUBSCRIPTION PROBE — a node-runtime child the engine spawns to measure the runtime, not to review:
 * the new-run canary and check-intent-grant. Scrubbed through the owner above, then the runtime's subscription surgery
 * (runtimeSessionEnv, from `runtime`'s declaration) to force subscription auth, and depth 1, because the probe is a node. One owner for both (G-24 of 20261001-034021-cgg-remediation-review): the grant probe built its own, and the
 * test that guarded it could only match its spelling. Returns { env, stripped }.
 */
export function subscriptionProbeEnv(sourceEnv, runtime) {
  const { env: scrubbed, scrubbed: stripped } = scrubChildEnv(sourceEnv, { runtime });
  // THE NAMES ARE runtimeSessionEnv's (G-8 of 20261031-022756-urr-remediation-review): a second list of them here could
  // drift, and had: the probe lacked the working-directory pin the owner gives every child of the runtime.
  const session = runtimeSessionEnv(scrubbed, { authMode: 'subscription', runtime });
  return { env: { ...session.env, GRAPH_NODE_DEPTH: '1' }, stripped: [...stripped, ...session.stripped] };
}

/**
 * Is this lens making a JUDGMENT, as opposed to reporting a measurement?
 *
 * A measurement either reproduces or it does not, so a second family adds nothing to it —
 * feature-verify is measurement-only and correctly has no arm. Every other basis (intent,
 * invariant, architecture_doc, convention) is an opinion, and an opinion held by one model family
 * is one opinion however confidently it is stated.
 */
export const isJudgmentLens = (lens) =>
  (lens?.allowed_basis ?? []).some((b) => b !== 'measurement');

/**
 * Judgment lenses running THIS run with no second family shadowing them.
 *
 * The roster asserted "every judgment lens now has an arm" in a note while ui-audit had none, and
 * nothing anywhere emitted a gap for an unshadowed lens — so in a consuming project with a UI
 * surface, ui-audit ran single-family and the gate recorded that as though it were shadowed. That
 * is absence reading as agreement, the exact failure the panel exists to prevent (G-19). The claim
 * now lives in code that checks it rather than in prose that asserts it.
 */
export function unshadowedJudgmentLenses({ lenses = [], panelArms = [], isPresent = () => true }) {
  const shadowed = new Set(panelArms.map((a) => a.shadows));
  return lenses
    .filter((l) => isJudgmentLens(l) && !shadowed.has(l.id) && isPresent(l.id))
    .map((l) => l.id);
}

/**
 * The LOWEST verdict a lens may report given the findings it is prepared to defend.
 *
 * §2 states this and nothing enforced it: FAIL is "at least one BLOCKER or HIGH finding the lens is
 * prepared to defend", PASS is "found nothing above LOW". The validator stored the model's verdict
 * verbatim, applying only the roster's verdict CEILING, and writeGate reads verdicts rather than
 * severities — so a lens holding a BLOCKER could declare PASS and the gate propagated it. Found by
 * absence: nothing in scripts/ compared a verdict to its own findings' severities.
 *
 * Derived from KEPT findings, after validation and after the severity clamp: "prepared to defend"
 * means what survived, not what was claimed.
 *
 * An unrecognised severity floors to RISK rather than PASS. It arrives from a model, so it degrades
 * rather than throwing — but a severity nobody can rank must not read as "harmless".
 */
export function verdictFloorFromFindings(kept = []) {
  let floor = 'PASS';
  for (const f of kept) {
    const s = f?.severity;
    if (s === 'BLOCKER' || s === 'HIGH') return 'FAIL';
    if (s === 'LOW') continue;
    floor = 'RISK'; // MEDIUM, or anything unrecognised
  }
  return floor;
}

/**
 * Raise a verdict to at least `floor`, never lower it.
 *
 * A lens may always judge WORSE than its findings suggest — it is entitled to say FAIL on LOW
 * findings if it is prepared to defend that. The floor exists to stop under-reporting, which is the
 * direction that produces a false PASS. Lowering is the ceiling's job (capVerdict), and the two are
 * deliberately separate parameters: conflating a severity bound with a verdict bound is exactly
 * what once disabled the severity clamp on every degraded lens.
 */
export function raiseVerdict(verdict, floor) {
  const rank = (v) => (VERDICTS.includes(v) ? VERDICTS.indexOf(v) : 0);
  return rank(floor) > rank(verdict) ? floor : verdict;
}

/**
 * Cap a verdict at `ceiling`, except for the floor the §6 invariant findings alone set (G-29 of
 * 20261021-162807-ciss-d1-review). The severity clamp already skips basis `invariant`; the verdict ceiling did not, so
 * a degraded perf-audit holding a HIGH credential-exposure finding ended at RISK while shared/claude-md-contract.md
 * promised "a §6 invariant is never capped". Non-waivable means non-cappable at both controls.
 */
export function capVerdictKeepingInvariants(verdict, ceiling, kept = []) {
  const capped = capVerdict(verdict, ceiling);
  if (ceiling === null) return capped;
  return raiseVerdict(capped, verdictFloorFromFindings(kept.filter((f) => f?.basis === 'invariant')));
}

/**
 * Did second-opinion fail to report when it was expected to?
 *
 * THE THIRD AUX NODE. reconcile and intent-capture each got a dedicated silence branch and this one
 * did not — and like them it is absent from `expected` (roster.lenses plus panelArmRows()), so it
 * has no bucket entry and no gate.json row. A second-opinion that returned DEGRADED on empty prose,
 * was killed on timeout or budget, or was stubbed, appeared NOWHERE, and the gate stayed free to
 * compute PASS: the adversarial audit OF the adjudication failing silently, and reading exactly
 * like one that passed.
 *
 * Its effect on the gate is deliberately WEAKER than the barrier's. reconcile's silence leaves
 * every finding unadjudicated, so that blocks. second-opinion audits an adjudication that did
 * happen, so its silence does not invalidate the findings — it means nothing checked them, which
 * makes PASS an overstatement rather than a fabrication. That is a RISK ceiling.
 *
 * The legitimate non-runs are NOT silence: --skip-panel is an operator choice named elsewhere, and
 * no reconciled.md means there was nothing to audit. A ceiling that fires on a non-problem teaches
 * readers to ignore ceilings.
 */
export function secondOpinionSilent({ installed, skipped, hadReconciled, state }) {
  if (!installed) return false;
  if (skipped) return false;
  if (!hadReconciled) return false;
  return state !== 'OK';
}

/**
 * Was the panel ENABLED but silent? Returns a reason, or null.
 *
 * A run with `external_panel: true` that produced no arm output has had its cross-family half
 * removed, and nothing said so. On the 2026-09-07 sweep all six arms exited 3 before doing any work
 * — a self-inflicted regression — and the gate emitted FAIL from the lens half alone, with the
 * Not-checked table naming ui-audit, feature-verify and five empty commands and not one word about
 * the six dead arms. The failure was recorded in six status files and visible in none of the places
 * a reader looks.
 *
 * The ceiling is the same one secondOpinionSilent applies, for the same reason. A verdict computed
 * without the second family is not wrong, it is UNCORROBORATED — and PASS on a run that believes it
 * had cross-family agreement is an overstatement, which is what RISK exists to say.
 *
 * TOTAL absence only. Losing one arm of six is a named gap, not a run-wide ceiling: a partial panel
 * still disagreed with the lenses somewhere, and a ceiling that fires on a non-problem teaches
 * readers to ignore ceilings.
 */
export function panelSilent({ enabled, armStates = [] }) {
  if (enabled !== true) return null;          // off by choice, stamped PANEL-ABSENT elsewhere
  if (!armStates.length) return null;         // nothing was scheduled: no claim was made
  if (armStates.some((s) => s === 'OK')) return null;
  return `all ${armStates.length} external arm(s) failed to report — this run has no cross-family ` +
    `review despite external_panel: true, so its verdict is one model family's opinion`;
}

// panelProbeGap lived here: it described `.claude/panel-check.json` in not_checked[] as evidence with an age. Deleted
// with check-panel.mjs (reviewer-preflight stage 4): a reviewer that has not passed a probe of the exact combination
// is now refused before the call and at mint, and the run records what passed (run.json.reviewer_preflight).

/**
 * A node id becomes a directory name, a file name and a `--node-id` argument, so it is validated
 * wherever it enters — not only where it was first thought of.
 *
 * spawn-node.mjs has checked this since it was written. external-review.mjs did not: it accepted
 * `--node-id` verbatim and interpolated it into `evidence/<id>/` three times, so a traversal value
 * escaped the evidence directory and could overwrite files elsewhere in the run (G-12/G-13). Two
 * siblings enforcing a rule and a third not is a missing owner, which is the shape of most of what
 * this repository's own reviews keep finding.
 *
 * UPPERCASE IS ALLOWED, AND LEAVING IT OUT SILENTLY BROKE EVERY TIE-BREAK EVER SPAWNED.
 *
 * The rule exists for traversal safety — no dots, no separators — and the lowercase restriction was
 * incidental: every node id anyone had in mind when this was written (`code-audit`,
 * `panel-codex-arch`) happens to be lowercase. Finding group ids are not. run-graph composes the
 * adjudicator's id as `tiebreak-${group.group_id}`, which is `tiebreak-G-17`, and external-review
 * refused it at argument-parse time — exit 2, no envelope, before the vendor was ever contacted.
 *
 * So the tie-breaker had never once run through the orchestrator. It is the rarest path in the
 * system (this repository has produced a genuine dispute twice in its whole history), its
 * diagnostics were being discarded by three separate catch blocks, and check-tiebreak.mjs — written
 * precisely because "nothing else ever does" — passes its own lowercase node id and so exercised
 * every part of the path except this one. Two disputes in the story-pipeline run both came back
 * DEGRADED with `ruling: null` and nothing else.
 *
 * `A-Z` introduces no traversal risk whatsoever: the refusal is about `.`, `/` and `\`, none of
 * which this admits. The ids are engine-composed, not operator input, so the case-insensitive
 * filesystem question does not arise.
 */
export const NODE_ID_RE = /^[A-Za-z0-9-]+$/;

/**
 * The shape of a finding-group id, in ONE place (G-38).
 *
 * It was typed three times: the reconcile envelope's JSON schema pins the pattern, run-graph
 * re-validates it before the id becomes a `--node-id` and a directory name (the runtime is never a
 * security boundary, and `--resume` re-reads a payload the current CLI never validated), and the
 * renderer needed the same question a third time to say WHY a group was not adjudicated. Three
 * copies of a validation rule is three chances for a payload the schema accepted to be rejected
 * downstream, or the reverse.
 */
export const GROUP_ID_RE = /^G-[0-9]{1,3}$/;
export const isGroupId = (v) => typeof v === 'string' && GROUP_ID_RE.test(v);

/**
 * An external arm's severity, normalised onto this system's ladder and held under its declared cap.
 *
 * TWO JOBS, both needed. External models routinely answer CRITICAL or SEVERE, which are not rungs
 * here — mapping them onto BLOCKER keeps the claim rather than silently flattening it to LOW — and
 * the result is then held at the ceiling the arm's roster entry declares.
 *
 * Extracted from external-review.mjs because the cap was a LITERAL in that adapter while run-graph
 * and finding-scope both carried comments saying the roster capped the arm, and no arm entry carried
 * a ceiling at all (G-14). One owner, declared in config, testable without spawning a reviewer.
 *
 * The ceiling is not a free parameter: an arm's basis is `convention`, which §4 caps at MEDIUM, so
 * raising it in the roster without changing the basis rule gets the finding REJECTED downstream
 * rather than honoured. MEDIUM is the fallback for a caller outside the graph.
 */
export function capArmSeverity(severity, ceiling = 'MEDIUM') {
  const norm = String(severity ?? '').trim().toUpperCase();
  const rung =
    norm === 'CRITICAL' || norm === 'SEVERE' || norm === 'BLOCKER' ? 'BLOCKER'
      : SEVERITY_RUNGS.includes(norm) ? norm
        : 'LOW';
  const cap = SEVERITY_RUNGS.includes(String(ceiling ?? '').toUpperCase())
    ? String(ceiling).toUpperCase()
    : 'MEDIUM';
  return SEVERITY_RUNGS.indexOf(rung) > SEVERITY_RUNGS.indexOf(cap) ? cap : rung;
}

/**
 * Quote an argv for a Windows SHELL spawn, so a path with a space survives cmd.exe re-parsing it.
 *
 * codex ships as an npm `.ps1`/`.cmd` shim, which CreateProcess cannot execute directly, so the arm
 * is spawned with `shell: true` — and Node does NOT quote arguments in that mode: it joins them with
 * spaces and hands the string to cmd.exe, which splits it again. Every path this arm passes is
 * absolute (`--output-schema`, `--output-last-message`, built from the run directory), so a consumer
 * whose checkout sits under `C:\Users\Jane Smith\proj` had those arguments split in half — the
 * reviewer then reads a schema path that does not exist and answers something unparseable, which
 * this script reports honestly and uselessly as "returned no parseable verdict envelope" (G-11).
 *
 * Windows forbids `"` in a filename, so wrapping is enough for the argument class this actually
 * carries; an embedded quote is refused rather than escaped, because a reviewer CLI argument that
 * needs shell escaping is a thing to notice, not to paper over.
 */
export function windowsShellArgv(argv) {
  return (argv ?? []).map((a) => {
    const s = String(a);
    if (!/[\s&|^<>()]/.test(s)) return s;
    if (s.includes('"')) throw new Error(`refusing to shell-quote an argument containing a double quote: ${s}`);
    return `"${s}"`;
  });
}

// ---------------------------------------------------------------------------- node deny sets
/**
 * THE TOOLS EVERY SPAWNED NODE IS DENIED, and the extra ones an intent node is denied on top.
 *
 * ONE OWNER, because the duplication was the defect. This list lived in three hand-maintained
 * copies: `buildIntentSettings()` in new-run.mjs wrote the settings file, spawn-node.mjs pushed a
 * parallel array onto `--disallowedTools`, and the regression test asserted membership against a
 * literal of its own. Three copies of a security boundary, and the test compared one copy to
 * another copy — so a tool missing from BOTH generators was missing from the literal too, and the
 * assertion passed while the hole was open.
 *
 * It was open. `PowerShell` was absent from all three for months (G-28): Claude Code exposes a
 * separate PowerShell tool on Windows, a shell reads file content (`Get-Content`, `Select-String`),
 * and this is the platform the framework is developed on — so every intent node ever run here could
 * read the implementation it exists to precede, with a green test above it. `Grep` had gone the
 * same way one finding earlier (G-56), for the same reason: two lists, updated by hand, one of them
 * forgotten.
 *
 * Both consumers now render from here, and the test asserts the RENDERED flag against this set
 * rather than against a fourth copy, so adding a tool in one place cannot leave the other behind.
 *
 * UNCONDITIONAL, not platform-branched: a deny for a tool the host cannot expose is inert, and
 * inert costs nothing against missing this again on the next platform that grows a shell tool.
 */
/**
 * THE TOOL NAMES MOVED TO THE RUNTIME (2026-09-09). They were frozen arrays here — Edit, Write,
 * NotebookEdit, WebFetch, WebSearch, Task, and Bash/PowerShell/Grep for intent — and every one is
 * Claude Code's vocabulary, sitting in the pure decision layer where a second runtime could never
 * reach it. quorate asks for the PROPERTY (`no_write`, `content_tool_denial`); which tool names
 * deliver it is the runtime's answer, declared in `node_runtime.tools`.
 *
 * The history stays because the defect it records is worth keeping: PowerShell was absent from this
 * list for months, which left every intent node on Windows holding a shell — and a shell reads file
 * content. The list had one owner by then; what it did not have was an owner that could be a
 * DIFFERENT runtime's list.
 */

/**
 * The full deny set for a mode, from the runtime that will enforce it.
 *
 * A runtime that declares no tool vocabulary gets an EMPTY deny list and the caller is expected to
 * refuse the spawn — `content_tool_denial` is a capability it did not declare, so it was never
 * eligible for a sandboxed role in the first place. Returning a Claude-shaped list here would be
 * the hardcoding one level down: correct for one vendor, silently inert for every other.
 */
export function denyToolsFor(mode, runtime = null) {
  // Through toolList, the one reader of an adapter's tool lists (adapter-tool-lists.plan.md stage 2).
  const always = toolList(runtime, 'deny_always');
  const intent = toolList(runtime, 'deny_intent');
  if (mode === 'intent') return [...always, ...intent];
  // A REMEDIATE node keeps every denial except the runtime's edit tools, which its policy grants through path rules
  // (remediate-rebuild stage 3). A runtime that declares no edit_tools denies them all, which fails closed.
  if (mode === 'remediate') {
    const edit = new Set(toolList(runtime, 'edit_tools'));
    return always.filter((t) => !edit.has(t));
  }
  // A READ-ONLY subagent (spawn-subagent.mjs) reads and searches and writes nothing, so the shell is denied too: a shell
  // writes files whatever a project's settings preauthorize (G-15 of 20261019-014448-ccf-delivery). It keeps its search
  // tools, which deny_intent also names because the intent node may not read content: the name tools a lens has, and the
  // runtime's content tools. The lens list no longer carries a content tool (stop-owner-grep-state-roots.plan.md stage 3,
  // G-17: the operator's B was for LENSES); a read-only subagent is not a lens, so it keeps what it had, unconfined as
  // before. Whether it should lose it too is a separate question, not decided by G-17.
  if (mode === 'read-only') {
    const keep = new Set([...toolList(runtime, 'lens_allow'), ...toolList(runtime, 'content_tools')]);
    return [...always, ...intent.filter((t) => !keep.has(t))];
  }
  // A LENS (every graph node in 'node' mode) is DENIED the runtime's content tools (G-7 of 20261105-212751-sogsr-delivery):
  // leaving Grep out of lens_allow is not a refusal, because under `defaultMode: manual` an unlisted read-only tool still
  // runs, and only a deny entry removes it (probed, new-run.mjs). The operator's B (G-17) is "no Grep at all" for a lens.
  return [...always, ...toolList(runtime, 'content_tools').filter((t) => !always.includes(t))];
}


// ---------------------------------------------------------------------------- node runtime argv
/**
 * How a SANDBOXED NODE is invoked, rendered from an adapter's `node_runtime` block.
 *
 * WHY THIS EXISTS. The orchestrator built eleven Claude-shaped flags inline — `--settings`,
 * `--setting-sources`, `--permission-mode`, `--add-dir`, `--disallowedTools`, `--json-schema` and
 * the rest — so the question "why does the orchestrator need to know the CLI's name?" had no good
 * answer. It needed to know because the invocation was written out in the spawner rather than
 * declared by the thing being invoked, which is the same mistake the reviewer side made and fixed:
 * a vendor was a switch, then it was a table.
 *
 * The requirement/mechanism split matters more here than anywhere else in the system. quorate asks
 * for `path_scoped_read` and `content_tool_denial` — properties, stated in shared/adapter-contract
 * .md with what each achieves. The block below is ONE runtime's answer to those requirements. A
 * different runtime answers differently and is equally a lens, provided it can actually deliver the
 * property; nothing here privileges a flag spelling or a vendor.
 *
 * ORDER IS PART OF THE CONTRACT, not an implementation detail: two CLIs may disagree about whether
 * a positional prompt precedes its options, and a renderer that emits a set rather than a sequence
 * produces an argv that parses differently on each. So the sequence is fixed here and the DATA says
 * what fills each slot.
 *
 * Every slot is optional. A runtime that has no concept of, say, a budget flag simply omits it, and
 * the corresponding capability is one it does not declare — which is what the caps derivation reads.
 */
export function nodeArgv(runtime, {
  prompt = '', model = '', effort = '', schemaJson = '', settingsPath = '',
  addDirs = [], denyTools = [], sandboxed = true, budgetUsd = '', sessionId = '',
} = {}) {
  const r = runtime ?? {};
  if (!r.cmd) throw new Error('nodeArgv: the runtime declares no cmd');
  const spec = r.node_runtime ?? {};
  const argv = [];
  const pair = (slot, value) => {
    if (!slot?.flag || value === '' || value === null || value === undefined) return;
    argv.push(slot.flag, String(value));
  };

  // ON STDIN WHEN THE RUNTIME TAKES IT THERE (decision-panel-seats.plan.md stage 2; DP-D1 A): the argv carries the bare
  // marker alone (`-p`, no text after it) and the prompt is returned as `input`, for the caller to write to the child's
  // stdin, so no prompt length meets the command line's cap. Raw: on stdin a leading "-" is no option.
  const viaStdin = runtimePromptVia(r) === 'stdin';
  let input = null;
  if (viaStdin) {
    argv.push(String(spec.prompt.argv_marker));
    input = typeof prompt === 'string' ? prompt : String(prompt ?? '');
  } else {
    // A prompt beginning with "-" (a SKILL.md's `---` front matter) is read by the CLI's option parser as another flag:
    // "error: unknown option '---..." (2026-10-20). A leading newline keeps the text and cannot be taken for an option.
    pair(spec.prompt, typeof prompt === 'string' && prompt.startsWith('-') ? `\n${prompt}` : prompt);
  }
  pair(spec.model, model);
  if (spec.output_format?.flag) argv.push(spec.output_format.flag, String(spec.output_format.value ?? ''));
  pair(spec.effort, effort);
  pair(spec.schema, schemaJson);
  pair(spec.settings, settingsPath);
  if (spec.setting_sources?.flag) argv.push(spec.setting_sources.flag, String(spec.setting_sources.value ?? ''));
  if (spec.add_dir?.flag && addDirs.length) argv.push(spec.add_dir.flag, ...addDirs.map(String));
  if (spec.deny_tools?.flag && denyTools.length) argv.push(spec.deny_tools.flag, ...denyTools.map(String));
  if (spec.permission_mode?.flag) {
    // The one slot whose VALUE is a decision rather than a passthrough. Both spellings are declared
    // by the runtime, because "unsandboxed" is not a universal word — and this framework grants it
    // in exactly one place, which is why it is named rather than defaulted.
    const value = sandboxed ? spec.permission_mode.sandboxed : spec.permission_mode.unsandboxed;
    if (value) argv.push(spec.permission_mode.flag, String(value));
  }
  pair(spec.budget, budgetUsd);
  pair(spec.session, sessionId);
  if (Array.isArray(spec.always)) argv.push(...spec.always.map(String));

  // `input`: the prompt, when it goes on stdin, else null (it is in argv). Every caller hands it to the spawn's input.
  return { cmd: r.cmd, argv, input };
}

/**
 * A node launch with its command overridden — the `--runtime-bin` fixture override spawn-node takes, now passed
 * on by run-graph, new-run's canary and the grant probe so a fake runtime can drive what each hands a node (G-22 of
 * 20261001-155615-cgg-review-r3). A `.mjs`/`.js` override runs under `execPath`, as spawn-node does: a script is not an
 * executable on Windows, and resolving it by name could find the installed CLI instead. No override: the adapter's own
 * `cmd`, launched by the same rule, so an adapter whose `cmd` is a script runs under `execPath` here as in spawn-node
 * (G-10 of 20261111-195536-runtime-bin-remediation-2-review: no override returned the command unwrapped).
 */
export function withRuntimeOverride({ cmd, argv, input = null }, override, execPath) {
  // The stdin prompt nodeArgv returned rides along (decision-panel-seats.plan.md stage 2): it was `{cmd, argv}` only.
  // The launch itself is lib/argv-specs.mjs runtimeLaunch's (G-6 of 20261111-192009-runtime-bin-remediation-review).
  const l = runtimeLaunch(override || null, cmd, execPath);
  return { cmd: l.cmd, argv: [...l.prefix, ...argv], input };
}

/**
 * WHICH KIND OF ANSWER A GATE IS, in the few words that ride beside the verdict.
 *
 * PASS, RISK and FAIL are three rungs of one ladder and all three are claims about the CODE.
 * BLOCKED is not on that ladder: it is a claim about the RUN, and it means no verdict was
 * established. That distinction is this project's central rule, and the gate TABLE already carries
 * it in two columns -- `| contract-audit | OK | FAIL |` says the node was fine and its verdict on
 * the code was not. The HEADLINE carried one bare word, which is the first thing a reader sees and
 * the one place the cue is missing: read alone, "FAIL" is as easily "the tool broke", which is the
 * one thing it never means. The exit code agrees and reads backwards to most eyes -- a FAIL run
 * exits 0 BECAUSE IT WORKED, and only BLOCKED exits 1.
 *
 * Renaming the four verdicts was the alternative and is worse: version-gate parses them out of
 * gate.json and every folded run in the cross-run ledger records them, so a rename propagates
 * through all of it to fix a legibility problem in one sentence.
 *
 * Takes the COUNT rather than the bucket, so the caller keeps `buckets.did_not_report` as the one
 * owner of the fact and this stays a pure rendering decision (G-20).
 */
export function gateCompleteness(silentNodeCount) {
  // ABSENT IS NOT ZERO, and this function is the last place that distinction may be dropped.
  // `Number(null)` and `Number(undefined ?? '')` coerce toward 0, so a caller that lost the count
  // would have rendered "every node reported" -- silence resolving to a clean bill of health, in the
  // headline of the artifact whose entire premise is that silence is not a verdict.
  if (silentNodeCount === null || silentNodeCount === undefined || silentNodeCount === '') {
    return 'completeness unknown';
  }
  const n = Number(silentNodeCount);
  if (!Number.isInteger(n) || n < 0) return 'completeness unknown';
  if (n === 0) return 'every node reported';
  return `${n} node${n === 1 ? '' : 's'} did not report`;
}


/**
 * What the sandbox canary's two arms MEAN together — the diagnosis, separated from the probing.
 *
 * FOUR OUTCOMES, NOT TWO, and which one you are in decides which subsystem to go and look at.
 * new-run already learned this once for the negative arm and wrote it down: "THREE OUTCOMES, NOT
 * TWO ... that was the wrong subsystem every time it fired, because the file had loaded fine and
 * the probe had simply taken a route that records nothing." The same defect survived one `if`
 * later, in the POSITIVE arm, which said `node-settings.json was probably not loaded` regardless —
 * including when a recorded denial proves it loaded.
 *
 * Measured 2026-09-23: three of seven lens-bench seeds refused to mint with that message while
 * their own `sandbox-canary.json` recorded two denials apiece. The probe had been told to run one
 * allow-listed command and instead ran `ls -la` first "to check that capture.mjs and the run
 * directory exist", was correctly denied twice, and never got to the real one. A working policy,
 * reported as an unloaded one, and roughly $5 of sweep lost to seeds that never spawned a lens.
 *
 * This is the same shape as G-63 in the negative arm — a probe whose verdict depends on a model
 * choosing one route over another — and it is NOT fixed here. Only the diagnosis is. A reader who
 * gets this message should be sent to the probe, not to the policy file.
 */
export function sandboxCanaryFailures({ sawDenial, allowWorked }) {
  const failures = [];
  if (!sawDenial) {
    failures.push(allowWorked
      ? 'no permission denial was recorded, and no file was created either. The policy DID load — '
        + 'the allow-listed command ran under it — so the probe neither ran the denied command nor '
        + 'was refused by a rule. Enforcement is unproven. Check that the canary prompt still names '
        + 'a command the deny list covers; a tool disabled by --disallowedTools records nothing'
      : 'no permission denial was recorded, and the allow-listed command did not run either — '
        + 'node-settings.json was probably not loaded at all');
  }
  if (!allowWorked) {
    failures.push(sawDenial
      // THE POLICY LOADED. Saying otherwise sends the reader to the one subsystem the evidence
      // already cleared: a denial cannot be recorded by a policy that was never read.
      ? 'the allow-listed capture command did not run, but denials WERE recorded — so the policy '
        + 'loaded and was enforced, and this is the probe rather than the sandbox. The model spent '
        + 'its turns on something else (typically inspecting the run directory first, which the '
        + 'policy correctly refuses) and never reached the allow-listed command. See the recorded '
        + 'denials in sandbox-canary.json: if they are the probe exploring rather than the command '
        + 'the prompt named, re-running usually mints. This is G-63 in the positive arm'
      : 'the allow-listed capture command did not run — node-settings.json was probably not loaded');
  }
  return failures;
}

/**
 * A filesystem path used as an ARGUMENT in a command in a NODE BRIEF.
 *
 * A brief is shell input. The evidence instruction every lens is graded on reads
 *
 *     node {{capture_rel}} --run-dir {{run_dir}} --node {{node_id}} --name <slug> -- <command>
 *
 * and a POSIX shell eats each backslash of a Windows path as an escape — so `C:\Users\...` reaches
 * capture.mjs as a garbled relative path and it exits 2. Which shell a node picks is the node's
 * choice, so the failure is intermittent and looks like flakiness. The sandbox canary was fixed for
 * exactly this hours before a review found the same defect still live in the brief (G-?,
 * panel-codex-security, run 20260924-004905-today-review).
 *
 * AN ARGUMENT, AND ONLY AN ARGUMENT. The other two paths on that command — `capture_rel` and
 * `detector_abs` — are command HEADS, matched as PREFIXES by an allow-list: capture.mjs's own for
 * the detector, the node permission policy's for capture itself. A quote changes the prefix. Passing
 * the detector through this quoted it and capture REFUSED it, making the mandatory §8 sweep
 * unrunnable for every node ordered to run it; `tests/regression-detector-path-resolved.test.mjs`
 * caught it, which is what that test is for (G-3: "resolved is not the same as runnable").
 *
 * So the heads keep their inline separator normalisation and are NOT quoted, and this covers the
 * one path on the line that no rule inspects. The distinction is the point: "shell-safe" is not one
 * rule, it is two, and applying the argument rule to a head is how a fix becomes a defect.
 *
 * Forward slashes AND quotes. Node accepts `/` on Windows and quoting survives every shell; either
 * alone leaves a path containing a space — an ordinary username — to chance. Quoting an ARGUMENT
 * is safe for the permission allow-list, which prefix-matches on `node <script>` and never sees it.
 */
export const briefArg = (p) => {
  const slashed = String(p ?? '').split('\\').join('/');
  // QUOTING IS NOT ESCAPING, AND TWO SHELLS DISAGREE ABOUT ESCAPING (G-18, raised separately by
  // panel-codex-code and panel-codex-security). Double quotes leave `$(...)` and backticks live in
  // a POSIX shell, and an embedded `"` terminates the quoting early — so the first version of this
  // helper turned a hostile path into command substitution in the very command every node is told
  // to paste into a shell.
  //
  // ESCAPING WOULD BE WRONG RATHER THAN MERELY HARDER. POSIX wants `\$` and ``\` `` inside double
  // quotes; PowerShell uses the backtick AS its escape character and reads `\$` literally. One
  // string cannot be correctly escaped for both, and a two-shell scheme invented here would be a
  // fresh instance of the class this helper exists to end.
  //
  // So it refuses. The run directory is MINTED by this engine — <home>/reviews/<key>/<stamp>-<slug>
  // — and a shell-active character reaches it only through a hostile home directory or a crafted
  // slug. Failing loudly while the brief is being assembled beats handing out a command that might
  // execute something, and beats silently dropping the argument.
  // ONLY WHAT DOUBLE QUOTES DO NOT ALREADY NEUTRALISE (G-10). The apostrophe was in this set and
  // is inert inside double quotes in bash, PowerShell and cmd alike — so `/home/O'Brien` threw
  // during brief assembly and the graph never started. A guard whose false positives break valid
  // installations is not conservative, it is broken in the direction that looks responsible.
  //
  // What stays is what still ACTS inside double quotes: `$` and a backtick expand, `"` ends the
  // quoting, and a newline or carriage return ends the command and begins another.
  // `%NAME%` TOO (G-3 of 20261108-060730-si-remediation-6-review-b): cmd.exe expands it inside double
  // quotes, before it parses them, so its value can end the quoting. One percent sign expands nothing.
  const hostile = slashed.match(/["`$\n\r]|%[^%]+%/);
  if (hostile) {
    throw new Error(
      `a path bound for a node brief cannot be quoted safely for every shell: ${JSON.stringify(slashed)} `
      + `contains ${JSON.stringify(hostile[0])}. Double quotes do not neutralise it in every `
      + 'shell, and POSIX and PowerShell disagree about escaping, so this refuses rather than '
      + 'emitting a command a node would paste into a shell of its own choosing.',
    );
  }
  return `"${slashed}"`;
};

/**
 * A path inside a command the operator is TOLD to run (a recovery or retry line), not one a node is
 * briefed with (G-11, G-12 of 20261108-032104-si-remediation-4-review). The same rule as briefArg, but
 * a printed message must not throw: a path briefArg refuses is withheld, and the placeholder holds
 * nothing a shell acts on inside double quotes, so a pasted command fails on a missing path rather
 * than running text from one.
 */
export const printedArg = (p) => {
  try { return briefArg(p); } catch { return '"(path withheld: it holds a character a shell would act on)"'; }
};

/**
 * A vendor-reported price, or `null` when the vendor reported none.
 *
 * `Number(raw)` then `Number.isFinite` looks like a coercion and is a TRAP: `Number(null)` is 0 and
 * 0 is finite, so a judge whose vendor explicitly returned `total_cost_usd: null` was tallied as
 * having cost nothing and never reached the `unmeasured` list (G-22). `Number('')` and `Number([])`
 * are 0 too. The comment above that tally already stated the intent the code defeated: a total that
 * silently omits the unpriced "reads as cheaper than it was".
 *
 * SECOND SPELLING OF ONE MISTAKE. `?? 0` in the bench aggregate turned an unpriced seed into a free
 * one on the same day (G-7). Both are "absence coerced to zero", so the decision lives here once
 * rather than being written a third time somewhere else.
 *
 * A REAL ZERO SURVIVES. A cached call that genuinely cost nothing is a measurement, and refusing it
 * would be the same error pointing the other way. Only absence — and a negative, which is not a
 * price — returns null.
 */
export function measuredUsd(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && !raw.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A PLAN-REVIEW ROUND'S SETTINGS, CHECKED AGAINST WHAT THE CALLER PINNED (G-4 of 20261018-195709-pins-review). The
 * `plan-verdict` carries `settings { model, effort }`; the caller set them from the values it spawned the reviewer at, so
 * a verdict that names others was not run at the settings it claims. Returns one error per field that differs; an absent
 * `settings` is one error. `null` effort is a value (the runtime's default was passed), compared like any other.
 */
export function gateSettingsErrors(settings, pinned) {
  if (!settings || typeof settings !== 'object') return ['the verdict carries no settings { model, effort }'];
  const errors = [];
  for (const key of ['model', 'effort']) {
    const got = settings[key] ?? null;
    const want = pinned?.[key] ?? null;
    if (got !== want) errors.push(`settings.${key} is ${JSON.stringify(got)}, but the reviewer was pinned to ${JSON.stringify(want)}`);
  }
  return errors;
}

/**
 * WHICH REPORTED BACKEND IDS ATTEST A PINNED MODEL (.claude/requests/two-ledger-mediums.md, AC3 as amended; G-1 of
 * 20261019-214353-review-review, operator: "At least one matches; name the rest (Recommended)"). The pin is an alias
 * (`opus`) or a full id; an id attests it when it contains the pin, case-folded. One matching id attests the round: a
 * runtime's modelUsage can list a helper model beside the main one, and requiring EVERY id to match refused a legitimate
 * round. The ids that do not match are returned as `others`, for the caller to print as also reported, not to refuse.
 * No matching id, or no ids at all, is one error.
 */
export function backendAttestation(backendModels, pinnedModel) {
  const ids = Array.isArray(backendModels) ? backendModels.map(String) : [];
  const pinKey = String(pinnedModel ?? '').trim().toLowerCase();
  const matched = pinKey ? ids.filter((id) => id.toLowerCase().includes(pinKey)) : [];
  const others = ids.filter((id) => !matched.includes(id));
  const errors = !ids.length
    ? ['spawned_with.backend_models is empty: the backend reported no model, so nothing attests which one ran']
    : !matched.length
      ? [`spawned_with.backend_models ${JSON.stringify(ids)} has no id containing the pinned model ${JSON.stringify(pinnedModel)}: the backend ran a model nobody pinned`]
      : [];
  return { matched, others, errors };
}

/**
 * THE JUDGMENT MODEL AND EFFORT A CLAUDE NODE OR SUBAGENT RUNS AT, from the contract's `review` block and the roster
 * (claim-check-cross-family.plan.md stage 0a). run-graph resolved this inline, and a skill reading the raw keys
 * (G-2/G-3 of 20261018-195709-pins-review) had no fallback: one owner now, for the graph and spawn-subagent alike.
 * An absent model falls back to the roster's `default_models.judgment`, an absent effort to 'high' (the CLI's own
 * documented default, written down so a run's depth is never the machine's); each fallback is named in `substituted`,
 * so a defaulted configuration stays distinguishable from a declared one (G-19). No model anywhere throws: a model name
 * is configuration, and this will not invent one.
 */
export function judgmentPins(review, roster) {
  const model = review?.models?.judgment ?? roster?.default_models?.judgment;
  if (!model) {
    throw new Error('no judgment model: review.models.judgment is unset and lens-roster.json declares no '
      + 'default_models.judgment — a model name is configuration, and this will not invent one');
  }
  const effort = review?.effort?.judgment ?? 'high';
  const substituted = [];
  if (review?.models?.judgment === undefined) substituted.push(`review.models.judgment -> '${model}'`);
  if (review?.effort?.judgment === undefined) substituted.push(`review.effort.judgment -> '${effort}'`);
  return { model, effort, substituted };
}

/**
 * THE RUNTIME-SESSION PART OF A CHILD'S ENVIRONMENT (claim-check-cross-family.plan.md stage 0a), shared by spawn-node and
 * spawn-subagent so the two cannot drift. WHICH NAMES is the runtime adapter's `node_runtime.session_env` (G-11 of
 * 20261103-022403-rbr-remediation-8-review, ARCHITECTURE.md A-9; scripts/reviewers.json says why each is there): `drop`
 * never crosses, `drop_when_subscription` is stripped too under `subscription`, and `set` is given whatever the parent
 * had. A runtime declaring none gets nothing stripped and nothing set; one not given at all is refused, since stripping
 * nothing for a caller that forgot it would pass the parent's credentials on silently. Returns a copy and the names it
 * removed.
 */
export function runtimeSessionEnv(sourceEnv, { authMode, runtime } = {}) {
  if (!runtime || typeof runtime !== 'object') throw new Error('runtimeSessionEnv: the runtime adapter is required; its node_runtime.session_env names what is stripped');
  const decl = runtime.node_runtime?.session_env ?? {};
  const names = (v) => (Array.isArray(v) ? v.filter((n) => typeof n === 'string' && n) : []);
  const env = { ...sourceEnv };
  const stripped = [];
  const drop = [...names(decl.drop), ...(authMode === 'subscription' ? names(decl.drop_when_subscription) : [])];
  // IN ANY CASE (G-4 of 20261030-153323-ciss-s7-remediation-2-review): Windows reads environment names case-insensitively,
  // so `Anthropic_Api_Key` is the key; matched by exact case, it crossed. Over-stripping such a name on POSIX costs nothing.
  const dropped = new Set(drop.map((k) => k.toUpperCase()));
  for (const k of Object.keys(env)) {
    if (dropped.has(k.toUpperCase())) { delete env[k]; stripped.push(k); }
  }
  const set = decl.set && typeof decl.set === 'object' && !Array.isArray(decl.set) ? decl.set : {};
  for (const [k, v] of Object.entries(set)) env[k] = String(v);
  return { env, stripped };
}
