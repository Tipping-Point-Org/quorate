// capabilities.mjs — what a runtime must provide, and what a node may claim as a result.
//
// THE INVERSION THIS MODULE EXISTS FOR. Two facts used to be assigned rather than derived:
//
//   run-graph.mjs:442   allowed_basis: ['convention']          // for every external arm, always
//   run-graph.mjs:446   severity_ceiling 'MEDIUM', verdict_ceiling 'RISK'
//
// Both are correct for the adapters that ship, and both were unreachable by any adapter — so the
// framework could not distinguish "this runtime cannot produce verifiable evidence" from "this
// runtime is a third party". They are the same value for opposite reasons, and only the first is a
// property of anything. A runtime that CAN run capture.mjs inside the run directory and cite what it
// printed has earned `measurement` by the same §4 rule that governs a Claude lens; nothing about
// its vendor changes that.
//
// So: quorate states the requirement, the adapter declares what it meets, and what a node may claim
// falls out. shared/adapter-contract.md is the prose owner — what each capability is FOR, what it
// achieves, and what is lost without it. This module is the decision, kept pure so it is testable
// without spawning anything.
//
// DECLARATION IS NOT PROOF, and the doctrine says so: an adapter asserting `path_scoped_read` is
// making a claim this framework cannot currently check. It is recorded in the run for exactly that
// reason — a reader must be able to see what a guarantee rests on.

import { renderTemplate } from './template.mjs';
import { familyOfCall } from './reviewers.mjs';
import { toolList, shellToolKeys } from './tool-lists.mjs';
import { SEVERITY_RUNGS, VERDICTS } from './decisions.mjs';

/** Every capability quorate knows how to ask for. An unknown one is a typo, not an extension. */
export const CAPABILITIES = Object.freeze([
  'structured_output',
  'evidence_capture',
  'path_scoped_read',
  'content_tool_denial',
  'no_write',
  'budget_bound',
  'wall_clock_bound',
  'credential_scoping',
]);

/**
 * What each role needs. A role is refused when a requirement is unmet, and the refusal names which
 * one — the difference between a wall and a specification.
 */
export const ROLE_REQUIREMENTS = Object.freeze({
  lens: ['structured_output', 'evidence_capture', 'path_scoped_read', 'content_tool_denial', 'no_write'],
  // No evidence_capture: intent capture reads declared documents and writes criteria. It must not
  // execute anything, so requiring an execution channel would be requiring the wrong thing.
  intent: ['structured_output', 'path_scoped_read', 'content_tool_denial', 'no_write'],
  arm: ['structured_output'],
  'tie-break': ['structured_output'],
});

/**
 * The basis ladder, as DATA. Callers pass the table from lens-roster.json.
 *
 * `convention` capping at MEDIUM was two literals in this file, and the operator asked the obvious
 * question: why is a judgement about what evidence is WORTH not kept where models, vendors and
 * efforts already are? It is exactly that — a judgement, made today, about what an unverifiable
 * claim can carry — and a judgement nobody can change without editing the engine is indistinguishable
 * from a law. It is declared in lens-roster.json under `basis_ceilings` now.
 *
 * Nothing here grants anything: raising a ceiling changes what the framework will HONOUR, while the
 * validator still rejects a basis a node was not permitted to use. §4 owns the reasoning; the roster
 * owns the numbers; this owns neither and only applies them.
 *
 * A caller that supplies no table gets the conservative floor — every basis capped — rather than an
 * uncapped one. Absent configuration must not read as permission.
 */
export const CONSERVATIVE_BASIS = Object.freeze({
  convention: { severity_ceiling: 'MEDIUM', verdict_ceiling: 'RISK', requires: null },
});

/** The declared capabilities of an adapter, as a Set. Anything undeclared is absent, never assumed. */
export function adapterCapabilities(adapter) {
  const declared = Array.isArray(adapter?.capabilities) ? adapter.capabilities : [];
  return new Set(declared.filter((c) => CAPABILITIES.includes(c)));
}

/** Declared names quorate does not recognise. A typo in a capability is a silently weaker node. */
export function unknownCapabilities(adapter) {
  const declared = Array.isArray(adapter?.capabilities) ? adapter.capabilities : [];
  return declared.filter((c) => !CAPABILITIES.includes(c));
}

/**
 * What this adapter is missing for a role, or [] when it can serve it.
 *
 * An unknown role returns its own error rather than passing: a caller asking for a role nobody
 * declared is a bug, and answering "no requirements" would silently grant everything.
 */
export function roleGaps(adapter, role) {
  const required = ROLE_REQUIREMENTS[role];
  if (!required) return [`unknown role '${role}'`];
  const have = adapterCapabilities(adapter);
  return required.filter((c) => !have.has(c));
}

/**
 * The bases a node running on this adapter may claim, in ladder order.
 *
 * `intent` is included whenever the node is given criteria to judge against — that is a property of
 * the ROLE, not of the runtime, so it is left to the roster and simply not removed here.
 */
export function allowedBasisFor(adapter, declared = null, ladder = CONSERVATIVE_BASIS) {
  const have = adapterCapabilities(adapter);
  const table = ladder ?? CONSERVATIVE_BASIS;
  const candidate = Array.isArray(declared) && declared.length ? declared : Object.keys(table);
  return candidate.filter((b) => {
    // A basis the ladder does not describe is not silently permitted: an undeclared rung is one
    // nobody decided the weight of, and defaulting it to "allowed" would let a typo in a roster
    // grant the top of the ladder.
    const rung = table[b];
    if (!rung) return false;
    return !rung.requires || have.has(rung.requires);
  });
}

/**
 * The ceilings that follow from what this adapter can substantiate.
 *
 * MEDIUM/RISK is what falls out of having no evidence channel, which is exactly the pair the arms
 * carried as literals. The values do not change for the adapters that ship — what changes is that
 * they are now a consequence with a stated reason, and an adapter that gains the capability stops
 * being capped without anyone editing the roster.
 *
 * `reason` is returned because a cap a reader cannot explain is indistinguishable from an arbitrary
 * one, and this framework has already found one of those in itself.
 */
export function capsFor(adapter, ladder = CONSERVATIVE_BASIS) {
  const table = ladder ?? CONSERVATIVE_BASIS;
  // ROLE-GRANTED RUNGS ARE EXCLUDED. `intent` requires no capability — its authority comes from the
  // freeze, not from the runtime — so counting it here made EVERY runtime uncapped the moment the
  // ladder became data. Caught by checking the derived values against the ones the tree had always
  // produced, which is the only reason a refactor like this is safe to make.
  const substantiable = Object.fromEntries(
    Object.entries(table).filter(([, rung]) => !rung?.role_granted),
  );
  const reachable = allowedBasisFor(adapter, null, substantiable);
  if (!reachable.length) {
    // A runtime that can substantiate NOTHING on the declared ladder is not a strict node; it is a
    // node whose every finding would be rejected. Capped at the floor and said so.
    const floor = substantiable.convention ?? table.convention ?? CONSERVATIVE_BASIS.convention;
    return {
      severity_ceiling: floor.severity_ceiling,
      verdict_ceiling: floor.verdict_ceiling,
      reason: 'this runtime satisfies no basis on the declared ladder',
    };
  }
  // THE WEAKEST RUNG IT CAN REACH DECIDES, because a node claims one basis per finding and the
  // framework must bound what it will honour by the best evidence available to it. The reason names
  // the rung and what it lacks, so an auditor can answer "why was this capped" from the artifact —
  // the question that produced G-14, where the declared place to look held nothing.
  let best = null;
  for (const b of reachable) {
    const rung = substantiable[b];
    if (!best || rankOf(rung) > rankOf(best.rung)) best = { basis: b, rung };
  }
  const { severity_ceiling = null, verdict_ceiling = null } = best.rung;
  if (!severity_ceiling && !verdict_ceiling) return { severity_ceiling, verdict_ceiling, reason: null };

  // NAMES THE RUNG *AND* WHAT WOULD LIFT IT. A reason that says only "capped at convention" tells a
  // reader what happened; naming the capability the next rung needs tells them what to do about it,
  // and that is the whole point of stating requirements rather than assigning caps. The missing
  // capability is what a reader needs to answer "why is this third party's finding worth less" —
  // and the answer is never "because it is a third party".
  const blocked = [...new Set(
    Object.values(substantiable).map((r) => r?.requires).filter(Boolean),
  )].filter((cap) => !adapterCapabilities(adapter).has(cap));
  return {
    severity_ceiling,
    verdict_ceiling,
    reason: `the strongest basis this runtime can substantiate is \`${best.basis}\``
      + (blocked.length ? `; it declares no ${blocked.join(', ')}` : '')
      + ' — see basis_ceilings in lens-roster.json',
  };
}

/** An uncapped rung outranks a capped one; that is the whole ordering this needs. */
function rankOf(rung) {
  return (rung?.severity_ceiling ? 0 : 1) + (rung?.verdict_ceiling ? 0 : 1);
}

/**
 * Everything a run should record about one node's runtime, in one object.
 *
 * Written into the artifacts so an auditor can answer "why was this finding capped" without reading
 * the engine — the question that produced G-14, where the declared place to look held nothing.
 */
export function runtimeContract(adapter, role, { declaredBasis = null, ladder = CONSERVATIVE_BASIS } = {}) {
  const gaps = roleGaps(adapter, role);
  const caps = capsFor(adapter, ladder);
  return {
    role,
    capabilities: [...adapterCapabilities(adapter)].sort(),
    unknown_capabilities: unknownCapabilities(adapter),
    eligible: gaps.length === 0,
    missing_for_role: gaps,
    allowed_basis: allowedBasisFor(adapter, declaredBasis, ladder),
    severity_ceiling: caps.severity_ceiling,
    verdict_ceiling: caps.verdict_ceiling,
    cap_reason: caps.reason,
  };
}

/**
 * What an external arm may claim, and how hard it is capped: derived, then tightened by any roster declaration.
 * `cap_reason` rides along so an auditor can answer "why was this capped" from the artifact instead of from the engine.
 * Here rather than in run-graph so it can be run against an edited roster (G-8 of 20261111-015717-dps-remediation-10-review).
 */
export function armLimitsFor(adapter, arm, { ladder = CONSERVATIVE_BASIS, role = 'arm' } = {}) {
  const derived = capsFor(adapter, ladder);
  const stricter = (declared, own, rungs) => {
    // AN UNKNOWN RUNG IS NOT A RUNG (G-6 of 20261111-024650-dps-remediation-11-review): by position it ranked -1, the
    // strictest, so a typo was recorded in expected.json while external-review applied something else.
    if (!rungs.includes(declared)) return own;
    if (!rungs.includes(own)) return declared;
    return rungs.indexOf(declared) < rungs.indexOf(own) ? declared : own;
  };
  // AND TIGHTENED BY THE BASIS THE ARM ACTUALLY EMITS. capsFor answers "what is the strongest rung
  // this runtime could reach", which is the right question for a node that chooses its basis per
  // finding. An external arm does not choose: external-review.mjs stamps `convention` on every
  // finding, because the evidence path it emits is a raw vendor log this run cannot re-derive. So an
  // adapter declaring evidence_capture would have lifted this ceiling above what §4 allows a
  // convention finding, and validateVerdict would have REJECTED the finding outright — a cap raised
  // into a silent drop. The rung the arm stands on decides.
  const table = ladder ?? CONSERVATIVE_BASIS;
  const armRung = table.convention ?? CONSERVATIVE_BASIS.convention;
  return {
    allowed_basis: allowedBasisFor(adapter, ['convention', 'invariant', 'measurement'], ladder),
    // Last against the rung external-review applies whatever it is passed, so what is recorded is what is applied.
    severity_ceiling: stricter(
      stricter(stricter(arm.severity_ceiling, derived.severity_ceiling, SEVERITY_RUNGS), armRung.severity_ceiling, SEVERITY_RUNGS),
      CONSERVATIVE_BASIS.convention.severity_ceiling, SEVERITY_RUNGS,
    ),
    // NEITHER DECLARED NOR DERIVED (G-8 of 20261111-015717-dps-remediation-10-review): a verdict ceiling lowers a verdict,
    // so the "stricter" of PASS and RISK by position was PASS, and capVerdict('RISK', 'PASS') turned an arm that checked
    // nothing into a PASS. The convention rung external-review applies, for every roster and adapter. An exception to
    // ARCHITECTURE A-5, so the roster may only repeat it, on the arm and on the convention rung (verdictCeilingErrors).
    verdict_ceiling: CONSERVATIVE_BASIS.convention.verdict_ceiling,
    runtime: runtimeContract(adapter, role, { ladder }),
  };
}

/**
 * Capabilities this runtime CLAIMS but has given no mechanism for.
 *
 * A declaration the runtime cannot keep is worse than one it never made: the framework grants the
 * role, writes a policy that denies nothing, and reports a sandboxed node. Found by a fixture that
 * declared `content_tool_denial` and supplied no tool names — the deny list came out empty and the
 * spawn looked ordinary.
 *
 * Only mechanisms quorate actually consumes are required. A capability whose mechanism this engine
 * never reads is between the runtime and its own CLI.
 */
export function unbackedCapabilities(adapter) {
  const have = adapterCapabilities(adapter);
  const nr = adapter?.node_runtime ?? {};
  const missing = [];
  // NAMES AND DELIVERY, BOTH. The first version of this checked only that the tool NAMES were
  // declared — and a name nothing carries to the process denies nothing. A runtime declaring
  // `deny_intent: ["Shell"]` with no `deny_tools.flag` renders an argv with no denial in it at all,
  // and the node is reported sandboxed (G-19, security-audit).
  // THROUGH toolList, as denyToolsFor reads them (adapter-tool-lists.plan.md stage 2): a string passed `.length` and
  // `.includes`, a substring match, while denyToolsFor denied nothing (G-4 and G-6 of 20261026-190950-rct-remediation-2-
  // review), and each reader deciding shape itself is how the next list was missed each round.
  if (have.has('content_tool_denial')) {
    const denied = toolList(adapter, 'deny_intent');
    if (!denied.length) {
      missing.push('content_tool_denial (node_runtime.tools.deny_intent names no content-reading tool, as an array)');
    }
    // EVERY CONTENT TOOL THE ADAPTER DECLARES, on any platform (G-1 of 20261026-174311-rct-remediation-review): a
    // non-empty list was taken as proof, so an adapter omitting one of its own shells or content tools passed this guard,
    // was granted the intent role, and kept a tool that reads past the intent sandbox. The set is contentToolsOf's,
    // unioned over every platform key, because this check has no platform and a node may run on any (G-5: asked of
    // contentToolsOf itself, not rebuilt here).
    const content = new Set(shellToolKeys(adapter).flatMap((p) => contentToolsOf(adapter, p)));
    const undenied = [...content].filter((t) => !denied.includes(t));
    if (denied.length && undenied.length) {
      missing.push(`content_tool_denial (node_runtime.tools.deny_intent omits content-reading tool(s) ${undenied.join(', ')})`);
    }
    if (!nr.deny_tools?.flag) {
      missing.push('content_tool_denial (node_runtime.deny_tools names no flag to carry the denials)');
    }
  }
  if (have.has('no_write')) {
    const always = toolList(adapter, 'deny_always');
    if (!always.length) {
      missing.push('no_write (node_runtime.tools.deny_always names no writing tool, as an array)');
    }
    // EVERY WRITING TOOL THE ADAPTER DECLARES (G-6): a non-empty list was taken as proof, so an adapter omitting one of its
    // own edit_tools passed this guard and kept a tool that writes.
    const unblocked = toolList(adapter, 'edit_tools').filter((t) => !always.includes(t));
    if (always.length && unblocked.length) {
      missing.push(`no_write (node_runtime.tools.deny_always omits writing tool(s) ${unblocked.join(', ')})`);
    }
    if (!nr.deny_tools?.flag) {
      missing.push('no_write (node_runtime.deny_tools names no flag to carry the denials)');
    }
  }
  if (have.has('evidence_capture') && !nr.grants?.command_rule) {
    missing.push('evidence_capture (node_runtime.grants.command_rule says how to grant a command)');
  }
  // THE POLICY FILE IS WHAT SCOPES A READ, NOT THE DIRECTORY FLAG. §3 states this as verified
  // empirically and as the opposite of what it looks like: "`--add-dir` alone does NOT confine a
  // node" — an unscoped tool rule in the settings file OUTRANKS the directory sandbox, and an
  // intent node whose policy allowed a bare `Read` read straight into the source tree with no
  // denial recorded at all. Rule 2 is three things together and removing any one silently voids it.
  //
  // Accepting `add_dir.flag` as the whole mechanism meant a runtime could declare path_scoped_read,
  // pass every check, be granted the lens and intent roles, and spawn with the policy written into
  // the run directory and never handed to the process: a node reported as sandboxed whose sandbox
  // was never applied. Unreachable with the shipped entry, which happens to declare `settings`;
  // reachable by the first adapter that does not.
  if (have.has('path_scoped_read')) {
    if (!nr.settings?.flag) {
      missing.push('path_scoped_read (node_runtime.settings names no flag — the POLICY FILE is what '
        + 'scopes a read; --add-dir alone does not confine a node, see §3)');
    }
    if (!nr.add_dir?.flag) {
      missing.push('path_scoped_read (node_runtime.add_dir names the flag that narrows the directories)');
    }
  }
  // A schema nothing carries is a node answering in whatever shape it likes, validated against a
  // contract it never received. Only a NODE runtime carries it there; an external reviewer hands its schema over through
  // its top-level `schema`. The guard read `nr.node_runtime`, a key of the object it already was, so it never fired (G-9).
  if (have.has('structured_output') && !nr.schema?.flag && adapter?.node_runtime !== undefined) {
    missing.push('structured_output (node_runtime.schema names no flag to carry the schema)');
  }
  if (have.has('budget_bound') && !nr.budget?.flag) {
    missing.push('budget_bound (node_runtime.budget names the flag that bounds spend)');
  }
  // THE ONE DECLARED CAPABILITY NOTHING CHECKED (G-18, arch-review). `wall_clock_bound` sat in the
  // vocabulary and in the shipped runtime's list while no role required it, no basis rung required
  // it, this function skipped it, and nodeArgv rendered no timeout slot — a claim that could not be
  // wrong because nothing read it. A capability nothing consumes is worse than an absent one: it
  // reads, in the artifact, exactly like a guarantee.
  //
  // Checked like every other now, and the shipped adapter stopped declaring it, because Claude Code
  // takes no deadline flag. quorate's own outer kill still bounds the node — it always did — and the
  // difference is that the run no longer claims the RUNTIME bounds itself.
  if (have.has('wall_clock_bound') && !nr.timeout?.flag) {
    missing.push('wall_clock_bound (node_runtime.timeout names the flag that bounds wall clock)');
  }
  return missing;
}

// ---------------------------------------------------------------------------- grant mechanisms
/** The platform id (`win32` | `linux` | `darwin`) a caller must pass: scripts/platform's `id`. */
function requirePlatformId(platform, fn) {
  if (typeof platform !== 'string' || !platform) {
    throw new Error(`${fn}: a platform id is required — pass hostPlatform().id; lib/ does not read the host`);
  }
}

/**
 * The tools this runtime exposes that can execute a command, for the given platform.
 *
 * A CAPABILITY LIST IS A CLAIM; THIS IS THE MECHANISM. `evidence_capture` tells the orchestrator
 * that a runtime CAN run capture.mjs; it does not tell it how to say so in a policy file. That
 * spelling — the tool names, and the shape of an allow rule — was hardcoded in new-run.mjs as
 * `Bash`/`PowerShell` and `Tool(command:*)`, which is Claude Code's vocabulary, so a second runtime
 * would have been granted nothing and denied nothing while declaring both.
 *
 * Platform-keyed because tool availability is: Claude Code exposes a separate `PowerShell` tool on
 * Windows and not on POSIX, and a policy naming a tool the host cannot expose is dead weight in a
 * file whose whole value is being small and auditable.
 */
export function shellToolsOf(adapter, platform) {
  // REQUIRED, with no default that reads the host (os-platform-adapters stage 2). A missing id is
  // easy to miss otherwise: `t[undefined] ?? t.default` answers with the default tool set, a
  // plausible answer for the wrong operating system.
  requirePlatformId(platform, 'shellToolsOf');
  // Through toolList: a bare spread threw on `{ default: 1 }` (G-3 of 20261026-194518-rct-remediation-3-review).
  return toolList(adapter, 'shell_tools', platform);
}

/**
 * The tools this runtime exposes that return file CONTENT, and which `content_tool_denial`
 * therefore has to deny. Shells count — `Get-Content` and `Select-String` read a file as surely as
 * a search tool does, which is the hole that left every intent node on Windows able to read the
 * implementation it exists to precede.
 */
export function contentToolsOf(adapter, platform) {
  return [...new Set([...shellToolsOf(adapter, platform), ...toolList(adapter, 'content_tools')])];
}

/**
 * Render the allow rules that let this runtime execute `command`.
 *
 * THE CALLER SUPPLIES EVERY SPELLING IT NEEDS GRANTED, and that is not a detail. A permission rule
 * matches the command STRING, so the capture grant has always carried two forms — `node <path>` and
 * `node "<path>"` — because a path containing a space is denied by the unquoted rule alone. The
 * first version of this function generated the second form itself, by wrapping the WHOLE command:
 * it produced `Tool("node <path>":*)` where the tree had `Tool(node "<path>":*)`. Same character
 * count, different rule, and the case it exists for — a checkout under a directory with a space —
 * would have silently lost its evidence channel. Quoting is the caller's business, because only the
 * caller knows which part of its command is a path.
 */
export function grantRules(adapter, commands, platform, { exact = false } = {}) {
  requirePlatformId(platform, 'grantRules');
  const g = adapter?.node_runtime?.grants;
  // EXACT vs PREFIX is a security property, not a spelling. A declared build command is granted as
  // written; a capture invocation needs the open tail because its arguments vary per node. An
  // adapter that declares only the prefix form gets no exact rules rather than a silently widened
  // one — a rule that grants more than the caller asked for is the wrong kind of fallback.
  const template = exact ? g?.command_rule_exact : g?.command_rule;
  if (!template) return [];
  const list = (Array.isArray(commands) ? commands : [commands])
    .map((c) => String(c ?? '').trim())
    .filter(Boolean);
  const out = [];
  for (const tool of shellToolsOf(adapter, platform)) {
    for (const cmd of list) {
      // The one template grammar (G-7 of 20261023-214545-ger-remediation-review): a `$` is literal, a stray slot refused.
      out.push(renderTemplate(template, { tool, command: cmd }, `${exact ? 'command_rule_exact' : 'command_rule'}`));
    }
  }
  return out;
}

/**
 * Rules scoping the runtime's edit tools to contract globs, for a REMEDIATE node (remediate-rebuild stage 3).
 *
 * RELATIVE, because only relative rules scope: measured 2026-10-08 on Windows, `Edit(src/**)` confined writes to src/,
 * resolved against the node's working directory, while the absolute spelling granted nothing at all. A glob that is
 * absolute (POSIX root or a drive letter) or climbs out with `..` cannot be expressed as a confining rule, so it is
 * REFUSED and returned in `refused` — never rendered as a rule that would grant nothing or something unintended.
 */
export function pathRules(adapter, globs) {
  const template = adapter?.node_runtime?.grants?.path_rule;
  const tools = toolList(adapter, 'edit_tools');
  const rules = [];
  const refused = [];
  if (!template || !tools.length) return { rules, refused: [...(globs ?? [])] };
  for (const raw of globs ?? []) {
    const g = String(raw ?? '').trim().replace(/\\/g, '/');
    if (!g || g.startsWith('/') || /^[A-Za-z]:/.test(g) || g.split('/').includes('..')) { refused.push(raw); continue; }
    for (const tool of tools) rules.push(renderTemplate(template, { tool, path: g }, 'path_rule'));
  }
  return { rules, refused };
}

/**
 * What a REMEDIATE node may never edit, as repository-relative globs (G-4 of 20261008-214527-remediate-rebuild-review,
 * HIGH): the code that confines it and the records it is judged by. The framework's own directory — capture.mjs,
 * remediate.mjs and everything they import; the hooks a commit runs; git's own directory; the settings files a
 * node loads; the run directories; and whatever the contract declares generated. A path outside the repository needs no
 * rule (an edit grant never reaches it) and gets none. When the framework IS the repository, no glob can protect it,
 * and new-run refuses that case instead.
 */
export function editDenyPaths({ frameworkRel, reviewsRel, generatedGlobs = [] }) {
  // A `..` SEGMENT leaves the repository, not a name beginning with `..` (G-10 of 20261105-074139-crsf-remediation-3-review:
  // the character-prefix test gave `..framework` no deny rule).
  const inside = (rel) => typeof rel === 'string' && rel !== '' && !rel.split(/[\\/]/).includes('..') && !/^[A-Za-z]:|^[\\/]/.test(rel);
  const out = [];
  if (inside(frameworkRel)) out.push(`${frameworkRel.replace(/\/+$/, '')}/**`);
  out.push('.claude/hooks/**', '.git/**', '.claude/settings.json', '.claude/settings.local.json');
  if (inside(reviewsRel)) out.push(`${reviewsRel.replace(/\/+$/, '')}/**`);
  for (const g of generatedGlobs ?? []) if (inside(String(g))) out.push(String(g));
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------- assignment checks
/**
 * Is this (model, effort) pair one the runtime will actually accept?
 *
 * WHY THIS EXISTS AT MINT AND NOT AT SPAWN. A roster assigns a model and an effort to every lens,
 * every arm and the tie-breaker. Most of those spawn in the first minute; the tie-breaker spawns
 * only when a lens and an arm contradict each other, and `ui-audit` only when a project declares a
 * UI surface. An invalid assignment on one of those surfaces two hours in, on the rare node, after
 * the run has already spent its quota — and it reads as a transport failure rather than as a typo
 * in a config file.
 *
 * ERRORS ARE ONLY FOR CLOSED SETS. An effort vocabulary is closed — the CLI parses a fixed enum and
 * rejects anything else — so checking it here cannot produce a false refusal. A MODEL list is not:
 * vendors add models constantly, and a preflight that blocks a valid new model is worse than the
 * crash it prevents. So an unknown model is a WARNING and never stops a run.
 *
 * The sharp case is neither: agy takes `--effort` for most models and REJECTS it for names that
 * already carry the effort in the label, like the pinned `Gemini 3.1 Pro (High)`. Two documents in
 * this repository disagreed about that for weeks, both half right, with nothing enforcing either.
 */
export function validateAssignment(adapter, { model = '', effort = '', label = 'assignment', name = '' } = {}) {
  const errors = [];
  const warnings = [];
  if (!adapter) return { errors: [`${label}: no adapter`], warnings };
  // THE ADAPTER'S NAME, not its binary. `codex` and `codex-review` share a cmd, so a message built
  // from cmd alone names the wrong entry — and a preflight whose error points at the wrong config
  // line costs more than the crash it replaced.
  const who = name || adapter.cmd || '(unnamed)';

  const m = String(model ?? '').trim();
  const e = String(effort ?? '').trim();
  // Reviewer adapters keep effort at the top level; a node runtime keeps it under node_runtime.
  const eff = adapter.effort ?? adapter.node_runtime?.effort ?? {};

  if (e) {
    if (eff.style === 'none') {
      errors.push(`${label}: '${who}' takes no reasoning effort, but '${e}' is assigned`);
    }
    if (Array.isArray(eff.values) && eff.values.length && !eff.values.includes(e)) {
      errors.push(`${label}: '${e}' is not an effort '${who}' accepts (${eff.values.join('|')})`);
    }
    if (eff.rejected_when_model_matches && m) {
      let re = null;
      // A malformed pattern is the adapter author's bug and must not pass silently as "no rule".
      try { re = new RegExp(eff.rejected_when_model_matches); } catch {
        errors.push(`${label}: '${who}' declares an unparseable effort.rejected_when_model_matches`);
      }
      if (re?.test(m)) {
        errors.push(`${label}: '${who}' rejects an effort for model '${m}' — that name already `
          + 'encodes its effort, so the effort key must be omitted');
      }
    }
  }

  if (!m && adapter.model_required) errors.push(`${label}: '${who}' requires a model and none is assigned`);
  if (m && Array.isArray(adapter.known_models) && adapter.known_models.length && !adapter.known_models.includes(m)) {
    // ADVISORY, never fatal. Model lists go stale between releases, and a preflight that refuses a
    // model the vendor shipped last week is a worse failure than the one it is preventing.
    warnings.push(`${label}: '${m}' is not in '${who}'s known model list — check the spelling`);
  }
  return { errors, warnings };
}

/**
 * Every assignment a roster makes, checked in one pass, before anything spawns.
 *
 * `resolve` maps a reviewer/runtime name to its adapter; the caller owns that lookup because it
 * knows which table (built-in plus contract-declared) this run is using.
 */
export function validateRoster(roster, resolve, { defaultRuntime = null, defaults = {} } = {}) {
  const errors = [];
  const warnings = [];
  const check = (adapterName, label, model, effort) => {
    if (!adapterName) {
      // A lens with a model or an effort but no resolvable runtime is a configuration hole, and
      // naming it 'null' would send a reader looking for an adapter by that name.
      errors.push(`${label}: no runtime resolved — the roster names none and no default was supplied`);
      return;
    }
    const adapter = resolve(adapterName);
    if (!adapter) { errors.push(`${label}: no adapter named '${adapterName}'`); return; }
    const r = validateAssignment(adapter, { model, effort, label, name: adapterName });
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  };

  // EVERY LENS, ON ITS EFFECTIVE VALUES (G-20, panel-codex-contract). This validated a lens only
  // when that lens carried its OWN model or effort — and 7 of this repository's 8 lenses inherit the
  // contract's `review.models.judgment` and `review.effort.judgment`. So the preflight checked one
  // lens out of eight, and a bad DEFAULT — the single value that reaches almost every node — was the
  // one thing it could not catch. I-19 asks for every assignment validated at mint; an inherited
  // value is still an assignment.
  //
  // AND EVERY BARRIER NODE, on the same terms (G-30). `rosterNodeSetting` resolves an override over
  // lenses PLUS barrier_nodes and run-graph applies it at spawn, while this loop read lenses alone —
  // two definitions of "which node settings exist", with the runtime's the wider one. So a bad
  // effort pinned on `reconcile` or `second-opinion` passed mint and failed hours later, on the
  // rarest nodes in the graph, which is the late failure this validator exists to prevent.
  //
  // The roster's own `$effort` note tells a future reader to "RE-PIN HERE if the contract ever rises
  // again", pointing straight at the path nothing checked. Raised by arch-review and reached
  // independently by panel-codex-docs — a lens and an external arm from different families.
  //
  // Bare-string entries are legal here (run-graph reads `n.id ?? n`) and carry nothing to check.
  const assignable = [
    ...(roster?.lenses ?? []).map((l) => ['lens', l]),
    ...(roster?.barrier_nodes ?? []).map((n) => ['barrier node', n]),
  ].filter(([, e]) => e && typeof e === 'object');
  for (const [kind, node] of assignable) {
    const model = node.model ?? defaults.model ?? '';
    const effort = node.effort ?? defaults.effort ?? '';
    if (!model && !effort) continue;   // nothing assigned anywhere: nothing to check
    check(node.runtime ?? defaultRuntime, `${kind} ${node.id}`, model, effort);
  }
  for (const arm of roster?.panel_arms ?? []) {
    check(arm.reviewer, `arm ${arm.id}`, arm.model, arm.effort);
  }
  // EVERY ADJUDICATOR, not one. The judge set replaced a `tie_breaker` singleton, and a preflight
  // that checked only the first entry would let a second judge's model/effort pairing fail hours
  // into a run, on the rarest node in the graph — the exact shape reviewers.json warns about for
  // agy's per-model effort rejection.
  for (const j of roster?.adjudicators ?? []) {
    if (j?.reviewer) check(j.reviewer, `adjudicator ${j.id ?? j.reviewer}`, j.model, j.effort);
  }
  // TWO JUDGES MUST BE DISTINGUISHABLE, AND MUST BE DIFFERENT FAMILIES.
  //
  // Nothing checked either. The node id, the evidence directory and the merge key were all built
  // from `judge.reviewer`, so two judges declared on ONE adapter — two codex models, a perfectly
  // reasonable thing to want — would collide on every one of those and silently become one judge
  // whose result depended on which finished last. And `reviewer` is a TRANSPORT, not a family: agy
  // serves Gemini models and Claude ones, so a panel of "two vendors" can be one family wearing two
  // adapter names, which is the single thing a cross-family panel exists not to be.
  {
    const ids = (roster?.adjudicators ?? []).map((j) => j?.id).filter(Boolean);
    const dupId = ids.find((x, i) => ids.indexOf(x) !== i);
    if (dupId) {
      errors.push(`two adjudicators declare id '${dupId}' — the id names the node, its evidence `
        + 'directory and its key in the merge, so a duplicate is one judge silently overwriting another');
    }
    // The duplicate-family check is rosterFamilyErrors', so every caller of it refuses alike (G-1).
    errors.push(...rosterFamilyErrors(roster, resolve));
  }
  errors.push(...verdictCeilingErrors(roster), ...severityCeilingErrors(roster));
  return { errors, warnings };
}

// A SEVERITY CEILING THAT IS NOT A RUNG, refused at mint (G-6 of 20261111-024650-dps-remediation-11-review): nothing checked
// one, so a typo reached the arm's record, and a verdict written here (RISK) was found only when spawn-node died on it.
function severityCeilingErrors(roster) {
  const errors = [];
  const check = (label, key, value) => {
    if (value !== undefined && value !== null && !SEVERITY_RUNGS.includes(value)) {
      errors.push(`${label}: ${key} ${JSON.stringify(value)} is not one of ${SEVERITY_RUNGS.join('|')}`);
    }
  };
  for (const role of [...(roster?.panel_arms ?? []), ...(roster?.adjudicators ?? [])]) {
    check(role?.id ?? role?.reviewer, 'severity_ceiling', role?.severity_ceiling);
  }
  for (const node of [...(roster?.lenses ?? []), ...(roster?.barrier_nodes ?? [])].filter((n) => n && typeof n === 'object')) {
    for (const key of ['severity_ceiling', 'degraded_severity_ceiling']) check(node.id, key, node[key]);
  }
  for (const [basis, rung] of Object.entries(roster?.basis_ceilings ?? {})) {
    if (!basis.startsWith('$')) check(`basis_ceilings.${basis}`, 'severity_ceiling', rung?.severity_ceiling);
  }
  return errors;
}

// A CEILING THE RUN WOULD NOT APPLY, OR ONE THAT PASSES EVERYTHING, refused at mint (G-8 of
// 20261111-015717-dps-remediation-10-review). A verdict ceiling lowers a verdict, so a ceiling of PASS turns every verdict
// into PASS. An arm's is fixed (armLimitsFor), so an entry may only repeat it. One that is no verdict at all would pass
// mint and kill its lens at spawn, after the run had started (G-7 of 20261111-042301-dps-a5-review).
function verdictCeilingErrors(roster) {
  const errors = [];
  const notAVerdict = (value) => value !== undefined && value !== null && !VERDICTS.includes(value);
  const armCeiling = CONSERVATIVE_BASIS.convention.verdict_ceiling;
  // The judges too: their limits come from armLimitsFor as well.
  for (const arm of [...(roster?.panel_arms ?? []), ...(roster?.adjudicators ?? [])]) {
    if (arm?.verdict_ceiling !== undefined && arm?.verdict_ceiling !== null && arm.verdict_ceiling !== armCeiling) {
      errors.push(`arm ${arm.id}: verdict_ceiling ${JSON.stringify(arm.verdict_ceiling)} would not be applied: an external arm's verdict is capped at ${armCeiling}`);
    }
  }
  const nodes = [...(roster?.lenses ?? []), ...(roster?.barrier_nodes ?? [])].filter((n) => n && typeof n === 'object');
  for (const node of nodes) {
    for (const key of ['verdict_ceiling', 'degraded_ceiling']) {
      const label = key === 'verdict_ceiling' ? key : `${key} (a verdict_ceiling)`;
      if (node[key] === 'PASS') errors.push(`${node.id}: ${label} PASS would turn every verdict into PASS`);
      else if (notAVerdict(node[key])) errors.push(`${node.id}: ${label} ${JSON.stringify(node[key])} is not one of ${VERDICTS.join('|')}`);
    }
  }
  for (const [basis, rung] of Object.entries(roster?.basis_ceilings ?? {})) {
    if (basis.startsWith('$')) continue;
    if (rung?.verdict_ceiling === 'PASS') {
      errors.push(`basis_ceilings.${basis}: verdict_ceiling PASS would turn every verdict into PASS`);
    } else if (basis === 'convention' && rung?.verdict_ceiling !== armCeiling) {
      // The rung every arm stands on, and it does not move them, so an edit here would be accepted and do nothing to them
      // (G-7 of 20261111-024650-dps-remediation-11-review).
      errors.push(`basis_ceilings.convention: verdict_ceiling ${JSON.stringify(rung?.verdict_ceiling)} would not be applied to an external arm, whose verdict is capped at ${armCeiling}`);
    } else if (notAVerdict(rung?.verdict_ceiling)) {
      errors.push(`basis_ceilings.${basis}: verdict_ceiling ${JSON.stringify(rung.verdict_ceiling)} is not one of ${VERDICTS.join('|')}`);
    }
  }
  return errors;
}

// THE ONE FAMILY RULE (runtime-call-telemetry.plan.md stage 1): a role's family is its model's, declared on its adapter
// (familyOfCall); a role's own `family`, where declared, must agree with it, or the panel's neutrality rests on a label.
const rosterFamilyOf = (resolve) => (j) => (j?.reviewer
  ? familyOfCall({ reviewer: j.reviewer, model: j.model }, { [j.reviewer]: resolve(j.reviewer) }) : null);

/**
 * Every roster role whose declared `family` contradicts its adapter's, as refusals. EVERY ROLE THAT NAMES A REVIEWER, in
 * the roster's four shapes, not the judges alone: shared/adapter-contract.md promises the refusal for any roster role, and
 * arms, proposers and the claim checker went unchecked (G-10). Its own export because the refusal must not depend on the
 * caller (G-2 of 20261026-174311-rct-remediation-review): validateRoster runs it at mint, and external-review, the one
 * transport every reviewer role is called through, runs it before each call, so claim-check and candidate-pool refuse
 * the roster new-run refuses.
 */
export function rosterFamilyErrors(roster, resolve) {
  const familyOf = rosterFamilyOf(resolve);
  const roles = [
    ...(roster?.adjudicators ?? []).map((j) => [`adjudicator '${j?.id ?? j?.reviewer}'`, j]),
    ...(roster?.panel_arms ?? []).map((a) => [`arm '${a?.id ?? a?.reviewer}'`, a]),
    ...Object.entries(roster?.proposers ?? {}).filter(([name, p]) => !name.startsWith('$') && p && typeof p === 'object')
      .map(([reviewer, p]) => [`proposer ${reviewer}`, { ...p, reviewer }]),
    ...(roster?.claim_checker ? [['claim_checker', roster.claim_checker]] : []),
    ...(Array.isArray(roster?.decision_panel?.seats) ? roster.decision_panel.seats : [])
      .map((s) => [`decision_panel seat '${s?.reviewer}'`, s]),
  ];
  const errors = [];
  for (const [who, j] of roles) {
    const declared = typeof j?.family === 'string' ? j.family : null;
    const fromAdapter = familyOf(j);
    // AN ADAPTER THAT RESOLVES NO FAMILY FOR THE MODEL is refused, not passed on the role's label (G-3): familyOfCall is
    // null for a model no entry of a per-model list matches. An unknown adapter is refused where it is resolved.
    if (j?.reviewer && resolve(j.reviewer) && !fromAdapter) {
      errors.push(`${who}: adapter '${j.reviewer}' declares no family for model '${j.model ?? ''}' — `
        + 'a family is declared once, on the adapter (familyOfCall), and an unresolved one is never taken from a label');
      continue;
    }
    if (declared && fromAdapter && declared !== fromAdapter) {
      errors.push(`${who} declares family '${declared}', but its adapter '${j.reviewer}' says `
        + `'${fromAdapter}' for model '${j.model ?? ''}' — a family is declared once, on the adapter (familyOfCall)`);
    }
  }
  // TWO JUDGES OF ONE FAMILY, here rather than in validateRoster alone (G-1 of 20261026-190950-rct-remediation-2-review):
  // external-review runs this before each direct call, and accepted a same-family pair mint refused. THE ADAPTER'S FAMILY,
  // never the judge's label (G-3 of 20261026-174311-rct-remediation-review); an unresolved judge is refused above.
  const fams = (roster?.adjudicators ?? []).map((j) => familyOf(j)).filter(Boolean);
  const dupFam = fams.find((x, i) => fams.indexOf(x) !== i);
  if (dupFam) {
    // G-7: the advice is to change a judge's model or reviewer, the only things the family is resolved from.
    errors.push(`two adjudicators are family '${dupFam}' — same-family agreement may be one `
      + 'opinion counted twice, which is the failure a panel exists to prevent. A judge\'s family is its adapter\'s '
      + 'for its model (familyOfCall), so give one judge a model or reviewer of another family.');
  }
  return errors;
}

// ---------------------------------------------------------------------------- panel read surface
/**
 * WHAT DIRECTORY A THIRD-PARTY REVIEWER IS POINTED AT, and what the run must record about it.
 *
 * The arm needs the source and nothing else. It was given `repoRoot`, which also contains the run's
 * evidence tree — captured command output that this project's own scripts describe as possibly
 * holding a connection string or a token (G-43).
 *
 * The arm must see what the lens sees, and nothing else. A `git worktree` of the committed state
 * showed it different code on a dirty tree; handing it the repository root showed it the run's
 * evidence as well; and a checkout patched and then searched for links leading out missed another kind
 * of path in each review round. Since arms-read-surface the directory is built from a SNAPSHOT of the
 * working state (scripts/io/snapshot.mjs), and the choice below is only whether it may be used.
 */
/**
 * Is the framework copied into the arms' checkout READY? (G-8 of 20260926-060936-m0-close-r3.) The copy
 * reporting ok is not enough: it succeeds while REFUSING files it will not follow out of the tree, and
 * a refused detector or doctrine file leaves the arms ordered to use inputs that are not there. Ready
 * means the copy completed and every file the arms require exists at the destination. `exists(rel)`
 * is the caller's check of the destination, so this stays pure.
 */
export const FRAMEWORK_REQUIRED = ['scripts/find-inert-features.mjs', 'shared/disk-first-protocol.md'];
export function frameworkCopyReady(copy, exists) {
  if (!copy?.ok) return { ready: false, why: copy?.why ?? 'the framework copy failed' };
  const missing = FRAMEWORK_REQUIRED.filter((rel) => !exists(rel));
  if (missing.length) {
    const refused = new Set((copy.refused ?? []).map((r) => r.rel));
    return { ready: false, why: `the arms' framework lacks ${missing.map((m) => (refused.has(m) ? `${m} (refused)` : m)).join(', ')}` };
  }
  return { ready: true };
}

/**
 * Where the external reviewers stand (.claude/requests/arms-read-surface.md). TWO OUTCOMES: the
 * directory the snapshot builder produced, when it was built and its framework is whole — or no
 * surface at all, stamped PANEL-NO-SAFE-SURFACE, and then no arm and no judge runs.
 *
 * There used to be a third: the repository ROOT, handed over whenever an isolated checkout could not be
 * made faithful, stamped PANEL-SEES-EVIDENCE as "a declared exposure beats a silent wrong answer". It
 * is gone by the operator's decision ("B drop", 2026-09-26). The root is the operator's real tree,
 * every link check that kept missing a class of path was a check of that tree, and in the 26 tracked
 * panel runs since the fallback's stamp existed it never once fired.
 *
 * @param {{ built: {ok: boolean, dir?: string, why?: string}|null, frameworkReady?: boolean }} args
 */
export function panelReadSurface({ built = null, frameworkReady = false } = {}) {
  const noSurface = (why) => ({ cwd: null, isolated: false, stamp: 'PANEL-NO-SAFE-SURFACE', why });
  if (!built) return noSurface("the arms' directory was never built; no external reviewer is given one");
  if (!built.ok) return noSurface(`the arms' directory could not be built (${built.why}); no external reviewer is given a directory`);
  // DEFAULTS FALSE, deliberately: a caller that does not say whether the framework is there has not
  // established it, and an incomplete framework yields confident findings about files that are absent.
  if (!frameworkReady) {
    return noSurface("the framework in the arms' directory is incomplete — the arms would read a tree missing the "
      + 'doctrine and detectors their prompts require; no external reviewer is given a directory');
  }
  return { cwd: built.dir, isolated: true, stamp: null };
}

/**
 * Which panel arms run, given which lenses are present.
 *
 * EXTRACTED SO IT CAN FAIL. This lived inside run-graph as `panelArmsFor()`, reading module state,
 * and the only thing holding it was a test asserting that the SOURCE still contained the string
 * `shadowed?.present` — the grep-shaped assertion this project already records as unable to fail
 * for the behaviour it claims to protect (G-59). A rule that decides what a review actually
 * examines deserves better than a substring match.
 *
 * The rule itself is one line and is criterion 3 of invoke-single-lens-review: an arm runs only
 * when the lens it shadows is RUNNING. That is what makes `--only <lens>` narrow the arms as well
 * as the lenses, rather than restoring the full fan-out beside one lens — the reading the
 * cross-family critique flagged as ambiguous and which would have defeated the request.
 *
 * An arm declaring no `shadows` is selected by nothing, deliberately: it is the shape that would
 * break the narrowing silently, so it is dropped rather than treated as always-on.
 */
export function armsForSelection({ panelArms = [], expected = [] } = {}) {
  const present = new Set(
    (expected ?? []).filter((e) => e?.present).map((e) => e?.node_id),
  );
  return (panelArms ?? []).filter((a) => a?.shadows && present.has(a.shadows));
}

/**
 * May the adjudicators be consulted at all?
 *
 * DELIBERATELY BLIND TO HOW MANY LENSES RAN. A dispute is a contradiction between two reporters
 * about one group, and a single lens plus the arm shadowing it are two reporters — so a one-lens
 * run can produce one exactly as a full sweep can. Criterion 2 of invoke-single-lens-review says
 * adjudication "fires as it does in a full run", and the way to keep that true is for this decision
 * to have no term for the size of the fan-out.
 *
 * The three conditions are the panel's own: the operator has not disabled it for this run, the
 * contract consents to source leaving the machine, and somebody is declared to adjudicate. Note
 * what is NOT here — `panelArms.length`. run-graph's own source records why: the arm-surface stamp
 * was once gated on the arm count, so an exposure was "not merely present, it was UNRECORDED".
 */
export function adjudicationEnabled({ skipPanel = false, externalPanel = false, adjudicators = [] } = {}) {
  return !skipPanel && externalPanel === true && (adjudicators ?? []).some((j) => j?.reviewer);
}

/**
 * The per-node `model` / `effort` override a roster entry declares, for ANY node the graph spawns.
 *
 * `$per_lens_overrides` promises "Any entry may carry an optional 'model' and/or 'effort' that
 * overrides review.models.judgment / review.effort.judgment for that lens alone. Resolution is
 * narrowest-first: call site, then this file, then the contract." Two of those three sentences were
 * false for half the graph:
 *
 *   - `roster.barrier_nodes` was read in exactly ONE place and only for `.id`, so an override on
 *     `reconcile`, `intent-capture`, `request-capture`, `reconcile-b` or `second-opinion` was read
 *     by nothing. Five nodes where the documented mechanism silently did nothing.
 *   - `spawnNode` resolved `effort ?? JUDGMENT_EFFORT` — call site, then contract. The middle rung
 *     the comment directly above it described did not exist. Lenses appeared to work only because
 *     their override is baked into `expected.json` upstream and arrives as a CALL-SITE value.
 *
 * Found by trying to use the feature: an operator-approved, measured `effort: low` on
 * `second-opinion` would have sat in the roster reading as adopted while every run continued at the
 * contract's setting. An inert declaration is worse than an absent one — it answers the question
 * "was this adopted?" with a yes that nothing enforces.
 *
 * Entries may be bare id strings, which carry no override and are not an error.
 */
export function rosterNodeSetting(roster, nodeId) {
  const entries = [...(roster?.lenses ?? []), ...(roster?.barrier_nodes ?? [])];
  const trim = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const hit = entries.find((e) => (typeof e === 'string' ? e : e?.id) === nodeId);
  if (!hit || typeof hit === 'string') return { model: null, effort: null };
  return { model: trim(hit.model), effort: trim(hit.effort) };
}
