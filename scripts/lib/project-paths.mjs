// project-paths.mjs — paths inside the repository UNDER REVIEW, which is the other half of a
// distinction locate.mjs makes in its first sentence: it answers where the framework's own files
// are "without reference to the repository being reviewed".
//
// REQUESTS_DIR and resolvedRequestsDir lived there and are the opposite thing (G-18,
// panel-codex-arch): the request store is a consumer-project input location, resolved against
// `repoRoot`, and putting it in framework self-location meant an installation-discovery module
// encoded project policy — so a project wanting its requests elsewhere would be editing the module
// that finds the engine. The file's own header was the evidence: it promises no reference to the
// reviewed tree, and `resolvedRequestsDir(repoRoot)` is nothing but one.
//
// Both halves stay together because they are one decision — where requests live, and proof that the
// path still lands inside the tree.

import path from 'node:path';
import { absolute, resolveFrom } from './paths.mjs';
import { requireIo } from './io-param.mjs';
import { isWithin } from './finding-scope.mjs';

// NO node:fs HERE (os-platform-adapters stage 3): the filesystem arrives as `io`, or as the
// injected readers these functions already accepted. scripts/io/project-paths.mjs binds it.

/**
 * Where a project keeps the requests a run is judged against.
 *
 * NOT `docs/`. The operator's rule, and it is right twice over: `docs/` is for documentation, and a
 * request is not documentation — it is an INPUT the engine reads, in the same class as the contract
 * block and the lens roster. It describes what was asked, not how the system works, and it is
 * consumed by `new-run` rather than read by someone learning the tool.
 *
 * The second reason is the one that matters for a consumer. quorate is a submodule in someone
 * else's repository, and `docs/requests/` claimed a directory inside THEIR documentation tree —
 * a plugin quietly deciding how a project organises its own docs. `.claude/` is where this
 * framework's footprint already lives: `.claude/reviews/` for run artifacts, `.claude/hooks/` for
 * the git hooks, `.claude/rules/quorate-contract.md` as a supported contract location. Requests
 * belong beside those.
 *
 * ONE OWNER, which is the other half of the fix. This literal appeared in seven places across
 * new-run and run-graph, plus the prompts and the doctrine — the shape this repository has paid for
 * repeatedly (EXECUTABLE_COMMAND_KEYS, panelProbePath, the vote vocabulary). Relocating it again is
 * now one line here rather than a search for a string.
 *
 * An explicit `doc_roles.request` still points anywhere it likes; this is only where DISCOVERY
 * looks when the contract declares nothing.
 */
export const REQUESTS_DIR = '.claude/requests';

/**
 * The requests directory, RESOLVED THROUGH LINKS and proved to still be inside the repository.
 *
 * Both callers took `path.resolve(repoRoot, REQUESTS_DIR)` — a lexical join, which a symlink or a
 * Windows junction at `.claude/requests` redirects silently. Recovery WRITES an inferred request
 * through that path and the lookup READS through it, so a link placed in a repository could send a
 * generated document outside the tree and then feed an attacker-chosen file into intent capture as
 * the criteria a run is judged against (panel-codex-security).
 *
 * The same rule external-review applies to an evidence directory, for the same reason: "an
 * unresolvable path is not evidence of containment". A path that cannot be resolved, or that leaves
 * the repository once it is, returns null and the caller treats requests as absent — which degrades
 * to the recovery path rather than trusting a redirected one.
 *
 * `mustExist: false` resolves the PARENT instead, so a directory that does not exist yet can still
 * be proved contained before it is created.
 */
export function resolvedRequestsDir(repoRoot, { mustExist = true, io } = {}) {
  requireIo(io, 'resolvedRequestsDir');
  const lexical = resolveFrom(repoRoot, 'resolvedRequestsDir: repoRoot', REQUESTS_DIR);
  const probe = mustExist ? lexical : path.dirname(lexical);
  let real;
  let realRoot;
  try {
    real = io.fs.realpathSync(probe);
    realRoot = io.fs.realpathSync(absolute(repoRoot, 'resolvedRequestsDir: repoRoot'));
  } catch {
    return null;   // does not exist, or cannot be resolved: not evidence of containment either way
  }
  // isWithin, the one owner of this comparison (G-24, G-37). The composed `realRoot + path.sep`
  // form this replaces matches nothing at a filesystem root — path.resolve already ends `F:\` in a
  // separator — so a repository at a drive root could never resolve its own requests directory.
  // Found while moving this module onto `io` (os-platform-adapters stage 3).
  const inside = isWithin(realRoot, real);
  if (!inside) return null;
  return mustExist ? real : path.join(real, path.basename(lexical));
}

/**
 * A request document's status: the FIRST `status:` line, which is its frontmatter.
 *
 * ONE OWNER because the two readers disagreed (G-20, contract-audit against I-21, which requires a
 * draft to be invisible to discovery). Discovery counted a file as approved when ANY line matched
 * `/^status:\s*approved\s*$/m`; acceptance read only the first one. A draft whose BODY quotes
 * `status: approved` — which a request describing this very mechanism naturally does — was therefore
 * discovered and then refused as a draft, and the run fell through to recovery while one genuinely
 * approved request sat beside it. With two such files it refused the mint outright, naming the draft
 * as an approved candidate.
 *
 * The first line is the right rule rather than the convenient one: a document's status is a property
 * of its header, and the body is prose that may quote anything, including other documents' headers.
 *
 * The header is the front matter and nothing else (G-7 of 20261020-113229-ciss-remediation-3-review):
 * the first `status:` line ANYWHERE let a document with no status in its front matter, or with no
 * front matter at all, be approved by a line in its body. No closed front matter is no status.
 */
export function requestStatus(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const close = lines.indexOf('---', 1);
  if (close < 0) return null;
  for (const line of lines.slice(1, close)) {
    const m = /^status:\s*(\S+)/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** Approved means approved in the frontmatter — the one question discovery and acceptance both ask. */
export const requestIsApproved = (text) => requestStatus(text) === 'approved';

/**
 * Which of the consuming project's skills shadow the framework's, and which legacy engine
 * directories sit on the doctrine-probe path.
 *
 * ONE OWNER, because two callers ask this at different moments and must not disagree: `new-run`
 * warns and stamps `SKILLS-SHADOWED` on every mint, and `check-install` reports it at the moment an
 * operator can act on it. It was in new-run alone, so the install — the step whose whole job is
 * telling you what is not current — said nothing about eight colliding names.
 *
 * PURE, and the framework's ids arrive as an argument rather than being read here: the closure that
 * reached for a name in an enclosing scope has cost this engine three ReferenceErrors, and a helper
 * whose inputs are parameters cannot repeat it.
 *
 * What a collision costs is narrower than it looks, and the difference matters. Nodes are spawned
 * with `--inline-skill`, so a LENS the orchestrator spawns uses the framework's own text no matter
 * what shares its name — review integrity is safe by construction. What stays ambiguous is a skill a
 * PERSON invokes: two `unit-test-writer`s under one name resolve to whichever the runtime picks.
 */
export function shadowedSkills({ frameworkIds = [], consumerSkillsDir, readdir, exists, io } = {}) {
  if (!readdir || !exists) requireIo(io, 'shadowedSkills');
  const ls = readdir ?? ((d) => io.fs.readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name));
  const has = exists ?? ((p) => io.fs.existsSync(p));
  let theirs = [];
  try { theirs = ls(consumerSkillsDir); } catch { /* no skills directory: nothing can collide */ }
  const ids = new Set(frameworkIds);
  return {
    shadowed: theirs.filter((n) => ids.has(n)).sort(),
    // The ancestor engine's own directories, which sit where the doctrine probe looks.
    legacy: ['shared', 'scripts'].filter((n) => has(path.join(consumerSkillsDir, n))),
  };
}

/**
 * Files that LOOK like the document a `doc_roles` key is asking for, when that key is empty.
 *
 * Not a guess and not a default: an empty key is a declared decision this framework honours, and
 * filling one by inference is exactly the improvisation it refuses elsewhere. But an empty
 * `architecture` key means `arch-review` degrades and CANNOT FAIL except on a §6 invariant — measured on a
 * consuming project whose contract said "no single architecture document declared" while
 * `docs/architecture.md` sat in the repository. The key was honest about what it declared and wrong
 * about the project, and nothing put those two facts side by side.
 *
 * So: candidates are reported, the operator decides. Matched on the basename, because a document that
 * governs is nearly always named after what it governs, and a heuristic that reaches further would
 * start proposing files that merely mention the word.
 */
export function docRoleCandidates({ role, files = [] }) {
  const words = {
    architecture: ['architecture', 'arch', 'design'],
    spec: ['spec', 'specification', 'requirements'],
    roadmap: ['roadmap', 'plan', 'milestones'],
  }[role] ?? [role];
  // THE BOUND, stated because it is a judgement and not a fact: the word must be one of the
  // basename's segments AND the basename must be at most two segments long. `architecture.md` and
  // `system-architecture.md` qualify; `notes-that-mention-architecture.md` does not, and it was
  // matched by the first version of this rule, which only asked whether the name ENDED with the word.
  // A note that proposes noise is a note the reader learns to skip, so the rule errs toward missing a
  // candidate rather than inventing one — the same direction every other guess in this engine takes.
  return files.filter((f) => {
    const base = path.basename(String(f)).toLowerCase().replace(/\.[a-z0-9]+$/, '');
    const segments = base.split(/[-_. ]+/).filter(Boolean);
    if (segments.length > 2) return false;
    return words.some((w) => segments.includes(w));
  }).sort();
}
