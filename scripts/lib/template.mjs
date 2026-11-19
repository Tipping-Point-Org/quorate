// template.mjs — fill named slots in a prompt held on disk.
//
// WHY A TEMPLATE AND NOT A TEMPLATE LITERAL. The run brief — the document every node reads before
// it does anything — lived as 129 lines of JavaScript template literal inside run-graph.mjs, and it
// was not alone: the external-arm constraints, the tie-break prompt and the node prompt head were
// three more. A framework whose subject is model instructions kept most of its own instructions in
// the orchestrator, where a prompt author cannot find them and where editing prose means editing
// control flow.
//
// DELIBERATELY NOT A TEMPLATE LANGUAGE. `{{name}}` and nothing else: no conditionals, no loops, no
// expressions. Every decision stays in code, where it is testable, and arrives here already
// rendered — `{{intent_block}}` is a string the caller chose, not a branch this file evaluates. A
// template DSL would move logic into a place with no tests and no types, which is the opposite of
// the move.
//
// FAILS LOUD IN BOTH DIRECTIONS, because a prompt is not a place for a silent blank:
//   * a slot the caller did not supply throws, rather than rendering "undefined" into a document a
//     model is about to follow literally;
//   * a variable the template does not use throws too, because it means the prose and the caller
//     have drifted — which is exactly how a brief silently stops carrying a rule.

const SLOT = /\{\{([a-z0-9_]+)\}\}/gi;

/** Every slot the template declares, in order of first appearance. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFrom } from './paths.mjs';
import { resolveFrameworkDirs } from './locate.mjs';
import { requireIo } from './io-param.mjs';
import { egress } from './egress-read.mjs';

export function slotsIn(text) {
  return [...new Set([...String(text ?? '').matchAll(SLOT)].map((m) => m[1]))];
}

/**
 * Render `text`, replacing every `{{slot}}` with `vars[slot]`.
 *
 * @param {string} text  the template
 * @param {object} vars  one entry per slot; a missing or extra entry is an error
 * @param {string} label what to name in an error, so a failure says WHICH prompt broke
 */
export function renderTemplate(text, vars = {}, label = 'template') {
  const src = String(text ?? '');
  const slots = slotsIn(src);
  const given = Object.keys(vars ?? {});

  const missing = slots.filter((s) => !(s in (vars ?? {})));
  if (missing.length) {
    throw new Error(`${label}: no value for ${missing.map((s) => `{{${s}}}`).join(', ')} — a prompt `
      + 'with an unfilled slot is a document a model follows literally');
  }
  const unused = given.filter((k) => !slots.includes(k));
  if (unused.length) {
    throw new Error(`${label}: ${unused.join(', ')} supplied but the template has no such slot — `
      + 'the prose and the caller have drifted, which is how a brief stops carrying a rule');
  }
  return src.replace(SLOT, (_, name) => String(vars[name]));
}

// ---------------------------------------------------------------- loading a template
// MOVED HERE from codex-prompts.mjs (G-21 of 20260925-015614-platform-review, and the second
// precondition of consumer-owned-configuration AC 6): loading a template is generic, and it kept a
// vendor-named prompt module from being about one thing.

// FROM THE ONE OWNER OF "where the framework's own files are" (G-21, arch-review). This counted two
// hops up from its own file URL while check-install, new-run, run-graph and spawn-node all resolve
// framework paths through resolveFrameworkDirs — which already returns `promptsDir` for exactly
// this. lib/locate.mjs exists because that fact had three owners and two of the copies had already
// disagreed. A hardcoded hop count is correct only while this file stays in `scripts/lib/`: move
// it, or add a templates consumer under `scripts/`, and it resolves to a sibling of the framework
// root — and the layout probe that fails loudly while naming both candidate paths never runs.
//
// A FUNCTION OF `io`, not a load-time constant (os-platform-adapters stage 3c): resolving it probes
// the disk, and lib/ does no I/O of its own. scripts/io/template.mjs binds it to the host.
const LIB_PARENT = resolveFrom(path.dirname(fileURLToPath(import.meta.url)), 'template: module directory', '..');
function templatesDir(io) {
  return path.join(resolveFrameworkDirs(LIB_PARENT, { io }).promptsDir, '_templates');
}

/**
 * Read one template. Throws rather than returning empty: a prompt that silently became blank is a
 * node asked to do nothing, reported as a node that found nothing — the confusion this whole system
 * is arranged against.
 */
export function readTemplate(name, io) {
  requireIo(io, 'readTemplate');
  const dir = templatesDir(io);
  const p = path.join(dir, name);
  // THROUGH THE EGRESS OWNER (G-10 of 20261112-054852-hl-remediation-3-review): a template goes into a node's, a reviewer's,
  // a seat's or a checker's prompt, so a link or a file with a second name is refused, rooted at the templates' folder.
  try {
    return egress({ root: dir, io }).read([name], 'utf8');
  } catch (e) {
    throw new Error(`prompt template ${name} is missing at ${p}: ${e.message}`);
  }
}
