// evidence-path-owner.plan.md stage 4 (design EP-D3 A, operator 2026-11-04). The grounding-and-retry-evidence chain
// reached its round cap because each review found one more reader that spelled or compared a cited evidence path its own
// way (G-5 and G-2 of 20261104-030455-gre-remediation-3-review the last); the census of 2026-11-04 itself found two the
// design note had not listed (lib/remediation-chain.mjs repairGreenErrors, and the runner's report check). This test is
// the set: every place in the files that handle a cited evidence path that splits a path or tests whether it is absolute,
// and every call of a reader, must be the owner (lib/evidence-path.mjs), an intake that calls it, or named below with
// its reason. A new one fails here, not in the next review.
//
// Instrument (lexical; a spelling it does not search for is not caught, which is why the patterns are written here):
//   PATH_SPLIT  split(/[\\/]...), split('/'), split('\\') in any quote, split(path.sep), path.isAbsolute(
//   READER      captureFacts( evidenceRecordNow( seatBasis( isCapturedArtifact( isRunEvidence( questionEvidence( questionEvidenceError(
//               rootEvidencePath( runEvidencePath( normalizeEvidenceFields( normalizeReport( normalReport(
//               evidenceRefusal( evidenceRecordDifference(   (the last two: G-19 of 20261104-060910-epo-delivery, I-8/I-9)
// over every script that calls a reader, and FILES below (censusFiles), comments and `export function` lines left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// scripts/io/set-aside.mjs: the set-aside, moved out of the runner with its two path splits (runner-test-seam.plan.md stage 1).
const FILES = ['scripts/lib/decision-panel.mjs', 'scripts/remediate.mjs', 'scripts/io/capture-facts.mjs', 'scripts/lib/remediation-chain.mjs',
  'scripts/decide.mjs', 'scripts/io/decision-run.mjs', 'scripts/io/set-aside.mjs'];
// Any quote (G-16 of 20261104-072059-epo-remediation-review): '/', "/", `/`, and the same for '\\'.
const PATH_SPLIT = /split\(\/\[\\\\\/\]|split\((['"`])(?:\/|\\\\)\1\)|split\(path\.sep\)|path\.isAbsolute\(/;
const READER = /\b(captureFacts|evidenceRecordNow|seatBasis|isCapturedArtifact|isRunEvidence|questionEvidence|questionEvidenceError|rootEvidencePath|runEvidencePath|normalizeEvidenceFields|normalizeReport|normalReport|normalGroups|evidenceRefusal|evidenceRecordDifference)\(/;

// [file, the line's text (trimmed, a prefix is enough), why it is not a reader of a raw spelling]
const NAMED = [
  // Path splits that are not of a cited evidence path, or split the owner's normal form.
  ['scripts/lib/decision-panel.mjs', "if (rel.split(/[\\\\/]/)[0] !== '..' && !path.isAbsolute(rel))", "runtimeCall's surface against the repository: a directory, not a cited path (its first segment, G-11 of 20261105-074139-crsf-remediation-3-review)"],
  ['scripts/lib/decision-panel.mjs', 'const realFile = io.fs.realpathSync(path.join(root, ...n.rel.split', "splits the owner's `rel`"],
  ['scripts/lib/decision-panel.mjs', 'realRel = path.relative(realRoot, realFile).split(path.sep)', 'a real path the host returned, compared with the normal form'],
  ['scripts/lib/decision-panel.mjs', 'try { st = confined({ root: n.root, io }).stat(n.rel.split', "splits the owner's `rel`"],
  ['scripts/remediate.mjs', '.map((d) => path.relative(repo, d).split(path.sep)', 'a repository directory, not a cited path'],
  ['scripts/remediate.mjs', '? path.relative(repo, path.resolve(repo, run.contract_source)).split(path.sep)', 'the contract file, not a cited path'],
  ['scripts/remediate.mjs', 'const repoRel = (p) => path.relative(repo, p).split(path.sep)', 'a repository path the runner made'],
  ['scripts/remediate.mjs', "const filesAt = path.relative(runDir, runnerPath(name, 'checked-files.json')).split(path.sep)", "the runner's own file"],
  ['scripts/remediate.mjs', 'const presentBelowRun = (f) =>', 'a candidate file the runner listed, below the run'],
  ['scripts/remediate.mjs', 'const readOr = (f, parse) =>', "the runner's own files"],
  ['scripts/remediate.mjs', "for (const p of [...new Set(paths)].sort()) captures[p] = captureHash(p.split('/')", 'evidenceRecordNow: splits normal forms'],
  ['scripts/remediate.mjs', "for (const p of [...new Set(repairPaths)].sort()) repair_captures[p] = captureHash(p.split('/')", "evidenceRecordNow: splits the repair greens' normal forms (G-11 of 20261104-072059-epo-remediation-review)"],
  ['scripts/remediate.mjs', 'return path.relative(runDir, runnerPath(`${stem}-${k}.log`)).split(path.sep)', "the runner's own log"],
  ['scripts/remediate.mjs', "try { return owner.stat(String(p).split('/')).isFile(); }", "the report check: splits the report's normal forms"],
  ['scripts/remediate.mjs', 'const relOut = (p) => path.relative(repo, p).split(path.sep)', 'an output path the runner made'],
  ['scripts/io/set-aside.mjs', "const treeSegs = (p) => p.split('/');", 'a repository path git listed, for the working tree owner (remediation-cluster-order.plan.md)'],
  ['scripts/io/set-aside.mjs', "const dir = dirName.split('/');", 'the set-aside folder the runner recorded'],
  ['scripts/io/capture-facts.mjs', "const segs = String(p).split('/');", 'captureFacts: splits normal forms'],
  ['scripts/lib/remediation-chain.mjs', "const segs = String(f.green_evidence ?? '').split('/');", "repairGreenErrors: splits the repair report's normal forms"],
  ['scripts/lib/remediation-chain.mjs', 'if (path.isAbsolute(String(p)) || String(p).split(', "runnerPath: the runner's own folder, not a cited path"],
  ['scripts/decide.mjs', "try { st = confined(e.root).stat(e.rel.split('/')); }", "the question's intake: splits the owner's `rel`"],
  ['scripts/io/decision-run.mjs', 'const seg = (...names) =>', "a decision record's own file names"],
  ['scripts/remediate.mjs', "const segs = String(rel).split(/[\\\\/]/).filter((x) => x && x !== '.');", "installReplay: a candidate file's repository path, as git spells it, not a cited capture"],
  ['scripts/remediate.mjs', 'if (st.stdout_path) nodeRecord.terminal_reason = JSON.parse(owner.read(String(st.stdout_path).split(', "the node's own stdout path, written by spawn-node, not a cited capture"],
  ['scripts/lib/remediation-chain.mjs', "const norm = (p) => String(p).split('\\\\').join('/');", 'treeGuardRefusals: repository paths and the run directory, not a cited capture'],
  ['scripts/lib/remediation-chain.mjs', "const fileKey = (p) => pathKey(String(p).split('\\\\').join('/'), { caseInsensitive });", "a test file's repository path, compared by pathKey (the plan's stage 2 exception)"],
  // Reader calls: the intakes, and readers given the intakes' results.
  ['scripts/decide.mjs', 'const evidenceError = questionEvidenceError(question?.evidence, { rootsLater: true });', 'the question intake, its shape before the contract is read'],
  ['scripts/decide.mjs', 'const { entries, error } = questionEvidence(', 'the question intake'],
  ['scripts/decide.mjs', 'const grounding = { floor, basisOf: (citations) => seatBasis(', "a seat's answer enters grounding: seatBasis normalizes its citations once"],
  ['scripts/lib/decision-panel.mjs', 'const r = rootEvidencePath(e, {', 'questionEvidence: the owner, at the intake'],
  ['scripts/lib/decision-panel.mjs', 'return questionEvidence(evidence, opts).error;', 'questionEvidenceError: the intake'],
  ['scripts/lib/decision-panel.mjs', ".map((e) => (e && typeof e === 'object' && typeof e.key === 'string' ? e : rootEvidencePath(e, roots)))", "seatBasis: the question's list, already normal or normalized by the owner"],
  ['scripts/lib/decision-panel.mjs', 'const n = rootEvidencePath(c, roots);', "seatBasis: a seat's citation, normalized once where it enters"],
  ['scripts/lib/decision-panel.mjs', 'if (!isCapturedArtifact(n, roots))', "seatBasis: given the owner's result"],
  ['scripts/lib/decision-panel.mjs', 'return isRunEvidence(r, {', "isCapturedArtifact: the owner's run-evidence rule, given the owner's result (G-4 of 20261104-072059-epo-remediation-review)"],
  ['scripts/lib/remediation-chain.mjs', 'const parts = evidencePaths(item[f]).map((p) => runEvidencePath(p,', "normalizeEvidenceFields: the owner, at the report's read"],
  ['scripts/lib/remediation-chain.mjs', "if (Array.isArray(report.groups)) out.groups = normalizeEvidenceFields(report.groups, ['red_evidence', 'green_evidence'], opts);", "normalizeReport: a remediation report's groups, every one"],
  ['scripts/lib/remediation-chain.mjs', "if (Array.isArray(report.failures)) out.failures = normalizeEvidenceFields(report.failures, ['green_evidence'], opts);", "normalizeReport: a repair report's failures, every one"],
  ['scripts/lib/remediation-chain.mjs', 'const why = evidenceRefusal(judged, evidence, contract, { caseInsensitive });', 'admitGroups: given normalized groups and captureFacts of normal forms'],
  ['scripts/remediate.mjs', 'const facts = captureFacts(runDir, fixed.map((f) => f.green_evidence));', 'given the normalized repair greens'],
  ['scripts/remediate.mjs', 'const normalReport = (report) => normalizeReport(', "the report's read: the owner, for every read of a payload.json"],
  ['scripts/remediate.mjs', 'const why = evidenceRecordDifference(record, evidenceRecordNow(evidencePathsOf(groups), Object.keys(record?.repair_captures', "given normalized groups, and the record's own repair-green keys"],
  ['scripts/remediate.mjs', 'saveRun({ evidence_record: { ...rec, repair_captures:', 'recordRepairGreens: given the normalized repair greens (G-11 of 20261104-072059-epo-remediation-review)'],
  ['scripts/remediate.mjs', 'payload = normalReport(payload);', "a read of the report: the first run's, the repair pass's and --readmit-evidence's"],
  ['scripts/remediate.mjs', 'const evidence = captureFacts(runDir, evidencePathsOf(payload.groups));', '--readmit-evidence: given normalized groups'],
  ['scripts/remediate.mjs', "refuseOnEvidenceChange('--retry-commits', normalReport(report).groups);", 'a read of the report: the plain retry with nothing pending'],
  ['scripts/remediate.mjs', 'saved = normalReport(saved);', 'a read of the report: --retry-commits'],
  ['scripts/remediate.mjs', 'const retryEvidence = captureFacts(runDir, evidencePathsOf(saved.groups));', '--retry-commits: given normalized groups'],
  ['scripts/remediate.mjs', 'saveRun({ evidence_record: evidenceRecordNow(evidencePathsOf(payload?.groups)) });', 'the first run: given normalized groups'],
  ['scripts/remediate.mjs', 'const evidence = captureFacts(runDir, evidencePathsOf(payload?.groups));', 'the first run: given normalized groups'],
];

// THE CENSUS'S FILES (G-12 of 20261104-171128-epo-remediation-3-review): every script under scripts/ whose code (comments
// and declarations left out, as sites() leaves them) calls a reader, found by walking the tree, so a reader added to any
// script joins the census; plus FILES, which also names a script that handles evidence paths without calling a reader
// (io/decision-run.mjs). The owner, lib/evidence-path.mjs, is the rule itself and is left out.
const OWNER = 'scripts/lib/evidence-path.mjs';
const codeLine = (raw) => {
  const t = raw.trim();
  return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !/^export function /.test(t) && !/^function /.test(t);
};
function censusFiles(root) {
  const found = new Set(FILES.filter((f) => fs.existsSync(path.join(root, ...f.split('/')))));
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, ...rel.split('/')), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (/\.(mjs|js)$/.test(e.name) && r !== OWNER
        && fs.readFileSync(path.join(root, ...r.split('/')), 'utf8').split(/\r?\n/).some((l) => codeLine(l) && READER.test(l.trim()))) found.add(r);
    }
  };
  if (fs.existsSync(path.join(root, 'scripts'))) walk('scripts');
  return [...found].sort();
}

function sites() {
  const out = [];
  for (const file of censusFiles(ROOT)) {
    const lines = fs.readFileSync(path.join(ROOT, ...file.split('/')), 'utf8').split(/\r?\n/);
    lines.forEach((raw, i) => {
      const text = raw.trim();
      if (!codeLine(raw)) return;
      if (PATH_SPLIT.test(text) || READER.test(text)) out.push({ file, line: i + 1, text });
    });
  }
  return out;
}

test('every path split and every reader call in the evidence-path files is the owner, an intake, or named with its reason', () => {
  const unnamed = sites().filter((s) => !NAMED.some(([f, prefix]) => f === s.file && s.text.startsWith(prefix)));
  assert.deepEqual(unnamed.map((s) => `${s.file}:${s.line}: ${s.text}`), [],
    'a path split or reader call that is neither the owner nor named here: route it through lib/evidence-path.mjs, or name it with its reason');
});

// G-12 of 20261104-171128-epo-remediation-3-review: FILES was six hard-coded scripts, so a reader added to any other
// script could never fail the census. The set is every script under scripts/ whose code calls a reader, found here.
test('G-12: a reader call in a script outside the listed files joins the census', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'epo4-census-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts', 'io'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'scripts', 'io', 'new-reader.mjs'), "const f = captureFacts(dir, paths);\n");
    fs.writeFileSync(path.join(tmp, 'scripts', 'quiet.mjs'), "const x = 1;\n");
    const files = censusFiles(tmp);
    assert.ok(files.includes('scripts/io/new-reader.mjs'), `a new reader is outside the census: ${files.join(', ')}`);
    assert.ok(!files.includes('scripts/quiet.mjs'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// G-16 of 20261104-072059-epo-remediation-review: PATH_SPLIT matched split('/') and split('\\') in single quotes only, so
// split("/") or split(`\\`), the same second owner, passed the census unseen. The instrument is checked on every quote.
test('G-16: the census instrument matches a path split in any quote', () => {
  for (const s of ["p.split('/')", 'p.split("/")', 'p.split(`/`)', "p.split('\\\\')", 'p.split("\\\\")', 'p.split(`\\\\`)', 'p.split(/[\\\\/]+/)', 'p.split(path.sep)']) {
    assert.match(s, PATH_SPLIT, `${s} is not seen by the census`);
  }
  assert.doesNotMatch("s.split(',')", PATH_SPLIT);
  assert.doesNotMatch('s.split("\\n")', PATH_SPLIT);
});

// runner-test-seam.plan.md stage 1: the set-aside's two path splits moved from scripts/remediate.mjs to scripts/io/set-aside.mjs,
// which calls no reader, so only FILES brings it into the census. Both splits are seen there, and neither is left in the runner.
test('the set-aside module is in the census, and its two path splits are seen there, not in the runner', () => {
  const all = sites();
  assert.ok(censusFiles(ROOT).includes('scripts/io/set-aside.mjs'), 'scripts/io/set-aside.mjs is outside the census');
  for (const prefix of ["const treeSegs = (p) => p.split('/');", "const dir = dirName.split('/');"]) {
    assert.ok(all.some((s) => s.file === 'scripts/io/set-aside.mjs' && s.text.startsWith(prefix)), `not seen in scripts/io/set-aside.mjs: ${prefix}`);
    assert.ok(!all.some((s) => s.file === 'scripts/remediate.mjs' && s.text.startsWith(prefix)), `still in scripts/remediate.mjs: ${prefix}`);
  }
});

test('every named site still exists, so the list does not keep reasons for code that is gone', () => {
  const all = sites();
  const stale = NAMED.filter(([f, prefix]) => !all.some((s) => s.file === f && s.text.startsWith(prefix)));
  assert.deepEqual(stale.map(([f, p]) => `${f}: ${p}`), []);
});

// G-19 of 20261104-060910-epo-delivery: evidenceRefusal compares paths by pathKey, the plan's one repository-path
// exception (I-9), and the census never listed it, so a pathKey comparison of a cited capture could join it unseen.
const PATH_KEY_IN_REFUSAL = [
  ["const k = pathKey(file ?? '', { caseInsensitive: ci });", "a test file's repository path from capture's header, not a cited capture"],
  ['return (g.files ?? []).some((f) => pathKey(f, { caseInsensitive: ci }) === k)', "the group's files, repository paths as git spells them"],
];
test('G-19: every pathKey comparison in evidenceRefusal is the named repository-path exception', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'remediation-chain.mjs'), 'utf8');
  const start = src.indexOf('export function evidenceRefusal(');
  assert.ok(start >= 0, 'evidenceRefusal is gone');
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end).split(/\r?\n/).map((l) => l.trim()).filter((l) => /\bpathKey\(/.test(l) && !l.startsWith('//'));
  assert.deepEqual(body.filter((l) => !PATH_KEY_IN_REFUSAL.some(([p]) => l.startsWith(p))), [], 'a pathKey comparison in evidenceRefusal not named as the exception');
  assert.deepEqual(PATH_KEY_IN_REFUSAL.filter(([p]) => !body.some((l) => l.startsWith(p))).map(([p]) => p), [], 'a named exception that is gone');
});

// G-10 and G-12 of 20261104-060910-epo-delivery: the runner normalizes a WHOLE report, immediately where it is read.
test('G-10, G-12: every read of a node report in the runner is normalized whole, before any consumer', () => {
  const lines = fs.readFileSync(path.join(ROOT, 'scripts', 'remediate.mjs'), 'utf8').split(/\r?\n/);
  assert.deepEqual(lines.filter((l) => /\bnormalizeEvidenceFields\(/.test(l)).map((l) => l.trim()), [],
    'the runner picks items and fields to normalize: a part of the report can stay in its spelling');
  const reads = lines.map((l, i) => [l, i]).filter(([l]) => /JSON\.parse\(owner\.read\(\['evidence', (nodeId|'remediation'), 'payload\.json'\]\)\)/.test(l));
  assert.ok(reads.length >= 4, `the report reads were not found (${reads.length})`);
  for (const [l, i] of reads) {
    const v = /(\w+) = JSON\.parse/.exec(l)?.[1];
    const next = lines.slice(i + 1, i + 6).map((x) => x.trim()).filter((x) => x && !x.startsWith('//'));
    const ok = new RegExp(`^${v} = normalReport\\(${v}\\);`).test(next[0] ?? '') || /normalReport\(report\)/.test(lines.slice(i + 1, i + 6).join('\n'));
    assert.ok(ok, `remediate.mjs:${i + 1}: the report read into ${v} is not normalized on the next statement (${next[0]})`);
  }
});

test('the owner is lib/evidence-path.mjs, and the runner and the panel import it rather than restating it', () => {
  const chain = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'remediation-chain.mjs'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'decision-panel.mjs'), 'utf8');
  assert.match(chain, /import \{ runEvidencePath \} from '\.\/evidence-path\.mjs';/);
  // isRunEvidence, not reviewRoots: the run-evidence containment is the owner's too (G-4 of 20261104-072059-epo-remediation-review).
  assert.match(panel, /import \{ rootEvidencePath, isRunEvidence, foldIf \} from '\.\/evidence-path\.mjs';/);
  assert.doesNotMatch(panel, /function reviewsDirsAbs|function outsideRepoCapture/, 'a second copy of the reviews roots or the outside-capture rule');
});
