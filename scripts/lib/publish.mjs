// WHAT A RELEASE SNAPSHOT CARRIES, AND WHAT STOPS IT (m2-public-release.plan.md stages 2 and 2b; ROADMAP D2).
//
// The public repository receives one squashed commit per release: the tracked files of one commit, minus a declared
// exclusion list, with declared replacements, scanned before anything is committed. These are the decisions; the
// entry script `scripts/publish.mjs` does the reading and writing. Pure: no I/O, no clock, no environment.
//
// Two lists of patterns, kept apart on purpose. The MANIFEST (`publish/manifest.json`, tracked, shipped) carries the
// generic shapes of a machine-local path. The operator's own identity (a username, an e-mail address, the private
// repository's owner) must never be written into a tracked file, so it comes from a LOCAL file the entry script reads
// (`.claude/publish.local.json`, gitignored) and is passed here as more patterns.
import crypto from 'node:crypto';
import { matchesGlob, validateGlob } from './contract-glob.mjs';
import { secretScanOutcome, SECRET_LEAK_EXIT } from './push-gate.mjs';

/**
 * Whether the release's secret scan passes (G-31 of 20261117-013640-m2-9a-final: this rule sat inline in the entry script,
 * ARCHITECTURE §2). A scan that did not block passes; gitleaks' leak exit passes only when it ran, its report was read,
 * no gitleaks finding was kept, and at least one was allowed by the manifest. Pure.
 */
export function secretScanPasses({ missing, status, reportRead, kept, allowed }) {
  if (!secretScanOutcome({ missing, status }).block) return true;
  return !missing && status === SECRET_LEAK_EXIT && reportRead === true && kept === false && allowed === true;
}

/**
 * Whether a tree entry of this git mode ships: only a regular file, 100644 or 100755. A symbolic link (120000) would ship
 * bytes from outside the commit, and a gitlink (160000) is another repository's commit (G-24 of 20261116-200635-m2-9a-high;
 * moved here by G-31 of 20261117-013640-m2-9a-final). Pure.
 */
export const shipsAsRegularFile = (mode) => mode === '100644' || mode === '100755';

export const MANIFEST_VERSION = 1;

/**
 * The name of a hit's line: the SHA-256 of its trimmed text, hex (the M2 plan's stage 3, amended 2026-11-16: an
 * allowance "names the hit itself, by the text of the line it is on"). A hash and not the text, because a gitleaks hit's
 * line holds a secret-shaped value, which copied into the tracked manifest would itself ship and be pushed. Pure.
 */
export const lineSha256 = (text) => crypto.createHash('sha256').update(String(text).trim()).digest('hex');

/**
 * Validate a parsed manifest. Returns { manifest } or { error }.
 * Shape: { version: 1, exclude: [glob], replace: { "<published path>": "<tracked source path>" },
 *          patterns: [{ name, regex, flags? }], markers: [string], allow: [{ path, pattern, line_sha256, reason }] }
 * - exclude: contract-grammar globs; a matching tracked file does not ship.
 * - replace: the published path takes the source file's content; the source itself does not ship under its own name.
 * - patterns: a shipped file whose text matches one is a finding (machine-local shapes).
 * - markers: literal strings a placeholder carries; a shipped file containing one refuses the publish.
 * - allow: a hit the operator accepted (2026-11-13: "Declared allowances (Recommended)"), by file and by the name of a
 *   manifest pattern or `gitleaks:<RuleID>`, each with its reason. Never a marker or a local identity pattern: those are
 *   always fixed in the text. An allowance that matches nothing refuses the publish, so the list cannot go stale.
 *   Each names ONE hit by `line_sha256`, the hash of its line's trimmed text (lineSha256; amended 2026-11-16, operator:
 *   "Tighten to per-line, amend I-3 (Recommended)"): an allowance keyed by file and pattern alone silenced every hit of
 *   that pattern in that file (G-19 of 20261116-221234-m2-9a-high-2).
 */
export function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { error: 'the manifest is not a JSON object' };
  if (m.version !== MANIFEST_VERSION) return { error: `the manifest's version is ${JSON.stringify(m.version)}, not ${MANIFEST_VERSION}` };
  const known = new Set(['version', 'exclude', 'replace', 'patterns', 'markers', 'allow', '$comment']);
  const unknown = Object.keys(m).filter((k) => !known.has(k));
  if (unknown.length) return { error: `the manifest has unknown keys: ${unknown.join(', ')}` };
  const exclude = m.exclude ?? [];
  if (!Array.isArray(exclude) || exclude.some((g) => typeof g !== 'string')) return { error: 'exclude is not a list of globs' };
  for (const g of exclude) {
    const why = validateGlob(g);
    if (why) return { error: `exclude glob ${JSON.stringify(g)}: ${why}` };
  }
  const replace = m.replace ?? {};
  if (typeof replace !== 'object' || Array.isArray(replace)) return { error: 'replace is not an object' };
  for (const [to, from] of Object.entries(replace)) {
    if (typeof from !== 'string' || !from || !to) return { error: `replace ${JSON.stringify(to)} has no source path` };
    if (isUnsafeRel(to) || isUnsafeRel(from)) return { error: `replace ${JSON.stringify(to)} -> ${JSON.stringify(from)} leaves the repository` };
    if (namesGit(to) || namesGit(from)) return { error: `replace ${JSON.stringify(to)} -> ${JSON.stringify(from)} names a .git path, which is git's, never content` };
  }
  const patterns = m.patterns ?? [];
  const pErr = patternErrors(patterns, 'patterns');
  if (pErr) return { error: pErr };
  // The local identity patterns are renamed local:<name> (scripts/publish.mjs); a manifest pattern of that name would let
  // an allowance name, and so suppress, an identity hit.
  const localNamed = patterns.find((p) => String(p.name).startsWith('local:'));
  if (localNamed) return { error: `patterns: ${JSON.stringify(localNamed.name)}: the local: prefix is the identity patterns', never a manifest pattern's` };
  const markers = m.markers ?? [];
  if (!Array.isArray(markers) || markers.some((s) => typeof s !== 'string' || !s)) return { error: 'markers is not a list of strings' };
  const allow = m.allow ?? [];
  if (!Array.isArray(allow)) return { error: 'allow is not a list' };
  const names = new Set(patterns.map((p) => p.name));
  for (const a of allow) {
    if (!a || typeof a.path !== 'string' || !a.path || typeof a.pattern !== 'string' || typeof a.reason !== 'string' || !a.reason.trim()) {
      return { error: 'allow: each entry needs a path, a pattern and a reason' };
    }
    if (typeof a.line_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.line_sha256)) {
      return { error: `allow ${a.path} ${a.pattern}: no line_sha256, the hash of the one line it allows; publish prints it beside each finding` };
    }
    if (!names.has(a.pattern) && !/^gitleaks:\S+$/.test(a.pattern)) {
      return { error: `allow ${a.path}: ${JSON.stringify(a.pattern)} is neither a manifest pattern nor gitleaks:<RuleID>; a marker or an identity pattern is never allowed` };
    }
  }
  return { manifest: { exclude, replace, patterns, markers, allow } };
}

/**
 * The name the local file's pattern for the private repository's owner must carry. I-3 scans for the owner as its own
 * category, and the manifest may not hold it (it is the operator's), so a local file without it let the owner's name ship
 * unnamed (G-28 of 20261117-013640-m2-9a-final; operator: "Require a named owner pattern (Recommended)").
 */
export const OWNER_PATTERN_NAME = 'private-repo-owner';

/**
 * Validate the local identity file: { patterns: [{ name, regex, flags? }] }, one of them named OWNER_PATTERN_NAME.
 * Returns { patterns } or { error }.
 */
export function validateLocalPatterns(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return { error: 'the local publish file is not a JSON object' };
  const patterns = l.patterns ?? [];
  const err = patternErrors(patterns, 'the local patterns');
  if (err) return { error: err };
  if (!patterns.some((p) => p.name === OWNER_PATTERN_NAME)) {
    return { error: `the local patterns have no pattern named ${JSON.stringify(OWNER_PATTERN_NAME)}: the private repository's owner is scanned for in every publish` };
  }
  return { patterns };
}

function patternErrors(patterns, label) {
  if (!Array.isArray(patterns)) return `${label} is not a list`;
  for (const p of patterns) {
    if (!p || typeof p.name !== 'string' || typeof p.regex !== 'string') return `${label}: each needs a name and a regex`;
    try { new RegExp(p.regex, p.flags ?? ''); } catch (e) { return `${label}: ${p.name}: ${e.message}`; }
    if (/[gy]/.test(p.flags ?? '')) return `${label}: ${p.name}: the g and y flags are not allowed`;
  }
  return null;
}

// A path component as Windows resolves it (G-5 of 20261117-122032-m2-9a-d1-2): an NTFS stream suffix (`name::$DATA`)
// names the same entry, and trailing dots and spaces are stripped, so `.git.`, `.git ` and `.git::$INDEX_ALLOCATION` are
// all `.git`. Compared literally, each passed the guard below.
function windowsName(c) {
  return c.split(':')[0].replace(/[. ]+$/, '').toLowerCase();
}

function namesGit(p) {
  // GIT~1 is the 8.3 short name Windows gives `.git` when short names are on.
  return String(p).replace(/\\/g, '/').split('/').some((c) => windowsName(c) === '.git' || /^git~\d+$/i.test(c.replace(/[. ]+$/, '')));
}

function isUnsafeRel(p) {
  const s = String(p).replace(/\\/g, '/');
  // `.. ` is `..` once Windows strips its trailing space; every all-dots component of two or more is refused with it.
  return s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').some((c) => /^\.\.[. ]*$/.test(c));
}

/**
 * Which tracked files ship, and from where. `tracked` is the source commit's file list (repo-relative, `/`).
 * Returns { ship: [{ path, from }], excluded: [path], errors: [string] }: every published path once, a replacement's
 * source not shipped under its own name, an excluded or missing replacement source an error.
 */
export function planSnapshot(tracked, manifest) {
  const files = tracked.map((f) => String(f).replace(/\\/g, '/'));
  const have = new Set(files);
  const isExcluded = (f) => manifest.exclude.some((g) => matchesGlob(g, f));
  const sources = new Set(Object.values(manifest.replace));
  const errors = [];
  const out = new Map();
  const excluded = [];
  for (const f of files) {
    if (sources.has(f)) continue;            // shipped only under the name that replaces
    if (isExcluded(f)) { excluded.push(f); continue; }
    out.set(f, f);
  }
  for (const [to, from] of Object.entries(manifest.replace)) {
    if (!have.has(from)) { errors.push(`replace ${to}: its source ${from} is not tracked at this commit`); continue; }
    // The source is held to the exclusions too (G-11 of 20261117-031403-m2-9a-d1): otherwise an excluded private file's
    // bytes ship under a public name.
    if (isExcluded(from)) { errors.push(`replace ${to}: its source ${from} is excluded`); continue; }
    if (isExcluded(to)) { errors.push(`replace ${to}: the published path is excluded`); continue; }
    out.set(to, from);
  }
  return { ship: [...out].map(([path, from]) => ({ path, from })).sort((a, b) => a.path.localeCompare(b.path)), excluded, errors };
}

/**
 * The untracked, unignored files (git's list, repo-relative) that would ship had they been committed: every one not
 * under a manifest exclusion (G-5 of 20261119-000606-m2-9c-d1). A publish refuses while any stands, since the commit it
 * snapshots is then not the tree the operator sees; one under an excluded path (a review run) could never ship. Pure.
 */
export function untrackedThatShips(untracked, manifest) {
  return untracked.map((f) => String(f).replace(/\\/g, '/')).filter(Boolean)
    .filter((f) => !manifest.exclude.some((g) => matchesGlob(g, f))).sort();
}

/**
 * Every finding in one shipped file's text: [{ path, line, name, excerpt }] for each pattern, and [{ path, line,
 * marker }] for a placeholder marker. An excerpt is bounded and never the whole line, so a report does not republish
 * what it found.
 */
export function scanText(path, text, { patterns = [], markers = [] } = {}) {
  const hits = [];
  const lines = String(text).split(/\r?\n/);
  // Every occurrence is a hit (G-12 of 20261117-031403-m2-9a-d1): one exec per line reported only the first, so the one
  // allowance naming that line covered every occurrence on it. The manifest refuses g and y; the scan adds g itself.
  const compiled = patterns.map((p) => ({ name: p.name, re: new RegExp(p.regex, `${p.flags ?? ''}g`) }));
  lines.forEach((ln, i) => {
    for (const { name, re } of compiled) {
      re.lastIndex = 0;
      for (let m = re.exec(ln); m; m = re.exec(ln)) {
        hits.push({ path, line: i + 1, name, excerpt: excerptAround(ln, m.index, m[0].length), line_sha256: lineSha256(ln) });
        if (m[0].length === 0) { if (re.lastIndex >= ln.length) break; re.lastIndex += 1; }
      }
    }
    for (const marker of markers) {
      if (ln.includes(marker)) hits.push({ path, line: i + 1, marker });
    }
  });
  return hits;
}

/**
 * Scan one shipped file's BYTES. Text is scanned as UTF-8. A file holding a NUL byte is binary or UTF-16, and gitleaks is
 * never given the identity or machine-local patterns, so skipping it shipped them unreported (G-22 of
 * 20261116-221234-m2-9a-high-2): it is scanned as Latin-1 (one byte, one character, so an ASCII string inside a binary
 * shows as itself) and as UTF-16LE, each hit once.
 */
export function scanShipped(path, buf, opts = {}) {
  if (!buf.includes(0)) return scanText(path, buf.toString('utf8'), opts);
  const seen = new Set();
  const hits = [];
  for (const view of [buf.toString('latin1'), buf.toString('utf16le')]) {
    // The nth occurrence of a name on a line is one hit across the views, so two on one line stay two (G-12).
    const nth = new Map();
    for (const h of scanText(path, view.replace(/\0/g, ''), opts)) {
      const at = `${h.line}\0${h.name ?? ''}\0${h.marker ?? ''}`;
      const n = (nth.get(at) ?? 0) + 1;
      nth.set(at, n);
      const k = `${at}\0${n}`;
      if (!seen.has(k)) { seen.add(k); hits.push(h); }
    }
  }
  return hits;
}

function excerptAround(ln, at, len) {
  const from = Math.max(0, at - 20);
  const to = Math.min(ln.length, at + len + 20);
  return `${from > 0 ? '…' : ''}${ln.slice(from, to)}${to < ln.length ? '…' : ''}`;
}

/**
 * The release's CHANGELOG section: the text under `## <version>` (a heading that starts with the version, followed by
 * the end of the line, a space or ` ·`) up to the next `## ` heading. Returns { title, body } or { error }.
 * `Unreleased` is not a release: stage 8 renames it to the version before a publish.
 */
export function changelogEntry(changelog, version) {
  const v = String(version ?? '').trim();
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(v)) return { error: `the version ${JSON.stringify(v)} is not x.y.z` };
  const lines = String(changelog).split(/\r?\n/);
  const esc = v.replace(/[.+]/g, '\\$&');
  const head = new RegExp(`^##\\s+v?${esc}(\\s|$)`);
  const at = lines.findIndex((l) => head.test(l));
  if (at < 0) return { error: `CHANGELOG.md has no "## ${v}" section; the release entry is written before a publish (stage 8)` };
  let end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(at + 1, end).join('\n').replace(/^\s*-{3,}\s*$/gm, '').trim();
  if (!body) return { error: `CHANGELOG.md's "## ${v}" section is empty` };
  return { title: lines[at].replace(/^##\s+/, '').trim(), body };
}

/**
 * Only master's commit may publish (stage 9c; G-22 of 20261116-200635-m2-9a-high, G-21 of 20261116-221234-m2-9a-high-2).
 * Returns { refusal, notice }: a publish of another commit is refused; a dry run commits nothing, so it may preview any
 * commit and is told instead.
 */
export function publishRefCheck({ ref, sourceCommit, masterCommit, dryRun }) {
  if (sourceCommit === masterCommit) return { refusal: null, notice: null };
  const why = masterCommit ? `master is ${masterCommit.slice(0, 8)}` : 'there is no master branch';
  if (!dryRun) {
    return { refusal: `--ref ${ref} is ${sourceCommit.slice(0, 8)}, not master's commit (${why}); a release is published from master only`, notice: null };
  }
  return { refusal: null, notice: `--ref ${ref} is not master's commit (${why}); a publish of it would be refused` };
}

/** The published commit's message: the release title, the entry, and the source commit it was taken from. */
export function commitMessage({ version, entry, sourceCommit }) {
  return `quorate ${version}: ${entry.title.replace(/^v?\S+\s*[·-]?\s*/, '') || 'release'}\n\n${entry.body}\n\nSnapshot of source commit ${sourceCommit}.\n`;
}

/**
 * Parse "Name <email>" into { name, email }, or { error }. The identity the published commit is authored and
 * committed as; it must be given, never inherited from the machine's git configuration.
 */
export function parseIdentity(s) {
  const m = /^\s*([^<>]+?)\s*<([^<>\s@]+@[^<>\s@]+)>\s*$/.exec(String(s ?? ''));
  if (!m) return { error: `the identity ${JSON.stringify(s ?? '')} is not "Name <email>"` };
  return { name: m[1], email: m[2] };
}

/**
 * The published contract may differ from the private one only in doc_roles.request (Q12), and in comment text, which is
 * not a key (I-5; G-32 of 20261117-013640-m2-9a-final, operator: "Check keys, allow reader comments (Recommended)"). Both
 * are parsed graph_contract objects. Returns the differing key paths, [] when only the allowed key differs; a published
 * doc_roles.request that is not empty is a difference too, since a copy names no private design record.
 */
export function contractDrift(privateContract, publicContract) {
  const request = publicContract?.doc_roles?.request;
  const requestNamed = request !== undefined && request !== '';
  const strip = (c) => {
    const copy = JSON.parse(JSON.stringify(c ?? {}));
    if (copy.doc_roles) delete copy.doc_roles.request;
    return copy;
  };
  const diffs = [];
  const walk = (a, b, at) => {
    const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
    if (isObj(a) && isObj(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], at ? `${at}.${k}` : k);
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(at || '(root)');
  };
  walk(strip(privateContract), strip(publicContract), '');
  if (requestNamed) diffs.push('doc_roles.request (not empty)');
  return diffs;
}

/**
 * Split hits into the ones that still stop a publish and the ones an allowance covers. A hit is [{ path, name? ,
 * marker? }]: a marker hit is never allowed, and neither is a name the manifest does not declare (the local identity
 * patterns). Returns { kept, allowed, unused }: `unused` are allowances that matched no hit, which refuse the publish.
 * An allowance covers ONE hit, of its file, its pattern and the line its line_sha256 names; a second hit, even of an
 * identical line, needs its own (G-19 of 20261116-221234-m2-9a-high-2).
 */
export function applyAllowances(hits, allow = []) {
  const used = new Set();
  const kept = [];
  const allowed = [];
  for (const h of hits) {
    const at = h.marker ? -1 : allow.findIndex((a, i) => !used.has(i) && a.path === h.path && a.pattern === h.name
      && typeof h.line_sha256 === 'string' && a.line_sha256 === h.line_sha256);
    if (at < 0) { kept.push(h); continue; }
    used.add(at);
    allowed.push({ ...h, reason: allow[at].reason });
  }
  return { kept, allowed, unused: allow.filter((_, i) => !used.has(i)) };
}

/**
 * THE PUBLISHED CONTRACT, made from the private CLAUDE.md (Q12, "Declared replacement"; m2-public-release.plan.md stage
 * 2b). The private file's `doc_roles.request` names a design record the mirror leaves out, above a comment that is that
 * key's private history. The published copy is the same file with that comment replaced by a short one for readers and
 * the key empty, so its keys differ from the private contract's only there (contractDrift). This makes a STARTING copy
 * (`--write-public-contract`); the publish checks the copy's keys, not its bytes, so its comments may then be rewritten
 * for readers (I-5; G-32 of 20261117-013640-m2-9a-final). Returns { text } or { error }.
 */
export const PUBLIC_REQUEST_COMMENT = [
  '  # Empty in a copy of quorate: no request is declared, so a review finds an approved request under',
  '  # .claude/requests/ or recovers one, as shared/claude-md-contract.md describes. Name the request your work',
  '  # answers here, or pass --request to new-run. (The development repository records here which request each',
  '  # stretch of work was judged against; that history stays with its private design records.)',
];
export function publicContractText(privateText) {
  const lines = String(privateText).split('\n');
  const at = lines.findIndex((l) => /^ {2}request:\s+"/.test(l));
  if (at < 0) return { error: 'CLAUDE.md has no `  request: "..."` line under doc_roles' };
  let start = at;
  while (start > 0 && /^ {2}#/.test(lines[start - 1])) start -= 1;
  if (start === at) return { error: 'CLAUDE.md has no comment above doc_roles.request to replace' };
  const out = [...lines.slice(0, start), ...PUBLIC_REQUEST_COMMENT, '  request:      ""', ...lines.slice(at + 1)];
  return { text: out.join('\n') };
}
