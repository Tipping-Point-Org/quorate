#!/usr/bin/env node
// check-install.mjs — is this project's quorate INSTALL current with the quorate it has mounted?
//
// Moving the submodule pointer is an UPDATE. It refreshes the engine, and it refreshes hook
// behaviour because installed hooks are two-line shims pointing back here. It does NOT:
//
//   * add a hook the project never installed — the shim only exists for hooks already placed;
//   * touch the graph_contract block copied into the project's own CLAUDE.md, whose MEANING can
//     change underneath it. `budget_usd_per_node: ""` once meant Number("") === 0, a $0 cap that
//     blocked every node, and now means uncapped: same text, opposite behaviour, no signal.
//
// So "I synced the submodule" and "my install is current" are different claims, and nothing could
// tell them apart. This does.
//
// It compares OBSERVABLE STATE rather than a recorded version, deliberately. A stamp written at
// install time is a claim that can go stale or be wrong; the artifacts cannot. Same reasoning as
// `host` being recorded rather than declared, and worktree_sha being content rather than a commit.
//
//   node .claude/skills/quorate/scripts/check-install.mjs [--repo-root <dir>]
//
// Exit codes: 0 install is current · 1 something is stale (each named) · 2 usage.

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveFrameworkDirs } from './io/locate.mjs';
import { reviewsIgnoreGaps } from './io/reviews-root.mjs';
import { hostPlatform } from './platform/index.mjs';
import { CONTRACT_CANDIDATES, chooseContractSource } from './lib/contract-source.mjs';
import { frameworkStamp } from './io/version.mjs';
import { shadowedSkills, docRoleCandidates } from './io/project-paths.mjs';
import { matchesAnyGlob } from './lib/contract-glob.mjs';
import {
  listProfiles, readProfile, PROFILE_DIR, PROFILE_MAX_BYTES, SHARED_PROFILE,
} from './io/project-profile.mjs';
import { contractVersionGap, contractVersionMessage, declaredContractVersion } from './lib/contract-version.mjs';
import { readContract } from './io/contract-reader.mjs';
import { gitSync } from './io/git.mjs';
import { stopGuardDeclared } from './lib/stop-record.mjs';

/** Directory names under `dir` that carry `file` — the framework's own skill and prompt ids. */
function idsIn(dir, file) {
  // The marker is stat'ed, not asked with existsSync, which reads an access or I/O error as absent and left an unreadable
  // directory out of the collision checks (G-3 of 20261025-104155-srf-remediation-3-review).
  const marked = (p) => {
    try { fs.statSync(p); return true; } catch (e) {
      if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return false;
      throw new Error(`check-install: cannot read ${p}: ${e?.code ?? e?.message}`);
    }
  };
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // Only an absent directory has no ids: any other error read as none and let the collision checks pass unrun (G-3 of
    // 20261025-095239-srf-remediation-2-review).
    if (e?.code === 'ENOENT') return [];
    throw new Error(`check-install: cannot list ${dir}: ${e?.code ?? e?.message}`);
  }
  return entries.filter((e) => e.isDirectory() && marked(path.join(dir, e.name, file))).map((e) => e.name);
}

/**
 * The project's TRACKED files that its own `doc_paths` cover.
 *
 * From `git ls-files` and the contract's globs, through lib/contract-glob.mjs, the grammar's one owner — a
 * second glob implementation here would disagree with the one that decides whether a finding is in scope,
 * and then two parts of this engine would mean different things by doc_paths. (This said "the same matcher
 * the finding-scope layer uses" while scope derivation compiled its own; contract-glob-grammar stage 3.)
 */
function listDocFiles(root, globs) {
  const r = gitSync(['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
  // Null, not []: a failed listing is not a project with no documents (G-2 of 20261025-092319-srf-review-amended).
  if (r.status !== 0) return null;
  return r.stdout.split('\0').filter(Boolean).filter((f) => matchesAnyGlob(globs, f));
}

// THE OPERATING SYSTEM IS CHECKED FIRST (os-platform-adapters, criterion 11): an unsupported one is
// learned at install, before anything else this script reports can matter. FIRST means before the
// line below, too: resolving the framework reads the disk through the platform, and on an
// unsupported OS that threw a stack trace ahead of this check — which the criterion-11 test caught.
// `die` is defined further down, so the report is spelled out here.
// hostPlatform(), so this check is the process's one instantiation (criterion 7), reused thereafter.
try { hostPlatform(); } catch (e) { console.error(`check-install: ${e.message}`); process.exit(2); }

const FRAMEWORK = resolveFrameworkDirs(path.dirname(fileURLToPath(import.meta.url)));
const HOOKS_SRC = path.join(FRAMEWORK.frameworkRoot, '.claude', 'hooks');
const MANAGED = ['pre-commit', 'pre-push']; // mirrors .claude/hooks/install.mjs

// What a project gives up by not installing each hook. Stated per hook rather than as one blanket
// sentence because the two are not the same kind of loss: pre-push is the quality gate, pre-commit
// is a question about intent. A reader deciding to decline should be declining a specific thing.
const CONSEQUENCE = {
  'pre-commit': "commits on the default branch are not refused, and doc-sync reminders don't fire",
  'pre-push': "no secret scan runs on a push, and nothing runs the contract's declared build and test commands before a push to a protected ref",
};

// The line install.mjs writes into every hook it installs (its MARKER); a test keeps the two equal. A hook
// WITHOUT it is the project's own: install.mjs refuses to overwrite it, so comparing it with the shipped body and
// saying "re-run install.mjs" gave advice that cannot work (story-pipeline's chained hooks, 2026-10-04).
const HOOK_MARKER = 'Committed copy — install with `node .claude/hooks/install.mjs`.';

function die(msg) {
  console.error(`check-install: ${msg}`);
  process.exit(2);
}


let repoRoot = process.cwd();
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['check-install'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  if (v['repo-root'] !== undefined) repoRoot = path.resolve(v['repo-root']);
}

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const gitSyncUtf8 = (args, opts = {}) => gitSync(args, { encoding: 'utf8', ...opts });

/** The contract as the ONE parser reads it. Never re-parsed here — a second parser is how two
 *  components come to disagree about the same file. */
function contractOf(dir) {
  return readContract({ cwd: dir }).contract ?? null;   // the one reader (ledger-findings stage 4)
}

/** The template's contract, read through the same parser by staging it as a CLAUDE.md. */
function templateContract() {
  const tpl = path.join(FRAMEWORK.frameworkRoot, 'CLAUDE.template.md');
  if (!fs.existsSync(tpl)) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-tpl-'));
  try {
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), fs.readFileSync(tpl, 'utf8'));
    return contractOf(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Keys the framework knows about that this contract does not carry, recursively. An ABSENT key is
 *  not the same as an empty one: empty is a declared decision, absent is a question never asked. */
function missingKeys(known, actual, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(known ?? {})) {
    const here = prefix ? `${prefix}.${k}` : k;
    if (!(k in (actual ?? {}))) { out.push(here); continue; }
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...missingKeys(v, actual[k], here));
  }
  return out;
}

const problems = [];
const notes = [];
// COUNTED, NOT INFERRED. The summary read hook state off the number of notes beginning with
// "hook '", so the case where hooks were never compared AT ALL — not a git repository — collapsed
// into the zero-uninstalled branch and printed "hooks match", claiming a comparison that never
// happened (G-9). The same overstatement the three-state summary was written to remove, one branch
// over. These say what actually occurred.
let hooksCompared = 0;
let hooksUninstalled = 0;
let hooksOwn = 0;
let hooksOwnSilent = 0;   // own hooks that call nothing of quorate's (G-4 of 20261007-031302-consumer-use-review)
let hooksChecked = false;

// ---------------------------------------------------------------- 1. is quorate even mounted here
if (path.resolve(FRAMEWORK.frameworkRoot) === path.resolve(repoRoot)) {
  notes.push('running inside the framework repository itself — nothing to install');
}

// ------------------------------------------------------------------------- 1b. the DEV install
// THE THIRD LAYER, and it is the one that was missing. quorate ships its person-invoked skills from
// `skills/` — the PLUGIN convention — while Claude Code discovers a project's skills under
// `.claude/skills/`. So inside quorate's own repository `/request`, `/full-review` and `/remediate`
// resolved to nothing: the ten tools this project ships were the only ones it never used, and the
// nine `.inferred.md` files in `.claude/requests/` are part of what that cost.
//
// The fix is a PINNED checkout mounted where a consumer mounts one, which gives three layers on
// purpose: the working tree being developed, a stable install the developer's own skills resolve to,
// and the sandbox consumer mount that validates mounting itself.
//
// Reported with its DISTANCE from the working tree, because "I have a dev install" and "my dev
// install is running the logic I am editing" are different claims — the same distinction this whole
// script exists for, one layer in. Never a problem: a dev install is optional, and deliberately
// behind is its normal state.
if (path.resolve(FRAMEWORK.frameworkRoot) === path.resolve(repoRoot)) {
  const dev = path.join(repoRoot, '.claude', 'skills', 'quorate');
  if (fs.existsSync(dev)) {
    const devStamp = frameworkStamp(dev);
    const pin = devStamp.commit === 'unknown' ? null : devStamp.commit;
    let behind = null;
    if (pin) {
      const r = gitSyncUtf8(['rev-list', '--count', `${pin}..HEAD`], { cwd: repoRoot });
      if (r.status === 0) behind = Number(r.stdout.trim());
    }
    notes.push(
      `dev install at .claude/skills/quorate @ ${pin ? pin.slice(0, 7) : 'unknown'}`
      + `${devStamp.dirty === true ? ' (DIRTY — it is a checkout, so edits there reach no branch)' : ''}`
      + `${behind === null ? '' : behind === 0
        ? ' — level with this working tree'
        : ` — ${behind} commit(s) BEHIND this working tree, so the skills you invoke here run older logic`}`
      + '. See .claude/dev-install.json for how it is pinned and refreshed.',
    );
  }
}

// ---------------------------------------------------------------------------- 2. contract drift
const mine = contractOf(repoRoot);
const tpl = templateContract();

// WHICH FILE carries it. Two supported locations means "your contract is stale" is not actionable
// without naming the file to edit — and a project that thinks its contract lives in CLAUDE.md while
// the engine is reading a forgotten rules file has a drift this tool exists to surface.
{
  const entries = CONTRACT_CANDIDATES.map((rel) => {
    const abs = path.join(repoRoot, rel);
    return { path: rel, text: fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null };
  });
  const chosen = chooseContractSource(entries);
  if (!chosen.ok) {
    // Not pushed as a problem here: an absent or conflicting contract is reported by the `!mine`
    // branch below with the message the operator can act on. Reporting it twice, differently, is
    // how one tool starts sounding like two.
    notes.push(`contract not resolvable: ${chosen.why.split('\n')[0]}`);
  } else {
    notes.push(`contract read from ${chosen.path}`);
    if (chosen.duplicates.length) {
      problems.push(
        `an identical graph_contract also sits in ${chosen.duplicates.join(', ')}. Runs use ` +
        `${chosen.path}; delete the other before they drift apart and every run starts refusing.`,
      );
    }
  }
}

// THE STALENESS THIS TOOL COULD NOT SEE. Everything below compares key PRESENCE, which is the right
// check for a key added or dropped and blind to the one that matters most after a pointer move: a
// key spelled identically whose MEANING changed. `budget_usd_per_node: ""` went from a $0 cap that
// blocked every node to uncapped, and a consumer's file was byte-identical either side of it.
// The declared version is the only thing that can carry that, so it is read here — this is where an
// operator looks after `git submodule update`, and a signal that only reaches a run is a signal they
// see after they have already paid for the run.
if (mine) {
  const declared = declaredContractVersion(mine);
  const gap = contractVersionGap(declared.value, undefined, declared.key);
  if (declared.deprecated) {
    notes.push(`${declared.key} is the old spelling of graph_contract_version — both are accepted, `
      + 'so this is a rename to make when convenient rather than a break');
  }
  if (gap.state !== 'current') {
    const msg = contractVersionMessage(gap);
    // `behind` is a problem rather than a note: a note reads as advisory, and the whole point is
    // that the operator cannot discover this any other way.
    (gap.state === 'behind' || gap.state === 'invalid' || gap.state === 'ahead'
      ? problems
      : notes).push(msg);
  }
}

if (!mine) {
  problems.push('no parseable graph_contract in this repository — see QUORATE.md step 2');
} else if (tpl) {
  const missing = missingKeys(tpl, mine).filter((k) => k !== 'project');
  if (missing.length) {
    problems.push(
      `contract is missing ${missing.length} key(s) the mounted quorate knows about:\n` +
      missing.map((k) => `      ${k}`).join('\n') +
      `\n      Absent is not the same as empty: an empty key is a declared decision and is named in\n` +
      `      not_checked[]; an absent one falls back to a built-in default you never chose.`,
    );
  }
}

// ------------------------------------------------------------------------------- 3. hook drift
const rr = gitSyncUtf8(['rev-parse', '--show-toplevel'], { cwd: repoRoot });
if (rr.status !== 0) {
  notes.push('not a git repository — hooks not checked');
  // hooksChecked stays false: nothing was compared, and the summary must not imply otherwise.
} else {
  const root = rr.stdout.trim();
  const hp = gitSyncUtf8(['config', '--get', 'core.hooksPath'], { cwd: root });
  const hooksDir = hp.status === 0 && hp.stdout.trim()
    ? path.resolve(root, hp.stdout.trim())
    : path.join(root, '.git', 'hooks');

  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  hooksChecked = true;   // we reached the comparison; what it found is counted below

  for (const name of MANAGED) {
    const src = path.join(HOOKS_SRC, name);
    const dst = path.join(hooksDir, name);
    if (!fs.existsSync(src)) continue;
    if (!fs.existsSync(dst)) {
      // A NOTE, not staleness. The hooks are optional by design — QUORATE.md says so, and the
      // review engine has no dependency on them at all: the barrier runs run-checks directly. A
      // project that never installed them made a choice, and one that already has its own
      // pre-commit/pre-push has every reason to decline. Calling that a stale install tells
      // someone their setup is broken when it is exactly as they configured it, which is the
      // failure this project's own doctrine names: a ceiling that fires on a non-problem teaches
      // readers to ignore ceilings. Visible, but not a verdict.
      //
      // THE WORD WAS 'optional', AND IT COST A DAY. That is a true statement about the install's
      // status and a useless one about the decision: it answers "must I?" when the only question
      // worth asking is "what do I lose?". Read on this very repository it meant "you don't need
      // this", and a red suite reached the remote behind a gate that was shipped, present, and
      // never installed. Declining stays a legitimate choice — the note still is not a verdict —
      // but it is now a choice made against the consequence rather than against the word.
      notes.push(`hook '${name}' is shipped but not installed — ${CONSEQUENCE[name]}`
        + ' (install: node .claude/hooks/install.mjs; declining is a valid choice)');
      hooksUninstalled += 1;
      continue;
    }
    // What the installer WOULD write now, compared with what is there — a hook whose body changed
    // is the thing a pointer move cannot fix, because .git/hooks is not tracked and nothing
    // refreshes it.
    //
    // THE SAME BODY THE INSTALLER WRITES, and it no longer rewrites paths — the shims probe for
    // themselves at run time, and the textual rewrite corrupted the second probe by substituting
    // into the consumer path already written there. Mirrored here because this comparison is
    // defined as "what the installer WOULD write now"; the two must move together or every
    // installed hook reads as drifted.
    const want = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
    const have = fs.readFileSync(dst, 'utf8').replace(/\r\n/g, '\n');
    if (!have.includes(HOOK_MARKER)) {
      // THE PROJECT'S OWN HOOK. Not stale — quorate did not write it and will not overwrite it. What is
      // worth saying is whether it calls any of quorate's hook files, by the mount's path.
      hooksOwn += 1;
      const calls = [...new Set([...have.matchAll(/\.claude\/skills\/quorate\/\.claude\/hooks\/([\w.-]+)/g)].map((m) => m[1]))];
      if (!calls.length) hooksOwnSilent += 1;
      notes.push(calls.length
        ? `hook '${name}' is this project's own and calls quorate's ${calls.join(', ')} — not compared with the shipped body`
        : `hook '${name}' is this project's own and calls nothing of quorate's — ${CONSEQUENCE[name]}`
          + " (chain quorate's from yours, or replace it with install.mjs --force)");
      continue;
    }
    hooksCompared += 1;
    if (sha(want) !== sha(have)) {
      problems.push(`hook '${name}' differs from what this quorate would install — re-run .claude/hooks/install.mjs`);
    }
  }
}

// --------------------------------------------------------------- 3a. name collisions and doc roles
// WHAT THE INSTALL COULD NOT SEE. `new-run` warns about shadowed skill names on every mint and stamps
// the run `SKILLS-SHADOWED`; this script, whose entire job is telling an operator what about their
// install is not current, said nothing about them. On the project quorate grew out of that is EIGHT
// colliding names plus two legacy engine directories on the doctrine-probe path — and mint time is
// both too late and too repetitive to be where you learn it.
//
// A NOTE, not staleness: a collision is the consuming project's decision to make, and for any project
// quorate descends from a shared ancestor is the normal case rather than the edge case. What the note
// must get right is the DIFFERENCE in what it costs, because the two halves are not the same:
// orchestrated lenses are safe by construction (`--inline-skill` hands the model the framework's own
// text whatever shares its name), while a skill a PERSON invokes is genuinely ambiguous.
{
  const ids = [
    ...idsIn(FRAMEWORK.skillsDir, 'SKILL.md'),
    ...idsIn(FRAMEWORK.promptsDir, 'PROMPT.md'),
  ];
  const { shadowed, legacy } = shadowedSkills({
    frameworkIds: ids,
    consumerSkillsDir: path.join(repoRoot, '.claude', 'skills'),
  });
  if (shadowed.length) {
    const spawned = new Set(idsIn(FRAMEWORK.promptsDir, 'PROMPT.md'));
    const lenses = shadowed.filter((n) => spawned.has(n));
    const invoked = shadowed.filter((n) => !spawned.has(n));
    notes.push(
      `${shadowed.length} skill name(s) collide with this quorate:`
      // NOT "the runtime picks one", which is what this said and is FALSE. quorate's skills are
      // NAMESPACED by the plugin — `quorate:plan-review` — while a project's own sits at
      // `.claude/skills/<name>/SKILL.md` and is invoked bare. Two different strings; nothing
      // resolves between them, and QUORATE.md says so itself 65 lines from where it claimed the
      // opposite. What is genuinely at risk is SELECTION: two skills whose descriptions answer the
      // same request, where the model chooses. Worth fixing, and a smaller thing than was claimed —
      // this sentence sent a consumer to rename skills that were never going to be mis-resolved.
      + `${invoked.length ? `\n      person-invoked — yours is invoked bare, quorate's as quorate:<name>, so neither shadows`
        + ` the other. What collides is SELECTION: near-identical descriptions answering one request,`
        + ` and the model picks. Migrate yours into .claude/quorate/<name>.md and drop the copy:`
        + ` ${invoked.join(', ')}` : ''}`
      + `${lenses.length ? `\n      lenses the engine spawns, safe by construction (--inline-skill uses the framework's text): ${lenses.join(', ')}` : ''}`
      // MIGRATE, not rename. Renaming leaves two skills doing one job and the project half still
      // trapped in a file quorate cannot read; a profile moves that half OUT of the submodule's way
      // and lets the copy go.
      + '\n      Each ADAPT.md derives the profile; then delete your copy.',
    );
  }
  // SEPARATE, AND NO LONGER A HAZARD (G-64). These were reported beside the collisions and stamped
  // the run, on the stated ground that they "sit on the doctrine-probe path". They no longer do:
  // the intent sandbox snapshots DOCTRINE_DIR, the same resolution a node's brief is told, which
  // probes the documented mount `.claude/skills/quorate/shared` and never the ancestor's
  // `.claude/skills/shared`. `.claude/skills/scripts` was never resolved by anything at all.
  //
  // Kept as a note because it is real history worth mentioning once to someone migrating off the
  // ancestor engine — and phrased so nobody reads it as work to do. On the consumer where this was
  // measured, `scripts/` held a live adjudication panel invoked by that project's own skill and
  // pinned by a passing test, and the check could only see the directory's NAME.
  if (legacy.length) {
    notes.push(
      `${legacy.map((n) => `.claude/skills/${n}`).join(' and ')} `
      + `${legacy.length > 1 ? 'are' : 'is'} where the ancestor engine kept its own files. `
      + 'Nothing in this quorate reads either path, so this is history rather than a problem — '
      + 'no run is stamped for it and there is nothing to change.',
    );
  }
}

// AN EMPTY doc_roles KEY IS HONEST AND CAN STILL BE WRONG ABOUT THE PROJECT.
//
// Empty means the check degrades and says so — `arch-review` loses `architecture_doc` and CANNOT FAIL except on a §6 invariant.
// That is a declared decision this framework honours, and inferring a value would be exactly the
// improvisation it refuses. But measured on a consuming project: the contract said `architecture: ""`
// with the comment "no single architecture document declared", and `docs/architecture.md` was sitting
// in the repository. Both facts were true and nothing ever put them side by side.
//
// So the candidates are named and the operator decides. Never a problem: a project may genuinely have
// no governing document, and a tool that nags about a file it found is a tool whose notes get skipped.
if (mine?.doc_roles) {
  const docGlobs = mine.doc_paths ?? [];
  const listed = docGlobs.length ? listDocFiles(repoRoot, docGlobs) : [];
  if (listed === null) {
    notes.push('doc_roles candidate check did not run: git ls-files failed, so the tracked documents could not be listed');
  }
  const docFiles = listed ?? [];
  for (const role of ['architecture', 'spec', 'roadmap']) {
    if ((mine.doc_roles[role] ?? '') !== '') continue;
    const hits = docRoleCandidates({ role, files: docFiles });
    if (hits.length) {
      notes.push(
        `doc_roles.${role} is empty — ${role === 'architecture'
          ? 'arch-review degrades to convention and invariant only and cannot FAIL except on a §6 invariant' :'the corresponding check is skipped'}`
        + ` — and these declared documents look like candidates: ${hits.slice(0, 4).join(', ')}`
        + `${hits.length > 4 ? ` (+${hits.length - 4} more)` : ''}`,
      );
    }
  }
}

// --------------------------------------------------------------- 3c. the project's own knowledge
// WHAT THE PROJECT TOLD THE NODES ABOUT ITSELF. Reported because the alternative is how the problem
// was found: a project with knowledge a lens needs and nowhere to put it ships its OWN skill of the
// same name, and the orchestrator's --inline-skill then discards that text silently. An operator who
// cannot see whether a profile is in play cannot tell a lens that read project idiom from one that
// guessed.
//
// Never a problem: most projects need none, and a note that nags about an absent optional file is a
// note the reader learns to skip. Profiles for ids this quorate does not spawn ARE worth naming,
// because a file named after a node that does not exist is read by nothing and looks like it works.
{
  let present = [];
  try { present = listProfiles({ repoRoot }); } catch (e) {
    // G-11 of 20261025-021243-arp-remediation-3c-review: an unreadable profile directory is named, not taken for empty.
    problems.push(`.claude/quorate/ exists but cannot be read (${e?.code ?? e?.message ?? e}): its profiles are not checked`);
  }
  if (present.length) {
    const known = new Set([
      SHARED_PROFILE,
      ...idsIn(FRAMEWORK.promptsDir, 'PROMPT.md'),
      ...idsIn(FRAMEWORK.skillsDir, 'SKILL.md'),
      'test-profile',
      // The override of shared/session-rules.md (autonomous-run-pauses.plan.md stage 4): not a node or a skill, so named here.
      'session-rules',
    ]);
    const orphans = present.filter((n) => !known.has(n));
    const nodeIds = new Set(idsIn(FRAMEWORK.promptsDir, 'PROMPT.md'));

    // TWO MECHANISMS UNDER ONE DIRECTORY, AND THEY ARE NOT INTERCHANGEABLE. A profile naming a NODE
    // is INLINED by the orchestrator, which bounds it, declares any truncation in the brief, and
    // writes the context-not-authority header itself. A profile naming a person-invoked SKILL is
    // READ BY THAT SKILL: Claude Code loads SKILL.md directly, so there is no assembly step for
    // quorate to hook and none of those guarantees can execute at run time.
    //
    // That is exactly why the three checks below live HERE. The guard did not disappear when
    // profiles reached the skills; it moved to the place that can still run it.
    const kind = (n) => (n === SHARED_PROFILE ? 'every node' : nodeIds.has(n) ? 'node, inlined' : 'skill, read');
    const detail = [];
    const oversize = [];
    const unreadable = [];
    const empty = [];
    for (const n of present) {
      // The text kept is capped like every other reader's; `bytes` is still the file's whole size, which is what the
      // oversize note needs (G-3 of 20261024-220920-arp-delivery).
      const p = readProfile({ repoRoot, name: n, maxBytes: PROFILE_MAX_BYTES });
      if (!p) continue;
      if (p.unreadable) { unreadable.push(n); continue; }
      if (!p.text.trim()) { empty.push(n); continue; }
      if (p.bytes > PROFILE_MAX_BYTES) oversize.push(`${n} (${p.bytes} bytes)`);
      detail.push(`${n} [${kind(n)}]`);
    }
    notes.push(
      `${PROFILE_DIR}/ carries ${present.length} profile(s): ${detail.join(', ') || '(none readable)'}`
      + (orphans.length
        ? `
      NAMED AFTER NOTHING THIS QUORATE SPAWNS, so nothing reads them: ${orphans.join(', ')}`
        : ''),
    );
    // EMPTY AND UNREADABLE ARE NOT THE SAME AS ABSENT. A node's brief says so at run time; a skill
    // reading the file itself cannot distinguish "the project declared nothing" from "the project
    // declared something I could not open", and would proceed as if the project had said nothing.
    if (unreadable.length) {
      notes.push(`profile(s) present but UNREADABLE, so the skill or node that names them will `
        + `proceed as though the project said nothing: ${unreadable.join(', ')}`);
    }
    if (empty.length) {
      notes.push(`profile(s) present but EMPTY: ${empty.join(', ')} — an empty file and an absent `
        + `one mean the same thing to every reader, so delete it or fill it`);
    }
    // OVER BUDGET, AND THE CONSEQUENCE DIFFERS BY MECHANISM. A node's section is cut at the cap with
    // "TRUNCATED at N bytes of M" in the brief, so a lens can see it was cut. A skill reads the file
    // whole, so nothing truncates and nothing says so — the budget is advisory there, and this note
    // is the only place it is enforced at all.
    if (oversize.length) {
      notes.push(`profile(s) over the ${PROFILE_MAX_BYTES}-byte budget: ${oversize.join(', ')} — a `
        + `node's brief truncates and says so; a skill reads the whole file and nothing says `
        + `anything. Over this size you are describing a DOCUMENT: put it in doc_paths, where a lens `
        + `can cite it, rather than in a profile nothing can cite`);
    }
  }
}

// ------------------------------------------------------------------- 3b. the localisation profile
// PRESENCE OF A SKILL IS NOT ITS LOCALISATION, which is this file's whole subject applied one layer
// up. `unit-test-writer` and `integration-test-writer` are portable by design: they read the runner
// and locations from the contract and everything else — assertion idiom, fixture convention, how an
// expensive boundary is faked, and WHERE the project declares what is worth testing — from
// `.claude/quorate/test-profile.md`, which their ADAPT.md produces once per repository.
//
// Absent, the skills behave honestly: they say so in not_checked[] and infer conventions from
// existing tests. But nothing told the operator the file was missing, so the degradation was
// discovered at the moment a test was being written rather than at install time. A mounted-but-
// unlocalised test writer is the same shape as a mounted-but-unreconciled contract.
//
// A NOTE, NOT A PROBLEM: the profile is optional in a repository with no test suite to localise
// against, and quorate does not get to fail a consumer's install over a document quorate cannot
// write. It is stated where staleness is stated, which is the point — mechanical here, because
// deriving the profile needs a model reading the project's own architecture documents, and a file
// generated with nobody reviewing it would be treated as authoritative by both skills.
{
  // THROUGH PROFILE_DIR, the one owner of this path. This read `.claude/test-profile.md` while
  // every message it prints — and QUORATE.md, and the two skills that consume it — say
  // `.claude/quorate/test-profile.md`. So a correctly-placed profile was reported ABSENT forever,
  // and a file at the undocumented path would have been reported present while nothing read it.
  // The check for the localisation feature could not see the feature.
  const profile = path.join(repoRoot, PROFILE_DIR, 'test-profile.md');
  // `mine` is the parsed contract from step 2 — the same object the key comparison above uses, so
  // this cannot disagree with it about whether the project declares a suite.
  const declaresTests = Boolean(
    (mine?.commands?.test ?? '') || (mine?.commands?.test_product ?? ''),
  );
  if (fs.existsSync(profile)) {
    notes.push('.claude/quorate/test-profile.md present — the test-writer skills are localised to this project');
  } else if (declaresTests) {
    notes.push(
      'no .claude/quorate/test-profile.md — unit-test-writer and integration-test-writer will read the runner '
      + 'from the contract and INFER the rest from existing tests, naming the gap in not_checked[]. '
      + 'Run the ADAPT.md prompt beside either skill once to localise them (it also records where this '
      + 'project declares what is worth testing, which the contract does not carry).',
    );
  }
}

// ------------------------------------------------------------------- 3c. the session rules
// shared/session-rules.md is the default for when a session stops and what it asks the operator; a project replaces it
// with .claude/quorate/session-rules.md (autonomous-run-pauses.plan.md stage 4). Either is a valid state, so this is a
// note saying which one this project's sessions follow, not a problem.
{
  const override = path.join(repoRoot, PROFILE_DIR, 'session-rules.md');
  notes.push(fs.existsSync(override)
    ? '.claude/quorate/session-rules.md present — this project\'s sessions follow it instead of quorate\'s shared/session-rules.md'
    : 'no .claude/quorate/session-rules.md — this project\'s sessions follow quorate\'s defaults in shared/session-rules.md');

  // The stop guard holds the stopping half (stage 5). It is declared in the project's own .claude/settings.json or
  // settings.local.json: a plugin's hooks did not fire from the project-level mount (stage 1's probe). A note, since a
  // project may run without it; the note says what it then lacks.
  // A file that is absent declares nothing; one that cannot be read or parsed is named as that, since "not declared"
  // would send the operator to add hooks a broken file may already hold (G-4 of 20261024-220920-arp-delivery).
  const declared = { stop: false, turnStart: false, stopFailure: false };
  const unreadable = [];
  for (const f of ['settings.json', 'settings.local.json']) {
    const file = path.join(repoRoot, '.claude', f);
    let s = null;
    try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      if (e?.code !== 'ENOENT') unreadable.push(`${path.join('.claude', f)} could not be read as JSON (${e?.message ?? e})`);
      s = undefined;
    }
    // JSON that parses but is not an object (`null`, a number, an array) holds no settings either, and is named as that
    // rather than read as a file with no hooks (G-4 of 20261024-224631-arp-remediation-review).
    if (s !== undefined && (s === null || typeof s !== 'object' || Array.isArray(s))) {
      unreadable.push(`${path.join('.claude', f)} is not a JSON object`);
      s = null;
    }
    const d = stopGuardDeclared(s);
    declared.stop ||= d.stop;
    declared.turnStart ||= d.turnStart;
    declared.stopFailure ||= d.stopFailure;
  }
  if (unreadable.length && !(declared.stop && declared.turnStart)) {
    notes.push(`stop guard unknown: ${unreadable.join('; ')} — fix the file, then re-run check-install`);
  } else if (declared.stop && declared.turnStart) notes.push('stop guard declared (Stop and UserPromptSubmit) — a stop the session rules do not allow is blocked once, and every turn is recorded (the newest two capped files kept, shared/session-rules.md)');
  else notes.push(`stop guard ${declared.stop ? 'half-declared: no UserPromptSubmit --turn-start hook, so turn starts are not recorded'
    : 'not declared: a session here can stop with nothing asked, unrecorded'} — add the hooks QUORATE.md's Setup names to .claude/settings.json`);
  // The StopFailure hook (autonomous-run.plan.md stage 7 part 2): without it a turn that ends on an API error, a usage
  // limit among them, is found later only as an unexplained involuntary stop.
  if (declared.stop && !declared.stopFailure && !unreadable.length) {
    notes.push('stop guard: no StopFailure --stop-failure hook, so a turn that ends on an API error (a usage limit among them) is not recorded with its cause — add the hook QUORATE.md\'s Setup names');
  }
}

// ------------------------------------------------------------------ 3d. the secret scan's rule set
// A REPOSITORY'S OWN .gitleaks.toml GOVERNS its secret scan (ledger-trust-boundaries 1b): the pre-push hook and
// check-secrets pass quorate's shipped config only when there is none, since a project's secret policy is its own
// call. Said here, because the difference is invisible otherwise — the shapes the shipped rules catch would pass
// unscanned, and nothing would look wrong. It names EVERY shipped rule (G-5 of ltb-review-r4: it named one, after a
// second was added), and where their scope is written down, rather than restating what each one catches.
if (fs.existsSync(path.join(repoRoot, '.gitleaks.toml'))) {
  const shipped = path.relative(repoRoot, path.join(FRAMEWORK.frameworkRoot, '.claude', 'hooks', 'gitleaks.toml')) || '.claude/hooks/gitleaks.toml';
  notes.push('gitleaks: this repository has its own .gitleaks.toml, which governs the secret scan — none of quorate\'s '
    + `shipped rules (${shipped}: quorate-key-value, quorate-key-value-unquoted and the quorate-<token> rules) is in `
    + 'force. The shapes they catch are the CASES table in scripts/lib/secret-shapes.mjs; copy the rules into your '
    + 'config to have those shapes caught at push.');
}

// ------------------------------------------------------------- 3e. what keeps a run's evidence out of git
// A RUN ARCHIVES INTO THE REPOSITORY, and its evidence stays out of git only by the rules in that directory's
// .gitignore — rules a newer quorate adds to (`.preflight-cache/` was one). run-graph writes the full file only when
// it is ABSENT, so an older one stays short of the rules forever, and this said "install is current" over exactly
// that in M1's story-pipeline sandbox (ledgered at check-install.mjs:560). Read-only: the same question the gate
// asks before it archives, asked here, where an install is judged.
{
  const declared = String(mine?.review?.reviews_dir ?? '').trim();
  const reviewsRoot = declared ? path.resolve(repoRoot, declared) : path.join(repoRoot, '.claude', 'reviews');
  const missing = reviewsIgnoreGaps(reviewsRoot);
  const ignoreRel = path.relative(repoRoot, path.join(reviewsRoot, '.gitignore')) || '.gitignore';
  if (!fs.existsSync(path.join(reviewsRoot, '.gitignore'))) {
    // A NOTE, not staleness (G-8 of 20261007-031302-consumer-use-review): nothing is committable before the file exists,
    // because new-run, the pre-flight and the archive each write the full one when it is absent. Said so it is visible.
    notes.push(`${ignoreRel} is not written yet — the first run writes it, with every rule this quorate needs`);
  } else if (missing.length) {
    problems.push(`${path.relative(repoRoot, path.join(reviewsRoot, '.gitignore')) || '.gitignore'} lacks `
      + `${missing.map((m) => `'${m}'`).join(', ')} — runs archived there would leave that content committable; `
      + 'add the line(s) (the full text is REVIEWS_IGNORE_TEXT in scripts/lib/reviews-root.mjs)');
  }
}

// -------------------------------------------------------------------------------- 4. what ran
// A COMMIT WITHOUT A DIRTY FLAG IS AN ATTRIBUTION, AND IT CAN BE FALSE. This printed
// `@ <sha>` from a bare `rev-parse`, so a mount with edits on top of that commit reported the
// commit alone — the reader concludes the engine is the one at that sha when it demonstrably is
// not. CLAUDE.md records the run this already cost: feature-verify "appeared still broken" when
// the clone was one commit from its fix, with the information present and unread. frameworkStamp
// is the function every other caller uses for this, including its three-state `dirty` — null
// means nobody could check, which is not `false`.
const fstamp = frameworkStamp(FRAMEWORK.frameworkRoot);
const stampText = fstamp.commit === 'unknown'
  ? ''
  : ` @ ${fstamp.commit.slice(0, 7)}${fstamp.dirty === true ? ' (DIRTY — edits on top of this commit)'
    : fstamp.dirty === null ? ' (clean/dirty unknown)' : ''}`;
console.log(`quorate mounted at ${path.relative(repoRoot, FRAMEWORK.frameworkRoot) || '.'}${stampText}`);
for (const n of notes) console.log(`  note: ${n}`);

if (!problems.length) {
  // Say what was actually verified. "hooks match" would be a false claim when none are installed,
  // and a summary that overstates what it checked is the same defect as a stamp that does.
  // THREE STATES, NOT TWO. This distinguished "hooks match" from "installed hooks match" to avoid
  // claiming more than was checked — and then said "installed hooks match" when NOTHING was
  // installed, which is vacuously true over an empty set and reads as assurance. On this very
  // repository the report carried both "hook 'pre-push' is shipped but not installed" and
  // "installed hooks match" in the same breath.
  //
  // A summary that overstates what it checked is the same defect as a stamp that does, which is the
  // reason this file compares observable state at all.
  const ownWord = hooksOwn
    ? `; ${hooksOwn} project-owned hook(s) not compared${hooksOwnSilent ? `, ${hooksOwnSilent} of which call nothing of quorate's` : ''}`
    : '';
  const hookWord = !hooksChecked ? 'hooks NOT CHECKED'
    : hooksCompared === 0 ? (hooksOwn ? `no quorate hooks installed${ownWord}` : 'no hooks installed')
      : hooksUninstalled > 0 || hooksOwn > 0 ? `${hooksCompared} of ${MANAGED.length} hooks installed, and those match${ownWord}`
        : 'hooks match';
  console.log(`install is current: contract carries every key this quorate knows, ${hookWord}.`);
  process.exit(0);
}
for (const p of problems) console.error(`  STALE: ${p}`);
console.error(
  `\n${problems.length} item(s) stale. Updating the submodule refreshes the ENGINE; it does not\n` +
  `re-run the install or reconcile your contract. Both are listed above with their fix.`,
);
process.exit(1);
