// contract-version.mjs — what `graph_contract: N` MEANS, and what changed between values of N.
//
// THE DEFECT THIS EXISTS FOR IS DOCUMENTED AND HAS ALREADY HAPPENED ONCE. From CLAUDE.md and
// QUORATE.md, both saying the same thing about moving the submodule pointer:
//
//   "It does NOT touch the graph_contract block copied into the project's own CLAUDE.md — whose
//    MEANING can change underneath it. `budget_usd_per_node: ""` once meant `Number("") === 0`, a
//    $0 cap that blocked every node; it now means uncapped. Same text, opposite behaviour, no
//    signal. Nothing on the consumer side records which version was installed, so staleness is
//    currently undetectable rather than merely unhandled."
//
// A key whose SPELLING is unchanged is invisible to every check there is. `check-install` compares
// key PRESENCE — it says so itself — so a consumer carrying exactly the right keys, with exactly the
// right values, can be running under semantics nobody told them about. The new contract-key ratchet
// closes the other direction (a key ADDED and forgotten somewhere); it cannot see this one at all.
//
// THE NUMBER ALREADY EXISTED AND WAS INERT AS A SIGNAL. new-run did `if (contract.graph_contract
// !== 1) die(...)` — a strict equality against a literal, with no record of what 1 means and no way
// for a consumer to be told they are behind. Equality cannot express "you are two versions back and
// here is what moved", which is the only message that helps.
//
// WHY A STAMP AND NOT A REFUSAL. Refusing would break every consumer the moment this repository
// bumps, punishing them for an upgrade they were told to perform. Silence is the defect being fixed.
// So a behind-version run PROCEEDS, is stamped, capped, and names the changed keys — this engine's
// established answer to "something here was not verified". An AHEAD version is different and is
// fatal: a contract written for a newer engine may mean things this one cannot honour, and guessing
// is how the $0-cap case became a behaviour change nobody saw.

/**
 * The contract semantics THIS engine implements.
 *
 * Bumping it is a deliberate act with a required companion entry below, enforced by test: a version
 * with no changelog is the same silence this file exists to remove, one level up.
 */
export const CONTRACT_VERSION = 6;

/**
 * What changed AT each version, keyed by the version that introduced the change.
 *
 * Version 1 has no entry because it is the first: there is no earlier semantics to have moved from.
 * The `budget_usd_per_node` flip quoted above happened BEFORE this mechanism existed and is
 * deliberately NOT recorded here as a fake entry — inventing a version-2 for it would put a change
 * in the changelog that no consumer can act on, and would make the first real entry indistinguishable
 * from a backfilled one.
 *
 * Each entry names the KEYS a consumer has to look at. Usually that is text which stayed the same
 * and stopped meaning the same thing -- the case nothing else can detect. A RENAME belongs here
 * too, which this docstring originally denied: the key ratchet compares the three files against
 * each other and is blind to a consumer's own contract, so a rename reaches them through this list
 * or not at all.
 *
 * @type {Record<number, {keys: string[], what: string}>}
 */
export const CONTRACT_CHANGES = Object.freeze({
  6: {
    keys: ['review.external_panel', 'review.reviewer_probe_max_age_hours'],
    what: 'an external reviewer is now TESTED BEFORE IT IS USED, and one that fails is refused. With '
      + '`review.external_panel: true`, every combination of reviewer, model, effort and mode is probed before its first '
      + 'call and again when its record is older than `review.reviewer_probe_max_age_hours` (absent = 24; "" = no age '
      + 'limit); a failed probe refuses the call (exit 5), and new-run refuses to mint a run whose panel arms or '
      + 'adjudicators do not pass. A missing or broken reviewer used to be named in not_checked[] while the run went on. '
      + 'Your text is unchanged and now means the stricter thing. Two ways out exist and both are visible: '
      + '`--no-verify-reviewers` on new-run skips the mint check and caps the run (REVIEWERS-UNVERIFIED), and '
      + '`review.external_panel: false` turns the panel off (PANEL-ABSENT). A reviewer that passed at mint and fails during '
      + 'the run now caps it too (PANEL-DEGRADED). `node scripts/check-reviewers.mjs` (QUORATE_LIVE=1) checks the panel on '
      + 'demand, replacing the two probe commands that did this before.',
  },
  5: {
    keys: ['source_globs', 'test_globs', 'doc_paths', 'generated_globs', 'review.preflight_inputs', 'doc_roles'],
    what: 'every contract glob is read by ONE grammar now, and matched exactly. Two things follow for a file whose '
      + 'text did not change. First, a glob that says more than its directory covers only what it says: '
      + '`docs/**/README.md` covered all of `docs/` for scope, finding demotion and CONTRACT-PARTIAL, and now covers '
      + 'only the README.md files under it, so a finding on another file there may now be demoted, and the file '
      + 'counted as uncovered. Second, forms outside the grammar are refused when a run is minted: `?`, `[...]`, a '
      + 'brace list, a `.` or `..` segment, an absolute path, a leading `!`. Rewrite a brace list as one entry per '
      + 'alternative. And the intent node now reads a sandbox holding copies of exactly what each doc_paths glob '
      + 'matches, rather than a grant on the live directory. Accepted: `*` within a segment, `**` as a whole segment, '
      + 'literal characters (shared/claude-md-contract.md, "The grammar of a contract glob").',
  },
  4: {
    keys: ['commands.build', 'commands.test', 'commands.lint', 'commands.fmt_check',
      'commands.typecheck', 'commands.audit', 'commands.deny', 'review.preflight_inputs'],
    what: 'a declared command used to mean "run this before EVERY review". It now means "run this '
      + 'when the previous result no longer applies". The pre-flight barrier is no longer re-executed '
      + 'by default: the engine hashes the files the checks read, compares that against the entry the '
      + 'last run left, and re-runs only on a miss. Two conditions invalidate an entry and they are '
      + 'INDEPENDENT -- a changed input, and a dirty worktree regardless of what moved -- so every '
      + 'class is cached, `build` included, without a cached build ever being served for a tree that '
      + 'has moved. Nothing in your file changed spelling, which is why this needs a version to be '
      + 'visible at all: the text `test: "pytest"` is byte-identical before and after and now describes '
      + 'a different cadence. TWO THINGS TO DECIDE. Declare `review.preflight_inputs` with the globs '
      + 'your checks actually read, or accept an INFERRED set (source_globs + test_globs + this file + '
      + 'any root-level dependency manifest) and the CHECKS-INPUTS-INFERRED ceiling that goes with it. '
      + 'And run `scripts/preflight.mjs --run` once at install, which is where paying for a long suite '
      + 'belongs. `--preflight always` restores the old cadence exactly; `--skip-preflight` still skips '
      + 'and now stamps CHECKS-SKIPPED rather than leaving the gate silent about commands that never ran.',
  },
  3: {
    keys: ['graph_contract_version'],
    what: 'the key carrying this number was RENAMED from `graph_contract` to '
      + '`graph_contract_version`. The old spelling named the block and versioned the schema with '
      + 'one word -- it reads as "this is a graph-contract block" rather than "version N of the '
      + 'contract". Both spellings are accepted and the new one wins if a file carries both, so this '
      + 'breaks nothing: rename the key at your leisure and the deprecation notice stops. No key '
      + 'changed MEANING at this version.',
  },
  2: {
    keys: ['review.reviews_dir'],
    what: 'an ABSENT or empty review.reviews_dir used to mean `.claude/reviews` INSIDE the repository '
      + 'under review, written there live. It now STAGES the run under the engine\'s own home and '
      + 'moves it back into `.claude/reviews` when the run ends. So the tree is untouched WHILE a '
      + 'review is being written — which is what removed the need to exclude a live run directory '
      + 'from the tree hash, the arms\' mirror and the intent sandbox — and the committed evidence '
      + 'trail still grows, with nothing to back up separately. What changed for a reader: a run '
      + 'appears in `git status` only once it is finished, and a run KILLED mid-flight stays outside '
      + 'the tree (where `--resume` still finds it). Declaring reviews_dir writes straight there with '
      + 'no staging, exactly as before; `--no-archive` leaves one finished run staged. The cross-run '
      + 'ledger did NOT move and stays tracked.',
  },
});

/**
 * How does a declared `graph_contract:` value stand against this engine?
 *
 * Returns `state` plus, when behind, the changes the consumer has not been told about — every entry
 * strictly above what they declared, up to and including this engine's version.
 */
// `key` is which SPELLING the consumer used, carried through so every message quotes their own
// file back at them. Telling someone their `graph_contract_version` is wrong when they wrote
// `graph_contract` sends them looking for a line that is not there.
export function contractVersionGap(declared, engineVersion = CONTRACT_VERSION, key = null) {
  if (!Number.isInteger(declared) || declared < 1) {
    return { state: 'invalid', declared, engine: engineVersion, key, changes: [] };
  }
  if (declared > engineVersion) {
    return { state: 'ahead', declared, engine: engineVersion, key, changes: [] };
  }
  if (declared === engineVersion) {
    return { state: 'current', declared, engine: engineVersion, key, changes: [] };
  }
  const changes = [];
  for (let v = declared + 1; v <= engineVersion; v += 1) {
    const entry = CONTRACT_CHANGES[v];
    // A version with no entry is reported as such rather than skipped. Omitting it would make a
    // missing changelog look like a version where nothing changed, which is the more dangerous read.
    changes.push(entry
      ? { version: v, keys: entry.keys, what: entry.what }
      : { version: v, keys: [], what: 'no changelog entry recorded for this version' });
  }
  return { state: 'behind', declared, engine: engineVersion, key, changes };
}

/** The sentence a consumer needs: which keys moved, and that re-reading them is the fix. */
export function contractVersionMessage(gap) {
  if (gap.state === 'current') return null;
  if (gap.state === 'invalid') {
    return `${CONTRACT_VERSION_KEYS[0]} must be a positive integer, got ${JSON.stringify(gap.declared)}`;
  }
  if (gap.state === 'ahead') {
    return `this contract declares ${gap.key ?? CONTRACT_VERSION_KEYS[0]}: ${gap.declared} and this quorate implements `
      + `${gap.engine}. A contract written for a newer engine may rely on meanings this one does not `
      + 'have; upgrade the submodule rather than lowering the number.';
  }
  const moved = [...new Set(gap.changes.flatMap((c) => c.keys))];
  const detail = gap.changes
    .map((c) => `  v${c.version}: ${c.what}${c.keys.length ? ` (${c.keys.join(', ')})` : ''}`)
    .join('\n');
  return `this contract declares ${gap.key ?? CONTRACT_VERSION_KEYS[0]}: ${gap.declared} and this quorate implements `
    + `${gap.engine}. ${moved.length ? `${moved.length} key(s) changed MEANING while their spelling `
      + 'stayed the same, so nothing else can detect this' : 'the change log is incomplete'}:\n${detail}\n`
    + `Re-read those keys, then set ${CONTRACT_VERSION_KEYS[0]}: ${gap.engine} to record that you have.`;
}

/**
 * THE KEY THAT CARRIES THE VERSION, in both spellings.
 *
 * `graph_contract: 2` named the block and versioned the schema with one word: it reads as "this is a
 * graph-contract block" rather than "version 2 of the contract". `graph_contract_version` says what
 * it is. The old spelling is still ACCEPTED — every contract in the world declares it, and a rename
 * that refuses them would make an engine upgrade a breaking change for a cosmetic reason.
 *
 * Preferred order matters: a file carrying both is read from the NEW key, because a migration in
 * progress means someone added the new one and has not yet deleted the old.
 */
export const CONTRACT_VERSION_KEYS = Object.freeze(['graph_contract_version', 'graph_contract']);

/** The declared version, which key carried it, and whether that spelling is on the way out. */
export function declaredContractVersion(contract) {
  for (const key of CONTRACT_VERSION_KEYS) {
    if (contract && Object.prototype.hasOwnProperty.call(contract, key)) {
      return { value: contract[key], key, deprecated: key !== CONTRACT_VERSION_KEYS[0] };
    }
  }
  return { value: undefined, key: null, deprecated: false };
}

/** Does this text carry a contract block? Either spelling, top-level only. */
export const CONTRACT_BLOCK_RE = /^(?:graph_contract_version|graph_contract)\s*:/m;
