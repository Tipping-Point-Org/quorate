// THE ROUND CAP, AS A RULE (remediate-rebuild.plan.md stages 1 and 4). shared/remediation.md owns the meaning; this is
// the decision, pure: no I/O, no git — the caller supplies how to read a run and whether a follow-up review found a new
// MEDIUM in the previous remediation's own commits (a `git blame` trace, which is a proxy, and said so where it is used).

import path from 'node:path';
import { classifyPath, pathKey } from './finding-scope.mjs';
import { runEvidencePath } from './evidence-path.mjs';

// THE CASE FLAG IS REQUIRED on every path comparison of the remediation path (candidate-check-boundaries.plan.md stage 1):
// the caller passes the repository's core.ignorecase (gitIgnoresCase, below; the plan's amendment of 2026-10-14), and a
// call that forgets it fails rather than turning exact on Windows, which is how round 1's untracked `Package.json` would
// come back.
const caseFlag = (who, caseInsensitive) => {
  if (typeof caseInsensitive !== 'boolean') throw new Error(`${who}: caseInsensitive (the repository's core.ignorecase) is required`);
  return caseInsensitive;
};

/**
 * THE REMEDIATION PATH'S CASE RULE, from git (the plan's stage 1 amendment; G-9 of 20261014-022857-ccb-delivery; operator,
 * 2026-10-14: "Git's core.ignorecase (Recommended)"): the paths compared are paths git reports, and git probed the file
 * system for this repository when it was created. `r` is `git config --bool core.ignorecase`'s result: `true`/`false`,
 * or exit 1 with nothing printed when it is unset, which git reads as false. Anything else is refused, never guessed.
 */
export function gitIgnoresCase(r) {
  const out = String(r?.stdout ?? '').trim();
  if (r?.status === 0 && (out === 'true' || out === 'false')) return out === 'true';
  if (r?.status === 1 && out === '') return false;
  throw new Error(`git config --bool core.ignorecase gave exit ${r?.status} ${JSON.stringify(out)}${r?.stderr ? `: ${String(r.stderr).trim()}` : ''}`);
}

/**
 * IS ANY OF A CLUSTER'S ACCEPTED FILES STILL CHANGED (G-14 of 20261014-022857-ccb-delivery): a retry keeps a refused
 * cluster pending while its edits are in the tree, so the files git lists now are compared by the path key, not exactly.
 */
export function anyStillChanged(accepted, changed, { caseInsensitive } = {}) {
  const ci = caseFlag('anyStillChanged', caseInsensitive);
  const now = new Set((changed ?? []).map((p) => pathKey(p, { caseInsensitive: ci })));
  return (accepted ?? []).some((p) => now.has(pathKey(p, { caseInsensitive: ci })));
}
import { matchesAnyGlob } from './contract-glob.mjs';
import { SEVERITY_RUNGS } from './decisions.mjs';
import { testOneTemplate } from './test-one.mjs';
import { checkOutcome } from './capture-header.mjs';
import { MANIFEST_HEURISTIC } from './preflight-cache.mjs';
import { minutes } from './check-timeout.mjs';

/** shared/remediation.md, "Round cap": the THIRD consecutive remediation whose own fixes drew a new MEDIUM. */
export const ROUND_CAP = 3;

/**
 * WHICH FILES OF WHICH CLUSTERS THE RUNNER MAY COMMIT (remediation-paths stages 3+4; design decisions 1-3, operator
 * 2026-10-08). Pure: the caller supplies git's answer (`status`, from statusEntriesV2 taken after the node exits), the
 * files changed before the remediation began, the contract, and each group's severity.
 *
 * A group the node reported `fixed`, or `partial` with files, belongs to the cluster its `cluster` id names (its own
 * group id when it named none); clusters that share a file are merged, because one file cannot be split between two
 * commits. Each reported file is refused unless git reports it VERBATIM as a changed file (so a directory, a deleted
 * directory, an alias such as `src//a.js` or `./a.js`, and anything git does not list are refused), it is not inside a
 * nested repository or submodule git reported, it was not changed before the remediation began, and it is `source` or
 * `test` (classifyPath). A cluster is committed only if none of its files is refused, it carries a source file, and it
 * carries a test file — unless every group in it declared, in `no_red`, that its fix has no possible red, which is
 * committed and named. A group with no red, no `no_red` and no root's red refuses its cluster, with a test or without.
 * Clusters come back most severe first.
 */
/**
 * MAY THIS REPORTED GROUP BE COMMITTED AT ALL (remediation-commit-admission D1 = B, operator 2026-10-10: "Keep two
 * passes"). The ONE rule both passes use — admitGroups seeds its refusal from every group failing it, and
 * planClusterCommits selects by it — so the two cannot disagree about a group, which is what reviews r2-r4 of group
 * scoping kept finding. Confirmed, not deferred, and reported `fixed`, or `partial` with files. Without `confirmed`
 * (a caller that has already filtered), only the disposition is judged.
 */
export function commitEligible(g, ctx = {}) {
  return Boolean(g) && commitRefusal(g, ctx) === null;
}

/**
 * WHY A REPORTED GROUP MAY NOT BE COMMITTED, or null when it may: the one reason commitEligible and admitGroups both
 * read (G-1 of 20261010-233649-commit-admission-review: admitGroups had kept its own copies of the confirmed and
 * deferred tests). Shaped as a commit_check entry's fields — `group`, and `disposition` for `not-committable` — so a
 * reader of run.json never parses the message for them (G-3 of the same review).
 */
/**
 * THE CONFIRMED ROOT A REPORTED SYMPTOM IS JUDGED AS, or null for a confirmed group or one that reaches none. `symptoms`
 * maps each symptom to its `root_cause_group`; the chain is followed, with a visited set as the ledger fold does, so in
 * A -> B -> C with only C confirmed, A is C's (G-11 of 20261015-013937-symptom-admission: one lookup refused A).
 */
export function symptomRoot(group, { confirmed = null, symptoms = {} } = {}) {
  if (!confirmed || confirmed.includes(group)) return null;
  const seen = new Set([group]);
  for (let at = symptoms?.[group]; typeof at === 'string' && !seen.has(at); at = symptoms?.[at]) {
    if (confirmed.includes(at)) return at;
    seen.add(at);
  }
  return null;
}

export function commitRefusal(g, { confirmed = null, deferred = [], symptoms = {}, reported = null, reportedGroups = null, evidence = null, contract = {}, caseInsensitive } = {}) {
  const group = g?.group_id ?? null;
  // A SYMPTOM IS FIXED WITH ITS ROOT (skills/remediate: "`symptom` and its `root_cause_group` are the canonical
  // cluster"). `symptoms` maps a symptom group to its root, from the reviewed run's reconciliation: a reported symptom
  // whose root is confirmed is judged as its root is — deferred with it, admitted with it — rather than refused as
  // unconfirmed, which spread to the root itself (20261014-184502-lf-remediation: G-19 refused, G-16 and G-13 with it).
  // Admitted WITH it, never without (G-3 of 20261015-013937-symptom-admission): with `reported` (the report's group ids),
  // a symptom whose root is not reported is refused here, and admitGroups refuses one whose root is refused.
  const asRoot = symptomRoot(group, { confirmed, symptoms });
  if (confirmed && !confirmed.includes(group) && !asRoot) return { kind: 'unconfirmed-group', group };
  if ((deferred ?? []).includes(group) || (asRoot && (deferred ?? []).includes(asRoot))) return { kind: 'deferred-group', group };
  if (asRoot && reported && !reported.includes(asRoot)) return { kind: 'unconfirmed-group', group, blocked_by: asRoot };
  if (!(g?.disposition === 'fixed' || (g?.disposition === 'partial' && (g.files ?? []).length > 0))) {
    return { kind: 'not-committable', group, disposition: g?.disposition ?? null };
  }
  // THE EVIDENCE GATE (remediation-verification stage 5), judged when the caller read the captures; `evidence` absent is
  // a caller that has already admitted the group.
  if (evidence) {
    // A SYMPTOM IS SHOWN BY ITS ROOT'S EXPERIMENT (remediation-evidence-rules.plan.md stage 1, design E-D3 A): it is
    // fixed by fixing its root and is always planned in its root's cluster, so its red and green may be its root's, of a
    // test file only the root's group commits (ciss-d1-4: G-15 refused for exactly that, and G-9, G-10, G-16 with it).
    // Its root's own evidence is judged when the root is.
    const root = asRoot ? (reportedGroups ?? []).find((o) => o?.group_id === asRoot) : null;
    const judged = root ? { ...g, files: [...(g.files ?? []), ...(root.files ?? [])] } : g;
    const why = evidenceRefusal(judged, evidence, contract, { caseInsensitive });
    if (why) return { kind: 'evidence-refused', group, why };
  }
  return null;
}

/**
 * IS THIS FIX'S EXPERIMENT ON DISK (remediation-verification.plan.md stage 5; operator, 2026-10-13: "Evidence-gated
 * (Recommended)"). `evidence` maps each cited path to the facts capture wrote in its header — { admitted, file, exit,
 * timed_out, captured } — or null when it is not a capture in this run's evidence/remediation. Returns null when the
 * group may be committed, else why not. A group whose red is empty declared its claim not expressible as a test, and
 * passes as today (the planner names it). Otherwise its red must be a `test_one` run that exited non-zero and was not
 * timed out, and its green a `test_one` run of the SAME file that exited 0, captured after the red; and that file is a
 * test file the group commits. Several greens may be listed (evidencePaths): every one a passing `test_one` run captured
 * after the red, and one of them of the red's file; a green of a red's file is of a test file the group commits, a further
 * green of another file need not be (operator, 2026-11-03: "B"; G-10 of 20261103-191032-dr-remediation-3-review);
 * that each changed test file has a green is not checked, only every green listed (G-3 of
 * 20261014-193710-lf-remediation-review: the docs follow this gate).
 * A red from the full `test` command does not count. `partial` follows the same rule.
 */
/**
 * The capture paths an evidence field names. `green_evidence` may list several, `;`-separated: a fix that changed more
 * than one test file shows each passing (20261014-190935-lf-remediation-2, where four greens read as one path were
 * refused). capture.mjs's names match ^[A-Za-z0-9._-]+$, so `;` is never part of one.
 */
export function evidencePaths(field) {
  return typeof field === 'string' ? field.split(';').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * A REPORT'S EVIDENCE PATHS IN NORMAL FORM, once, where the report is read (evidence-path-owner.plan.md stage 2; design
 * EP-D2 C, operator 2026-11-04: "why not compute before and provide it for each reader?"). Each of `fields` on each item
 * (a group's red_evidence and green_evidence, a repair failure's green_evidence) becomes its captures' normal forms,
 * `; `-joined, through lib/evidence-path.mjs; an item with a path the owner refuses carries `evidence_path_refused`, the
 * reason, and the evidence gate refuses it naming the path. Returns copies; the report on disk keeps the node's spelling,
 * so every read of it comes through here.
 */
export function normalizeEvidenceFields(items, fields, { runDir, caseInsensitive, formerRunDirs = [] } = {}) {
  caseFlag('normalizeEvidenceFields', caseInsensitive);
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== 'object') return item;
    const out = { ...item };
    for (const f of fields) {
      if (typeof item[f] !== 'string' || !item[f].trim()) continue;
      const parts = evidencePaths(item[f]).map((p) => runEvidencePath(p, { runDir, caseInsensitive, formerRunDirs }));
      // EVERY REFUSED PATH IS NAMED (G-6 of 20261104-082659-epo-remediation-2-review): the first alone dropped a bad
      // green behind a bad red, and a second bad path in one field.
      const bad = parts.filter((r) => r.refused);
      if (bad.length) {
        const why = bad.map((r) => `${f}: ${r.refused}`).join('; ');
        out.evidence_path_refused = out.evidence_path_refused ? `${out.evidence_path_refused}; ${why}` : why;
        continue;
      }
      out[f] = parts.map((r) => r.path).join('; ');
    }
    return out;
  });
}

/**
 * A NODE'S REPORT, WITH EVERY EVIDENCE FIELD IN NORMAL FORM (G-10 and G-12 of 20261104-060910-epo-delivery): the report
 * in, the report out, so no reader picks which items or fields to normalize. A remediation report's groups carry
 * red_evidence and green_evidence, a repair pass's failures green_evidence; every one of them goes through the owner,
 * whatever its disposition. Called once, immediately after the report is read, before any consumer. Returns a copy.
 */
export function normalizeReport(report, { runDir, caseInsensitive, formerRunDirs = [] } = {}) {
  caseFlag('normalizeReport', caseInsensitive);
  if (!report || typeof report !== 'object' || Array.isArray(report)) return report;
  const opts = { runDir, caseInsensitive, formerRunDirs };
  const out = { ...report };
  if (Array.isArray(report.groups)) out.groups = normalizeEvidenceFields(report.groups, ['red_evidence', 'green_evidence'], opts);
  if (Array.isArray(report.failures)) out.failures = normalizeEvidenceFields(report.failures, ['green_evidence'], opts);
  return out;
}

export function evidenceRefusal(g, evidence, contract = {}, { caseInsensitive } = {}) {
  const ci = caseFlag('evidenceRefusal', caseInsensitive);
  // A PATH THE OWNER REFUSED where the report was read (normalizeEvidenceFields): the group's evidence is not a capture.
  if (g?.evidence_path_refused) return `a cited evidence path is refused (${g.evidence_path_refused})`;
  if (!g?.red_evidence) return null;
  // SEVERAL REDS, as several greens (20261020-102242-ciss-remediation): test_one runs one file, so a fix pinned in two
  // test files has a red for each, and the node lists them `;`-separated. Each is checked as the one red was.
  const redPaths = evidencePaths(g.red_evidence);
  const greens = evidencePaths(g.green_evidence);
  if (!greens.length) return 'no green: a red with no green is half an experiment';
  for (const p of redPaths) if (!evidence?.[p]) return `the red ${p} is not a capture in this run's evidence/remediation`;
  for (const p of greens) if (!evidence?.[p]) return `the green ${p} is not a capture in this run's evidence/remediation`;
  for (const p of redPaths) {
    if (evidence[p].admitted !== 'test_one') {
      // The plan's stage 8: with the key empty only groups declared not expressible as a test commit, and the gate says
      // so rather than leaving the project to infer it (G-7 of 20261013-220031-rv-delivery).
      const noKey = testOneTemplate(contract).argv ? '' : '; this contract declares no commands.test_one, so no red can count until one is declared';
      return `the red ${p} is not a test_one capture (${evidence[p].admitted ?? 'no admitted key'}); a full-suite red does not count for a group${noKey}`;
    }
  }
  for (const p of greens) if (evidence[p].admitted !== 'test_one') return `the green ${p} is not a test_one capture (${evidence[p].admitted ?? 'no admitted key'})`;
  // A RED THAT RAN AND FAILED, A GREEN THAT RAN AND PASSED (check-outcomes.plan.md stage 4): checkOutcome over each
  // capture's header, so an exit 124 that never ran (a spawn error, a signal) is not admitted as a red.
  const outcomeOf = (facts) => facts.outcome ?? checkOutcome(facts).outcome;
  for (const p of redPaths) {
    const red = evidence[p];
    const redOutcome = outcomeOf(red);
    if (redOutcome === 'timed-out') return `the red ${p} timed out, so it shows nothing about the defect`;
    if (redOutcome === 'passed') return `the red ${p} exited 0: it never failed`;
    if (redOutcome !== 'failed') {
      return `the red ${p} did not run to completion (${redOutcome}${red.error ? `: ${red.error}` : red.signal ? `: ${red.signal}` : ''}), so it shows nothing about the defect`;
    }
  }
  const firstRed = Math.min(...redPaths.map((p) => Date.parse(evidence[p].captured)));
  for (const p of greens) {
    const greenOutcome = outcomeOf(evidence[p]);
    if (greenOutcome === 'failed') return `the green ${p} exited ${evidence[p].exit}`;
    if (greenOutcome !== 'passed') return `the green ${p} did not run to completion (${greenOutcome})`;
    if (!(Date.parse(evidence[p].captured) > firstRed)) return `the green ${p} was not captured after the red`;
  }
  const reds = redPaths.map((p) => evidence[p]);
  const red = reds[0];
  if (reds.length === 1 && !greens.some((p) => evidence[p].file === red.file)) {
    return `the green ran ${greens.map((p) => evidence[p].file).join(', ')}, not the same file as the red (${red.file})`;
  }
  // EACH RED HAS A LATER GREEN OF ITS FILE (20261020-174439-argv-remediation-2): a fix may run red-then-green twice on one
  // file, so a green need only follow the red it answers, and every red must be answered.
  for (const r of reds) {
    const answered = greens.some((p) => evidence[p].file === r.file && Date.parse(evidence[p].captured) > Date.parse(r.captured));
    if (!answered) {
      return greens.some((p) => evidence[p].file === r.file)
        ? `no green re-ran ${r.file} after its red`
        : `no green re-ran ${r.file}, the file of a red`;
    }
  }
  // Each file among the group's by the platform's key (stage 1); green-versus-red above stays EXACT: both come from
  // capture's header, which records what was run.
  const committedTest = (file) => {
    const k = pathKey(file ?? '', { caseInsensitive: ci });
    return (g.files ?? []).some((f) => pathKey(f, { caseInsensitive: ci }) === k) && classifyPath(file, contract, { caseInsensitive: ci }) === 'test';
  };
  // A GREEN THAT ANSWERS NO RED IS NOT THE GROUP'S EVIDENCE (operator, 2026-11-03: "B", on 20261103-163145-dr-remediation-3,
  // whose node cited a passing run of a test file it did not change beside each red's green, and every fixed group fell
  // with the two that did). Each red's file, and so the green that answers it, must be a test file the group commits; a
  // further green of another file is still held to passing after the red above, but not to being committed.
  const redFiles = new Set(reds.map((r) => r.file));
  for (const file of [...reds.map((r) => r.file), ...greens.map((p) => evidence[p].file).filter((f) => redFiles.has(f))]) {
    if (!committedTest(file)) return `${file} is not a test file this group commits`;
  }
  return null;
}

/** A group's declared reason for having no red (stage 2), or null: absent, null, or blank is no declaration. */
export const noRedReason = (g) => (typeof g?.no_red === 'string' && g.no_red.trim() ? g.no_red.trim() : null);

/**
 * THE RULE A FILE IS COMMITTED BY, one owner for the first pass's clusters (planClusterCommits) and a repair pass's
 * additions (repairFileAdmission; remediation-repair-pass.plan.md stage 2). Returns a function from a reported path to
 * { path, reason }: `path` in git's spelling where git lists it, `reason` null when the file may be committed — a change
 * git lists, not inside a repository (now or at the start), not changed before the remediation began, source or test.
 */
export function clusterFileRule({ status, dirtyAtStart = [], refusedAtStart = [], contract = {}, caseInsensitive }) {
  const ci = caseFlag('clusterFileRule', caseInsensitive);
  const key = (p) => pathKey(p, { caseInsensitive: ci });
  const statusFiles = new Set(status?.files ?? []);
  const gitSpelling = new Map((status?.files ?? []).map((f) => [key(f), f]));
  const canon = (p) => gitSpelling.get(key(p)) ?? p;
  const repos = (status?.refused ?? []).map((r) => key(String(r.path).replace(/\/$/, '')));
  const reposAtStart = (refusedAtStart ?? []).map((r) => key(String(r.path).replace(/\/$/, '')));
  const dirty = new Set((dirtyAtStart ?? []).map(key));
  const inside = (p, r) => key(p) === r || key(p).startsWith(`${r}/`);
  const reasonFor = (p) => {
    const repo = repos.findIndex((r) => inside(p, r));
    if (repo !== -1) return `inside ${String(status.refused[repo].path).replace(/\/$/, '')}, a repository, not a file (a nested repository or submodule)`;
    const startRepo = reposAtStart.findIndex((r) => inside(p, r));
    if (startRepo !== -1) return `inside ${String(refusedAtStart[startRepo].path).replace(/\/$/, '')}, a repository refused at the start (the operator's nested repository or submodule)`;
    if (!statusFiles.has(p)) return 'not in git status as a changed file — git names it differently, or it is not a file';
    if (dirty.has(key(p))) return 'changed before the remediation began; the operator commits it';
    const kind = classifyPath(p, contract, { caseInsensitive: ci });
    if (kind !== 'source' && kind !== 'test') return `a ${kind} file; a remediation commits only source and test files`;
    return null;
  };
  const rule = (reported) => { const p = canon(reported); return { path: p, reason: reasonFor(p) }; };
  rule.canon = canon;
  return rule;
}

export function planClusterCommits({ groups, status, dirtyAtStart = [], refusedAtStart = [], contract = {}, severityOf = () => 'LOW', evidence = null, confirmed = null, symptoms = {}, reviewedFiles = {}, caseInsensitive }) {
  const ci = caseFlag('planClusterCommits', caseInsensitive);
  const key = (p) => pathKey(p, { caseInsensitive: ci });
  const fileRule = clusterFileRule({ status, dirtyAtStart, refusedAtStart, contract, caseInsensitive: ci });
  // GIT'S SPELLING FIRST (candidate-check-boundaries.plan.md stage 1; plan-review round 2): a reported path becomes the
  // changed file whose key it shares, BEFORE the grouping and every later check, so two spellings of one file join one
  // cluster, and a file dirty at the start reported in another case is still the operator's. A path git does not list
  // keeps the node's spelling and is refused below, as before. The start-state sets are KEYED too (G-5/G-6 of
  // 20261014-022857-ccb-delivery), and the repositories refused when the remediation began are refused too (G-9 (a) of
  // 20261009-014530-remediation-paths-r2; design remediation-run-ownership D3): both inside clusterFileRule.
  const canon = fileRule.canon;
  // With `evidence` (a retry's re-plan, stage 5), the evidence gate applies here too.
  const eligible = (groups ?? []).filter((g) => commitEligible(g, { evidence, contract, confirmed, symptoms, reportedGroups: groups, caseInsensitive: ci }))
    .map((g) => ({ ...g, files: (g.files ?? []).map(canon) }));
  // Union-find over cluster ids, joined wherever two clusters name the same file.
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const idOf = (g) => String(g.cluster || g.group_id);
  for (const g of eligible) if (!parent.has(idOf(g))) parent.set(idOf(g), idOf(g));
  const owner = new Map();
  for (const g of eligible) {
    for (const f of g.files ?? []) {
      const k = key(f);
      if (owner.has(k)) union(owner.get(k), idOf(g));
      else owner.set(k, idOf(g));
    }
  }
  // A SYMPTOM IS ONE CLUSTER WITH THE ROOT IT IS JUDGED AS (G-4 of 20261015-022849-symptom-remediation-review): admission
  // spread only the refusals it knew, so a symptom in a cluster of its own was committed when its root's cluster was
  // refused later, here or by git. Joined, they are refused and committed together.
  // Looked up by id ONCE (G-2 of 20261107-195640-co-remediation-2-review): eligible.find per group was O(G²). The first
  // group of an id wins, as find's did.
  const eligibleById = new Map();
  for (const g of eligible) if (!eligibleById.has(g.group_id)) eligibleById.set(g.group_id, g);
  for (const g of eligible) {
    const root = symptomRoot(g.group_id, { confirmed, symptoms });
    const r = root && eligibleById.get(root);
    if (r) union(idOf(r), idOf(g));
  }
  const byRoot = new Map();
  for (const g of eligible) {
    const root = find(idOf(g));
    if (!byRoot.has(root)) byRoot.set(root, { ids: new Set(), groups: [] });
    byRoot.get(root).ids.add(idOf(g));
    byRoot.get(root).groups.push(g);
  }
  const clusters = [];
  for (const [root, { ids, groups: gs }] of byRoot) {
    // Deduped by key; the paths are already in git's spelling where git lists them.
    const reported = [...new Map(gs.flatMap((g) => g.files ?? []).map((p) => [key(p), p])).values()];
    const accepted = [];
    const refused = [];
    for (const p of reported) {
      const { reason } = fileRule(p);
      if (reason) refused.push({ path: p, reason });
      else accepted.push(p);
    }
    const notes = [];
    const hasSource = accepted.some((p) => classifyPath(p, contract, { caseInsensitive: ci }) === 'source');
    const hasTest = accepted.some((p) => classifyPath(p, contract, { caseInsensitive: ci }) === 'test');
    const notExpressible = gs.every((g) => !g.red_evidence);
    // A FIX WHOSE FINDING IS ABOUT A TEST (remediation-evidence-rules.plan.md stage 3, design E-D1 A): every group in the
    // cluster was reported against a test file (the reviewed run's finding-groups.json, `reviewedFiles`: { id: file }),
    // so the fix changes tests only and is still a fix. Its red is held to the same rule as any other. A reviewed file
    // that cannot be read is no test finding: the cluster is refused as before.
    const testFinding = !hasSource && gs.length > 0 && gs.every((g) => {
      const f = reviewedFiles?.[g.group_id];
      return typeof f === 'string' && f && classifyPath(f, contract, { caseInsensitive: ci }) === 'test';
    });
    if (testFinding) notes.push('a fix to tests only: every group in it was reported against a test file');
    else if (!hasSource) notes.push('its accepted files include no source_globs path, so it is not a fix');
    if (!hasTest && !notExpressible) notes.push('it reported a red-before-green test, but its accepted files include no test_globs path');
    // A TEST WITHOUT ITS RED IS HALF AN EXPERIMENT (.claude/requests/two-ledger-mediums.md, AC1): a group with no
    // red_evidence in a cluster that commits a test was read as not expressible, so a fix whose red step was skipped
    // committed (remediation 20261019-031140-review, seven groups). Every group must show its red, declare `no_red`, or
    // be a symptom whose root is in this cluster with a red of its own (design E-D3 A) — in a cluster with no test too
    // (G-1 of 20261023-062611-rer-remediation-review-2: a source-only cluster with an undeclared empty red committed).
    const shownByRoot = (g) => {
      const root = symptomRoot(g.group_id, { confirmed, symptoms });
      return Boolean(root) && gs.some((o) => o.group_id === root && o.red_evidence);
    };
    // A FIX DECLARED TO HAVE NO POSSIBLE RED (stage 2, design E-D2 A), by the rule shared/remediation.md states (What a fix
    // must show): its declaration stands for its red, and its reason is recorded. A payload from before the field reads it
    // as null.
    const declared = gs.filter((g) => !g.red_evidence && noRedReason(g)).map((g) => ({ group: g.group_id, reason: noRedReason(g) }));
    const redSkipped = gs.filter((g) => !g.red_evidence && !shownByRoot(g) && !noRedReason(g)).map((g) => g.group_id);
    if (redSkipped.length) notes.push(`red-before-green skipped: ${redSkipped.join(', ')} reported a fix with no red capture and no no_red declaration`);
    // A FIELD, not a sentence to parse (G-4 of 20261023-062611-rer-remediation-review-2): the runner records
    // committed-without-test from `without_test`, never from this note's wording.
    const withoutTest = !hasTest && notExpressible && !redSkipped.length;
    if (withoutTest) notes.push('committed without a test: every group in it declared no possible red (no_red)');
    const committable = refused.length === 0 && (hasSource || testFinding) && (hasTest || notExpressible) && !redSkipped.length;
    const rank = Math.max(...gs.map((g) => SEVERITY_RUNGS.indexOf(severityOf(g.group_id)) + 1));
    clusters.push({ id: root, merged_from: [...ids], groups: gs.map((g) => g.group_id), accepted, refused, notes, committable, rank, declared_no_red: declared, without_test: withoutTest });
  }
  return clusters.sort((a, b) => b.rank - a.rank);
}

/**
 * Why a retry's committable re-plan of a recorded cluster may not be committed, or null when it may. The recorded
 * accepted files are the ones checked, and the recorded GROUPS are the ones whose evidence admitted them (G-4 of
 * 20261015-025724-symptom-remediation-2-review): the planner drops a group that fails the evidence gate on the re-read,
 * and a symptom sharing every file with its root left the paths unchanged, so comparing paths alone committed a cluster
 * whose group had just failed its gate.
 */
export function retryMismatch(plan, recorded) {
  const same = (a, b) => { if (a.length !== b.length) return false; const sa = [...a].sort(), sb = [...b].sort(); return sa.every((x, i) => x === sb[i]); };
  const groups = recorded.groups ?? [];
  if (!same(plan.groups ?? [], groups)) {
    const lost = groups.filter((g) => !(plan.groups ?? []).includes(g));
    return `the re-plan holds ${(plan.groups ?? []).join(', ') || 'no group'}, not the recorded groups ${groups.join(', ')}`
      + (lost.length ? ` (${lost.join(', ')} no longer pass${lost.length === 1 ? 'es' : ''} the evidence gate or no longer report${lost.length === 1 ? 's' : ''} a committable disposition)` : '');
  }
  const accepted = recorded.accepted ?? [];
  if (!same(plan.accepted, accepted)) return `the re-plan accepts ${plan.accepted.join(', ')}, not the recorded accepted files ${accepted.join(', ')}`;
  return null;
}

/**
 * Given, oldest first, whether each prior remediation in the chain drew a new MEDIUM in its own fixes, how many did so
 * consecutively up to now, and whether the cap is reached — at which point the next remediation does not patch.
 */
export function roundCapState(ownMediums, cap = ROUND_CAP) {
  let consecutive = 0;
  for (const own of ownMediums ?? []) consecutive = own === true ? consecutive + 1 : 0;
  return { consecutive, capped: consecutive >= cap };
}

/**
 * Walk back from the review a remediation is about to work from, along the links (operator, 2026-10-08: "B: follow the
 * links (Recommended)"): a review that records `follows_remediation` was minted by that remediation, which itself
 * remediated an earlier review, and so on. Any other review ends the chain. Returns `{ links, unknown }`: the links
 * oldest first, each with the remediation it names and whether the review that followed it found a MEDIUM in its own
 * fixes; and `unknown`, a reason, when the walk could not be completed — a linked run that cannot be read, or a blame
 * answer that is not known (`ownMedium` returning null). Uncertainty is reported, never turned into a clean boundary
 * that would shorten the count (G-1 and G-13 of 20261008-214527-remediate-rebuild-review).
 *
 * `readRun(dir, runId)` returns a run's run.json object (or null); `runId` is the id the link recorded, or null; `ownMedium(followupRun, remediationRun)` answers true, false
 * or null (unknown). A cycle ends the walk.
 */
export function walkChain({ reviewedDir, readRun, ownMedium }) {
  const links = [];
  const seen = new Set();
  let reviewed = readRun(reviewedDir);
  if (!reviewed) return { links, unknown: `the reviewed run at ${reviewedDir} cannot be read` };
  while (reviewed.follows_remediation && !seen.has(reviewed.run_id)) {
    seen.add(reviewed.run_id);
    const remediation = readRun(reviewed.follows_remediation.run_dir, reviewed.follows_remediation.run_id ?? null);
    if (!remediation?.remediates) {
      return { links, unknown: `${reviewed.run_id} follows ${reviewed.follows_remediation.run_id}, which cannot be read as a remediation run` };
    }
    const own = ownMedium(reviewed, remediation);
    if (own !== true && own !== false) {
      return { links, unknown: `whether ${reviewed.run_id} found a MEDIUM in ${remediation.run_id}'s own fixes cannot be established` };
    }
    // Where the run was READ, when the reader says (it may have moved since the link was recorded).
    links.unshift({ remediation_run_id: remediation.run_id, remediation_dir: remediation.run_dir ?? reviewed.follows_remediation.run_dir, own_medium: own });
    reviewed = readRun(remediation.remediation_frame?.run_dir, remediation.remediation_frame?.run_id ?? null);
    if (!reviewed) return { links, unknown: `the run ${remediation.run_id} remediated cannot be read` };
  }
  // A REPEATED RUN IS A CYCLE, not a complete chain (G-4 of 20261008-221517-remediate-rebuild-r2): stopping there
  // quietly would shorten the count the cap reads.
  if (reviewed.follows_remediation && seen.has(reviewed.run_id)) {
    return { links, unknown: `the chain has a cycle at ${reviewed.run_id}` };
  }
  return { links, unknown: null };
}

/**
 * GIT'S ANSWER TO "WHICH FILES CHANGED", parsed once (remediation-paths.design.md decision 2, operator 2026-10-08: "Ask
 * git once (Recommended)"). Reads `git status --porcelain=v2 -z --untracked-files=all`: raw paths in git's own spelling,
 * one NUL-terminated record per entry. Returns `{ files, refused }`:
 *   files   — every path git reports as changed: ordinary (`1`), renamed or copied (`2`, both the new and the original
 *             path), unmerged (`u`) and untracked (`?`) entries, deletions included;
 *   refused — entries that are not files: an untracked entry ending in `/` (a nested repository — with
 *             --untracked-files=all git lists only those as directories), and any tracked entry whose submodule field
 *             starts `S` or whose mode is 160000 (a submodule). A remediation commits files, never another repository.
 * Measured on git 2.56.0.windows.2: v1 lists both kinds indistinguishably from files, which is why v2.
 */
export function statusEntriesV2(stdout) {
  const rec = String(stdout ?? '').split('\0');
  const files = [];
  const refused = [];
  const untracked = [];
  // `n` space-separated fields, then the path (which may itself contain spaces).
  const fieldsThenPath = (r, n) => {
    const parts = [];
    let rest = r;
    for (let k = 0; k < n; k++) {
      const at = rest.indexOf(' ');
      if (at === -1) return null;
      parts.push(rest.slice(0, at));
      rest = rest.slice(at + 1);
    }
    return { parts, path: rest };
  };
  const tracked = (parsed, modeIdx) => {
    const [, , sub] = parsed.parts;
    const modes = parsed.parts.slice(modeIdx[0], modeIdx[1]);
    if (String(sub).startsWith('S') || modes.includes('160000')) {
      refused.push({ path: parsed.path, reason: 'a submodule: another repository, not a file' });
      return false;
    }
    files.push(parsed.path);
    return true;
  };
  for (let i = 0; i < rec.length; i++) {
    const r = rec[i];
    if (!r) continue;
    const kind = r[0];
    if (kind === '1') {
      const p = fieldsThenPath(r, 8);
      if (p) tracked(p, [3, 6]);
    } else if (kind === '2') {
      const p = fieldsThenPath(r, 9);
      const orig = rec[i + 1];
      i += 1;
      // The score field says which: `R` a rename (the original is gone: changed), `C` a copy (the original is untouched:
      // not a change). A renamed submodule's original is a repository too (G-3 of 20261009-011732-remediation-paths-r1).
      const rename = Boolean(p) && String(p.parts[8]).startsWith('R');
      if (p && tracked(p, [3, 6])) { if (rename && orig) files.push(orig); }
      else if (p && rename && orig) refused.push({ path: orig, reason: 'a submodule: another repository, not a file' });
    } else if (kind === 'u') {
      const p = fieldsThenPath(r, 10);
      if (p) tracked(p, [3, 7]);
    } else if (kind === '?') {
      const p = r.slice(2);
      if (p.endsWith('/')) refused.push({ path: p, reason: 'a nested repository: another repository, not a file' });
      else { files.push(p); untracked.push(p); }
    }
    // '#' headers and '!' ignored entries are not changes.
  }
  // `untracked` names the subset git lists as untracked (remediation-verification stage 4: with no declared input set,
  // the tree guard refuses every TRACKED change outside the candidate and lets an untracked note through).
  return { files: [...new Set(files)], refused, untracked: [...new Set(untracked)] };
}

/**
 * THE TREE GUARD (remediation-verification.plan.md, stage 4; operator, 2026-10-13: "In place, guarded (Recommended)" and
 * "Refuse; commit or stash first (Recommended)"). The runner checks the commit candidate in the working tree, so the
 * tree must differ from HEAD only in the candidate's files and in files the checks cannot read. Every changed file
 * (`files`, a rename's old path included) outside `candidate` and outside `excludedDirs` (the run's own directory,
 * excluded by name) refuses when it is: a source or test file (the one classifier); a check input, meaning a match of
 * the declared `review.preflight_inputs` or the contract source itself, which the input-set owner always adds; or, with
 * NO declared input set, any tracked change (`untracked` lists what git does not track), since what the checks read is
 * then unknown, and a root-level dependency manifest tracked or not (the inferred set's MANIFEST_HEURISTIC). Before the node runs, the candidate is empty, so this is the "commit or stash first" refusal.
 * Returns `[{ path, why }]`.
 */
export function treeGuardRefusals({ files = [], untracked = [], candidate = new Set(), contract = {}, contractSource = null, excludedDirs = [], caseInsensitive }) {
  // KEYED BY THE REPOSITORY'S CASE RULE (candidate-check-boundaries.plan.md stage 1; operator, 2026-10-14: D3, amended to
  // "Git's core.ignorecase (Recommended)"): where git reports the file system case-insensitive `Package.json` is the manifest the inferred set's owner finds,
  // `claude.md` the contract and `SRC/a.js` a source file; on a case-sensitive one they are other files. It folded always
  // before, which is what the rounds' siblings came from.
  const ci = caseFlag('treeGuardRefusals', caseInsensitive);
  const key = (p) => pathKey(p, { caseInsensitive: ci });
  const norm = (p) => String(p).split('\\').join('/');
  // The run directory stays EXACT, by prefix: the runner names it itself, in one spelling.
  const excluded = excludedDirs.map((d) => norm(d).replace(/\/+$/, ''));
  const declared = Array.isArray(contract?.review?.preflight_inputs) && contract.review.preflight_inputs.length
    ? contract.review.preflight_inputs : null;
  const loose = new Set(untracked.map(key));
  const inCandidate = new Set([...candidate].map(key));
  const manifests = new Set(MANIFEST_HEURISTIC.map(key));
  const contractKey = contractSource ? key(contractSource) : null;
  const inputGlobs = declared ? declared.map((g) => (ci ? String(g).toLowerCase() : String(g))) : null;
  const out = [];
  for (const raw of files) {
    const p = norm(raw);
    const k = key(p);
    if (inCandidate.has(k)) continue;
    if (excluded.some((d) => p === d || p.startsWith(`${d}/`))) continue;
    const cls = classifyPath(p, contract, { caseInsensitive: ci });
    if (cls === 'source' || cls === 'test') { out.push({ path: p, why: `a ${cls} file changed outside the candidate` }); continue; }
    if (contractKey && k === contractKey) { out.push({ path: p, why: 'the contract the checks run under changed' }); continue; }
    if (inputGlobs && matchesAnyGlob(inputGlobs, k)) { out.push({ path: p, why: 'a check input (review.preflight_inputs) changed outside the candidate' }); continue; }
    // An untracked file can be an input too: the INFERRED set's owner adds the root-level dependency manifests, tracked
    // or not (G-8 of 20261013-220031-rv-delivery: an untracked package.json passed, and changed what the checks certify).
    if (!declared && manifests.has(k)) { out.push({ path: p, why: 'a dependency manifest in the inferred check inputs changed outside the candidate' }); continue; }
    if (!declared && !loose.has(k)) { out.push({ path: p, why: 'a tracked change, and with no declared review.preflight_inputs what the checks read is unknown' }); }
  }
  return out;
}


/**
 * THE commit_check VOCABULARY, ONE OWNER (G-12, G-13 of 20261009-011732-remediation-paths-r1). Every kind the runner
 * records, and whether it stamps COMMIT-CHECK. `merged` is recorded and does not stamp: two clusters sharing a file and
 * committed as one is a fact about the commit, not a failure of it. `cluster` is null for the cluster-less kinds.
 */
export const COMMIT_CHECK_KINDS = Object.freeze({
  'stray-commit': { stamps: true, cluster: false },
  'node-failed': { stamps: true, cluster: false },
  'report-mismatch': { stamps: true, cluster: false },
  'confirmed-unknown': { stamps: true, cluster: false },
  'unconfirmed-group': { stamps: true, cluster: false },
  'deferred-group': { stamps: true, cluster: false },
  'not-committable': { stamps: true, cluster: false },
  'evidence-refused': { stamps: true, cluster: false },
  'shared-with-refused': { stamps: true, cluster: false },
  'deferred-file': { stamps: false, cluster: false },
  'deferred-file-unchecked': { stamps: true, cluster: false },
  // A path the node's run changed that no planned cluster carries (remediation-left-in-tree.md): left in the tree, named.
  'left-in-tree': { stamps: true, cluster: false },
  // A group the evidence gate refused on the first run and admits now, planned by --retry-commits --readmit-evidence
  // (operator, 2026-11-03: "b"): a fact about the retry, not a failure of it.
  readmitted: { stamps: false, cluster: false },
  // A SET-ASIDE NOT WRITTEN BACK (remediation-cluster-order.plan.md, CO-D3 A): the bytes of a refused cluster set aside for
  // the full check could not be written back, or hash differently after writing; the run stops, the copies kept.
  'set-aside-unrestored': { stamps: true, cluster: false },
  merged: { stamps: false, cluster: true },
  'refused-file': { stamps: true, cluster: true },
  'refused-cluster': { stamps: true, cluster: true },
  'committed-without-test': { stamps: true, cluster: true },
  // A committed group the node declared has no possible red (remediation-evidence-rules.plan.md stage 2): its reason, for
  // the follow-up review to judge. A fact about the commit, not a failure of it.
  'declared-no-red': { stamps: false, cluster: true },
  'hook-rejected': { stamps: true, cluster: true, retryable: true },
  'reset-failed': { stamps: true, cluster: true, retryable: true },
  'commit-unrecorded': { stamps: true, cluster: true },
  // THE RUNNER'S FULL CHECK (remediation-verification stage 4): the candidate's checks refused it, or the tree held more
  // than the candidate. Retryable: --retry-commits checks the re-planned candidate again.
  'full-run-red': { stamps: true, cluster: true, retryable: true },
  'tree-not-candidate': { stamps: true, cluster: true, retryable: true },
  // The commit landed, and a committed file differs from what the runner checked (a hook rewrote it): named, not retried.
  'committed-differs': { stamps: true, cluster: true },
  // A REFUSED CLUSTER SET ASIDE (remediation-cluster-order.plan.md, CO-D1 A): one the runner could not set aside (a link,
  // a directory, an unreadable path, a deletion, a mode-only change, a refused file) stays in the tree and is named; its
  // edits block as before.
  'set-aside-kept': { stamps: false, cluster: true },
});

/**
 * WHICH REFUSED CLUSTERS ARE SET ASIDE for the full check (remediation-cluster-order.plan.md stage 1; design CO-D1 A,
 * CO-D2 A). Only a planned cluster ruled not committable, and only when every accepted file of it is a regular file the
 * node modified or created: its exact bytes can then be copied aside and written back. A cluster with a refused file, or a
 * file that is a link, a directory, a deletion or a mode-only change, is kept in the tree, with the reason. A planned cluster
 * never shares a file with another (planClusterCommits joins those), so setting one aside cannot move a committable file.
 * `kinds` is a Map from path to the runner's fact about the working tree: modified | new | deleted | link | directory |
 * unreadable | mode-only; a path it does not hold is unreadable (G-4 of 20261107-224233-si-remediation-review).
 */
// THE CLUSTERS A SET-ASIDE CONSIDERS, one predicate for both readers (G-5 of 20261107-224233-si-remediation-review):
// setAsidePlan repeated setAsideCandidates' filter inline, the drift G-7 of 20261107-220617-si-delivery removed once.
const setAsideConsidered = (c) => Boolean(c && !c.committable && (c.accepted ?? []).length);
const setAsideRefusedFile = (c) => (c.refused ?? []).length > 0;
/**
 * THE PATHS A SET-ASIDE CONSIDERS (G-7 of 20261107-220617-si-delivery): the accepted files of every cluster not committable
 * and with nothing refused, each once, the rule setAsidePlan applies. The runner batched their kinds with its own copy of
 * that filter, which could drift and leave a cluster unread. Pure.
 */
export function setAsideCandidates(clusters) {
  return [...new Set((clusters ?? []).filter((c) => setAsideConsidered(c) && !setAsideRefusedFile(c)).flatMap((c) => c.accepted))];
}

// THE KINDS, NOT A PATH CALLBACK (G-2 of 20261107-220617-si-delivery; I-2): `kinds` is a Map from path to the kind the
// runner read through pathState and HEAD; a path it does not hold is unreadable, decided here.
export function setAsidePlan(clusters, kinds) {
  if (!(kinds instanceof Map)) throw new TypeError('setAsidePlan: kinds must be a Map of path to kind, read through pathState');
  const kindOf = (p) => kinds.get(p) ?? 'unreadable';
  const aside = [];
  const kept = [];
  for (const c of clusters ?? []) {
    if (!setAsideConsidered(c)) continue;
    if (setAsideRefusedFile(c)) { kept.push({ id: c.id, why: `a file of it was refused (${c.refused.map((r) => r.path).join(', ')})` }); continue; }
    const files = c.accepted.map((p) => ({ path: p, kind: kindOf(p) }));
    const odd = files.filter((f) => f.kind !== 'modified' && f.kind !== 'new');
    if (odd.length) { kept.push({ id: c.id, why: odd.map((f) => `${f.path} is ${f.kind === 'mode-only' ? 'a mode-only change' : `a ${f.kind}`}`).join('; ') }); continue; }
    aside.push({ id: c.id, files });
  }
  return { aside, kept };
}

/**
 * WHAT A WRITE-BACK STILL HAS TO DO (stage 1's recovery): the manifest entries whose working-tree bytes do not hash to the
 * recorded post-node hash, read from each path's state in `states` (below). Repeating a write-back after it finished
 * finds nothing.
 */
// THE MODE TOO (G-3 of 20261107-203720-co-remediation-3-review): the state's `mode`, the file's permission bits, is
// compared with the entry's recorded `mode`, so bytes that match with a mode that does not are not taken as restored. An
// entry written before `mode` existed is judged by its bytes alone. (Callbacks no longer: G-4 of
// 20261107-224233-si-remediation-review.)
// PATHSTATE RESULTS, NOT PATH CALLBACKS (G-2 of 20261107-220617-si-delivery; I-2): `states` is a Map from path to the
// runner's pathState answer ({ kind, sha256, mode }); one answer per path, so the bytes and the mode come from one read. A
// path with no state, or one not a file, has no sha256 and is selected.
export function setAsideRestoreNeeded(entries, states) {
  if (!(states instanceof Map)) throw new TypeError('setAsideRestoreNeeded: states must be a Map of path to pathState results');
  return (entries ?? []).filter((e) => {
    const s = states.get(e.path);
    return !s || s.kind !== 'file' || s.sha256 !== e.sha256 || (Number.isInteger(e.mode) && s.mode !== e.mode);
  });
}

/**
 * WHETHER A SET-ASIDE ENTRY'S PATH HOLDS WHAT THE SET-ASIDE PUT THERE: absent for a new file, HEAD's blob and mode otherwise.
 * `state` is what was read at the path; `facts` is { blobs: Map of path to blob, modeChanged: Set of paths, headNow: Map of
 * path to the blob HEAD holds now }, git's answer over the entries being checked. In lib beside its sibling rules, as a rule
 * over values already read (G-2 of 20261108-222629-rts-delivery). Pure.
 * A MANIFEST WRITTEN BEFORE head_blob EXISTED IS HELD TO THE BLOB HEAD HOLDS NOW (G-3 of
 * 20261108-234028-rts-remediation-review-b): it was taken as at HEAD whatever the path held, so a later edit was replaced by
 * the stale copy and lost. A path matching HEAD's blob today is one git can give back, so writing over it loses nothing.
 */
export function setAsideAtHead(e, state, facts) {
  if (e.kind === 'new') return state.kind === 'absent';
  if (state.kind !== 'file') return false;
  const head = 'head_blob' in e ? e.head_blob : facts.headNow?.get(e.path);
  return Boolean(head) && facts.blobs.get(e.path) === head && !facts.modeChanged.has(e.path);
}

/**
 * WHICH STATE A WRITE-BACK MAY OVERWRITE (G-11 of 20261107-220617-si-delivery; G-4 of 20261107-191838-co-remediation-review):
 * the one the set-aside left (setAsideAtHead), or the exact bytes and mode an earlier failed write-back of this entry left,
 * `left` from setAsideWrittenState, whose mode null means the record kept none. Anything else is not the runner's. Pure.
 */
export function setAsideMayOverwrite(e, state, facts, left) {
  if (setAsideAtHead(e, state, facts)) return true;
  return Boolean(left && state.sha256 === left.sha256 && (left.mode === null || state.mode === left.mode));
}

/**
 * ONE ENTRY OF `git ls-tree -z HEAD -- <p>` (G-9 of 20261107-203720-co-remediation-3-review): the record naming exactly
 * `p`, as { mode, type, hash }, or null when none does. The parse sat inline in remediate.mjs's kindOfPath. Pure.
 */
export function lsTreeEntry(stdout, p) {
  return lsTreeEntries(stdout).get(p) ?? null;
}

/**
 * WHAT A REFUSED OR FAILED READ OF A SET-ASIDE PATH MEANS, by the confined owner's tag and never its prose (G-4 of
 * 20261107-220617-si-delivery); lib's so it is tested by calling it (G-15 of 20261108-032104-si-remediation-4-review).
 * A missing path or parent is absent, a link is a link, anything else unreadable with its code. Pure.
 */
export function pathReadFailure(err) {
  if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return { kind: 'absent' };
  if (err?.code === 'ECONFINED' && err.refusal === 'link') return { kind: 'link' };
  if (err?.code === 'ECONFINED' && err.refusal === 'not-a-directory') return { kind: 'absent' };
  return { kind: 'unreadable', why: err?.code ?? err?.message };
}

/**
 * EVERY ENTRY OF `git ls-tree -z` IN ONE PARSE (G-6 of 20261107-220617-si-delivery): a Map from path to { mode, type, hash },
 * so a caller asking about N paths parses the output once, not once per path. lsTreeEntry answers from it. Pure.
 */
export function lsTreeEntries(stdout) {
  const out = new Map();
  for (const l of String(stdout ?? '').split('\0')) {
    const m = l.match(/^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]*)$/);
    if (m && !out.has(m[4])) out.set(m[4], { mode: m[1], type: m[2], hash: m[3] });
  }
  return out;
}

/**
 * THE ONE READER OF A SET-ASIDE RECORD in run.json (G-5 of 20261107-191838-co-remediation-review): the folder and paths a
 * killed run left set aside, or null when nothing waits. Reads the current record (set_aside_dir beside an array of
 * per-path records; an empty array is a kill while copying) and the one 85f45c55 wrote (set_aside: { dir, entries }),
 * which the guard skipped, stranding a killed run's edits under evidence/. Pure.
 */
export function setAsideRecovery(run) {
  const { dir, entries } = setAsideRecord(run);
  if (!dir) return null;
  if (entries.length && entries.every((e) => e?.restored)) return null;
  // ONLY WHAT THIS PASS STILL HAS TO WRITE BACK (G-4 of 20261108-234028-rts-remediation-review-b): a path an earlier pass handed
  // back is skipped (setAsideRestoredPaths), and was printed as written back by this one.
  return { dir, paths: entries.filter((e) => !e?.restored).map((e) => e?.path) };
}

/**
 * THE PATHS AN EARLIER WRITE-BACK OF `dir` ALREADY HANDED BACK (G-5 of 20261108-222629-rts-delivery): their copies are gone or
 * going, and what is there now is the operator's, so a retried pass does not judge them again. Empty when the record is of
 * another folder. Read through the one decoding of the record. Pure.
 */
export function setAsideRestoredPaths(run, dir) {
  const r = setAsideRecord(run);
  return new Set(r.dir === dir ? r.entries.filter((e) => e?.path && e.restored).map((e) => e.path) : []);
}

/**
 * WHETHER `git diff --raw` REPORTS A MODE CHANGE (G-5 of 20261107-195640-co-remediation-2-review): its first record's
 * old and new modes differ. The parse sat inline in remediate.mjs, testable only end to end. Pure.
 */
export function rawDiffModeChanged(stdout) {
  const m = String(stdout ?? '').match(/^:(\d+) (\d+) /m);
  return !!m && m[1] !== m[2];
}

// The same answer over many paths, from one `git diff --raw --no-renames -z`: `:old new oldhash newhash status\0path\0` per
// path (G-1 of 20261108-060730-si-remediation-6-review-b). The set of paths whose mode differs.
export function rawDiffModeChangedPaths(stdout) {
  const parts = String(stdout ?? '').split('\0');
  const changed = new Set();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (rawDiffModeChanged(parts[i])) changed.add(parts[i + 1]);
  }
  return changed;
}

// The one decoding of both record shapes, for setAsideRecovery and setAsideWrittenBytes alike.
function setAsideRecord(run) {
  const r = run ?? {};
  if (typeof r.set_aside_dir === 'string' && r.set_aside_dir && Array.isArray(r.set_aside)) return { dir: r.set_aside_dir, entries: r.set_aside };
  if (r.set_aside && typeof r.set_aside === 'object' && !Array.isArray(r.set_aside) && typeof r.set_aside.dir === 'string' && r.set_aside.dir) {
    return { dir: r.set_aside.dir, entries: Array.isArray(r.set_aside.entries) ? r.set_aside.entries : [] };
  }
  return { dir: null, entries: [] };
}

/**
 * WHAT A FAILED WRITE-BACK LEFT, by path: the written_sha256 a write-back whose hash check failed recorded on its entry,
 * read through the same decoding as setAsideRecovery (G-7 of 20261107-195640-co-remediation-2-review: remediate.mjs read
 * the record itself and knew only the array shape). A Map of path to hash; empty when nothing was recorded. Pure.
 */
export function setAsideWrittenBytes(run) {
  return new Map([...setAsideWrittenState(run)].map(([p, s]) => [p, s.sha256]));
}

/**
 * The same record with the MODE that write left (G-13 of 20261108-021347-si-remediation-2-review): a retry may overwrite only
 * the exact state the runner wrote, so a chmod made since is not taken for the runner's. A Map of path to { sha256, mode },
 * mode null where the entry recorded none (a record written before written_mode existed). Pure.
 */
export function setAsideWrittenState(run) {
  return new Map(setAsideRecord(run).entries.filter((e) => e?.path && e.written_sha256)
    .map((e) => [e.path, { sha256: e.written_sha256, mode: Number.isInteger(e.written_mode) ? e.written_mode : null }]));
}

/**
 * WHAT THE NODE'S RUN LEFT IN THE TREE (remediation-left-in-tree.md; story-pipeline run 20261016-234106): every path git
 * lists as changed after the node that it did not list before the node started, and that no planned cluster accepts.
 * Judged on git's answer, not the node's report: a node that lost write access after writing its red test reported
 * nothing committable, and the untracked test stayed behind, named nowhere. Pure. Sorted, each path once.
 */
export function leftInTree({ before = [], after = [], accepted = [], caseInsensitive }) {
  const key = (p) => pathKey(p, { caseInsensitive });
  const known = new Set([...before, ...accepted].map(key));
  return [...new Set(after)].filter((p) => !known.has(key(p))).sort();
}
/**
 * WHICH REPORTED GROUPS MAY BE PLANNED (remediation-group-scope.md; G-3, G-4 of 20261010-200303-group-scope-r2). Pure.
 * Returns { plannable, checks: [{kind, message, group, disposition?, blocked_by?, file?, deferred?}] }:
 *   - a reported group the operator deferred is refused (`deferred-group`); one the review did not confirm,
 *     `unconfirmed-group`, decided before any overlap so the label says why — except a symptom whose root is confirmed
 *     (`symptoms`: { symptom: root }, followed by symptomRoot), which is judged as its root and planned only with it:
 *     its root reported (else `unconfirmed-group`, blocked_by the root) and not refused (else `shared-with-refused`);
 *   - REFUSAL SPREADS to a fixed point from every group not committed, whatever refused it: every group in its cluster,
 *     every group sharing a file with it, and every symptom whose root it is, is refused too (`shared-with-refused`).
 *     Commits are planned by file, cluster and symptom root, so anything less carries a refused change into a commit, or
 *     commits half a cluster;
 *   - a planned group whose file also holds a deferred finding (the reviewed run's finding locations,
 *     `deferredFindingFiles`: { id: [files] }) is NOTED at admission, before any commit (`deferred-file`, no stamp): a node following its brief never
 *     reports a deferred group, so this is the only overlap the runner can see (operator, 2026-10-10: "Note it, don't
 *     refuse (Recommended)").
 * Paths compare by the repository's case rule (core.ignorecase), with forward slashes (candidate-check-boundaries.plan.md
 * stage 1 and its amendment): one file in a repository git created case-insensitive, two in one it did not.
 */
export function admitGroups({ groups = [], confirmed = [], deferred = [], symptoms = {}, deferredFindingFiles = {}, evidence = null, contract = {}, caseInsensitive }) {
  const ci = caseFlag('admitGroups', caseInsensitive);
  const fold = (p) => pathKey(p, { caseInsensitive: ci });
  const deferredSet = new Set(deferred);
  const checks = [];
  // EVERY REPORTED GROUP that commitRefusal refuses seeds the spread — unconfirmed (G-1 of 20261010-204008-group-scope-r3),
  // deferred, and confirmed but reported not-fixed, declined, or partial with no files (r4 G-3; D2 = A): any of them may
  // have left edits in a file or cluster a fixed group shares. The reason is commitRefusal's, not a copy (G-1 of
  // 20261010-233649-commit-admission-review), and its fields travel with the entry (G-3 of that review).
  const why = {
    'unconfirmed-group': (r) => (r.blocked_by ? `is a symptom of ${r.blocked_by}, which was not reported with it` : 'is not confirmed in the reviewed run'),
    'deferred-group': () => 'was deferred by the operator',
    'not-committable': (r, g) => `was reported ${r.disposition ?? 'with no disposition'}${r.disposition === 'partial' && !(g.files ?? []).length ? ' with no files' : ''}`,
    'evidence-refused': (r) => `has no admissible red-before-green evidence (${r.why})`,
  };
  const refused = new Map();   // group_id -> commit_check entry
  const reported = groups.map((g) => g.group_id);
  for (const g of groups) {
    const r = commitRefusal(g, { confirmed, deferred, symptoms, reported, reportedGroups: groups, evidence, contract, caseInsensitive: ci });
    if (r) refused.set(g.group_id, { ...r, message: `${g.group_id} ${why[r.kind](r, g)}: its files are not committed` });
  }
  // A symptom and the root it is judged as are one cluster for the spread, symptom side (G-3 of
  // 20261015-013937-symptom-admission): a symptom in its own cluster was planned while its root was refused.
  // Who shares with whom is decided ONCE, each group's sharers kept in group order so a pass finds the same first refused
  // sharer groups.find did: re-deciding it inside every pass cost O(G³) comparisons on a reverse chain (G-7 of
  // 20261021-190234-ciss-d1-remediations-review).
  const roots = groups.map((g) => symptomRoot(g.group_id, { confirmed, symptoms }));
  const folded = groups.map((g) => new Set((g.files ?? []).map(fold)));
  // Each group's folded paths as an array ONCE (G-3 of 20261107-195640-co-remediation-2-review): the spread sat inside the
  // pairwise predicate and allocated a copy per pair.
  const foldedList = folded.map((s) => [...s]);
  const sharers = groups.map((a, i) => groups.filter((b, j) => (a.cluster && a.cluster === b.cluster)
    || roots[i] === b.group_id
    || foldedList[i].some((p) => folded[j].has(p))));
  for (let grew = true; grew;) {
    grew = false;
    for (const [i, g] of groups.entries()) {
      if (refused.has(g.group_id)) continue;
      const by = sharers[i].find((o) => refused.has(o.group_id));
      if (by) {
        const how = roots[i] === by.group_id ? 'is a symptom of' : 'shares a file or cluster with';
        refused.set(g.group_id, { kind: 'shared-with-refused', group: g.group_id, blocked_by: by.group_id,
          message: `${g.group_id} ${how} ${by.group_id}, which is not committed: its files are not committed` });
        grew = true;
      }
    }
  }
  for (const c of refused.values()) checks.push(c);
  const plannable = groups.filter((g) => !refused.has(g.group_id));
  const deferredAt = Object.entries(deferredFindingFiles).filter(([id]) => deferredSet.has(id));
  for (const g of plannable) {
    for (const p of g.files ?? []) {
      const holders = deferredAt.filter(([, files]) => (files ?? []).map(fold).includes(fold(p))).map(([id]) => id);
      if (holders.length) checks.push({ kind: 'deferred-file', group: g.group_id, file: p, deferred: holders, message: `${g.group_id} reports ${p}, which also holds ${holders.join(', ')}, deferred by the operator` });
    }
  }
  return { plannable, checks };
}

/**
 * WHY A --commit-trailer LINE IS REFUSED, or null (remediation-commit-recovery AC1; G-3, G-5 of
 * 20261011-005705-commit-recovery-r2: the rule lived in the orchestrator, and required a leading letter where the
 * request asks only for `Key: value`). One line; a key of letters, digits and dashes; a colon, a space, a value.
 */
export function trailerError(t) {
  if (typeof t !== 'string' || /[\r\n]/.test(t)) return 'it must be one line';
  if (!/^[A-Za-z0-9-]+: \S.*$/.test(t)) return 'it must be shaped "Key: value" (a key of letters, digits and dashes)';
  return null;
}

/**
 * IS THIS CLUSTER WAITING FOR A RETRY: not committed, and its last attempt was refused by git, a hook, the runner's full
 * check, or a tree that was not the candidate (a kind whose
 * COMMIT_CHECK_KINDS entry is `retryable`). Recorded as `pending_retry` on the cluster; a run written before that field
 * existed is read from the cluster's commit_check entries, so a run a consumer already holds can be retried.
 */
export function isPending(c, run) {
  if (!c || c.commit) return false;
  if (typeof c.pending_retry === 'boolean') return c.pending_retry;
  return (run?.commit_check ?? []).some((e) => e.cluster === c.id && COMMIT_CHECK_KINDS[e.kind]?.retryable);
}

/**
 * WHAT EACH PENDING CLUSTER IS ANNOUNCED WITH (G-1 of 20261017-210240-fmt-remediation-review): its recorded reason, since a
 * pending cluster is refused by git, a hook, or the runner's own full check, and the message blamed git or a hook for all
 * three. A fmt_check the candidate turned red adds the remedy, its files formatted before the retry, which would otherwise
 * be refused again. A cluster recorded with no reason (a run written before reasons were kept) keeps the old cause.
 * The remedy is read from the cluster's recorded `fmt_turned_red`, never parsed out of the reason text (G-3 of
 * 20261017-212703-fmt-remediation-2-review): the sentence is for the operator, and its wording owns no rule.
 */
export function pendingClusterLines(pending) {
  const lines = [];
  for (const c of pending ?? []) {
    const label = `cluster ${c.id} (${(c.groups ?? []).join(', ')})`;
    lines.push(`${label}: ${c.reason || 'refused by git or a hook'}`);
    if (c.fmt_turned_red === true) {
      lines.push(`  fmt_check passed before the node ran and fails on the candidate: format ${(c.accepted ?? []).join(', ') || 'its files'} `
        + 'with the project\'s formatter first, then retry.');
    }
  }
  return lines;
}

/**
 * WHY A REMEDIATION RUN HAS NOT ENDED, or null when it has (archive-run.mjs; story-pipeline, 2026-10-15): remediate.mjs
 * archives a run at the point it stops having anything left to do, and a run left staged before that existed is archived
 * on the same rule. Not ended: the node never reported or never ran, a cluster is pending for --retry-commits, or a
 * commit's sha was never recorded.
 */
export function remediationNotEnded(run) {
  return remediationEnd(run).why;
}

/**
 * THE SAME RULE, WITH WHAT IT FOUND (G-11 of 20261015-220413-archive-fold-review): remediate.mjs rebuilt the pending and
 * unrecorded conditions inline to print them, so the rule had two owners. Returns `{ why, pending, unrecorded }`: `why`
 * is remediationNotEnded's answer, and the two lists are the clusters it was decided from, for a caller that names them.
 */
/**
 * WHETHER A RUN'S EVIDENCE REFUSALS MAY BE RE-ADMITTED by --retry-commits --readmit-evidence (operator, 2026-11-03: "b",
 * on 20261103-163145-dr-remediation-3, whose every fixed group fell to an evidence rule loosened since). A retry otherwise
 * re-attempts only clusters a commit refused; a group the evidence gate refused was never planned, so nothing could pick
 * it up. Narrow on purpose: only a run that committed nothing and planned no cluster, and only groups its first run
 * recorded `evidence-refused` that the gate as it stands now admits. `nowChecks` is admitGroups' checks for the same
 * report and captures, judged now. Returns { why } when refused, else { readmitted }: the group ids the gate now admits.
 */
export function readmissionDecision({ run, nowChecks }) {
  if ((run?.remediation_commits ?? []).length) return { why: 'it committed a cluster already; re-admission is for a run that committed nothing' };
  if ((run?.clusters ?? []).length) return { why: 'it planned clusters; --retry-commits alone retries those' };
  const recorded = [...new Set((run?.commit_check ?? []).filter((c) => c?.kind === 'evidence-refused' && c.group).map((c) => c.group))];
  if (!recorded.length) return { why: 'its first run recorded no group refused by the evidence gate' };
  const still = new Set((nowChecks ?? []).filter((c) => c?.kind === 'evidence-refused' && c.group).map((c) => c.group));
  const readmitted = recorded.filter((id) => !still.has(id));
  if (!readmitted.length) return { why: `the evidence gate as it stands still refuses ${recorded.join(', ')}` };
  return { readmitted };
}

/**
 * WHAT A RETRY MAY TRUST IN THE EVIDENCE FOLDER (grounding-and-retry-evidence.plan.md stage 2; design GR-D2 A, operator
 * 2026-11-03: "15 a"). The first run's evidence gate records `evidence_record`: the hash of the node's report and of every
 * capture a group cites, 'absent' for one that was missing. Both retry paths compare it with the folder as it is now and
 * refuse on the first difference, so a report or capture added or swapped after the refusal cannot authorise a commit
 * (G-13 and G-14 of 20261103-211624-dr-remediation-4-review). A run with no record is refused: nothing says what was there.
 * `now` has the record's shape. Returns the reason, or null when they agree.
 */
export function evidenceRecordDifference(record, now) {
  if (!record || typeof record !== 'object' || typeof record.payload !== 'string' || !record.captures || typeof record.captures !== 'object' || Array.isArray(record.captures)) {
    // An array is not a capture map (G-9 of 20261104-171128-epo-remediation-3-review): [] read as no captures and passed.
    return 'the run has no evidence record from its first run, so what its report and captures held then is unknown';
  }
  if (now?.payload !== record.payload) return 'the report of the node (evidence/remediation/payload.json) changed since the first run read it';
  const then = Object.keys(record.captures).sort();
  const cited = Object.keys(now?.captures ?? {}).sort();
  const thenSet = new Set(then); // linear membership (G-10 of 20261104-171128-epo-remediation-3-review)
  const added = cited.filter((p) => !thenSet.has(p));
  if (added.length) return `${added.join(', ')} is cited now and was not when the first run read the evidence`;
  for (const p of then) {
    if (!(p in (now?.captures ?? {}))) return `${p} was cited when the first run read the evidence and is not now`;
    if (now.captures[p] !== record.captures[p]) return `${p} changed since the first run read it (${record.captures[p] === 'absent' ? 'it was missing then' : now.captures[p] === 'absent' ? 'it is missing now' : 'its content differs'})`;
  }
  // A REPAIR PASS'S GREENS (G-11 of 20261104-072059-epo-remediation-review): recorded when the pass is admitted, because
  // they admitted its files; a retry compares each as it compares a group's capture. A record with none has none.
  // A record with no repair_captures has none; one whose repair_captures is present and not an object is corrupted, and
  // is refused rather than read as none (G-8 of 20261104-082659-epo-remediation-2-review: it failed open).
  const rc = record.repair_captures;
  if (rc !== undefined && (rc === null || typeof rc !== 'object' || Array.isArray(rc))) {
    return `the evidence record's repair_captures is not an object (${JSON.stringify(rc)}), so which repair greens admitted files is unknown`;
  }
  const repair = rc ?? {};
  for (const p of Object.keys(repair).sort()) {
    const n = now?.repair_captures?.[p];
    if (n !== repair[p]) return `${p}, a repair pass's green, changed since the pass was admitted (${n === undefined || n === 'absent' ? 'it is missing now' : 'its content differs'})`;
  }
  return null;
}

export function remediationEnd(run) {
  const pending = (run?.clusters ?? []).filter((c) => isPending(c, run));
  const unrecorded = (run?.clusters ?? []).filter((c) => c.unrecorded);
  let why = null;
  if (!run?.remediation_state) why = 'its node has not run';
  else if (pending.length) why = `cluster(s) ${pending.map((c) => c.id).join(', ')} pending for --retry-commits`;
  else if (unrecorded.length) why = 'a commit was made with an unrecorded sha';
  return { why, pending, unrecorded };
}

/**
 * A RUN A LINK NAMES, FOUND BY NAME under the repository's run roots or else read where the link says (G-9 of
 * 20261015-220413-archive-fold-review): a link stores the path a run had when it was recorded, and a remediation is
 * archived after its follow-up names it staged. Whatever is found must BE the linked run — its run_id the link's
 * (`runId`), or, for a path with no recorded id, the path's own name — or a stale link counted the round cap against
 * another run. `readRun(dir)` returns a run.json object or null. Returns the run with `run_dir` where it was read, or null.
 * `admit(dir)`, when given, is used instead: it returns admitRun's result, and `run_dir` is the directory it ADMITTED, so
 * every later read of the run goes through what was checked (G-13/G-14 of 20261023-040306-rdt-remediation-2-review).
 */
// ADMISSION IS REQUIRED (run-dir-descendants.plan.md stage 3; G-19 of 20261024-122231-rdt-remediation-3-review): a
// branch that read each candidate's run.json without admitting it let a caller resolve a linked run no repository owned.
export function resolveLinkedRun({ dir, runId = null, roots = [], admit, join = (a, b) => `${a}/${b}`, basename }) {
  if (typeof admit !== 'function') throw new Error('resolveLinkedRun: admit is required; a linked run is admitted before it is read');
  if (!dir) return null;
  const name = basename(dir);
  // THE DOCSTRING'S RULE, AND THE ROOTS FIRST (G-14 of 20261015-230146-archive-fold-remediation-review): with no recorded
  // id the recorded path accepted any run, and it was probed before the run roots, so a stale or reused path stood in for
  // the linked run. Every place now requires the identity, and the recorded path is the last resort.
  const expected = runId ?? name;
  for (const at of [...roots.map((root) => join(root, name)), dir]) {
    const a = admit(at);
    if (a?.ok && a.record?.run_id === expected) return { ...a.record, run_dir: a.dir };
  }
  return null;
}

// THE STAMPS' NAMES, once (G-11 of 20261107-195640-co-remediation-2-review): remediate.mjs spelled each at every use.
export const COMMIT_CHECK_STAMP = 'COMMIT-CHECK';
export const REPORT_CHECK_STAMP = 'REPORT-CHECK';
export const commitCheckStamps = (entries) => (entries ?? []).some((e) => COMMIT_CHECK_KINDS[e?.kind]?.stamps !== false);

/**
 * WHETHER ANYTHING MAY BE COMMITTED AT ALL (G-10 of 20261009-011732-remediation-paths-r1), from structured facts rather
 * than by matching the prose of report_check. spawn-node exits 0 when its node ends BLOCKED or DEGRADED, so the node's
 * recorded state is read as well as the exit code; a report must exist and name this run; the confirmed set must be
 * known. Returns null when committing may proceed, else the commit_check entry that says why not.
 */
/**
 * The remediation node's limit, configurable on its own (remediation-verification.plan.md, stage 2; operator, 2026-10-13:
 * "Back to 30 after delivery and allow it to be configurable"): the roster's remediation entry `timeout_minutes` when it
 * declares one, else the contract's `review.node_timeout_minutes`, else that key's absent default (30, lib/check-timeout.mjs). A
 * value that is not a whole number of minutes, at least 1 and at most what a timer holds, is refused rather than guessed.
 */
export function remediationTimeoutMinutes(rosterEntry, review) {
  // Both through the owner of minutes values (code-index-d1-part-a.plan.md stage 2). The contract's fallback is held to
  // the remediation entry's whole-minute rule too (G-22 of 20261021-162807-ciss-d1-review: 0.5 was a 30-second limit).
  // A declared roster value wins without consulting the contract, as before.
  if (rosterEntry?.timeout_minutes !== undefined) return minutes('roster.remediation.timeout_minutes', rosterEntry.timeout_minutes);
  const node = minutes('review.node_timeout_minutes', review?.node_timeout_minutes);
  if (!Number.isInteger(node)) {
    throw new Error(`review.node_timeout_minutes is the remediation node's limit here and must be a whole number of minutes, not ${JSON.stringify(review?.node_timeout_minutes)}`);
  }
  return node;
}

/**
 * WHY A REPAIR PASS'S REPORT CANNOT BE ACTED ON (remediation-repair-pass.plan.md stage 1): [] when it can. The pass was
 * given `failing` ({ name, file } each, from the full check's log), the run's committable clusters' ids, and its number;
 * its report answers each failing test exactly once, in one of those clusters, and a `fixed` answer carries its green.
 * Whether that green is a test_one capture of the test's file, and whether the files it lists may join the cluster, the
 * runner decides from git and the capture headers (repairFileAdmission below).
 */
/**
 * The failing tests as the repair brief lists them (its `failing` slot): each test's name on a line of its own, labelled
 * `test_name:`, and its file on the next, labelled `test_file:`. The node's answer copies the name line's value exactly,
 * which repairReportErrors matches. One line carrying both read as one name (case 3 of the repair-pass bench,
 * 20261030-191916-ciss-remaining-remediation: the node copied "<name> (<file>)" and the pass was refused).
 */
export function repairFailingLines(failing = []) {
  return failing.map((t) => `- test_name: ${t.name}\n  test_file: ${t.file ?? 'not named in the log'}`).join('\n');
}

export function repairReportErrors(payload, { runId, pass, clusterIds = [], failing = [], caseInsensitive } = {}) {
  // The case rule is the caller's, as every reader's here (G-9 of 20261104-072059-epo-remediation-review): no default.
  caseFlag('repairReportErrors', caseInsensitive);
  if (!payload || typeof payload !== 'object') return ['the repair pass returned no report'];
  const errors = [];
  // The answer's test_file is bound to the file the log named (G-8 of 20261102-024315-rrp-delivery): it may be left null,
  // never changed.
  const fileKey = (p) => pathKey(String(p).split('\\').join('/'), { caseInsensitive });
  if (payload.run_id !== runId) errors.push(`the report names run ${payload.run_id}, not ${runId}`);
  if (payload.pass !== pass) errors.push(`the report is pass ${payload.pass}, not ${pass}`);
  const known = new Set(clusterIds);
  // A failing test is its name AND the file the log named (G-5 of 20261102-044855-rrp-remediation-2-review): two of one
  // name in two files are two tests, each answered once, the answer's test_file saying which (logFileOf).
  const id = (n, file) => `${n}\0${file ? fileKey(file) : ''}`;
  const seen = new Set();
  for (const f of Array.isArray(payload.failures) ? payload.failures : []) {
    const n = f?.test_name;
    const at = logFileOf(failing, f, fileKey);
    if (!at.listed) errors.push(`${n}: reported, but not among the failing tests`);
    else if (at.error) errors.push(`${n}: ${at.error}`);
    const k = id(n, at.file);
    if (seen.has(k)) errors.push(`${n}: reported twice`);
    seen.add(k);
    if (!known.has(f?.cluster)) errors.push(`${n}: cluster ${f?.cluster} is not one of this run's clusters (${[...known].join(', ') || 'none'})`);
    if (f?.disposition === 'fixed' && !f?.green_evidence) errors.push(`${n}: fixed with no green_evidence`);
  }
  for (const t of failing) if (!seen.has(id(t.name, t.file))) errors.push(`${t.name}: failing, not reported${t.file ? ` (${t.file})` : ''}`);
  return errors;
}

// Which failing test an answer is (`f`, one of the report's failures), and the file the log named for it: with one test
// of that name, its file, the answer's test_file left null or the same; with several (one name in several files), the
// one whose file the answer's test_file names, required. Returns { listed, file, error }.
function logFileOf(failing, f, fileKey) {
  const entries = failing.filter((t) => t.name === f?.test_name);
  if (!entries.length) return { listed: false, file: null, error: null };
  if (entries.length === 1) {
    const named = entries[0].file ?? null;
    const error = named && f?.test_file && fileKey(f.test_file) !== fileKey(named) ? `test_file ${f.test_file}, but the failing log names ${named}` : null;
    return { listed: true, file: named, error };
  }
  const hit = f?.test_file ? entries.find((t) => t.file && fileKey(t.file) === fileKey(f.test_file)) : null;
  return hit ? { listed: true, file: hit.file, error: null }
    : { listed: true, file: null, ambiguous: true, error: `test_file ${f?.test_file ?? 'null'}, but the failing log names this test in ${entries.map((t) => t.file ?? 'no file').join(', ')}: name which` };
}

/**
 * EACH FIXED ANSWER'S GREEN (remediation-repair-pass.plan.md stage 2): a passing test_one capture, read from capture's own
 * header (`facts`, by path), named as THIS pass's capture (evidence/remediation/repair<pass>-..., no `..` segment), of
 * the file the failing log named for that test (`failing`, the runner's own reading), never the report's test_file; only
 * where the log named none is the report's test_file used, and then it is required. G-13 of 20261102-024315-rrp-delivery:
 * the folder alone was checked and test_file null skipped the file check, so any passing capture was a green. Pure.
 */
export function repairGreenErrors(fixed = [], facts = {}, { pass, failing = [], caseInsensitive } = {}) {
  caseFlag('repairGreenErrors', caseInsensitive); // G-10 of 20261104-072059-epo-remediation-review: no default
  const key = (p) => pathKey(String(p ?? ''), { caseInsensitive });
  const fileKey = (p) => pathKey(String(p).split('\\').join('/'), { caseInsensitive });
  // The log's file for this answer's test, as repairReportErrors reads it (G-5 of 20261102-044855-rrp-remediation-2-review).
  // One name in several files that the answer does not tell apart has no file, '' and never the answer's own test_file.
  const logFile = { get: (n, f) => { const at = logFileOf(failing, { ...f, test_name: n }, fileKey); return !at.listed ? null : at.ambiguous ? '' : at.file; } };
  const errors = [];
  for (const f of fixed) {
    const c = facts[f.green_evidence];
    // NORMAL FORMS ONLY (evidence-path-owner.plan.md stage 2): the runner normalized the answer's green at the read of the
    // repair report (normalizeEvidenceFields), so this reader splits the one form the owner gives and no spelling.
    const segs = String(f.green_evidence ?? '').split('/');
    const ownCapture = segs.length === 3 && segs[0] === 'evidence' && segs[1] === 'remediation'
      && segs[2].startsWith(`repair${pass}-`) && !segs[2].includes('..');
    const file = logFile.get(f.test_name, f) ?? f.test_file ?? null;
    if (!ownCapture || !file || !c || c.admitted !== 'test_one' || c.outcome !== 'passed' || key(c.file) !== key(file)) {
      errors.push(`${f.test_name}: green_evidence ${f.green_evidence} is not a passing test_one capture of ${file ?? 'its test file'}, named repair${pass}-… in evidence/remediation/`);
    }
  }
  return errors;
}

/**
 * HOW MANY REPAIR PASSES (remediation-repair-pass.plan.md stage 2, R2): the roster's remediation entry `repair_passes`,
 * a whole number of passes after a full check refuses on failing tests, 0 for none, the passes ending at the first green.
 * Absent is REPAIR_PASSES_DEFAULT, 3 since the operator decided RP-D2 on stage 4's measurement (2026-11-03: "B", until
 * green up to a cap of 3). Anything else refuses rather than guessed.
 */
export const REPAIR_PASSES_DEFAULT = 3;
export function repairPassCap(rosterEntry) {
  if (rosterEntry?.repair_passes === undefined) return REPAIR_PASSES_DEFAULT;
  const v = rosterEntry.repair_passes;
  if (!Number.isInteger(v) || v < 0) throw new Error(`roster.remediation.repair_passes must be a whole number of passes, 0 for none, not ${JSON.stringify(v)}`);
  return v;
}

/**
 * WHERE A REPAIR PASS'S FILES GO (remediation-repair-pass.plan.md stage 2): every file an answer lists, by the same file
 * rule the planner applies to a first pass (clusterFileRule). A file a cluster already accepts stays in that cluster; a
 * new one joins the cluster its answer names, once. `changed`: every path the pass changed (git's answer before and after
 * it, by content); one listed in no answer is `unlisted`, and the runner refuses the pass for it, as for a refused file.
 * Returns { additions: { clusterId: [paths] }, refused: [{ path, reason }], unlisted: [paths] }. Pure.
 */
export function repairFileAdmission({ failures = [], clusters = [], changed = [], status, dirtyAtStart = [], refusedAtStart = [], contract = {}, caseInsensitive }) {
  const ci = caseFlag('repairFileAdmission', caseInsensitive);
  const key = (p) => pathKey(p, { caseInsensitive: ci });
  const rule = clusterFileRule({ status, dirtyAtStart, refusedAtStart, contract, caseInsensitive: ci });
  const holder = new Map();
  for (const c of clusters) for (const p of c.accepted ?? []) holder.set(key(p), c.id);
  const listed = new Set();
  const additions = {};
  const refused = [];
  for (const f of failures) {
    for (const reported of f?.files ?? []) {
      const { path: p, reason } = rule(reported);
      listed.add(key(p));
      const held = holder.get(key(p));
      if (held !== undefined) {
        if (held !== f.cluster && !(additions[held] ?? []).some((q) => key(q) === key(p))) continue;
        if (held !== f.cluster) refused.push({ path: p, reason: `answers name it for clusters ${held} and ${f.cluster}` });
        continue;
      }
      if (reason) { refused.push({ path: p, reason }); continue; }
      (additions[f.cluster] ??= []).push(p);
      holder.set(key(p), f.cluster);
    }
  }
  const unlisted = [...new Set(changed)].filter((p) => !listed.has(key(p))).sort();
  return { additions, refused, unlisted };
}

export function commitGate({ exitStatus, nodeState, confirmedKnown, payloadRunId, runId }) {
  if (exitStatus !== 0 || nodeState !== 'OK') {
    return { cluster: null, kind: 'node-failed', message: `the node did not finish OK (spawn-node exited ${exitStatus}, state ${nodeState ?? 'unknown'}): nothing is committed; its changes are left in the working tree` };
  }
  if (payloadRunId === undefined || payloadRunId === null) return { cluster: null, kind: 'report-mismatch', message: 'the node returned no report: nothing is committed' };
  if (payloadRunId !== runId) return { cluster: null, kind: 'report-mismatch', message: `the report names run ${payloadRunId}, not ${runId}: nothing is committed` };
  if (!confirmedKnown) return { cluster: null, kind: 'confirmed-unknown', message: 'the confirmed set is unknown: nothing is committed' };
  return null;
}

/**
 * THE RUNNER'S OWN FOLDER in a remediation run (remediation-run-ownership D1): `evidence/remediation-runner/` under
 * `runDir`. A part that is absolute or climbs out with `..` is refused, so a call's form constrains its arguments too.
 */
export function runnerPathIn(runDir, ...parts) {
  for (const p of parts) {
    if (path.isAbsolute(String(p)) || String(p).split(/[\\/]/).includes('..')) throw new Error(`runnerPath: ${p} would leave the runner's folder`);
  }
  return path.join(runDir, 'evidence', 'remediation-runner', ...parts);
}
/**
 * A NODE'S STOP REASON, CHECKED AGAINST ITS OWN RECORD (remediation-consumer-findings.plan.md stage 4; request AC1, AC2).
 * Two nodes reported groups "not reached" because "the 30-minute limit was spent" at 6.8 and 8.9 minutes, `completed`
 * (20261020-104558, story-pipeline's 20261020-103911). A group the node stopped short on (not-fixed, partial) names why
 * in `stop_reason` (`not-attempted` only for not-fixed); a `limit` claim is held to the record:
 *   session-time  contradicted when the session completed (terminal_reason) under its cap (duration_ms, timeout_minutes);
 *   turns         contradicted unless the runtime ended it on its own turn limit (subtype error_max_turns): quorate
 *                 declares none (amended AC2, operator 2026-10-21);
 *   budget        contradicted when the node budget is uncapped, or the cost is under it.
 * A field set where it does not apply is named too: a stop_reason on a fixed or declined group, a limit_kind without
 * `limit`, a stop_cause without `blocked`.
 * `record`: { duration_ms, timeout_minutes, terminal_reason, subtype, total_cost_usd }; `budgetUsd`: the per-node cap,
 * or null when uncapped. Returns report-check lines, one per problem; it refuses nothing.
 */
export function stopReasonChecks(groups, record = {}, { budgetUsd = null } = {}) {
  const out = [];
  const minutes = (ms) => Math.round(Number(ms) / 6000) / 10;
  for (const g of groups ?? []) {
    const id = g?.group_id;
    // Each field is null where it does not apply (schema-fields.json), fixed and declined groups included (G-2 of
    // 20261021-024001-rcf-remediation-2-review).
    if (g?.limit_kind != null && g.stop_reason !== 'limit') out.push(`${id}: limit_kind ${g.limit_kind} without stop_reason limit`);
    if (g?.stop_cause != null && g.stop_reason !== 'blocked') out.push(`${id}: stop_cause without stop_reason blocked`);
    // A declaration of no red beside a red is a contradiction (stage 2): the red decides, and the report says so.
    if (g?.red_evidence && noRedReason(g)) out.push(`${id}: a red and a no_red declaration; a group with a red declares none`);
    if (g?.disposition !== 'not-fixed' && g?.disposition !== 'partial') {
      if (g?.stop_reason != null) out.push(`${id}: ${g.disposition} with stop_reason ${g.stop_reason}; a group fixed or declined takes none`);
      continue;
    }
    if (!g.stop_reason) { out.push(`${id}: ${g.disposition} with no stop_reason`); continue; }
    // not-attempted means never reached, which a partly fixed group was not (G-6 of 20261021-014056-rcf-delivery).
    if (g.stop_reason === 'not-attempted' && g.disposition === 'partial') out.push(`${id}: partial with stop_reason not-attempted; a group never reached is not-fixed`);
    if (g.stop_reason === 'blocked' && !String(g.stop_cause ?? '').trim()) out.push(`${id}: blocked with no stop_cause`);
    if (g.stop_reason !== 'limit') continue;
    const kind = g.limit_kind;
    if (!kind) { out.push(`${id}: limit with no limit_kind`); continue; }
    if (kind === 'session-time') {
      const cap = Number(record.timeout_minutes);
      if (record.terminal_reason === 'completed' && Number.isFinite(cap) && Number(record.duration_ms) < cap * 60_000) {
        out.push(`${id}: claims the session-time limit, but the node ran ${minutes(record.duration_ms)} of ${cap} minute(s) and completed`);
      }
    } else if (kind === 'turns') {
      if (record.subtype !== 'error_max_turns') out.push(`${id}: claims the turns limit, but the runtime did not end the session on one (subtype ${record.subtype ?? 'unknown'})`);
    } else if (kind === 'budget') {
      if (budgetUsd === null) out.push(`${id}: claims the budget limit, but the node budget is uncapped`);
      else if (!(Number(record.total_cost_usd) >= budgetUsd)) out.push(`${id}: claims the budget limit, but the node spent $${record.total_cost_usd} of $${budgetUsd}`);
    } else out.push(`${id}: limit_kind ${kind} is not one of session-time, turns, budget`);
  }
  return out;
}

/**
 * THE TREE GUARD'S REFUSAL (remediation-consumer-findings.plan.md stage 5, AC4). `guard`: [{ path, why }]; `owned`: Map of
 * path -> { id, groups } for the files of clusters THIS run refused because they change no source file. The text is
 * unchanged unless a blocker is one of those, and then it names the cluster as the cause and the way on: a test-only
 * cluster's edit blocked every other cluster as a change outside its candidate, and the message said only "commit, stash
 * or discard them" (20261020-164157; story-pipeline's report).
 */
export function treeGuardMessage(guard, owned = new Map()) {
  const base = `the working tree holds changes the checks would read and no commit carries: ${
    guard.map((r) => `${r.path} (${r.why})`).join('; ')}; commit, stash or discard them, then --retry-commits — and when the fix `
    + 'needs them, this run cannot commit it: discard its clusters\' edits and mint a new remediation run (plan stage 4)';
  const own = guard.filter((r) => owned.has(r.path));
  if (!own.length) return base;
  return `${base}. ${own.map((r) => { const c = owned.get(r.path); return `${r.path} is in cluster ${c.id} (${(c.groups ?? []).join(', ')}), which this run refused because it changes no source file`; }).join('; ')}: inspect it, then commit or discard it, then run --retry-commits`;
}
