// reconcile-mutations.mjs — seed an error INTO a finished reconciliation, so the node that audits
// reconciliations can be scored.
//
// AC14 of .claude/requests/model-and-effort-reevaluation.md: `reconcile` was scoreable from
// artifacts that already existed, and `second-opinion` is not. Its job is catching the
// RECONCILER's mistakes, so measuring it means making one on purpose — "a corpus that does not
// exist: seeded reconciliation errors rather than seeded code defects".
//
// This module is the injection half. It is pure for the reason every lib/ module here is: the
// expensive part is the model run, and the part that must never be quietly wrong is the part that
// costs nothing to test.
//
// ALL THREE MUTATIONS ARE IMPLEMENTED, AND EACH REFUSES ITS OWN SEEDS. For most of this file's life
// only `misanchor` was: the other two were designed and rejected for leaving a TELL, because the
// rationale on disk was written to justify the opposite decision and would contradict the header
// above it. The `rewrite` injection rule removed that objection by regenerating the paragraph, and
// what each then needed was its own refusal — a rule that keeps it from injecting something a
// reviewer would call a close reading, or something an auditor catches by finding the harness.
// Measured coverage of the 7-seed corpus: misanchor 6, deflate 6, drop 4, and between them every
// seed is reachable by at least one. The refusals below are the substance, so they are recorded
// here rather than in a commit message:
//
//   `misanchor`  — move a kept group's ANCHOR to another line the reconciliation itself discusses.
//                  IMPLEMENTED. It is the only one of the three that leaves no tell: the anchor is
//                  mechanical grouping output, not the reconciler's prose, so a rationale that
//                  discusses one line while the header points at another is exactly the real
//                  defect (2026-09-20, `20260920-070634-invoke-doc-consistency2`: the confirmed
//                  BLOCKER anchored at the caller while the defective writer was elsewhere, and
//                  the reconciler's schema gave it no way to re-anchor). Remediation patches the
//                  wrong place.
//                  Refuses a seed with no admissible destination: 6 of 7.
//   `drop`       — move a kept group into `## Dropped`. Its first objection — the rationale was
//                  written to justify CONFIRMING — is what the rewrite answers. Its SECOND is not,
//                  and no rewriting of that group's own paragraph touches it: the seed-anchored
//                  group is often the root cause of several symptoms, and dropping it leaves a
//                  `root_cause_group` pointing at a group that is gone. An auditor finds that by
//                  following a pointer, not by judging the drop. `dropWouldDangle` refuses those:
//                  4 of 7. Its tell check is also the one that is NOT mechanically bounded — see
//                  `tellForMutation` — and it says so rather than pretending otherwise.
//   `deflate`    — lower a kept group's severity, which the rewrite makes coherent. Its own
//                  refusal is the severity analogue of `tolerance`: HIGH versus BLOCKER on one
//                  finding is an argument reviewers have in good faith, so a severity must fall at
//                  least two rungs or the seed is refused. That excludes MEDIUM and LOW groups:
//                  6 of 7, and it reaches the one seed `misanchor` cannot, because it needs no
//                  admissible anchor.
//
// A mutation with a tell measures whether the auditor notices tampering, which nobody asked for.
// That is why every one of them goes through the forge, and why the checks above are refusals
// rather than warnings: a seed that cannot be mutated cleanly is NOT RUN, never a miss.

import path from 'node:path';

/** The header the reconciled.md renderer emits per group: `### G-3 · BLOCKER · \`file:line\`` */
const HEADER_RE = /^### (\S+) · ([A-Z]+) · `([^`]*)`\s*$/;

// `misanchor` is one mutation with two INJECTION rules, not two mutations: what is injected is the
// same wrong anchor either way. `borrow` leaves the rationale alone and is limited to destinations
// the prose already discusses; `rewrite` has the reconciler's paragraph regenerated to match, which
// is what lifts the same-file restriction and removes the tell. Listed so a driver cannot select a
// rule that is only designed.
export const MUTATIONS = ['misanchor', 'deflate', 'drop'];
export const INJECTION_RULES = ['borrow', 'rewrite'];

/** Every group header in a rendered reconciled.md, in document order. */
export function groupHeaders(reconciledMd) {
  const out = [];
  const lines = String(reconciledMd ?? '').split('\n');
  lines.forEach((text, index) => {
    const m = HEADER_RE.exec(text);
    if (!m) return;
    const [, groupId, severity, anchor] = m;
    const cut = anchor.lastIndexOf(':');
    const line = cut === -1 ? null : Number(anchor.slice(cut + 1));
    out.push({
      group_id: groupId,
      severity,
      anchor,
      file: cut === -1 ? anchor : anchor.slice(0, cut),
      line: Number.isInteger(line) ? line : null,
      index,
    });
  });
  return out;
}

/**
 * One group's section of a rendered reconciled.md — its header through to the next heading.
 *
 * The judge is shown this rather than the whole file, for the reason the tie-break prompt already
 * embeds its excerpt (G-36): a judge that has to go and find its evidence finds a different slice
 * each time, and one that is handed the whole reconciliation is being asked to re-review the run.
 * Report-structure knowledge lives here beside the header parser rather than in the driver, so
 * there is one place that knows what the renderer emits.
 */
export function groupSection(reconciledMd, groupId) {
  const lines = String(reconciledMd ?? '').split('\n');
  const start = groupHeaders(reconciledMd).find((h) => h.group_id === groupId)?.index;
  if (start === undefined) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,3} /.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

/**
 * Is the injected anchor STILL in the reconciliation the audited node actually read?
 *
 * The injection happens before the node is re-spawned, and between those two moments the
 * orchestrator may legitimately re-derive the file: `reconciled.md` is rendered from
 * `evidence/reconcile/payload.json` inside the branch that SPAWNS reconcile, so a resume in which
 * any lens or arm re-ran re-renders it and the mutation is gone with no error raised anywhere. The
 * node then audits a correct reconciliation, correctly finds nothing wrong with the anchor, and is
 * recorded as having MISSED an error that was never in front of it.
 *
 * That is the same failure `scoreJudgedReport` refuses at the other end — the instrument's failure
 * charged to the audited node — arriving by a route scoring cannot see, because by then there is
 * only a report. So it is checked here, against the file on disk, after the spawn.
 */
export function mutationSurvived({ reconciledMd, findingGroups, targetId, expectedAnchor }) {
  const header = groupHeaders(reconciledMd).find((h) => h.group_id === targetId);
  if (!header) {
    return { ok: false, anchor: null, why: `${targetId} has no header in reconciled.md any more` };
  }
  if (header.anchor !== expectedAnchor) {
    return {
      ok: false,
      anchor: header.anchor,
      why: `${targetId} is anchored at ${header.anchor} in reconciled.md, not the injected ${expectedAnchor}`,
    };
  }
  // EVERY ARTIFACT THE MUTATION TOUCHED, not just the one the audit reads first. Checking
  // reconciled.md alone passed a HALF-UNDONE mutation on 2026-09-22: `run-graph.mjs:2729` rewrites
  // finding-groups.json from the lens reports on EVERY run, resume included, so the injected anchor
  // survived in the report and reverted in the grouping. `second-opinion` then reported the two
  // artifacts contradicting each other — "finding-groups.json anchors G-3 at line 1014 ...
  // reconciled.md renders it as :711" — which is the rendering-bug catch applyMisanchor moves both
  // files to prevent, scored as though it were the misanchor. A seed in that state is NOT RUN.
  if (findingGroups !== undefined) {
    const group = (findingGroups?.groups ?? []).find((g) => g?.group_id === targetId);
    if (!group) {
      return { ok: false, anchor: header.anchor, why: `${targetId} is not in finding-groups.json any more` };
    }
    const grouped = `${group.file}:${group.line}`;
    if (grouped !== expectedAnchor) {
      return {
        ok: false,
        anchor: grouped,
        why: `finding-groups.json anchors ${targetId} at ${grouped} while reconciled.md says `
          + `${expectedAnchor} — the two artifacts contradict, and an auditor that notices THAT has `
          + 'found the harness rather than a misjudged anchor',
      };
    }
  }
  return { ok: true, anchor: header.anchor, why: 'the injected anchor is still on the group header' };
}

/**
 * Where to move the target's anchor to.
 *
 * NOT an arbitrary line. Under the BORROWING rule the destination is a line the reconciliation
 * already discusses — another group's anchor — because the surrounding prose is left alone and
 * must not contradict the header. On the 2026-09-21 corpus that is typically the symptom the root
 * cause was correctly separated from: re-anchoring the root onto its own symptom is the mistake
 * the real run made, in the same file, with both lines named in the surrounding paragraphs.
 *
 * Farthest first, and never inside `tolerance`: an anchor a reviewer could defensibly have cited
 * is not a wrong anchor, and scoring one as an injected error would manufacture the result.
 *
 * `allowCrossFile` WIDENS IT, AND IS ONLY SOUND WITH THE REWRITE (measured 2026-09-22). Restricted
 * to one file, this refused five of seven seeds — two of them because the reconciliation contained
 * no second anchor to borrow at all. Borrowing across files fixes the count and makes the tell
 * worse: a header naming one file above a paragraph that opens "Verified at source: <other
 * file>:1817-1819" is a contradiction no reconciler produces. So the flag is passed by the caller
 * that is ALSO rewriting the rationale, and by nothing else. Same-file candidates still rank first,
 * because a within-file move stays the more conservative mistake.
 */
export function alternateAnchor({ headers = [], targetId, tolerance = 15, allowCrossFile = false }) {
  const target = headers.find((h) => h.group_id === targetId);
  if (!target) return { ok: false, why: `no group header for ${targetId}` };
  if (!Number.isInteger(target.line)) return { ok: false, why: `${targetId}'s header carries no line` };
  // A DIFFERENT FILE IS ALWAYS A DIFFERENT PLACE, so `tolerance` — a within-file notion of "near
  // enough that a reviewer could have meant it" — only filters same-file candidates. Applying it
  // across files would compare line numbers between unrelated files, which is meaningless
  // arithmetic that happens not to throw.
  const admissible = headers.filter((h) => h.group_id !== targetId && Number.isInteger(h.line)
    && (h.file === target.file ? Math.abs(h.line - target.line) > tolerance : allowCrossFile));
  // Same file first (the more conservative mistake), then farthest line within each class.
  const candidates = admissible.sort((a, b) => {
    const sameA = a.file === target.file ? 0 : 1;
    const sameB = b.file === target.file ? 0 : 1;
    if (sameA !== sameB) return sameA - sameB;
    return Math.abs(b.line - target.line) - Math.abs(a.line - target.line);
  });
  if (!candidates.length) {
    return {
      ok: false,
      why: `no other group header is an admissible destination for ${targetId}: `
        + (headers.length < 2
          ? 'it is the only anchored group in this reconciliation'
          : allowCrossFile
            ? `the other ${headers.length - 1} are all in ${target.file} within ${tolerance} lines `
              + 'of it, which a reviewer could defensibly have cited'
            : `no other group in ${target.file} sits more than ${tolerance} lines away, so every `
              + 'alternative anchor is one a reviewer could defensibly have cited; a cross-file '
              + 'destination needs the rationale rewritten'),
    };
  }
  const pick = candidates[0];
  return {
    ok: true, file: pick.file, line: pick.line, borrowed_from: pick.group_id,
    cross_file: pick.file !== target.file,
  };
}

/**
 * Line numbers the group's own text CITES, as a second source of destinations.
 *
 * The rule has always been "a location this reconciliation already discusses" — the first
 * implementation read that as "another group's anchor", which is the narrowest possible reading and
 * refused two of seven seeds outright for having only one anchored group. A reconciliation
 * discusses far more locations than it anchors: `clamp-silent-noop` has one usable group header and
 * its lens claim names `capVerdict` at line 52 and `capArmSeverity` at line 1167, both real and
 * substantive in `decisions.mjs` at the commit under review, the second 1124 lines from the anchor.
 *
 * Deliberately conservative about what counts as a line number. `:1167` and `line 52` are line
 * citations; a bare `1167` in a sentence could be a count, a dollar figure or an id, and a
 * destination mined from one of those would be a line the reconciliation does NOT discuss — the
 * exact property this function exists to guarantee. The caller bounds them further against the real
 * file, because a citation can be stale in a way the text cannot show.
 */
export function citedLines({ text, file, excludeLine, tolerance = 15 }) {
  const s = String(text ?? '');
  const own = path.basename(String(file ?? ''));
  const hits = new Set();
  const add = (n) => { const v = Number(n); if (v > 0) hits.add(v); };

  // WHICH FILE A CITED LINE BELONGS TO IS THE WHOLE CORRECTNESS QUESTION HERE, and the first
  // version ignored it: every number was inherited into the group's file, so `spawn-node.mjs:1771`
  // in a group anchored in `decisions.mjs` offered 1771 as a destination in decisions.mjs — a line
  // the prose does NOT discuss, dressed as one that does. It was caught only because decisions.mjs
  // is 1362 lines long and the caller's end-of-file bound rejected it; in a longer file it would
  // have been accepted silently. A qualified citation naming ANOTHER file is therefore dropped
  // rather than inherited. (Resolving it into that other file is possible and is not done: it
  // needs a basename-to-path search with its own ambiguity, for one seed.)
  for (const m of s.matchAll(/([\w.\-/\\]*[\w\-]+\.[A-Za-z]{1,6}):(\d{1,6})(?:\s*[-–]\s*(\d{1,6}))?/g)) {
    if (path.basename(m[1]) !== own) continue;
    add(m[2]);
    if (m[3]) add(m[3]);
  }
  // Unqualified citations — `line 42`, `lines 1817-1819`, `capVerdict:54` — are about the group's
  // own file. A bare number in a sentence is NOT: it could be a count, a cost or an id, and a
  // destination mined from one of those is not a location the reconciliation discusses at all.
  const qualified = /[\w\-]+\.[A-Za-z]{1,6}:$/;
  for (const m of s.matchAll(/(\S*?)\b(?:lines?\s+|:)(\d{1,6})(?:\s*[-–]\s*(\d{1,6}))?/gi)) {
    if (qualified.test(m[1] + ':')) continue;
    add(m[2]);
    if (m[3]) add(m[3]);
  }
  return [...hits]
    .filter((n) => !Number.isInteger(excludeLine) || Math.abs(n - excludeLine) > tolerance)
    .sort((a, b) => Math.abs(b - excludeLine) - Math.abs(a - excludeLine));
}

/** The finding lines the renderer emits under a group: ``- `node` · source: claim (evidence: …)``. */
const FINDING_RE = /^- `[^`]+`/;

/**
 * Split one group's section into the part the RECONCILER wrote and the parts it did not.
 *
 * THIS IS THE DISTINCTION THE WHOLE REWRITE TURNS ON, and getting it wrong would forge the wrong
 * thing. `run-graph.mjs:3083-3096` renders a group as: the header (anchor, from
 * `finding-groups.json`), `Raised by:` and an optional `Root cause:` line (both mechanical), then
 * `g.rationale` — the reconciler's OWN prose from `payload.json` — then one line per underlying
 * finding, which is each LENS's claim in the lens's words.
 *
 * Only the rationale is rewritten. The lens lines keep naming the true location on purpose: a
 * group header that disagrees with the findings under it IS the defect being injected, observed
 * exactly that way on `20260920-070634-invoke-doc-consistency2`. Rewriting them too would forge
 * the lenses' reports — which also sit in `nodes/*-report.md`, so the forgery would have to spread
 * to stay consistent — and would erase the very evidence `second-opinion` is supposed to catch
 * this with. The reconciler's paragraph must agree with the anchor; its inputs must not.
 */
export function splitGroupSection(reconciledMd, groupId) {
  const section = groupSection(reconciledMd, groupId);
  if (section === null) return { ok: false, why: `no section for ${groupId} in reconciled.md` };
  const lines = section.split('\n');
  const firstFinding = lines.findIndex((l) => FINDING_RE.test(l));
  if (firstFinding === -1) {
    return { ok: false, why: `${groupId}'s section renders no finding lines, so its rationale has no end` };
  }
  // The preamble is the header plus the mechanical lines; everything between it and the findings
  // is the rationale. `Root cause:` is optional, so the boundary is found rather than counted.
  let rationaleStart = 1;
  for (let i = 1; i < firstFinding; i++) {
    if (/^(Raised by|Root cause):/.test(lines[i])) rationaleStart = i + 1;
  }
  const rationale = lines.slice(rationaleStart, firstFinding).join('\n').trim();
  if (!rationale) return { ok: false, why: `${groupId} has an empty rationale, so there is nothing to rewrite` };
  return {
    ok: true,
    preamble: lines.slice(0, rationaleStart).join('\n'),
    rationale,
    findings: lines.slice(firstFinding).join('\n').trimEnd(),
  };
}

/**
 * Does the rewritten rationale actually carry the injected anchor, and no trace of the real one?
 *
 * THE GUARANTEE THE ORIGINAL DESIGN ASSERTED AND DID NOT HAVE. `misanchor` was justified on the
 * premise that the anchor is mechanical grouping output the reconciler's prose does not restate.
 * Measured on the 2026-09-21 corpus, the prose restates it by line number in every seed that could
 * be mutated at all — `"DELETED an eleven-line guard at line 1014"` above a header this harness had
 * moved to 711. That is a tamper tell, and it is the same objection that refused `drop` and
 * `deflate`. The rewrite exists to remove it; this function is what stops the removal from being
 * assumed.
 *
 * A WINDOW, not the exact line. Prose cites ranges (`1817-1819` for an anchor at 1818) and
 * neighbours, so any line within `tolerance` of the true anchor still points a reader at the right
 * place. That is the same notion of "near enough to be the same location" `alternateAnchor` uses to
 * refuse a destination, applied to the other end.
 *
 * Failing is NOT RUN, never a miss: refusing a seed costs a data point, and shipping one whose
 * paragraph still names the real line would score tamper-detection while reporting recall.
 */
export function rewriteCarriesTell({ rationale, from, to, tolerance = 15 }) {
  const text = String(rationale ?? '');
  const nums = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
  const near = nums.filter((n) => Math.abs(n - from.line) <= tolerance);
  if (near.length) {
    return {
      ok: false,
      why: `the rewritten rationale still cites line ${near[0]}, within ${tolerance} of the real `
        + `anchor ${from.file}:${from.line} — a reader is still pointed at the right place`,
    };
  }
  // The rewrite must COMMIT to the wrong place, not go vague. A rationale with no line reference at
  // all is a reconciler that stopped corroborating its own anchor, which is a different and weaker
  // defect than one that confidently justifies the wrong location.
  if (!nums.includes(to.line)) {
    return {
      ok: false,
      why: `the rewritten rationale never cites the injected line ${to.line}, so it does not `
        + 'justify the anchor it was rewritten for',
    };
  }
  if (from.file !== to.file && text.includes(path.basename(from.file))) {
    return {
      ok: false,
      why: `the rewritten rationale still names ${path.basename(from.file)}, which the header no `
        + 'longer points at',
    };
  }
  return { ok: true, why: 'the rationale cites the injected anchor and nothing near the real one' };
}

/**
 * Put a rewritten rationale back, in the report and in the payload it was rendered from.
 *
 * BOTH, for the reason the anchor moves in both artifacts that carry it: `reconciled.md` is what
 * `second-opinion` audits, and `evidence/reconcile/payload.json` is what the orchestrator renders
 * it from. Leaving the payload holding the original paragraph would put a contradiction in the run
 * directory — and an auditor that found THAT would have found this harness, not a reconciler.
 */
export function applyRewrittenRationale({ reconciledMd, payload, groupId, rationale }) {
  const parts = splitGroupSection(reconciledMd, groupId);
  if (!parts.ok) throw new Error(`applyRewrittenRationale: ${parts.why}`);
  const rewritten = String(rationale).trim();
  if (!rewritten) throw new Error('applyRewrittenRationale: the rewritten rationale is empty');
  const before = groupSection(reconciledMd, groupId);
  // THE BLANK LINE BACK. `preamble` ends at the `Raised by:`/`Root cause:` line, and the renderer
  // (`run-graph.mjs:3089-3096`) pushes '' after it — so joining preamble straight onto the rewritten
  // prose produced `Raised by: ...` immediately followed by the paragraph. Observed on the first
  // end-to-end run. It is only markdown, and it is exactly the kind of seam this mutation exists to
  // NOT have: a reader who notices the formatting differs from every other group has found the
  // harness, not the anchor.
  const after = [parts.preamble, '', rewritten, '', parts.findings].join('\n');
  // A FUNCTION REPLACER, NEVER THE STRING. `String.replace(str, str)` interprets `$&`, `` $` ``,
  // `$'` and `$n` in the REPLACEMENT — and the replacement here is model-written prose. A forged
  // rationale that mentions shell or git syntax would splice a silently corrupted paragraph into
  // reconciled.md, and a mangled paragraph is something an auditor may well object to, which would
  // be scored as catching the injected anchor. The callback form inserts the text verbatim.
  const md = String(reconciledMd).replace(before, () => after);
  if (md === reconciledMd) throw new Error(`applyRewrittenRationale: ${groupId}'s section did not splice`);

  const p = JSON.parse(JSON.stringify(payload ?? {}));
  const group = (p.groups ?? []).find((g) => g?.group_id === groupId);
  if (!group) throw new Error(`applyRewrittenRationale: ${groupId} is not in payload.json`);
  group.rationale = rewritten;
  return { reconciled_md: md, payload: p };
}

/**
 * Move one group's anchor, in the two artifacts that carry it.
 *
 * BOTH, because they must agree. `reconciled.md` is what `second-opinion` audits and what
 * remediate works from; `finding-groups.json` is the mechanical grouping the header was rendered
 * from. Mutating only the report would leave the two artifacts contradicting each other, and an
 * auditor that spots THAT has found a rendering bug, not a misjudged anchor. With both moved, the
 * only thing left disagreeing with the anchor is the source code — which is the version of this
 * defect that actually shipped.
 */
export function applyMisanchor({ reconciledMd, findingGroups, targetId, to }) {
  if (!to || typeof to.file !== 'string' || !Number.isInteger(to.line)) {
    throw new Error('applyMisanchor needs to: { file, line }');
  }
  const headers = groupHeaders(reconciledMd);
  const target = headers.find((h) => h.group_id === targetId);
  if (!target) throw new Error(`applyMisanchor: no group header for ${targetId} in reconciled.md`);
  if (target.file === to.file && target.line === to.line) {
    throw new Error(`applyMisanchor: ${targetId} is already anchored at ${to.file}:${to.line}`);
  }

  const lines = String(reconciledMd).split('\n');
  lines[target.index] = `### ${target.group_id} · ${target.severity} · \`${to.file}:${to.line}\``;

  const fg = JSON.parse(JSON.stringify(findingGroups ?? {}));
  const group = (fg.groups ?? []).find((g) => g?.group_id === targetId);
  if (!group) throw new Error(`applyMisanchor: ${targetId} is not in finding-groups.json`);
  const from = { file: group.file, line: group.line };
  group.file = to.file;
  group.line = to.line;

  return {
    reconciled_md: lines.join('\n'),
    finding_groups: fg,
    ground_truth: {
      mutation: 'misanchor',
      group_id: targetId,
      from: `${from.file}:${from.line}`,
      to: `${to.file}:${to.line}`,
      // The sentence the judge is shown, and the sentence a human reads in the result file. One
      // string, so the question asked and the question recorded cannot drift apart.
      statement:
        `Group ${targetId} is anchored at ${to.file}:${to.line}. That is the wrong location: the `
        + `defect this group describes is at ${from.file}:${from.line}, which is where a fix has to `
        + `go. A remediation working from this reconciliation would patch the wrong place.`,
    },
  };
}

/**
 * How far a severity must fall before the drop is an ERROR rather than a judgement call.
 *
 * `tolerance` exists on the anchor side for exactly this reason: an anchor a reviewer could
 * defensibly have cited is not a wrong anchor, and injecting one manufactures the result. Severity
 * has the same property one rung apart — HIGH versus BLOCKER on the same finding is an argument
 * reviewers have in good faith, and scoring an auditor for failing to object to it would be
 * measuring agreement with this harness rather than detection of a defect.
 *
 * Two rungs is the floor, so `MEDIUM` and `LOW` groups cannot be deflated at all and are refused
 * rather than nudged.
 */
export const MIN_SEVERITY_DROP = 2;

/**
 * Where a group's severity is moved to, or why it cannot be.
 *
 * To the BOTTOM rung rather than by a fixed step: the further it falls the less defensible it is,
 * and the point of the injection is an error nobody would call a close reading. `SEVERITY_RUNGS` is
 * passed in rather than imported so this module keeps no opinion about the ladder — decisions.mjs
 * owns it, and a second copy here would be the two-owners defect this project keeps recording.
 */
export function deflatedSeverity({ severity, rungs = [], minDrop = MIN_SEVERITY_DROP }) {
  const at = rungs.indexOf(severity);
  if (at === -1) return { ok: false, why: `severity ${JSON.stringify(severity)} is not on the ladder` };
  if (at < minDrop) {
    return {
      ok: false,
      why: `${severity} cannot fall ${minDrop} rungs — anything closer is a severity two reviewers `
        + 'could disagree about in good faith, which is not an injected error',
    };
  }
  return { ok: true, from: severity, to: rungs[0], fell: at };
}

/**
 * Lower a kept group's severity, in the report and in the payload it was rendered from.
 *
 * THE FINDINGS UNDERNEATH KEEP THEIRS, exactly as `misanchor` leaves the lens bullets naming the
 * true line. A group recorded at LOW above findings the lenses raised as BLOCKER is the defect
 * being injected — a reconciler that talked itself down — and the disagreement between the header
 * and its inputs is the thing an audit is supposed to notice, not a seam.
 */
export function applyDeflate({ reconciledMd, payload, targetId, to }) {
  const headers = groupHeaders(reconciledMd);
  const target = headers.find((h) => h.group_id === targetId);
  if (!target) throw new Error(`applyDeflate: no group header for ${targetId} in reconciled.md`);
  if (target.severity === to) throw new Error(`applyDeflate: ${targetId} is already ${to}`);

  const lines = String(reconciledMd).split('\n');
  lines[target.index] = `### ${target.group_id} · ${to} · \`${target.anchor}\``;

  const p = JSON.parse(JSON.stringify(payload ?? {}));
  const group = (p.groups ?? []).find((g) => g?.group_id === targetId);
  if (!group) throw new Error(`applyDeflate: ${targetId} is not in payload.json`);
  const from = group.severity;
  group.severity = to;

  return {
    reconciled_md: lines.join('\n'),
    payload: p,
    ground_truth: {
      mutation: 'deflate',
      group_id: targetId,
      from,
      to,
      statement:
        `Group ${targetId} is recorded at ${to}. That is too low: the findings it groups were `
        + `raised at ${from}, and nothing in the evidence justifies lowering it. A gate reading this `
        + `reconciliation would let ${from}-severity work through under a ${to} label.`,
    },
  };
}

/**
 * May this group be dropped without leaving a dangling root?
 *
 * THE SECOND REFUSAL, AND THE ONE THE REWRITE DOES NOT FIX. `drop` was rejected for two reasons:
 * the rationale was written to justify CONFIRMING, which regenerating it solves — and "the
 * seed-anchored group is usually the root cause of several symptoms, so dropping it leaves live
 * symptoms pointing at a dead root", which no amount of rewriting that group's own paragraph
 * touches. A symptom whose `root_cause_group` names a dropped group is a structural inconsistency
 * an auditor finds by following a pointer, not by judging the drop.
 *
 * Measured on the 2026-09-21 corpus: 4 of 6 scoreable targets have no dependents, and 2 are roots.
 * So the rule costs a third of the corpus and buys a mutation that is only ever about the drop.
 */
export function dropWouldDangle({ payload, targetId }) {
  const deps = ((payload?.groups) ?? [])
    .filter((g) => g?.root_cause_group === targetId)
    .map((g) => g.group_id);
  return deps.length
    ? { ok: false, dependents: deps, why: `${deps.join(', ')} name ${targetId} as their root cause, `
        + 'so dropping it would leave live symptoms pointing at a group that is gone — an auditor '
        + 'that follows that pointer has found the harness rather than a misjudged drop' }
    : { ok: true, dependents: [] };
}

/** The bucket headings the renderer emits, in the order it emits them (`run-graph.mjs:3078`). */
const BUCKETS = ['Confirmed', 'Symptom', 'Coincidence', 'Dropped'];
const BUCKET_RE = /^## (Confirmed|Symptom|Coincidence|Dropped) \((\d+)\)\s*$/;

/**
 * Move a kept group into `## Dropped`, counts and all.
 *
 * THE COUNTS ARE THE HARD PART, and getting them wrong is its own tell. The renderer emits
 * `## Confirmed (2)` from `rows.length`, so a section moved without adjusting both headings leaves
 * a bucket claiming a population it does not have — an inconsistency an auditor finds by counting,
 * which is not the misjudgement being injected. A bucket emptied entirely loses its heading, because
 * the renderer skips empty buckets (`if (!rows.length) continue`) and a `## Confirmed (0)` heading
 * is a shape it never produces.
 *
 * `Dropped` is appended in the renderer's own bucket order and before `## Lens did not report`,
 * which is not a bucket and always trails.
 *
 * The caller is responsible for `dropWouldDangle` — this function moves what it is told to move.
 */
export function applyDrop({ reconciledMd, payload, targetId }) {
  const lines = String(reconciledMd ?? '').split('\n');
  const header = groupHeaders(reconciledMd).find((h) => h.group_id === targetId);
  if (!header) throw new Error(`applyDrop: no group header for ${targetId} in reconciled.md`);

  // The section runs from its header to the next heading of any level.
  let end = lines.length;
  for (let i = header.index + 1; i < lines.length; i++) {
    if (/^#{2,3} /.test(lines[i])) { end = i; break; }
  }
  // Trailing blanks trimmed and exactly one re-added at the insert: the slice ends at the NEXT
  // heading, so it already carries the blank the renderer put between sections, and appending
  // another produced a double blank before the following heading. Only markdown — and exactly the
  // kind of seam a reader notices as "this group is formatted unlike every other", which is the
  // harness being found rather than the drop.
  const section = lines.slice(header.index, end);
  while (section.length && section[section.length - 1].trim() === '') section.pop();

  // Which bucket owns it: the nearest bucket heading above the section.
  let ownerAt = -1;
  for (let i = header.index - 1; i >= 0; i--) {
    if (BUCKET_RE.test(lines[i])) { ownerAt = i; break; }
  }
  if (ownerAt === -1) throw new Error(`applyDrop: ${targetId} sits under no bucket heading`);
  const [, ownerName, ownerCount] = BUCKET_RE.exec(lines[ownerAt]);
  if (ownerName === 'Dropped') throw new Error(`applyDrop: ${targetId} is already dropped`);

  const rest = lines.slice(0, header.index).concat(lines.slice(end));
  const ownerNow = Number(ownerCount) - 1;
  if (ownerNow <= 0) {
    // The renderer never emits an empty bucket, so neither may this. Take the heading and the blank
    // line the renderer pushes after it.
    const drop = rest[ownerAt + 1] === '' ? 2 : 1;
    rest.splice(ownerAt, drop);
  } else {
    rest[ownerAt] = `## ${ownerName} (${ownerNow})`;
  }

  // Into Dropped: either an existing bucket, or a new one in the renderer's order.
  const droppedAt = rest.findIndex((l) => /^## Dropped \(\d+\)\s*$/.test(l));
  if (droppedAt !== -1) {
    const n = Number(/^## Dropped \((\d+)\)/.exec(rest[droppedAt])[1]) + 1;
    rest[droppedAt] = `## Dropped (${n})`;
    let insertAt = rest.length;
    for (let i = droppedAt + 1; i < rest.length; i++) {
      if (/^## /.test(rest[i])) { insertAt = i; break; }
    }
    rest.splice(insertAt, 0, ...section, '');
  } else {
    // Before any heading the renderer places AFTER the buckets ("Lens did not report"), else at end.
    let insertAt = rest.length;
    for (let i = 0; i < rest.length; i++) {
      const m = BUCKET_RE.exec(rest[i]);
      if (/^## /.test(rest[i]) && !m) { insertAt = i; break; }
    }
    rest.splice(insertAt, 0, '## Dropped (1)', '', ...section, '');
  }

  const p = JSON.parse(JSON.stringify(payload ?? {}));
  const group = (p.groups ?? []).find((g) => g?.group_id === targetId);
  if (!group) throw new Error(`applyDrop: ${targetId} is not in payload.json`);
  const from = group.decision;
  group.decision = 'dropped';

  return {
    reconciled_md: rest.join('\n'),
    payload: p,
    ground_truth: {
      mutation: 'drop',
      group_id: targetId,
      from,
      to: 'dropped',
      statement:
        `Group ${targetId} was dropped. That is wrong: the findings it groups were raised by more `
        + `than one reporter and were ${from} before, nothing in the evidence withdraws them, and a `
        + 'dropped group reaches no gate and no remediation. The defect it describes would ship.',
    },
  };
}

/**
 * The forge's mutation-specific prose, PRE-RENDERED.
 *
 * `lib/template.mjs` has no conditionals and no loops on purpose — "every decision stays in code
 * and arrives pre-rendered" — so one template serves all three mutations and the branching lives
 * here. A conditional in the prompt would put this decision somewhere with no tests.
 */
export function forgeSlots({ mutation, groupId, from, to, tolerance, destinationSource }) {
  if (mutation === 'misanchor') {
    return {
      change_instruction:
        `Rewrite it as though the group had been anchored at \`${to.file}:${to.line}\` instead of `
        + `\`${from.file}:${from.line}\`. Cite ${to.line} as the location, with the same confidence `
        + 'the original had about its own line.',
      forbidden_rule:
        `**Do not mention line ${from.line}, any line within ${tolerance} of it, or that number in `
        + 'any other role.** This is checked mechanically and the rewrite is discarded if it appears.',
      destination_source: destinationSource,
    };
  }
  if (mutation === 'deflate') {
    return {
      change_instruction:
        `Rewrite it as though you had judged this group **${to}** rather than **${from}**. The `
        + 'defect, its location and its mechanism are unchanged — what changes is how bad you '
        + `concluded it is. Argue ${to} the way the original argued ${from}: state the consequence `
        + 'you think follows, and why it is bounded.',
      forbidden_rule:
        `**Do not use the word ${from} anywhere.** The original explained the severity it was `
        + 'written for, and a paragraph that still names it contradicts the header above it. This '
        + 'is checked mechanically and the rewrite is discarded if it appears.',
      destination_source:
        '(not applicable: this mutation changes the severity, not the location. The code under '
        + 'discussion is unchanged, and you have already seen everything the original cited.)',
    };
  }
  if (mutation === 'drop') {
    return {
      change_instruction:
        `Rewrite it as the rationale for DROPPING ${groupId} — a reconciler explaining why these `
        + 'findings do not survive adjudication. The original argued for keeping it; this argues '
        + 'the opposite, at the same length and specificity, about the same evidence.',
      forbidden_rule:
        '**Do not argue for keeping the group, and do not hedge toward it.** A paragraph in a '
        + '`Dropped` bucket that reads as a confirmation is a contradiction on its face.',
      destination_source:
        '(not applicable: this mutation changes the decision, not the location. The code under '
        + 'discussion is unchanged, and you have already seen everything the original cited.)',
    };
  }
  throw new Error(`forgeSlots: no prose for mutation ${JSON.stringify(mutation)}`);
}

/**
 * Does the rewritten rationale still betray the mutation? One checker per mutation.
 *
 * `bounded` IS PART OF THE ANSWER, not a detail. `misanchor` and `deflate` have a mechanical tell
 * to look for — a line number, a severity word — so "the tell is gone" is a checked property. DROP
 * DOES NOT: "does this paragraph now argue for dropping rather than keeping" is a judgement, and
 * the only mechanical things available are that it changed and that it stopped saying `confirm`,
 * neither of which establishes what it now argues. Reporting `bounded: false` is how the result
 * file says which rows rest on a check and which rest on a prompt instruction.
 *
 * Declaring the weakness beats inventing a check that looks like one: a brittle keyword rule would
 * read as a guarantee and fail silently, which is the shape this whole instrument exists to avoid.
 */
export function tellForMutation({ mutation, rationale, original = '', from, to, tolerance = 15 }) {
  const text = String(rationale ?? '');
  if (mutation === 'misanchor') {
    return { ...rewriteCarriesTell({ rationale: text, from, to, tolerance }), bounded: true };
  }

  if (mutation === 'deflate') {
    // THE TELL IS THE OLD SEVERITY, and that is the whole bounded check. Rationales explain the
    // severity they were written for — "Raised HIGH->BLOCKER because ..." — so the old rung
    // surviving into a deflated group is the contradiction that made `deflate` refusable in the
    // first place.
    if (new RegExp(`\\b${from}\\b`, 'i').test(text)) {
      return { ok: false, bounded: true, why: `the rewritten rationale still says ${from}, which the header no longer does` };
    }
    // AND NOT "MUST NAME THE NEW ONE". That rule was here, borrowed from misanchor where citing the
    // injected LINE is the only way to commit to a location. Severity is not like that: the header
    // states the rung and the paragraph argues it. Measured 2026-09-22, the rule refused this, which
    // is a perfectly good LOW rationale — "I lower it below both nodes' MEDIUM because no run is
    // harmed today ... a wrong answer nobody reads, not a wrong verdict." It commits to the lower
    // severity and never writes the word. Costing a seed for prose that is right is the safe
    // direction of error and still a cost, so the proxy goes and the real tell stays.
    if (text.trim() === String(original).trim()) {
      return { ok: false, bounded: true, why: 'the rationale came back unchanged, so nothing was rewritten' };
    }
    return { ok: true, bounded: true, why: `the rationale never names ${from}, and is not the original` };
  }

  if (mutation === 'drop') {
    if (text.trim() === String(original).trim()) {
      return { ok: false, bounded: false, why: 'the rationale came back unchanged, so nothing was rewritten' };
    }
    // THERE WAS A `\bconfirm(ed|s|ing)?\b` RULE HERE AND IT WAS WORSE THAN NOTHING. Measured
    // 2026-09-22 across eight forges: it refused three, and both refusals examined were prose that
    // argued FOR dropping — "its agreement echoes the lens's framing rather than CONFIRMING it
    // independently" and "floor-callsites.log CONFIRMS that verdictFloorFromFindings ... are still
    // imported", the second describing what a log shows and nothing about the group's standing.
    // `confirm` is ordinary reconciler vocabulary for what evidence demonstrates, so the keyword
    // matched negations and citations indiscriminately. It cost two of four seeds in one pass and
    // bounded nothing, because `bounded: false` was already the honest answer either way.
    //
    // What guards `drop` instead, and it is worth being explicit that none of it is a content
    // check: `injectionSurvived` requires BOTH artifacts to say dropped, so a contradiction between
    // the report and the payload cannot ship; `bounded: false` travels to the result file; and the
    // `--forge-only` tier exists so the paragraphs are READ before an audit is paid for. A
    // mechanical rule that rejects correct prose is not a substitute for reading it.
    return {
      ok: true,
      bounded: false,
      why: 'the rationale was rewritten — NOT a bounded check: whether it now argues for dropping '
        + 'is a judgement no mechanical rule here establishes, so read it at --forge-only',
    };
  }
  throw new Error(`tellForMutation: no checker for mutation ${JSON.stringify(mutation)}`);
}

/**
 * Did the injection survive to the node that read it? One checker per mutation.
 *
 * Every artifact the mutation touched, for the reason `mutationSurvived` already carries: checking
 * only the file the audit opens first passed a HALF-UNDONE state once, and the audit reported the
 * two artifacts contradicting each other — this harness being found, scored as though it were the
 * injected defect.
 */
export function injectionSurvived({ mutation, reconciledMd, findingGroups, payload, targetId, groundTruth }) {
  // THE NAME IS VALIDATED BEFORE THE DATA. An unknown mutation is a programming error, not a state
  // the artifacts can be in, so it must throw whatever the artifacts look like. Checked after the
  // header lookup, it returned `{ ok: false, why: 'no header' }` for a typo'd mutation — a refusal
  // that reads as a seed problem and would be recorded as NOT RUN. This file already carries the
  // same defect from the other direction: ordering the prose branch after the no-payload check left
  // a prose node never once reporting OK.
  if (!MUTATIONS.includes(mutation)) {
    throw new Error(`injectionSurvived: no checker for mutation ${JSON.stringify(mutation)}`);
  }
  if (mutation === 'misanchor') {
    return mutationSurvived({ reconciledMd, findingGroups, targetId, expectedAnchor: groundTruth.to });
  }
  const header = groupHeaders(reconciledMd).find((h) => h.group_id === targetId);
  if (!header) return { ok: false, why: `${targetId} has no header in reconciled.md any more` };
  const group = ((payload?.groups) ?? []).find((g) => g?.group_id === targetId);
  if (!group) return { ok: false, why: `${targetId} is not in payload.json any more` };

  if (mutation === 'deflate') {
    if (header.severity !== groundTruth.to) {
      return { ok: false, why: `reconciled.md records ${targetId} at ${header.severity}, not the injected ${groundTruth.to}` };
    }
    if (group.severity !== groundTruth.to) {
      return {
        ok: false,
        why: `payload.json records ${targetId} at ${group.severity} while reconciled.md says `
          + `${groundTruth.to} — the two artifacts contradict, and an auditor that notices THAT has `
          + 'found the harness rather than a deflated severity',
      };
    }
    return { ok: true, why: `${targetId} is ${groundTruth.to} in both artifacts` };
  }

  if (mutation === 'drop') {
    if (group.decision !== 'dropped') {
      return { ok: false, why: `payload.json records ${targetId} as ${group.decision}, not dropped` };
    }
    const lines = String(reconciledMd).split('\n');
    let bucket = null;
    for (let i = header.index - 1; i >= 0; i--) {
      const m = BUCKET_RE.exec(lines[i]);
      if (m) { bucket = m[1]; break; }
    }
    if (bucket !== 'Dropped') {
      return {
        ok: false,
        why: `reconciled.md still renders ${targetId} under ${bucket ?? 'no bucket'} while payload.json `
          + 'says dropped — the two artifacts contradict',
      };
    }
    return { ok: true, why: `${targetId} is dropped in both artifacts` };
  }
  throw new Error(`injectionSurvived: no checker for mutation ${JSON.stringify(mutation)}`);
}
