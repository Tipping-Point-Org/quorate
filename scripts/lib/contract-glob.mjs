// THE CONTRACT'S GLOB GRAMMAR — one owner (contract-glob-grammar.design.md; operator, 2026-09-30: "A: `*`, `**`,
// literals (Recommended)", "A: one module, exact (Recommended)").
//
// Before this module, at least fourteen places read a contract glob (the design's inventory, A-N), each by its own
// rules, and every glob MEDIUM of 2026-09-29/30 was two of them disagreeing: braces refused on one branch and read as a
// literal on another, `?` a wildcard to one cutter and a character to the next, `[!x]` negated by nobody, a backslash
// base invisible to the absolute-path test. One parse now answers every question a caller asks, and a form the parse
// does not accept is refused at mint rather than read differently in fourteen places.
//
// THE GRAMMAR. `*` matches within one path segment; `**`, as a whole segment, matches any number of segments (`**/`
// also matches none); every other character is literal. `/` or `\` separate segments; a leading `./` and a trailing `/`
// are ignored. A literal path names a file, or a directory and everything below it.
//
// REFUSED, each with a reason: an empty glob; an absolute path; `?`, `[`, `]`, `{`, `}`; a `.` or `..` segment; a `**`
// that is not a whole segment; and a leading `!`, which in a .gitignore negates — a reader writing it expects that, and
// silently matching a file literally named `!x` would be the next divergence. Pure: no I/O, no clock, no environment.

const SEP = /[\\/]+/;
const REFUSED_CHARS = /[?[\]{}]/;
const parsed = new Map();   // glob -> parse; the grammar is a function of the string, so the parse is cached

/** Parse once. `{ ok: true, glob, segments, wildcardAt }` or `{ ok: false, why }`. */
export function parseGlob(glob) {
  const raw = String(glob ?? '');
  if (parsed.has(raw)) return parsed.get(raw);
  const r = parseUncached(raw);
  parsed.set(raw, r);
  return r;
}

function parseUncached(raw) {
  const g = raw.trim();
  if (!g) return { ok: false, why: 'empty — a glob names files in the repository' };
  if (g.startsWith('!')) return { ok: false, why: 'a leading `!` negates in a .gitignore, which a contract glob does not do — list what to include instead' };
  if (/^[\\/]/.test(g) || /^[A-Za-z]:/.test(g)) return { ok: false, why: 'an absolute path — a contract glob is relative to the repository root' };
  const bad = REFUSED_CHARS.exec(g);
  if (bad) {
    const what = '{}'.includes(bad[0]) ? 'a brace list' : bad[0] === '?' ? '`?`' : 'a character class `[...]`';
    return { ok: false, why: `${what} is not in the contract's glob grammar (only \`*\`, \`**\` and literal characters) — ${'{}'.includes(bad[0]) ? 'list each alternative as its own entry' : 'use `*` or name the files'}` };
  }
  let segments = g.split(SEP);
  while (segments[0] === '.') segments = segments.slice(1);          // a leading `./`, once or repeated
  if (segments.length && segments[segments.length - 1] === '') segments = segments.slice(0, -1);   // a trailing `/`
  if (!segments.length) return { ok: false, why: 'empty — a glob names files in the repository' };
  for (const s of segments) {
    if (s === '..') return { ok: false, why: 'a `..` segment — a contract glob stays inside the repository, and how far `..` climbs after a wildcard depends on what the wildcard matched' };
    if (s === '.' || s === '') return { ok: false, why: 'a `.` or empty segment inside the path — write the path plainly' };
    if (s.includes('**') && s !== '**') return { ok: false, why: '`**` must be a whole path segment (`a/**/b`), not part of one (`a**b`)' };
  }
  // Consecutive `**` segments mean what one does; collapsed here, so no reader meets the doubled form (G-15 of
  // 20261001-022902-contract-glob-grammar-review: `**/**` matched nothing).
  segments = segments.filter((s, i) => !(s === '**' && segments[i - 1] === '**'));
  const wildcardAt = segments.findIndex((s) => s.includes('*'));
  return { ok: true, glob: segments.join('/'), segments, wildcardAt };
}

/** null when `glob` is in the grammar; otherwise the reason it is refused. */
export function validateGlob(glob) {
  const p = parseGlob(glob);
  return p.ok ? null : p.why;
}

function mustParse(glob) {
  const p = parseGlob(glob);
  if (!p.ok) throw new Error(`contract glob ${JSON.stringify(String(glob ?? ''))} refused: ${p.why}`);
  return p;
}

/** Whether the glob has no wildcard (a file, or a directory meaning everything below it). */
export const isLiteralGlob = (glob) => mustParse(glob).wildcardAt === -1;

/**
 * The directory a walk starts in: the segments before the first wildcard segment, joined; '' is the repository root.
 * A literal glob's root is the path itself. `{ base, wildcard }`.
 */
export function walkRoot(glob) {
  const p = mustParse(glob);
  if (p.wildcardAt === -1) return { base: p.glob, wildcard: false };
  return { base: p.segments.slice(0, p.wildcardAt).join('/'), wildcard: true };
}

/**
 * The text the glob covers before its first `*`, a partial segment kept and trailing separators dropped
 * (`docs/README*` -> `docs/README`; `**\/*.md` -> ''). The question the source-root overlap test asks; '' means the
 * glob names no root, never the repository root.
 */
export function coverPrefix(glob) {
  const p = mustParse(glob);
  const star = p.glob.indexOf('*');
  return (star === -1 ? p.glob : p.glob.slice(0, star)).replace(/\/+$/, '');
}

/**
 * Whether a glob can match a path in a subdirectory of its cover prefix (G-9 of
 * 20261114-195905-m2-pred1-remediation-2-review): false for one whose rest after the prefix is a single segment with no
 * `**` (`*.mjs`, `src/*.mjs`, `src/x.mjs`), which matches only files directly in the prefix's folder. A glob with no
 * wildcard at all is a name that may be a directory, so it covers everything below itself: true.
 */
export function coversBelowPrefix(glob) {
  const p = mustParse(glob);
  const star = p.glob.indexOf('*');
  if (star === -1) return true;
  const rest = p.glob.slice(coverPrefix(glob).length).replace(/^\/+/, '');
  return rest.includes('/') || rest.includes('**');
}

const compiled = new Map();
function regexFor(p) {
  if (compiled.has(p.glob)) return compiled.get(p.glob);
  let re = '';
  p.segments.forEach((s, i) => {
    const last = i === p.segments.length - 1;
    // A trailing `**` matches everything below its directory AND the directory itself (`x/**` matches `x`): a finding
    // may cite the directory a generated glob names, and it must be demoted with what is inside it (G-18's own
    // assertion, tests/regression-containment-sweep.test.mjs). Files are never named by their directory, so no file
    // walk or tracked-file check sees a difference.
    if (s === '**') { re = last && i > 0 ? `${re.replace(/\/$/, '')}(?:/.+)?` : re + (last ? '.+' : '(?:[^/]+/)*'); return; }
    re += s.split('*').map((part) => part.replace(/[.+^$()|\\]/g, '\\$&')).join('[^/]*');
    if (!last) re += '/';
  });
  const rx = new RegExp(`^${re}$`);
  compiled.set(p.glob, rx);
  return rx;
}

/**
 * Does repo-relative `rel` match `glob` EXACTLY? A literal glob matches that path and, when it names a directory,
 * everything below it. Backslashes in `rel` are the same path.
 */
export function matchesGlob(glob, rel) {
  const p = mustParse(glob);
  const f = String(rel ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!f) return false;
  if (p.wildcardAt === -1) return f === p.glob || f.startsWith(`${p.glob}/`);
  return regexFor(p).test(f);
}

/** Every contract key whose value is a list of repository globs (doc_roles values are added by contractGlobErrors). */
const CONTRACT_GLOB_KEYS = [
  ['source_globs', (c) => c.source_globs], ['test_globs', (c) => c.test_globs], ['doc_paths', (c) => c.doc_paths],
  ['generated_globs', (c) => c.generated_globs], ['review.preflight_inputs', (c) => c.review?.preflight_inputs],
];

/**
 * Every contract glob outside the grammar, as `key: glob — why` (contract-glob-grammar.plan.md, stage 2). One check, at
 * mint and at pre-flight, for every glob key and every non-empty doc_roles value — the latter are expanded for the
 * intent hash, so they are globs too. It replaces contractGlobsLeavingRepo, which judged only a glob's walk root.
 */
export function contractGlobErrors(contract = {}) {
  const out = [];
  const check = (label, g) => {
    if (typeof g !== 'string') { out.push(`${label}: ${JSON.stringify(g)} — not a string; a glob is written as text`); return; }
    const why = validateGlob(g);
    if (why) out.push(`${label}: ${g} — ${why}`);
  };
  // A VALUE OF THE WRONG SHAPE IS REFUSED, NOT SKIPPED (G-16 of 20261001-022902-contract-glob-grammar-review):
  // `source_globs: "src/**"` passed this check as "no list" and threw later, inside a reader. Absent is fine.
  for (const [key, get] of CONTRACT_GLOB_KEYS) {
    const list = get(contract ?? {});
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) { out.push(`${key}: ${JSON.stringify(list)} — not a list; write ["${String(list)}"]`); continue; }
    for (const g of list) check(key, g);
  }
  // Each code_index language's globs (code-index.plan.md stage 3): the files its extractor reads, so a contract glob.
  const index = contract?.code_index;
  if (index && typeof index === 'object' && !Array.isArray(index)) {
    for (const [language, spec] of Object.entries(index)) {
      const list = spec?.globs;
      const key = `code_index.${language}.globs`;
      if (list === undefined || list === null) continue;
      if (!Array.isArray(list)) { out.push(`${key}: ${JSON.stringify(list)} — not a list; write ["${String(list)}"]`); continue; }
      for (const g of list) check(key, g);
    }
  }
  for (const [role, value] of Object.entries(contract?.doc_roles ?? {})) {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) continue;   // empty = not declared
    check(`doc_roles.${role}`, value);
  }
  return out;
}

/** Does `rel` match any of `globs`? */
export const matchesAnyGlob = (globs, rel) => (globs ?? []).some((g) => matchesGlob(g, rel));
