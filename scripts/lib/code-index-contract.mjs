// code-index-contract.mjs — is the contract's code_index block in its grammar (code-index.plan.md stage 3)?
//
// One nested map per language: `extractor` (a command; "" means that language is not configured), `globs` (contract
// globs, checked by contractGlobErrors with every other glob key), optional `options` (a map passed unchanged to the
// extractor) and optional `env` (the names that reach it beyond the platform's process basics). Pure, and it returns
// every error rather than the first, as the other contract validators do.
//
// `env` is checked hardest, because it is the only way a variable reaches a command a consumer declared: the rules of
// review.candidate_env (a list, names or NAME_* prefixes, no duplicates, nothing the runner reserves), and on top of them
// no entry that matches a secret-shaped name or admits the ANTHROPIC_ or CLAUDE_CODE_ families — `ANTHROPIC_*` would let
// ANTHROPIC_BASE_URL through even though the credentials themselves are reserved.
import { candidateEnvErrors } from './decisions.mjs';

const LANGUAGE = /^[a-z][a-z0-9_-]*$/;
const LANGUAGE_KEYS = new Set(['extractor', 'globs', 'options', 'env']);
/** A language's keys, for the compatibility freeze (lib/compatibility.mjs), which reads them from here. */
export const CODE_INDEX_LANGUAGE_KEYS = Object.freeze([...LANGUAGE_KEYS]);
const CREDENTIAL_FAMILIES = ['ANTHROPIC_', 'CLAUDE_CODE_'];
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function codeIndexContractErrors(contract = {}) {
  const block = contract?.code_index;
  if (block === undefined || block === null) return [];
  if (!isMap(block)) return [`code_index: ${JSON.stringify(block)} — must be a map of languages, or {} for none`];
  const errors = [];
  for (const [language, spec] of Object.entries(block)) {
    const key = `code_index.${language}`;
    if (!LANGUAGE.test(language)) { errors.push(`${key}: not a language name (lower-case letters, digits, _ and -)`); continue; }
    if (!isMap(spec)) { errors.push(`${key}: ${JSON.stringify(spec)} — must be a map with extractor and globs`); continue; }
    for (const k of Object.keys(spec)) {
      if (!LANGUAGE_KEYS.has(k)) errors.push(`${key}.${k}: not a code_index key (extractor, globs, options, env)`);
    }
    if (typeof spec.extractor !== 'string') errors.push(`${key}.extractor: must be a command, or "" for not configured`);
    if (spec.globs === undefined) errors.push(`${key}.globs: missing; the files this language's extractor reads`);
    if (spec.options !== undefined && !isMap(spec.options)) errors.push(`${key}.options: must be a map, such as { import_roots: ["src"] }`);
    const envKey = `${key}.env`;
    const envErrors = candidateEnvErrors(spec.env, envKey);
    errors.push(...envErrors);
    if (Array.isArray(spec.env)) {
      for (const e of spec.env) {
        if (typeof e !== 'string') continue;
        const folded = e.toUpperCase();
        const family = CREDENTIAL_FAMILIES.find((f) => folded.startsWith(f) || (folded.endsWith('*') && f.startsWith(folded.slice(0, -1))));
        // The secret shape is candidateEnvErrors' own refusal above (G-14 of 20261020-105833-ciss-remediation-2-review).
        if (family) errors.push(`${envKey}: ${e} admits the ${family} family, which carries the operator's Claude credentials`);
      }
    }
  }
  return errors;
}
