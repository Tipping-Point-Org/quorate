// locate.mjs — where the framework's own files are, answered without reference to the repository
// being reviewed.
//
// These were the same value for as long as the framework lived inside the only project that used
// it, and the code said so:
//
//   const scriptsDir = path.join(repoRoot, '.claude/skills/scripts');
//   const skillsDir  = path.join(repoRoot, '.claude/skills');
//
// They are different things. `repoRoot` is the tree under review; this is where the engine lives.
// Conflating them costs three concrete capabilities:
//
//   1. The framework cannot review ITSELF from its own repository, where the skills are not under
//      `.claude/skills`.
//   2. A known-good orchestrator cannot review a broken one. `--repo-root <other-tree>` currently
//      makes the engine load *that* tree's scripts — precisely the broken ones you were trying to
//      review with a working copy.
//   3. The framework cannot be installed anywhere the consumer chooses, which a plugin layout
//      requires: a plugin's skills live at `<plugin-root>/skills/`.
//
// Everything here derives from the calling script's own location. A derived path cannot go stale;
// a configured one can, and when it is wrong the symptom is "skill not installed" — which reads as
// a missing lens rather than a broken install.

import path from 'node:path';
import { absolute, resolveFrom } from './paths.mjs';
import { requireIo } from './io-param.mjs';

// NO node:fs HERE (os-platform-adapters stage 3). `exists` stays injectable; when it is not injected
// it comes from the platform implementation passed as `io` — scripts/io/locate.mjs binds that.

/**
 * Resolve the framework's directories from the location of a script inside `scripts/`.
 *
 * Two layouts are supported, and which one is in force is DETECTED, not configured:
 *
 *   plugin layout   <root>/scripts/  and  <root>/skills/        (skills are a sibling)
 *   legacy layout   .claude/skills/scripts/  with skill dirs in .claude/skills/
 *
 * The probe is unambiguous because `<scripts>/../skills` exists in exactly one of them. Keeping
 * both working means this change lands and is exercised by a real sweep BEFORE the repository
 * moves, so a regression is attributable to this refactor alone.
 *
 * `exists` is injectable so the layouts can be tested without building either on disk.
 */
export function resolveFrameworkDirs(scriptsDirPath, { io, exists = requireIo(io, 'resolveFrameworkDirs').fs.existsSync } = {}) {
  if (!scriptsDirPath) throw new Error('resolveFrameworkDirs: a scripts directory is required');

  const scriptsDir = absolute(scriptsDirPath, 'resolveFrameworkDirs: scripts directory');
  const parent = resolveFrom(scriptsDir, 'resolveFrameworkDirs', '..');
  const sibling = path.join(parent, 'skills');

  // The framework root is the parent of `scripts/` in BOTH layouts — `<plugin-root>/scripts/` and
  // `.claude/skills/scripts/` — so VERSION and, later, `.claude-plugin/plugin.json` have one home
  // that does not move with the migration.
  // `prompts/` sits beside `skills/` in both layouts, for the same reason `scripts/` does: it is
  // part of the framework, not of the tree under review. Returned unconditionally rather than
  // probed — a missing prompts directory must surface as "this node's instructions are not there",
  // naming the file, not as a layout that silently resolves somewhere else.
  const prompts = path.join(parent, 'prompts');

  if (exists(sibling)) {
    return { scriptsDir, skillsDir: sibling, promptsDir: prompts, frameworkRoot: parent, layout: 'plugin' };
  }
  if (exists(parent)) {
    return { scriptsDir, skillsDir: parent, promptsDir: prompts, frameworkRoot: parent, layout: 'legacy' };
  }

  // Neither resolves. Fail loudly rather than returning a path that will later produce
  // "skill not installed" for every node — a wrong location must not be mistakable for an
  // incomplete install.
  throw new Error(
    `resolveFrameworkDirs: cannot locate the skills directory from ${scriptsDir}. ` +
    `Expected either ${sibling} (plugin layout) or ${parent} (legacy layout).`,
  );
}

/** Absolute path to one skill's SKILL.md, wherever the framework happens to be installed. */
export function skillFile(skillsDir, skillId) {
  return path.join(skillsDir, skillId, 'SKILL.md');
}

/** Absolute path to one graph node's PROMPT.md. */
export function promptFile(promptsDir, nodeId) {
  return path.join(promptsDir, nodeId, 'PROMPT.md');
}

/**
 * Where a spawned node's instructions live — the prompt library first, then the skills directory.
 *
 * TWO HOMES, ON PURPOSE, because the things in them are different (2026-09-09). `prompts/` holds
 * the twelve node contracts the ORCHESTRATOR spawns: they refuse to run outside a run directory,
 * they emit a schema-validated envelope, and no person can usefully invoke one. `skills/` holds the
 * ten a person actually invokes. They lived together, so a consuming project that mounted quorate
 * got twenty-two names in its `.claude/skills` namespace — twelve of them false affordances, and
 * six of the twenty-two collided outright with a real project's own skills the first time it was
 * tried, which is why the SKILLS-SHADOWED stamp exists.
 *
 * The order is prompt-first and the fallback is NOT silent tolerance: a node whose instructions are
 * in neither place is fatal at the call site, naming both paths. That matters because the failure
 * this replaces was worse than absence — falling through to slash-command resolution would have
 * changed how a node was instructed while looking like it worked.
 *
 * Returns `{ file, home }`, or null when neither exists. `home` is recorded rather than inferred so
 * an artifact can say which library a node's instructions came from.
 */
export function nodeInstructions({ promptsDir, skillsDir }, nodeId, { io, exists = requireIo(io, 'nodeInstructions').fs.existsSync } = {}) {
  const asPrompt = promptsDir ? promptFile(promptsDir, nodeId) : null;
  if (asPrompt && exists(asPrompt)) return { file: asPrompt, home: 'prompts' };
  const asSkill = skillsDir ? skillFile(skillsDir, nodeId) : null;
  if (asSkill && exists(asSkill)) return { file: asSkill, home: 'skills' };
  return null;
}

// globDirPrefix lived here, "the one owner" of a glob's directory prefix: it cut at `*` only, so `?` and `[` were
// literal to it while other readers took them as wildcards. Deleted for lib/contract-glob.mjs's coverPrefix
// (contract-glob-grammar stage 3), which answers the same question from the one parse of the grammar.

// panelProbePath lived here, the one owner of `.claude/panel-check.json`'s location. Deleted with check-panel.mjs
// (reviewer-preflight stage 4): a reviewer's probe is now a record per combination under the engine's home
// (scripts/io/reviewer-probe.mjs), checked before every call, and nothing reads the old file.
