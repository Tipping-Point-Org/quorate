// WHAT 1.x PROMISES, AND HOW A PROMISE IS CHECKED (m3-v1.plan.md stage 3; shared/compatibility.md owns the policy).
//
// scripts/compatibility.json freezes four sets at 1.0: the contract keys, gate.json's fields with their types, the
// commands and flags QUORATE.md documents, and the deprecations check-install reports. Each set has a CURRENT authority
// (shared/claude-md-contract.md with CLAUDE.template.md, scripts/gate.schema.json, QUORATE.md), and the freeze holds
// against it by one rule, freezeHolds: before 1.0 the two must be equal, so a key added now is frozen now; from 1.0 on
// the freeze must be a subset, so a 1.x release may add and never remove or rename. Pure: no I/O, the caller reads.
import { parseContractYaml } from './contract-yaml.mjs';
import { CONTRACT_BLOCK_RE, CONTRACT_VERSION_KEYS } from './contract-version.mjs';
import { CODE_INDEX_LANGUAGE_KEYS } from './code-index-contract.mjs';

/**
 * True until 1.0 is tagged (shared/compatibility.md): the freeze must then equal its authority. `version` is VERSION's
 * text, `tags` the repository's tag names (the caller reads them). Below 1.0.0 it is true; at exactly 1.0.0 it is true
 * while no `v1.0.0` tag exists, because VERSION is bumped before the tag; past 1.0.0 it is false whatever tags a clone
 * fetched, so a shallow checkout without tags does not hold a 1.x release to equality.
 */
export function preRelease(version, tags = []) {
  const [maj, min, pat] = String(version).trim().split('.').map(Number);
  if (maj < 1) return true;
  return maj === 1 && min === 0 && pat === 0 && ![...tags].includes('v1.0.0');
}

/**
 * Does a frozen set hold against the current one? `frozen` and `current` are arrays of names (or Maps of name ->
 * value, compared by value too). Returns `{ missing, changed, unfrozen }`: names frozen and gone, names whose value
 * moved, and (before 1.0 only) names current but not frozen. All three empty means it holds.
 */
export function freezeHolds({ frozen, current, preRelease: pre }) {
  const f = frozen instanceof Map ? frozen : new Map([...frozen].map((k) => [k, true]));
  const c = current instanceof Map ? current : new Map([...current].map((k) => [k, true]));
  const missing = [...f.keys()].filter((k) => !c.has(k)).sort();
  const changed = [...f.keys()].filter((k) => c.has(k) && c.get(k) !== f.get(k)).sort();
  const unfrozen = pre ? [...c.keys()].filter((k) => !f.has(k)).sort() : [];
  return { missing, changed, unfrozen };
}

// ------------------------------------------------------------------------------------------------- contract keys

const keyPaths = (obj, prefix = []) => Object.entries(obj ?? {}).flatMap(([k, v]) => {
  const full = [...prefix, k];
  return [full.join('.'), ...(v && typeof v === 'object' && !Array.isArray(v) ? keyPaths(v, full) : [])];
});

/**
 * Every contract key the documents declare: the template's block, every `yaml` example in shared/claude-md-contract.md
 * that parses as a contract, and code_index's per-language keys from their one owner. The names a consumer chooses
 * (a lens id, a reviewer name, a language) are `*`. A yaml example that is not a contract (a fragment the parser
 * refuses) declares nothing.
 */
export function documentedContractKeys({ docText, templateText }) {
  const norm = (t) => String(t).split('\r\n').join('\n');
  const out = new Set();
  const add = (o) => keyPaths(o).forEach((k) => out.add(consumerNamed(k)));
  for (const m of norm(docText).matchAll(/```yaml\n([\s\S]*?)```/g)) {
    try { add(parseContractYaml(m[1])); } catch { /* not a contract fragment */ }
  }
  const tpl = norm(templateText);
  const at = CONTRACT_BLOCK_RE.exec(tpl);
  if (at) add(parseContractYaml(tpl.slice(at.index).split('\n```')[0]));
  out.add('code_index.*');
  for (const k of CODE_INDEX_LANGUAGE_KEYS) out.add(`code_index.*.${k}`);
  return out;
}

const consumerNamed = (k) => k.replace(/^(lenses|reviewers|code_index)\.[^.]+/, '$1.*');

/**
 * The keys a consumer's contract carries that the documents do not: a key removed from quorate, or a misspelt one, which
 * the engine would ignore. `contract` is the parsed contract, `documented` documentedContractKeys' set. Below a
 * reviewer entry nothing is reported: an entry may set any field of its built-in adapter, validated at mint.
 */
export function undocumentedKeys(contract, documented) {
  // Deduplicated through a Set, linear in the keys (G-2 of 20261123-174149-m3s9-remediation-review-b: filter+indexOf).
  return [...new Set(keyPaths(contract ?? {}).map(consumerNamed)
    // Either spelling of the version key is accepted (CONTRACT_VERSION_KEYS), so neither is unknown.
    .filter((k) => !documented.has(k) && !CONTRACT_VERSION_KEYS.includes(k) && !/^reviewers\.\*\./.test(k)))].sort();
}

/**
 * The one line check-install ends its contract half with (m3-v1.plan.md stage 4): every change a consumer must make to
 * its contract for this quorate, in a fixed order, so the release notes' "must change" list can be compared with it.
 * `changes` is `[{ name, why }]`.
 */
export const upgradeLine = (changes) => (changes.length
  // `; ` separates the items, so a reason carries none (upgradeNames reads the line back by it).
  ? `upgrade: ${changes.length} contract change(s) to make: ${changes.map((c) => `${c.name} (${String(c.why).split(';').join(',')})`).join('; ')}`
  : 'upgrade: nothing to change in the contract');

/** The names upgradeLine lists, read back from its text. */
export function upgradeNames(line) {
  const m = /^upgrade: \d+ contract change\(s\) to make: (.*)$/m.exec(String(line));
  return m ? m[1].split('; ').map((c) => c.replace(/ \(.*$/, '')) : [];
}

// ------------------------------------------------------------------------------------------------------ gate.json

const typesOf = (s) => [].concat(s?.type ?? []).sort().join('|');

/**
 * Every field path a schema declares, with its types: `nodes[].verdict` -> `null|string`; an object's
 * additionalProperties schema is `*`. Enums are part of the type, `string{PASS,RISK}`, so narrowing one is a change.
 */
export function schemaFieldTypes(schema) {
  const out = new Map();
  const walk = (s, where) => {
    if (!s || typeof s !== 'object') return;
    if (where) out.set(where, typesOf(s) + (s.enum ? `{${s.enum.map(String).sort().join(',')}}` : ''));
    for (const [k, v] of Object.entries(s.properties ?? {})) walk(v, where ? `${where}.${k}` : k);
    if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, `${where}.*`);
    if (s.items) walk(s.items, `${where}[]`);
  };
  walk(schema, '');
  return out;
}

const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

/**
 * Validate `value` against the draft-07 subset gate.schema.json uses: type, enum, required, properties,
 * additionalProperties (a schema), items, anyOf and not. `strict` also reports a property the schema does not declare,
 * which is how a test keeps the schema complete; a consumer reads without it, ignoring what it does not know. An anyOf
 * branch or a not constrains and declares nothing, so neither is checked strictly. Returns error strings.
 */
export function checkSchema(schema, value, { strict = false } = {}) {
  const errors = [];
  const walk = (s, v, where) => {
    // anyOf and not (G-4 of 20261124-040316-m3s9-remediation-4-review-b: adjudication has two forms, each required whole).
    if (Array.isArray(s.anyOf) && !s.anyOf.some((b) => checkSchema(b, v).length === 0)) {
      errors.push(`${where}: matches none of its ${s.anyOf.length} forms (${s.anyOf.map((b) => checkSchema(b, v).map((e) => e.replace(/^\$/, where)).join(', ')).join(' | ')})`);
    }
    if (s.not && typeof s.not === 'object' && checkSchema(s.not, v).length === 0) errors.push(`${where}: matches a form it must not`);
    const types = [].concat(s.type ?? []);
    const t = jsonType(v);
    if (types.length && !types.includes(t) && !(t === 'integer' && types.includes('number'))) {
      errors.push(`${where}: ${t}, expected ${types.join(' or ')}`);
      return;
    }
    if (s.enum && !s.enum.includes(v)) errors.push(`${where}: ${JSON.stringify(v)} is not one of ${JSON.stringify(s.enum)}`);
    if (t === 'object') {
      for (const r of s.required ?? []) if (!Object.hasOwn(v, r)) errors.push(`${where}.${r}: required, absent`);
      for (const [k, x] of Object.entries(v)) {
        if (s.properties && Object.hasOwn(s.properties, k)) walk(s.properties[k], x, `${where}.${k}`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, x, `${where}.${k}`);
        else if (strict && s.properties) errors.push(`${where}.${k}: not declared in the schema`);
      }
    }
    if (t === 'array' && s.items) v.forEach((x, i) => walk(s.items, x, `${where}[${i}]`));
  };
  walk(schema, value, '$');
  return errors;
}

/**
 * The least value a schema admits: null where its type allows null, otherwise an empty array, the first of an enum or an
 * empty string, 0, false, or an object holding only its required properties, each at its own least value.
 */
export function leastValue(schema) {
  const s = schema ?? {};
  const types = [].concat(s.type ?? []);
  if (!types.length || types.includes('null')) return null;
  if (types.includes('array')) return [];
  if (types.includes('object')) {
    const out = {};
    for (const r of s.required ?? []) out[r] = leastValue(s.properties?.[r]);
    return out;
  }
  if (types.includes('string')) return s.enum?.length ? s.enum[0] : '';
  if (types.includes('number') || types.includes('integer')) return s.enum?.length ? s.enum[0] : 0;
  if (types.includes('boolean')) return false;
  return null;
}

/**
 * `value` fitted to `schema` (strict, as checkSchema reads it): a value that validates is returned as is; an object keeps
 * each declared property fitted and drops the undeclared ones, a required property it lacks at its least value; an array
 * keeps the items that fit; anything else that does not validate is replaced by its least value. The gate's writer
 * uses it when a BLOCKED gate still fails its schema (G-7 of 20261124-131313-gsw-delivery): what it writes holds only
 * declared fields, each one that validated kept. The caller still checks the result: a schema whose least value does not
 * validate (an anyOf, a not) is not fitted by this.
 */
export function fitToSchema(schema, value) {
  const s = schema ?? {};
  if (checkSchema(s, value, { strict: true }).length === 0) return value;
  const types = [].concat(s.type ?? []);
  const t = jsonType(value);
  const typeOk = !types.length || types.includes(t) || (t === 'integer' && types.includes('number'));
  let out;
  // An object schema declared by additionalProperties alone is fitted too (G-2 of 20261124-140633-gsw-remediation-review-b):
  // gating on `properties` sent a vote-count map to its least value, erasing every valid entry for one mistyped one.
  const extra = s.additionalProperties && typeof s.additionalProperties === 'object' ? s.additionalProperties : null;
  if (typeOk && t === 'object' && (s.properties || extra)) {
    const props = s.properties ?? {};
    out = {};
    for (const [k, x] of Object.entries(value)) {
      if (Object.hasOwn(props, k)) out[k] = fitToSchema(props[k], x);
      else if (extra) out[k] = fitToSchema(extra, x);
    }
    for (const r of s.required ?? []) if (!Object.hasOwn(out, r)) out[r] = leastValue(props[r]);
  } else if (typeOk && t === 'array' && s.items) {
    // An item of its declared type is fitted (a record with one mistyped field keeps the rest); one of another type is
    // dropped rather than replaced by a least value no writer recorded.
    const itemTypes = [].concat(s.items.type ?? []);
    out = value
      .map((x) => (itemTypes.includes(jsonType(x)) && (Array.isArray(x) || (x && typeof x === 'object')) ? fitToSchema(s.items, x) : x))
      .filter((x) => checkSchema(s.items, x, { strict: true }).length === 0);
  } else {
    out = leastValue(s);
  }
  return checkSchema(s, out, { strict: true }).length === 0 ? out : leastValue(s);
}

// -------------------------------------------------------------------------------------------------------- commands

/**
 * The invocations a document writes out: each `[scripts/]<name>.mjs` whose name has an argv spec, with the arguments
 * that follow it on its line up to a closing backtick, quote, `#` or `|`. A `<placeholder>` or `'<placeholder>'` is a
 * value, given to the parser as `x`. Returns `{ script, argv, flags, words }` per invocation. A script with no spec is
 * not parsed here; invocationsWithoutSpec names each one.
 */
const INVOCATION_RE = /(?:scripts\/)?\b([a-z][a-z-]*)\.mjs([^`"#|\n]*)/g;
export function documentedInvocations(text, specs) {
  const out = [];
  for (const m of String(text).matchAll(INVOCATION_RE)) {
    const script = m[1];
    if (!Object.hasOwn(specs, script)) continue;
    const PLACEHOLDER = '\u0000';
    const argv = (m[2].replace(/'?<[^>]*>'?/g, PLACEHOLDER).match(/'[^']*'|\S+/g) ?? [])
      .map((a) => (a === PLACEHOLDER ? 'x' : a));
    out.push({
      script, argv,
      flags: argv.filter((a) => a.startsWith('--')),
      words: m[2].replace(/'?<[^>]*>'?/g, ' ').split(/\s+/).filter((a) => /^[a-z][a-z-]*$/.test(a)),
    });
  }
  return out;
}

/**
 * The scripts a document writes out an invocation of that have NO argv spec, which documentedInvocations cannot parse
 * and so skips: each is named here rather than dropped, so a caller can require that every one is checked some other
 * way (G-11 of 20261123-161216-m3s9-review: an entry point reading its arguments outside argv-specs was silently
 * skipped, I-4's failure mode). Sorted, each name once.
 */
export function invocationsWithoutSpec(text, specs) {
  const out = new Set();
  for (const m of String(text).matchAll(INVOCATION_RE)) if (!Object.hasOwn(specs, m[1])) out.add(m[1]);
  return [...out].sort();
}

/** Every `--flag` token a document mentions, anywhere. */
export const mentionedFlags = (text) => new Set(String(text).match(/--[a-z][a-z-]*/g) ?? []);

/**
 * The `--flag` tokens a document writes in a section that names `script` (`script` or `script.mjs`, or a path ending in
 * it). A section starts at a heading or at a list item in the first column and runs to the next one, so the indented
 * paragraphs and code fences of a numbered step belong to it. A flag written only in a section about another command is
 * not documented for this one (G-3 of 20261124-021129-m3s9-remediation-2-review-b: one global set let a flag documented
 * under the wrong command pass).
 */
export function flagsDocumentedWith(text, script) {
  const name = String(script).replace(/\.mjs$/, '');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = new RegExp(`(?:^|[^A-Za-z0-9_.-])${esc}(?:\\.mjs)?(?![A-Za-z0-9_-])`);
  const out = new Set();
  const sections = [];
  let cur = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (/^(?:#{1,6} |(?:[-*]|\d+\.) )/.test(line) && cur.length) { sections.push(cur.join('\n')); cur = []; }
    cur.push(line);
  }
  sections.push(cur.join('\n'));
  for (const s of sections) if (names.test(s.replace(/--[a-z][a-z-]*/g, ' '))) for (const f of mentionedFlags(s)) out.add(f);
  return out;
}

// ------------------------------------------------------------------------------------------------------- removals

/**
 * Which deprecations a consumer still uses. `list` is compatibility.json's `deprecated`: `{ kind, name, since,
 * removed_in, use_instead }`, kind `contract-key` (a key path, matched against the consumer's contract, `*` for a name
 * the consumer chose) or `flag` (`<script> --flag`, matched in the texts that invoke quorate: settings, hooks).
 * `contract` is the parsed contract or null; `texts` is `[{ file, text }]`. Returns the used entries, each with `where`.
 */
export function deprecationsUsed(list, { contract, texts = [] }) {
  const keys = contract ? keyPaths(contract) : [];
  const used = [];
  for (const d of list ?? []) {
    if (d.kind === 'contract-key') {
      const re = new RegExp(`^${String(d.name).split('.').map((p) => (p === '*' ? '[^.]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('\\.')}$`);
      const hit = keys.find((k) => re.test(k));
      if (hit) used.push({ ...d, where: `contract key ${hit}` });
    } else if (d.kind === 'flag') {
      const [script, flag] = String(d.name).split(/\s+/);
      const re = new RegExp(`${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.mjs)?\\b[^\\n]*?${flag}(?![a-z-])`);
      // One command may span lines through a shell continuation (`\` in sh, a backtick in PowerShell, `^` in cmd), so
      // each is joined before matching; a plain line break still ends the command (G-4 of
      // 20261124-021129-m3s9-remediation-2-review-b).
      // The mark is the file's own shell's (G-9 of 20261124-030759-m3s9-remediation-3-review-b: all three were joined in
      // every file, so a literal caret ending an sh line merged two commands): PowerShell's backtick in a .ps1 or .psm1,
      // cmd's caret in a .cmd or .bat, and sh's backslash in everything else (the git hooks, the settings files).
      const mark = (file) => (/\.psm?1$/i.test(file) ? '`' : /\.(?:cmd|bat)$/i.test(file) ? '\\^' : '\\\\');
      const joined = (t) => String(t.text).replace(new RegExp(`${mark(String(t.file ?? ''))}[ \\t]*\\r?\\n`, 'g'), ' ');
      const hit = texts.find((t) => re.test(joined(t)));
      if (hit) used.push({ ...d, where: hit.file });
    }
  }
  return used;
}

/** The refusal of a malformed deprecation entry, or null. */
export function deprecationEntryError(d) {
  if (!d || typeof d !== 'object') return 'an entry is not an object';
  if (!['contract-key', 'flag'].includes(d.kind)) return `${JSON.stringify(d.name)}: kind must be contract-key or flag`;
  for (const k of ['name', 'since', 'removed_in', 'use_instead']) {
    if (typeof d[k] !== 'string' || !d[k]) return `${JSON.stringify(d.name)}: ${k} must be a non-empty string`;
  }
  if (d.kind === 'flag' && !/^[a-z][a-z-]*(?:\.mjs)? --[a-z][a-z-]*$/.test(d.name)) {
    return `${JSON.stringify(d.name)}: a flag is named "<script> --flag"`;
  }
  return null;
}
