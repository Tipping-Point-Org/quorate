// excerpt.mjs — the disputed lines themselves, numbered, for a tie-break prompt.
//
// This lived in finding-scope.mjs, whose header declares a narrower ownership: "the scope checks
// every finding must pass" and "the checks that are TRUE OF ANY FINDING regardless of producer".
// Excerpting a file to build a prompt is neither — it is prompt assembly that happens to need the
// same containment rule — and a module that quietly grows a second responsibility is how the next
// reader stops trusting what its header says (G-27). The containment check stays where it belongs
// and is IMPORTED, so there is still exactly one owner of "may this path be read".

import path from 'node:path';
import { absolute, resolveFrom } from './paths.mjs';
import { escapesAfterRealpath, isWithin } from './finding-scope.mjs';
import { matchesAnyGlob } from './contract-glob.mjs';
import { requireIo } from './io-param.mjs';
import { egress } from './egress-read.mjs';

/**
 * The disputed lines themselves, numbered, for a tie-break prompt.
 *
 * `shared/external-reviewers.md` promises "the tie-breaker receives the specific excerpt under
 * dispute". It received a file:line and nothing else — 1630 bytes of prose with zero code — while
 * the prompt asked it to rule "in terms of what is actually in the cited file". So the adjudicator
 * had to open the file, and the shared external-arm constraints told it to do so by "ordinary
 * read-only shell commands". codex can: it runs in a read-only sandbox. Headless agy cannot — a
 * tool needing the `command` permission is auto-denied because there is nobody to prompt — so agy
 * returned an empty response while reporting SUCCESS, and the tie-breaker has never once ruled.
 *
 * Measured before this was written: 9 of 10 replays across 5 Gemini configurations produced
 * nothing; given the excerpt inline, Gemini 3.1 Pro (High) ruled correctly and cited the right
 * evidence. The model was never the problem.
 *
 * A WINDOW, never the file. The egress doctrine sanctions exactly this — "the specific excerpt
 * under dispute, never the whole repository" — and a reviewer that must be sent something should be
 * sent the least that answers the question.
 */
export function readExcerpt({ repoRoot, file, line, radius = 45, generatedGlobs = [], declaredGlobs = null, io }) {
  // The filesystem arrives as `io` (os-platform-adapters stage 3); scripts/io/excerpt.mjs binds it.
  requireIo(io, 'readExcerpt');
  const root = absolute(repoRoot, 'readExcerpt: repoRoot');
  const abs = resolveFrom(root, 'readExcerpt: repoRoot', String(file ?? ''));
  // Containment, same rule as every other path this framework touches: the excerpt is chosen from
  // model-supplied coordinates, so it may not escape the repository under review.
  // isWithin, from the one owner (G-24) — see its docstring for why the composed prefix breaks at a
  // filesystem root, which is the case an excerpt of a model-supplied path can actually reach.
  if (!isWithin(root, abs)) {
    return { ok: false, why: `refused: ${file} resolves outside the repository` };
  }
  // Same link check as findingScopeErrors: this reads a file chosen from model-supplied
  // coordinates and sends it to a third-party cloud, so a link out of the tree is an egress.
  if (io.fs.existsSync(abs) && escapesAfterRealpath(root, abs, io)) {
    return { ok: false, why: `refused: ${file} resolves outside the repository through a link` };
  }
  // INSIDE THE REPOSITORY IS NOT THE SAME AS PUBLISHABLE (G-15). Containment stops a path escaping
  // the tree; it says nothing about files INSIDE it that must not leave — `.claude/reviews/**` holds
  // captured command output (gitignored precisely because it is content), and an untracked `.env`
  // is in the tree by definition. This function's whole job is choosing what to hand a third-party
  // cloud, from coordinates a model supplied, so "in the repo" was never the right test.
  //
  // The contract already declares both halves: generated_globs names what is not source, and the
  // declared surface names what is under review. An excerpt of anything else is refused rather than
  // trimmed — a tie-break that cannot see the file says so, which is a legitimate ruling.
  //
  // MATCHED BY THE ONE MATCHER (G-23). This re-derived glob matching inline — split on the first
  // `*`, strip trailing slashes, prefix-compare — and diverged from coveredByGlobs in both
  // directions. A `**/*.ext` glob has no directory part at all, so the inline base came out empty
  // and the some() was false: a generated file matched by `**/*.min.js` was NOT refused and went to
  // a third-party cloud, while a test file declared by `**/*.test.mjs` was refused as outside the
  // declared surface. The second divergence is a tie-break that cannot see its file; the first is
  // an egress. Neither is visible from this function, which is the argument for never writing a
  // second matcher for a vocabulary that already has one. That matcher was coveredByGlobs, itself one of
  // several; since contract-glob-grammar stage 3 it is lib/contract-glob.mjs, the grammar's one owner.
  const rel = path.relative(root, abs).split(path.sep).join('/');
  const underGlob = (globs) => matchesAnyGlob(globs ?? [], rel);
  if (underGlob(generatedGlobs)) {
    return { ok: false, why: `refused: ${file} is under a generated glob — not source, and not ours to send` };
  }
  if (declaredGlobs && declaredGlobs.length && !underGlob(declaredGlobs)) {
    return { ok: false, why: `refused: ${file} is outside the declared review surface — only reviewed source may be excerpted` };
  }

  let text;
  // THROUGH THE EGRESS OWNER (G-14 of 20261112-063354-hl-remediation-4-review): these lines go into every judge's prompt,
  // so a file with a second name, or a link at any level, is refused as every other egress site refuses it.
  try { text = egress({ root, io }).read(rel.split('/'), 'utf8'); } catch (e) {
    if (e?.code === 'ECONFINED') return { ok: false, why: `refused: ${e.message}` };
    return { ok: false, why: `could not read ${file}: ${e.code ?? e.message}` };
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  // A trailing newline ends the last line; it does not start another. Without this pop, `of` — which
  // the adjudication and tie-break prompts render as "lines X-Y of N" — was one too high for every
  // file ending in a newline, disagreeing with countLines in the same finding path. Found while
  // moving this module onto `io` (os-platform-adapters stage 3).
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const at = Number(line);
  if (!Number.isInteger(at) || at < 1) return { ok: false, why: `no usable line number for ${file}` };
  const from = Math.max(1, at - radius);
  const to = Math.min(lines.length, at + radius);
  const width = String(to).length;
  const body = lines.slice(from - 1, to)
    .map((l, i) => `${String(from + i).padStart(width)}${from + i === at ? ' >' : '  '} ${l}`)
    .join('\n');
  return { ok: true, from, to, of: lines.length, body };
}
