/**
 * THE ONE OWNER OF A CITED EVIDENCE PATH (evidence-path-owner.plan.md stage 1; design EP-D1 A, EP-D2 C, operator
 * 2026-11-04: "EP-D1 A"; "why not compute before and provide it for each reader?"). A path a node or a question cites is
 * turned into its normal form ONCE, where it enters (the runner's read of a node's report, decide.mjs's read of a question
 * and of a seat's answer), and every reader is given that form, never the spelling. Four rounds of the
 * grounding-and-retry-evidence chain each found one more reader that spelled or compared a path its own way: absolute and
 * `..` entries, the staged reviews root, case by the host's separator, and `\` against `/`.
 *
 * Pure: no I/O, no environment (ARCHITECTURE §2). The roots come in as arguments, absolute, and the letter-case rule as the
 * caller's platform states it (`caseInsensitiveFs`). Both `/` and `\` are separators on every host, because a node or an
 * operator on one platform can write either. A link check needs the file system, so it stays with the confined owner
 * (lib/confined-path.mjs), which the intake calls with this module's result.
 */
import { ARCHIVED_REVIEWS } from './reviews-root.mjs';

const SEP = /[\\/]+/;

/** The letter-case rule: folded only when the platform's file system is case-insensitive. */
export function foldIf(caseInsensitive) {
  return caseInsensitive ? (s) => String(s).toLowerCase() : (s) => String(s);
}

/** Whether a spelling is absolute on any platform: a leading separator, or a drive letter and a separator. */
function isAbsoluteSpelling(p) {
  return /^[\\/]/.test(p) || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * An absolute spelling's segments, with a drive letter (as spelled; the case rule folds it) or '' for a POSIX root as the
 * first, so two spellings of one place compare segment by segment.
 */
function absoluteSegments(p) {
  let s = String(p);
  // AN EXTENDED-LENGTH OR DEVICE SPELLING (G-5 of 20261104-082659-epo-remediation-2-review): `\\?\C:\x` and `\\.\C:\x` are
  // C:\x, and `\\?\UNC\server\share\x` is \\server\share\x; read as a UNC server named '?', they matched no root.
  const ext = /^[\\/]{2}[?.][\\/]/.exec(s);
  if (ext) {
    const r = s.slice(ext[0].length);
    s = /^UNC[\\/]/i.test(r) ? `//${r.slice(4)}` : r;
  }
  const drive = /^([A-Za-z]):[\\/]/.exec(s);
  // A UNC ROOT (G-6 of 20261104-072059-epo-remediation-review): two leading separators and a server, with its share,
  // are one first segment, '//server/share', so the share is never read back as the POSIX path /server/share.
  const unc = drive ? null : /^[\\/]{2}([^\\/]+)(?:[\\/]+([^\\/]+))?/.exec(s);
  if (unc) return [`//${unc[1]}${unc[2] ? `/${unc[2]}` : ''}`, ...s.slice(unc[0].length).split(SEP).filter((x) => x && x !== '.')];
  const rest = drive ? s.slice(2) : s;
  // The drive letter keeps its spelling (G-5 of 20261104-082659-epo-remediation-2-review): the caller's case rule folds
  // it with every other segment, so `f:` and `F:` differ when the caller says case matters.
  return [drive ? `${drive[1]}:` : '', ...rest.split(SEP).filter((x) => x && x !== '.')];
}

const joinAbsolute = (segs) => (segs[0] ? `${segs[0]}/${segs.slice(1).join('/')}` : `/${segs.slice(1).join('/')}`);

/** The segments of `inner` below `outer` (both absoluteSegments), or null when it is not below it, by the case rule. */
function below(outer, inner, fold) {
  if (inner.length <= outer.length) return null;
  for (let i = 0; i < outer.length; i += 1) if (fold(outer[i]) !== fold(inner[i])) return null;
  return inner.slice(outer.length);
}

/**
 * THE CASE RULE IS THE CALLER'S, ALWAYS (G-6 of 20261104-060910-epo-delivery): a default here gave an omitted argument a
 * case-sensitive comparison on a case-insensitive file system, silently. Refused as remediation-chain's caseFlag refuses.
 */
function caseRule(who, caseInsensitive) {
  if (typeof caseInsensitive !== 'boolean') throw new Error(`${who}: caseInsensitive (the platform's letter-case rule) is required`);
  return caseInsensitive;
}

/**
 * A REMEDIATION CAPTURE PATH, relative to the run directory: `evidence/remediation/<name>`, with `/` separators. `runDir`
 * is the run directory, absolute; an absolute citation is taken relative to it, or relative to one of `formerRunDirs`,
 * the absolute directories the caller names as where this same run has lived (staged, archived). Returns
 * { path, segs, key } (`key` folded by the case rule, for a comparison across spellings), or { refused } naming why.
 */
export function runEvidencePath(p, { runDir, caseInsensitive, formerRunDirs = [] } = {}) {
  const fold = foldIf(caseRule('runEvidencePath', caseInsensitive));
  if (typeof p !== 'string' || !p.trim()) return { refused: 'an empty capture path' };
  const s = p.trim();
  let rel;
  if (isAbsoluteSpelling(s)) {
    if (typeof runDir !== 'string' || !isAbsoluteSpelling(runDir)) return { refused: `${JSON.stringify(s)} is absolute and no run directory was given to place it` };
    const segs = absoluteSegments(s);
    rel = below(absoluteSegments(runDir), segs, fold);
    // A RUN THAT MOVED: a node writes its absolute paths where the run was staged, and the run is archived into the
    // repository before a retry reads its report again. So an absolute path is also taken below a directory the CALLER
    // names as where this run lived; only the part below it is kept, and the capture is read from the run as it is now.
    // A directory that merely carries the run's id is not one (G-7 of 20261104-060910-epo-delivery: any tree with a
    // `<run-id>/evidence` segment was accepted, so a citation into another tree was read as this run's capture).
    for (const d of Array.isArray(formerRunDirs) ? formerRunDirs : []) {
      if (rel) break;
      if (typeof d === 'string' && isAbsoluteSpelling(d)) rel = below(absoluteSegments(d), segs, fold);
    }
    if (!rel) return { refused: `${JSON.stringify(s)} is not below the run directory` };
  } else {
    rel = s.split(SEP).filter((x) => x && x !== '.');
  }
  if (rel.includes('..')) return { refused: `${JSON.stringify(s)} steps up with '..'` };
  // NO CAPTURE NAMED (G-8 of 20261104-060910-epo-delivery): the folder itself is its own refusal, not a generic one.
  if (rel.length === 2 && fold(rel[0]) === 'evidence' && fold(rel[1]) === 'remediation') {
    return { refused: `${JSON.stringify(s)} names no capture: it is the evidence/remediation/ folder itself` };
  }
  if (rel.length < 3 || fold(rel[0]) !== 'evidence' || fold(rel[1]) !== 'remediation') {
    return { refused: `${JSON.stringify(s)} is not a capture below evidence/remediation/` };
  }
  const segs = ['evidence', 'remediation', ...rel.slice(2)];
  const out = segs.join('/');
  return { path: out, segs, key: fold(out) };
}

/**
 * THE REVIEWS ROOTS a panel evidence path may lie below (moved from lib/decision-panel.mjs, where it was reviewsDirsAbs):
 * a declared `reviewsDir` is the one place; undeclared, a run lives under ARCHIVED_REVIEWS once archived and under the
 * engine's staging root while it runs (`stagingRoot`, the caller's; G-6 of 20261103-040939-rbr-remediation-9-review).
 * `repoRoot` is absolute; each root comes back absolute, '/'-joined, the repository itself left out.
 */
export function reviewRoots({ repoRoot, reviewsDir = '', stagingRoot = null, caseInsensitive } = {}) {
  // The repository is left out by the case rule every containment below folds by (G-7 of
  // 20261104-072059-epo-remediation-review): compared exactly, a reviews_dir naming it in other case survived.
  const fold = foldIf(caseRule('reviewRoots', caseInsensitive));
  const repo = absoluteSegments(repoRoot);
  const declared = typeof reviewsDir === 'string' && reviewsDir.trim();
  const named = declared ? [reviewsDir.trim()] : [ARCHIVED_REVIEWS, ...(typeof stagingRoot === 'string' && stagingRoot ? [stagingRoot] : [])];
  return named.map((d) => (isAbsoluteSpelling(d) ? absoluteSegments(d) : [...repo, ...d.split(SEP).filter((x) => x && x !== '.')]))
    .filter((segs) => !segs.includes('..') && fold(joinAbsolute(segs)) !== fold(joinAbsolute(repo)))
    .map(joinAbsolute);
}

/**
 * WHETHER A NORMALIZED PANEL PATH IS A RUN'S EVIDENCE (G-4 of 20261104-072059-epo-remediation-review; moved here from
 * lib/decision-panel.mjs isCapturedArtifact, which restated the containment): `r`, rootEvidencePath's result, lies below
 * one of the reviews roots at `<run>/evidence/<something>`, compared by the case rule.
 */
export function isRunEvidence(r, { repoRoot, reviewsDir = '', stagingRoot = null, caseInsensitive } = {}) {
  const fold = foldIf(caseRule('isRunEvidence', caseInsensitive));
  if (!r || r.refused || typeof r.abs !== 'string') return false;
  const target = absoluteSegments(r.abs);
  return reviewRoots({ repoRoot, reviewsDir, stagingRoot, caseInsensitive }).some((d) => {
    const rel = below(absoluteSegments(d), target, fold);
    return Boolean(rel) && rel.length >= 3 && fold(rel[1]) === 'evidence';
  });
}

/**
 * A PANEL EVIDENCE PATH, relative to the repository or to the reviews root it lies below. Returns
 * { root, rel, abs, canonical, key, inRepo }: `root` the absolute root, `rel` the '/'-joined path below it, `abs` the
 * '/'-joined absolute path, `canonical` the spelling the record keeps (`rel` inside the repository, `abs` outside it),
 * `key` `abs` folded by the case rule, the one thing two spellings are compared by. Or { refused } naming why: empty,
 * `..`, or below no root.
 */
export function rootEvidencePath(p, { repoRoot, reviewsDir = '', stagingRoot = null, caseInsensitive } = {}) {
  const fold = foldIf(caseRule('rootEvidencePath', caseInsensitive));
  if (typeof p !== 'string' || !p.trim()) return { refused: 'an empty evidence path' };
  if (typeof repoRoot !== 'string' || !isAbsoluteSpelling(repoRoot)) return { refused: 'no absolute repository root was given' };
  const s = p.trim();
  const repo = absoluteSegments(repoRoot);
  const target = isAbsoluteSpelling(s) ? absoluteSegments(s) : [...repo, ...s.split(SEP).filter((x) => x && x !== '.')];
  if (target.slice(1).includes('..')) return { refused: `${JSON.stringify(s)} steps up with '..'` };
  const roots = reviewRoots({ repoRoot, reviewsDir, stagingRoot, caseInsensitive }).map(absoluteSegments);
  // A reviews root inside the repository is not a root of its own: inside it, the repository is the root. Of the rest,
  // the MOST SPECIFIC root the path is below wins (G-9 of 20261104-060910-epo-delivery): a repository nested under a
  // reviews root keeps its own files, where trying the outer root first marked them out of the repository.
  const outside = roots.filter((r) => !below(repo, r, fold))
    .filter((r) => below(r, target, fold) && !(below(r, repo, fold) && below(repo, target, fold)))
    .sort((a, b) => b.length - a.length);
  for (const r of outside) {
    const rel = below(r, target, fold);
    const abs = joinAbsolute([...r, ...rel]);
    return { root: joinAbsolute(r), rel: rel.join('/'), abs, canonical: abs, key: fold(abs), inRepo: false };
  }
  const rel = below(repo, target, fold);
  if (!rel) return { refused: `${JSON.stringify(s)} is below neither the repository nor a reviews root` };
  const abs = joinAbsolute([...repo, ...rel]);
  return { root: joinAbsolute(repo), rel: rel.join('/'), abs, canonical: rel.join('/'), key: fold(abs), inRepo: true };
}
