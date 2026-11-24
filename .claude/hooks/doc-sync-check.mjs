#!/usr/bin/env node
// doc-sync-check.mjs — non-blocking pre-commit reminder.
//
// Fires the INTENT of the doc-consistency-review skill at the one moment the skill itself is too
// slow to run: just before a commit lands. It reminds; it never decides. Everything here is a
// cheap mechanical check — staged-path classification and a regex cross-reference scan — because
// anything requiring judgement belongs to the skill, which the reminder points at.
//
// ALWAYS exits 0. A reminder that can block a commit becomes a reminder people disable.
//
// Contract-driven: doc_paths, source_globs and doc_roles come from the graph_contract block in
// CLAUDE.md, so this works in any repo that declares one rather than hardcoding a doc layout.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateGlob, matchesAnyGlob } from '../../scripts/lib/contract-glob.mjs';
import { CONTRACT_VERSION_KEYS } from '../../scripts/lib/contract-version.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// THE FRAMEWORK BESIDE THIS HOOK, AND ONLY IT (G-2 of 20261122-232627-m3s7-b4-review): the search went on to the reviewed
// repository's own scripts/new-run.mjs, so a consumer's io/contract-reader.mjs ran inside the operator's pre-commit hook.
// The hook's static imports already come from ../../scripts; the reader comes from the same place.
const FRAMEWORK_SCRIPTS = path.join(HERE, '..', '..', 'scripts');
// AND ONLY WHEN IT IS THE ENGINE (G-1 of 20261123-003125-m3s7-b4-remediation-review-b): the plugin manifest at the
// framework root is the marker, as checks.mjs requires before it runs anything from beside itself. A copy of this hook
// whose ../.. is not a quorate checkout loads nothing and says so.
const IS_FRAMEWORK = fs.existsSync(path.join(FRAMEWORK_SCRIPTS, '..', '.claude-plugin', 'plugin.json'));

// Output goes to stderr, which on Windows may be a legacy-codepage console. Keep it readable
// there rather than emitting mojibake for the sake of a section sign.
const ascii = (s) => s.replace(/→/g, '->').replace(/§/g, 'section ');

function sh(cmd, argv, cwd) {
  const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '').trim() : null;
}

const root = sh('git', ['rev-parse', '--show-toplevel'], process.cwd());
if (!root) process.exit(0); // not a repo: nothing to remind about

const staged = (sh('git', ['diff', '--cached', '--name-only'], root) ?? '')
  .split('\n')
  .map((s) => s.trim().replace(/\\/g, '/'))
  .filter(Boolean);
if (!staged.length) process.exit(0);

// ---------------------------------------------------------------------------- contract
// The one contract reader beside the framework this hook located (ledger-findings.plan.md stage 4). This hook is a
// non-blocking reminder: a copy without the reader, or a contract it cannot read, falls through to the no-contract path.
let contract = {};
{
  const reader = path.join(FRAMEWORK_SCRIPTS, 'io', 'contract-reader.mjs');
  if (!IS_FRAMEWORK) {
    process.stderr.write(`doc-sync-check: ${path.dirname(FRAMEWORK_SCRIPTS)} carries no .claude-plugin/plugin.json, so it is `
      + 'not a quorate checkout; no contract reader is loaded from it and nothing is checked\n');
  } else if (fs.existsSync(reader)) {
    const { readContract } = await import(pathToFileURL(reader).href);
    contract = readContract({ repoRoot: root }).contract ?? {};
  } else {
    // SAID, NOT SILENT (G-4): a copy of the hook without its framework would otherwise remind no one, with no trace.
    process.stderr.write(`doc-sync-check: no contract reader at ${reader}, so the contract is not read and nothing is checked\n`);
  }
}
// EITHER SPELLING OF THE VERSION KEY (G-1 of 20261001-022902-contract-glob-grammar-review). This tested
// `contract.graph_contract` alone, the spelling renamed at contract version 3, so on every contract written with
// `graph_contract_version` — this repository's included — the hook exited here and reminded no one of anything.
if (!CONTRACT_VERSION_KEYS.some((k) => contract[k] !== undefined && contract[k] !== null)) {
  // No contract, no opinion. Silence is correct here: this hook has nothing to compare against,
  // and inventing a doc layout would produce noise on every commit.
  process.exit(0);
}

const docPaths = contract.doc_paths ?? [];
const sourceGlobs = contract.source_globs ?? [];
const docRoles = contract.doc_roles ?? {};
const changelog = (contract.changelog ?? '').trim(); // optional; absent => rule not enforced

// THE ONE OWNER OF THE GRAMMAR (contract-glob-grammar stage 3, inventory N). A private globToRe here swallowed the `/`
// after `**` and took `?` as a wildcard, unlike the engine. The contract reaches this hook through --print-contract,
// which does not refuse a glob outside the grammar (the hooks only need commands), so such a glob is skipped here and
// named, not thrown on: this is a non-blocking reminder, and new-run refuses the contract when a run is minted.
const usable = (globs) => globs.filter((g) => {
  const why = validateGlob(g);
  if (why) console.error(`doc-sync-check: skipping contract glob ${JSON.stringify(g)} — ${why}`);
  return !why;
});
const docGlobs = usable(docPaths);
const srcGlobs = usable(sourceGlobs);
const matchAny = (file, globs) => matchesAnyGlob(globs, file);

const stagedDocs = staged.filter((f) => matchAny(f, docGlobs));
const stagedSrc = staged.filter((f) => matchAny(f, srcGlobs));

// ---------------------------------------------------------------------------- reminders
const reminders = [];

if (stagedDocs.length) {
  reminders.push(
    'Docs changed -> run /doc-consistency-review (ownership, cross-references, duplication, ' +
      'and whether any documented promise now has no code behind it).',
  );
}
if (stagedSrc.length && !stagedDocs.length) {
  reminders.push(
    'Source changed but no declared doc is staged -> if this alters a documented requirement, ' +
      'mechanism, schema, or recorded decision, update the owning doc (/doc-consistency-review).',
  );
}
// Structural change is the arch-review trigger, and it is the one the graph charges for. Naming
// it here is cheaper than discovering it at the gate.
if (stagedSrc.length && docRoles.architecture) {
  reminders.push(
    `Source changed -> if this moved a boundary or a dependency direction, /arch-review checks ` +
      `it against ${docRoles.architecture}.`,
  );
}
if (changelog && stagedSrc.length && !staged.includes(changelog)) {
  reminders.push(`Source changed but ${changelog} is not staged -> append a dated entry.`);
}

// ---------------------------------------------------------------------------- cross-references
// Resolve "<role> §N" against the document that role names, and a bare "§N" against the file it
// appears in. A renumbered heading silently breaks these everywhere at once, which is exactly
// the class of error nobody finds by reading.
// THE BYTES THE COMMIT HOLDS (G-6): every document is read from the index (`git show :<path>`), not the working tree, so
// an edit made after staging neither raises nor hides a reference. null when the index does not hold it.
const indexText = (rel) => {
  const r = spawnSync('git', ['show', `:${rel}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  return r.status === 0 ? r.stdout : null;
};
const headingCache = new Map();
const unreadable = new Set();
function headingNumbers(rel) {
  if (headingCache.has(rel)) return headingCache.get(rel);
  const nums = new Set();
  const text = indexText(rel);
  if (text == null) unreadable.add(rel);   // named below, not skipped in silence (G-5)
  for (const line of (text ?? '').split('\n')) {
    // A heading may carry the section sign itself, `## §2 Two` (G-5).
    const m = /^#{1,6}\s+§?\s*([0-9]+(?:\.[0-9]+)*)/.exec(line);
    if (m) nums.add(m[1]);
  }
  headingCache.set(rel, nums);
  return nums;
}

const roleAliases = {
  spec: docRoles.spec,
  specification: docRoles.spec,
  arch: docRoles.architecture,
  architecture: docRoles.architecture,
  plan: docRoles.roadmap,
  roadmap: docRoles.roadmap,
  implementation: docRoles.roadmap,
};

const broken = new Set();
for (const d of stagedDocs) {
  const text = indexText(d);
  if (text == null) continue;   // staged as deleted: nothing of it is committed
  for (const m of text.matchAll(/(spec|specification|arch|architecture|plan|roadmap|implementation)?\.?\s*§\s*([0-9]+(?:\.[0-9]+)*)/gi)) {
    const role = (m[1] ?? '').toLowerCase();
    const num = m[2];
    const target = role ? roleAliases[role] : d;
    if (!target) continue; // role not declared: nothing to resolve against
    const nums = headingNumbers(target);
    if (!nums.size) continue; // target unreadable or has no numbered headings
    if (!nums.has(num) && !nums.has(num.split('.')[0])) {
      broken.add(`${d}: §${num} -> ${target} has no such section`);
    }
  }
}
if (broken.size) {
  reminders.push('Possibly broken cross-references:\n      ' + [...broken].sort().join('\n      '));
}
if (unreadable.size) {
  reminders.push(`Cross-references not checked: could not read ${[...unreadable].sort().join(', ')} in the index.`);
}

// ---------------------------------------------------------------------------- emit
if (reminders.length) {
  process.stderr.write('\n[doc-sync] Before committing:\n');
  for (const r of reminders) process.stderr.write(ascii(`  - ${r}\n`));
  process.stderr.write('\n');
}
process.exit(0); // reminder only — never blocks
