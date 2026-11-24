// run-artifacts.mjs — read what a finished run recorded, from its VALIDATED artifacts.
//
// One owner, because there are now two benchmarks reading the same run directory:
// `bench-lenses.mjs` scores detection and the barrier, and `bench-second-opinion.mjs` scores the
// audit OF the barrier. A second hand-rolled reader would be free to disagree with this one about
// what a run says — which is the drift this repository has already paid for wherever a fact had
// two owners.
//
// Not pure, unlike the rest of lib/: it reads a directory. The DECISIONS taken on what it returns
// stay in bench-scoring.mjs and second-opinion-scoring.mjs, which are.

import { requireIo } from './io-param.mjs';
import { statusIsReview } from './decisions.mjs';
import { redactClaim } from './redact.mjs';
import { confined } from './confined-path.mjs';
import { readRunJson } from './reviews-root.mjs';

// NO node:fs HERE (os-platform-adapters stage 3c): the filesystem arrives as `io`, or through the
// readers these functions already accepted. scripts/io/run-artifacts.mjs binds it to the host.

// ---------------------------------------------------------------- the one strict reader (2a)
// ONE READER FOR A RUN'S FILES (ledger-trust-boundaries, 2a). The fold, the barrier's two readers and the
// benchmarks each parsed verdict.kept.json and the status files themselves, and each fix validated one more
// shape in one of them: an OK status without a count (G-9 of ltr-review-r3), a verdict of the wrong shape
// (G-8 of r4), a top-level list (its correction), a verdict reached through a link (G-5 of r5). Each reader
// below REFUSES by name and returns a classified result; what a refusal means stays with the caller — the fold
// stops, the barrier marks the node, the benchmarks record it.

const refuse = (why, extra = {}) => ({ ok: false, why, ...extra });

// THROUGH THE OWNER (run-dir-reads.plan.md stage 3, R-D2 A and R-D3 A). Every read here went to a joined path and was
// then checked by REAL path, so a link resolving back inside the run was followed, and what it resolves to can change.
// A run is now read through `confined`: each level below the run lstat'ed, a link or junction at any level refused,
// whatever it leads to, as A-30 says for every other read and write below a run. A caller passes the owner of the run
// it admitted, or the admitted directory itself, and the owner is rooted there.
const ownerOf = (run, io) => (typeof run === 'string' ? confined({ root: run, io }) : run);

// A refusal names the file RELATIVE to the run directory, and never where a link leads: the reasons travel into
// benchmark result files, which are tracked, and an absolute path there publishes a home directory. So an error from the
// owner is reduced to its kind: its message names the absolute path it stopped at.
const LINKED = 'is reached through a link or junction, and nothing below a run is followed through one (it could lead outside the run)';
//   'absent'  — nothing there (ENOENT)
//   otherwise — a reason to refuse: a link at some level, a level that is not a directory, unreadable
function whyNot(e) {
  if (e?.code === 'ENOENT') return 'absent';
  if (e?.code === 'ECONFINED') {
    // BY THE OWNER'S TAG, not its prose (G-7 of 20261107-224233-si-remediation-review).
    if (e.refusal === 'link') return LINKED;
    if (e.refusal === 'not-a-directory') return 'is not reachable: a level above it is not a directory';
    if (e.refusal === 'not-a-file') return 'is not a file';
    // The egress owner's refusals (G-8 of 20261121-001829-prc-remediation-review), for a caller that reads through it.
    if (e.refusal === 'hard-link') return 'has a second name (a hard link), so what it holds may come from outside the run';
    if (e.refusal === 'too-large') return 'is over the bound on a file that leaves the machine';
    return 'is refused below the run';
  }
  return `is unreadable (${e?.code ?? 'read error'})`;
}

function readJson(owner, segments, { parse = null } = {}) {
  const name = segments.join('/');
  // AN ERROR'S MESSAGE IS NOT A SAFE REASON (G-11a of 20260929-145942-ssr-review-r2): a filesystem error names the
  // absolute path it failed on, and a parse error quotes the text it failed on — run.json holds absolute paths. The
  // reason keeps the error's kind, or where the text stopped parsing, and nothing the file or the disk said.
  // A READER THAT READS AND PARSES IN ONE (G-9 of 20261124-170802-gsw-remediation-3-review-b): run.json's bound is
  // readRunJson's, its one owner, so readRunRecord passes it rather than restating the bound here. Its EFBIG message
  // names the bound and nothing of the file.
  if (parse) {
    try { return { ok: true, value: parse(owner, segments) }; } catch (e) {
      if (e?.code === 'EFBIG') return refuse(`${name} is ${e.message}`);
      if (e instanceof SyntaxError) {
        const at = /position (\d+)/.exec(String(e?.message))?.[1];
        return refuse(`${name} is not valid JSON${at ? ` (at position ${at})` : ''}`);
      }
      const why = whyNot(e);
      return why === 'absent' ? refuse(`${name} does not exist`, { missing: true }) : refuse(`${name} ${why}`);
    }
  }
  let text;
  try { text = owner.read(segments); } catch (e) {
    const why = whyNot(e);
    return why === 'absent' ? refuse(`${name} does not exist`, { missing: true }) : refuse(`${name} ${why}`);
  }
  try { return { ok: true, value: JSON.parse(text) }; } catch (e) {
    const at = /position (\d+)/.exec(String(e?.message))?.[1];
    return refuse(`${name} is not valid JSON${at ? ` (at position ${at})` : ''}`);
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** evidence/<node>/verdict.kept.json: an object whose `findings` is present and is a list of objects. */
export function readKeptVerdict(run, nodeId, { io } = {}) {
  requireIo(io, 'readKeptVerdict');
  const segs = ['evidence', nodeId, 'verdict.kept.json'];
  const r = readJson(ownerOf(run, io), segs);
  if (!r.ok) return r;
  const v = r.value;
  if (!isObject(v)) return refuse(`${segs.join('/')} is not a kept verdict (not an object)`);
  // A LIST, PRESENT (G-14 of 20260928-221454-ltb-review): a missing `findings` was read as an empty list and
  // accepted, so a verdict that never said what it found read as one that found nothing. Both writers
  // (spawn-node, the barrier's arms) always write it.
  const findings = v.findings;
  if (!Array.isArray(findings) || findings.some((f) => !isObject(f))) {
    return refuse(`${segs.join('/')} is not a kept verdict (findings must be a list of objects)`);
  }
  return { ok: true, verdict: { ...v, findings } };
}

/** nodes/<node>.status.json: an object; a review node's OK status carries a non-negative integer findings_count (a judge's carries none). */
export function readNodeStatus(run, nodeId, { io } = {}) {
  requireIo(io, 'readNodeStatus');
  const segs = ['nodes', `${nodeId}.status.json`];
  const r = readJson(ownerOf(run, io), segs);
  if (!r.ok) return r;
  const s = r.value;
  if (!isObject(s)) return refuse(`${segs.join('/')} is not a node status (not an object)`);
  // A REVIEW node's OK status must carry its count; a judge's (adjudication, tie-break) produces no findings and
  // carries none. Requiring it of every node refused each run with an adjudication — measured on 6 of the 175
  // preserved runs — and the fold had refused them since 5b381a2. statusIsReview is the one owner of that line.
  if (s.state === 'OK' && statusIsReview(s) && !(Number.isInteger(s.findings_count) && s.findings_count >= 0)) {
    return refuse(`${segs.join('/')} reports OK with no valid findings_count (a non-negative integer)`);
  }
  return { ok: true, status: s };
}

/** run.json: the run's record. Its absence is a refusal — a directory with no record is not a run. */
export function readRunRecord(run, { io } = {}) {
  requireIo(io, 'readRunRecord');
  // Held to admitRun's bound (G-3 of 20261124-160743-gsw-remediation-2-review-b), through its one owner (G-9 of
  // 20261124-170802-gsw-remediation-3-review-b).
  const r = readJson(ownerOf(run, io), ['run.json'], { parse: readRunJson });
  if (!r.ok) return r;
  if (!isObject(r.value)) return refuse('run.json is not a run record (not an object)');
  // A RECORD NAMES ITS RUN (G-9 of 20260929-124952-ssr-review): an empty or unrelated object authorised the directory
  // as a run with no identity to score it under. Every saved run carries one (179 of 179, measured 2026-09-29).
  if (typeof r.value.run_id !== 'string' || !r.value.run_id) return refuse('run.json names no run_id');
  return { ok: true, record: r.value };
}

// ---------------------------------------------------------------- read findings out of a run
// Kept findings are the validated artifact (evidence/<node>/verdict.kept.json); reports are
// rendered prose and are never parsed — same rule as reconcile: a report with no validated
// artifact behind it is precisely what must not be trusted.

/**
 * A run that cannot be scored AT ALL, because its own record was refused (secret-shapes-and-refusals, 2a). THROWN,
 * not returned: a refusal recorded in a map is one every caller must remember to read, and none did (G-4 of
 * 20260929-010407-ltb-review-r4 — a run with no run.json scored as zero findings). A node's refusal is different: the
 * rest of the run still scores, and the refusal travels in `refused` into the caller's result file.
 */
export class RunRefused extends Error {
  constructor(why) {
    super(`run.json refused — ${why}; the run is not scored`);
    this.name = 'RunRefused';
    this.why = why;
  }
}

// The gate variant counts SCOPE findings in findings_count and writes no kept verdict (spawn-node, schemaVariant
// 'gate'); it is spawned before a run, not in one, and is never held to a kept count.
const keepsFindings = (st) => st?.state === 'OK' && statusIsReview(st) && st.mode !== 'gate';

/**
 * WHAT THE BARRIER DECIDED, WHOLE (ledger-identity plan, stage 5): finding-groups.json and the merged reconcile payload,
 * through the one strict reader. Extracted from collectRun, which kept only a decision per payload row and an anchor per
 * group — the ledger's fold needs each group's member findings and the payload's severity. Absent is `null` with no
 * refusal; anything else that is not an object holding a list of groups — unreadable, malformed, reached through a link
 * out of the run — is refused under its path and returned as `null`.
 */
export function readReconcileArtifacts(run, { io } = {}) {
  requireIo(io, 'readReconcileArtifacts');
  const owner = ownerOf(run, io);
  const refused = {};
  const artifact = (...parts) => {
    const name = parts.join('/');
    const r = readJson(owner, parts);
    // A present artifact whose `groups` is not a list is malformed, not absent (G-15 of 20260929-124952-ssr-review):
    // it read as an empty decision set, and a corrupted barrier output scored as one that never reported.
    if (r.ok) {
      if (isObject(r.value) && Array.isArray(r.value.groups)) return r.value;
      refused[name] = `${name} is not an object holding a list of groups`;
    } else if (!r.missing) refused[name] = r.why;
    return null;
  };
  return { payload: artifact('evidence', 'reconcile', 'payload.json'), groups: artifact('finding-groups.json'), refused };
}

/**
 * THE CONFIRMED SET OF A RECONCILED RUN, ONE OWNER (pr-review-comments.md AC2): the groups of its reconcile payload whose
 * `decision` is `confirmed`, in the payload's order. new-run's `--remediates`, remediate.mjs and pr-comments.mjs each
 * filtered the payload themselves; three filters of one set can come to disagree. `payload` is readReconcileArtifacts'
 * `payload` (an object holding a list of groups) or null, which confirms nothing. Pure.
 */
export const confirmedGroups = (payload) => (Array.isArray(payload?.groups) ? payload.groups : [])
  .filter((g) => g && typeof g === 'object' && g.decision === 'confirmed');
export const confirmedGroupIds = (payload) => confirmedGroups(payload).map((g) => g.group_id);

export function collectRun(run, { io } = {}) {
  requireIo(io, 'collectRun');
  const owner = ownerOf(run, io);
  const findingsByNode = {};
  const costsByNode = {};
  const usageByNode = {};
  const turnsByNode = {};
  const durationsByNode = {};
  const configByNode = {};
  // A REFUSED verdict is named here, not dropped (2a): a malformed one used to score as a node with no entry at
  // all, which a benchmark cannot tell from a node that found nothing.
  const refused = {};
  // And the run's own record: a directory with no readable run.json is not a run, and cannot be scored as one
  // (G-17 of 20260928-232013-ltb-review-r2; G-4 of ltb-review-r4, which is why this throws).
  const record = readRunRecord(owner, { io });
  if (!record.ok) throw new RunRefused(record.why);
  // Each status is read ONCE, here, and kept for the verdicts below (G-9 of ltb-review-r3: they were parsed twice).
  const statuses = new Map();
  // A DIRECTORY IS LISTED ONLY INSIDE THE RUN (G-11 of 20260929-124952-ssr-review): each file was checked, but the
  // listing came first, so a nodes/ or evidence/ junction leading out of the run put outside file names into
  // refusal keys and on into benchmark results. A directory that leads out is refused whole, unlisted.
  // And one that cannot be LISTED — a file where a directory belongs — is refused too, rather than thrown out of
  // collectRun (G-12 of 20260929-145942-ssr-review-r2): the listing is the directory's own read, and it refuses like
  // every other read here. Absent is still absent: [].
  // Presence through the one owner above (G-12 of ssr-review-r3; G-11 of ssr-review-r4): only absence is absent, and
  // an unreadable directory or a link leading nowhere is refused, never read as empty.
  // Through the owner (run-dir-reads stage 3): a directory reached through a link at any level is refused whole, and a
  // file standing where the directory belongs is refused as one that cannot be listed.
  const list = (name, opts) => {
    try { return owner.list([name], opts); } catch (e) {
      const why = whyNot(e);
      if (why === 'absent') return [];
      refused[name] = e?.code === 'ECONFINED' && e.refusal === 'not-a-directory'
        ? `${name}/ cannot be listed (not a directory); nothing in it is read`
        : `${name}/ ${why}; nothing in it is read`;
      return [];
    }
  };
  {
    for (const f of list('nodes').filter((f) => f.endsWith('.status.json'))) {
      // THROUGH THE ONE READER TOO (G-17 of 20260928-221454-ltb-review): the statuses were parsed here directly and
      // an unreadable one was ignored, so half of collectRun stayed outside the strict reader the plan made it.
      const id = f.slice(0, -'.status.json'.length);
      const read = readNodeStatus(owner, id, { io });
      if (!read.ok) { refused[`status:${id}`] = read.why; continue; }
      // ONE IDENTITY PER NODE (G-7 of ltb-review-r4): eligibility was keyed by the file name and spend by the
      // embedded node_id, so a misnamed status could authorise one node's verdict and bill another. A status that
      // disagrees with its own file name is refused, and every map below is keyed by the one id.
      if (read.status.node_id !== id) {
        // Said without echoing what the file claims to be (G-13 of 20260929-162936-ssr-review-r3): the embedded
        // node_id is the untrusted value, and it could be an absolute path.
        refused[`status:${id}`] = `nodes/${id}.status.json records a node_id other than "${id}"`;
        continue;
      }
      statuses.set(id, read.status);
      {
        const s = read.status;
        if (typeof s.total_cost_usd === 'number') costsByNode[id] = s.total_cost_usd;
        // Tokens beside dollars. The operator's quota is a token window, so a result file that
        // totals only USD cannot answer the question actually being asked of it.
        if (s.usage && typeof s.usage === 'object') usageByNode[id] = s.usage;
        // Turns and the effective model/effort travel into the artifact: recall-per-dollar and
        // the effort comparison were the harness's stated purpose, and both quantities were
        // measured, held in memory, and dropped before the write (G-6, G-7, G-8).
        if (typeof s.num_turns === 'number') turnsByNode[id] = s.num_turns;
        // WALL CLOCK, for the same reason tokens travel beside dollars: the operator's second
        // constraint is time, not only quota. A lower effort that holds recall and halves the wait
        // is a different proposition from one that only costs less, and the harness could not tell
        // them apart -- every node records duration_ms and the bench dropped it on the floor.
        // It is also the quantity a node TIMEOUT is set against: arch-review was killed at the
        // 15-minute cap on 20260913-222312-arch-declared and lost 17 capture files, so "how close
        // is this setting to the ceiling" is a question the corpus should be able to answer.
        if (typeof s.duration_ms === 'number') durationsByNode[id] = s.duration_ms;
        configByNode[id] = { model: s.model ?? null, effort: s.effort ?? null };
      }
    }
  }
  {
    for (const node of list('evidence', { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink())) {
      const r = readKeptVerdict(owner, node.name, { io });
      if (!r.ok) { if (!r.missing) refused[node.name] = r.why; continue; }
      // ONLY FROM A NODE THAT REPORTED OK (G-18 of ltb-review-r2), the barrier's and the fold's rule — and a verdict
      // left out for that reason is NAMED (G-12, G-11 of ltb-review-r3): with no status file, or one that is not OK,
      // its findings were dropped with nothing in `refused`, so recall was understated and nothing said so. A status
      // that could not be read is already refused above, under `status:<id>`.
      const st = statuses.get(node.name);
      if (!st) {
        if (!refused[`status:${node.name}`]) refused[node.name] = 'a kept verdict with no status file for its node; its findings are not scored';
        continue;
      }
      if (st.state !== 'OK') { refused[node.name] = `its node reported ${st.state}, not OK; its kept findings are not scored`; continue; }
      // KEPT MUST MATCH RECORDED (G-8 of ltb-review-r4; the node, not the run — operator, "2 as suggested"): the
      // status file is durable and records how many findings the node kept. Fewer is pruned evidence, which would
      // score as a node that found less; MORE is a verdict changed after the node wrote it, which would score findings
      // the node never kept (G-13 of 20260929-124952-ssr-review). Both writers set the count from what they kept
      // (spawn-node, and run-graph for the arms), so a sound run always matches: 805 of 805 saved nodes did.
      if (keepsFindings(st) && r.verdict.findings.length !== st.findings_count) {
        refused[node.name] = `kept ${r.verdict.findings.length} finding(s) where its status records ${st.findings_count}; `
          + `${r.verdict.findings.length < st.findings_count ? 'the evidence was pruned' : 'the verdict was changed after it was written'}, and the node is not scored`;
        continue;
      }
      findingsByNode[node.name] = r.verdict.findings.map((f) => ({
        // claim travels too: the worktree (and its verdict.kept.json) is removed after scoring,
        // so the result file is the only place the finding's text can survive for forensics.
        // REDACTED (G-19 of ltb-review-r2): bench/results is tracked, and this is a tracked write's content.
        file: f.file, line: f.line, severity: f.severity,
        claim: typeof f.claim === 'string' ? redactClaim(f.claim).slice(0, 400) : '',
      }));
    }
  }
  // A NODE THAT RECORDED FINDINGS AND KEPT NO VERDICT (G-8 of ltb-review-r4): the loop above walks verdicts, so a
  // node whose verdict file is gone was skipped with nothing said. A node recording none, like reconcile and
  // second-opinion, writes no verdict and loses nothing.
  for (const [id, st] of statuses) {
    if (keepsFindings(st) && st.findings_count > 0 && !findingsByNode[id] && !refused[id]) {
      refused[id] = `its status records ${st.findings_count} finding(s) and it has no kept verdict; the evidence was pruned, and the node is not scored`;
    }
  }
  // WHAT THE BARRIER DECIDED, from the two structured artifacts rather than the prose report.
  // payload.json is reconcile's schema-validated output (group_id -> decision); finding-groups.json
  // is the mechanical grouping that anchors each group to a file and line. Joined on group_id by
  // scoreReconcile. Absent files mean reconcile did not report, which scoreReconcile distinguishes
  // from a drop -- a node that never ran cannot have discarded anything.
  //
  // THROUGH THE ONE READER (G-9 of ltb-review-r4): both were parsed directly with every error swallowed, so a
  // malformed artifact, or one reached through a link out of the run, read exactly like an absent one. Absent is
  // still absent; anything else is refused under the artifact's path.
  let reconcileDecisions = {};
  let groupIndex = [];
  const { groups: fg, payload: pay, refused: artifactRefusals } = readReconcileArtifacts(owner, { io });
  Object.assign(refused, artifactRefusals);
  for (const g of pay?.groups ?? []) {
    // The whole decision, not just its name: a `symptom` is alive only if its
    // root_cause_group is, so the scorer needs the pointer to follow.
    if (g?.group_id) reconcileDecisions[g.group_id] = { decision: g.decision ?? null, root_cause_group: g.root_cause_group ?? null };
  }
  groupIndex =(fg?.groups ?? []).map((g) => ({ group_id: g?.group_id, file: g?.file, line: g?.line }));

  return {
    findingsByNode, costsByNode, usageByNode, turnsByNode, durationsByNode, configByNode,
    reconcileDecisions, groupIndex, refused,
  };
}


/**
 * What THIS pass spent, separated from what the run directory already contained.
 *
 * `collectRun` reads every node in a run directory. When that directory is a COPY of a finished
 * pass — which is how bench-second-opinion works — the maps it returns are dominated by nodes that
 * ran days earlier. Writing them out flat reported **$19.30 for a pass that spent $5.13**: not an
 * estimate that drifted, a number 3.8x wrong sitting in the artifact a reader quotes.
 *
 * So the split is a DECISION and lives here rather than inline at the call site, where it was.
 * Two rules it enforces that a hand-rolled version kept getting wrong:
 *
 *   * `spent` holds only the node this pass actually spawned, plus whatever the caller paid outside
 *     the run directory (the forge). Nothing else may be added to it.
 *   * `inherited` is LABELLED, not dropped. A per-node comparison against the original pass is the
 *     reason to keep it — and naming it is what stops it being summed into a total claiming to be
 *     a cost. Absent data stays `null` rather than becoming 0: 0 is a measurement ("this was
 *     free"), null is its absence, and summing absences as zeros under-reports.
 */
export function splitSpend({
  costsByNode = {}, durationsByNode = {}, usageByNode = {}, configByNode = {},
  nodeId, extraUsd = null, extraLabel = 'extra_usd',
} = {}) {
  const own = costsByNode?.[nodeId] ?? null;
  const notOwn = (m) => Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => k !== nodeId));
  return {
    spent: {
      [`${nodeId.replace(/-/g, '_')}_usd`]: own,
      [extraLabel]: extraUsd,
      // NULL WHEN NOTHING WAS PRICED (G-3, three arms). This read
      // `Number(((own ?? 0) + (extraUsd ?? 0)).toFixed(4))` — and both components are deliberately
      // kept as `null` on absence two lines above, so the total broke the rule the rest of this
      // object follows. An unpriced pass reported $0.00, which is a different claim from "the
      // vendor returned nothing".
      //
      // It also defeated the G-7 fix ONE LAYER DOWN: sumSpend was taught to report absence rather
      // than impute zero, and it reads this field, which by then was already a zero-filled number.
      // A real zero survives, because a call that genuinely cost nothing is a measurement.
      total_usd: own === null && extraUsd === null
        ? null
        : Number(((own ?? 0) + (extraUsd ?? 0)).toFixed(4)),
      duration_ms: durationsByNode?.[nodeId] ?? null,
      usage: usageByNode?.[nodeId] ?? null,
      node: configByNode?.[nodeId] ?? null,
    },
    inherited: {
      $note: `already in the run directory before this pass, NOT spent by it — never add these to spent`,
      costs: notOwn(costsByNode),
      duration_ms: notOwn(durationsByNode),
    },
  };
}

/**
 * The end-of-run refusal summary: one line per distinct refusal, for every seed record given — scored and NOT RUN
 * alike (G-6 of 20260929-195848-ssr-review-r7). The run's intent requires every refusal to be visible in stdout AND in
 * the result file; the summaries printed refusals only for NOT RUN seeds, so a scored seed's node refusals reached the
 * result file and stderr and never stdout. One owner, so bench-lenses and bench-second-opinion print the same thing.
 * Pure: it formats, and the caller prints.
 */
export function refusalLines(records = []) {
  const seen = new Set();
  const lines = [];
  for (const r of records) {
    for (const [what, why] of Object.entries(r?.refused ?? {})) {
      const line = `   REFUSED ${r.seed} · ${what}: ${why}`;
      if (!seen.has(line)) { seen.add(line); lines.push(line); }
    }
  }
  return lines;
}
