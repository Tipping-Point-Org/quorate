// consumer-lenses.mjs — a lens the PROJECT declares, and the exact authority it is denied.
//
// WHY THIS IS DIFFERENT FROM EVERYTHING ELSE A CONSUMER DECLARES. The reviewed tree already supplies
// commands (allow-listed by capture.mjs), a threat model (prose into a brief) and project profiles
// (prose into a brief, bounded, framed as unable to waive a rule). All of those are DATA.
//
// A lens's instructions are not data. They are a node's whole contract — what it hunts for, what basis
// it may claim, what it must refuse — handed to a subprocess that runs with the operator's credentials
// and whose findings reach a gate the operator relies on. spawn-node forbids this by default and says
// why: "A node's instructions come from the framework doing the reviewing, never from the tree being
// reviewed — otherwise pointing --repo-root at another project would feed its skills to this run."
//
// So the boundary is not relaxed. It is crossed at ONE declared, recorded, capped point:
//
//   * DECLARED — the lens exists because the contract names it, and the contract is frozen into
//     run.json, so which lenses ran is reconstructable from the artifacts.
//   * CAPPED, and derived rather than declared — `allowed_basis: ['convention']`, verdict ceiling
//     RISK, never `required`. This is the treatment an external ARM gets, for the same reason: quorate
//     cannot verify the evidence discipline of instructions it did not write, so the output is
//     COVERAGE, never authority. A capped lens adds findings; it cannot decide a verdict.
//   * UNABLE TO RAISE A §6 INVARIANT, structurally. `invariant` is "the only basis that can raise a
//     non-waivable finding", and the basis list becomes the envelope's schema enum — so a consumer
//     lens claiming one fails validation rather than being trusted. The cap is enforced by the
//     validator, not by this comment.
//   * STAMPED — `CONSUMER-LENS`, so a reader of a gate can tell that a lens the project authored took
//     part. An unrecorded participant is the defect this framework keeps finding; a recorded one is a
//     fact a reader can weigh.
//
// A NAME THAT COLLIDES IS REFUSED OUTRIGHT. Overriding `code-audit` with project-authored
// instructions would be the reviewed tree rewriting the review, silently, under a familiar name — the
// one outcome no cap makes acceptable.

import path from 'node:path';
import { minutes } from './check-timeout.mjs';

/** What a consumer lens may never claim, whatever it declares. */
export const CONSUMER_LENS_BASIS = Object.freeze(['convention']);
export const CONSUMER_LENS_VERDICT_CEILING = 'RISK';
export const CONSUMER_LENS_STAMP = 'CONSUMER-LENS';

/** The id shape, matching the node ids the engine already composes: no dots, no separators. */
const ID_RE = /^[a-z][a-z0-9-]{2,40}$/;

/**
 * Normalise and validate the contract's `lenses:` block into roster-shaped entries.
 *
 * PURE — `frameworkIds` and the declarations arrive as arguments, and path containment is decided by
 * the caller that owns the repository root. Three ReferenceErrors in one phase of this engine came
 * from helpers reaching into an enclosing scope for exactly this kind of value.
 *
 * Returns `{ lenses, errors }`. Errors are FATAL at mint: a declared lens that cannot be built is a
 * node the operator expected to run, and silently dropping it is the shape this project refuses
 * everywhere (`expected.json` exists so a promised node cannot vanish).
 */
export function consumerLenses({ declared = {}, frameworkIds = [] } = {}) {
  const errors = [];
  const lenses = [];
  if (declared == null) return { lenses, errors };
  // A MAP KEYED BY ID, exactly like `reviewers:` — the other consumer extension point — for two
  // reasons. The contract's parser is deliberately minimal and supports no block sequences (`- item`),
  // so a list of declarations cannot be written in it at all; and a key cannot be declared twice, so
  // the duplicate-id case the list form needed a check for is impossible by construction.
  if (typeof declared !== 'object' || Array.isArray(declared)) {
    return {
      lenses,
      errors: ['`lenses:` in the graph_contract must be a map of id -> declaration, like `reviewers:`. '
        + 'The contract parser supports no block sequences, so a `- id: x` list cannot be read.'],
    };
  }
  const taken = new Set(frameworkIds);

  for (const [rawId, raw] of Object.entries(declared)) {
    const id = String(rawId ?? '').trim();
    const where = `lenses.${id || '(unnamed)'}`;
    if (!raw || typeof raw !== 'object') { errors.push(`${where} is not a declaration object`); continue; }
    if (!ID_RE.test(id)) {
      errors.push(`${where} is not a usable id: it must match ${ID_RE}, because it becomes a node id, `
        + 'a status filename and an evidence directory');
      continue;
    }
    if (taken.has(id)) {
      errors.push(`${where} is a lens this quorate already ships. A project-authored lens may not take `
        + 'the name of one the framework spawns: that is the reviewed tree rewriting the review under a '
        + 'familiar name, which no cap makes acceptable. Choose another id.');
      continue;
    }

    const instructions = String(raw.instructions ?? '').trim();
    if (!instructions) {
      errors.push(`${where}.instructions is required: the path, inside this repository, to the `
        + 'markdown this lens is instructed by. There is no default — a lens with no instructions '
        + 'would be spawned with nothing to do.');
      continue;
    }
    if (path.isAbsolute(instructions) || instructions.split(/[\\/]/).includes('..')) {
      errors.push(`${where}.instructions must be a relative path inside the repository; `
        + `${JSON.stringify(instructions)} is not`);
      continue;
    }

    // DECLARED FIELDS THAT ARE IGNORED ARE NAMED, not quietly dropped. A project that writes
    // `allowed_basis: [executed]` has stated an expectation, and a cap applied in silence would leave
    // it believing the lens can cite execution.
    for (const key of ['allowed_basis', 'verdict_ceiling', 'severity_ceiling', 'required', 'may_launch_run']) {
      if (raw[key] !== undefined) {
        errors.push(`${where}.${key} may not be declared: a project-authored lens is capped by the `
          + `engine (basis ${CONSUMER_LENS_BASIS.join('|')}, verdict ceiling `
          + `${CONSUMER_LENS_VERDICT_CEILING}, never required) because quorate cannot verify the `
          + 'evidence discipline of instructions it did not write. Remove the key.');
      }
    }

    const timeout = raw.timeout_minutes;
    // Through the owner of minutes values, which also bounds it (code-index-d1-part-a.plan.md stage 2).
    if (timeout !== undefined) {
      try { minutes('consumer_lens.timeout_minutes', timeout); } catch (e) {
        errors.push(`${where}.timeout_minutes: ${e.message}`);
        continue;
      }
    }

    lenses.push({
      id,
      skill_command: `/${id}`,
      schema_variant: 'code',
      // CAPPED HERE, from the constants above, so no declaration can widen it.
      allowed_basis: [...CONSUMER_LENS_BASIS],
      verdict_ceiling: CONSUMER_LENS_VERDICT_CEILING,
      condition: raw.condition && typeof raw.condition === 'object' ? raw.condition : { type: 'always' },
      required: false,
      status: 'installed',
      intent: 'forbidden',
      consumer: true,
      instructions_rel: instructions.split('\\').join('/'),
      ...(timeout === undefined ? {} : { timeout_minutes: timeout }),
      note: 'Declared by the project in graph_contract.lenses. Capped at basis convention and verdict '
        + 'RISK, never required, and unable to raise a §6 invariant — the same treatment an external '
        + 'arm gets, for the same reason: the engine did not write these instructions.',
    });
  }
  return { lenses, errors };
}

/** Merge, framework first, so a reader of expected.json sees the engine's own nodes before the project's. */
export function mergeLenses(frameworkLenses = [], consumer = []) {
  return [...frameworkLenses, ...consumer];
}
