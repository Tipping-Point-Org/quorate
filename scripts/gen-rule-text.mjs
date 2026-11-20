#!/usr/bin/env node
// gen-rule-text.mjs — write every marked rule region from its one owner (code-index-d1-part-a.plan.md stage 4).
//
//   node scripts/gen-rule-text.mjs            rewrite every stale region in place
//   node scripts/gen-rule-text.mjs --check    write nothing; exit 1 naming each stale region and each restatement
//   node scripts/gen-rule-text.mjs --root <dir>   another tree (the tests' fixtures)
//
// The regions and the rules are lib/rule-text.mjs's. The files are git's list (tracked, plus untracked files git does
// not ignore) minus the records: .claude/requests, .claude/reviews and blog quote rules as they stood, and rewriting a
// record would falsify it. A restatement outside a region is looked for only in the files the contract declares as
// source or documents.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { RULES, regenerate, restatementsIn, syntaxFor } from './lib/rule-text.mjs';
import { readTemplate } from './io/template.mjs';
import { writeTextAtomic } from './io/atomic.mjs';
import { readContract } from './io/contract-reader.mjs';
import { matchesAnyGlob } from './lib/contract-glob.mjs';
import { escapesAfterRealpath } from './io/finding-scope.mjs';
import { gitSync } from './io/git.mjs';

function die(msg, code = 2) { console.error(`gen-rule-text: ${msg}`); process.exit(code); }

let opts;
try { opts = parseArgv(process.argv.slice(2), ARGV_SPECS['gen-rule-text']).values; } catch (e) {
  if (e instanceof ArgvError) die(e.message); throw e;
}
const root = path.resolve(opts.root ?? process.cwd());
const RECORDS = /^(\.claude\/(requests|reviews|claim-checks)\/|blog\/)/;

const listed = gitSync(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (listed.status !== 0) die(`git ls-files failed in ${root}: ${listed.error?.message ?? listed.stderr}`);
const files = [...new Set(listed.stdout.split('\0').filter(Boolean))]
  .filter((f) => syntaxFor(f) && !RECORDS.test(f));

// WHERE A RESTATEMENT COUNTS, read from the contract (plan stage 4): source_globs and doc_paths, plus the template and
// README a consumer reads, which neither names; test_globs and generated_globs are out, since a test quotes a phrase to
// pin it. A region is rewritten wherever it is; only the restatement check is scoped.
const read = readContract({ repoRoot: root });
if (!read.contract) die(`no readable graph_contract in ${root}: ${read.error ?? 'absent'}`);
const c = read.contract;
const scanned = (f) => (matchesAnyGlob(c.source_globs, f) || matchesAnyGlob(c.doc_paths, f) || f === 'CLAUDE.template.md' || f === 'README.md')
  && !matchesAnyGlob(c.test_globs, f) && !matchesAnyGlob(c.generated_globs, f);

const templates = Object.fromEntries(Object.values(RULES).filter((r) => r.template).map((r) => [r.template, readTemplate(r.template)]));
// A rule rendered from a hand-kept table reads that document from the tree being written (scope-constructs:
// shared/code-index.md); absent there, a region naming the rule fails with the document named.
for (const r of Object.values(RULES).filter((x) => x.source)) {
  const at = path.join(root, r.source);
  if (fs.existsSync(at)) templates[r.source] = fs.readFileSync(at, 'utf8');
}

const stale = [];
const restated = [];
const pending = [];
for (const f of files) {
  const abs = path.join(root, f);
  // A file git listed may be gone by the time it is read (a tracked file deleted, or a test's untracked directory
  // removed mid-walk, as the full suite does): that, and only that, is skipped. Any other failure to read it stops the
  // run naming the file, so --check never passes over a file it could not read. No existsSync filter stands in front:
  // it answers false for every stat failure, EACCES included (G-1 of 20261120-022706-m2-gaps-remediation-review).
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; die(`cannot read ${f}: ${e.message}`); }
  let result;
  try { result = regenerate(text, f, templates); } catch (e) { die(e.message); }
  for (const s of result.stale) stale.push(`${f}:${s.line}: rule:${s.id} differs from its owner`);
  if (scanned(f)) for (const r of restatementsIn(text, f)) restated.push(`${f}:${r.line}: restates rule:${r.id} outside a region: ${r.text}`);
  if (result.stale.length) pending.push({ f, abs, text: result.text });
}

// EVERY FILE PARSED BEFORE ANY IS WRITTEN, each write atomic, none through a link (G-4 of 20261022-013653-cid1a-delivery):
// a bare writeFileSync inside the loop left earlier files rewritten when a later one failed to parse, could leave a
// truncated document if interrupted, and followed a symbolic link out of --root.
if (!opts.check) {
  // Containment asked of its owner (G-4 of 20261022-025041-cid1a-remediation-review): a leading-'..' test passed a file
  // under a junction onto another drive, whose path relative to --root is absolute on win32.
  const escapes = pending.filter(({ abs }) => fs.lstatSync(abs).isSymbolicLink() || escapesAfterRealpath(root, abs));
  if (escapes.length) die(`refusing to write through a link or outside ${root}, nothing written: ${escapes.map((p) => p.f).join(', ')}`);
  for (const { abs, text } of pending) writeTextAtomic(abs, text);
}

if (opts.check) {
  for (const l of [...stale, ...restated]) console.log(l);
  console.log(`gen-rule-text: ${stale.length} stale region(s), ${restated.length} restatement(s) outside a region`);
  process.exit(stale.length || restated.length ? 1 : 0);
}
console.log(`gen-rule-text: ${stale.length} region(s) rewritten; ${restated.length} restatement(s) outside a region (see --check)`);
