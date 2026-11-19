// reviewer-schemas.mjs — real JSON Schemas for the external reviewers' structured output.
//
// These replace the prompt-appended sketch (`{"verdict":"PASS|RISK|FAIL", ...}`) and the
// balanced-object stdout scan. Both reviewers enforce a schema natively:
//
//   codex  --output-schema <file> --output-last-message <file>
//   agy    --json-schema <file> --output-format stream-json   (answer in the final result event's `structured_output`;
//          json until decision-panel-seats.plan.md stage 3, G-17 of 20261109-232630-dps-delivery)
//
// PROBED 2026-08-31, not assumed. codex enforces through OpenAI structured outputs in STRICT mode,
// and strict mode is unforgiving in a way that shapes everything here:
//
//   "Invalid schema for response_format 'codex_output_schema': In context=(),
//    'additionalProperties' is required to be supplied and to be false."
//
// So every object needs `additionalProperties: false` AND every property listed in `required` —
// strict mode has no notion of an optional field. A schema that breaks either rule is rejected
// with exit 1 and no output file, which the adapter reads as a hard failure. That is the correct
// handling, but it means a malformed schema costs a whole arm: these builders are pure and tested
// so that never happens by surprise.
//
// The consequence for proposals: candidates CANNOT be free-form objects. The caller's requested
// fields have to be named up front to appear in the schema at all.

import { voteValuesFor } from './adjudication.mjs';
import { CLAIM_KINDS, GRADES, VERDICTS } from './claim-check.mjs';

// Strict mode has no optional fields, so "not applicable" has to be expressible as a value. An
// empty string is that value everywhere below, and the adapter treats it as absent.
const str = { type: 'string' };

function strictObject(properties) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

// `status` is the adapter's field, not the caller's: it is what gives a reviewer a legal way to
// say it could not do the job. Without it a schema describes only success, and a stuck model must
// choose between violating the schema and inventing a pass. See shared/external-reviewers.md.
const STATUS = { type: 'string', enum: ['ok', 'refused', 'incomplete'] };

const NOT_CHECKED = {
  type: 'array',
  items: strictObject({ item: str, reason: str }),
};

/** The verdict envelope an external review arm returns. */
export function reviewSchema() {
  return strictObject({
    status: STATUS,
    reason: str,
    verdict: { type: 'string', enum: ['PASS', 'RISK', 'FAIL'] },
    findings: {
      type: 'array',
      items: strictObject({
        // The arm's own severity is re-clamped by the adapter (capped at MEDIUM, basis
        // `convention`). It is asked for anyway: an arm that wanted to say BLOCKER and was capped
        // is a different fact from an arm that said LOW.
        severity: { type: 'string', enum: ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'] },
        file: str,
        line: { type: 'integer' },
        claim: str,
      }),
    },
    checked_clean: { type: 'array', items: str },
    not_checked: NOT_CHECKED,
  });
}

/**
 * The candidate batch a proposer returns.
 *
 * `fields` are the caller's requested per-candidate fields, and they are REQUIRED to build this at
 * all — strict mode cannot express "an object with whatever keys you like". Returning null rather
 * than a permissive schema is deliberate: a permissive one is rejected by the API, which would
 * lose the whole arm, and silently narrowing the caller's fields would answer a question they did
 * not ask. The adapter falls back to the prompt-and-scan path and says so.
 */
export function proposeSchema(fields) {
  const names = (Array.isArray(fields) ? fields : String(fields ?? '').split(','))
    .map((f) => String(f).trim())
    .filter(Boolean);
  if (!names.length) return null;

  const candidate = {};
  for (const n of names) candidate[n] = str;

  return strictObject({
    status: STATUS,
    reason: str,
    candidates: { type: 'array', items: strictObject(candidate) },
    not_checked: NOT_CHECKED,
  });
}

/** A DECISION PANEL SEAT'S ANSWER (autonomous-run.plan.md stage 4). */
export function decideSchema() {
  // A SEAT OF THE DECISION PANEL (autonomous-run.plan.md stage 4): an entry id, `other` or `change`; the seat's reason is
  // `rationale`, because `reason` is the adapter's, as in every mode. Strict mode has no optional fields, so `other_text`
  // and `change_of` are `''` where they do not apply, and external-review drops them from the recorded result.
  return strictObject({
    status: STATUS,
    reason: str,
    choice: str,
    rationale: str,
    other_text: str,
    change_of: str,
    // decision-records.plan.md stage 4 (ARCHITECTURE A-22, A-24): what would change the seat's choice, which is not its
    // reason for it, and the evidence paths it rests on (only those resolving to a captured artifact ground it).
    what_would_change: str,
    citations: { type: 'array', items: str },
  });
}

/**
 * A CLAIM CHECKER'S RESULT, the shape `scripts/claim-check.mjs` applies its rules to (claim-check-cross-family.plan.md
 * stage 2). The kinds, grades and verdicts are claim-check's own lists, imported rather than restated, so the schema and
 * `resultShapeErrors` cannot disagree on what a claim may be. Strict mode has no optional fields: a citation carries
 * `file`, `lines` and `command`, with `''` for the ones that do not apply, which is how `resolveCitation` reads absence;
 * an unanswered counter-question's `answer` is `''` too. `status` and `reason` are the adapter's, as in every mode.
 */
export function claimCheckSchema() {
  const claim = strictObject({
    id: str,
    text: str,
    kind: { type: 'string', enum: [...CLAIM_KINDS] },
    search: strictObject({ looked_for: str, where: { type: 'array', items: str }, found: str }),
    grade: { type: 'string', enum: [...GRADES] },
    citations: { type: 'array', items: strictObject({ file: str, lines: str, command: str }) },
    trigger: str,
    counter_question: strictObject({ question: str, answer: str }),
    operator_only: { type: 'boolean' },
    verdict: { type: 'string', enum: [...VERDICTS] },
  });
  return strictObject({
    status: STATUS,
    reason: str,
    schema_version: { type: 'integer', enum: [1] },
    claims: { type: 'array', items: claim },
    not_checked: { type: 'array', items: str },
  });
}

/**
 * Every object in a strict schema must satisfy both rules. Checked before the schema is written,
 * because the API's rejection costs an arm and arrives as a bare 400.
 */
export function validateStrict(schema, pathLabel = '(root)') {
  const errors = [];
  const walk = (node, where) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      if (node.additionalProperties !== false) {
        errors.push(`${where}: additionalProperties must be present and false`);
      }
      const props = Object.keys(node.properties ?? {});
      const required = node.required ?? [];
      const missing = props.filter((p) => !required.includes(p));
      if (missing.length) {
        errors.push(`${where}: strict mode has no optional fields; missing from required: ${missing.join(', ')}`);
      }
      for (const [k, v] of Object.entries(node.properties ?? {})) walk(v, `${where}.${k}`);
    }
    if (node.type === 'array') walk(node.items, `${where}[]`);
  };
  walk(schema, pathLabel);
  return errors;
}

/**
 * The shape of a TIE-BREAK RULING, which the review envelope could not express.
 *
 * A tie-break answers one question — which of two contradicting positions the evidence supports —
 * and it was being asked to answer in a full review envelope: verdict, findings, checked_clean,
 * not_checked. So a ruling came back as `verdict: PASS, findings: 0`, which run-graph rendered into
 * reconciled.md as "verdict PASS; no finding upheld". Every measured ruling said that. The
 * adjudication existed in the model's prose and NOWHERE the graph could read it, which is why the
 * model comparison could score availability and latency but never correctness.
 *
 * `supports` is the whole point: the node_id of the position upheld, or the literal "neither".
 * Free text, not an enum, because the node ids are per-run — validated by the caller against the
 * group's actual participants, which is a fact the schema does not have.
 *
 * "neither" is a first-class answer. The prompt already says an unsupported ruling is worse than
 * none, and a schema with no way to decline forces a coin-flip into a field that reads as a
 * decision — the same failure as a verdict enum with no way to say "I could not check".
 */
/**
 * The tie-break envelope.
 *
 * `supports` CARRIES ITS ENUM when the participants are known. It was a free string, so the schema
 * permitted any value, run-graph re-derived the accepted set with its own literal
 * (`claimed === 'neither' || participants.includes(claimed)`), and lib/adjudication.mjs derived it
 * a third time from voteVocabulary — three owners of one category list, which is the exact shape
 * the vocabulary was centralised to remove, surviving in the schema layer.
 *
 * Only the enum is added here: the merge still refuses an out-of-vocabulary vote, because a schema
 * the vendor is ASKED to honour is not one it is known to honour (contract-audit, I-8).
 */
export function tieBreakSchema({ participants = [] } = {}) {
  // GUARDED ON THE PARTICIPANTS, not on the derived list. `voteVocabulary` always appends
  // `neither`, so a caller that passes no participants produced an enum of exactly ["neither"] —
  // an enum that forbids every real vote, which is worse than the free string it replaced.
  const known = (participants ?? []).filter(Boolean).length > 0;
  return strictObject({
    status: STATUS,
    reason: str,
    supports: known ? { type: 'string', enum: voteValuesFor(participants) } : str,
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    rationale: str,
    not_checked: NOT_CHECKED,
  });
}
