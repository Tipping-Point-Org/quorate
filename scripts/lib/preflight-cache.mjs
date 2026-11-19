// preflight-cache.mjs — may this run REUSE the last pre-flight result, or must it re-run it?
//
// WHY THIS EXISTS, in two halves.
//
// The cost. A consuming project's declared `test` is whatever that project runs: story-pipeline's is
// 2,866 tests at roughly seven minutes, paid before every review, including a review scoped to one
// lens. The operator's rule: "this should happen at the instalation/configuration phase, during
// normal use you can do basic check to be sure no new pre-flight is needed but thats all."
//
// The hole. `--skip-preflight` was documented as "reuses an earlier barrier result" and implemented
// as pure omission: the block was skipped, checks.json was never read back, nothing validated that
// any reused result described the same tree, and nothing was stamped. On a fresh mint there was no
// earlier result at all, so the gate went out SILENT about declared `build` and `test` having never
// run — declared commands, no result, nothing in not_checked[]. UNBUILT/UNTESTED do not cover that:
// they fire only when a command is EMPTY IN THE CONTRACT.
//
// THE TWO CONDITIONS ARE INDEPENDENT, which is the whole design and was the one thing two reviewers
// got wrong. Both a cross-family critique and this engine's own author argued that the barrier class
// (`build`) must be EXCLUDED from the cache, because "a build skipped via cache on a dirty tree"
// lets lenses analyse code that does not parse. The operator overruled it:
//
//   "one thing is one thing another is another. The fact that build is cached do not prevent it to
//    be invalidated if the worktree is dirty"
//
// Being CACHEABLE and being INVALIDATED are separate rules and both hold. Every class is cached,
// `build` included. A dirty worktree invalidates the entry regardless of what moved when the input set
// is INFERRED or not listed by git; for a DECLARED set listed by git the content hash alone decides
// (preflight-reuse-by-hash, operator 2026-10-12), see preflightDecision. The objection
// assumed caching a check meant serving it while the tree had moved, which is only true of a cache
// with no invalidation.
//
// UNPROVEN FRESHNESS IS STALENESS. The input set can be DECLARED (`review.preflight_inputs`) or
// INFERRED from the contract's globs. Inference has a named hole the request states outright:
// `uv run pytest` behaves differently after `uv.lock` changes, and story-pipeline's `source_globs`
// is ["src/storypipe/**"], which excludes it. So an inferred set reuses, and says it inferred —
// CHECKS-INPUTS-INFERRED caps the gate. The precedent for capping exactly here is INTENT-PINNED,
// which is deliberately NOT capped and whose stamp-consequences entry gives the reason in four
// words: "the inputs are provably unchanged". Inferred inputs are not provable, so that sentence
// refuses to stretch over them.
//
// A cache that silently serves a stale result is worse than no cache: the gate then reports evidence
// about a tree that no longer exists, which is the failure this whole mechanism exists to remove,
// reintroduced one layer down.

import path from 'node:path';
import { contractNumber } from './check-timeout.mjs';

// THE PURE HALF (os-platform-adapters stage 4): what the cache key covers, whether an entry
// may be reused, where entries live, and the stamps an outcome carries. The half that hashes
// the tree and reads and writes entries is scripts/io/preflight-cache.mjs, which re-exports
// this module — import from there.

/** The checks whose commands are executed by the barrier. Mirrors CHECKS in run-checks.mjs. */
export const PREFLIGHT_COMMAND_KEYS = Object.freeze([
  'build', 'test', 'lint', 'fmt_check', 'typecheck', 'audit', 'deny',
]);

/**
 * ROOT-LEVEL DEPENDENCY MANIFESTS, folded into an INFERRED input set.
 *
 * This is a heuristic and is labelled one everywhere it is used. It exists because the request names
 * the failing case exactly: a declared check can read files outside `source_globs` and `test_globs`,
 * and a dependency manifest is the clear instance — the suite behaves differently after the lock
 * file moves, and deriving the set from the globs alone would call a stale result fresh.
 *
 * Ecosystem knowledge in lib/ has precedent: lib/test-count.mjs knows pytest's and jest's output
 * formats. What is new here is that the guess is DECLARED as a guess — a run resting on it is
 * stamped, and `review.preflight_inputs` is the cure rather than a longer list.
 *
 * Only entries that EXIST are included: a manifest a project does not have is not an input, and
 * hashing its absence would make the digest depend on this list rather than on the tree.
 */
export const MANIFEST_HEURISTIC = Object.freeze([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json',
  'uv.lock', 'poetry.lock', 'Pipfile.lock', 'pyproject.toml', 'setup.cfg', 'tox.ini',
  'requirements.txt', 'requirements-dev.txt',
  'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'Gemfile', 'Gemfile.lock',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'composer.lock',
]);

/**
 * MAY THIS ENTRY BE REUSED?
 *
 * Returns one of:
 *   { state: 'reuse', from, entry }   the result still describes this tree
 *   { state: 'stale', reason }        re-run the declared checks
 *
 * The conditions are checked in the order a reader would want them explained, and each is
 * independent of the others — none of them is a proxy for another.
 */
export function preflightDecision({ entry, hash, dirty, hashDecides = false }) {
  if (!entry) return { state: 'stale', reason: 'no earlier pre-flight result for these inputs' };

  // THE HASH ALONE DECIDES FOR A DECLARED SET LISTED BY GIT (preflight-reuse-by-hash; operator, 2026-10-12: "Hash decides
  // when declared (Recommended)"). Its digest reads every declared input's content, untracked-not-ignored ones included,
  // so a changed input already changes the hash; dirt OUTSIDE that set is not something the checks read. A tracked local
  // edit outside the inputs (continue.bat) re-ran the whole suite in every review of 2026-10-11. An INFERRED set, or one
  // git could not list, keeps the dirty rule below: there, unproven freshness is staleness.
  if (!hashDecides) {
    // DIRTY IS ITS OWN RULE AND COMES FIRST. The digest below covers the input set; the dirt may be
    // outside it — a changed script, a half-finished refactor in a directory no glob names — and the
    // declared checks may still read it. This is also what makes caching `build` safe, which is the
    // objection two reviewers raised and the operator answered by separating the two rules.
    if (dirty === true) {
      return { state: 'stale', reason: 'the worktree is dirty, so no earlier result describes the code under review' };
    }
    // `new-run` records `dirty: null` when it could not establish cleanliness (git missing, a broken
    // index). Unproven freshness is staleness: absence of evidence that an input changed is not
    // evidence that it did not.
    if (dirty !== false) {
      return { state: 'stale', reason: 'whether the worktree is clean could not be established (dirty: null)' };
    }
  }

  if (typeof entry.input_sha256 !== 'string' || entry.input_sha256 !== hash) {
    return { state: 'stale', reason: 'an input the declared checks read has changed since that result' };
  }
  if (!Array.isArray(entry.results) || entry.results.length === 0) {
    return { state: 'stale', reason: 'the cached entry carries no check results' };
  }

  // A CACHED FAILURE IS STILL A RESULT. Reuse means reuse of the outcome, not of the good news: a
  // cache that only ever helps is not a cache of the result. The caller treats a reused
  // `barrier_failed` exactly as a live one — BLOCKED, nothing spawned.
  return { state: 'reuse', from: entry.run_id ?? null, entry };
}

export const preflightCachePath = (reviewsDir, hash) =>
  path.join(reviewsDir, '.preflight-cache', `${hash}.json`);

/** Where the reused result's captured output lives, beside the entry that cites it. */
export const preflightEvidenceDir = (reviewsDir, hash) =>
  path.join(reviewsDir, '.preflight-cache', `${hash}.evidence`);

/**
 * The stamps a pre-flight OUTCOME carries. One owner, so the gate, the brief and the cap cannot
 * disagree about what happened.
 *
 * CHECKS-REUSED does NOT cap: a reuse over a provably unchanged input set on a clean tree is
 * evidence about the very tree under review. CHECKS-INPUTS-INFERRED does, and it is orthogonal —
 * two independent facts, two stamps, rather than one stamp meaning two things.
 */
export const CHECKS_REUSED_STAMP = 'CHECKS-REUSED';
export const CHECKS_INPUTS_INFERRED_STAMP = 'CHECKS-INPUTS-INFERRED';
export const CHECKS_SKIPPED_STAMP = 'CHECKS-SKIPPED';

export function preflightStamps({ state, inferred }) {
  const out = [];
  if (state === 'reuse') {
    out.push(CHECKS_REUSED_STAMP);
    if (inferred) out.push(CHECKS_INPUTS_INFERRED_STAMP);
  }
  if (state === 'skipped') out.push(CHECKS_SKIPPED_STAMP);
  return out;
}

/**
 * WHAT checks.json's TEXT YIELDS FOR THE GATE (G-10 of 20261024-032927-rrs-remediation-review): `null` (no file) is no
 * results and no gap; text that does not parse is no results AND an `error` the gate names, because reading it as
 * nothing dropped the gate's disclosures of unfinished checks silently. Pure.
 * Every writer records `results`, so a present file with none (or `null`) is malformed too, not an empty list (G-3 of
 * 20261024-041845-rrs-remediation-2-review). `barrier_failed` comes from here as well, so the pre-flight failure exit
 * reads the file through this owner rather than a parser of its own (G-6 of the same review).
 */
export function checksResults(text) {
  if (text === null || text === undefined) return { results: [], error: null, barrier_failed: null };
  try {
    const doc = JSON.parse(text);
    const results = doc?.results;
    const barrier_failed = doc?.barrier_failed ?? null;
    return Array.isArray(results)
      ? { results, error: null, barrier_failed }
      : { results: [], error: 'checks.json has no results list', barrier_failed };
  } catch (e) {
    return { results: [], error: `checks.json could not be parsed (${e.message})`, barrier_failed: null };
  }
}

/**
 * WHAT THE GATE MUST SAY, given a pre-flight outcome. Returns not_checked[] entries.
 *
 * A gate that is merely silent about a declared check having not run is not an acceptable outcome of
 * any path — that is the sentence this whole request exists for, and this function is where it is
 * kept true. `commands` is the contract's command map, so the entries NAME the declared commands
 * rather than describing them in the abstract.
 */
export function preflightNotChecked({
  state, inferred, from, commands = {}, why = null, evidence_restored: restored = null, results = [],
}) {
  // A CHECK THAT DID NOT RUN TO ITS OWN END (check-outcomes.plan.md stage 3): checks.json's results, each carrying the
  // outcome run-checks read from its log. Such a check is FAIL there, and says nothing about the tree in either direction.
  // A result without `outcome` (the key's version keeps any pre-change entry from being reused) adds nothing.
  const unfinished = (results ?? []).filter((r) => r?.outcome && !['passed', 'failed'].includes(r.outcome)).map((r) => ({
    node_id: `commands.${r.check}`,
    why: `did not run to completion (${r.outcome}${r.outcome_detail ? `: ${r.outcome_detail}` : ''}), so this run establishes `
      + 'nothing about it in either direction',
  }));
  const declared = PREFLIGHT_COMMAND_KEYS.filter((k) => String(commands[k] ?? '').trim());
  if (state === 'skipped') {
    return declared.map((k) => ({
      node_id: `commands.${k}`,
      why: `declared as \`${String(commands[k]).trim()}\` and NOT RUN — the pre-flight barrier was `
        + 'skipped by request, so this run establishes nothing about it in either direction',
    }));
  }
  const out = [];
  if (state === 'reuse' && inferred) {
    out.push({
      node_id: 'pre-flight input set',
      why: `the reused result was judged fresh against an INFERRED set of inputs${from ? ` (produced by ${from})` : ''}`
        + ` — ${why ?? 'review.preflight_inputs is empty'}. The freshness claim rests on that inference,`
        + ' so declare review.preflight_inputs to remove the ceiling.',
    });
  }
  if (state === 'reuse' && restored === false) {
    // The exit codes and counts are in the entry and are real. What is missing is the OUTPUT the
    // stamps were read from, so a reader who wants to see why the suite was called thin has nothing
    // to open. Named rather than left to an ENOENT.
    out.push({
      node_id: 'pre-flight captured output',
      why: `the reused result's logs were not in the cache${from ? ` (produced by ${from})` : ''}, so this `
        + 'run carries its exit codes and test counts without the output they were read from. Re-run '
        + 'with --preflight always to produce them here.',
    });
  }
  out.push(...unfinished);
  return out;
}

// ---------------------------------------------------------------- how large the cache may grow
// G-10 of 20260925-015614-platform-review: every distinct input set kept a full copy of its captured
// output with no bound, so the machine-local cache grew with every edit, forever. Bounded by SIZE,
// not entry count — the harm is disk, and one entry can be 100 KB or 50 MB — and evicted least-
// recently-USED, where a reuse counts as a use.

export const PREFLIGHT_CACHE_DEFAULT_MB = 256;

/**
 * The cap in bytes, from `review.preflight_cache_max_mb`. Three states, the convention the budget keys
 * use: ABSENT is the default, "" is uncapped (null) by declaration, a number is that many megabytes.
 */
export function preflightCacheMaxBytes(contract = {}) {
  const review = contract?.review ?? {};
  if (!Object.hasOwn(review, 'preflight_cache_max_mb')) return PREFLIGHT_CACHE_DEFAULT_MB * 1024 * 1024;
  const v = review.preflight_cache_max_mb;
  // ONLY "" DECLARES UNCAPPED (G-5 of 20261030-153323-ciss-s7-remediation-2-review): an explicit null, a key written with
  // no value, was read as uncapped too; it is refused below, as panel_snapshot_max_mb refuses it.
  if (v === '') return null;
  // A number or a numeric string and nothing else, as budgetOf (G-11 of 20261030-124823-ciss-stage7): Number(true) is 1
  // and Number([10]) is 10, each a cap nobody declared. contractNumber owns that grammar.
  const n = contractNumber(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`review.preflight_cache_max_mb must be a positive number of megabytes, or "" for uncapped — got ${JSON.stringify(v)}`);
  }
  return Math.floor(n * 1024 * 1024);
}

/**
 * Which entries to evict so the cache fits `maxBytes`: least recently used first, never `keep` (the
 * entry just written — evicting it would make the cache useless to the very run that paid for it).
 * `overCap` says the kept entry alone exceeds the cap, so the caller can report it. Pure.
 *
 *   entries: [{ hash, bytes, lastUsed }]   lastUsed is any number that orders by recency
 */
export function preflightEvictions(entries, { maxBytes, keep }) {
  if (maxBytes == null) return { evict: [], total: entries.reduce((s, e) => s + e.bytes, 0), overCap: false };
  const kept = entries.find((e) => e.hash === keep);
  const others = entries.filter((e) => e.hash !== keep).sort((a, b) => b.lastUsed - a.lastUsed);
  let total = kept ? kept.bytes : 0;
  const evict = [];
  // LEAST-RECENTLY-USED, NOT "WHATEVER STILL FITS" (G-28): once one entry does not fit, it and
  // everything older go. Filling the gap with a smaller older entry kept it over a newer one.
  let full = false;
  for (const e of others) {
    if (!full && total + e.bytes <= maxBytes) total += e.bytes;
    else { full = true; evict.push(e.hash); }
  }
  return { evict: evict.reverse(), total, overCap: Boolean(kept && kept.bytes > maxBytes) };
}
