// reconcile-diff.mjs — pure comparison of two reconcile adjudications of the same groups.
//
// The fan-out is redundant by design; the fan-in is not: one context decides confirmed, symptom,
// coincidence or dropped for every group, and a dropped group is gone. Nothing measured how
// stable that judgment is. Running the reconciler twice on the SAME finding-groups.json and
// diffing the decisions turns the single point of judgment into a measured one: the disagreement
// rate is the calibration figure the barrier never had, and the specific groups the two runs
// decide differently are precisely the ones deserving a closer look.
//
// This is measurement, not adjudication: the first reconcile's output remains the run's output.
// A differ that silently changed which findings survive would put a script in charge of the one
// judgment the doctrine reserves for a model.

const DECISIONS = ['confirmed', 'symptom', 'coincidence', 'dropped'];

/**
 * Diff two payloads' group decisions. Groups present in one payload and absent from the other are
 * disagreements of the strongest kind — one adjudicator did not even judge what the other did —
 * and are listed separately rather than folded into the rate quietly.
 */
export function diffAdjudications(a, b) {
  const aGroups = new Map((a?.groups ?? []).map((g) => [g.group_id, g]));
  const bGroups = new Map((b?.groups ?? []).map((g) => [g.group_id, g]));

  const agreed = [];
  const diverged = [];
  const onlyA = [];
  const onlyB = [];

  for (const [id, ga] of aGroups) {
    const gb = bGroups.get(id);
    if (!gb) { onlyA.push(id); continue; }
    const decisionsDiffer = ga.decision !== gb.decision;
    const severitiesDiffer = ga.severity !== gb.severity;
    if (decisionsDiffer || severitiesDiffer) {
      diverged.push({
        group_id: id,
        a: { decision: ga.decision, severity: ga.severity },
        b: { decision: gb.decision, severity: gb.severity },
        // A confirmed/dropped split is the costly kind: one adjudicator kept what the other
        // erased. Severity-only drift is noise by comparison, and the flag lets a reader sort.
        decision_flip: decisionsDiffer,
        kept_vs_erased: decisionsDiffer &&
          ((ga.decision === 'confirmed' && gb.decision === 'dropped') ||
           (ga.decision === 'dropped' && gb.decision === 'confirmed')),
      });
    } else {
      agreed.push(id);
    }
  }
  for (const id of bGroups.keys()) if (!aGroups.has(id)) onlyB.push(id);

  const judgedBoth = agreed.length + diverged.length;
  return {
    groups_judged_by_both: judgedBoth,
    agreed: agreed.sort(),
    diverged: diverged.sort((x, y) => Number(y.kept_vs_erased) - Number(x.kept_vs_erased) || x.group_id.localeCompare(y.group_id)),
    only_in_a: onlyA.sort(),
    only_in_b: onlyB.sort(),
    disagreement_rate: judgedBoth ? Number((diverged.length / judgedBoth).toFixed(3)) : null,
    intent_verdicts_differ: Boolean(a?.intent_intact) !== Boolean(b?.intent_intact),
  };
}

/** Sanity: a payload with no groups array judged nothing; diffing it would report false calm. */
export function payloadJudgedSomething(p) {
  return Array.isArray(p?.groups) && p.groups.length > 0 &&
    p.groups.every((g) => g && typeof g.group_id === 'string' && DECISIONS.includes(g.decision));
}

/**
 * One finding's line in reconciled.md.
 *
 * I-2 requires finding-groups.json AND reconciled.md to label every finding with its source.
 * Carrying `source` through the grouping projection fixed only the first: the renderer printed
 * node_id, claim and evidence_path, so the report a human reads — and the work list remediate
 * consumes — showed no family at all. Cross-family agreement outweighing two same-family lenses is
 * the property the panel exists to provide, and it was invisible in the artifact that presents it.
 *
 * A missing source renders as nothing rather than as a guess: absent provenance must not read as
 * "internal", which is an inference the reader should not have to make. The node-id prefix is a
 * convention, not a label.
 */
export function renderGroupFinding(f) {
  const src = String(f?.source ?? '').trim();
  const who = src ? `\`${f.node_id}\` · ${src}` : `\`${f.node_id}\``;
  return `- ${who}: ${f?.claim ?? ''} (evidence: \`${f?.evidence_path ?? '(none)'}\`)`;
}
