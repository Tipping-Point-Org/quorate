// THE DEPTH GUARD'S PARSE, ONE OWNER (entrypoint-argv.plan.md stage 2; operator, 2026-10-20: "One lib function, same plan
// (Recommended)"). Thirteen entry scripts read GRAPH_NODE_DEPTH with the same expression, copied; this is that expression.
//
// The rule (the plan's stage 2):
//   - absent is depth 0, a top-level run;
//   - present but empty or blank is UNREADABLE, not 0 (G-6, contract-audit against I-16: Number('') is 0, so a value
//     that says nothing read as top level through a check whose purpose is to refuse what it cannot read);
//   - otherwise it must be plain decimal digits, or it is unreadable. The thirteen copies used Number(), which also read
//     ' 1', '1.0', '0x1' and '1e0' as 1, and the first build kept that; G-9 of 20261020-151402-argv-delivery held it to
//     the plan (operator, 2026-10-20: "Tighten depth, amend plan for shapes (Recommended)").
//
// What a script does with the depth stays its own: most refuse an unreadable one and abort above 0, remediate refuses any
// depth but 0, spawn-node adds one for its child (§8). Pure: the environment is passed in.

/** { raw, depth } from env.GRAPH_NODE_DEPTH: depth is a non-negative integer, or null when the value cannot be read. */
export function nodeDepth(env = {}) {
  const raw = env.GRAPH_NODE_DEPTH;
  const n = raw === undefined ? 0 : (/^[0-9]+$/.test(String(raw)) ? Number(raw) : NaN);
  return { raw, depth: Number.isSafeInteger(n) && n >= 0 ? n : null };
}
