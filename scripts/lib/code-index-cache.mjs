// code-index-cache.mjs — the code index's pure decisions about running an extractor and trusting its cached facts
// (code-index.plan.md stage 6). No I/O, no clock, no environment of its own (ARCHITECTURE §2): every input is passed in.
//
// - What an extractor's environment is: exactly the platform's process basics plus the language's declared `env`, and the
//   caller's GRAPH_NODE_DEPTH. Not
//   candidateEnvFor, which also passes QUORATE_HOME and the git identity (the operator's commit email), and not
//   scrubChildEnv, which keeps every name that does not look like a secret, the Claude credentials deliberately.
// - What a cached entry's key is: everything that decides the facts. The manifest's paths and contents, each extractor's
//   command, the content of every file the command names, its --identity (runtime, parser, module hashes), the schema
//   version, and the language's whole contract block. A region map is not a part: it is the extractor's own output.
// - What a child's result means: the header checkOutcome reads, built from the spawn result, so a signal reads
//   `incomplete` rather than `failed`.
// - What the two keys' three states mean.
import crypto from 'node:crypto';
import { checkOutcome } from './capture-header.mjs';
import { contractNumber, minutes } from './check-timeout.mjs';
import { CODE_INDEX_SCHEMA } from './code-index-schema.mjs';
import { isSecretShapedName } from './decisions.mjs';

const CACHE_FORMAT = 'code-index-v1';

export function extractorEnvFor(sourceEnv, { basics, declared = [], caseInsensitiveEnv }) {
  if (!Array.isArray(basics) || typeof caseInsensitiveEnv !== 'boolean') {
    throw new Error('extractorEnvFor: the platform\'s basics (processEnvBasics) and caseInsensitiveEnv are required');
  }
  const fold = (s) => (caseInsensitiveEnv ? String(s).toUpperCase() : String(s));
  const allowed = [...basics, ...(declared ?? [])].map(fold);
  const env = {};
  for (const [k, v] of Object.entries(sourceEnv ?? {})) {
    const n = fold(k);
    // A name admitted only by a declared PREFIX is still refused when it is secret-shaped: the contract check sees the
    // prefix's text (GITHUB_), never the names under it (GITHUB_TOKEN; G-28 of 20261020-061457-code-index-full-sweep).
    if (allowed.includes(n)) env[k] = v;
    else if (allowed.some((e) => e.endsWith('*') && n.startsWith(e.slice(0, -1))) && !isSecretShapedName(k)) env[k] = v;
  }
  // The caller's depth crosses as it was, last, so a node's extractor cannot run at depth 0 and start a run of its own (G-1
  // of 20261020-051530-code-index-remediation-review; full-check pins it the same way).
  const depth = Object.keys(sourceEnv ?? {}).find((k) => fold(k) === fold('GRAPH_NODE_DEPTH'));
  for (const k of Object.keys(env)) if (fold(k) === fold('GRAPH_NODE_DEPTH')) delete env[k];
  if (depth !== undefined) env.GRAPH_NODE_DEPTH = sourceEnv[depth];
  return env;
}

/**
 * The cache key for one language. `manifest` is [{ path, sha256 }] in any order; `named` is [{ path, sha256 }] for every
 * file the extractor command names (sha256 null when it is absent); `identity` is the extractor's --identity object.
 */
export function cacheKey({ language, spec, manifest, named, identity }) {
  const h = crypto.createHash('sha256');
  const put = (s) => { h.update(String(s)); h.update('\0'); };
  put(CACHE_FORMAT);
  put(CODE_INDEX_SCHEMA);
  put(language);
  put(JSON.stringify(canonical(spec ?? {})));
  put(JSON.stringify(canonical(identity ?? null)));
  for (const n of [...(named ?? [])].sort(byPath)) { put(n.path); put(n.sha256 ?? 'absent'); }
  for (const m of [...(manifest ?? [])].sort(byPath)) { put(m.path); put(m.sha256); }
  return h.digest('hex');
}
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}

/** The argv tokens of a command that look like a path, for the "named files" part of the key. */
export const namedPaths = (argv) => argv.slice(1).filter((t) => /[\\/]/.test(t) || /\.(py|m?js|cjs|ts|rb|jar)$/i.test(t));

/**
 * One child result to the extractor-failure detail, or null when the process itself passed. `result` is spawnCapture's:
 * { status, signal, error, timedOut, capped }.
 */
export function childFailure(result) {
  const header = {
    exit: Number.isInteger(result?.status) ? result.status : null,
    signal: result?.signal ?? null,
    timed_out: Boolean(result?.timedOut),
    error: result?.error ? (result.error.code ?? String(result.error.message ?? result.error))
      : (result?.capped?.stdout > 0 ? 'ENOBUFS' : null),
  };
  const { outcome, detail } = checkOutcome(header);
  return outcome === 'passed' ? null : { detail: outcome, why: detail };
}

/**
 * review.code_index_timeout_minutes, through the owner of minutes values (code-index-d1-part-a.plan.md stage 2): Number()
 * here took YAML `true` as one minute and had no upper bound.
 */
export function timeoutMinutes(value) {
  try { return { ok: true, minutes: minutes('review.code_index_timeout_minutes', value) }; } catch (e) { return { ok: false, why: e.message }; }
}

/** review.code_index_cache_max_mb: absent = 256, "" = uncapped, a non-negative number = that many megabytes. */
export function cacheCapBytes(value) {
  if (value === undefined || value === null) return { ok: true, maxBytes: 256 * 1024 * 1024 };
  if (value === '') return { ok: true, maxBytes: null };
  // A number or a numeric string and nothing else, as budgetOf (G-7 of 20261030-124823-ciss-stage7): Number(true) is 1,
  // Number([10]) is 10 and Number('  ') is 0, each a real cap nobody declared. contractNumber owns that grammar.
  const n = contractNumber(value);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, why: `review.code_index_cache_max_mb is ${JSON.stringify(value)}: give a number of megabytes, "" for uncapped, or leave it absent for 256` };
  }
  return { ok: true, maxBytes: Math.floor(n * 1024 * 1024) };
}

/** Where one repository's index lives under the engine's home: outside every working tree. */
export const indexDirName = (repoRealPath) => crypto.createHash('sha256').update(String(repoRealPath)).digest('hex').slice(0, 24);

/**
 * Does the repository's HEAD, as `git rev-parse HEAD` reported it, match an answer file's pinned commit? HEAD must be a
 * full commit id git printed with exit 0, and must start with the pin: an abbreviated pin matches, a pin longer than
 * HEAD does not, and an empty or failed read never does, because '' is a prefix of everything (G-19 of
 * 20261020-043006-code-index-delivery). Pure, so the decision is not in the I/O layer (G-11 of 051530).
 */
export function headMatchesPin(gitResult, pin) {
  const out = gitResult?.status === 0 ? String(gitResult.stdout ?? '').trim() : '';
  const head = /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(out) ? out : '';
  if (!head) return { ok: false, head: '', why: 'HEAD is unknown (git could not read it)' };
  if (typeof pin !== 'string' || !pin || !head.startsWith(pin)) return { ok: false, head, why: `HEAD is ${head}, not the pinned ${pin}` };
  return { ok: true, head };
}

/**
 * Is the working tree the commit HEAD names, as `git status --porcelain --untracked-files=all` reported it? The build
 * reads working-tree bytes, so a HEAD matching the pin vouches for nothing while any file is edited or untracked (G-10
 * of 20261022-200543-ciss-d1-review-2). A failed read is refused, never taken as clean. Pure, as headMatchesPin is.
 */
export function treeIsClean(gitResult) {
  if (gitResult?.status !== 0) return { ok: false, why: 'the working tree is unknown (git status could not read it)' };
  const changed = String(gitResult.stdout ?? '').split('\n').map((l) => l.trimEnd()).filter(Boolean).map((l) => l.slice(3));
  if (!changed.length) return { ok: true };
  const named = changed.slice(0, 10).join(', ') + (changed.length > 10 ? `, and ${changed.length - 10} more` : '');
  return { ok: false, why: `the working tree differs from HEAD (${named})` };
}
