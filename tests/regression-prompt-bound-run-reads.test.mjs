// ONE OWNER FOR EVERY RUN FILE WHOSE CONTENT REACHES A PROMPT (prompt-bound-run-reads.plan.md; operator, 2026-11-14: "One
// owner for prompt-bound run reads (Recommended)"). A run's own files were read through the run owner (`confined`), which
// refuses a link but cannot see a hard link, and several fed a vendor's, a judge's or the intent sandbox's input. Three
// reviews running found them one or two at a time (the intent brief; the shadowed lens's brief and the census copy; the
// finding groups, the disputed groups and the remediation payload, G-7, G-6 and G-4 of
// 20261114-204026-m2-pred1-remediation-3-review). The egress census beside this one matched direct fs calls only, so the
// aliased readers (runRead, runOwner.read, owner.read) were invisible to it (G-11 of
// 20261114-195905-m2-pred1-remediation-2-review). This file holds the owner, every prompt-bound site through it, and every
// other aliased run read in the scripts that build prompts, named with why it reaches no prompt.
//
// ITS LIMIT, stated: the census is lexical. A read through a name it does not know, or in a script not listed, is outside
// what it sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript, mintedRunDir, makeLink } from './helpers.mjs';
import { egressRunReader, EGRESS_MAX_FILE_BYTES } from '../scripts/io/egress-read.mjs';

const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');

function runDirFixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-pbr-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'run', 'evidence', 'reconcile'), { recursive: true });
  return dir;
}

test('the owner reads a single-named run file, by path or by segments', (t) => {
  const d = runDirFixture(t);
  const f = path.join(d, 'run', 'evidence', 'reconcile', 'payload.json');
  fs.writeFileSync(f, '{"groups":[]}');
  const r = egressRunReader(path.join(d, 'run'));
  assert.equal(r.read(f), '{"groups":[]}');
  assert.equal(r.read(['evidence', 'reconcile', 'payload.json']), '{"groups":[]}');
});

test('the owner refuses a run file with a second name, naming the path and the count', (t) => {
  const d = runDirFixture(t);
  const outside = path.join(d, 'secret.txt');
  fs.writeFileSync(outside, 'not the run\'s');
  const inside = path.join(d, 'run', 'evidence', 'reconcile', 'payload.json');
  if (!makeLink(t, { target: outside, at: inside, type: 'hard' })) { t.skip('this filesystem refuses a hard link here'); return; }
  assert.throws(() => egressRunReader(path.join(d, 'run')).read(['evidence', 'reconcile', 'payload.json']),
    (e) => e.code === 'ECONFINED' && e.refusal === 'hard-link' && /2 names/.test(e.message) && e.message.includes('payload.json'));
});

test('the owner refuses a path outside the run, and a file over the egress bound', (t) => {
  const d = runDirFixture(t);
  const r = egressRunReader(path.join(d, 'run'));
  fs.writeFileSync(path.join(d, 'beside.txt'), 'x');
  assert.throws(() => r.read(path.join(d, 'beside.txt')), (e) => e.code === 'ECONFINED' && e.refusal === 'outside');
  const big = path.join(d, 'run', 'big.json');
  fs.writeFileSync(big, Buffer.alloc(EGRESS_MAX_FILE_BYTES + 1, 0x20));
  assert.throws(() => r.read(['big.json']), (e) => e.code === 'ECONFINED' && e.refusal === 'too-large');
});

// Every prompt-bound run read: [file, a pattern its read matches, what it feeds].
const SITES = [
  ['scripts/run-graph.mjs', /const promptReader = egressRunReader\(runDir\);/, 'the one reader, rooted at the admitted run'],
  ['scripts/run-graph.mjs', /egressRunReader\(linked\.run_dir\)\.read\(\['evidence', 'remediation', 'payload\.json'\]\)/, 'a linked run\'s remediation payload, copied into the arms\' surface (G-4)'],
  ['scripts/run-graph.mjs', /snapshotBytes = promptRead\(contractSnapshot, null\)/, 'the contract snapshot, into the intent sandbox'],
  ['scripts/run-graph.mjs', /try \{ censusBytes = promptRead\(census, null\); \}/, 'the remediation census, into the arms\' surface'],
  ['scripts/run-graph.mjs', /armCriteria = criteriaSection\(promptRead\(\['intent\.md'\]\)\);/, 'the intent criteria, into the arm\'s prompt'],
  ['scripts/run-graph.mjs', /try \{ armBrief = promptRead\(briefFile\); \}/, 'the shadowed lens\'s brief, into the arm\'s prompt'],
  ['scripts/run-graph.mjs', /try \{ payloadText = promptRead\(rp\); \}/, 'the disputed groups, into the adjudicators\' prompts (G-6)'],
  ['scripts/run-graph.mjs', /try \{ groupsText = promptRead\(\['finding-groups\.json'\]\); \}/, 'the finding groups, into the tie-break prompts (G-7)'],
  // The two node payloads rendered into a prompt's input (G-5, G-7 of 20261114-231942-pbr-delivery): the request-capture
  // payload into the adopted request the intent node reads, the intent payload into intent.md, which reaches the arm's
  // prompt. Each pattern holds its own context, so one identical line cannot stand in for the other (G-11 of the same review).
  ['scripts/run-graph.mjs', /function renderRequestDoc\(nodeId\) \{\s*const payloadPath = [^\n]*\n\s*if \(!runHas\(payloadPath\)\) return null;(?:\s*\/\/[^\n]*)*\s*const p = JSON\.parse\(promptRead\(payloadPath\)\);/, 'the request-capture payload, into the adopted request (G-5)'],
  ['scripts/run-graph.mjs', /if \(intentStatus\?\.state === 'OK' && runHas\(payloadPath\)\) \{\s*try \{ intentPayload = JSON\.parse\(promptRead\(payloadPath\)\); \}[\s\S]*?\} else if \(intentPayload\) \{\s*const p = intentPayload;\s*const md = \[\s*'# Intent'/, 'the intent payload, into intent.md (G-7)'],
  // A refusal of the criteria read keeps its cause and launches no arm (G-8 of 20261114-231942-pbr-delivery): only a
  // failure that is not a refusal (an absent intent.md) leaves the criteria empty.
  ['scripts/run-graph.mjs', /armCriteria = criteriaSection\(promptRead\(\['intent\.md'\]\)\);\s*\} catch \(e\) \{\s*if \(!refusedOrAbsent\(e\)\) throw e;(?:\s*\/\/[^\n]*)*\s*if \(e\.code === 'ECONFINED'\) \{\s*writeStatusStub\(arm\.id, 'BLOCKED', \{[^\n]*launched: false[^\n]*refusalWords\(e\)[^\n]*\n[^\n]*\n\s*return;/, 'a refused criteria read, which launches no arm (G-8)'],
  ['scripts/spawn-node.mjs', /briefBytes = egressRunReader\(runDir\)\.read\(\['nodes', path\.basename\(briefPath\)\], null\)/, 'the intent node\'s brief, into its sandbox'],
];

// Every other aliased run read in those scripts: [file, the trimmed line's prefix, why it reaches no prompt].
const NAMED = [
  ['scripts/run-graph.mjs', "const runRead = (p, encoding = 'utf8') => runOwner.read(belowRun(p), encoding);", 'the orchestrator\'s own run reader, for what only it reads'],
  ['scripts/run-graph.mjs', "return crypto.createHash('sha256').update(runRead(p, null))", 'a hash of intent.md, compared, sent nowhere'],
  ['scripts/run-graph.mjs', "runOwner.replace(segs, (runOwner.isFree(segs) ? '' : runOwner.read(segs)) + redactClaim(text));", 'an append to a run log, written back to the run'],
  ['scripts/run-graph.mjs', "try { return JSON.parse(runOwner.read(['nodes', `${nodeId}.status.json`])); }", 'a node\'s status, read by the orchestrator'],
  ['scripts/run-graph.mjs', "const s = JSON.parse(runOwner.read(['nodes', f]));", 'node statuses, counted'],
  ['scripts/run-graph.mjs', "try { text = runOwner.read(['checks.json']); }", 'the pre-flight results, read by the orchestrator'],
  ['scripts/run-graph.mjs', 'Object.assign(runJson, JSON.parse(runRead(runJsonPath)));', 'run.json, the orchestrator\'s own record'],
  ['scripts/run-graph.mjs', "runJson.intent_sha256 = crypto.createHash('sha256').update(runRead(intentPath, null))", 'a hash of intent.md, recorded'],
  ['scripts/run-graph.mjs', "runJson.intent_sha256 = createHash('sha256').update(runRead(intentPath, null))", 'a hash of intent.md, recorded'],
  ['scripts/run-graph.mjs', 'queue = JSON.parse(runRead(queuePath));', 'the fan-out queue, the orchestrator\'s own state'],
  ['scripts/run-graph.mjs', "report_sha256: crypto.createHash('sha256').update(runRead(armReportPath, null))", 'a hash of an arm\'s report, recorded'],
  ['scripts/run-graph.mjs', 'const payload = runHas(evidencePayload) ? JSON.parse(runRead(evidencePayload)) : null;', 'a reconcile batch\'s payload, merged by the orchestrator'],
  ['scripts/run-graph.mjs', "if (payload) runOwner.replace(belowRun(path.join(evidenceDir, `batch-${i + 1}-payload.json`)), runOwner.read(belowRun(evidencePayload), null));", 'a batch payload kept beside the run, local'],
  ['scripts/run-graph.mjs', 'const p = JSON.parse(runRead(evidencePayload));', 'the reconcile payload, checked by the orchestrator'],
  ['scripts/run-graph.mjs', 'const first = JSON.parse(runRead(evidencePayload));', 'the reconcile payload, checked by the orchestrator'],
  ['scripts/run-graph.mjs', "runOwner.replace(['nodes', 'reconcile-b-brief.md'], runOwner.read(['nodes', 'reconcile-brief.md'], null));", 'a brief file the node reads through its own tools, not a prompt this process sends'],
  ['scripts/run-graph.mjs', 'const A = JSON.parse(runRead(pa));', 'two reconcile payloads, compared'],
  ['scripts/run-graph.mjs', 'const B = JSON.parse(runRead(pb));', 'two reconcile payloads, compared'],
  ['scripts/run-graph.mjs', 'const p = JSON.parse(runRead(rp));', 'the reconcile payload, checked by the orchestrator'],
  ['scripts/run-graph.mjs', "const rp = JSON.parse(runOwner.read(['evidence', 'reconcile', 'payload.json']));", 'which groups were judged, counted'],
  ['scripts/run-graph.mjs', "try { st = JSON.parse(runOwner.read(['nodes', f])); }", 'node statuses, read for the gate'],
  ['scripts/run-graph.mjs', 'const onDisk = JSON.parse(runRead(runJsonPath));', 'run.json, compared with the record in memory'],
  // Local decision input, not a prompt (G-9 of 20261114-231942-pbr-delivery; A-30, HL-D1 B): the gate's adjudication floor.
  ['scripts/run-graph.mjs', "try { adjudicationPayloadText = runOwner.read(['evidence', 'reconcile', 'payload.json']); }", 'the reconcile payload, the gate\'s adjudication floor, decided here'],
  ['scripts/spawn-node.mjs', "return crypto.createHash('sha256').update(segs ? owner.read(segs, null) : fs.readFileSync(p))", 'a hash, compared'],
  ['scripts/spawn-node.mjs', "try { briefText = owner.read(['nodes', path.basename(briefPath)]); }", 'the brief, checked by pattern, sent nowhere'],
  ['scripts/spawn-node.mjs', "try { intentText = owner.read(['intent.md']); }", 'intent.md, parsed for its criterion ids'],
  ['scripts/spawn-node.mjs', "try { stdoutText = owner.read(['evidence', nodeId, 'stdout.json']); }", 'the node\'s own answer, coming back'],
  ['scripts/remediate.mjs', 'try { held = owner.read([REMEDIATE_LOCK]); }', 'the lock\'s holder, named in a refusal'],
  ['scripts/remediate.mjs', 'const readOr = (f, parse) => { try { return parse(owner.read(path.relative(runDir, f).split(path.sep))); }', 'run records the runner reads for itself'],
  ['scripts/remediate.mjs', "try { payload = JSON.parse(owner.read(['evidence', nodeId, 'payload.json'])); }", 'the node\'s answer, coming back'],
  ['scripts/remediate.mjs', "try { nodeState = JSON.parse(owner.read(['nodes', `${nodeId}.status.json`])).state ?? null; }", 'the node\'s state, read by the runner'],
  ['scripts/remediate.mjs', 'try { return createHash(\'sha256\').update(owner.read(segs)).digest(\'hex\'); }', 'a hash, compared'],
  ['scripts/remediate.mjs', "try { payload = JSON.parse(owner.read(['evidence', 'remediation', 'payload.json'])); }", 'the node\'s answer, read by the runner'],
  ['scripts/remediate.mjs', "try { report = JSON.parse(owner.read(['evidence', 'remediation', 'payload.json'])); }", 'the node\'s answer, read by the runner'],
  ['scripts/remediate.mjs', "try { saved = JSON.parse(owner.read(['evidence', 'remediation', 'payload.json'])); }", 'the node\'s answer, read by the runner'],
  ['scripts/remediate.mjs', "const st = JSON.parse(owner.read(['nodes', 'remediation.status.json']));", 'the node\'s status, read by the runner'],
  ['scripts/remediate.mjs', 'const envelope = JSON.parse(owner.read(String(st.stdout_path).split(/[\\\\/]/)));', 'the node\'s envelope, for its stop reason, recorded'],
  ['scripts/remediate.mjs', "try { nodeState = JSON.parse(owner.read(['nodes', 'remediation.status.json'])).state ?? null; }", 'the node\'s state, read by the runner'],
  ['scripts/decide.mjs', "const q = JSON.parse(held(() => owner.read(D(n, 'question.json'))));", 'a postponed decision\'s question, listed for the operator'],
  ['scripts/decide.mjs', "try { q = JSON.parse(held(() => owner.read(D(d.id, 'question.json')))).question ?? ''; }", 'a decision\'s question, listed for the operator\'s sample'],
  ['scripts/decide.mjs', 'try { spends = JSON.parse(owner.read(SPENDS)); }', 'the run\'s spend count, read by decide'],
  ['scripts/decide.mjs', 'return r.code === 0 ? readJsonVia(() => owner.read([...recordSegs, `${stem}.json`]))', 'a seat\'s answer, coming back'],
  // Found when the scan widened to the egress census's scripts (G-9 of 20261115-005715-pbr-remediation-3-review).
  ['scripts/bench-second-opinion.mjs', 'return owner.exists(segments) ? owner.read(segments) : null;', 'a file of the bench\'s own recreated worktree, not of a run'],
  ['scripts/bench-second-opinion.mjs', 'try { data = kept.owner.read([...kept.segs, ...rel], null); } catch (e) {', 'a preserved run\'s file for --rejudge: the bench\'s rule is note-and-use, its second name noted just above (G-8 of 20261031-055840-urr-remediation-3-review)'],
  ['scripts/bench-second-opinion.mjs', "fs.writeFileSync(reportPath, kept.owner.read([...kept.segs, 'nodes', 'second-opinion-report.md'], null));", 'the preserved report for --rejudge, its second name noted when it was chosen (the same rule)'],
  ['scripts/findings-ledger.mjs', 'text = owner.read([name]);', 'the ledger, read to be folded, not a run file'],
  ['scripts/io/egress-read.mjs', "return { root, read: (p, encoding = 'utf8') => own.read(segmentsOf(p), encoding) };", 'the owner itself: egressRunReader'],
  // The egress owner's own entries, read outside any run (G-8 of 20261115-042114-pbr-1b-remediation-4-review): each is
  // already the egress owner, and none reads below a run directory, so none is a run read the run entry should take.
  ['scripts/io/egress-read.mjs', "export function egressReadFile(file, encoding = 'utf8', opts = {}) {", 'the owner itself: a single named file'],
  ['scripts/io/egress-read.mjs', 'export function egressReadLines(file, onLine, readOpts = undefined, opts = {}) {', 'the owner itself: a file read by lines'],
  // G-28 of 20261121-204740-m3s7-b1-remediation-review: newestRequestDoc's entries, read through the egress owner.
  ['scripts/run-graph.mjs', "try { text = egressReadFile(c.abs, 'utf8', { repoRoot }); } catch (e) {", 'a request document under .claude/requests, a repository file read through the egress owner, not a run file'],
  ['scripts/run-graph.mjs', "try { armSkill = egressReadFile(skillPath, 'utf8', { repoRoot: FRAMEWORK.frameworkRoot }); } catch (e) {", 'a lens\'s instructions, a framework file, not a run file'],
  ['scripts/spawn-node.mjs', "const base = JSON.parse(egressReadFile(BASE_SCHEMA_PATH, 'utf8', { repoRoot: FRAMEWORK.frameworkRoot }));", 'the base schema, a framework file'],
  ['scripts/spawn-node.mjs', "instructions: egressReadFile(file, 'utf8', { repoRoot: FRAMEWORK.frameworkRoot }),", 'a node\'s instructions, a framework file'],
  ['scripts/decide.mjs', 'try { questionText = egressReadFile(path.resolve(String(opts.question)), \'utf8\', { repoRoot: REPO_REAL }); }', 'the question file the caller named, not a run file'],
  ['scripts/decide.mjs', 'try { return egress(REPO_REAL).read(D(opts.revote, name)); }', 'a decision record under .claude/decisions, rooted at the repository'],
  ['scripts/decide.mjs', 'try { planText = egress(REPO_REAL).read(parsedRequest.segments); }', 'the declared request, a repository file'],
  ['scripts/external-review.mjs', "try { return egressReadFile(abs, 'utf8', { repoRoot: gitWorktreeRoots()?.[0] ?? null }); }", 'a prompt file outside the admitted run (the branch above takes one inside it)'],
  ['scripts/spawn-subagent.mjs', "try { prompt = egressReadFile(args.promptFile, 'utf8',", 'the prompt file the caller named, not a run file'],
  ['scripts/claim-check.mjs', "try { draftText = egressReadFile(draftPath, 'utf8', { repoRoot }); }", 'the draft the caller named, not a run file'],
  ['scripts/claim-check.mjs', "try { checker = egressReadFile(path.join(scripts, '..', 'skills', 'claim-check', 'CHECKER.md'),", 'the checker\'s instructions, a framework file'],
  ['scripts/io/transcript-copy.mjs', 'egressReadLines(abs, (raw) => {', 'the session transcript, not a run file'],
  ['scripts/lib/template.mjs', "return egress({ root: dir, io }).read([name], 'utf8');", 'a prompt template, a framework file'],
  ['scripts/lib/excerpt.mjs', "try { text = egress({ root, io }).read(rel.split('/'), 'utf8'); }", 'a reviewed source file excerpted for a judge, rooted at the repository'],
  ['scripts/new-run.mjs', "return { path: rel, abs, text: fs.existsSync(abs) ? egressReadFile(abs, 'utf8', { repoRoot }) : null };", 'the contract, a repository file, before the run is written'],
  // The copy judged whole before it writes (G-11, G-12 of 20261122-193909-llo-delivery): the same read, now after the walk.
  ['scripts/io/preflight-cache.mjs', 'for (const f of files) cache.replace([...stage, ...f], owner.read([...segs, ...f], null));', 'a run\'s evidence copied into the local pre-flight cache'],
  // The cached entry read through the reviews root's owner (G-10 of 20261122-193909-llo-delivery), not a raw read.
  ['scripts/io/preflight-cache.mjs', 'const entry = JSON.parse(confined(reviewsDir).read(segs));', 'a cached pre-flight result, parsed to decide its reuse; a file of the local cache, not of a run'],
  // The writer mark beside a cached evidence folder (G-5 of 20261122-214154-llo-remediation-2-review), compared with the JSON.
  ['scripts/io/preflight-cache.mjs', 'try { mark = String(own.read([...evSegs, EVIDENCE_WRITER_MARK])); }', 'a cached evidence copy\'s writer mark, compared with its entry to decide reuse; a file of the local cache, not of a run'],
  ['scripts/io/telemetry-record.mjs', "try { text = own.read(segs); } catch (e) { if (e.code === 'ENOENT') return { entries: [], unparsed: null }; throw e; }", 'a check\'s journal, read for a local telemetry record'],
  ['scripts/io/telemetry-record.mjs', "try { text = own.read(segs); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }", 'a local telemetry file, read for the report'],
  ['scripts/io/telemetry-record.mjs', 'read: (segs, enc) => own.read(at(segs), enc),', 'the telemetry folder\'s owner, read for local records'],
  // Decision 10's retention (G-3 of 20261116-021143-ci-remediation-4-review): a label's own status.json, parsed only to
  // decide whether this front end wrote it and may prune it; sent to no vendor and no prompt.
  ['scripts/io/capture-interactive.mjs', "const status = JSON.parse(owner.read([ent.name, 'status.json']));", 'a capture label\'s status.json, read to decide its retention'],
];

// THE SCRIPTS THAT BUILD PROMPTS, BY THE PLAN'S AUTHORITY (G-9 of 20261115-005715-pbr-remediation-3-review): the plan's
// stage 3 names run-graph, spawn-node, remediate, external-review and decide, "and any script the existing egress census
// names". This list held only the scripts its own entries named, so a script the egress census holds was outside it. The
// egress census's script names are read from that test, so a script added there is scanned here without an edit.
const EGRESS_CENSUS_SCRIPTS = [...read('tests/regression-hardlink-egress-census.test.mjs').matchAll(/'(scripts\/[\w/.-]+\.mjs)'/g)].map((m) => m[1]);
const FILES = [...new Set([...SITES, ...NAMED].map(([f]) => f).concat(
  ['scripts/run-graph.mjs', 'scripts/spawn-node.mjs', 'scripts/remediate.mjs', 'scripts/external-review.mjs', 'scripts/decide.mjs'],
  EGRESS_CENSUS_SCRIPTS))];

test('the census scans every script the plan names, and every script the egress census names', () => {
  assert.ok(EGRESS_CENSUS_SCRIPTS.length > 10, `the egress census's script names were not found (${EGRESS_CENSUS_SCRIPTS.length})`);
  for (const f of FILES) assert.ok(fs.existsSync(path.join(REPO_ROOT, f)), `${f} is in the census and does not exist`);
});
// THE EGRESS OWNER'S OWN ENTRIES ARE SPELLINGS TOO (G-8 of 20261115-042114-pbr-1b-remediation-4-review): a run file read
// through egressReadFile or egress(...).read was neither owner-routed nor named, and the census passed (G-2 of the same).
const ALIASED = /\b(runRead|runOwner\.read|owner\.read|own\.read|egressReadFile|egressReadLines)\(|\b(confined|egress)\([^)]*\)\.read\(/;

test('every prompt-bound run read goes through the owner', () => {
  for (const [file, pattern, what] of SITES) assert.match(read(file), pattern, `${file}: ${what} is not read through the owner`);
});

test('in the scripts that build prompts, every other aliased run read is named with why it reaches no prompt', () => {
  const unnamed = [];
  for (const file of FILES) {
    read(file).split(/\r?\n/).forEach((l, i) => {
      const t = l.trim();
      if (!t || t.startsWith('//') || t.startsWith('*') || !ALIASED.test(t)) return;
      if (NAMED.some(([f, prefix]) => f === file && t.startsWith(prefix))) return;
      unnamed.push(`${file}:${i + 1}: ${t.slice(0, 160)}`);
    });
  }
  assert.deepEqual(unnamed, [], 'an aliased run read that is neither through the owner nor named: route it through egressRunReader, or name it with why');
});

test('every name the census holds still matches a line, so the list cannot go stale', () => {
  const stale = NAMED.filter(([file, prefix]) => !read(file).split(/\r?\n/).some((l) => l.trim().startsWith(prefix)));
  assert.deepEqual(stale.map(([f, p]) => `${f}: ${p.slice(0, 80)}`), [], 'a named read no longer exists: remove it from the census');
});

// ONE OWNER FOR THE WORDS OF A REFUSAL (G-9 of 20261114-231942-pbr-delivery; ARCHITECTURE A-1): the mapping from a refusal
// code to what a section or the gate says was inlined twice in run-graph.mjs, two owners that could drift.
test('run-graph says a refusal in the owner\'s words, never an inline mapping of its codes', () => {
  const inline = read('scripts/run-graph.mjs').split(/\r?\n/).map((l, i) => [i + 1, l])
    .filter(([, l]) => /e\.refusal === '(hard-link|too-large)'/.test(l)).map(([n]) => `scripts/run-graph.mjs:${n}`);
  assert.deepEqual(inline, [], 'say a refusal through refusalWords from io/egress-read.mjs');
});

// THE ARM'S CRITERIA ARE A REQUIRED INPUT (G-2, G-9 of 20261115-013659-pbr-1b-delivery; ARCHITECTURE.md §4, A-30): refused, the
// arm was recorded DEGRADED, and absent it was started with empty criteria. Source-held, and said so: the run tests above
// skip the panel, so no fixture reaches the arm path. Refused or absent, no arm starts and its status is BLOCKED.
test('an arm whose intent criteria are refused or absent starts nothing and is recorded BLOCKED', () => {
  const src = read('scripts/run-graph.mjs');
  const start = src.indexOf("if (shadowedLens?.intent === 'required') {");
  const end = src.indexOf('const promptPath = path.join(nodesDir, `${arm.id}-prompt.md`);', start);
  assert.ok(start > 0 && end > start, 'the arm\'s criteria block is not where this test looks');
  const block = src.slice(start, end);
  const stubs = [...block.matchAll(/writeStatusStub\(arm\.id, '([A-Z]+)'/g)].map((m) => m[1]);
  assert.ok(stubs.length >= 3, `expected a status for the prior refusal, a refused read and an absent file: ${stubs}`);
  assert.deepEqual([...new Set(stubs)], ['BLOCKED'], `an arm's refused or absent criteria are recorded ${stubs.join(', ')}`);
  assert.doesNotMatch(block, /armCriteria = '';/, 'an absent intent.md still starts the arm with empty criteria');
});

// THE JUDGES' PAYLOAD IS A REQUIRED INPUT (G-11 of 20261115-013659-pbr-1b-delivery): its refusal fell into the adjudication
// phase's generic catch, which only caps the gate at RISK. Source-held, as the arm's block is: no run test reaches the panel.
test('a refused reconcile payload starts no judge, each named BLOCKED with the cause, never through the phase catch', () => {
  const src = read('scripts/run-graph.mjs');
  const at = src.indexOf('try { payloadText = promptRead(rp); } catch (e) {');
  assert.ok(at > 0, 'the reconcile payload is not read into payloadText under its own catch');
  const handler = src.slice(at, src.indexOf('const flagged = payloadText !== null', at));
  assert.ok(handler.length > 0 && handler.length < 900, 'the handler is not where this test looks');
  assert.ok(handler.includes('if (!refusedOrAbsent(e)) throw e;'), 'a failure that is neither a refusal nor an absence is handled here, not thrown (G-3 of 20261115-042114-pbr-1b-remediation-4-review; A-30)');
  assert.ok(handler.includes('`BLOCKED: ${refusalWords(e)} stands at evidence/reconcile/payload.json'), 'the cause is not said BLOCKED');
  // EACH JUDGE GETS A BLOCKED STATUS, NOT ONLY A ROW (G-9 of 20261115-022835-pbr-1b-remediation-review).
  assert.ok(handler.includes('blockJudges(`BLOCKED: ${refusalWords(e)} stands at evidence/reconcile/payload.json'), 'the refusal does not block the judges');
  // AN ABSENT PAYLOAD IS A REFUSAL'S CLASS TOO (G-36 of 20261117-013640-m2-9a-final; A-30): runHas false skipped
  // blockJudges, so every judge was left with no row at all.
  assert.ok(handler.includes('} else blockJudges(`BLOCKED: evidence/reconcile/payload.json is absent'),
    'an absent reconcile payload leaves the judges with no row, not BLOCKED');
  const helperAt = src.indexOf('const blockJudges = (why');
  assert.ok(helperAt > 0 && helperAt < at, 'no one helper records the judges a refused input feeds');
  const helper = src.slice(helperAt, src.indexOf('\n    };', helperAt));
  assert.ok(helper.includes('buckets.did_not_report.push({ node_id: judgeNodeId, why })'), 'no judge is named as not reporting');
  assert.ok(helper.includes("writeStatusStub(judgeNodeId, 'BLOCKED', {") && helper.includes('validator_errors: [why]'), 'no judge has a BLOCKED status carrying the cause');
  assert.ok(helper.includes('expected.push({ node_id: judgeNodeId') && helper.includes("'expected.json'"), 'no judge has an expected row');
});

// THE FINDING GROUPS ARE A REQUIRED INPUT TOO (G-10 of 20261115-022835-pbr-1b-remediation-review): read with no catch of
// its own, a refused finding-groups.json fell into the phase's generic catch. Source-held, as above: no run test reaches
// the panel (G-14 of the same review, open).
test('a refused finding-groups.json starts no judge, each eligible one BLOCKED with the cause, never through the phase catch', () => {
  const src = read('scripts/run-graph.mjs');
  assert.doesNotMatch(src, /JSON\.parse\(promptRead\(\['finding-groups\.json'\]\)\)/, 'finding-groups.json is parsed straight from a read with no catch');
  const at = src.indexOf("try { groupsText = promptRead(['finding-groups.json']); } catch (e) {");
  assert.ok(at > 0, 'finding-groups.json is not read under its own catch');
  const handler = src.slice(at, at + 400);
  assert.ok(handler.includes('if (!refusedOrAbsent(e)) throw e;'), 'a failure that is neither a refusal nor an absence is handled here, not thrown (G-3 of 20261115-042114-pbr-1b-remediation-4-review; A-30)');
  assert.ok(handler.includes('blockJudges(`BLOCKED: ${refusalWords(e)} stands at finding-groups.json'), 'the refusal does not block the judges');
  // `eligible` is emptied, never `disputed` (regression-runtime-capabilities holds toAdjudicate's own line).
  assert.ok(handler.includes('eligible.length = 0;'), 'a judge is still prepared on refused groups');
});

test('an intent node that reported OK with no payload is a required input absent, so its lenses do not start', () => {
  const src = read('scripts/run-graph.mjs');
  assert.match(src, /if \(intentStatus\?\.state === 'OK' && runHas\(payloadPath\)\) \{[\s\S]*?\} else if \(intentStatus\?\.state === 'OK'\) \{(?:\s*\/\/[^\n]*)*\s*intentPayloadRefused = [^\n]*absent[^\n]*\n\s*intentRefusal = intentPayloadRefused;/,
    'an OK intent node with no payload.json leaves intentRefusal unset');
});

test('the owner\'s words name each refusal', async () => {
  const { refusalWords } = await import('../scripts/io/egress-read.mjs');
  assert.equal(refusalWords({ refusal: 'hard-link' }), 'a file with more than one name');
  assert.equal(refusalWords({ refusal: 'too-large' }), 'a file over the bound on what leaves the machine');
  assert.equal(refusalWords({ refusal: 'link' }), 'a link or junction');
});

// EVERY REFUSAL IN ITS OWN WORDS (G-3 of 20261114-235051-pbr-remediation-review): every refusal but a hard link and an
// oversized file was said as "a link or junction", so a directory standing at intent.md or a path outside the run was
// recorded with a false cause. Each kind `confined` and the run reader tag is named; an untagged one is said as a refusal.
test('the owner\'s words never call a refusal that is not a link a link', async () => {
  const { refusalWords } = await import('../scripts/io/egress-read.mjs');
  for (const refusal of ['not-a-file', 'not-a-directory', 'outside', 'taken', null, undefined]) {
    assert.notEqual(refusalWords({ code: 'ECONFINED', refusal }), 'a link or junction', `refusal ${refusal}`);
  }
  assert.equal(refusalWords({ refusal: 'not-a-file' }), 'something that is not a file');
  assert.equal(refusalWords({ refusal: 'not-a-directory' }), 'something that is not a directory');
  assert.equal(refusalWords({ refusal: 'outside' }), 'a path outside the run');
});

// THE REFUSAL PATHS, HELD BY RUNNING THE ORCHESTRATOR (prompt-bound-run-reads.plan.md stage 3, amended 2026-11-14 at D1's
// round cap; operator: "Design step: refusal classes + a run test (Recommended)"). Three remediations running drew new
// MEDIUMs from their own fixes, every round on what a refused read does, and each round was held by assertions on the
// source text, which agree with the code they were written beside (G-11 of 20261115-005715-pbr-remediation-3-review).
// These run run-graph.mjs on a fixture repository with a fake node runtime and no panel, and read what the run produced.
// They replace the source matches; none is kept beside them.
const tmpDir = (t, prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const put = (root, rel, body = `${rel}\n`) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

// The fake: reads its prompt from stdin, logs the call, prints one envelope. Serialized into the fixture.
async function fakeRuntimeMain() {
  const fs = await import('node:fs');
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--settings');
  try { fs.readFileSync(0, 'utf8'); } catch { /* an ignored stdin */ }
  if (process.env.FAKE_RUNTIME_LOG) fs.appendFileSync(process.env.FAKE_RUNTIME_LOG, JSON.stringify({ settings: i >= 0 ? argv[i + 1] : null }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', permission_denials: [], total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }));
}
function fakeRuntime(t) {
  const dir = tmpDir(t, 'q-pbr-fake-');
  const bin = path.join(dir, 'fake-runtime.mjs');
  fs.writeFileSync(bin, `(${fakeRuntimeMain.toString()})();\n`);
  const log = path.join(dir, 'calls.jsonl');
  // A real runtime reached past the override cannot authenticate: an empty config directory and blank credentials.
  const noLogin = path.join(dir, 'no-login');
  fs.mkdirSync(noLogin);
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { bin, calls, env: { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', FAKE_RUNTIME_LOG: log } };
}
const intentCalls = (calls) => calls.filter((c) => /intent-settings\.json$/.test(c.settings ?? ''));

// A consuming repository with an approved request, so contract-audit, a lens that requires intent, is selected.
function consumer(t) {
  const repo = tmpDir(t, 'q-pbr-repo-');
  put(repo, 'src/app.js', 'export const app = 1;\n');
  put(repo, 'docs/guide.md', 'the guide, declared\n');
  put(repo, '.claude/requests/ask.md', ['---', 'request: ask', 'status: approved', '---', '', '# The ask', '', '## Acceptance criteria', '1. It works.', ''].join('\n'));
  const yaml = ['graph_contract_version: 5', 'project: pbr-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: ["docs/*.md"]', 'ui:', '  surface: none', 'review:', '  external_panel: false',
    '  models: { judgment: opus, mechanical: sonnet }'].join('\n');
  put(repo, 'CLAUDE.md', `# fixture\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  return repo;
}
function mint(t, repo) {
  const r = runScript('new-run.mjs', ['--slug', `pbr${Math.floor(Math.random() * 1e6)}`, '--repo-root', repo, '--full-sweep', 'src', '--no-verify-sandbox'], { cwd: repo });
  const dir = mintedRunDir(r.output);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// A second name for `file`, outside the run and the repository; null, with `t` skipped, where the filesystem refuses one.
function secondName(t, file) {
  const other = path.join(tmpDir(t, 'q-pbr-other-'), 'second-name');
  return makeLink(t, { target: file, at: other, type: 'hard' }) ? other : null;
}
function runGraph(repo, dir, fake) {
  return runScript('run-graph.mjs', ['--run-dir', dir, '--repo-root', repo, '--only', 'contract-audit', '--skip-panel', '--no-archive', '--runtime-bin', fake.bin],
    { cwd: repo, env: fake.env, mayFanOut: true });
}
const statusOf = (dir, node) => JSON.parse(fs.readFileSync(path.join(dir, 'nodes', `${node}.status.json`), 'utf8'));
const notChecked = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'gate.json'), 'utf8')).buckets?.not_checked ?? [];

// A REQUIRED INPUT REFUSED: the node it feeds does not start, its status is BLOCKED with the cause, the gate is written.
test('run: a hard-linked contract snapshot starts no intent node; it is BLOCKED with the cause, and the gate is written', (t) => {
  const repo = consumer(t);
  const dir = mint(t, repo);
  if (!secondName(t, path.join(dir, 'contract.snapshot.md'))) return;
  const fake = fakeRuntime(t);
  const r = runGraph(repo, dir, fake);
  assert.equal(intentCalls(fake.calls()).length, 0, 'the intent node was spawned on a refused contract snapshot');
  const st = statusOf(dir, 'intent-capture');
  assert.equal(st.state, 'BLOCKED');
  assert.equal(st.launched, false);
  // THE REASON, NOT ONLY THE NAME (G-17 of 20261115-013659-pbr-1b-delivery): a file name alone passed with the cause omitted.
  assert.match(st.validator_errors.join(' '), /more than one name[^\n]*contract\.snapshot\.md|contract\.snapshot\.md[^\n]*more than one name/, `the cause is not named: ${st.validator_errors}`);
  assert.ok(fs.existsSync(path.join(dir, 'gate.json')), `no gate was written: ${r.output.slice(-600)}`);
  assert.ok(notChecked(dir).some((e) => { const s = `${e.item ?? ''} ${e.why ?? ''} ${e.reason ?? ''}`; return /contract\.snapshot\.md/.test(s) && /more than one name/.test(s); }),
    `the refusal is not in the gate's not-checked list: ${JSON.stringify(notChecked(dir))}`);
  const lens = statusOf(dir, 'contract-audit');
  assert.equal(lens.state, 'BLOCKED', 'a lens requiring intent ran without it');
  assert.equal(lens.launched, false);
});

test('run: an absent contract snapshot is a required input too, the node BLOCKED with that cause', (t) => {
  const repo = consumer(t);
  const dir = mint(t, repo);
  fs.rmSync(path.join(dir, 'contract.snapshot.md'));
  const fake = fakeRuntime(t);
  runGraph(repo, dir, fake);
  assert.equal(intentCalls(fake.calls()).length, 0, 'the intent node was spawned without its contract snapshot');
  const st = statusOf(dir, 'intent-capture');
  assert.equal(st.state, 'BLOCKED');
  assert.match(st.validator_errors.join(' '), /absent/, `the cause is not named: ${st.validator_errors}`);
  assert.ok(fs.existsSync(path.join(dir, 'gate.json')), 'no gate was written');
});

test('run: a link standing at the sandbox directory is the same class, never thrown out of the orchestrator', (t) => {
  const repo = consumer(t);
  const dir = mint(t, repo);
  const elsewhere = tmpDir(t, 'q-pbr-elsewhere-');
  if (!makeLink(t, { target: elsewhere, at: path.join(dir, 'sandbox'), type: 'junction' })) { t.skip('this filesystem made no link'); return; }
  const fake = fakeRuntime(t);
  const r = runGraph(repo, dir, fake);
  assert.equal(intentCalls(fake.calls()).length, 0, 'the intent node was spawned below a linked sandbox');
  assert.equal(statusOf(dir, 'intent-capture').state, 'BLOCKED');
  assert.match(statusOf(dir, 'intent-capture').validator_errors.join(' '), /link or junction stands at sandbox/);
  assert.ok(notChecked(dir).some((e) => /sandbox\/intent-capture/.test(`${e.item ?? ''} ${e.why ?? ''}`)),
    `the gate does not name the refused sandbox: ${JSON.stringify(notChecked(dir))}`);
  assert.ok(fs.existsSync(path.join(dir, 'gate.json')), `no gate was written: ${r.output.slice(-600)}`);
  assert.deepEqual(fs.readdirSync(elsewhere), [], 'something was written through the link');
});

// A CONTEXT INPUT REFUSED: it is left out, named in the brief and in the gate, and the node still starts.
test('run: a hard-linked declared document is left out, named in the brief and the gate, and the intent node still runs', (t) => {
  const repo = consumer(t);
  if (!secondName(t, path.join(repo, 'docs', 'guide.md'))) return;
  const dir = mint(t, repo);
  const fake = fakeRuntime(t);
  runGraph(repo, dir, fake);
  assert.equal(intentCalls(fake.calls()).length, 1, 'the intent node did not run: a context input blocked it');
  const brief = fs.readFileSync(path.join(dir, 'nodes', 'intent-capture-brief.md'), 'utf8');
  assert.match(brief, /## Left out of your sandbox[\s\S]*guide\.md/, 'the brief does not name the document left out');
  assert.ok(notChecked(dir).some((e) => { const s = `${e.item ?? ''} ${e.why ?? ''} ${e.reason ?? ''}`; return /guide\.md/.test(s) && /more than one name|is a hard link/.test(s); }),
    `the gate does not name the document left out: ${JSON.stringify(notChecked(dir))}`);
});

// A CONTEXT INPUT REFUSED AT MODULE LOAD (G-5 of 20261115-013659-pbr-1b-delivery): the linked remediation's census is read
// while run-graph's module initializes, and its refusal was pushed into a list declared ~300 lines below, so a hard-linked
// payload threw a temporal-dead-zone ReferenceError and killed the orchestrator before any gate. The run is the check.
test('run: a hard-linked linked-remediation payload is left out and named in the gate; the orchestrator does not die', (t) => {
  const repo = consumer(t);
  const linked = mint(t, repo);
  const dir = mint(t, repo);
  const payload = path.join(linked, 'evidence', 'remediation', 'payload.json');
  fs.mkdirSync(path.dirname(payload), { recursive: true });
  fs.writeFileSync(payload, JSON.stringify({ groups: [] }));
  if (!secondName(t, payload)) return;
  const runJsonPath = path.join(dir, 'run.json');
  const rj = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));
  const linkedId = JSON.parse(fs.readFileSync(path.join(linked, 'run.json'), 'utf8')).run_id;
  rj.follows_remediation = { run_id: linkedId, run_dir: linked };
  fs.writeFileSync(runJsonPath, JSON.stringify(rj, null, 2) + '\n');
  const fake = fakeRuntime(t);
  const r = runGraph(repo, dir, fake);
  assert.doesNotMatch(r.output, /ReferenceError|before initialization/, `the orchestrator died on the refusal: ${r.output.slice(-600)}`);
  assert.ok(fs.existsSync(path.join(dir, 'gate.json')), `no gate was written: ${r.output.slice(-600)}`);
  assert.ok(notChecked(dir).some((e) => /linked remediation census/.test(`${e.item ?? ''} ${e.why ?? ''} ${e.reason ?? ''}`)),
    `the gate does not name the refused census: ${JSON.stringify(notChecked(dir))}`);
});

// A REFUSED INTENT BRIEF LEAVES ITS STATUS (G-12 of 20261115-013659-pbr-1b-delivery): spawn-node's catch called die(), which
// exits before the pre-spawn status write, so a node refused a required input left no BLOCKED status naming the cause.
test('run: spawn-node refused a hard-linked intent brief writes a BLOCKED status with the cause, and launches nothing', (t) => {
  const repo = consumer(t);
  const dir = mint(t, repo);
  const brief = path.join(dir, 'nodes', 'intent-capture-brief.md');
  fs.writeFileSync(brief, '# brief\n');
  if (!secondName(t, brief)) return;
  const fake = fakeRuntime(t);
  const r = runScript('spawn-node.mjs', ['--run-dir', dir, '--repo-root', repo, '--node-id', 'intent-capture', '--mode', 'intent',
    '--schema-variant', 'intent', '--skill-command', '/intent-capture', '--runtime-bin', fake.bin], { cwd: repo, env: fake.env });
  assert.equal(fake.calls().length, 0, 'the intent node was spawned on a refused brief');
  const statusFile = path.join(dir, 'nodes', 'intent-capture.status.json');
  assert.ok(fs.existsSync(statusFile), `no status was written: ${r.output.slice(-600)}`);
  const st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  assert.equal(st.state, 'BLOCKED');
  assert.equal(st.launched, false);
  assert.match((st.validator_errors ?? []).join(' '), /intent-capture-brief\.md/, `the cause is not named: ${st.validator_errors}`);
});

// AN INTENT NODE THAT DID NOT FINISH OK IS A REQUIRED INPUT ABSENT TOO (G-4 of 20261115-022835-pbr-1b-remediation-review):
// its branch removed intent.md and left intentRefusal unset, so a lens requiring intent launched against "(not captured)".
// The fake runtime answers with no payload, so the intent node finishes in a state that is not OK.
test('run: an intent node that finished not OK starts no lens requiring intent; the lens is BLOCKED with the cause', (t) => {
  const repo = consumer(t);
  const dir = mint(t, repo);
  const fake = fakeRuntime(t);
  const r = runGraph(repo, dir, fake);
  assert.equal(intentCalls(fake.calls()).length, 1, 'the intent node did not run');
  const st = statusOf(dir, 'intent-capture');
  assert.notEqual(st.state, 'OK', 'the fixture meant the intent node to fail');
  const lens = statusOf(dir, 'contract-audit');
  assert.equal(lens.state, 'BLOCKED', `a lens requiring intent ran without it: ${r.output.slice(-600)}`);
  assert.equal(lens.launched, false);
  assert.match((lens.validator_errors ?? []).join(' '), /intent-capture[^\n]*did not complete|did not complete[^\n]*intent-capture/, `the cause is not named: ${lens.validator_errors}`);
});

// A REFUSED intent.md AT VALIDATION LEAVES A TERMINAL STATUS (G-12 of 20261115-022835-pbr-1b-remediation-review): the
// post-output criteria read called die(), whose process.exit skipped the terminal status write, so the node stayed RUNNING
// and the cause was lost. The fake runtime puts a directory at intent.md while the node runs, then answers with a verdict:
// the run owner refuses it, as it does a link (a hard link it cannot see; the egress owner does).
async function linkingRuntimeMain() {
  const fs = await import('node:fs');
  try { fs.readFileSync(0, 'utf8'); } catch { /* an ignored stdin */ }
  fs.rmSync(process.env.FAKE_INTENT);
  fs.mkdirSync(process.env.FAKE_INTENT);
  const payload = JSON.parse(process.env.FAKE_PAYLOAD);
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: payload, permission_denials: [], total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }));
}
test('run: spawn-node refused intent.md after the node answered writes BLOCKED with the cause, never a RUNNING status', (t) => {
  const repo = consumer(t);
  const dir = mint(t, repo);
  const intent = path.join(dir, 'intent.md');
  fs.writeFileSync(intent, '# Intent\n\n## Criteria\n\n### I-1 It works\n');
  fs.writeFileSync(path.join(dir, 'nodes', 'contract-audit-brief.md'), '# brief\n');
  const fakeDir = tmpDir(t, 'q-pbr-linkfake-');
  const bin = path.join(fakeDir, 'fake-runtime.mjs');
  fs.writeFileSync(bin, `(${linkingRuntimeMain.toString()})();\n`);
  const noLogin = path.join(fakeDir, 'no-login');
  fs.mkdirSync(noLogin);
  const runId = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')).run_id;
  const env = { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
    FAKE_INTENT: intent,
    FAKE_PAYLOAD: JSON.stringify({ run_id: runId, node_id: 'contract-audit', verdict: 'PASS', intent_sha: '', findings: [], summary: 'none' }) };
  const r = runScript('spawn-node.mjs', ['--run-dir', dir, '--repo-root', repo, '--node-id', 'contract-audit', '--mode', 'lens',
    '--schema-variant', 'contract', '--skill-command', '/contract-audit', '--allowed-basis', 'convention', '--runtime-bin', bin], { cwd: repo, env });
  const statusFile = path.join(dir, 'nodes', 'contract-audit.status.json');
  assert.ok(fs.existsSync(statusFile), `no status was written: ${r.output.slice(-1200)}`);
  const st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  assert.equal(st.state, 'BLOCKED', `the refused intent.md left the node ${st.state}: ${JSON.stringify(st.validator_errors)} ${r.output.slice(-600)}`);
  assert.match((st.validator_errors ?? []).join(' '), /intent\.md[^\n]*refused/, `the cause is not named: ${st.validator_errors}`);
});

// THE SHADOWED LENS'S BRIEF IS A REQUIRED INPUT OF THE ARM (G-8 of 20261115-022835-pbr-1b-remediation-review): read inline
// in the prompt's construction with no catch, a refusal escaped spawnPanelArm before the arm had a status. Source-held: no
// run test reaches the panel (G-14 of the same review, open).
test('a refused shadowed-lens brief launches no arm, recorded BLOCKED with the cause', () => {
  const src = read('scripts/run-graph.mjs');
  assert.doesNotMatch(src, /runBrief: promptRead\(briefFile\),/, 'the brief is read inside the prompt build with no catch of its own');
  const at = src.indexOf('try { armBrief = promptRead(briefFile); } catch (e) {');
  assert.ok(at > 0, 'the arm brief is not read under its own catch');
  const handler = src.slice(at, at + 700);
  assert.ok(handler.includes('if (!refusedOrAbsent(e)) throw e;'), 'a failure that is neither a refusal nor an absence is handled here, not thrown (G-3 of 20261115-042114-pbr-1b-remediation-4-review; A-30)');
  assert.match(handler, /writeStatusStub\(arm\.id, 'BLOCKED', \{ launched: false[^\n]*refusalWords\(e\)[^\n]*\n[\s\S]*?return;/, 'a refused brief does not leave the arm BLOCKED with the cause');
  assert.ok(src.indexOf('try { armBrief = promptRead(briefFile); }') < src.indexOf('runBrief: armBrief,'), 'the brief is not read before the prompt is built');
});

// THE CENSUS COPY IS A CONTEXT INPUT OF THE ARMS (G-6 of 20261115-022835-pbr-1b-remediation-review): a refusal escaped
// beforeAssert and took the whole arms surface down. It is left out with its cause, and the arms still start.
test('a refused census copy is left out of the arms\' surface with its cause; the surface is still built', () => {
  const src = read('scripts/run-graph.mjs');
  const at = src.indexOf('try { censusBytes = promptRead(census, null); } catch (e) {');
  assert.ok(at > 0, 'the census copy is not read under its own catch');
  const handler = src.slice(at, at + 800); // widened by the rethrow line of G-3 (20261115-042114-pbr-1b-remediation-4-review)
  assert.ok(handler.includes('if (!refusedOrAbsent(e)) throw e;'), 'a failure that is neither a refusal nor an absence is handled here, not thrown (G-3 of 20261115-042114-pbr-1b-remediation-4-review; A-30)');
  assert.ok(handler.includes('buckets.not_checked.push({') && handler.includes('refusalWords(e)'), 'the left-out census is not named with its cause');
  assert.match(handler, /if \(censusBytes !== null\) \{[\s\S]*?fs\.writeFileSync\(armCensus, censusBytes\);/, 'a refused census is still written, or still fails the surface');
  assert.doesNotMatch(handler.slice(0, handler.indexOf('if (censusBytes !== null)')), /return \{ ok: false|throw new/, 'a refused census still fails the surface');
});

// THE LEFT-OUT CENSUS IS NAMED IN THE ARM'S BRIEF (G-6 of 20261115-035028-pbr-1b-remediation-3-review; G-2 its symptom):
// the refusal reached the gate only, and the arm was handed the lens's brief unchanged, pointed at a copy that is not there,
// so it could report clean not knowing a context input was withheld (ARCHITECTURE.md A-30: "named in the node's brief").
test('a census left out of the arms\' surface is named, with its cause, in the arm\'s prompt', async () => {
  const prompts = await import('../scripts/io/review-prompts.mjs');
  const follows = { run_id: '20990101-000000-x-remediation', run_dir: 'x' };
  const brief = prompts.censusSection({ followsRemediation: follows, payloadPath: 'evidence/remediation-census/payload.json', payload: { groups: [] } });
  const build = (censusLeftOut) => prompts.buildArmShadowPrompt({ lensId: 'code-audit', skillMarkdown: '# code-audit\n\nlens text\n',
    runBrief: brief, reviewer: 'codex', intentMode: 'forbidden', censusLeftOut });
  const arm = build('a second name for the file');
  assert.ok(arm.includes('a second name for the file'), 'the arm is not told why its census was left out');
  assert.match(arm, /left out/, 'the arm is not told its census was left out');
  assert.ok(!arm.includes(prompts.ARM_CENSUS_PATH), 'the arm is still pointed at a census copy that was never written');
  assert.match(arm, /not_checked/, 'the arm is not asked to name the omission in not_checked[]');
  assert.ok(build(null).includes(prompts.ARM_CENSUS_PATH), 'a census that was copied is no longer named where the arm reads it');
  const src = read('scripts/run-graph.mjs');
  const at = src.indexOf('try { censusBytes = promptRead(census, null); } catch (e) {');
  assert.match(src.slice(at, at + 700), /armCensusLeftOut = refusalWords\(e\)/, 'run-graph does not keep the cause for the arm\'s brief');
  assert.match(src, /censusLeftOut: armCensusLeftOut,/, 'run-graph does not pass the cause into the arm\'s prompt');
});

// A REFUSAL AFTER THE PRE-SPAWN STATUS WRITE LEAVES A TERMINAL STATUS (G-12, G-11 of
// 20261115-031845-pbr-1b-remediation-2-review): a link standing at evidence/<node>/stdout.json, and an unknown --test-stop,
// called die() after RUNNING was written and outside the finally that resolves it, so the node stayed RUNNING with no cause.
function spawnContractAudit(t, extra = [], before = () => {}) {
  const repo = consumer(t);
  const dir = mint(t, repo);
  fs.writeFileSync(path.join(dir, 'intent.md'), '# Intent\n\n## Criteria\n\n### I-1 It works\n');
  fs.writeFileSync(path.join(dir, 'nodes', 'contract-audit-brief.md'), '# brief\n');
  before(dir);
  const fake = fakeRuntime(t);
  const r = runScript('spawn-node.mjs', ['--run-dir', dir, '--repo-root', repo, '--node-id', 'contract-audit', '--mode', 'lens',
    '--schema-variant', 'contract', '--skill-command', '/contract-audit', '--allowed-basis', 'convention', '--runtime-bin', fake.bin, ...extra],
  { cwd: repo, env: fake.env });
  const statusFile = path.join(dir, 'nodes', 'contract-audit.status.json');
  assert.ok(fs.existsSync(statusFile), `no status was written: ${r.output.slice(-1200)}`);
  return { r, fake, st: JSON.parse(fs.readFileSync(statusFile, 'utf8')) };
}
test('run: a link standing at a node\'s stdout.json leaves it BLOCKED with the cause, never RUNNING, and launches nothing', (t) => {
  const target = tmpDir(t, 'q-pbr-linktarget-');
  let linked = true;
  const { st, fake } = spawnContractAudit(t, [], (dir) => {
    const at = path.join(dir, 'evidence', 'contract-audit', 'stdout.json');
    fs.mkdirSync(path.dirname(at), { recursive: true });
    linked = makeLink(t, { target, at, type: 'junction' }) !== null;
  });
  if (!linked) { t.skip('this filesystem refuses a link'); return; }
  assert.equal(st.state, 'BLOCKED', `the refused stdout.json left the node ${st.state}`);
  assert.equal(st.launched, false);
  assert.match((st.validator_errors ?? []).join(' '), /stdout\.json/, `the cause is not named: ${st.validator_errors}`);
  assert.equal(fake.calls().length, 0, 'the runtime was launched although its output path was refused');
});
test('run: an unknown --test-stop leaves the node BLOCKED with the cause, never RUNNING', (t) => {
  const { r, st } = spawnContractAudit(t, ['--test-stop', 'sometimes']);
  assert.notEqual(r.status, 0);
  assert.equal(st.state, 'BLOCKED', `an unknown --test-stop left the node ${st.state}`);
  assert.match((st.validator_errors ?? []).join(' '), /--test-stop must be one of/);
});

// A LENS REQUIRING INTENT WITH NO INTENT NODE TO RUN IS A REQUIRED INPUT ABSENT (G-2, G-5 of
// 20261115-031845-pbr-1b-remediation-2-review): with intent-capture not installed the intent phase had no branch, so
// intentRefusal stayed unset and the fan-out guard launched the lens with no criteria. Source-held: a run test cannot
// uninstall a node of the framework it runs.
test('a lens requiring intent with intent-capture not installed is refused its criteria, never started without them', () => {
  const src = read('scripts/run-graph.mjs');
  const at = src.indexOf("} else if (needsIntent && skillInstalled('intent-capture')) {");
  const fan = src.indexOf('// ---------------------------------------------------------------------------- phase 2: fan-out', at);
  assert.ok(at > 0 && fan > at, 'the intent phase is not where this test looks');
  assert.match(src.slice(at, fan), /\n\} else if \(needsIntent\) \{[\s\S]*?\n\s*intentRefusal = [^\n]+\n[\s\S]*?\n\}\s*$/,
    'no branch refuses the criteria when intent-capture is not installed');
});

// A REFUSAL OR AN ABSENCE IS HANDLED BY ITS SITE'S CLASS, AND NOTHING ELSE IS (G-3 of
// 20261115-042114-pbr-1b-remediation-4-review; ARCHITECTURE.md A-30, tightened 2026-11-15: "An I/O failure that is not a
// refusal (EACCES, EEXIST) still throws"). G-6 of 20261115-031845-pbr-1b-remediation-2-review had every site catch every
// failure, so an EACCES or EIO became a BLOCKED node or an omitted input instead of an engine failure.
test('every caught prompt-bound read in run-graph re-throws a failure that is neither a refusal nor an absence', async () => {
  const lines = read('scripts/run-graph.mjs').split(/\r?\n/);
  // The one rule is the owner's (G-28 of 20261116-221234-m2-9a-high-2): run-graph imports it rather than defining a copy.
  assert.match(lines.join('\n'), /import \{[^}]*\brefusedOrAbsent\b[^}]*\} from '\.\/io\/egress-read\.mjs';/,
    'no one rule says which failures a prompt-bound site handles');
  const { refusedOrAbsent } = await import('../scripts/lib/egress-read.mjs');
  for (const [code, handled] of [['ECONFINED', true], ['ENOENT', true], ['EACCES', false], ['EIO', false]]) {
    assert.equal(refusedOrAbsent({ code }), handled, code);
  }
  const catchAll = [];
  let caught = 0;
  lines.forEach((l, i) => {
    // A read through the owner directly counts too (G-10 of 20261115-045745-pbr-1b-remediation-5-review): the linked
    // remediation census reads egressRunReader(...).read( with no promptRead on its line, and its catch kept only
    // ECONFINED (G-4 of that review) while this test, scanning promptRead( alone, passed.
    if (!/promptRead\(|egressRunReader\([^)]*\)\.read\(/.test(l) || l.startsWith('const promptRead')) return;
    const c = lines.slice(i, i + 4).findIndex((x) => /catch \(e\) \{/.test(x));
    if (c < 0) return;
    caught += 1;
    const inline = /catch \(e\) \{\s*(\S.*)$/.exec(lines[i + c])?.[1];
    const body = lines.slice(i + c + 1, i + c + 8).map((x) => x.trim()).filter((x) => x && !x.startsWith('//'));
    const first = inline ?? body[0] ?? '';
    if (first !== 'if (!refusedOrAbsent(e)) throw e;') catchAll.push(`scripts/run-graph.mjs:${i + 1}: ${first.slice(0, 100)}`);
  });
  assert.ok(caught >= 8, `expected the eight caught prompt-bound reads, the census among them, found ${caught}`);
  assert.deepEqual(catchAll, [], 'a prompt-bound read catches a failure that is neither a refusal nor an absence');
});
test('the owner\'s words name a failed read by its code, never as a refusal of the path', async () => {
  const { refusalWords } = await import('../scripts/io/egress-read.mjs');
  for (const code of ['EISDIR', 'EACCES', 'ENOENT']) {
    const e = Object.assign(new Error(code), { code });
    assert.match(refusalWords(e), new RegExp(code), `a ${code} is said as ${refusalWords(e)}`);
  }
});

// THE MINT'S CANARY SNAPSHOT READ ENDS A REFUSAL AS A REFUSED MINT, NEVER AN EXCEPTION (G-3 of
// 20261115-045745-pbr-1b-remediation-5-review; ARCHITECTURE.md A-30: "a refusal ends the run at its gate, never by an
// exception"). The egressRunReader read of contract.snapshot.md had no catch, so a hard link or an oversized snapshot
// threw out of new-run with a stack. Source-held: the snapshot is new-run's own write a few lines earlier, and the canary
// needs a live runtime, so no run test can stand a link at it before this read.
test('new-run refuses the mint by name when the canary\'s contract snapshot read is refused, and re-throws anything else', () => {
  const lines = read('scripts/new-run.mjs').split(/\r?\n/);
  const at = lines.findIndex((l) => /egressRunReader\(runDir\)\.read\(\['contract\.snapshot\.md'\]/.test(l));
  assert.ok(at > 0, 'the canary\'s contract snapshot read is not where this test looks');
  assert.match(lines[at], /^\s*try \{/, 'the canary\'s contract snapshot read is not caught');
  const c = lines.slice(at, at + 4).findIndex((x) => /catch \(e\) \{/.test(x));
  assert.ok(c >= 0, 'the canary\'s contract snapshot read has no catch');
  const handler = lines.slice(at + c, at + c + 6).join('\n');
  // An absence is a refusal's class, by the owner's rule (G-28 of 20261116-221234-m2-9a-high-2; A-30).
  assert.match(handler, /if \(!refusedOrAbsent\(e\)\) throw e;/, 'a failure that is neither a refusal nor an absence is not re-thrown');
  assert.match(handler, /die\(/, 'a refusal does not end as a refused mint');
});

// AN ARM WHOSE PROMPT FILE WAS REFUSED IS BLOCKED, NOT DEGRADED (G-5 of 20261115-045745-pbr-1b-remediation-5-review;
// ARCHITECTURE.md A-30: a refused required input is recorded BLOCKED). external-review turns a refused prompt-file read
// into its unavailable envelope, `prompt file refused: <why>`, and run-graph recorded every unreachable arm DEGRADED, so
// an arm refused its own prompt read like one whose vendor timed out.
test('an arm whose external-review refused its prompt file is recorded BLOCKED, any other unreachable arm DEGRADED', async () => {
  // run-graph's unreachable-arm branch records the state armUnreachableState decides, not a literal DEGRADED.
  const src = read('scripts/run-graph.mjs');
  const at = src.indexOf("if (probe.state !== 'reachable') {");
  assert.ok(at > 0, 'the unreachable-arm branch is not where this test looks');
  // Held in `unreachable` since G-31 of 20261121-204740-m3s7-b1-remediation-review, which decides `launched` from it too.
  assert.match(src.slice(at, at + 500), /const unreachable = armUnreachableState\(probe\);\s*writeStatusStub\(arm\.id, unreachable, \{/,
    'the unreachable-arm branch records DEGRADED for a refused prompt file, not the state armUnreachableState decides');
  const { armUnreachableState } = await import('../scripts/lib/reviewer-probe.mjs');
  assert.equal(armUnreachableState({ state: 'unavailable', reason: 'prompt file refused: a hard link stands at prompt.md' }), 'BLOCKED');
  assert.equal(armUnreachableState({ state: 'unavailable', reason: 'exited 1 with no output: boom' }), 'DEGRADED');
  assert.equal(armUnreachableState({ state: 'malformed', reason: 'no parseable envelope on stdout' }), 'DEGRADED');
  // An ABSENT prompt file is a refusal's class too (G-23 of 20261117-013640-m2-9a-final; A-30): external-review reports
  // it as `prompt file not found: <path>`, and recording that DEGRADED softened the gate for a missing required input.
  assert.equal(armUnreachableState({ state: 'unavailable', reason: 'prompt file not found: nodes/arm/prompt.md' }), 'BLOCKED',
    'an arm whose prompt file is absent is recorded DEGRADED, as a lost opinion, not BLOCKED on a missing required input');
});
