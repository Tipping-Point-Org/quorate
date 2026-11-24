// hardlink-egress.plan.md stage 3 (design HL-D3 A): THE SET of sites where a file's content leaves the machine (to an
// external vendor or a subagent) or enters the intent sandbox. Each listed site reads through the egress owner
// (scripts/lib/egress-read.mjs, bound in scripts/io/egress-read.mjs), which refuses a link, a junction and a file with a
// second name. In the files that hold those sites, every other raw read of a file's content is named here with why it is
// not bound for a vendor or the sandbox; a new one fails until it is routed through the owner or named. The bench is the
// one site that warns instead of refusing, by the operator's ruling of 2026-10-31, and is named as such.
//
// ITS LIMIT, stated: the census is lexical. A read through an aliased or re-exported filesystem call (`const r =
// fs.readFileSync`, a helper in another module), or a site in a file not listed here, is outside what it sees; the files
// are the ones the design note's census (2026-11-11, at 071884c3) found, and the arms' snapshot, which refused hard links
// before this owner existed (scripts/io/snapshot.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, makeLink } from './helpers.mjs';

const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');

// [file, a pattern its egress read matches, what goes where]
const SITES = [
  ['scripts/io/seat-copies.mjs', /const from = egress\(repoRoot\);/, 'a decision seat\'s copies, to every seat\'s vendor'],
  // G-5 and G-10 of 20261112-050334-hl-review-b: the link count was stat'ed, then the file copied raw, two operations; the
  // content is now read from the one descriptor whose count was checked, and handed to the writer.
  ['scripts/io/doc-snapshot.mjs', /content = egressReadDeclared\(src\);/, 'every document, the doctrine and the request entering the intent sandbox'],
  ['scripts/run-graph.mjs', /write: \(name, content\) => runOwner\.replace\(\['sandbox', nodeId, 'declared-docs', name\], content\)/, 'the intent sandbox\'s copy, of the content the owner read'],
  // G-4 of 20261112-054852-hl-remediation-3-review: rooted at the run, so the 8 MiB bound holds here too; through the run
  // entry, egressRunReader, since G-2 of 20261115-042114-pbr-1b-remediation-4-review.
  ['scripts/external-review.mjs', /return egressRunReader\(admittedRunDir\)\.read\(abs\);/, 'a reviewer\'s prompt below a run, to its vendor'],
  ['scripts/external-review.mjs', /try \{ return egressReadFile\(abs, 'utf8', \{ repoRoot: gitWorktreeRoots\(\)\?\.\[0\] \?\? null \}\); \}/, 'a reviewer\'s prompt outside a run, to its vendor'],
  ['scripts/spawn-subagent.mjs', /prompt = egressReadFile\(args\.promptFile, 'utf8', \{ repoRoot: args\.repoRoot \? path\.resolve\(args\.repoRoot\) : process\.cwd\(\) \}\)/, 'a subagent\'s prompt, to the runtime\'s vendor'],
  ['scripts/decide.mjs', /questionText = egressReadFile\(path\.resolve\(String\(opts\.question\)\), 'utf8', \{ repoRoot: REPO_REAL \}\)/, 'a decision\'s question, to every seat\'s vendor'],
  ['scripts/claim-check.mjs', /draftText = egressReadFile\(draftPath, 'utf8', \{ repoRoot \}\)/, 'the draft, to the cross-family checker'],
  ['scripts/claim-check.mjs', /fs\.writeFileSync\(path\.join\(d, SURFACE_SUB, 'draft\.md'\), draftText\)/, 'the draft the owner read, copied, not read again'],
  // G-2 of 20261112-054852-hl-remediation-3-review: rooted at the repository, as the draft is, not at the file's own folder.
  ['scripts/claim-check.mjs', /const t = egressRootOf\(path\.resolve\(transcript\), repoRoot\); egress\(t\.root\)\.stat\(t\.segments\);/, 'the transcript, refused before a checker starts'],
  ['scripts/claim-check.mjs', /redactedTranscriptCopy\(transcript, dir, \{ repoRoot \}\)/, 'the transcript\'s copy, rooted at the repository'],
  ['scripts/io/transcript-copy.mjs', /egressReadLines\(abs, [\s\S]*?\}, undefined, \{ repoRoot: opts\.repoRoot \}\)/, 'the transcript\'s redacted copy, to the cross-family checker'],
  // G-12 of 20261112-054852-hl-remediation-3-review: the external arm's lens instructions go into its vendor's prompt; they
  // were named below as a raw read. Rooted at the framework, as claim-check's checker instructions are.
  // Read before the prompt is built, its refusal caught, since G-30 of 20261121-204740-m3s7-b1-remediation-review.
  ['scripts/run-graph.mjs', /try \{ armSkill = egressReadFile\(skillPath, 'utf8', \{ repoRoot: FRAMEWORK\.frameworkRoot \}\); \}/, 'the external arm\'s lens instructions, to its vendor'],
  // G-8, G-7 and G-6 of 20261114-195905-m2-pred1-remediation-2-review: the arm's other prompt inputs and its census copy.
  // G-10 of 20261112-054852-hl-remediation-3-review: every prompt template goes into a node's, a reviewer's, a seat's or a
  // checker's prompt, so it is read through the owner, rooted at the templates' folder.
  ['scripts/lib/template.mjs', /return egress\(\{ root: dir, io \}\)\.read\(\[name\], 'utf8'\);/, 'every prompt template, to a vendor or a subagent'],
  // G-2 of 20261112-050334-hl-review-b: the checker's instructions go into both checkers' prompts, so they are read
  // through the owner, rooted at the framework's own folder; they were named below as a raw read.
  ['scripts/claim-check.mjs', /checker = egressReadFile\(path\.join\(scripts, '\.\.', 'skills', 'claim-check', 'CHECKER\.md'\)/, 'the checker\'s instructions, to both checkers'],
  // G-3 of 20261112-050334-hl-review-b: the declared request's stage heading goes into every seat's work context, so the
  // request is read through the egress owner, not the repository's confined one.
  ['scripts/decide.mjs', /planText = egress\(REPO_REAL\)\.read\(parsedRequest\.segments\)/, 'the declared request\'s stage heading, to every seat\'s vendor'],
  // G-13 of 20261112-063354-hl-remediation-4-review: the project profile is inlined into every node brief; its bounded read
  // refuses a file with a second name from the stat it already takes (readSync is outside RAW, so this site is named here).
  // G-10 of 20261112-073408-hl-remediation-5-review: the stat and the bounded read were raw and followed links; both now go
  // through the owner, which refuses a link at any level below the repository.
  ['scripts/lib/project-profile.mjs', /raw = own\.readBounded\(segments, maxBytes \+ 3\)\.toString\('utf8'\);/, 'the project profile, inlined into every node brief'],
  // G-14 of 20261112-063354-hl-remediation-4-review: the disputed lines go into every judge's prompt.
  ['scripts/lib/excerpt.mjs', /try \{ text = egress\(\{ root, io \}\)\.read\(rel\.split\('\/'\), 'utf8'\); \}/, 'the disputed lines, to every judge\'s vendor'],
  // G-15 of 20261112-063354-hl-remediation-4-review: a node's inlined instructions, and the schema it answers in.
  ['scripts/spawn-node.mjs', /instructions: egressReadFile\(file, 'utf8', \{ repoRoot: FRAMEWORK\.frameworkRoot \}\),/, 'a node\'s inlined instructions, to the runtime\'s vendor'],
  ['scripts/spawn-node.mjs', /const base = JSON\.parse\(egressReadFile\(BASE_SCHEMA_PATH, 'utf8', \{ repoRoot: FRAMEWORK\.frameworkRoot \}\)\);/, 'the envelope schema, passed to the runtime'],
  // G-10 of 20261114-184441-m2-pred1-remediation-b-review: the intent node's brief is copied into its sandbox; the
  // confined owner's read cannot see a second name, so the copy reads through the egress owner, rooted at the run.
  // The same class at the contract snapshot's two sandbox copies, the intent node's and the mint's canary.
  ['scripts/new-run.mjs', /mintOwner\.replace\(\['sandbox', 'intent-canary', 'contract\.snapshot\.md'\], egressRunReader\(runDir\)\.read\(\['contract\.snapshot\.md'\], null\)\)/, 'the frozen contract, into the canary\'s sandbox'],
  // G-12 of 20261112-063354-hl-remediation-4-review: the contract becomes contract.snapshot.md, copied into the sandbox.
  ['scripts/new-run.mjs', /text: fs\.existsSync\(abs\) \? egressReadFile\(abs, 'utf8', \{ repoRoot \}\) : null/, 'the contract, snapshotted into the intent sandbox'],
];

// THE RUN-FILE SITES MOVED (prompt-bound-run-reads.plan.md, 2026-11-14): the shadowed lens's brief, the intent criteria, the
// remediation census copy, the contract snapshot's sandbox copy and the intent node's brief now read through
// egressRunReader, the egress owner rooted at the run, and are held by tests/regression-prompt-bound-run-reads.test.mjs,
// which also sees the aliased readers this census cannot.
// In those files, every other raw content read: [file, the line's text (trimmed; a prefix), why it is not egress].
const RAW = /\b(readFileSync|copyFileSync|createReadStream|cpSync)\(/;
const NAMED = [
  ['scripts/external-review.mjs', "const roster = JSON.parse(fs.readFileSync(path.join(HERE, 'lens-roster.json')", 'the engine\'s roster, read locally'],
  ['scripts/external-review.mjs', "const text = fs.readFileSync(p, 'utf8');", 'the probe\'s check that its surface is an empty git repository: read locally, sent nowhere'],
  ['scripts/external-review.mjs', "try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }", 'the vendor\'s own answer file, coming back, not going out'],
  ['scripts/spawn-subagent.mjs', 'const roster = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), \'lens-roster.json\')', 'the engine\'s roster, read locally'],
  ['scripts/decide.mjs', "try { roster = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'lens-roster.json')", 'the engine\'s roster, read locally'],
  ['scripts/claim-check.mjs', "result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json')", 'the checker\'s answer, coming back'],
  ['scripts/claim-check.mjs', "try { checkInfo = JSON.parse(fs.readFileSync(path.join(dir, 'check.json')", 'this check\'s own record, read locally'],
  ['scripts/claim-check.mjs', 'const res = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`)', 'a checker\'s answer, coming back'],
  ['scripts/claim-check.mjs', "const roster = JSON.parse(fs.readFileSync(path.join(scripts, 'lens-roster.json')", 'the engine\'s roster, read locally'],
  ['scripts/claim-check.mjs', 'if (copy) { egress(path.dirname(copy.path)).stat([path.basename(copy.path)]); fs.copyFileSync(copy.path,', 'this process\'s own redacted copy, checked by the egress owner first'],
  ['scripts/claim-check.mjs', "try { out = JSON.parse(fs.readFileSync(armOut, 'utf8')); } catch { /* no output: no entry */ }", 'the arm\'s answer, coming back'],
  ['scripts/claim-check.mjs', "try { out = JSON.parse(fs.readFileSync(armOut, 'utf8')); } catch { /* named below */ }", 'the arm\'s answer, coming back'],
  ['scripts/run-graph.mjs', "const GATE_SCHEMA = JSON.parse(fs.readFileSync(path.join(scriptsDir, 'gate.schema.json')", 'the engine\'s gate schema, read locally to check the gate before it is written'],
  ['scripts/run-graph.mjs', "const roster = JSON.parse(fs.readFileSync(path.join(scriptsDir, 'lens-roster.json')",'the engine\'s roster, read locally'],
  ['scripts/run-graph.mjs', "const actualSha = resolvedReq ? crypto.createHash('sha256').update(fs.readFileSync(resolvedReq, 'utf8'))", 'the request\'s hash, checked against the one frozen at mint: read locally'],
  ['scripts/run-graph.mjs', "const text = fs.readFileSync(c.abs, 'utf8');", 'a request\'s status, read locally to choose it'],
  // G-16 of 20261112-063354-hl-remediation-4-review: spawn-node.mjs and new-run.mjs left the whole-file baseline, each
  // remaining raw read judged here.
  ['scripts/spawn-node.mjs', "_roster = JSON.parse(fs.readFileSync(path.join(FRAMEWORK.scriptsDir, 'lens-roster.json')", 'the engine\'s roster, read locally'],
  ['scripts/spawn-node.mjs', "return crypto.createHash('sha256').update(segs ? owner.read(segs, null) : fs.readFileSync(p))", 'a file\'s hash, read locally'],
  ['scripts/new-run.mjs', "return JSON.parse(fs.readFileSync(path.join(FRAMEWORK.scriptsDir, 'lens-roster.json')", 'the engine\'s roster, read locally'],
  ['scripts/new-run.mjs', "const roster = JSON.parse(fs.readFileSync(path.join(FRAMEWORK.scriptsDir, 'lens-roster.json')", 'the engine\'s roster, read locally'],
  ['scripts/new-run.mjs', "validateNodeSettings(fs.readFileSync(p, 'utf8'));", 'a settings file validated locally, sent nowhere'],
  ['scripts/new-run.mjs', ".filter((abs) => requestIsApproved(fs.readFileSync(abs, 'utf8')));", 'a request\'s status, read locally to choose it'],
  ['scripts/new-run.mjs', "const text = fs.readFileSync(abs, 'utf8');", 'the request\'s status and hash, read locally; its sandbox copy is io/doc-snapshot.mjs\'s egressReadDeclared'],
  ['scripts/new-run.mjs', "const txt = fs.readFileSync(p, 'utf8');", 'a settings file\'s hash, read locally'],
  ['scripts/new-run.mjs', "const sourceLines = fs.readFileSync(intentTarget, 'utf8')", 'the canary\'s leak detector, read locally to compare'],
];
const FILES = [...new Set([...SITES.map(([f]) => f), 'scripts/run-graph.mjs'])];

// G-14 of 20261112-054852-hl-remediation-3-review: THE SOURCE TREE, not only the files above. Every script under scripts/
// that makes a raw content read is either an egress file above (each read checked line by line) or listed here. A new file
// with a raw read fails until it is classified, which the files-only scan could not see. The files below are the ones that
// held a raw read when the scan was added; whether each of their reads leaves the machine is not yet judged line by line
// (deferred by that remediation), so this list is a baseline, not a ruling that none of them is egress.
const BASELINE_UNCLASSIFIED = [
  'scripts/bench-admit.mjs', 'scripts/bench-lenses.mjs', 'scripts/bench-second-opinion.mjs', 'scripts/check-counted-facts.mjs',
  'scripts/check-install.mjs', 'scripts/check-plan-verdict.mjs', 'scripts/check-quotes.mjs', 'scripts/check-reviewers.mjs',
  'scripts/code-index.mjs', 'scripts/extract-sessions.mjs', 'scripts/find-inert-features.mjs', 'scripts/findings-ledger.mjs',
  'scripts/gen-rule-text.mjs', 'scripts/io/atomic.mjs', 'scripts/io/basis-values.mjs', 'scripts/io/cli-freshness.mjs',
  'scripts/io/egress-read.mjs', 'scripts/io/glob-walk.mjs', 'scripts/io/intent-cache.mjs', 'scripts/io/preflight-cache.mjs',
  'scripts/io/repo-lock.mjs', 'scripts/io/reviewer-probe.mjs', 'scripts/io/reviews-root.mjs', 'scripts/io/session-contract.mjs',
  'scripts/io/snapshot.mjs', 'scripts/io/telemetry-record.mjs', 'scripts/io/worktree.mjs', 'scripts/lib/confined-path.mjs',
  'scripts/lib/finding-scope.mjs', 'scripts/lib/reviews-root.mjs', 'scripts/lib/version.mjs',
  'scripts/platform/index.mjs', 'scripts/preflight.mjs', 'scripts/remediate.mjs',
];
// JUDGED, NOT EGRESS TO A VENDOR, each with why. scripts/publish.mjs (m2-public-release.plan.md stage 2) reads files of a
// throwaway clone of one commit, never the working tree, so a link or a hard link standing in the tree is not what it
// reads; it sends nothing to a vendor, a subagent or the intent sandbox, and what it commits leaves only when the operator
// pushes it, after its own scans.
// scripts/io/capture-interactive.mjs: its one raw read is --stdin-file, handed as stdin to the command the caller asked to run
// on this machine; nothing it reads goes to a vendor or a prompt (capture-interactive.plan.md stage 4).
const JUDGED_NOT_EGRESS = ['scripts/publish.mjs', 'scripts/io/capture-interactive.mjs'];
// THE ONE WARNING SITE (operator, 2026-10-31: "C but check and report to the user if one is found"): the bench's preserved
// run copy and --rejudge read report a hard link and go on. Its own warning is held, so the exception stays visible.
const WARNING_SITE = ['scripts/bench-second-opinion.mjs', /noteHardLink/];

test('every egress site reads through the owner', () => {
  for (const [file, pattern, what] of SITES) assert.match(read(file), pattern, `${file}: ${what} is not read through the egress owner`);
});

test('in the egress files, every other raw read of a file\'s content is named with why it is not egress', () => {
  const unnamed = [];
  for (const file of FILES) {
    read(file).split(/\r?\n/).forEach((l, i) => {
      const t = l.trim();
      if (!t || t.startsWith('//') || t.startsWith('*')) return;
      if (!RAW.test(t)) return;
      if (NAMED.some(([f, prefix]) => f === file && t.startsWith(prefix))) return;
      unnamed.push(`${file}:${i + 1}: ${t.slice(0, 160)}`);
    });
  }
  assert.deepEqual(unnamed, [], 'a raw read in an egress file that is neither through the owner nor named');
});

test('across the source tree, every script with a raw content read is an egress file above or in the baseline', () => {
  const unlisted = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(r); continue; }
      if (!/\.(mjs|js)$/.test(e.name) || FILES.includes(r) || BASELINE_UNCLASSIFIED.includes(r) || JUDGED_NOT_EGRESS.includes(r)) continue;
      const raw = read(r).split(/\r?\n/).some((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && RAW.test(t); });
      if (raw) unlisted.push(r);
    }
  };
  walk('scripts');
  assert.deepEqual(unlisted, [], 'a script makes a raw content read and is neither an egress file nor classified');
});

// G-11 of 20261114-195905-m2-pred1-remediation-2-review: the census above sees only direct filesystem calls, so the external
// arm's prompt inputs read through run-graph's ALIASED readers (runRead, runOwner.read: the confined owner, which refuses a
// link but not a second name) were invisible, and the lens brief, intent.md and the remediation census reached the vendor
// unchecked (G-8, G-7, G-6). Each region below is where a run file's content is put into the arm's prompt or its surface:
// no aliased reader may appear in it, and each of its reads is a SITE above.
const ALIASED = /\b(runRead|runOwner\.read|owner\.read)\(/;
const ARM_REGIONS = [
  ['scripts/run-graph.mjs', 'const shadowedLens = LENSES.find((l) => l.id === arm.shadows);', 'reviewer: arm.reviewer,', 'the external arm\'s prompt'],
  ['scripts/run-graph.mjs', "const census = ['evidence', 'remediation-census', 'payload.json'];", 'const destFramework = path.join(d, frameworkRel);', 'the census copied into the arms\' directory'],
];

/** The lines of `src` from the first holding `from` to the next holding `to`, or null when either is missing. */
function regionOf(src, from, to) {
  const lines = src.split(/\r?\n/);
  const a = lines.findIndex((l) => l.includes(from));
  if (a < 0) return null;
  const b = lines.findIndex((l, i) => i > a && l.includes(to));
  return b < 0 ? null : lines.slice(a, b + 1);
}

test('the external arm\'s prompt and surface read no run file through an aliased reader', () => {
  const found = [];
  for (const [file, from, to, what] of ARM_REGIONS) {
    const region = regionOf(read(file), from, to);
    assert.ok(region, `${file}: the region of ${what} was not found; the census must be moved with the code`);
    for (const l of region) {
      const t = l.trim();
      if (t.startsWith('//')) continue;
      if (ALIASED.test(t)) found.push(`${file} (${what}): ${t.slice(0, 160)}`);
    }
  }
  assert.deepEqual(found, [], 'a run file read for an external arm through a reader that does not refuse a second name');
});

test('the aliased-reader scan sees an aliased read, and passes the owner\'s', () => {
  const src = ['const shadowedLens = LENSES.find((l) => l.id === arm.shadows);', '  runBrief: runRead(briefFile),', 'reviewer: arm.reviewer,'].join('\n');
  assert.ok(regionOf(src, ARM_REGIONS[0][1], ARM_REGIONS[0][2]).some((l) => ALIASED.test(l.trim())));
  assert.ok(!ALIASED.test("runBrief: egressReadFile(briefFile, 'utf8', { repoRoot: runDir }),"));
});

test('the bench is the one warning site, and still warns', () => {
  const [file, pattern] = WARNING_SITE;
  assert.match(read(file), pattern, `${file} no longer reports a hard link`);
  // No other script reports-and-goes-on: a second warning site would have to be named here.
  const others = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(r); continue; }
      if (/\.mjs$/.test(e.name) && r !== file && /noteHardLink/.test(read(r))) others.push(r);
    }
  };
  walk('scripts');
  assert.deepEqual(others, [], 'a second site warns about a hard link instead of refusing it');
});

// RUN, NOT MATCHED (G-14 of 20261115-013659-pbr-1b-delivery): the source text `nlink > 1` held this, and any unrelated or
// ineffective line with those characters satisfied it. The surface is built, a second name is added to it, and the build
// must refuse it.
test('the arms\' snapshot still refuses a hard-linked file, as it did before the owner existed', async (t) => {
  const { buildArmsSurface } = await import('../scripts/io/snapshot.mjs');
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-hl-surface-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '.'); g('add', 'a.txt'); g('commit', '-q', '-m', 'one');
  const head = g('rev-parse', 'HEAD').stdout.trim();
  const outside = path.join(tmp, 'outside.txt');
  fs.writeFileSync(outside, 'not the repository\'s\n');
  let linked = null;
  const r = buildArmsSurface({ repoRoot: repo, headCommit: head, baseCommit: head, dir: path.join(tmp, 'surface'), maxBytes: null,
    beforeAssert: (dir) => { linked = makeLink(t, { target: outside, at: path.join(dir, 'second-name.txt'), type: 'hard' }) !== null; return { ok: true }; } });
  // The skip is said twice on purpose: by makeLink, the one place a link failure is caught (regression-link-failures-not-silent),
  // and at the guard for the silent-return census (regression-no-silent-test-return). Each census reads its own place.
  if (linked === false) { t.skip('this filesystem made no hard link'); return; }
  assert.equal(linked, true, `the build never reached its final check: ${r.why}`);
  assert.equal(r.ok, false, 'a hard-linked file in the arms\' surface was accepted');
  assert.match(r.why ?? '', /second-name\.txt is a hard link/);
});

// CALLED, NOT DECLARED (G-13 of 20261115-013659-pbr-1b-delivery): /noteHardLink/ matched the helper's own declaration, so
// removing every warning call left the test green. Each read the bench warns on must still call it.
test('the bench warns at each of its preserved-run reads, not merely declares the warning', () => {
  const calls = read(WARNING_SITE[0]).split(/\r?\n/).filter((l) => /\bnoteHardLink\(/.test(l) && !/^\s*function noteHardLink\(/.test(l));
  for (const where of ['the preserved-run copy', '--rejudge']) {
    assert.ok(calls.some((l) => l.includes(`'${where}'`)), `${WARNING_SITE[0]} no longer warns on a hard link at ${where}`);
  }
});
