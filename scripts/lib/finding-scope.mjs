// The scope checks every finding must pass, whoever produced it — and the one owner of repository
// containment, which several callers that are not findings depend on (see the note below).
//
// `evidence/<node>/verdict.kept.json` had two writers with two different authorities. spawn-node
// wrote it only after validateVerdict, and its comment declares the artifact to BE the validated
// set precisely so "rejecting a finding has to mean it is gone". run-graph's spawnPanelArm
// hand-wrote the same artifact for every panel arm with `rejected_count: 0` — asserting a
// validation that never ran — and collectFindings read both indiscriminately into
// finding-groups.json, the reconciler's only input, and thence into reconciled.md, which is
// remediate's work list under bypassPermissions.
//
// So an arm finding was never checked for repository containment, file existence, line bounds, or
// the generated-glob exclusion, while external-review passed `f.file` through verbatim. A codex arm
// returning `../../.ssh/config` or a path under `.claude/reviews/**` therefore arrived as a counted
// finding with an artifact name asserting it had been validated (G-33; I-29 names "an arm envelope
// bypasses the validator on its way to reconcile" as a failure mode).
//
// ALSO THE HOME OF CONTAINMENT (G-17). `escapesAfterRealpath` started as one clause of the finding
// check and became the framework's general "may this path be read" primitive: lib/excerpt.mjs uses
// it to gate what leaves for a third-party cloud, new-run.mjs to confine the reviews directory at
// mint, capture.mjs and run-graph for --cwd and doc_paths. Neither of those callers is a finding, so
// a header claiming this module holds only finding checks told a reader that repository containment
// is decided somewhere else. The placement is deliberate — excerpt.mjs imports rather than copies,
// "so there is still exactly one owner" — and it is the header that had not caught up. An untrue
// header is the same defect this file's own comments cite elsewhere.
//
// These are the checks that are TRUE OF ANY FINDING regardless of producer. Evidence-path ownership
// is lens-specific and only spawn-node calls it, but its containment is decided here, by the owner
// (evidenceOwnershipError below, G-19 of 20261025-104155-srf-remediation-3-review); basis and intent
// rules stay in spawn-node: an external arm is told not to
// claim an evidence path at all, and its basis and severity are capped before this point — by the
// ceilings armLimitsFor computes (lib/capabilities.mjs), which external-review applies. An earlier
// version said its roster entry declares them, while the caps were literals inside external-review
// and no roster entry carried one (G-14).

import path from 'node:path';
import { absolute, resolveFrom } from './paths.mjs';
import { matchesAnyGlob } from './contract-glob.mjs';
import { requireIo } from './io-param.mjs';
import { confined } from './confined-path.mjs';
import { hardLinkReason } from './egress-read.mjs';

// NO node:fs HERE (os-platform-adapters stage 3). The functions below that must ask the filesystem
// take the platform implementation as `io`; scripts/io/finding-scope.mjs binds them to the host for
// the orchestration scripts, so call sites there are unchanged.

/**
 * Line count of a file, or null when it cannot be read. Null means "cannot bound", not "zero".
 *
 * NOT CACHED, deliberately (G-24). Re-reading per finding is O(N x S), and measured it is nothing:
 * 700 validations against this repository's largest file cost 249ms inside a run of tens of minutes.
 * A cache would buy that back and take on a correctness risk in exchange — the validator would bound
 * a finding against a line count from before an edit, and being right about where a finding may
 * point is this module's entire job.
 */
export function countLines(p, io) {
  requireIo(io, 'countLines');
  try {
    const text = io.fs.readFileSync(p, 'utf8');
    if (!text.length) return 0;
    const parts = text.split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    return parts.length;
  } catch {
    return null;
  }
}

/**
 * Reasons this finding's LOCATION is inadmissible. Empty array = admissible.
 *
 * Containment is the load-bearing one: remediate runs with bypassPermissions and takes
 * reconciled.md as its work list, so a finding naming a path outside the repository is a route to
 * an authorised edit outside the repository.
 */
/**
 * Is this resolved path REALLY inside the repository, after following links?
 *
 * `path.resolve` is lexical: it collapses `..` and nothing else. An in-repository symlink (or a
 * Windows junction) pointing outside therefore passed containment, entered reconciled.md, and could
 * direct a later bypassPermissions edit at a file outside the tree under review — which is the
 * escape this module's header calls load-bearing (G-25/G-26, security-audit and
 * panel-codex-security independently).
 *
 * Checked AFTER the lexical test and only for paths that exist, because realpath throws on a
 * missing file and "does not exist" is already a clearer rejection than "escapes the repository".
 * A realpath that cannot be taken is treated as containment FAILING, not passing: the whole point
 * of this check is that an unresolvable path is not evidence of safety.
 */
/**
 * Is `child` inside `parent` (or the same path)? The one place this comparison is spelled.
 *
 * `child.startsWith(parent + path.sep)` is the obvious form and it breaks at a ROOT: path.resolve
 * already returns a trailing separator for `F:\` or `/`, so the composed prefix becomes `F:\` or
 * `//` and nothing starts with it. The Rule 2 sandbox guard used exactly that form, so an --add-dir
 * of a drive root — which contains the entire source tree — passed a check written to refuse
 * precisely that (G-37).
 *
 * `caseInsensitive` folds both spellings first (G-13 of 20261029-190658-rdr-delivery): on a filesystem that folds case,
 * two spellings of one folder were judged apart. The rule is the platform's, so io/finding-scope.mjs supplies it.
 */
export function isWithin(parent, child, { caseInsensitive = false } = {}) {
  const fold = (s) => (caseInsensitive ? s.toLowerCase() : s);
  const p = fold(absolute(parent, 'isWithin: parent'));
  const c = fold(absolute(child, 'isWithin: child'));
  if (p === c) return true;
  const base = p.endsWith(path.sep) ? p : p + path.sep;   // a root already ends with one
  return c.startsWith(base);
}

/**
 * The names from `parent` down to `child` when `child` lies strictly below it, by isWithin's rule; null otherwise (the
 * parent itself included). The one form of "a path below this one, as segments" (G-2 of
 * 20261105-154708-crsf-remediation-5-review): run-artifacts, run-graph and run-session each tested path.relative for a `..`
 * segment by hand, beside isWithin, so a platform correction had to be made at every copy.
 */
export function relativeBelow(parent, child, { caseInsensitive = false } = {}) {
  const p = absolute(parent, 'relativeBelow: parent');
  const c = absolute(child, 'relativeBelow: child');
  if (!isWithin(p, c, { caseInsensitive }) || p === c) return null;
  // Cut from the child's own spelling, past the parent's length: path.relative compares by case on POSIX, so on a
  // case-insensitive filesystem there it would walk up and down again. A fold that changes the length (outside ASCII) is
  // no prefix by length, and is asked of path.relative.
  const base = p.endsWith(path.sep) ? p : p + path.sep;
  const sameLength = !caseInsensitive || (p.toLowerCase().length === p.length && c.toLowerCase().length === c.length);
  const rel = sameLength ? c.slice(base.length) : path.relative(p, c);
  return rel ? rel.split(path.sep).filter(Boolean) : null;
}

// THE NATIVE REALPATH, where the platform has it (CI run 43281517496): the JS one keeps an 8.3 short name, so under a
// Windows runner's short TEMP a junction's target (stored short) and the run directory admitRun resolved (long) were two
// places, and a link from the intent node's floor onto the run's pre-flight logs was not refused.
const nativeRealpath = (io) => (io.fs.realpathSync?.native ? { ...io, fs: { ...io.fs, realpathSync: io.fs.realpathSync.native } } : io);

/**
 * THE ONE OWNER OF "DOES ANYTHING BELOW THIS DIRECTORY LEAD OUT OF IT" (link-leaving-owner.plan.md stage 1; design LL-D1 B,
 * LL-D3 A). Every walk that guards what leaves the machine or enters a sandbox asks it, rather than carrying its own copy of
 * part of the rule: the copies diverged, and each fix reached one walk and missed its siblings (G-12 of
 * 20261122-154951-m3s7-b3-remediation-4-review, G-7 of 20261122-164811-m3s7-b3-remediation-5-review).
 *
 * Returns the first descendant of `dir` that leads out, as `{ path, kind }` (`path` `/`-separated, relative to `dir`), or
 * null. What leads out, whatever `mode`:
 * - `hard-link`: a regular file with more than one name, by `hardLinkReason` (lib/egress-read.mjs), the one single-path rule:
 *   its content may be any file's, and a hard link has no target to judge;
 * - `unreadable`: an entry that cannot be listed or `lstat`ed. Unknown is not inside (LL-D3 A), so a boundary refuses it;
 * - `dangling`: a link whose target cannot be resolved, which therefore cannot be shown inside.
 * And a symbolic link or junction (`lstat` reports a junction as one on Windows, measured 2026-11-22), judged by where it
 * resolves and never descended, by `mode`:
 * - `{ leaving: true }` (the default): `link` when it resolves outside `dir`;
 * - `{ into }`: `into` when it resolves inside `into` but outside `dir`;
 * - `{ onto }`: `onto` when it resolves inside `onto`, or onto a directory containing it, outside `dir`.
 * `mode.skip(fullPath)`, when given, leaves out an entry the caller does not copy or read (a withheld folder), so what is
 * not used is not judged. `dir` itself must be readable: a root that cannot be resolved throws, as before.
 */
/** What each kind `firstLeadingOut` returns is, in the words a refusal uses: one wording for every caller. */
export const LEADS_OUT_KIND = Object.freeze({
  link: 'a link or junction leading out', into: 'a link into a forbidden directory', onto: 'a link onto a source root',
  'hard-link': 'a hard-linked file', dangling: 'a dangling link', unreadable: 'an entry that cannot be read',
});

export function firstLeadingOut(dir, mode, io) {
  requireIo(io, 'firstLeadingOut');
  io = nativeRealpath(io);
  const realDir = io.fs.realpathSync(dir);
  const m = mode ?? { leaving: true };
  let realInto = null;
  let realOnto = null;
  if (m.into != null) realInto = io.fs.realpathSync(m.into);
  if (m.onto != null) {
    try { realOnto = io.fs.realpathSync(m.onto); } catch { realOnto = absolute(m.onto, 'firstLeadingOut: onto'); }
  }
  const rel = (full) => path.relative(dir, full).split(path.sep).join('/');
  const linkKind = (target) => {
    if (isWithin(realDir, target)) return null;
    if (realInto) return isWithin(realInto, target) ? 'into' : null;
    if (realOnto) return (isWithin(realOnto, target) || isWithin(target, realOnto)) ? 'onto' : null;
    return 'link';
  };
  const visit = (d) => {
    let names;
    try {
      names = io.fs.readdirSync(d);
    } catch (e) {
      if (d === dir) throw e;   // the root itself: the caller's to report, as an unresolvable root is
      return { path: rel(d), kind: 'unreadable' };
    }
    for (const name of names) {
      const full = path.join(d, name);
      if (m.skip?.(full)) continue;
      let st;
      try { st = io.fs.lstatSync(full); } catch { return { path: rel(full), kind: 'unreadable' }; }
      if (st.isSymbolicLink()) {
        let target;
        try { target = io.fs.realpathSync(full); } catch { return { path: rel(full), kind: 'dangling' }; }
        const kind = linkKind(target);
        if (kind) return { path: rel(full), kind };
      } else if (st.isDirectory()) {
        const hit = visit(full);
        if (hit) return hit;
      } else if (hardLinkReason(st, full)) {
        return { path: rel(full), kind: 'hard-link' };
      }
    }
    return null;
  };
  return visit(dir);
}

/** The first descendant of `dir` that leads out of it, through `firstLeadingOut`; its path, or null. */
export function firstLinkLeaving(dir, io) {
  requireIo(io, 'firstLinkLeaving');
  return firstLeadingOut(dir, { leaving: true }, io)?.path ?? null;
}

/**
 * The first descendant of `dir` that leads into `into` (a link resolving there, outside `dir`), or out by any kind every
 * mode refuses (hard link, unreadable, dangling); its path, or null. A sandbox floor sits inside the run directory, so a
 * link in it onto evidence/pre-flight passed every guard that judged the floor by its own path (G-13 of
 * 20261025-095239-srf-remediation-2-review).
 */
export function firstLinkInto(dir, into, io) {
  requireIo(io, 'firstLinkInto');
  return firstLeadingOut(dir, { into }, io)?.path ?? null;
}

/**
 * The first descendant of `dir` that leads onto `onto` (a link resolving into it, or onto a directory containing it,
 * outside `dir`), or out by any kind every mode refuses; its path, or null. A source root is just as open through a link
 * onto the repository or a drive root above it (G-17 of 20261025-104155-srf-remediation-3-review).
 */
export function firstLinkOnto(dir, onto, io) {
  requireIo(io, 'firstLinkOnto');
  return firstLeadingOut(dir, { onto }, io)?.path ?? null;
}

export function escapesAfterRealpath(root, abs, io) {
  requireIo(io, 'escapesAfterRealpath');
  io = nativeRealpath(io);
  let realRoot;
  let realAbs;
  try {
    realRoot = io.fs.realpathSync(root);
    realAbs = io.fs.realpathSync(abs);
  } catch {
    return true;
  }
  // isWithin, like every caller (G-24, and then again because the fix stopped one level short).
  // The callers were routed through the owner and the OWNER kept the composed-prefix form — which
  // breaks at a filesystem root, where path.resolve already returns a trailing separator, so
  // `realRoot + path.sep` starts nothing. A containment check that fails open at `F:\` or `/` is
  // the one place this must not.
  return !isWithin(realRoot, realAbs);
}

/**
 * Why a lens finding's `evidence_path` is not this node's evidence, or null when it is: it must sit under
 * evidence/<nodeId>/ of `runDir` (absolute) and exist there, judged lexically AND through links. spawn-node checked it
 * with an inline `startsWith` on the lexical path only, so a link beneath evidence/<node>/ to a file outside the run
 * passed as the node's own evidence (G-19 of 20261025-104155-srf-remediation-3-review).
 */
/**
 * The files spawn-node writes directly in evidence/<node>/ (G-34 of 20261121-193516-m3s7-b1-review), every one of them:
 * denials.json is written before the findings are validated, and verdict.kept.json by their validation (G-5 of
 * 20261121-204740-m3s7-b1-remediation-review). tests/regression-evidence-reserved-names.test.mjs holds this list to
 * spawn-node's evidenceWrite calls.
 */
export const SPAWNER_EVIDENCE_FILES = Object.freeze(['stdout.json', 'stderr.log', 'payload.json', 'denials.json', 'verdict.kept.json']);
export function evidenceOwnershipError(runDir, nodeId, evidencePath, io) {
  requireIo(io, 'evidenceOwnershipError');
  if (!evidencePath) return 'no evidence_path';
  const root = absolute(runDir, 'evidenceOwnershipError: runDir');
  const evOwn = path.join(root, 'evidence', nodeId);
  const evAbs = resolveFrom(root, 'evidenceOwnershipError: runDir', evidencePath);
  if (evAbs === evOwn || !isWithin(evOwn, evAbs)) {
    return `evidence_path is outside evidence/${nodeId}/ — citing another node's evidence is how corroboration gets faked`;
  }
  // WHAT THE SPAWNER WRITES THERE IS NOT EVIDENCE (G-34 of 20261121-193516-m3s7-b1-review): the node's runtime transcript
  // and its validated payload sit directly in evidence/<node>/, fresh and plain, and capture.mjs produced none of them.
  // Compared case-blind, since a case-insensitive file system opens STDOUT.JSON as stdout.json.
  const rel = path.relative(evOwn, evAbs).split(path.sep);
  if (rel.length === 1 && SPAWNER_EVIDENCE_FILES.includes(rel[0].toLowerCase())) {
    return `evidence_path ${evidencePath} was written by the spawner, not captured: cite a log capture.mjs printed`;
  }
  // THROUGH THE RUN'S OWNER (run-dir-reads.plan.md stage 3, R-D3 A): it was judged by real path, which admitted a link
  // resolving back inside evidence/<node>/, and what a link resolves to can change. Each level below the run is walked,
  // and a link or junction at any of them is refused, whatever it leads to.
  try { confined({ root, io }).stat(path.relative(root, evAbs).split(path.sep)); } catch (e) {
    if (e?.code === 'ENOENT') return `evidence_path does not exist on disk: ${evidencePath}`;
    if (e?.code === 'ECONFINED' && e.refusal === 'link') {
      return `evidence_path is reached through a link or junction below evidence/${nodeId}/ — what it names is not this node's evidence`;
    }
    return `evidence_path cannot be read below the run: ${evidencePath}`;
  }
  return null;
}

/**
 * The same question for a path that does not exist YET — the one a writer is about to create.
 *
 * `escapesAfterRealpath` treats an unresolvable path as containment FAILING, which is right for a
 * path being READ and wrong for one being WRITTEN: a run directory legitimately does not exist
 * until it is made. So every caller creating a path guarded it with `fs.existsSync(...) && escapes`
 * — and skipped the check entirely in exactly the case that matters, a nonexistent directory
 * BENEATH an in-repository symlink or junction pointing out of the tree (G-32). `reviews_dir`
 * passed validation and `mkdirSync` then wrote every artifact of every run outside the repository.
 *
 * The nearest EXISTING ancestor is what the filesystem will resolve through, so it is what gets
 * checked. Walking up terminates at the root: `path.dirname` is its own fixed point there.
 */
export function escapesBeforeCreate(root, abs, io) {
  requireIo(io, 'escapesBeforeCreate');
  let at = absolute(abs, 'escapesBeforeCreate: path');
  for (;;) {
    if (io.fs.existsSync(at)) return escapesAfterRealpath(root, at, io);
    const up = path.dirname(at);
    // No existing ancestor at all — not even the root. Nothing to resolve through, and an
    // unresolvable path is not evidence of safety.
    if (up === at) return true;
    at = up;
  }
}

/**
 * A path and what it resolves to through links: its lexical form and its real one, a path not made yet resolved through
 * its nearest existing ancestor. null when an existing path's realpath cannot be taken.
 */
export function linkForms(p, io) {
  requireIo(io, 'linkForms');
  const lexical = absolute(p, 'linkForms: path');
  const real = io.fs.realpathSync.native ?? io.fs.realpathSync;
  const rest = [];
  for (let at = lexical; ;) {
    if (io.fs.existsSync(at)) {
      try { return [...new Set([lexical, path.join(real(at), ...rest)])]; } catch { return null; }
    }
    const up = path.dirname(at);
    if (up === at) return [lexical];
    rest.unshift(path.basename(at));
    at = up;
  }
}

/**
 * `p` AS THE FILESYSTEM SPELLS IT, LINKS NOT FOLLOWED: the one rule for respelling a root (CI run 43281517496, windows,
 * 396 failures). A Windows runner's TEMP is an 8.3 short path (C:\Users\RUNNER~1\...), so a home under it compared
 * unequal to every run directory realpath had made long (C:\Users\runneradmin\...), and one folder was refused as
 * outside itself. The native real path of the part above any link is taken, with the rest joined on as given, ONLY when
 * it is a respelling: the real path has the same root and as many levels (a mapped or subst drive resolved elsewhere is
 * not one). A link is never followed here; the link checks find and refuse it. On any error `p` comes back as given,
 * made absolute.
 */
export function canonicalSpelling(p, io) {
  requireIo(io, 'canonicalSpelling');
  const lexical = absolute(p, 'canonicalSpelling: path');
  const rest = [];
  let at = lexical;
  while (!io.fs.existsSync(at)) {
    const up = path.dirname(at);
    if (up === at) return lexical;
    rest.unshift(path.basename(at));
    at = up;
  }
  // THE PREFIX ABOVE THE HIGHEST LINK is respelled and everything from the link down is kept as given, so a link is still
  // there to be found and refused by the link checks, and a root and a path below it respell their common prefix alike:
  // keeping the whole path as given put a short-spelled path under a long-spelled root, and a link was refused as "not
  // below" its root instead of as a link.
  let prefix = at;
  for (let level = at; ;) {
    try { if (io.fs.lstatSync(level).isSymbolicLink()) prefix = path.dirname(level); } catch { return lexical; }
    const up = path.dirname(level);
    if (up === level) break;
    level = up;
  }
  let real;
  try { real = (io.fs.realpathSync.native ?? io.fs.realpathSync)(prefix); } catch { return lexical; }
  const levels = (s) => s.split(/[\\/]+/).filter(Boolean).length;
  if (path.parse(real).root.toLowerCase() !== path.parse(prefix).root.toLowerCase() || levels(real) !== levels(prefix)) return lexical;
  const below = path.relative(prefix, at).split(path.sep).filter(Boolean);
  return path.join(real, ...below, ...rest);
}

/**
 * A ROOT as the filesystem places it (ci-path-identity.plan.md, "The rule" and stage 1c): its deepest existing part on its
 * native real path, LINKS ABOVE IT FOLLOWED, the part not made yet joined on as given. canonicalSpelling keeps a link
 * where it stands, so the link checks below a path can find it, and that is right for a path BELOW a root. A root's own
 * links are where it lives: /var is a link to /private/var on macOS, and a home spelled through it was compared with run
 * directories resolved below it, so every run under the temporary folder was refused (PR #3's macOS job, CI runs
 * 44206754901 and 44220656481). STRICTLY ABOVE THE ROOT (operator, 2026-11-18: "Strictly above the root (Recommended)";
 * .claude/requests/ci-path-identity.rule-decision.md; G-2 and G-12 of 20261118-112631-cpi-review): the root's PARENT is
 * taken on its real path and the root's own name is kept, so a link AT the root (a home that is a junction) stays where
 * it stands for ARCHITECTURE.md A-30 to refuse, as G-4 of 20261102-220302-rbr-remediation-5-review restored. Only a real
 * path on the same root is taken (a mapped drive resolved to a share is not a respelling), and on any error the
 * canonicalSpelling is returned.
 */
export function rootSpelling(p, io) {
  requireIo(io, 'rootSpelling');
  return spellingOfCanonical(canonicalSpelling(p, io), io);
}

// rootSpelling's rule for a path that is already its own canonicalSpelling: its parent placed by ancestorSpelling, its own
// name kept. The ONE implementation (G-5 of 20261118-142344-cpi-remediation-2-review): belowRoot carried a copy of this
// join so it could share its memo, two spellings of one rule that could drift; it now passes the memo here.
function spellingOfCanonical(spelled, io, memo = null) {
  const parent = path.dirname(spelled);
  if (parent === spelled) return spelled;
  return path.join(ancestorSpelling(parent, io, memo), path.basename(spelled));
}

// The deepest existing part of `spelled` on its native real path, links in it followed, the part not made yet joined on.
// `memo` (belowRoot's, one check's worth) answers each existence and real-path question once across the ancestors asked.
function ancestorSpelling(spelled, io, memo = null) {
  const exists = (q) => {
    if (!memo) return io.fs.existsSync(q);
    if (!memo.exists.has(q)) memo.exists.set(q, io.fs.existsSync(q));
    return memo.exists.get(q);
  };
  const realOf = (q) => {
    const f = io.fs.realpathSync.native ?? io.fs.realpathSync;
    if (!memo) return f(q);
    if (!memo.real.has(q)) {
      try { memo.real.set(q, { ok: f(q) }); } catch (e) { memo.real.set(q, { err: e }); }
    }
    const got = memo.real.get(q);
    if (got.err) throw got.err;
    return got.ok;
  };
  // WITH A MEMO, EACH ANCESTOR IS PLACED ONCE (G-5 of 20261118-142344-cpi-remediation-2-review): belowRoot asks the parent
  // of every candidate, and each walk re-joined the same missing names above it, 1+...+d walks per check. A missing path is
  // its parent's placement with its own name joined on, so one memoised step per ancestor gives the loop's answer.
  // A LOOP, NOT A RECURSION (G-6 of 20261121-204740-m3s7-b1-remediation-review; I-14): each missing ancestor called this
  // function on its parent, so the stack grew with the path's depth and a deep missing path raised RangeError. The missing
  // names are climbed to the first ancestor already placed, existing, or the file system's root, then joined back down,
  // each placement memoised as before.
  if (memo) {
    if (!memo.placed) memo.placed = new Map();
    const missing = [];
    let at = spelled;
    let out;
    for (;;) {
      if (memo.placed.has(at)) { out = memo.placed.get(at); break; }
      if (!exists(at)) {
        const up = path.dirname(at);
        if (up === at) { out = at; memo.placed.set(at, out); break; }
        missing.push(at);
        at = up;
        continue;
      }
      let real = null;
      try { real = realOf(at); } catch { real = null; }
      out = real === null || (isShare(real) && !isShare(at)) ? at : real;
      memo.placed.set(at, out);
      break;
    }
    for (let i = missing.length - 1; i >= 0; i--) {
      out = path.join(out, path.basename(missing[i]));
      memo.placed.set(missing[i], out);
    }
    return out;
  }
  const rest = [];
  let at = spelled;
  while (!exists(at)) {
    const up = path.dirname(at);
    if (up === at) return spelled;
    rest.unshift(path.basename(at));
    at = up;
  }
  let real;
  try { real = realOf(at); } catch { return spelled; }
  // ONLY A SHARE IS NOT A RESPELLING (G-7 of 20261118-112631-cpi-review): a mapped drive resolves to \\server\share, which
  // is kept as given; a junction to another volume (C:\Users\x -> F:\x) is where the root lives, and admitRun takes the
  // run on that volume, so keeping the given drive refused every staged run.
  if (isShare(real) && !isShare(at)) return spelled;
  return path.join(real, ...rest);
}

const isShare = (p) => /^[\\/]{2}(?![?.][\\/])/.test(String(p)) || /^[\\/]{2}\?[\\/]UNC[\\/]/i.test(String(p));

/**
 * WHERE A PATH SITS BELOW A ROOT, the root's own links followed and nothing below it (ci-path-identity.plan.md stage 1c):
 * `{ root, segs }`, the root on its rootSpelling and the names below it AS GIVEN, or null when `p` is not below `root`.
 * The first ancestor of `p`, from the top down, whose rootSpelling is the root's is where the root is; a link below the
 * root that leads back to it is a longer ancestor, so it is never taken for the root, and it stays in `segs` for the A-30
 * checks to find. A path given through /var is below a home resolved to /private/var, and the reverse, which a lexical
 * isWithin could not see once the roots were resolved where they are read.
 */
export function belowRoot(root, p, io) {
  requireIo(io, 'belowRoot');
  const fold = (s) => (io.caseInsensitiveFs ? String(s).toLowerCase() : String(s));
  const resolvedRoot = rootSpelling(root, io);
  const target = fold(resolvedRoot);
  const spelled = canonicalSpelling(p, io);
  const parts = [];
  for (let at = spelled; ; ) {
    parts.unshift(at);
    const up = path.dirname(at);
    if (up === at) break;
    at = up;
  }
  // ONLY AN ANCESTOR CARRYING THE ROOT'S OWN NAME CAN BE IT (G-8 of 20261118-112631-cpi-review): rootSpelling keeps a
  // root's last name, so every other ancestor is skipped without a filesystem call. Each call re-walked its ancestors,
  // O(d²) synchronous metadata calls per check with no early exit on a miss, paid once per run by telemetry.
  const name = fold(path.basename(resolvedRoot));
  // AND EACH ANCESTOR THAT DOES CARRY IT IS RESOLVED FROM ONE SHARED WALK (G-6 of 20261118-131040-cpi-remediation-review):
  // a path whose ancestors repeat the root's name still ran rootSpelling's own walks per ancestor, Θ(d²) filesystem calls.
  // `at` is an ancestor of a canonicalSpelling, so it is its own canonicalSpelling and rootSpelling's first step is
  // skipped; its parent is placed by ancestorSpelling with one memo, each existence and real path asked once.
  const memo = { exists: new Map(), real: new Map() };
  // rootSpelling's own step (spellingOfCanonical), given the memo (G-5 of 20261118-142344-cpi-remediation-2-review).
  const spellingOf = (at) => spellingOfCanonical(at, io, memo);
  for (const at of parts) {
    if (fold(path.basename(at)) !== name && path.dirname(at) !== at) continue;
    if (fold(spellingOf(at)) === target) {
      return { root: resolvedRoot, segs: path.relative(at, spelled).split(path.sep).filter(Boolean) };
    }
  }
  return null;
}

/**
 * WHETHER `p` IS BELOW `root`, lexically or through the root's own links (belowRoot): the one predicate every caller asks
 * (G-9 of 20261118-112631-cpi-review). It was composed per site as isWithin(...) || belowRoot(...), each choosing for
 * itself whether the lexical test was also consulted, by the platform's case rule or not.
 */
export function isBelowRoot(root, p, io) {
  requireIo(io, 'isBelowRoot');
  return isWithin(root, p, { caseInsensitive: io.caseInsensitiveFs }) || belowRoot(root, p, io) !== null;
}

/**
 * Whether some form of `parent` contains some form of `child` (or is it), through links: the containment a sandbox guard
 * refuses on. A form that cannot be resolved counts as contained, failing closed like escapesAfterRealpath; spawn-node
 * kept a copy of this that fell back to the lexical path instead (G-12 of 20261025-095239-srf-remediation-2-review).
 */
export function withinThroughLinks(parent, child, io) {
  requireIo(io, 'withinThroughLinks');
  const ps = linkForms(parent, io);
  const cs = linkForms(child, io);
  if (!ps || !cs) return true;
  return ps.some((a) => cs.some((b) => isWithin(a, b)));
}

export function findingScopeErrors(f, { repoRoot, io }) {   // generatedGlobs was accepted and never read (inventory M); removed
  requireIo(io, 'findingScopeErrors');
  const why = [];
  const root = absolute(repoRoot, 'findingScopeErrors: repoRoot');
  const fileAbs = resolveFrom(root, 'findingScopeErrors: repoRoot', f?.file ?? '');

  if (!f?.file) {
    why.push('no file');
  // isWithin, not the composed prefix (G-24). The form spelled inline here is the one isWithin was
  // added twenty lines above to REPLACE, and its docstring names this file as "the one place this
  // comparison is spelled" — while three callers still spelled it themselves. It breaks at a
  // filesystem root: path.resolve('F:\') already ends in a separator, so the doubled form starts
  // nothing, and an --add-dir of a drive root passed a check written to refuse exactly that (G-37).
  } else if (!isWithin(root, fileAbs)) {
    why.push(`file resolves outside the repository under review: ${f.file}`);
  } else if (!io.fs.existsSync(fileAbs)) {
    why.push(`file does not exist: ${f.file}`);
  } else if (escapesAfterRealpath(root, fileAbs, io)) {
    why.push(`file resolves outside the repository through a link: ${f.file}`);
  } else {
    const n = countLines(fileAbs, io);
    if (n !== null && Number(f.line) > n) why.push(`line ${f.line} exceeds ${f.file} (${n} lines)`);
  }

  return why;
}

/**
 * Is this finding OUT OF SCOPE rather than INVALID? Returns the reason, or null.
 *
 * The distinction is the whole point. §8.5 rule 5 says out-of-scope findings are "reported, never
 * counted — they go in `out_of_scope_observations[]`, which the gate prints and does not tally".
 * The generated-glob case used to be pushed into the REJECTION list, whose message read "report it
 * in out_of_scope_observations, not findings" — the validator naming the correct destination and
 * then not delivering it there. Rejected findings are dropped, so the observation the doctrine
 * promised to print never existed (G-52).
 *
 * Kept separate from findingScopeErrors because those are DEFECTS IN THE FINDING — a path escaping
 * the repository, a file that does not exist, a line past the end. Those must stay hard rejections:
 * containment is load-bearing (remediate reads reconciled.md with bypassPermissions, so
 * `../../.ssh/config` is a route out of the repo), and a citation that does not resolve is not an
 * observation, it is a mistake.
 */
export function findingOutOfScope(f, { generatedGlobs = [], declaredGlobs = null } = {}) {
  const relFile = String(f?.file ?? '').split(path.sep).join('/');
  if (!f?.file) return null;

  // §6 IS NOT DEMOTABLE. "Any lens may raise these regardless of scope... These are the only
  // findings that may be raised entirely outside a lens's declared scope." §8.5 and §6 compose
  // rather than conflict, and this clause is the seam: everything else is demotable, an invariant
  // never is.
  //
  // Shipped without it for half a day, which made the most dangerous case the most likely one: a
  // `credential_exposure` BLOCKER filed against `.claude/reviews/**` — a committed run artifact,
  // which is exactly what G-40 turned out to be — was demoted to a printed note.
  if (f?.basis === 'invariant') return null;

  // ON A PATH BOUNDARY, not on characters. `startsWith('.claude/reviews')` also matches
  // `.claude/reviews-old/source.mjs`, so a real finding in a neighbouring directory was demoted as
  // generated and never counted (G-18) — a silent downgrade, which is the worst direction for this
  // particular mechanism to fail in.
  // Through the one owner of the grammar (contract-glob-grammar stage 3): this was a prefix test of its own, with no
  // `**/` form, so a generated `**/*.min.js` demoted nothing while lib/excerpt refused the same file as generated.
  const hit = matchesAnyGlob(generatedGlobs, relFile);
  if (hit) return `file is under a generated glob (${generatedGlobs.join(', ')}) — reported, not counted (§8.5)`;

  // Outside every declared surface. Measured across 13 archived runs before being built: 7 of 677
  // groups (1.0%), all LOW or MEDIUM, none ever HIGH or BLOCKER — five against a bench result
  // artifact and two against the contract template, which is the recurring-noise case §8.5 exists
  // for. Not built on that measurement alone: the mechanism still permits hiding a BLOCKER, and the
  // §6 clause above is what forecloses it.
  //
  // `null` means the caller could not say what is declared, and then NOTHING is demoted. Failing
  // open here would let a contract that failed to load quietly stop gating the whole repository.
  if (declaredGlobs && declaredGlobs.length && !matchesAnyGlob(declaredGlobs, relFile)) {
    return `file matches no declared glob — reported, not counted (§8.5)`;
  }
  return null;
}

// coveredByGlobs lived here: a prefix match with a `**/*.ext` special case, "deliberately not a general glob engine".
// It read the template's own `**/*.test.*` as "ends with `.test.*`" and matched nothing, and `docs/**/README.md` as all
// of `docs/`. Deleted for lib/contract-glob.mjs's exact matchesAnyGlob (contract-glob-grammar stage 3, design 2A).

/**
 * Tracked files the contract declares nothing about.
 *
 * The demotion rule above makes gate strictness a function of contract HYGIENE: a file matching no
 * glob is invisible to scope derivation AND undemotable-from, so a missing glob silently weakens
 * the gate with no signal, in the unsafe direction. Nothing checked for that — `check-install`
 * compares contract KEYS against the template and never asks whether the globs cover the tree. This
 * is what makes the demotion rule safe to enable rather than a trap.
 *
 * REPORTED, NOT BLOCKING. 38 of this repository's own 858 tracked files matched no glob when this
 * was written (.gitignore, .github/workflows/checks.yml, CLAUDE.template.md, every bench/corpus
 * manifest). A check that fires 38 times on a project's first run is the ceiling-that-fires-on-a-
 * non-problem this framework already warns about: people learn to ignore it. So it names the count
 * and the files, and the run carries a stamp — the same treatment every other declared gap gets.
 */
export function uncoveredFiles(trackedFiles, contract = {}) {
  const declared = [
    ...(contract.source_globs ?? []),
    ...(contract.test_globs ?? []),
    ...(contract.doc_paths ?? []),
    ...(contract.generated_globs ?? []),
  ];
  if (!declared.length) return [];   // nothing declared: cannot distinguish covered from not
  return (trackedFiles ?? []).filter((f) => f && !matchesAnyGlob(declared, f));
}

/**
 * The contract's coverage from one `git ls-files -z` result ({ status, error, stdout }): { uncovered, unknown }.
 * A listing that did not complete — a non-zero status, a spawn error such as a buffer overflow — leaves coverage
 * UNKNOWN with the reason, never covered (G-23 of 20261021-162807-ciss-d1-review): `if (!r.out) return []` read a
 * failed git as a tree with nothing uncovered, which suppressed CONTRACT-PARTIAL in the unsafe direction.
 */
export function contractCoverage(listing, contract = {}) {
  if (listing?.error || listing?.status !== 0) {
    const why = listing?.error ? String(listing.error.message ?? listing.error) : `git ls-files exited ${listing?.status}`;
    return { uncovered: [], unknown: why };
  }
  return { uncovered: uncoveredFiles(String(listing.stdout ?? '').split('\0').filter(Boolean), contract), unknown: null };
}

/**
 * WHAT KIND OF FILE A PATH IS — the one owner (remediation-paths.design.md decision 3, operator 2026-10-08: "One owner
 * (Recommended)"). Three callers answered this three ways and the delivery review of the remediate rebuild found the
 * drift (G-16, G-2 of 20261008-225754-remediate-rebuild-r4). Precedence, highest first:
 *   generated — a file matching `generated_globs` is never source or test (the decision this design made; before it,
 *               the rule existed only in new-run's code);
 *   test      — `test_globs` wins over `source_globs`, as the contract states beside `test_globs`;
 *   source, doc, undeclared.
 * The parts are exported too, because one caller asks a different question on purpose: new-run's review scope is
 * `matchesSourceGlobs && !isGeneratedPath` — a file matching both source and test globs stays in scope.
 */
export const isGeneratedPath = (p, contract = {}) => matchesAnyGlob(contract.generated_globs ?? [], p);
export const isTestPath = (p, contract = {}) => matchesAnyGlob(contract.test_globs ?? [], p);
export const matchesSourceGlobs = (p, contract = {}) => matchesAnyGlob(contract.source_globs ?? [], p);
export function classifyPath(p, contract = {}, { caseInsensitive } = {}) {
  // The case flag is REQUIRED, as for pathKey (candidate-check-boundaries.plan.md I-2; G-3 of 20261014-022857-ccb-delivery):
  // a default of exact let a forgotten flag turn exact on a case-insensitive repository. `false` is the glob doctrine's
  // exact matching; `true` folds both the globs and the path.
  if (typeof caseInsensitive !== 'boolean') throw new Error('classifyPath: caseInsensitive (the repository\'s case rule) is required');
  if (caseInsensitive) {
    const f = (g) => String(g).toLowerCase();
    const folded = {
      ...contract,
      generated_globs: (contract.generated_globs ?? []).map(f), test_globs: (contract.test_globs ?? []).map(f),
      source_globs: (contract.source_globs ?? []).map(f), doc_paths: (contract.doc_paths ?? []).map(f),
    };
    return classifyPath(String(p).toLowerCase(), folded, { caseInsensitive: false });
  }
  if (isGeneratedPath(p, contract)) return 'generated';
  if (isTestPath(p, contract)) return 'test';
  if (matchesSourceGlobs(p, contract)) return 'source';
  if (matchesAnyGlob(contract.doc_paths ?? [], p)) return 'doc';
  return 'undeclared';
}

/**
 * The surfaces a contract DECLARES it is responsible for — the union both writers demote against.
 *
 * One owner, because the alternative is spawn-node and run-graph each assembling the list and
 * disagreeing about whether test_globs counts. That is not hypothetical: the finding that started
 * this said "outside source_globs and doc_paths", omitting test_globs, and applying it literally
 * would have demoted every finding about test code to an unenforced note — silencing exactly the
 * review that catches a test asserting nothing.
 *
 * generated_globs is deliberately ABSENT: those are handled by their own branch, with their own
 * message, because "this file is generated" and "nobody declared this file" are different facts.
 */
export function declaredSurface(contract = {}) {
  return [
    ...(contract?.source_globs ?? []),
    ...(contract?.test_globs ?? []),
    ...(contract?.doc_paths ?? []),
  ];
}

/**
 * May this entry go into the intent-capture document snapshot? Judged on where it RESOLVES.
 *
 * When a declared doc dir overlaps a source root, run-graph snapshots the documents rather than
 * live-mounting the directory, so the intent node reads what was declared and not the
 * implementation it is supposed to precede (Rule 2). The walk copies `*.md` with `copyFileSync`,
 * which FOLLOWS symlinks — and `readdirSync(..., { withFileTypes: true })` reports a link's own
 * type, so a link is never a directory and reaches the copy branch on its name alone.
 *
 * THE RULE IS "RESOLVES TO WHERE IT CLAIMS TO BE", and getting there took two wrong answers.
 *
 * The first guard checked repository containment, and the walk's own comment named the threat as a
 * link pointing "at the source this sandbox exists to hide" — which containment does not catch,
 * because `docs/x.md -> scripts/foo.mjs` resolves inside the repository (G-16, security-audit).
 *
 * The second refused anything resolving under `source_globs`, and RUNNING IT showed why that is
 * worse: this repository declares `shared/**` in BOTH source_globs and doc_paths, and that overlap
 * is the very condition that triggers snapshotting. It skipped every doctrine document
 * intent-capture exists to read. A guard that empties the thing it protects is not a guard.
 *
 * So: an entry must resolve INSIDE the doc directory being walked. A real file does. A link to
 * source, to the reviews tree, to generated output or out of the repository does not — one rule,
 * expressed where the distinction actually lives, and no glob classification needed.
 *
 * Every refusal NAMES ITSELF: I-9 calls a guard that refuses an input without recording it a
 * failure mode, and a declared document silently missing from the snapshot is exactly that. The
 * caller records; this decides.
 *
 * Extracted because symlinks cannot be created by an unprivileged user on every machine this suite
 * runs on. A predicate over a resolved path is testable everywhere; the filesystem feature is not.
 */
export function snapshotAdmits({ docRoot, resolved, repoRoot = null, kind = 'document' } = {}) {
  if (!resolved) return { ok: false, why: 'the entry has no resolvable path — a broken or circular link' };
  if (repoRoot && !isWithin(repoRoot, resolved)) {
    return { ok: false, why: `resolves outside the repository (${resolved})` };
  }
  if (!isWithin(docRoot, resolved)) {
    return {
      ok: false,
      why: `resolves to ${resolved}, which is outside the declared doc directory being snapshotted `
        + `(${docRoot}) — a document must resolve to where it claims to be, or a link can pull `
        + 'source, generated output or anything else into the intent sandbox',
    };
  }
  // AND IT MUST RESOLVE TO A DOCUMENT (G-14, panel-codex-security). The walk gates the copy on the
  // ENTRY'S NAME ending `.md`; the TARGET was never checked. So
  // `shared/leak.md -> shared/private-source.mjs` stays inside docRoot and was admitted — and it is
  // admitted precisely BECAUSE that doc dir is also a source root, which is the only condition
  // under which this code path runs at all.
  //
  // Three rules aimed at the neighbourhood failed here in a row: inside the repository, not under
  // source_globs, inside the doc directory. The overlap that makes the snapshot necessary defeats
  // every one of them. This asks about the FILE instead, which the overlap cannot touch.
  //
  // FOR A DOCUMENT ONLY (G-9, HIGH — a regression this rule introduced). The walk called this on
  // every entry before looking at whether it was a directory, and a directory never ends `.md`, so
  // every subdirectory of an overlapping doc root was refused and nested doctrine never reached the
  // intent node. A directory is a container to traverse; containment above is the whole question
  // for it. Every live check of the G-14 fix counted zero skips — on a `shared/` that has no
  // subdirectories, a tree that could not express the failure.
  if (kind !== 'directory' && !isDocumentName(resolved)) {
    return {
      ok: false,
      why: `resolves to ${resolved}, which is not a document — the walk admits an entry on its own `
        + 'name ending `.md`, and a link can carry that name while pointing at source',
    };
  }
  return { ok: true };
}

/**
 * THE one rule for what the snapshot treats as a document, applied to an entry's name and to its
 * resolved target alike. The walk carried a second, case-sensitive copy (`endsWith('.md')`) beside
 * this module's `/\.md$/i`, so `NOTES.MD` passed the predicate and was passed over before the
 * predicate saw it (G-10, arch-review). Two owners of one rule disagree eventually; these already did.
 */
export function isDocumentName(name) {
  return /\.md$/i.test(name);
}

/**
 * The flat filename a repository-relative document gets inside the intent snapshot — INJECTIVE.
 *
 * It flattened every separator to `__` and nothing else, so `docs/a/b.md` and `docs/a__b.md`
 * became one file and copyFileSync let the second silently replace the first (G-12,
 * panel-codex-code and panel-codex-security). A literal `%` or `_` in the path is now
 * percent-encoded before the separators are flattened, so `__` can only ever mean a separator and
 * two paths can never share a name. A name with neither character — every doctrine file here — is
 * unchanged, which keeps the `/` -> `__` description in the briefs true.
 */
export function snapshotName(rel) {
  return rel.replace(/%/g, '%25').replace(/_/g, '%5F').replace(/[\\/]/g, '__');
}


/**
 * The key a snapshot name is recorded under: the name AS THE DESTINATION FILESYSTEM COMPARES IT.
 *
 * snapCopy recorded a replaced document by comparing names case-sensitively, while win32's and
 * darwin's default filesystems are not — `Guide.md` and `guide.md` land on one file there, and the
 * replacement went unrecorded (G-8, panel-codex-code and panel-codex-security). Folding
 * unconditionally would be the opposite error on a case-sensitive filesystem, where both files
 * survive and a "replaced" record would be false. So the caller, which owns the platform, says which.
 */
export function snapshotNameKey(name, { caseInsensitive }) {
  return caseInsensitive ? name.toLowerCase() : name;
}

/**
 * ONE KEY FOR A REPOSITORY PATH on the remediation path (candidate-check-boundaries.plan.md stage 1; operator,
 * 2026-10-14: D3 "Ask the platform (Recommended)", amended the same day to "Git's core.ignorecase (Recommended)"):
 * forward slashes, folded exactly when the caller's flag says — on the remediation path, the repository's
 * core.ignorecase (gitIgnoresCase, lib/remediation-chain.mjs). The flag is REQUIRED: a caller that forgets it must
 * fail, not turn exact on Windows.
 */
export function pathKey(p, { caseInsensitive } = {}) {
  if (typeof caseInsensitive !== 'boolean') throw new Error('pathKey: caseInsensitive (the repository\'s core.ignorecase) is required');
  return snapshotNameKey(String(p).split('\\').join('/'), { caseInsensitive });
}

/**
 * May a doc_paths entry that is a single FILE be snapshotted? Only if it resolves to exactly the
 * path it was declared at — no link anywhere between the repository root and the file.
 *
 * This branch had only a leaves-the-repository check, so an in-repository link
 * `docs/requirements.md -> scripts/secret.mjs` put implementation bytes into the intent sandbox
 * (G-10, panel-codex-security; recorded five times since 2026-09-02). The walk's rule is not reused:
 * it requires a `.md` target, and a single declared file is whatever the contract names —
 * `docs/spec.txt` is a legitimate declaration. The declaration is the authority here, so the test is
 * that the bytes copied are the bytes declared. A link to another document is refused too: declare
 * its target instead, which costs nothing and leaves no question about what the node read.
 *
 * `realRepoRoot` must be the REALPATH of the root, as `resolved` is — compare like with like (G-17).
 * Pure: the caller resolves.
 */
export function declaredFileAdmits({ realRepoRoot, rel, resolved, caseInsensitive = false }) {
  if (!resolved) return { ok: false, why: 'the declared document has no resolvable path — a broken or circular link' };
  const expected = path.join(realRepoRoot, rel);
  const same = caseInsensitive ? expected.toLowerCase() === resolved.toLowerCase() : expected === resolved;
  if (!same) {
    return {
      ok: false,
      why: `is declared at ${expected} but resolves to ${resolved} — a declared document that is a link `
        + 'is not followed, because the bytes copied would not be the ones declared; declare the target instead',
    };
  }
  return { ok: true };
}

/**
 * What the overlapping-doc-dir snapshot walk does with ONE directory entry: `skip` it (neither a
 * container nor a document), `walk` into it, `copy` it, or `refuse` it with a reportable reason —
 * or, asked before anything was resolved, `resolve` it and ask again.
 *
 * PURE, and the second attempt at that (G-4 of post-med4, raised by two Claude lenses and two codex
 * arms). It was moved here from run-graph so it could be tested, and it brought its realpathSync and
 * statSync with it — into the layer ARCHITECTURE §2 defines as "No I/O ... Inputs arrive as
 * parameters". The caller now resolves and passes the answers in.
 *
 * Two calls, because resolving costs a realpath and a stat and most entries do not need one: a plain
 * non-document FILE is passed over on its own type. The first call, with `resolved` undefined,
 * answers `skip` or `resolve`; the second, with the target, answers the rest. One owner either way —
 * a pre-filter in the walk would be a second copy of the rule, which is how G-10 of post-g9 began.
 *
 *   isFile, isDirectory — the entry's OWN type (a Dirent reports a link as neither)
 *   resolved            — its realpath, or null when that could not be taken
 *   targetIsDir         — whether `resolved` is a directory
 */
export function classifySnapshotEntry({ name, isFile, isDirectory, resolved, targetIsDir, docRoot, repoRoot }) {
  // A plain non-document file is neither walked nor copied, and routing it through the guard logged
  // it as a refused document (G-9).
  if (isFile && !isDocumentName(name)) return { action: 'skip' };
  if (resolved === undefined) return { action: 'resolve' };
  // CLASSIFIED BY THE TARGET, NOT BY THE DIRENT (G-11 of post-g9). A link to a directory was never a
  // directory: named `alias.md` it was judged a document and handed to copyFileSync, which throws on
  // a directory and aborted the orchestrator; named anything else it was dropped with no record.
  const dir = resolved ? Boolean(targetIsDir) : Boolean(isDirectory);
  // A LINKED directory is recorded and not followed. Following one can cycle back into the tree
  // being walked, and nothing is lost by declining: a target inside the doc root is walked at its
  // real location anyway, and one outside it is exactly what containment exists to refuse.
  if (dir && !isDirectory) {
    return {
      action: 'refuse',
      why: `is a link to a directory (${resolved}) — not followed: a target inside the doc directory is `
        + 'snapshotted at its real location, and one outside it is not declared documentation',
    };
  }
  if (!dir && !isDocumentName(name)) return { action: 'skip' };
  const admits = snapshotAdmits({ docRoot, resolved, repoRoot, kind: dir ? 'directory' : 'document' });
  if (!admits.ok) return { action: 'refuse', why: admits.why };
  return { action: dir ? 'walk' : 'copy' };
}

// mirrorLinkAdmits was here: the mirror's link rule. The mirror is gone (arms-read-surface), and the
// snapshot's rule is lib/snapshot-surface.mjs.

/**
 * May the request document be copied into the intent sandbox? It must be the file it is declared as
 * (declaredFileAdmits — no link out of place), and, when mint froze its SHA-256, still hold those
 * bytes (G-23 of 20260925-015614-platform-review). A pre-flight command runs between mint and intent;
 * without this, a request changed or swapped for a link in that window became the source of the run's
 * criteria. An inferred request drafted during the run has no frozen hash, and is judged on place.
 */
export function requestSnapshotAdmits({ realRepoRoot, rel, resolved, frozenSha = null, actualSha = null, caseInsensitive = false }) {
  const placed = declaredFileAdmits({ realRepoRoot, rel, resolved, caseInsensitive });
  if (!placed.ok) return placed;
  if (frozenSha && actualSha !== frozenSha) {
    return {
      ok: false,
      why: `the request changed since the run was minted (sha256 ${String(actualSha).slice(0, 12)}… where mint froze `
        + `${String(frozenSha).slice(0, 12)}…) — intent is not derived from a document nobody approved`,
    };
  }
  return { ok: true };
}
