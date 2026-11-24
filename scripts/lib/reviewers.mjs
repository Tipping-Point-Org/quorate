// reviewers.mjs — load the external-reviewer adapter table, and answer questions about a vendor.
//
// The table is DATA (scripts/reviewers.json). This module is the only thing that reads it, and it
// exists because lib/decisions.mjs is the pure layer — no I/O, no environment, no clock — so it can
// render an argv from an adapter but must not go looking for one.
//
// Why the table exists at all: `reviewer` used to be a closed set of three names, hardcoded in a
// switch, with six more branches in external-review.mjs and five in check-panel.mjs. Models and
// efforts were configurable per the standing requirement; the vendor, which is the same class of
// fact, was not. Replacing agy with another CLI was an eight-file edit.
//
// A CONSUMER may extend the table without touching the engine: `reviewers:` in the graph_contract
// adds entries or overrides fields on a built-in one, and the merged result is what a run records.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireIo } from './io-param.mjs';
import { minutes, TIMER_MAX_MS as MAX_TIMER_MS } from './check-timeout.mjs';
import { toolListErrors } from './tool-lists.mjs';
import { readRunJson } from './reviews-root.mjs';

// NO node:fs OR node:child_process HERE (os-platform-adapters stage 3c). The table is read through an
// injected reader or the platform implementation passed as `io`; scripts/io/reviewers.mjs binds it.

/** A reader: the injected function if one was given, else `io`'s — which is then required. */
function readerOf(readFileOrIo, fn) {
  return typeof readFileOrIo === 'function' ? readFileOrIo : requireIo(readFileOrIo, fn).fs.readFileSync;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLE_PATH = path.join(HERE, '..', 'reviewers.json');

/** Fields an adapter must carry to be usable at all. Everything else has a defensible default. */
const REQUIRED = ['cmd'];

/**
 * The built-in table, parsed. Throws rather than returning an empty set: a missing or unparseable
 * adapter table means every arm would silently become "unknown reviewer", and a panel that reports
 * no arms is indistinguishable from a panel that found nothing — the one confusion this project
 * refuses everywhere.
 */
export function builtinReviewers(readFileOrIo) {
  const raw = readerOf(readFileOrIo, 'builtinReviewers')(TABLE_PATH, 'utf8');
  const table = JSON.parse(raw);
  if (!table || typeof table.reviewers !== 'object') {
    throw new Error(`reviewers.json carries no \`reviewers\` map (${TABLE_PATH})`);
  }
  return table.reviewers;
}

/**
 * Built-ins plus whatever the contract declares, with per-field override.
 *
 * A consumer entry MERGES over a built-in of the same name rather than replacing it, so pinning a
 * different model flag does not silently drop the credential allow-list or the usage mapping.
 */
/** The whole table file, including keys outside `reviewers` — the declared default lives there. */
export function rawTable(readFileOrIo) {
  return JSON.parse(readerOf(readFileOrIo, 'rawTable')(TABLE_PATH, 'utf8'));
}

export function mergeReviewers(builtin, declared = {}) {
  const out = { ...builtin };
  for (const [name, entry] of Object.entries(declared ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    // PREFIXES NEVER COME FROM A CONSUMER (G-12 of 20260925-015614-platform-review). A contract could
    // declare `env_prefixes: ["AWS_"]` and every AWS_* variable crossed into that vendor's process.
    // Prefixes are quorate's, per built-in vendor, in reviewers.json; a consumer names exact variables
    // (`env_names`). Mint refuses the declaration outright (declaredEnvErrors); dropping it here as
    // well is what holds on the paths that never mint — a reviewer so declared gets fewer credentials
    // and fails visibly, instead of more.
    const { env_prefixes: _refused, ...safe } = entry;
    out[name] = mergeEntry(builtin[name] ?? {}, safe);
  }
  return out;
}

/**
 * Which built-ins the contract OVERRIDES, as data (reviewer-credential-routing, D1 = A, A-26).
 *
 * An entry merged over a built-in keeps that vendor's credentials (G-29), so an override of its `cmd`
 * or argv changes WHERE they go. That is a decision the contract makes and the reader is told,
 * on every path that runs the overridden built-in. This is the one answer those paths share.
 *
 * `{ name, roles, fields, prefixes }` per override: `roles` from the BUILT-IN, so a reviewer and a
 * node runtime are told apart; `fields` the top-level keys the entry sets, sorted — a refused
 * `env_prefixes` is not one; `prefixes` the vendor prefixes the merged entry keeps, for a reviewer
 * only. A node runtime has none: spawn-node never reads `env_prefixes`, it gives a node the scrubbed
 * environment. A name that is not a built-in is an addition, and an empty entry overrides nothing.
 */
export function builtinOverrides(builtin, declared = {}) {
  const out = [];
  for (const [name, entry] of Object.entries(declared ?? {})) {
    if (!entry || typeof entry !== 'object' || !Object.hasOwn(builtin ?? {}, name)) continue;
    const fields = Object.keys(entry).filter((k) => k !== 'env_prefixes').sort();
    if (!fields.length) continue;
    const roles = rolesOf(builtin[name]);
    out.push({ name, roles, fields, prefixes: roles.includes('reviewer') ? [...envPrefixesOf(builtin[name])] : [] });
  }
  return out;
}

/** One override as one sentence, worded by role. Every path prints this, so they cannot disagree. */
export function overrideLine(o) {
  const set = `${o.fields.join(', ')} set by the contract`;
  if (!o.roles.includes('reviewer')) {
    return `${o.name} (node runtime) — ${set}; every node spawned on this runtime gets the scrubbed environment, `
      + "the runtime's own auth included";
  }
  const creds = o.prefixes.length ? `${o.prefixes.map((p) => `${p}*`).join(', ')} go to it` : 'no vendor prefixes go to it';
  return `${o.name} — ${set}; ${creds}`;
}

/**
 * The lines spawn-subagent printed for its caller to pass on (G-6, G-7 of 20261105-163851-crsf-d1-review): a caller that
 * captures its stderr and reads it only on failure dropped the override notice above on success. Its own lines only.
 */
export function subagentNotices(stderr) {
  return String(stderr ?? '').split(/\r?\n/).filter((l) => l.startsWith('spawn-subagent:'));
}

/**
 * One level deeper for the NESTED blocks, because that is where the sandbox lives (G-29).
 *
 * The promise above — "pinning a different model flag does not silently drop the credential
 * allow-list" — was true of the top level and false of everything under it. A node runtime's whole
 * vocabulary sits inside `node_runtime`, so a consumer overriding one flag there replaced the block
 * entire: `settings`, `permission_mode`, `deny_tools` and the tool names all vanish, and the result
 * is a runtime that spawns with no policy file and no denials while every artifact still reports a
 * sandboxed node. spawn-node's unbacked-capability refusal catches part of that today — a
 * capability with no mechanism is refused — but only because the capability LIST survives the
 * shallow merge while its mechanisms do not, which is coincidence rather than design.
 *
 * Deliberately ONE level, not a deep merge. A deep merge of ARRAYS is a policy question with no
 * right answer (does declaring `deny_intent` add to the built-in list or replace it?), and the
 * honest answer here is replace: an operator naming a deny list means that list. So an array or a
 * scalar overrides, and only a plain object is merged into its built-in counterpart — one level, at
 * the boundary where a block groups fields that belong together.
 */
function mergeEntry(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    const mergeable = (x) => x && typeof x === 'object' && !Array.isArray(x);
    out[k] = mergeable(b) && mergeable(v) ? { ...b, ...v } : v;
  }
  return out;
}

/**
 * Every reason this adapter cannot be used, or []. Checked at MINT, before anything spawns, so a
 * contract that adds a vendor fails with a named reason rather than at the moment an arm would have
 * transmitted something.
 */
export function adapterErrors(name, a) {
  const errs = [];
  if (!a || typeof a !== 'object') return [`reviewer '${name}' is not an object`];
  for (const k of REQUIRED) if (!a[k]) errs.push(`reviewer '${name}' declares no ${k}`);
  // A STRING, NOT A TRUTHY VALUE (G-4 of 20261022-034225-cid1a-remediation-2-review): an array or object passed here and
  // made spawnSync throw at the first call instead of a named refusal at mint.
  if (a.cmd && !(typeof a.cmd === 'string' && a.cmd.trim())) {
    errs.push(`reviewer '${name}': cmd must be a non-empty string, got ${JSON.stringify(a.cmd)}`);
  }

  // PER ROLE, because `cmd` alone was the entire requirement and an adapter with no way to deliver a
  // prompt or read an answer passed (G-28, panel-codex-contract). I-19 and I-21 ask for adapters
  // rejected at mint unless they declare the mechanisms their role needs — and the cost of not
  // checking lands late: an arm that cannot be handed a prompt still spawns, still spends, and comes
  // back as "returned no parseable verdict envelope", which reads as a broken vendor.
  //
  // Role-derived rather than demanded of every entry: a NODE runtime has no `response` mapping and
  // needs none, so requiring one would refuse the one adapter that ships.
  const roles = rolesOf(a);
  if (roles.includes('reviewer')) {
    if (!a.response?.from) {
      errs.push(`reviewer '${name}' declares no response.from — nothing says where its answer comes from`);
    }
    // `prompt.required: false` is the declared exception: that adapter reviews the diff it is
    // pointed at and supplies its own subject.
    if (a.prompt?.required !== false && !reviewerPromptVia(a)) {
      errs.push(`reviewer '${name}' declares no prompt.via — nothing says how to hand it the prompt`);
    }
  }
  if (roles.includes('node') && !a.node_runtime?.prompt?.flag) {
    errs.push(`runtime '${name}' declares no node_runtime.prompt.flag — nothing says how to hand a node its instructions`);
  }
  // THE RUNTIME'S TRANSPORT (decision-panel-seats.plan.md stage 2): `stdin` or `argv`; a stdin prompt needs the bare
  // marker the argv carries in its place (`claude -p`, no text after it), since the renderer drops an empty flag value.
  if (a.node_runtime?.prompt) {
    const via = runtimePromptVia(a);
    if (!['stdin', 'argv'].includes(via)) {
      errs.push(`runtime '${name}': node_runtime.prompt's via must be 'stdin' or 'argv', got ${JSON.stringify(via)}`);
    }
    const marker = a.node_runtime.prompt.argv_marker;
    if (via === 'stdin' && !(typeof marker === 'string' && marker.trim())) {
      errs.push(`runtime '${name}': a stdin-delivered node prompt needs node_runtime.prompt.argv_marker, the bare flag the argv carries`);
    }
  }
  errs.push(...listingAllowErrors(name, a));
  // EVERY TOOL LIST IN ITS DECLARED SHAPE (adapter-tool-lists.plan.md stage 3; operator, 2026-10-26: "C B"): refused here,
  // at mint and before each external call, so a malformed list is named once instead of crashing the reader that meets
  // it (G-3 of 20261026-194518-rct-remediation-3-review).
  errs.push(...toolListErrors(name, a));

  const promptVia = reviewerPromptVia(a);
  // `stdin-ndjson` (decision-panel-seats.plan.md stage 3; DP-D2 A): one NDJSON user line on stdin, agy's stream-json
  // input. A reviewer transport only; the runtime's via is checked above against stdin and argv.
  if (promptVia && !['stdin', 'argv', 'stdin-ndjson'].includes(promptVia)) {
    errs.push(`reviewer '${name}': prompt.via must be 'stdin', 'argv' or 'stdin-ndjson', got ${JSON.stringify(promptVia)}`);
  }
  // THE ARGV BUDGET BELONGS TO ARGV: a reviewer whose prompt goes on stdin is not held to it, and a budget it declares
  // anyway would read as a limit that still applies.
  if (promptVia && promptVia !== 'argv' && a.prompt?.budget_bytes !== undefined) {
    errs.push(`reviewer '${name}': prompt.budget_bytes is the inline-argv budget, and its prompt goes by ${promptVia}`);
  }
  if (promptVia === 'argv' && !a.prompt?.placeholder) {
    errs.push(`reviewer '${name}': an argv-delivered prompt needs prompt.placeholder naming the token to replace`);
  }
  // NO SHELL FOR AN INLINE PROMPT (G-4 of 20261111-011856-dps-remediation-9-review): cmd.exe would re-parse the command line
  // and truncate a multi-line prompt, and external-review's argv branch does not quote it.
  if (promptVia === 'argv' && a.needs_shell_on_windows) {
    errs.push(`reviewer '${name}': needs_shell_on_windows cannot be set with an argv-delivered prompt, which a shell would re-parse`);
  }

  const responseFrom = a.response?.from;
  // `ndjson-result` (decision-panel-seats.plan.md stage 3): the `result` object of the final {"event":"result"} line of an
  // NDJSON stdout, agy's stream-json reply.
  if (responseFrom && !['file', 'stdout-wrapper', 'ndjson-result'].includes(responseFrom)) {
    errs.push(`reviewer '${name}': response.from must be 'file', 'stdout-wrapper' or 'ndjson-result', got ${JSON.stringify(responseFrom)}`);
  }
  if ((responseFrom === 'stdout-wrapper' || responseFrom === 'ndjson-result') && !a.response?.field) {
    errs.push(`reviewer '${name}': a ${responseFrom} response needs response.field naming which key holds the answer`);
  }
  errs.push(...deniedStepErrors(name, a.response));
  const usageSource = a.usage?.from;
  if (a.usage && !['json-events', 'stdout-wrapper', 'ndjson-result'].includes(usageSource)) {
    errs.push(`reviewer '${name}': usage.from must be 'json-events', 'stdout-wrapper' or 'ndjson-result', got ${JSON.stringify(usageSource)}`);
  }
  // Reading the wrong field is not a small mistake: agy's wrapper carries its own transport `status`
  // beside the reviewer's answer, and taking that one reports a refusal as a success.

  const effortStyle = a.effort?.style;
  if (effortStyle && !['flag', 'config-kv', 'none'].includes(effortStyle)) {
    errs.push(`reviewer '${name}': effort.style must be 'flag', 'config-kv' or 'none'`);
  }
  if (effortStyle === 'flag' && !a.effort?.flag) errs.push(`reviewer '${name}': effort.style 'flag' needs effort.flag`);
  if (effortStyle === 'config-kv' && !(a.effort?.flag && a.effort?.key)) {
    errs.push(`reviewer '${name}': effort.style 'config-kv' needs effort.flag and effort.key`);
  }

  // Refused, and not iterated (G-5 of 20261022-034225-cid1a-remediation-2-review): an object or number threw TypeError
  // below and the mint aborted with no named refusal.
  const prefixesOk = Array.isArray(a.env_prefixes ?? []);
  if (!prefixesOk) errs.push(`reviewer '${name}': env_prefixes must be an array`);
  // AN EMPTY PREFIX IS NOT A PREFIX (G-16). Every variable name startsWith(''), so one blank entry
  // turns the reviewer credential ALLOW-list into the operator's whole environment, handed to a
  // third-party agentic CLI. reviewerEnv drops it — that layer is pure and cannot fail a run — and
  // this is where it gets NAMED, at mint, before anything spawns: a declaration that would have
  // leaked everything should not merely be quietly narrowed to nothing.
  for (const p of prefixesOk ? a.env_prefixes ?? [] : []) {
    if (typeof p !== 'string' || !p.trim()) {
      errs.push(`reviewer '${name}': env_prefixes contains ${JSON.stringify(p)} — an empty prefix `
        + 'matches every variable name and would forward the entire environment');
    }
  }

  // THE PROBE'S DATA (reviewer-preflight stage 1). The version command keys a probe record, and the three limits bound
  // the probe, its version command and the mint's wait — configuration, never a literal in a script. Each is optional
  // (an absent limit takes reviewers.json's probe_defaults; an absent version_argv keys as 'undeclared'), but a
  // declared one that is malformed is refused here, at mint, before anything spawns.
  if (a.version_argv !== undefined
    && !(Array.isArray(a.version_argv) && a.version_argv.length
      && a.version_argv.every((x) => typeof x === 'string' && x.trim()))) {
    errs.push(`reviewer '${name}': version_argv must be a non-empty array of non-empty strings, got ${JSON.stringify(a.version_argv)}`);
  }
  errs.push(...probeLimitErrors(name, a));
  // THE FAMILY, when declared (runtime-call-telemetry.plan.md stage 1): a string, or a list matched by model-name prefix.
  // Absent is allowed, and familyOfCall then answers with the adapter's name; a malformed one is refused here, at mint.
  if ('family' in a) {
    const f = a.family;
    const entryOk = (e) => e && typeof e === 'object' && typeof e.model === 'string' && typeof e.family === 'string' && e.family.trim();
    if (!((typeof f === 'string' && f.trim()) || (Array.isArray(f) && f.length && f.every(entryOk)))) {
      errs.push(`reviewer '${name}': family must be a non-empty string or a non-empty list of { model: "<prefix>", family: "<name>" }, got ${JSON.stringify(f)}`);
    }
  }
  return errs;
}

/**
 * THE ONE FAMILY RULE (runtime-call-telemetry.design.md CR-D3 A; operator, 2026-10-26: "A A"). A family belongs to a model,
 * so it is declared on the adapter that serves it: a string for a CLI of one family, a list matched by model-name prefix
 * (first match wins, an empty prefix matching every model) for a CLI that serves several. Every caller that decides a
 * family asks this, with the merged adapter table (a consumer's override included). An adapter that declares none answers
 * with its own name, as the old rules did; an unknown reviewer, or a model no entry matches, is null, never guessed.
 */
export function familyOfCall({ reviewer, model } = {}, table = {}) {
  const a = reviewer ? table?.[reviewer] : null;
  if (!a || typeof a !== 'object') return null;
  const f = a.family;
  if (typeof f === 'string' && f.trim()) return f;
  if (Array.isArray(f)) {
    const m = String(model ?? '');
    const hit = f.find((e) => e && typeof e.model === 'string' && m.startsWith(e.model));
    return hit && typeof hit.family === 'string' ? hit.family : null;
  }
  return reviewer;
}

/**
 * Every reason this adapter's own declared probe limits cannot be used, or []. A part of adapterErrors, and apart from it
 * because the mint skips the limits' sum only for these (G-1 of 20261022-151016-pls-remediation-b-review): an unrelated
 * adapter error, a missing prompt.via, hid the sum's refusal until a second mint.
 */
export function probeLimitErrors(name, a) {
  if (!a || typeof a !== 'object') return [`reviewer '${name}' is not an object`];
  return PROBE_LIMITS.map((field) => [field, a[field] === undefined ? null : probeLimitError(field, a[field])])
    .filter(([, why]) => why).map(([field, why]) => `reviewer '${name}': ${field}: ${why}`);
}

/** The probe's limits, per adapter; an absent one takes reviewers.json's `probe_defaults` (reviewer-preflight). */
export const PROBE_LIMITS = ['probe_timeout_minutes', 'version_timeout_seconds', 'check_margin_seconds'];

// A NODE TIMER'S CEILING (G-10 of 20261010-071234-reviewer-preflight-r7): a finite but huge limit, 1e308 minutes, became
// Infinity milliseconds and made the spawn throw. Each limit must fit 2^31-1 ms once in milliseconds; the ceiling is the
// minutes owner's (G-9 of 20261022-013653-cid1a-delivery).
const LIMIT_MS_PER_UNIT = { version_timeout_seconds: 1_000, check_margin_seconds: 1_000 };
/** Why probe limit `field` cannot be `v`, or null when it can. */
function probeLimitError(field, v) {
  // The one minutes value among the three goes through the owner of minutes values (code-index-d1-part-a.plan.md
  // stage 2), BEFORE any type test: the owner takes a digit string, and this refused one (G-18 of
  // 20261022-013653-cid1a-delivery). ITS REFUSAL IS THE ONE REPORTED (G-7 of 20261022-025041-cid1a-remediation-review):
  // a caught-and-dropped exception left the mint restating the bound in its own words. The two seconds limits keep this
  // rule, which is the same bound in their unit.
  if (field === 'probe_timeout_minutes') {
    try { minutes('reviewers.probe_timeout_minutes', v); return null; } catch (e) { return e.message; }
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v * LIMIT_MS_PER_UNIT[field] <= MAX_TIMER_MS) return null;
  return `must be a positive number a timer can hold (at most ${MAX_TIMER_MS} ms), got ${typeof v === 'number' ? String(v) : JSON.stringify(v)}`;
}

/** Every reason reviewers.json's probe_defaults cannot serve as the adapters' fallback limits (G-10 of 20261010-063310). */
export function probeDefaultsErrors(defaults) {
  return PROBE_LIMITS.map((k) => [k, probeLimitError(k, defaults?.[k])]).filter(([, why]) => why)
    .map(([k, why]) => `probe_defaults.${k}: ${why}`);
}

/** Credential prefixes this vendor may inherit. An unknown reviewer gets NONE — fail closed. */
/**
 * Which modes this adapter can serve. Absent means all of them.
 *
 * `codex-review` supports only `review`, and that was a `reviewer === 'codex-review'` branch in
 * external-review.mjs — one of the last three places a vendor NAME still decided anything, after the
 * adapter table was introduced precisely to end that. A capability belongs beside the vendor that
 * has it, or the next adapter needs a fourth branch.
 */
export function supportsMode(adapter, mode) {
  const modes = adapter?.modes;
  return Array.isArray(modes) ? modes.includes(mode) : true;
}

/**
 * Does this adapter need a prompt file? Absent means yes.
 *
 * `codex-review` reviews the diff it is pointed at and supplies its own subject. Stated as data so
 * a future adapter with the same property does not need the engine edited to accommodate it.
 */
export function needsPrompt(adapter) {
  return adapter?.prompt?.required !== false;
}

/**
 * HOW A NODE RUNTIME IS HANDED ITS PROMPT (decision-panel-seats.plan.md stage 2; design DP-D1 A): `node_runtime.prompt.via`,
 * `stdin` or `argv`, absent read as `argv`. Its one reader: no module reads the property itself (a census holds that).
 * A prompt inline in argv is capped by Windows near 32,767 characters (decision 20261107-213602-4f3308's Claude seat:
 * `spawn ENAMETOOLONG`), so the shipped runtime takes it on stdin.
 */
export function runtimePromptVia(adapter) {
  const via = adapter?.node_runtime?.prompt?.via;
  return via === undefined ? 'argv' : via;
}

/**
 * HOW A REVIEWER IS HANDED ITS PROMPT: the top-level `prompt.via`, `stdin` or `argv` (a different property from the
 * runtime's above, counted apart). Undefined when the adapter declares none (`prompt.required: false`). Its one reader.
 */
export function reviewerPromptVia(adapter) {
  return adapter?.prompt?.via;
}

/**
 * WHAT A REVIEWER'S STDIN CARRIES, or null when its prompt goes by argv (decision-panel-seats.plan.md stage 3; DP-D2 A):
 * `stdin`, the text itself; `stdin-ndjson`, one line `{"event":"user","message":{"role":"user","content":<text>}}`, the
 * one input agy's `--input-format stream-json` reads (a message without `event` is refused, measured 2026-11-09).
 */
export function reviewerPromptInput(adapter, text) {
  const via = reviewerPromptVia(adapter);
  if (via === 'stdin') return String(text ?? '');
  if (via === 'stdin-ndjson') return `${JSON.stringify({ event: 'user', message: { role: 'user', content: String(text ?? '') } })}\n`;
  return null;
}

/**
 * THE FINAL RESULT OF AN NDJSON STREAM: the `result` object of the last `{"event":"result",…}` line, or null. A line that
 * is not JSON (a torn tail) is skipped, never thrown on. Read in place, line by line, as usageFrom's json-events is.
 */
export function ndjsonResult(text) {
  const raw = String(text ?? '');
  let found = null;
  for (let at = 0; at < raw.length;) {
    const nl = raw.indexOf('\n', at);
    const end = nl === -1 ? raw.length : nl;
    const t = raw.slice(at, end).trim();
    at = end + 1;
    if (!t.startsWith('{') || !t.includes('"result"')) continue;
    try {
      const ev = JSON.parse(t);
      if (ev?.event === 'result' && ev.result && typeof ev.result === 'object') found = ev.result;
    } catch { /* a partial line is not an event */ }
  }
  return found;
}

/**
 * WHY AN ndjson-result REVIEWER FAILED, or null when its stream ends in a SUCCESS result: `{status, error}`. A result whose
 * status is not SUCCESS is the reviewer's own failure, never read as an empty answer; a stream with no result event at
 * all is a failure too (status null). `error` is the result's own error text, '' when it gives none: the VENDOR'S text,
 * which a caller may classify (a usage limit) but never quotes into a reason that can be committed (G-43; the raw
 * output is kept on the gitignored side). Null for any other adapter.
 */
export function ndjsonFailure(adapter, stdout) {
  if (adapter?.response?.from !== 'ndjson-result') return null;
  const ev = ndjsonResult(stdout);
  if (!ev) return { status: null, error: '' };
  if (ev.status === 'SUCCESS') return null;
  const err = ev.error;
  const error = typeof err === 'string' ? err : err && typeof err === 'object' ? String(err.message ?? JSON.stringify(err)) : '';
  return { status: typeof ev.status === 'string' ? ev.status : JSON.stringify(ev.status ?? null), error: error.trim() };
}

/**
 * A BARE DIRECTORY LISTING, AND NOTHING ELSE (decision-panel-seats.plan.md stage 6; operator, 2026-11-11: "A. Allow listing
 * only (Recommended)"): a listing command (`Get-ChildItem`, `gci`, `ls` with `-` flags; `dir` with `/` flags), flags
 * only, single spaces: no path, no second command, no redirect. agy's `command(<x>)` rule admits exactly the line x
 * (measured 2026-11-11 with agy 1.5.5 and 1.5.6, scripts/reviewers.json's `$listing_allow`), so a list of lines of this shape admits listings of the working
 * directory and nothing more.
 */
const BARE_LISTING = /^(?:(?:Get-ChildItem|gci|ls)(?: -[A-Za-z]+)*|dir(?: \/[A-Za-z])*)$/;
/**
 * Why an adapter's `listing_allow` cannot be used, or []: `{modes, flag, commands}`, the modes exactly `['decide']` (the
 * one the operator allowed it for), the flag a CLI option, every command a bare listing. Absent is nothing to check.
 */
export function listingAllowErrors(name, a) {
  const l = a?.listing_allow;
  if (l === undefined) return [];
  const errs = [];
  if (!l || typeof l !== 'object' || Array.isArray(l)) return [`reviewer '${name}': listing_allow must be an object`];
  if (!(Array.isArray(l.modes) && l.modes.length === 1 && l.modes[0] === 'decide')) {
    errs.push(`reviewer '${name}': listing_allow applies to the decide mode only (modes: ["decide"]), got ${JSON.stringify(l.modes)}`);
  }
  if (!(typeof l.flag === 'string' && /^-/.test(l.flag))) errs.push(`reviewer '${name}': listing_allow.flag must be a CLI option, got ${JSON.stringify(l.flag)}`);
  if (!(Array.isArray(l.commands) && l.commands.length)) errs.push(`reviewer '${name}': listing_allow.commands must be a non-empty list`);
  for (const c of Array.isArray(l.commands) ? l.commands : []) {
    if (!(typeof c === 'string' && BARE_LISTING.test(c))) {
      errs.push(`reviewer '${name}': listing_allow.commands holds ${JSON.stringify(c)}, which is not a bare directory listing (a listing command and flags only)`);
    }
  }
  return errs;
}

/**
 * THE TOOLS A HEADLESS REVIEWER WAS DENIED (decision-panel-seats.plan.md stage 6; operator, 2026-11-10: "A. Detect, retry
 * once (Recommended)"): from an NDJSON stream, each `tool` step that ended in ERROR because a permission check refused it.
 * agy auto-denies a tool it cannot prompt for in headless mode (measured: 20261110-214705-sfo-remediation-3-review, its
 * adjudicator's `run_command`). Each name is returned only when it is a plain identifier, else as "a tool": a name may be
 * committed in a reason, the vendor's free text never (G-43). Unique, in order of appearance. A result's `denied_actions`
 * with no such step is not read: the named failure is a denied tool STEP, then an empty result (G-11 of
 * 20261110-230425-dps-remediation-6-review-b).
 */
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const atPath = (o, dotted) => dotted.split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), o);
// WHAT A DENIED STEP LOOKS LIKE IS THE ADAPTER'S `response.denied_step` (G-9 of 20261110-234941-dps-remediation-7-review; A-9):
// an adapter that declares none has no denial this can recognise, and is never retried for one.
export function ndjsonDeniedTools(text, adapter) {
  const shape = adapter?.response?.denied_step;
  if (!shape) return [];
  const raw = String(text ?? '');
  const refusal = new RegExp(shape.pattern, 'i');
  const names = [];
  const add = (n) => { const s = typeof n === 'string' && TOOL_NAME.test(n) ? n : 'a tool'; if (!names.includes(s)) names.push(s); };
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    const step = ev?.event === shape.event ? atPath(ev, shape.body) : null;
    if (!step || typeof step !== 'object') continue;
    if (Object.entries(shape.where).every(([k, v]) => atPath(step, k) === v) && refusal.test(String(atPath(step, shape.message) ?? ''))) {
      add(shape.name.map((p) => atPath(step, p)).find((n) => n !== null && n !== undefined));
    }
  }
  return names;
}

/**
 * Every reason an adapter's `response.denied_step` cannot be read, or []. A part of adapterErrors: refused at mint, so the
 * reader above can take its shape as given. Absent is allowed, and such an adapter is never retried for a denied tool.
 */
function deniedStepErrors(name, response) {
  const shape = response?.denied_step;
  if (shape === undefined) return [];
  const at = `reviewer '${name}': response.denied_step`;
  if (response.from !== 'ndjson-result') return [`${at} is read from an NDJSON stream, and this response is from ${JSON.stringify(response.from)}`];
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) return [`${at} must be an object`];
  const text = (v) => typeof v === 'string' && v.trim() !== '';
  const errs = [];
  for (const key of ['event', 'body', 'message', 'pattern']) if (!text(shape[key])) errs.push(`${at}.${key} must be a non-empty string`);
  if (!shape.where || typeof shape.where !== 'object' || Array.isArray(shape.where) || !Object.keys(shape.where).length) {
    errs.push(`${at}.where must be an object naming at least one field and its value`);
  }
  if (!Array.isArray(shape.name) || !shape.name.length || !shape.name.every(text)) errs.push(`${at}.name must be a non-empty array of field paths`);
  if (text(shape.pattern)) {
    try { new RegExp(shape.pattern, 'i'); } catch (e) { errs.push(`${at}.pattern does not compile: ${e.message}`); }
  }
  return errs;
}

/**
 * A DENIED TOOL AND NO ANSWER, or null: an ndjson-result reviewer whose final result is a SUCCESS with an empty response
 * and no structured output, after a tool was denied. `{tools}` names them. A denial the model worked around (an answer)
 * is not this cause, nor is a non-SUCCESS result (ndjsonFailure's), nor an empty answer with no denial.
 */
export function deniedEmptyAnswer(adapter, stdout) {
  if (adapter?.response?.from !== 'ndjson-result') return null;
  const ev = ndjsonResult(stdout);
  if (!ev || ev.status !== 'SUCCESS') return null;
  if (typeof ev.response === 'string' && ev.response.trim()) return null;
  // Where the answer lives is the adapter's, read by its one reader (G-12 of 20261110-230425-dps-remediation-6-review-b).
  if (responseFrom(adapter, { stdout })) return null;
  const tools = ndjsonDeniedTools(stdout, adapter);
  return tools.length ? { tools } : null;
}

/**
 * WHAT IS LEFT OF A CALL'S LIMIT FOR ITS ONE RETRY, or null when nothing is: a retry shares the call's limit, so
 * --timeout-minutes bounds the two together and a caller's backstop of that limit plus a margin still fires only on a
 * wedged child (G-6 of 20261110-230425-dps-remediation-6-review-b).
 */
export function retryLimitMs(limitMs, elapsedMs) {
  const left = limitMs - elapsedMs;
  return left > 0 ? left : null;
}

/**
 * THE ONE RULE FOR WHAT COUNTS AS SUMMABLE USAGE (G-13 of 20261110-230425-dps-remediation-6-review-b): a usage object's
 * finite numeric fields at the top level, added into `acc`. True when any was. Nested breakdowns are not summed.
 */
export function addUsage(acc, usage) {
  if (!usage || typeof usage !== 'object') return false;
  let any = false;
  for (const [k, v] of Object.entries(usage)) if (typeof v === 'number' && Number.isFinite(v)) { acc[k] = (acc[k] ?? 0) + v; any = true; }
  return any;
}

/** Two calls' usage added field by field, so a retried call is not counted as one; null when neither has any. */
export function sumUsage(a, b) {
  const out = {};
  const any = [addUsage(out, a), addUsage(out, b)].some(Boolean);
  return any ? out : null;
}

/**
 * THE TEXT A SCHEMALESS ANSWER IS SCANNED IN: for an ndjson-result reviewer the final result's `response`, since in the raw
 * stream the answer is a string inside a JSON line and a brace scan skips string contents (the defect lib/decisions.mjs
 * records for codex's --json stream); for any other adapter, stdout as given.
 */
export function schemalessText(adapter, stdout) {
  if (adapter?.response?.from !== 'ndjson-result') return String(stdout ?? '');
  const r = ndjsonResult(stdout)?.response;
  return typeof r === 'string' ? r : '';
}

/**
 * Which ROLES this table entry can serve: 'reviewer' (a panel arm or tie-breaker) and/or 'node' (a
 * sandboxed graph node).
 *
 * ONE TABLE, TWO ROLES, and for a while nothing said so. Adding the Claude Code node runtime to the
 * adapter table immediately broke check-panel, which probes "every vendor the engine can spawn" and
 * happily included a runtime that is not a reviewer at all — it would have launched a probe against
 * a CLI with no response mapping and reported the transport accordingly.
 *
 * Declared with `roles:` when an entry serves an unobvious set; inferred otherwise from what the
 * entry actually carries, because a `node_runtime` block and a `response` mapping are what the two
 * roles respectively need. Inference rather than a required field so no existing entry had to be
 * touched to keep working — but an entry may always say so explicitly and be believed.
 */
export function rolesOf(adapter) {
  const declared = adapter?.roles;
  if (Array.isArray(declared) && declared.length) return [...declared];
  const roles = [];
  if (adapter?.response || adapter?.schema) roles.push('reviewer');
  if (adapter?.node_runtime) roles.push('node');
  return roles.length ? roles : ['reviewer'];
}

/** Does this entry serve `role`? */
export const servesRole = (adapter, role) => rolesOf(adapter).includes(role);

/**
 * The runtime the orchestrator spawns a node on when nothing says otherwise.
 *
 * `args.runtime ?? 'claude'` was a vendor name in the spawner, which is the one thing the adapter
 * table exists to end — and the operator was right that "Claude is the only one that works today"
 * is fine while "the orchestrator hardcodes Claude" is not. The table declares its own default;
 * the orchestrator reads it.
 *
 * Throws rather than guessing: a table with no default and a caller with no --runtime is a
 * configuration nobody decided, and picking one for them would put the name back in the engine.
 */
export function defaultNodeRuntime(table, raw = null) {
  const declared = raw?.default_node_runtime;
  if (typeof declared === 'string' && declared.trim()) return declared.trim();
  const nodes = Object.entries(table ?? {}).filter(([, a]) => servesRole(a, 'node'));
  if (nodes.length === 1) return nodes[0][0];
  throw new Error(
    'no default node runtime: declare `default_node_runtime` in the adapter table, or pass '
    + '--runtime. The orchestrator does not pick a vendor.',
  );
}

/**
 * THE ONE PLACE THE CONTRACT'S ADAPTER TABLE AND NODE RUNTIME ARE CHOSEN (contract-runtime-and-session-files.plan.md stage 1;
 * design CR-D1 A, CR-D2 A, operator 2026-11-05). Fifteen files each merged the declarations and picked the runtime
 * themselves, and three remediation rounds found one after another getting it wrong (overrides ignored, then
 * `review.runtime` ignored). Every site calls this; a census test refuses one that composes its own.
 *
 * - `table`: the built-ins with the contract's `reviewers:` merged over them (`mergeReviewers`).
 * - `overrides`: every built-in the contract overrides (`builtinOverrides`), for the A-26 notice.
 * - `runtime`: `runtimeArg` (an explicit `--runtime`, as spawn-node takes from the frozen run), else the contract's
 *   `review.runtime`, else the table's declared default. A name the table lacks, or a `review.runtime` that is not a name,
 *   is refused, naming it. Computed when first read, so a caller needing only the table is never refused for a runtime it
 *   does not use.
 *
 * `contract` gives both the declarations and `review`; `declared` stands in for `contract.reviewers` where a caller has
 * only the declarations (declaredReviewers' answer).
 */
export function selectAdapters({ builtins, raw = null, contract = null, declared = undefined, runtimeArg = null } = {}) {
  if (!builtins || typeof builtins !== 'object') throw new Error('selectAdapters: builtins (the adapter table) is required');
  const decl = declared ?? contract?.reviewers ?? {};
  const table = mergeReviewers(builtins, decl);
  const overrides = builtinOverrides(builtins, decl);
  let chosen;
  const out = { table, overrides };
  // WHAT WAS DECLARED, decided once (G-10 of 20261105-173030-crsf-d1-remediation-review): the getter and runtimeDeclared
  // each computed it, two definitions of one fact that could drift apart. Both read these.
  const key = contract?.review?.runtime;
  // --runtime first, and only absent when absent (G-9, G-10 of 20261105-070121-crsf-remediation-2-review): the
  // contract value was refused before the flag was asked, and a blank flag was read as no flag.
  const given = runtimeArg !== undefined && runtimeArg !== null;
  const keyDeclared = key !== undefined && key !== null;
  Object.defineProperty(out, 'runtime', {
    enumerable: true,
    get() {
      if (chosen !== undefined) return chosen;
      if (given && !(typeof runtimeArg === 'string' && runtimeArg.trim())) {
        throw new Error(`--runtime must be an adapter name, not ${JSON.stringify(runtimeArg)}`);
      }
      if (!given && keyDeclared && !(typeof key === 'string' && key.trim())) {
        throw new Error(`review.runtime must be an adapter name, not ${JSON.stringify(key)}`);
      }
      const name = given ? runtimeArg.trim()
        : (typeof key === 'string' ? key.trim() : defaultNodeRuntime(table, raw));
      if (!Object.hasOwn(table, name)) {
        throw new Error(`${given ? `--runtime ${name}` : `review.runtime '${name}'`} is not in the adapter table`);
      }
      // The node role checked here, once, for every caller (G-8 of 20261105-061926-crsf-remediation-review): a
      // reviewer-only adapter was accepted, and each caller launched a reviewer's command as a node.
      if (!servesRole(table[name], 'node')) {
        const said = given ? `--runtime ${name}` : (typeof key === 'string' ? `review.runtime '${name}'` : `the default runtime '${name}'`);
        throw new Error(`${said} does not serve the node role (its roles: ${rolesOf(table[name]).join(', ')})`);
      }
      chosen = name;
      return chosen;
    },
  });
  // Whether a runtime was DECLARED (a --runtime, or the contract's review.runtime), asked of the owner so no caller reads
  // the key itself (G-8 of 20261105-163851-crsf-d1-review): a refusal of a declared value is said, while a table with no
  // default and nothing declared is a caller's quiet case. Not enumerable, so the answer's shape is unchanged.
  Object.defineProperty(out, 'runtimeDeclared', { enumerable: false, value: given || keyDeclared });
  return out;
}

/**
 * One entrypoint from a runtime's `node_runtime` block, or a refusal that names what is missing.
 *
 * THE OPERATOR'S RULE, and it is the right one: a runtime that does not support an entrypoint
 * raises, rather than the orchestrator carrying a fallback that only one vendor could ever satisfy.
 * A fallback IS the hardcoding, one level down — it works for the runtime it was written from and
 * silently produces nothing for any other.
 */
export function entrypoint(adapter, name, { required = true } = {}) {
  const value = adapter?.node_runtime?.[name];
  if (value === undefined || value === null) {
    if (!required) return null;
    throw new Error(
      `runtime '${adapter?.cmd ?? '(unnamed)'}' declares no \`node_runtime.${name}\`. quorate needs it `
      + 'to spawn a node; see shared/adapter-contract.md for what it is and what it achieves.',
    );
  }
  return value;
}

/** The EXACT variable names a consumer-declared reviewer may receive (G-12). */
export function envNamesOf(adapter) {
  return Array.isArray(adapter?.env_names) ? adapter.env_names.filter((n) => typeof n === 'string') : [];
}

/**
 * What is wrong with a contract's `reviewers` block's credential declarations. Checked at mint.
 *
 * A consumer entry may not declare `env_prefixes` (G-12): a prefix forwards every variable that
 * happens to share it, and the one that did was `AWS_`. It names exact variables in `env_names`.
 */
export function declaredEnvErrors(declared = {}) {
  const errs = [];
  for (const [name, entry] of Object.entries(declared ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    if ('env_prefixes' in entry) {
      errs.push(`reviewer '${name}': env_prefixes may not be declared in a contract — a prefix forwards every `
        + 'variable that shares it. Name the exact variables instead: '
        // A scalar is a declaration too, and is reported rather than thrown on (G-14 of 20260925-200721-platform-remediated).
        + `env_names: [${[].concat(entry.env_prefixes ?? []).map((p) => JSON.stringify(`${p}API_KEY`)).join(', ')}] (G-12)`);
    }
    if ('env_names' in entry) {
      const names = entry.env_names;
      const bad = Array.isArray(names) ? names.filter((n) => typeof n !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) : [names];
      if (bad.length) errs.push(`reviewer '${name}': env_names must be a list of variable names — got ${JSON.stringify(bad)}`);
    }
  }
  return errs;
}

export function envPrefixesOf(adapter) {
  return Array.isArray(adapter?.env_prefixes) ? adapter.env_prefixes : [];
}

/**
 * Does this vendor need a shell here? An npm .ps1/.cmd shim does on Windows; a real .exe must not.
 *
 * `platform` is the scripts/platform implementation, REQUIRED (os-platform-adapters stage 2): the
 * operating system's half of the answer is its own fact, `needsShellForShims`, rather than a
 * comparison against the string 'win32' made here. The vendor's half stays the adapter's.
 */
export function needsShell(adapter, platform) {
  if (typeof platform?.needsShellForShims !== 'boolean') {
    throw new Error('needsShell: pass the platform implementation (hostPlatform()); lib/ does not read the host');
  }
  return platform.needsShellForShims && Boolean(adapter?.needs_shell_on_windows);
}

/**
 * The environment a vendor is launched with. A reviewer is started by its bare name, with its credentials, standing in
 * the reviewed snapshot, so whatever that name resolves to runs as the reviewer. Two doors led into the tree:
 *
 * - cmd.exe's implicit search of the current directory (G-8 of 20261016-214749-sp-bugs-remediation-2-review), closed
 *   under a shell by NoDefaultCurrentDirectoryInExePath, Windows' own switch for it;
 * - an explicit PATH entry (reviewer-path-entries.md, G-6 of 20261016-224651-sp-bugs-remediation-3b-review), which that
 *   switch does not touch: a relative entry (`.`, `node_modules\.bin`) resolves against the snapshot, and an absolute
 *   one inside the repository (`npm run` adds `<project>\node_modules\.bin`) leads to the same files. Reproduced: a
 *   planted codex.cmd ran with the switch set. So PATH is filtered, shell or not: an entry that is empty, not rooted
 *   (a Windows `\dir` has no drive, so it is relative too), or inside a directory of `inside` is dropped; the rest keep
 *   their order. An entry is judged on its real path where one can be taken (I-2; G-5 of 20261017-060636-rpe-review,
 *   G-10 of 20261017-064450-rpe-remediation-review), against each named directory's spelling AND real path: a
 *   directory outside the repository that is a link or junction into it is inside it, an entry reaching a named
 *   directory that is itself reached through a link is inside it, and a link inside the repository leading out of it
 *   is not. Folded where the filesystem ignores case. An entry whose real path cannot be taken (it does not exist) is
 *   judged on its spelling. Every PATH-like key is filtered where the environment ignores case.
 *
 * `rule` is required: { platform, inside, realpath }, `realpath` the caller's resolver (lib/ does not read the disk).
 * Returns { env, dropped }, `dropped` the count of entries removed.
 */
export function shellLaunchEnv(env, shell, rule) {
  if (!rule || !Array.isArray(rule.inside)) throw new Error('shellLaunchEnv: pass { platform, inside: [the repository, the snapshot, the launch directory], realpath }');
  if (typeof rule.realpath !== 'function') throw new Error('shellLaunchEnv: pass realpath — a PATH entry is judged by where it leads, not only by its spelling');
  const win = rule.platform?.id === 'win32';
  const p = win ? path.win32 : path.posix;
  const fold = (s) => (rule.platform?.caseInsensitiveFs ? s.toLowerCase() : s);
  const rooted = (e) => (win ? /^[a-zA-Z]:[\\/]|^\\\\/.test(e) : e.startsWith('/'));
  // Both forms of a path: its resolved spelling, and its real path when one can be taken and is absolute.
  const forms = (d) => {
    const out = [fold(p.resolve(d))];
    let real = null;
    try { real = rule.realpath(d); } catch { /* not there: the spelling is all there is */ }
    if (typeof real === 'string' && rooted(real)) out.push(fold(p.resolve(real)));
    return out;
  };
  const roots = rule.inside.filter((d) => typeof d === 'string' && rooted(d)).flatMap(forms);
  // An ENTRY is judged on where it leads — its real path when it exists, its spelling only when it does not (I-2; G-10
  // of 20261017-064450-rpe-remediation-review): a link spelled inside the repository that leads out of it is kept.
  const within = (e) => {
    const all = forms(e);
    const r = all[all.length - 1];
    return roots.some((root) => r === root || r.startsWith(root.endsWith(p.sep) ? root : root + p.sep));
  };
  // EVERY PATH-like key where the environment ignores case (G-10): an object carrying both PATH and Path launched with
  // one of them unfiltered, and which one the child reads is not this function's to choose.
  const keys = rule.platform?.caseInsensitiveEnv ? Object.keys(env).filter((k) => k.toUpperCase() === 'PATH') : ['PATH'];
  const out = { ...env, ...(shell ? { NoDefaultCurrentDirectoryInExePath: '1' } : {}) };
  let dropped = 0;
  for (const key of keys) {
    if (typeof env[key] !== 'string') continue;
    const kept = env[key].split(win ? ';' : ':').filter((raw) => {
      const e = raw.trim().replace(/^"(.*)"$/, '$1');
      const keep = Boolean(e) && rooted(e) && !within(e);
      if (!keep) dropped++;
      return keep;
    });
    out[key] = kept.join(win ? ';' : ':');
  }
  return { env: out, dropped };
}

/**
 * Pull the usage block out of a reviewer's raw stdout, however that vendor reports it.
 *
 * The arm is billed to the vendor's own account, so this is the ONLY way the framework learns what
 * it consumed — a run once reported its dollars while six arms spent tokens nobody could see.
 */
export function usageFrom(adapter, text) {
  const raw = String(text ?? '');
  const spec = adapter?.usage;
  if (!spec) return null;
  try {
    if (spec.from === 'ndjson-result') {
      const v = ndjsonResult(raw)?.[spec.field ?? 'usage'];
      return v && typeof v === 'object' ? v : null;
    }
    if (spec.from === 'stdout-wrapper') {
      const w = JSON.parse(raw);
      const v = w?.[spec.field ?? 'usage'];
      return v && typeof v === 'object' ? v : null;
    }
    if (spec.from === 'json-events') {
      // JSONL. Take the LAST matching event: a multi-turn run emits one per turn and the final one
      // is cumulative for that turn, so scanning to the end avoids reporting a prefix.
      // Line by line IN PLACE (G-7 of 20261022-034225-cid1a-remediation-2-review): splitting first held a second copy of
      // the whole buffered output as an array of lines.
      let found = null;
      for (let at = 0; at < raw.length;) {
        const nl = raw.indexOf('\n', at);
        const end = nl === -1 ? raw.length : nl;
        const t = raw.slice(at, end).trim();
        at = end + 1;
        if (!t.startsWith('{') || !t.includes(spec.event ?? 'turn.completed')) continue;
        try {
          const ev = JSON.parse(t);
          if (ev?.type === (spec.event ?? 'turn.completed') && ev[spec.field ?? 'usage']) found = ev[spec.field ?? 'usage'];
        } catch { /* a partial line is not an event */ }
      }
      return found;
    }
  } catch { /* unparseable output reports no usage, which is a gap to name, not a zero to record */ }
  return null;
}

/**
 * The answer, from wherever this vendor puts it. `readOut` reads the response file when the adapter
 * writes one; it is injected so this stays testable without a filesystem.
 */
export function responseFrom(adapter, { stdout = '', outFile = '', readOut = null } = {}) {
  const from = adapter?.response?.from;
  if (from === 'ndjson-result') {
    // Only a SUCCESS result carries an answer; any other status is the reviewer's failure (ndjsonFailure says which).
    const ev = ndjsonResult(stdout);
    if (!ev || ev.status !== 'SUCCESS') return null;
    const v = ev[adapter.response.field];
    return v && typeof v === 'object' ? v : null;
  }
  if (from === 'stdout-wrapper') {
    try {
      const w = JSON.parse(String(stdout ?? ''));
      const v = w?.[adapter.response.field];
      return v && typeof v === 'object' ? v : null;
    } catch { return null; }
  }
  if (from === 'file') {
    if (!outFile || !readOut) return null;
    try { return JSON.parse(readOut(outFile)); } catch { return null; }
  }
  return null;
}

/**
 * A CONSUMER's own adapter declarations, from the contract — the extension point that lets a project
 * add a reviewer CLI without editing the submodule.
 *
 * ONE OWNER, because there were two copies and two call sites that read NEITHER. `run-graph` and
 * `external-review` merged the declarations; `check-tiebreak` and `bench-lenses` passed `{}`. So a
 * consumer-declared judge was accepted by the run and REFUSED by the probe written to exercise that
 * exact path ("not in the adapter table") — the probe-diverges-from-production defect, in its third
 * location, in the mechanism whose whole purpose is that a project can extend the engine it mounted.
 *
 * FROZEN FIRST, LIVE SECOND, and that order is deliberate. Inside a run the declarations come from
 * `run.json` — the contract as it was when the run started, which is what every other decision in
 * that run is made against. Outside a run (a probe, a bench) there is nothing frozen, so the CURRENT
 * contract is the honest answer: a probe is a deliberate act about the configuration you have now.
 *
 * THE LIVE CONTRACT COMES FROM THE ONE READER, handed in as `readContract` (scripts/io/contract-reader.mjs, bound by
 * scripts/io/reviewers.mjs when a caller asks with `live: true`). This spawned `new-run --print-contract` itself, past
 * the reader's per-process memo, so a tool that then read the contract spawned new-run twice (G-16 of
 * 20261014-181622-lf-delivery). No reader and no run means nothing to ask: empty, never a guess.
 */
export function declaredReviewers({ run = null, runDir = null, cwd = null, readContract = null } = {}) {
  // THE CALLER'S OWNER, NOT ONE BUILT HERE (G-12 of 20261029-235315-rdr-remediation-4-review): `run` is the owner of the
  // run the caller admitted. A raw `runDir` is refused, never wrapped: its root was never admitted.
  if (runDir != null) throw new TypeError('declaredReviewers: pass `run`, the admitted run\'s owner, not a runDir path');
  if (run) {
    if (typeof run.read !== 'function') throw new TypeError('declaredReviewers: `run` is the admitted run\'s owner, not a path');
    try {
      // The run's record through its owner (run-dir-reads.plan.md stage 3): a link standing at run.json is refused.
      // Held to readRunJson's bound (G-8 of 20261124-170802-gsw-remediation-3-review-b): a record over it is unreadable.
      const frozen = readRunJson(run, ['run.json']);
      return frozen?.contract?.reviewers ?? {};
    } catch {
      // An unreadable run.json is refused by the egress check on the paths that transmit, so keeping
      // the built-ins unextended holds the failure to one message rather than adding a second.
      return {};
    }
  }
  if (!readContract) return {};
  return reviewersFromOutcome(readContract(cwd ? { cwd } : {}), 'declaredReviewers');
}

/**
 * The adapters a contract declares, from the one reader's OUTCOME — `{ contract }`, `{ absent }` or `{ error }`. THE
 * OWNER of that answer: declaredReviewers' live branch and the bench tools' one read (bench-contract-root D3) both ask it,
 * so no tool becomes a second reader of `reviewers`. No contract declares nothing; one that cannot be read is refused,
 * not read as declaring nothing (G-5 of 20261014-193710-lf-remediation-review): the table it would have extended decides
 * where credentials go (A-26).
 */
export function reviewersFromOutcome(outcome, who = 'reviewers') {
  if (outcome?.error) throw new Error(`${who}: the contract could not be read: ${outcome.error}`);
  return outcome?.contract?.reviewers ?? {};
}
