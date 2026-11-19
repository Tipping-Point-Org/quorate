#!/usr/bin/env node
// publish.mjs — one release snapshot, scanned, committed into a local clone of the public repository. Never pushed.
//
//   node scripts/publish.mjs --ref <commit> --dry-run                       snapshot and scan only; nothing committed
//   node scripts/publish.mjs --ref <commit> --out <public clone> --identity "Name <email>"
//
// ROADMAP D2 (a release mirror): the public repository receives one squashed commit per release, the tracked files of
// one commit minus a declared exclusion list, never the private history (m2-public-release.plan.md stages 2 and 2b).
// What ships and what stops it are decided in lib/publish.mjs; this script reads and writes.
//
// In order, every step refusing on failure:
//   1. the working tree has no tracked change, and --ref names a commit, master's own unless --dry-run; --out is not the
//      source repository, and --identity matches no local identity pattern;
//   2. the manifest (`publish/manifest.json` AT THAT COMMIT) and the local identity patterns
//      (`.claude/publish.local.json`, gitignored, or --local <file>): the operator's identity is never tracked;
//   3. the snapshot: that commit checked out in a throwaway clone, copied minus exclusions, replacements applied;
//   4. the scans: every shipped text file against the manifest's machine-local patterns, the local identity patterns
//      and the placeholder markers; gitleaks over the snapshot directory; the published contract's keys against the
//      private one's (only doc_roles.request may differ);
//   5. unless --no-suite (a --dry-run only): the snapshot runs on its own (check-syntax, the suite, new-run --dry-run), in
//      its own repository, and a shipped file the checks changed refuses the publish;
//   6. unless --dry-run: the snapshot replaces the tracked content of --out, committed as --identity with the release's
//      CHANGELOG entry as its message, then the snapshot's own scripts/check-secrets.mjs over --out's whole history, its
//      output recorded in --out's git directory; a snapshot shipping none is refused first, and a failing scan undoes the
//      commit. Pushing is the operator's step.
//
// Exit: 0 committed (or a clean dry run) · 1 a finding, a failed check or a refused step · 2 the command line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { gitSync, gitCommitSync } from './io/git.mjs';
import { quorateHome } from './io/reviews-root.mjs';
import { isWithin } from './io/finding-scope.mjs';
import { secretScanConfig, secretScanDirArgv, SECRET_LEAK_EXIT } from './lib/push-gate.mjs';
import { contractBlocks } from './lib/contract-source.mjs';
import { commandEnvFor, scrubChildEnv } from './lib/decisions.mjs';
import { parseContractYaml } from './lib/contract-yaml.mjs';
import {
  validateManifest, validateLocalPatterns, planSnapshot, scanShipped, changelogEntry, commitMessage, parseIdentity,
  contractDrift, applyAllowances, lineSha256, publicContractText, publishRefCheck, secretScanPasses, shipsAsRegularFile,
  untrackedThatShips,
} from './lib/publish.mjs';

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'publish/manifest.json';
const LOCAL = '.claude/publish.local.json';
// The published contract's path is the manifest's `replace['CLAUDE.md']`, and only the manifest's (G-25 of
// 20261117-013640-m2-9a-final; A-1): a second constant here let a move in the manifest alone skip the freshness check.
const BIG = 1024 * 1024 * 1024;

const usage = (msg) => { console.error(`publish: ${msg}`); process.exit(2); };
const refuse = (msg) => { console.error(`publish: ${msg}`); process.exit(1); };
// Once the snapshot's folder exists, a refusal throws, so the folder is removed on the way out.
class Refusal extends Error {}
const stop = (msg) => { throw new Refusal(msg); };

let a;
try { a = parseArgv(process.argv.slice(2), ARGV_SPECS.publish).values; } catch (e) {
  if (!(e instanceof ArgvError)) throw e;
  usage(e.message);
}
// --write-public-contract: regenerate the published contract from this working tree's CLAUDE.md, and nothing else.
if (a['write-public-contract']) {
  const here = path.resolve(a['repo-root'] ?? process.cwd());
  let wm;
  try { wm = validateManifest(JSON.parse(fs.readFileSync(path.join(here, MANIFEST), 'utf8'))); } catch (e) { refuse(`${MANIFEST}: ${e.message}`); }
  if (wm.error) refuse(`${MANIFEST}: ${wm.error}`);
  const target = wm.manifest.replace['CLAUDE.md'];
  if (typeof target !== 'string' || !target) refuse(`${MANIFEST} does not replace CLAUDE.md: there is no published contract to write`);
  if (path.isAbsolute(target) || target.split(/[\\/]/).includes('..')) refuse(`${MANIFEST}: the published contract ${target} is not a path inside the repository`);
  const made = publicContractText(fs.readFileSync(path.join(here, 'CLAUDE.md'), 'utf8'));
  if (made.error) refuse(made.error);
  fs.mkdirSync(path.dirname(path.join(here, target)), { recursive: true });
  fs.writeFileSync(path.join(here, target), made.text);
  console.log(`publish: wrote ${target} from CLAUDE.md`);
  process.exit(0);
}
if (!a.ref) usage('--ref <commit> is required: a snapshot is always of one named commit');
const dryRun = Boolean(a['dry-run']);
if (!dryRun && (!a.out || !a.identity)) usage('--out <public clone> and --identity "Name <email>" are required unless --dry-run');
// I-5: --no-suite exists for dry runs only; a publish that commits runs the snapshot's own checks (G-29 of
// 20261116-200635-m2-9a-high).
if (!dryRun && a['no-suite']) usage('--no-suite is for a --dry-run only: a publish that commits runs the snapshot\'s own checks');
const identity = a.identity ? parseIdentity(a.identity) : null;
if (identity?.error) usage(identity.error);

const top = gitSync(['rev-parse', '--show-toplevel'], { cwd: a['repo-root'] ?? process.cwd(), encoding: 'utf8' });
if (top.status !== 0) usage('not inside a git repository');
const root = path.resolve(top.stdout.trim());
const git = (args, opts = {}) => gitSync(args, { cwd: root, encoding: 'utf8', maxBuffer: BIG, ...opts });
// --out is the public clone, never the source repository or a folder inside it: step 6 deletes --out's tracked files and
// commits there (G-31 of 20261116-200635-m2-9a-high). Checked before anything is touched.
if (!dryRun) {
  // Containment through its owner, which folds case by the platform's caseInsensitiveFs (operator, 2026-11-16: "I reroute
  // G-31 through isWithin, retry (Recommended)"): the node's version read process.platform and tested a `..` prefix.
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  if (isWithin(real(root), real(path.resolve(a.out)))) refuse(`--out ${a.out} is the source repository or inside it; it must be the public clone`);
}

// 1. a clean tree and a commit.
const dirty = git(['status', '--porcelain', '--untracked-files=no']);
if (dirty.status !== 0) refuse(`git status failed: ${dirty.stderr.trim()}`);
if (dirty.stdout.trim()) refuse(`the working tree has tracked changes; publish from a clean tree:\n${dirty.stdout.trimEnd()}`);
const rev = git(['rev-parse', '--verify', '--quiet', `${a.ref}^{commit}`]);
if (rev.status !== 0) refuse(`--ref ${a.ref} is not a commit`);
const sourceCommit = rev.stdout.trim();
// Stage 9c: the snapshot is of exactly master's commit, any other ref refused (G-22 of 20261116-200635-m2-9a-high). A dry
// run commits nothing, so it may preview any commit, and says so.
const master = git(['rev-parse', '--verify', '--quiet', 'refs/heads/master^{commit}']);
const masterCommit = master.status === 0 ? master.stdout.trim() : null;
const refCheck = publishRefCheck({ ref: a.ref, sourceCommit, masterCommit, dryRun });
if (refCheck.refusal) refuse(refCheck.refusal);
if (refCheck.notice) console.log(`publish: ${refCheck.notice}`);
const show = (p) => {
  const r = git(['show', `${sourceCommit}:${p}`]);
  return r.status === 0 ? r.stdout : null;
};

// 2. the manifest and the local identity patterns.
const manifestText = show(MANIFEST);
if (manifestText === null) refuse(`${MANIFEST} is not tracked at ${sourceCommit.slice(0, 8)}`);
let parsed;
try { parsed = JSON.parse(manifestText); } catch (e) { refuse(`${MANIFEST}: ${e.message}`); }
const vm = validateManifest(parsed);
if (vm.error) refuse(`${MANIFEST}: ${vm.error}`);
const manifest = vm.manifest;
// The untracked half of a clean tree (G-5 of 20261119-000606-m2-9c-d1): step 1 sees tracked changes only, and an unignored
// new file at a path that ships means the commit snapshotted is not the tree the operator is looking at. One under an
// excluded path (a review run in .claude/reviews) could never ship, so it is not refused.
const others = git(['ls-files', '-z', '--others', '--exclude-standard']);
if (others.status !== 0) refuse(`git ls-files --others failed: ${others.stderr.trim()}`);
const strays = untrackedThatShips(others.stdout.split('\0'), manifest);
if (strays.length) refuse(`the working tree has untracked files at paths that ship; commit, remove or ignore them, then publish:\n${strays.join('\n')}`);
const localPath = path.resolve(root, a.local ?? LOCAL);
if (!fs.existsSync(localPath)) {
  refuse(`${path.relative(root, localPath) || localPath} is missing: it holds the identity patterns (a username, an e-mail `
    + 'address, the private repository\'s owner) the snapshot is scanned for, and is never tracked. Write it as '
    + '{"patterns":[{"name":"private-repo-owner","regex":"...","flags":"i"},{"name":"...","regex":"...","flags":"i"}]}; the owner pattern is required');
}
let localParsed;
try { localParsed = JSON.parse(fs.readFileSync(localPath, 'utf8')); } catch (e) { refuse(`${localPath}: ${e.message}`); }
const vl = validateLocalPatterns(localParsed);
if (vl.error) refuse(`${localPath}: ${vl.error}`);
// I-6: the published commit's author is held to the same identity patterns as every shipped file (G-19 of
// 20261116-200635-m2-9a-high). Only the pattern's name is printed, never what it matched.
if (identity) {
  const hit = vl.patterns.find((p) => new RegExp(p.regex, p.flags ?? '').test(`${identity.name} <${identity.email}>`));
  if (hit) refuse(`--identity matches the local identity pattern ${JSON.stringify(hit.name)}; a release is never committed as the operator`);
}
if (!vl.patterns.length) refuse(`${localPath} has no patterns: a publish never runs without the identity scan`);

const version = (show('VERSION') ?? '').trim();
const changelog = show('CHANGELOG.md');
if (changelog === null) refuse(`CHANGELOG.md is not tracked at ${sourceCommit.slice(0, 8)}`);
const entry = changelogEntry(changelog, version);
// A dry run reports a missing entry with everything else and goes on scanning; a commit refuses here, before any work.
if (entry.error && !dryRun) refuse(entry.error);
if (entry.error) console.log(`publish: CHANGELOG: ${entry.error}`);

// 3. the snapshot.
const ls = git(['ls-tree', '-r', '--name-only', '-z', sourceCommit]);
if (ls.status !== 0) refuse(`git ls-tree failed: ${ls.stderr.trim()}`);
// Only regular files ship: copyFileSync follows a symbolic link, so a tracked link (120000) would ship bytes from outside
// the commit, and a gitlink (160000) is another repository's commit, not content (G-24 of 20261116-200635-m2-9a-high).
const modes = git(['ls-tree', '-r', '-z', sourceCommit]);
if (modes.status !== 0) refuse(`git ls-tree failed: ${modes.stderr.trim()}`);
const irregular = modes.stdout.split('\0').filter(Boolean).map((l) => {
  const tab = l.indexOf('\t');
  return { mode: l.slice(0, tab).split(' ')[0], file: l.slice(tab + 1) };
}).filter((e) => !shipsAsRegularFile(e.mode));
if (irregular.length) {
  refuse(irregular.map((e) => `${e.file} is ${e.mode === '120000' ? 'a symbolic link' : `not a regular file (mode ${e.mode})`}; only regular files ship`).join('\n'));
}
const plan = planSnapshot(ls.stdout.split('\0').filter(Boolean), manifest);
if (plan.errors.length) refuse(plan.errors.join('\n'));
// I-4: the private CLAUDE.md never ships as itself; the manifest must replace it (G-28 of 20261116-200635-m2-9a-high),
// and the drift and staleness checks below run only on a replacement.
if (plan.ship.some((f) => f.path === 'CLAUDE.md' && f.from === 'CLAUDE.md')) {
  refuse(`CLAUDE.md is tracked and would ship as itself; ${MANIFEST} must replace it with the published contract, or exclude it`);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-publish-'));
const raw = path.join(work, 'source');
const staging = path.join(work, 'snapshot');
let exitCode = 0;
try {
  // The committed bytes, whatever this machine's core.autocrlf: the snapshot is the commit, not one checkout of it.
  const cl = gitSync(['clone', '--quiet', '--no-checkout', '--shared', '-c', 'core.autocrlf=false', root, raw], { encoding: 'utf8' });
  if (cl.status !== 0) stop(`clone for the snapshot failed: ${cl.stderr.trim()}`);
  const co = gitSync(['checkout', '--quiet', '--detach', sourceCommit], { cwd: raw, encoding: 'utf8' });
  if (co.status !== 0) stop(`checkout of ${sourceCommit} failed: ${co.stderr.trim()}`);
  for (const { path: to, from } of plan.ship) {
    const dest = path.join(staging, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(raw, from), dest);
  }
  console.log(`publish: snapshot of ${sourceCommit.slice(0, 8)}: ${plan.ship.length} files, ${plan.excluded.length} excluded`);

  // 4. the scans. A local identity pattern is renamed local:<name>, so no allowance can ever name one.
  const patterns = [...manifest.patterns, ...vl.patterns.map((p) => ({ ...p, name: `local:${p.name}` }))];
  const hits = [];
  for (const { path: rel } of plan.ship) {
    const buf = fs.readFileSync(path.join(staging, rel));
    // The manifest declares the markers, so it is the one file not held to them; its patterns still apply. A binary or
    // UTF-16 file is scanned too: gitleaks never sees the identity patterns (G-22 of 20261116-221234-m2-9a-high-2).
    hits.push(...scanShipped(rel, buf, { patterns, markers: rel === MANIFEST ? [] : manifest.markers }));
  }

  const config = secretScanConfig({ repoRoot: staging, frameworkRoot: FRAMEWORK_ROOT, exists: fs.existsSync });
  // The scanner's command: `gitleaks`, or QUORATE_PUBLISH_GITLEAKS (a JSON argv prefix), the tests' stand-in. An
  // override is printed, so a publish that scanned with something else never reads as a gitleaks scan.
  let glCmd = ['gitleaks'];
  if (process.env.QUORATE_PUBLISH_GITLEAKS) {
    try { glCmd = JSON.parse(process.env.QUORATE_PUBLISH_GITLEAKS); } catch { stop('QUORATE_PUBLISH_GITLEAKS is not a JSON argv'); }
    if (!Array.isArray(glCmd) || !glCmd.length || glCmd.some((s) => typeof s !== 'string')) stop('QUORATE_PUBLISH_GITLEAKS is not a JSON argv');
    console.log(`publish: the secret scanner is OVERRIDDEN by QUORATE_PUBLISH_GITLEAKS: ${glCmd.join(' ')}`);
  }
  const report = path.join(work, 'gitleaks.json');
  // Suppression comes from the manifest's allow list only (I-2; G-23 of 20261116-221234-m2-9a-high-2). gitleaks reads a
  // .gitleaksignore from its ignore path (the working directory by default) and from the scanned directory, so the ignore
  // path is an empty folder and a shipped .gitleaksignore is renamed for the scan: still scanned as content, never obeyed.
  const noIgnore = path.join(work, 'no-gitleaksignore');
  fs.mkdirSync(noIgnore);
  const IGNORE_FILE = '.gitleaksignore';
  const IGNORE_ASIDE = '.gitleaksignore.publish-scan';
  const ignoreShipped = fs.existsSync(path.join(staging, IGNORE_FILE));
  // A rename onto a shipped file replaces it, and its bytes would never be scanned (G-10 of
  // 20261116-231613-m2-9a2-remediation-review), so a snapshot that ships the aside name is refused.
  if (ignoreShipped && fs.existsSync(path.join(staging, IGNORE_ASIDE))) {
    stop(`the snapshot ships ${IGNORE_ASIDE}, the name its ${IGNORE_FILE} is set aside under for the secret scan; nothing was committed`);
  }
  if (ignoreShipped) fs.renameSync(path.join(staging, IGNORE_FILE), path.join(staging, IGNORE_ASIDE));
  const glArgv = [...glCmd, ...secretScanDirArgv(staging, { config, reportPath: report, ignorePath: noIgnore })];
  // Every publish says how its scan ran, the rules file included (I-2; G-26 of 20261116-200635-m2-9a-high).
  console.log(`publish: secret scan command: ${glArgv.join(' ')}`);
  // The scanner and the snapshot's checks run code this engine did not review (the snapshot's, or a stand-in), so they
  // get no run pin, no runtime auth and no secret-shaped variable (I-31; G-25 of 20261116-221234-m2-9a-high-2).
  const childEnv = commandEnvFor(scrubChildEnv(process.env).env, { remediation: true });
  const gl = spawnSync(glArgv[0], glArgv.slice(1), { stdio: 'inherit', env: childEnv });
  if (ignoreShipped) fs.renameSync(path.join(staging, IGNORE_ASIDE), path.join(staging, IGNORE_FILE));
  const leaksMissing = gl.error?.code === 'ENOENT';
  // Each gitleaks finding as a hit of its own, by file, line and rule (G3: every finding is resolved, so every one is
  // named); the secret itself stays redacted, and the report stays in the throwaway folder.
  let reportRead = false;
  try {
    for (const l of JSON.parse(fs.readFileSync(report, 'utf8'))) {
      const seen = path.relative(staging, path.resolve(staging, String(l.File ?? ''))).split(path.sep).join('/');
      const rel = ignoreShipped && seen === IGNORE_ASIDE ? IGNORE_FILE : seen;
      // The line named by its hash, read from the staged copy (an allowance names one line: lineSha256); the text itself
      // is never printed or kept, since it holds what gitleaks matched.
      let lineHash = null;
      try { lineHash = lineSha256(fs.readFileSync(path.join(staging, rel), 'utf8').split(/\r?\n/)[Number(l.StartLine) - 1] ?? ''); } catch { /* unread: no allowance can match it */ }
      hits.push({ path: rel, line: l.StartLine, name: `gitleaks:${l.RuleID}`, excerpt: '(redacted)', line_sha256: lineHash });
    }
    reportRead = true;
  } catch { /* no report: the scanner did not run, or a stand-in wrote none; its exit status decides below */ }

  const { kept, allowed, unused } = applyAllowances(hits, manifest.allow);
  for (const h of kept) {
    console.log(h.marker ? `publish: ${h.path}:${h.line} placeholder ${JSON.stringify(h.marker)}`
      : `publish: ${h.path}:${h.line} ${h.name}: ${h.excerpt}${h.line_sha256 ? ` [line_sha256 ${h.line_sha256}]` : ''}`);
  }
  for (const u of unused) console.log(`publish: allowance matched nothing, so it is stale: ${u.path} ${u.pattern} (${u.reason})`);
  console.log(`publish: scan: ${kept.length} finding(s), ${allowed.length} allowed by the manifest, ${unused.length} stale allowance(s), over ${plan.ship.length} files (${patterns.length} patterns, ${manifest.markers.length} markers)`);
  // A gitleaks exit of 99 passes only when its report was read and every finding in it is allowed.
  const glKept = kept.some((h) => h.name?.startsWith('gitleaks:'));
  // An exit of 99 with no finding in its report is contradictory, and refuses (G-27 of 20261116-200635-m2-9a-high).
  const glAllowed = allowed.some((h) => h.name?.startsWith('gitleaks:'));
  // What an exit means is the push scan's owner's (A-1; G-10 of 20261116-231613-m2-9a2-remediation-review); only the
  // allowances are the publish's own.
  const glOk = secretScanPasses({ missing: leaksMissing, status: gl.status, reportRead, kept: glKept, allowed: glAllowed });
  if (leaksMissing) console.log('publish: gitleaks is not installed; a publish never runs without the secret scan');
  else console.log(`publish: gitleaks: ${gl.status === 0 ? 'no secrets found' : gl.status === SECRET_LEAK_EXIT ? (glOk ? 'every finding allowed by the manifest' : 'a secret was found (redacted)') : `failed (exit ${gl.status})`}`);

  let drift = [];
  if (manifest.replace['CLAUDE.md']) {
    const contractOf = (text) => parseContractYaml(contractBlocks(text)[0] ?? '');
    try {
      drift = contractDrift(contractOf(show('CLAUDE.md') ?? ''), contractOf(show(manifest.replace['CLAUDE.md']) ?? ''));
    } catch (e) { drift = [`(unparseable contract: ${e.message})`]; }
    console.log(`publish: published contract: ${drift.length ? `differs from the private one at ${drift.join(', ')}` : 'keys match the private contract'}`);
  }
  // Its KEYS are checked, not its bytes (G-32 of 20261117-013640-m2-9a-final; operator: "Check keys, allow reader comments
  // (Recommended)"): I-5 lets its comments be written for readers, so a comment-only difference is no drift.
  // --write-public-contract still makes a starting copy from CLAUDE.md.
  if (kept.length || unused.length || !glOk || drift.length || entry.error) stop('the snapshot is not publishable; nothing was committed');

  // 5. the snapshot runs on its own, in its own repository, with TEMP outside it.
  if (a['no-suite']) {
    console.log('publish: --no-suite: the snapshot\'s own checks were NOT run');
  } else {
    const init = [['init', '--quiet'], ['add', '-A']].every((args) => gitSync(args, { cwd: staging }).status === 0)
      && gitCommitSync(['commit', '--quiet', '-m', 'snapshot'], { cwd: staging, gitVars: {
        GIT_AUTHOR_NAME: 'snapshot', GIT_AUTHOR_EMAIL: 'snapshot@example.invalid',
        GIT_COMMITTER_NAME: 'snapshot', GIT_COMMITTER_EMAIL: 'snapshot@example.invalid' } }).status === 0;
    if (!init) stop('the snapshot could not be made a repository for its own checks');
    const tmp = path.join(work, 'tmp');
    fs.mkdirSync(tmp);
    const env = { ...childEnv, TEMP: tmp, TMP: tmp, TMPDIR: tmp };
    let logDir = null;
    const checksLog = () => {
      if (!logDir) {
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
        logDir = path.join(quorateHome(), 'publish', `${stamp}-${sourceCommit.slice(0, 12)}`);
        fs.mkdirSync(logDir, { recursive: true });
      }
      return logDir;
    };
    // `--full-sweep scripts`, where I-6 names a bare `new-run --dry-run` (G-34 of 20261117-013640-m2-9a-final): the
    // snapshot is a fresh one-commit repository with no changed source, and new-run refuses to infer a whole-repo scope
    // from an empty diff (new-run.mjs, "Refusing to infer a whole-repo scope"), so the bare form could only ever refuse.
    // The sweep asserts the scope; the contract resolution and every other dry-run step run unchanged.
    for (const [label, args] of [['build', ['scripts/check-syntax.mjs']], ['tests', ['tests/run-all.mjs']],
      ['contract', ['scripts/new-run.mjs', '--dry-run', '--full-sweep', 'scripts']]]) {
      // Its output is kept, not only shown (I-5; G-11 of 20261116-231613-m2-9a2-remediation-review): the working folder
      // is removed below, so each check's output goes to a log in the engine's home (operator: "In the engine's home
      // (Recommended)"), and the publish names it.
      const r = spawnSync(process.execPath, args, { cwd: staging, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: BIG });
      const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      if (text) process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
      const logFile = path.join(checksLog(), `${label}.log`);
      fs.writeFileSync(logFile, `# publish: snapshot ${label}: node ${args.join(' ')}\n# source commit ${sourceCommit}\n`
        + `# exit ${r.status}${r.error ? ` (${r.error.message})` : ''}\n${text}`);
      console.log(`publish: snapshot ${label}: exit ${r.status}; output recorded in ${logFile}`);
      if (r.status !== 0) stop(`the snapshot's ${label} check failed; nothing was committed`);
    }
    // The checks ran in the scanned tree: a shipped file they changed would ship unscanned (G-33 of
    // 20261116-200635-m2-9a-high). Untracked files they leave are never copied, since step 6 copies plan.ship only.
    const after = gitSync(['status', '--porcelain', '--untracked-files=no'], { cwd: staging, encoding: 'utf8' });
    if (after.status !== 0) stop(`git status in the snapshot failed after its checks: ${(after.stderr ?? '').trim()}`);
    if (after.stdout.trim()) stop(`the snapshot's own checks changed shipped files, so what was scanned is not what would ship:\n${after.stdout.trimEnd()}`);
    fs.rmSync(path.join(staging, '.git'), { recursive: true, force: true });
  }

  if (dryRun) {
    console.log('publish: --dry-run: nothing was committed');
  } else {
    // 6. into the public clone: its tracked content replaced by the snapshot, one commit, never pushed.
    // I-6: the public CI's scan is the snapshot's own, so a snapshot that ships none is refused before --out is touched
    // (G-11 of 20261119-051632-m2-9c-secret-scan): its absence was a notice, and the commit stood unscanned.
    const PUBLIC_SCAN = 'scripts/check-secrets.mjs';
    if (!plan.ship.some((f) => f.path === PUBLIC_SCAN)) {
      stop(`the snapshot ships no ${PUBLIC_SCAN}, so the public CI's secret scan cannot run in --out; nothing was committed`);
    }
    const out = path.resolve(a.out);
    const og = (args, opts = {}) => gitSync(args, { cwd: out, encoding: 'utf8', maxBuffer: BIG, ...opts });
    if (og(['rev-parse', '--is-inside-work-tree']).stdout?.trim() !== 'true') stop(`--out ${out} is not a git working tree`);
    // BOTH ON THEIR REAL PATH, compared by the host's case rule (ci-path-identity.plan.md stage 2; PR #3's Windows job): --out
    // under the runner's TEMP was spelled 8.3 short (RUNNER~1) and git's top level long, so every committing publish was
    // refused. A link above --out (/var on macOS) is the same respelling. One path is the other when each is within it.
    const realOf = (p) => { try { return (fs.realpathSync.native ?? fs.realpathSync)(p); } catch { return path.resolve(p); } };
    const top = og(['rev-parse', '--show-toplevel']).stdout.trim();
    const [realOut, realTop] = [realOf(out), realOf(top)];
    if (!(isWithin(realTop, realOut) && isWithin(realOut, realTop))) {
      stop(`--out ${out} is not the top of its repository${realOut !== out || realTop !== path.resolve(top) ? ` (as real paths: ${realOut}, top ${realTop})` : ` (its top is ${top})`}`);
    }
    // A failed status read as "clean" would let a dirty --out be overwritten (the class of G-26 of 20261116-221234-m2-9a-high-2).
    const outStatus = og(['status', '--porcelain']);
    if (outStatus.status !== 0) stop(`git status in --out failed: ${(outStatus.stderr ?? '').trim()}`);
    if (outStatus.stdout.trim()) stop(`--out ${out} has uncommitted changes`);
    // A failed listing read as "no tracked files" would leave files deleted from the source in the public commit (G-26 of
    // 20261116-221234-m2-9a-high-2).
    const listed = og(['ls-files', '-z']);
    if (listed.status !== 0) stop(`git ls-files in --out failed: ${(listed.stderr ?? '').trim()}`);
    // Where --out stood before this publish, so a rejected commit can be undone (G-10 of 20261119-051632-m2-9c-secret-scan).
    // null is an unborn branch: a fresh clone of an empty repository.
    const priorHead = og(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    const prior = priorHead.status === 0 ? priorHead.stdout.trim() : null;
    const gitDir = og(['rev-parse', '--absolute-git-dir']);
    if (gitDir.status !== 0) stop(`git rev-parse --absolute-git-dir in --out failed: ${(gitDir.stderr ?? '').trim()}`);
    // No link is followed below --out (G-35 of 20261117-013640-m2-9a-final): each level of a path deleted or written there
    // is held to not being a symbolic link or junction, so a link standing in the clone cannot redirect a deletion or a
    // copy outside it. Where git would already report such a layout as a change, this holds the same rule at the write.
    const linkBelowOut = (rel) => {
      const parts = rel.split(/[\\/]/).filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        let st;
        try { st = fs.lstatSync(path.join(out, ...parts.slice(0, i))); } catch { return null; }
        if (st.isSymbolicLink()) return parts.slice(0, i).join('/');
      }
      return null;
    };
    for (const f of listed.stdout.split('\0').filter(Boolean)) {
      const link = linkBelowOut(path.dirname(f) === '.' ? '' : path.dirname(f));
      if (link) stop(`--out ${out}: ${link} is a link; nothing below --out is deleted through one`);
      fs.rmSync(path.join(out, f), { force: true });
    }
    for (const { path: rel } of plan.ship) {
      const link = linkBelowOut(rel);
      if (link) stop(`--out ${out}: ${link} is a link; nothing below --out is written through one`);
      const dest = path.join(out, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(staging, rel), dest);
    }
    if (og(['add', '-A']).status !== 0) stop('git add in --out failed');
    const msgFile = path.join(work, 'message.txt');
    fs.writeFileSync(msgFile, commitMessage({ version, entry, sourceCommit }));
    const c = gitCommitSync(['commit', '--quiet', '--allow-empty', '-F', msgFile], { cwd: out, encoding: 'utf8', gitVars: {
      GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email } });
    if (c.status !== 0) stop(`the commit in --out failed: ${(c.stderr ?? '').trim()}`);
    const head = (og(['rev-parse', 'HEAD']).stdout ?? '').trim() || '(HEAD unread)';
    // The public repository's CI secret scan, run here as it runs there: the published tree's own check-secrets over
    // --out's WHOLE history, with the shipped rules and .gitleaksignore (M2 stage 9c, 2026-11-19; operator: "Build the
    // fakes at runtime (Recommended)"). 2a669ba0 passed every check above and failed this one on GitHub, since the
    // scan above reads the snapshot alone, with the shipped ignore file set aside. The scan reads history, so it runs on
    // the commit; a failure UNDOES that commit (I-6: a failing result blocks it; G-10 of
    // 20261119-051632-m2-9c-secret-scan), where it once stood at HEAD awaiting a hand reset. Its output is recorded in
    // --out's git directory, which is in --out and is never tracked or shipped (I-6; G-11).
    const cs = spawnSync(process.execPath, [path.join(out, ...PUBLIC_SCAN.split('/'))], { cwd: out, env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: BIG });
    const csText = `${cs.stdout ?? ''}${cs.stderr ?? ''}`;
    if (csText) process.stdout.write(csText.endsWith('\n') ? csText : `${csText}\n`);
    const csExit = cs.status ?? cs.error?.code;
    const csLog = path.join(gitDir.stdout.trim(), 'quorate-publish', 'check-secrets.log');
    // Nothing between the commit and the undo may throw (G-11 of 20261119-055149-m2-9c-secret-scan-remediation-review): a
    // record that could not be written once threw past the undo, leaving the rejected commit at HEAD. A failed record is
    // said, and the undo below runs either way.
    let recorded;
    try {
      fs.mkdirSync(path.dirname(csLog), { recursive: true });
      fs.writeFileSync(csLog, `# publish: the public CI's secret scan: node ${PUBLIC_SCAN}, in --out, over its whole history\n`
        + `# commit ${head} (source commit ${sourceCommit})\n# exit ${csExit}${cs.error ? ` (${cs.error.message})` : ''}\n${csText}`);
      recorded = `recorded in ${csLog}`;
    } catch (e) {
      recorded = `its result could not be recorded in ${csLog} (${e.message}); its output is above`;
    }
    if (cs.status !== 0) {
      // --out was clean before this publish (checked above), so returning it to its prior commit loses nothing of the
      // operator's. An unborn branch has no prior commit: the ref is deleted, the index emptied and the shipped files removed.
      let undone;
      if (prior) {
        undone = og(['reset', '--quiet', '--hard', prior]).status === 0;
      } else {
        undone = og(['update-ref', '-d', 'HEAD']).status === 0 && og(['read-tree', '--empty']).status === 0;
        if (undone) for (const { path: rel } of plan.ship) fs.rmSync(path.join(out, rel), { force: true });
      }
      stop(`the public CI's secret scan (${PUBLIC_SCAN} in --out, over its whole history) fails on ${head} (exit ${csExit}), `
        + `${recorded}: ${undone ? `the commit was undone, --out is back at ${prior ?? 'its unborn branch'}; fix the finding and publish again`
          : `undoing it FAILED: do not push; reset --out by hand with git -C ${out} reset --hard ${prior ?? '(delete HEAD)'}`}`);
    }
    console.log(`publish: the public CI's secret scan passes over --out's whole history (${PUBLIC_SCAN}); ${recorded}`);
    console.log(`publish: committed ${head} in ${out} as ${identity.name} <${identity.email}>; not pushed (the operator's step)`);
  }
} catch (e) {
  exitCode = 1;
  console.error(`publish: ${e instanceof Refusal ? e.message : (e.stack ?? e)}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
// Set, never process.exit (G-12 of 20261116-231613-m2-9a2-remediation-review): exiting at once can drop the findings still
// queued for an asynchronous stdout pipe. Only synchronous calls ran above, so nothing holds the process open.
process.exitCode = exitCode;
