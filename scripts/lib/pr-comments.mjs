// A FINISHED REVIEW'S FINDINGS AS ONE PULL-REQUEST REVIEW (.claude/requests/pr-review-comments.md).
//
// What is posted is decided here, and only here: one inline comment per confirmed finding whose cited line is in the pull
// request's diff, and one summary carrying the gate verdict, the lenses that did not report, and every confirmed finding
// that could not be placed inline (AC2). The text is for the people reading the pull request, never a model's: it is
// built from the run's own records, and nothing here reads a disk or calls GitHub. Pure.
//
// Every body is redacted by the one owner of secret shapes before it is cut (G-6 of 20261120-231702-prc-delivery): a
// rationale or a lens's reason is model prose that can quote an evidence log, and --post publishes it. Best-effort, as
// that owner says (ARCHITECTURE A-10).
import { confirmedGroups } from './run-artifacts.mjs';
import { redactClaim } from './redact.mjs';

/** GitHub refuses a comment body over 65,536 characters; each body is cut well below, and says it was cut. */
export const COMMENT_MAX = 8000;
/** The summary's own bound, and the most of one unplaced finding's first line it lists. */
const SUMMARY_MAX = 60000;
const ITEM_MAX = 1000;
const cut = (text, max = COMMENT_MAX) => {
  const clean = redactClaim(text);
  return clean.length <= max ? clean : `${clean.slice(0, max - 40)}\n\n(cut at ${max} characters)`;
};

/**
 * The lines on the right side of a unified diff patch that a review comment may sit on: every added and context line of
 * every hunk, by its new-file line number. GitHub's file list gives `patch` per file; a file with no patch (binary, or
 * too large for GitHub to render) has no line a comment can sit on.
 */
export function rightSideLines(patch) {
  const lines = new Set();
  let at = null;
  for (const l of String(patch ?? '').split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { at = Number(h[1]); continue; }
    if (at === null) continue;
    if (l.startsWith('-') || l.startsWith('\\')) continue;
    // A context line starts with a space; an empty string is the patch's trailing newline, not a line.
    if (l.startsWith('+') || l.startsWith(' ')) { lines.add(at); at++; }
  }
  return lines;
}

// Each group's anchor, indexed once per review (G-5 of 20261123-174149-m3s9-remediation-review-b: a linear find per
// confirmed group). The first record of an id wins, as find's did.
const anchorsOf = (groups) => {
  const m = new Map();
  for (const g of Array.isArray(groups?.groups) ? groups.groups : []) if (g && !m.has(g.group_id)) m.set(g.group_id, g);
  return m;
};

/**
 * The review to post: `{ commit_id, event, body, comments, placed, unplaced }`, the first four GitHub's review shape.
 *   runId       the run's id
 *   gate        the run's gate.json (its `gate` and `buckets.did_not_report` are read)
 *   payload     the reconcile payload (readReconcileArtifacts' `payload`), whose confirmed groups are the set (AC2)
 *   groups      finding-groups.json, which carries each group's file and line
 *   files       the pull request's files, `[{ filename, patch }]`
 *   commitId    the head commit the run reviewed, which the comments are pinned to
 */
export function buildReview({ runId, gate, payload, groups, files, commitId }) {
  const onDiff = new Map((files ?? []).map((f) => [f.filename, rightSideLines(f.patch)]));
  const comments = [];
  const placed = [];
  const unplaced = [];
  const anchors = anchorsOf(groups);
  for (const g of confirmedGroups(payload)) {
    const anchor = anchors.get(g.group_id) ?? null;
    const file = anchor?.file ?? null;
    const line = Number.isInteger(anchor?.line) ? anchor.line : null;
    const head = `**${g.group_id} · ${g.severity ?? 'unrated'}** (quorate run \`${runId}\`)`;
    const text = String(g.rationale ?? '').trim() || '(no rationale recorded)';
    if (file && line !== null && onDiff.get(file)?.has(line)) {
      comments.push({ path: file, line, side: 'RIGHT', body: cut(`${head}\n\n${text}`) });
      placed.push(g.group_id);
    } else {
      unplaced.push({ id: g.group_id, severity: g.severity ?? 'unrated', where: file ? `${file}${line !== null ? `:${line}` : ''}` : 'no file', text });
    }
  }
  const silent = (gate?.buckets?.did_not_report ?? []).filter((b) => b && typeof b.node_id === 'string');
  const L = [`## quorate review \`${runId}\`: gate ${gate?.gate ?? 'unknown'}`, ''];
  // WHY THE GATE IS WHAT IT IS, when the gate says (pr-review-comments.md AC1; operator, 2026-11-20: "Summary with the
  // reason"): a run that gated without reviewing, a pre-flight failure among them, would otherwise post a verdict and no
  // finding, which on a pull request reads as nothing found.
  if (typeof gate?.reason === 'string' && gate.reason.trim()) L.push(`Reason: ${gate.reason.trim().split('\n')[0]}`, '');
  L.push(`${placed.length} confirmed finding(s) are commented on their lines; ${unplaced.length} are listed below because their line is not in this pull request's diff.`);
  if (silent.length) {
    L.push('', '### Did not report', '', 'A required lens that did not report makes the gate BLOCKED, never PASS.', '');
    for (const b of silent) L.push(`- \`${b.node_id}\`: ${String(b.why ?? '').split('\n')[0]}`);
  }
  const unchecked = (gate?.buckets?.not_checked ?? []).filter((b) => b && typeof b.node_id === 'string');
  if (unchecked.length) {
    L.push('', '### Not checked', '');
    for (const b of unchecked) L.push(`- \`${b.node_id}\`: ${String(b.why ?? '').split('\n')[0]}`);
  }
  if (unplaced.length) {
    L.push('', '### Confirmed, not on a line of this diff', '');
    // BOUNDED BY ITEM, NOT CUT AFTER (G-13 of 20261123-161216-m3s9-review): the whole list was built and the body cut at
    // SUMMARY_MAX, so trailing findings fell off, one could be split, and the caller still counted them all as listed.
    // An item that would not fit is named in one closing line, so every unplaced id is in the body. Each item is
    // redacted before it is measured, as cut does, so the measure is of what is posted.
    let used = redactClaim(L.join('\n')).length;
    const rest = [];
    for (const u of unplaced) {
      // Redacted BEFORE it is cut (G-6 of 20261123-174149-m3s9-remediation-review-b): a cut inside a quoted credential
      // drops its closing quote, and the quote-anchored pattern then misses the value.
      const item = redactClaim(`- **${u.id} · ${u.severity}** \`${u.where}\`: ${redactClaim(u.text.split('\n')[0]).slice(0, ITEM_MAX)}`);
      const tailRoom = 60 + (unplaced.length - rest.length) * 12;
      if (rest.length || used + item.length + 1 + tailRoom > SUMMARY_MAX) { rest.push(u.id); continue; }
      L.push(item);
      used += item.length + 1;
    }
    if (rest.length) L.push(`- ${rest.length} more not listed for length: ${rest.join(', ')}`);
  }
  return { commit_id: commitId, event: 'COMMENT', body: cut(L.join('\n'), SUMMARY_MAX), comments, placed, unplaced: unplaced.map((u) => u.id) };
}

/**
 * Why the run may not be posted, or null (AC1, AC5): it has not gated, or the tree it reviewed was dirty or not known
 * clean, or the pull request's head is not the commit it reviewed.
 */
export function postRefusal({ gated, record, prHead }) {
  if (!gated) return 'the run has not gated (no gate.json): a review is posted only once it has a verdict';
  // A tree dirty only in generated files (run records under generated_globs) is the commit's for every line a finding can
  // cite, so it is posted (operator, 2026-11-23: "Fix the rule, post this run (Recommended)"). A run that predates
  // dirty_outside_generated, or could not establish it, is refused as before.
  const onlyGenerated = record?.dirty === true && Array.isArray(record?.dirty_outside_generated)
    && record.dirty_outside_generated.length === 0;
  if (record?.dirty !== false && !onlyGenerated) {
    return record?.dirty === true
      ? 'the run reviewed a dirty tree, so the lines it cited may not be the commit\'s'
      : 'the run could not tell whether its tree was clean, so the lines it cited may not be the commit\'s';
  }
  if (!record?.head_commit) return 'the run records no head_commit, so it cannot be matched to the pull request';
  if (prHead !== record.head_commit) {
    return `the pull request's head is ${prHead}, the run reviewed ${record.head_commit}: a comment on a moved line would point at the wrong code`;
  }
  return null;
}
