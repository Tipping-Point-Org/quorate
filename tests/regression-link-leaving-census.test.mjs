// THE CENSUS OF LINK-LEAVING CHECKS (link-leaving-owner.plan.md stage 5). The walks and copies each carried part of the rule
// and diverged (link-leaving-owner.design.md, "What exists"); this holds every directory walk, tree copy and hard-link test
// in scripts/ to the owners: lib/finding-scope.mjs's firstLeadingOut for a tree, lib/egress-read.mjs's hardLinkReason for
// one file. A site that does neither is allowed only here, with its reason.
//
// THE INSTRUMENT, kept in this file (the design note's searches, made structural):
// - a directory walk: a function whose body lists a directory (readdirSync, readdir, `.list(`) and calls itself, or one
//   named `walk` or `visit` that lists one (G-18 of 20261122-193909-llo-delivery: the names alone missed sizeOf and
//   copyOutOfRun); it asks the owner in its body or in the dozen lines before it;
// - a tree copy: `cpSync(` or `promises.cp(` with `recursive`;
// - a hard-link test: `nlink` compared with `>`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const OWNER = 'scripts/lib/finding-scope.mjs';

/**
 * The body of the function defined at `at` in `src`: past its parameter list (a default such as `io = {}` holds a brace),
 * from the next `{` to the brace that closes it, strings skipped.
 */
function bodyAt(src, at) {
  let k = src.indexOf('(', at);
  for (let depth = 0; k >= 0 && k < src.length; k++) {
    if (src[k] === '(') depth++;
    else if (src[k] === ')' && --depth === 0) break;
  }
  // An arrow with an expression body (`(n) => f(n)`) has no braced body: the next `{` is another function's.
  const after = /^\s*(?:=>\s*)?\{/.exec(src.slice(k + 1));
  if (!after) return '';
  let i = k + after[0].length;
  let depth = 0;
  let quote = null;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (quote) { if (ch === '\\') j++; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j < 0) break; continue; }
    if (ch === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j + 2); if (j < 0) break; j++; continue; }
    // A regex literal (a `/` where a value starts) is skipped whole, so a quote or brace inside it is not counted.
    // After an arrow too (`(a) => /x/.test(a)`): missed, a quote inside the regex opened a string and the body ran on into
    // the functions after it (found by G-10's wider rule, 20261122-204359-llo-remediation-review).
    if (ch === '/' && /(?:[(,=:[!&|?{};]|=>)\s*$|^\s*$/.test(src.slice(Math.max(0, j - 40), j).split('\n').at(-1))) {
      let cls = false;
      for (j++; j < src.length && src[j] !== '\n'; j++) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return src.slice(i);
}

/**
 * Whether `text` asks the owner AND tests its answer (G-14 of 20261122-214154-llo-remediation-2-review): a call inside a
 * condition, a return, a throw or a negation; or an answer assigned to a name that a condition then tests. A call whose
 * answer is discarded, or assigned and never tested, judges nothing.
 */
export function ownerGuards(text) {
  if (/(?:\bif\s*\(|\breturn\b|\bthrow\b|[!?]|&&|\|\|)\s*(?:await\s+)?firstLeadingOut\(/.test(text)) return true;
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*firstLeadingOut\(/g)) {
    const esc = m[1].replace(/\$/g, '\\$');
    if (new RegExp(`\\b(?:if|while)\\s*\\([^\\n]*(?<![\\w$.])${esc}\\b|(?<![\\w$.])${esc}\\s*(?:\\?|&&|\\|\\|)`).test(text.slice(m.index + m[0].length))) return true;
  }
  return false;
}

/** Every directory walk in one file: `{ name, line, key }`, key being `<file>: <the definition's line, trimmed>`. */
// A function of ANY name is a walk when its body lists a directory and calls itself (G-18 of 20261122-193909-llo-delivery:
// matching only `walk` and `visit` left sizeOf and copyOutOfRun unexamined); one named `walk` or `visit` is a walk on its
// listing alone, as before. It asks the owner when firstLeadingOut is called in its body or in the dozen lines before its
// definition, the rule a tree copy is held to.
export function directoryWalks(file, src) {
  const out = [];
  // The third alternative is an object method (`scan(d) {`), a keyword's parenthesis excluded (G-10 of
  // 20261122-204359-llo-remediation-review).
  const re = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b[^(]*)?\(|(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|^[ \t]*(?:async\s+)?\*?(?!(?:if|for|while|switch|catch|function|return|with)\b)([A-Za-z_$][\w$]*)\s*\([^()\n]*\)\s*\{/gm;
  const lines = src.split('\n');
  for (let m; (m = re.exec(src));) {
    const name = m[1] ?? m[2] ?? m[3];
    const body = bodyAt(src, m.index);
    if (!/\breaddirSync\(|\breaddir\(|\.list\(/.test(body)) continue;
    const esc = name.replace(/\$/g, '\\$');
    // Itself by name, or through `this.` as a method calls itself.
    const self = new RegExp(`(?<![\\w$.'"\`])${esc}\\(|\\bthis\\.${esc}\\(`);
    const code = body.split('\n').map((l) => l.replace(/^\s*(\/\/|\*).*$/, '').replace(/\s\/\/\s.*$/, '')).join('\n');
    // A walk that does not call itself drives a stack or a queue: a loop that pops or shifts what it pushes (G-10).
    const driven = /\bwhile\s*\(/.test(code) && /\.(?:pop|shift)\(\)/.test(code);
    if (!/^(walk|visit)$/.test(name) && !self.test(code) && !driven) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const before = lines.slice(Math.max(0, line - 13), line - 1).join('\n');
    out.push({ name, line, key: `${file}: ${lines[line - 1].trim()}`, usesOwner: ownerGuards(body) || ownerGuards(`${before}\n${body}`) });
  }
  return out;
}

/** Every recursive tree copy, and whether firstLeadingOut is asked in the dozen lines before it. */
export function treeCopies(file, src) {
  const lines = src.split('\n');
  const out = [];
  lines.forEach((l, i) => {
    if (/^\s*\/\//.test(l)) return;
    if (!/\bcpSync\(|promises\.cp\(/.test(l) || !/recursive/.test(l)) return;
    const before = lines.slice(Math.max(0, i - 12), i).join('\n');
    out.push({ line: i + 1, key: `${file}: ${l.trim()}`, judged: ownerGuards(before) });
  });
  return out;
}

/**
 * Every `nlink` compared, in any spelling (`>`, `>=`, `<`, `<=`, `==`, `===`, `!=`, `!==`, on either side), outside a
 * comment (G-11 of 20261122-204359-llo-remediation-review: only `>` was matched). An arrow's `=>` is not a comparison.
 */
const NLINK_COMPARED = /\bnlink\b\)?\s*(?:[<>]=?|[!=]==?)|(?:(?<!=)[<>]=?|[!=]==?)\s*(?:[\w$.]+\()?[\w$.]*\bnlink\b|>\s*1n?\b[^;]*\bnlink\b/;
export function nlinkTests(file, src) {
  return src.split('\n').flatMap((l, i) => (!/^\s*(\/\/|\*)/.test(l) && NLINK_COMPARED.test(l)
    ? [{ line: i + 1, key: `${file}: ${l.trim()}` }] : []));
}

// Each exception, with its reason. A key is `<file>: <the line, trimmed>`, matched exactly.
const WALKS_ALLOWED = new Map([
  ['scripts/check-syntax.mjs: function walk(dir, out = []) {', 'lists the source files to parse; it reads nothing to a boundary'],
  ['scripts/code-index.mjs: const walk = (d) => {', "lists an extractor's fixture files for the conformance tool; a link is not followed (a Dirent of one is not a directory)"],
  ['scripts/external-review.mjs: const walk = (d) => {', 'emptyRepositoryErrors: refuses anything but a directory or regular file, stricter than the owner'],
  ['scripts/io/doc-snapshot.mjs: const walk = (dir) => {', "the intent snapshot: its own classifier (classifySnapshotEntry) decides each entry, and each copy is read through egress-read, which refuses a hard link"],
  ['scripts/io/glob-walk.mjs: const walk = (p) => {', 'selects files for a glob and guards no boundary; an unreadable entry is skipped there (design LL-D3)'],
  ['scripts/io/preflight-cache.mjs: function sizeOf(p) {', "measures the cache's own bytes for eviction: it lstats, so a link is counted as itself and never followed, and it reads and copies nothing"],
  ['scripts/io/preflight-cache.mjs: const walk = (dir, segs) => {', 'the cached evidence restore: refuses every link, inward ones too, and a hard-linked file (hardLinkReason), stricter than the owner'],
  ['scripts/io/reviews-root.mjs: const walk = (dir, prefix) => {', "evidenceIgnoredByGit: lists the evidence to ask git about; a link there makes the answer unknown, so the evidence is withheld"],
  ['scripts/io/snapshot.mjs: const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {', "the arms' build check: refuses every link and a hard-linked file (hardLinkReason), stricter than the owner"],
  ['scripts/io/worktree.mjs: function walk(abs, out, visited, skip = () => false, io = {}) {', "the arms' working-tree mirror: records each entry's dev, ino and nlink for the snapshot's own rule (LL-D2 A)"],
]);
const COPIES_ALLOWED = new Map([
  ['scripts/bench-second-opinion.mjs: fs.cpSync(c.runDir, copy, { recursive: true, filter: (from) => {', "the bench's preserved-run copy: its filter refuses a link and names a hard link, by the operator's 2026-10-31 rule kept on 2026-11-22 (design LL-D4)"],
]);
const NLINK_ALLOWED = new Map([
  ['scripts/lib/snapshot-surface.mjs: if (REGULAR_MODES.has(e.mode) && BigInt(e.nlink) > 1n) {', "the arms snapshot's named exception (design LL-D2 A): a hard link admitted when all its names are in the snapshot"],
  ['scripts/lib/snapshot-surface.mjs: if (BigInt(g.paths.length) >= g.nlink) continue;', "the same exception's second half (design LL-D2 A): every name of the hard link is in the snapshot, so it is admitted; found once G-11 widened the rule past `>`"],
]);

function sources() {
  const out = [];
  const visit = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) visit(p);
      else if (e.name.endsWith('.mjs')) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  visit(path.join(ROOT, 'scripts'));
  return out.sort().map((f) => ({ file: f, src: fs.readFileSync(path.join(ROOT, f), 'utf8') }));
}

test('every directory walk in scripts/ goes through firstLeadingOut, or is allowed with a reason', () => {
  const bad = sources().flatMap(({ file, src }) => (file === OWNER ? [] : directoryWalks(file, src)))
    .filter((w) => !w.usesOwner && !WALKS_ALLOWED.has(w.key)).map((w) => w.key);
  assert.deepEqual(bad, [], 'a directory walk that neither asks the owner nor is named here, with its reason');
});

test('every recursive tree copy is judged by firstLeadingOut before it writes, or is allowed with a reason', () => {
  const bad = sources().flatMap(({ file, src }) => treeCopies(file, src))
    .filter((c) => !c.judged && !COPIES_ALLOWED.has(c.key)).map((c) => c.key);
  assert.deepEqual(bad, [], 'a tree copy that writes before the owner judges what it copies');
});

test('no nlink test outside hardLinkReason, but the named exception', () => {
  const bad = sources().flatMap(({ file, src }) => (file === 'scripts/lib/egress-read.mjs' ? [] : nlinkTests(file, src)))
    .filter((n) => !NLINK_ALLOWED.has(n.key)).map((n) => n.key);
  assert.deepEqual(bad, [], 'an inline hard-link test: ask hardLinkReason (lib/egress-read.mjs)');
});

test('every allow-list entry still names a site, so a stale reason cannot outlive its code', () => {
  const all = sources();
  const walks = new Set(all.flatMap(({ file, src }) => directoryWalks(file, src).map((w) => w.key)));
  const copies = new Set(all.flatMap(({ file, src }) => treeCopies(file, src).map((c) => c.key)));
  const nlinks = new Set(all.flatMap(({ file, src }) => nlinkTests(file, src).map((n) => n.key)));
  const stale = [...[...WALKS_ALLOWED.keys()].filter((k) => !walks.has(k)), ...[...COPIES_ALLOWED.keys()].filter((k) => !copies.has(k)),
    ...[...NLINK_ALLOWED.keys()].filter((k) => !nlinks.has(k))];
  assert.deepEqual(stale, []);
});

test('the instrument itself: each rule finds what it is for, and passes what is not', () => {
  // A walk restating isSymbolicLink() without the owner is found; one that asks the owner is not flagged.
  const inline = 'const walk = (d) => { for (const n of fs.readdirSync(d)) { if (fs.lstatSync(n).isSymbolicLink()) return n; } };';
  assert.deepEqual(directoryWalks('x.mjs', inline).map((w) => w.usesOwner), [false]);
  assert.deepEqual(directoryWalks('x.mjs', 'const visit = (d) => { fs.readdirSync(d); return firstLeadingOut(d); };').map((w) => w.usesOwner), [true]);
  assert.deepEqual(directoryWalks('x.mjs', 'const walk = (v) => { for (const k of Object.keys(v)) walk(v[k]); };'), [], 'a walk over an object is not a directory walk');
  // A RECURSIVE LISTING OF ANY NAME IS A WALK (G-18 of 20261122-193909-llo-delivery): only `walk` and `visit` were found,
  // so preflight-cache's sizeOf and copyOutOfRun were never examined.
  assert.equal(directoryWalks('x.mjs', 'function sizeOf(p) { return fs.readdirSync(p).reduce((s, n) => s + sizeOf(n), 0); }').length, 1);
  assert.equal(directoryWalks('x.mjs', 'function copyOut(owner, segs) { for (const n of owner.list(segs)) copyOut(owner, [...segs, n]); }').length, 1);
  assert.equal(directoryWalks('x.mjs', 'const judge = (rel) => { for (const n of owner.list(rel)) judge([...rel, n]); };').length, 1);
  assert.equal(directoryWalks('x.mjs', 'function names(d) { return fs.readdirSync(d); }').length, 0, 'one listing, not recursive, is not a walk');
  // The owner asked just before the walk's definition judges it, as it judges a tree copy.
  assert.deepEqual(directoryWalks('x.mjs', 'if (firstLeadingOut(d)) throw 1;\nconst judge = (r) => { for (const n of o.list(r)) judge(n); };').map((w) => w.usesOwner), [true]);
  // A default parameter's brace is not the body (worktree.mjs's `io = {}`).
  assert.equal(directoryWalks('x.mjs', 'function walk(d, io = {}) { io.fs.readdirSync(d); }').length, 1);
  // A brace inside a string does not end the body early.
  assert.equal(directoryWalks('x.mjs', "const walk = (d) => { const s = '}'; fs.readdirSync(d); };").length, 1);
  // An unjudged copy is found; one judged just before is not.
  assert.deepEqual(treeCopies('x.mjs', 'fs.cpSync(a, b, { recursive: true });').map((c) => c.judged), [false]);
  assert.deepEqual(treeCopies('x.mjs', 'const out = firstLeadingOut(a);\nif (out) throw 1;\nfs.cpSync(a, b, { recursive: true });').map((c) => c.judged), [true]);
  // An inline nlink test is found, in each spelling; a comment is not.
  assert.equal(nlinkTests('x.mjs', 'if (st.nlink > 1) throw 1;').length, 1);
  assert.equal(nlinkTests('x.mjs', 'if (lstat(p).nlink > 1n) bad.push(p);').length, 1);
  assert.equal(nlinkTests('x.mjs', '// a file with nlink > 1 is a hard link').length, 0);
});

test('G-11: the nlink rule finds a hard-link test in every comparison spelling', () => {
  // EVERY COMPARISON, NOT ONLY `>` (G-11 of 20261122-204359-llo-remediation-review): `>= 2` or `!== 1` tested a hard link
  // the same way and passed the census.
  for (const s of ['if (st.nlink >= 2) throw 1;', 'if (st.nlink !== 1) throw 1;', 'if (st.nlink != 1) throw 1;',
    'if (1 < st.nlink) throw 1;', 'if (2 <= st.nlink) throw 1;', 'if (Number(st.nlink) === 2) throw 1;']) {
    assert.equal(nlinkTests('x.mjs', s).length, 1, `an nlink test spelled ${s} passed the census`);
  }
  assert.equal(nlinkTests('x.mjs', 'const facts = { nlink: st.nlink };').length, 0, 'recording nlink is not testing it');
});

test('G-14: an owner call whose answer guards nothing does not make a walk or a copy compliant', () => {
  // AN IGNORED ANSWER IS NOT A JUDGEMENT (G-14 of 20261122-214154-llo-remediation-2-review, panel-codex-contract): any
  // textual firstLeadingOut call in the body or the dozen lines before passed, though its result was thrown away.
  assert.deepEqual(directoryWalks('x.mjs', 'const walk = (d) => { firstLeadingOut(d); for (const n of fs.readdirSync(d)) walk(n); };').map((w) => w.usesOwner), [false],
    'a walk whose owner answer is discarded passed the census');
  assert.deepEqual(directoryWalks('x.mjs', 'const out = firstLeadingOut(d);\nconst walk = (r) => { for (const n of fs.readdirSync(r)) walk(n); };').map((w) => w.usesOwner), [false],
    'an owner answer assigned and never tested passed the census');
  assert.deepEqual(treeCopies('x.mjs', 'firstLeadingOut(a);\nfs.cpSync(a, b, { recursive: true });').map((c) => c.judged), [false],
    'a copy whose owner answer is discarded passed the census');
  // A tested answer still counts, assigned or inline.
  assert.deepEqual(directoryWalks('x.mjs', 'let leads;\nleads = firstLeadingOut(d, { leaving: true });\nif (leads) stop(1);\nconst walk = (r) => { for (const n of fs.readdirSync(r)) walk(n); };').map((w) => w.usesOwner), [true]);
});

// EVERY EXCEPTION TO THE OWNER'S WALK IS RECORDED (G-9 of 20261122-214154-llo-remediation-2-review): A-30 makes this census
// the record of the walk's exceptions, and a `skip:` predicate handed to firstLeadingOut is one, yet publish's skip of
// --out's git directory was in no list. Each call passing `skip:` is named here with its reason.
const SKIPS_ALLOWED = new Map([
  ['scripts/io/reviews-root.mjs', "evidenceIgnoredByGit's withheld entries: evidence git would not ignore stays staged and is never moved, so it is not walked"],
  ['scripts/publish.mjs', "--out's git directory: a local clone hard-links its objects, and nothing is deleted there; the one write below it, the secret scan's record, refuses a link at its folder and creates its file new (G-10)"],
]);
test('G-9: every firstLeadingOut call with a skip predicate is a recorded exception, with its reason', () => {
  const skipping = sources().filter(({ file, src }) => file !== OWNER && /\bfirstLeadingOut\([^\n]*\bskip\s*:/.test(src)).map(({ file }) => file);
  assert.deepEqual(skipping.filter((f) => !SKIPS_ALLOWED.has(f)), [], 'a walk exception handed to the owner that the census does not record');
  assert.deepEqual([...SKIPS_ALLOWED.keys()].filter((f) => !skipping.includes(f)), [], 'a recorded skip whose call is gone');
});

test('G-10: the walk rule finds a walk that does not call itself by name', () => {
  // A WALK THAT DOES NOT CALL ITSELF (G-10 of 20261122-204359-llo-remediation-review): a stack- or queue-driven walk, and
  // an object method that lists and recurses, were invisible, so the census could not fail when one was added.
  assert.equal(directoryWalks('x.mjs', 'function tree(root) { const stack = [root]; while (stack.length) { const d = stack.pop(); for (const n of fs.readdirSync(d)) stack.push(n); } }').length, 1,
    'a stack-driven walk is not found');
  assert.equal(directoryWalks('x.mjs', 'const all = (root) => { const q = [root]; while (q.length) { for (const n of fs.readdirSync(q.shift())) q.push(n); } };').length, 1,
    'a queue-driven walk is not found');
  assert.equal(directoryWalks('x.mjs', 'const o = {\n  scan(d) { for (const n of fs.readdirSync(d)) this.scan(n); },\n};').length, 1,
    'an object method that recurses through this is not found');
  assert.equal(directoryWalks('x.mjs', 'function names(d) { const out = []; for (const n of fs.readdirSync(d)) out.push(n); return out; }').length, 0,
    'one listing with a push, no loop over a stack, is not a walk');
  // A regex after an arrow ends where it ends: the body of `f` does not run on into `g`.
  assert.deepEqual(directoryWalks('x.mjs', 'function f(a) { return a.find((x) => /["]/.test(x)); }\nfunction g(q) { while (q.length) fs.readdirSync(q.pop()); }')
    .map((w) => w.name), ['g']);
});

// LINK-LEAVING-OWNER'S LINK FIXTURES SKIP BY NAME (G-9 of 20261122-204359-llo-remediation-review; the plan's "Verified by":
// "through tests/helpers.mjs's makeLink (a kind the platform refuses is skipped by name)"): a fixture calling symlinkSync
// itself fails as a setup error where the platform refuses the link, rather than naming the skip.
// G-13 and G-15 of 20261122-214154-llo-remediation-2-review (panel-codex-arch): the intent sandbox's and publish's link
// fixtures were raw calls, so a refused link failed at setup instead of skipping by name (ARCHITECTURE A-16).
const LINK_FIXTURE_FILES = ['tests/regression-claim-check-new-confined.test.mjs', 'tests/regression-preflight-cache-read-confined.test.mjs',
  'tests/regression-intent-add-dir-run-dir.test.mjs', 'tests/regression-publish.test.mjs'];
test("link-leaving-owner's link fixtures are made through makeLink, so a refused kind skips by name", () => {
  const raw = LINK_FIXTURE_FILES.flatMap((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')
    .map((l, i) => ({ l, at: `${f}:${i + 1}` }))
    .filter(({ l }) => !/^\s*(\/\/|\*)/.test(l) && /\b(?:symlinkSync|linkSync|symlink|link)\s*\(/.test(l) && !/\bmakeLink\s*\(/.test(l)))
    .map(({ at }) => at);
  assert.deepEqual(raw, [], 'a link fixture made with a raw call, not makeLink');
});
