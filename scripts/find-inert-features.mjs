#!/usr/bin/env node
// find-inert-features.mjs — mechanical search for documented promises no code delivers.
//
// This exists because prose is not enough. story-pipeline shipped the same detector as a script
// and recorded why: "Every inert feature found so far was found by accident while chasing an
// unrelated symptom, and none was caught by a requested gap check — because this step used to be
// prose, so it only fired when the reviewer happened to think of the right grep." The instruction
// in doc-consistency-review/SKILL.md is not a substitute for running this.
//
// It reports CANDIDATES, never verdicts. A field reached through whole-struct deserialization, a
// macro, reflection, or a name this analysis cannot follow is a false positive, and the skill
// requires each candidate to be verified before it is reported as a finding. But the result must
// be STATED either way: "searched N identifiers, all have readers" is a verdict; not running it
// is not.
//
// Usage:
//   node <framework-root>/scripts/find-inert-features.mjs [--repo-root <path>] [--json]
//
// <framework-root> is this file's own parent-of-parent: the repository root in this checkout,
// `.claude/skills/quorate/` under the documented consumer mount. The header used to print the
// legacy `.claude/skills/scripts/` literal — ENOENT in both supported layouts, and a phantom
// instruction sitting in the header of the one script whose job is finding phantom
// instructions (G-15).
//
// Exit codes: 0 always (this is a reporting tool, not a gate) · 2 configuration error

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesAnyGlob } from './lib/contract-glob.mjs';
import { hostPlatform } from './platform/index.mjs';
import { readContract } from './io/contract-reader.mjs';
import { gitSync } from './io/git.mjs';

// NO GRAPH_NODE_DEPTH GUARD, deliberately — and this is the one place it must not exist.
//
// The recursion guard in §8 of disk-first-protocol.md stops a graph node from SPAWNING GRAPH
// NODES. This script spawns none: it shells out to `git ls-files` and `git grep` and prints a
// table. The guard was copied here from the orchestration scripts without reconciling what this
// file does, and it defeated the script's only caller — doc-consistency-review runs at depth 1 by
// definition, so `exit 3` fired on every sanctioned invocation and the mandatory sweep silently
// degraded to whatever greps the reviewer happened to think of. That is the precise failure the
// header above says this script exists to eliminate.
//
// Three documents mandate this call (doc-consistency-review/SKILL.md rule 1, the header above, and
// capture.mjs's allow-list, opened because "an instruction the policy forbids is an instruction
// that cannot be followed") and the guard contradicted all three, plus the "Exit codes: 0 always"
// line ten lines above it. The graph found this by running the script through its own capture path
// and reporting the abort rather than skipping the check quietly.
//
// If a future edit makes this script spawn a node, the guard belongs back — with the exit-code
// contract above updated to match.

const die = (m) => { console.error(`find-inert-features: ${m}`); process.exit(2); };

const args = { json: false };
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['find-inert-features'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  if (v['repo-root'] !== undefined) args.repoRoot = v['repo-root'];
  if (v.json) args.json = true;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The repository under review, found by ASKING GIT rather than by counting directories up from
// this file. `HERE/../../..` encoded one specific installation depth: correct while the framework
// was vendored at .claude/skills/scripts/, wrong the moment it moves, and wrong silently — the
// resulting path is a real directory, just the wrong one.
const repoRoot = path.resolve(args.repoRoot ?? gitRoot() ?? process.cwd());

function gitRoot() {
  const r = gitSync(['rev-parse', '--show-toplevel'], { encoding: 'utf8', cwd: process.cwd() });
  return r.status === 0 ? r.stdout.trim() : null;
}

// ---------------------------------------------------------------------------- contract
// The one reader (ledger-findings.plan.md stage 4): its classification, the child's own words kept.
const read = readContract({ repoRoot });
// THE CHILD'S OWN WORDS, because this message named the wrong file and the wrong owner. `new-run
// --print-contract` exits non-zero for two very different reasons: the project's CLAUDE.md really
// has no readable contract, or THIS framework copy cannot start at all. The second is what happened
// — a new lib module was not yet tracked, so `copyTrackedInto` built a panel worktree whose new-run
// could not resolve its own import — and the detector reported it as a missing contract in the
// consumer's CLAUDE.md. An arm reading that would have filed a finding against the project.
if (!read.contract) {
  const detail = String(read.message ?? '').split('\n').join('\n  ');
  die(
    `could not read the graph_contract block: \`new-run.mjs --print-contract\` ${read.absent ? 'found no contract' : `failed: ${read.error}`}.\n`
    + `  ${detail || '(it printed nothing)'}\n`
    + `  Either ${path.join(repoRoot, 'CLAUDE.md')} declares no readable contract, or this framework`
    + ` copy at ${HERE} is incomplete.`,
  );
}
const contract = read.contract;

const docPaths = contract.doc_paths ?? [];
const sourceGlobs = contract.source_globs ?? [];
if (!docPaths.length) die('doc_paths is empty — nothing to check documentation against');
if (!sourceGlobs.length) die('source_globs is empty — nowhere to look for readers');

// ---------------------------------------------------------------------------- file discovery
// git ls-files, not a hand-rolled walker: it already honours .gitignore, so generated_globs
// cannot pollute the result, and an untracked scratch file cannot masquerade as a reader.
//
// ONE LISTING, NO PATHSPEC (contract-glob-grammar stage 5, design 3A). The contract's globs were handed to git as
// pathspecs, so git's own rules decided what was source — and without `:(glob)` magic git's `*` crosses `/`, so
// `src/*.js` reached `src/sub/b.js`, which the contract's grammar says it does not. git lists every tracked file once;
// lib/contract-glob.mjs decides which are docs and which are source.
// A LISTING THAT FAILED IS NOT AN EMPTY REPOSITORY (G-3 of 20261002-012918-confirm3-confirm): it was taken as `[]`, and the
// mandatory sweep reported zero files and no candidates, exit 0 — clean, having inspected nothing. It refuses instead.
const tracked = (() => {
  const r = gitSync(['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) {
    console.error(`find-inert-features: git ls-files failed in ${repoRoot} (exit ${r.status ?? r.error?.code}): `
      + `${String(r.stderr ?? r.error?.message ?? '').trim().slice(0, 300)} — refusing to report a sweep that inspected nothing`);
    process.exit(2);
  }
  return r.stdout.split('\0').filter(Boolean);
})();
const sourceTracked = tracked.filter((f) => matchesAnyGlob(sourceGlobs, f));

const docFiles = tracked.filter((f) => matchesAnyGlob(docPaths, f));
// Through the one owner of the grammar (contract-glob-grammar stage 3): a private matchGlob here swallowed the `/`
// after `**` (so `**/X` matched `fooX`) and took `?` as a literal.
const srcFiles = sourceTracked.filter((f) => !matchesAnyGlob(docPaths, f));

// ---------------------------------------------------------------------------- candidates
// Backticked identifiers in prose are the highest-signal source: a document that puts a name in
// code font is asserting that name exists in the system. Bare words are not candidates — the
// false-positive rate makes the report unreadable, which is how a detector gets ignored.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*(?:[._][A-Za-z0-9_]+)*$/;
const NOISE = new Set([
  'true', 'false', 'null', 'undefined', 'string', 'number', 'boolean', 'object', 'array',
  'yes', 'no', 'none', 'todo', 'note', 'warning', 'error', 'ok', 'pass', 'fail', 'risk',
]);

const candidates = new Map(); // identifier -> Set(doc files that mention it)

// EACH DOCUMENT READ ONCE, AND ONE IT COULD NOT READ IS NAMED, NOT COUNTED (G-6 of 20261114-174045-m2-pred1-review):
// both scans swallowed a read error with `continue`, and the report still counted the document in `doc_files`, so a
// listed document that was removed or unreadable read as scanned. It goes in `not_checked` with its error instead.
const docText = new Map();
const docNotChecked = [];
for (const df of docFiles) {
  try { docText.set(df, fs.readFileSync(path.join(repoRoot, df), 'utf8')); } catch (e) {
    docNotChecked.push({ file: df, error: e?.code ?? String(e?.message ?? e) });
  }
}

for (const [df, text] of docText) {
  // Strip fenced blocks: a code sample is an illustration, not a claim that the name exists.
  const prose = text.replace(/```[\s\S]*?```/g, '');
  for (const m of prose.matchAll(/`([^`\n]{4,60})`/g)) {
    const raw = m[1].trim();
    if (/\s/.test(raw)) continue;                    // phrases, commands — handled separately
    const id = raw.replace(/^[-+#$.]+/, '').replace(/[(){}[\],;:]+$/, '');
    if (!IDENT.test(id)) continue;
    if (NOISE.has(id.toLowerCase())) continue;
    if (id.includes('/') || id.includes('.md') || id.includes('.json')) continue;
    // Two narrow exclusions, both for things a document names without claiming they exist in
    // code. Kept deliberately tight: over-filtering hides real findings, and a detector people
    // stop reading is worth nothing.
    if (/^v?\d+[\d.]*$/.test(id)) continue;                       // version strings: v0.1.0
    if (/\d/.test(id) && /\.[A-Za-z0-9]{2,4}$/.test(id)) continue; // example filenames: IMG_0492.JPG
    if (!candidates.has(id)) candidates.set(id, new Set());
    candidates.get(id).add(df);
  }
}

// ---------------------------------------------------------------------------- readers
// One git grep for the whole identifier set would be faster, but per-identifier counts are what
// make the report actionable, and the whole point is that this runs in seconds either way.
//
// MEASURED, AND STILL DECLINED — three times now (G-17, G-18, and G-16 from panel-codex-perf).
// 169 identifiers, one `git grep` each, 3.9 seconds for the whole sweep of this repository. Re-measured 2026-10-01 on
// this Windows host when the file list became literal and chunked (contract-glob-grammar stage 5): 376 identifiers,
// 12.2 s before the change and 14.7 s after, one run each, with this repository's 170 source paths in one chunk. Each
// report describes the O(C x S) shape correctly and none of them measured it; the constant is git's,
// which is fast at precisely this, and the alternative — one combined grep, then attributing hits
// back to identifiers — is a parser to maintain in exchange for seconds nobody waits on. The
// condition that would flip it is a corpus where this takes long enough for anyone to notice.
//
// OVER LITERAL PATHS, IN CHUNKS (contract-glob-grammar stage 5). The files are the ones the grammar selected above,
// read by git literally (GIT_LITERAL_PATHSPECS) so no name is reinterpreted as a pattern, and split so no one command
// line exceeds the platform's argument budget (scripts/platform, `maxArgBytes`) — Windows caps a command line near 32K.
const grepChunks = (() => {
  const budget = hostPlatform().maxArgBytes;
  const chunks = [];
  let cur = [];
  let size = 0;
  // The SOURCE FILES THAT ARE NOT DOCUMENTS — the set the report counts — not every source file (G-4 of
  // 20261002-004527-confirm2-confirm): a file under both a source glob and a doc glob (this repository's `shared/**`)
  // was grepped as an implementation reader, so a name only documents mention was never reported inert.
  for (const f of srcFiles) {
    const cost = Buffer.byteLength(f) + 3;
    if (cur.length && size + cost > budget) { chunks.push(cur); cur = []; size = 0; }
    cur.push(f);
    size += cost;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
})();

function occurrences(id) {
  const out = [];
  for (const chunk of grepChunks) {
    const r = gitSync(['grep', '-c', '-w', '--', id, '--', ...chunk], {
      cwd: repoRoot, encoding: 'utf8', gitVars: { GIT_LITERAL_PATHSPECS: '1' },
    });
    if (r.status === 1 && !r.error) continue;        // exit 1 = no match in this chunk
    // ANY OTHER FAILURE IS NOT "NO MATCH" (G-7 of 20261015-230146-archive-fold-remediation-review): a git error, a spawn
    // failure or an overflowed buffer was swallowed, and the identifier reported inert without having been searched.
    if (r.status !== 0 || r.error) {
      console.error(`find-inert-features: git grep failed for \`${id}\` in ${repoRoot} (exit ${r.status ?? r.error?.code}): `
        + `${String(r.stderr || r.error?.message || '').trim().slice(0, 300)} — refusing to report identifiers it did not search`);
      process.exit(2);
    }
    for (const line of r.stdout.split('\n').filter(Boolean)) {
      const i = line.lastIndexOf(':');
      out.push({ file: line.slice(0, i), count: Number(line.slice(i + 1)) || 0 });
    }
  }
  return out;
}

const inert = [];
const recordOnly = [];
let withReaders = 0;

for (const [id, docs] of [...candidates].sort((a, b) => a[0].localeCompare(b[0]))) {
  const hits = occurrences(id);
  if (!hits.length) {
    inert.push({ identifier: id, documented_in: [...docs], source_hits: 0 });
    continue;
  }
  // RECORD-ONLY heuristic: the identifier appears exactly once in the whole source tree. One
  // occurrence cannot be both a write and a read, so it is written or declared and never
  // consumed. Deliberately conservative — it under-reports rather than flooding the output.
  const total = hits.reduce((a, h) => a + h.count, 0);
  if (total === 1) recordOnly.push({ identifier: id, documented_in: [...docs], source_hits: 1, where: hits[0].file });
  else withReaders++;
}

// ---------------------------------------------------------------------------- phantom commands
// A doc that tells a reader to run a script names a file. If the file is absent the instruction
// is a phantom — the most user-visible kind of false promise, because someone will try it.
const phantom = [];
for (const [df, text] of docText) {
  for (const m of text.matchAll(/\b(?:node|python3?|bash|sh)\s+([A-Za-z0-9_./-]+\.(?:mjs|js|py|sh|ps1))/g)) {
    const rel = m[1].replace(/^\.\//, '');
    if (fs.existsSync(path.join(repoRoot, rel))) continue;
    phantom.push({ documented_in: df, command: m[0], missing_file: rel });
  }
}

// ---------------------------------------------------------------------------- report
const report = {
  schema_version: 1,
  repo_root: repoRoot,
  doc_files: docText.size,
  not_checked: docNotChecked,
  source_files: srcFiles.length,
  identifiers_checked: candidates.size,
  identifiers_with_readers: withReaders,
  inert,
  record_only: recordOnly,
  phantom_commands: phantom,
};

if (args.json) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(0);
}

const line = (s = '') => process.stdout.write(s + '\n');
line(`Searched ${candidates.size} documented identifiers across ${docText.size} doc file(s)`);
line(`against ${srcFiles.length} source file(s).`);
line();
if (docNotChecked.length) {
  line(`NOT CHECKED (${docNotChecked.length}) — a listed doc file that could not be read, so nothing in it was scanned:`);
  for (const n of docNotChecked) line(`  ${n.file}  (${n.error})`);
  line();
}

if (inert.length) {
  line(`INERT (${inert.length}) — documented, no occurrence anywhere in source_globs:`);
  for (const i of inert) line(`  ${i.identifier.padEnd(34)} declared in ${i.documented_in.join(', ')}`);
  line();
}
if (recordOnly.length) {
  line(`RECORD-ONLY (${recordOnly.length}) — exactly one occurrence, so written or declared but never read:`);
  for (const r of recordOnly) line(`  ${r.identifier.padEnd(34)} ${r.where}`);
  line();
}
if (phantom.length) {
  line(`PHANTOM COMMANDS (${phantom.length}) — a doc tells the reader to run a file that does not exist:`);
  for (const p of phantom) line(`  ${p.command}  (in ${p.documented_in})`);
  line();
}
if (!inert.length && !recordOnly.length && !phantom.length && !docNotChecked.length) {
  line('No candidates. Every documented identifier has at least two occurrences in source,');
  line('and every documented command names a file that exists.');
  line();
}

line('Verify each candidate before reporting it as a finding: a field reached through');
line('whole-struct deserialization, a macro, or a name this search cannot follow is a false');
line('positive. State the result either way — not running this is not a verdict.');
process.exit(0);
