// Remediation of review 20260929-225147-m0-gate-review (operator, 2026-09-30: "1. refuse, 2. fix all, 3. fix,
// 4. suggested, 5. add, 6. fix"). Fixed: G-22 (a contract glob outside the repository silently dropped from the
// input hashes — REFUSED now, loudly), G-9 with G-19 and G-24 (a later negation passed the .gitignore check, and a gap
// was only printed), G-3 with G-4, G-5, G-6, G-7 (the tie-break probe differing from production), G-18 (reuse
// decided on the mint-time dirty flag), G-16 (a model literal), G-20 (a non-atomic pointer write).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandGlob } from '../scripts/io/glob-walk.mjs';
import { contractGlobErrors } from '../scripts/lib/contract-glob.mjs';
import { ensureReviewsIgnore } from '../scripts/io/reviews-root.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');
const tmp = (t) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-m0gr-'))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

// G-22: refused, not dropped.
test('G-22: the contract globs that leave the repository are named, for every glob-bearing key', () => {
  // Through the one validator since contract-glob-grammar stage 2, which replaced contractGlobsLeavingRepo.
  const found = contractGlobErrors({
    source_globs: ['scripts/**'], test_globs: ['../other/tests/**'], doc_paths: ['/etc/**', 'docs/**'],
    review: { preflight_inputs: ['C:/elsewhere/**', 'ok/**'] },
  });
  assert.deepEqual(found.map((e) => e.split(' — ')[0]).sort(), ['doc_paths: /etc/**', 'review.preflight_inputs: C:/elsewhere/**', 'test_globs: ../other/tests/**'].sort());
});

// Found by claim-check of this remediation: doc_roles values are expanded as globs for the intent hash too, and
// run-graph's intent-hash call had no catch for the new throw — so an outside doc_roles entry passed new-run and then
// crashed run-graph.
test('G-22: doc_roles values are contract globs too, and are refused when they leave the repository', () => {
  const found = contractGlobErrors({ doc_roles: { architecture: '../docs/ARCH.md', roadmap: 'ROADMAP.md', spec: '' } });
  assert.deepEqual(found.map((e) => e.split(' — ')[0]), ['doc_roles.architecture: ../docs/ARCH.md']);
});

test('G-22: run-graph treats a refused intent-hash walk as no cached intent, not a crash', () => {
  const s = read('scripts', 'run-graph.mjs');
  const i = s.indexOf('const intentInputs = ');
  assert.match(s.slice(i, i + 900), /try \{[\s\S]*intentInputHash\(\{[\s\S]*\} catch/, 'the intent hash can throw out of run-graph');
});

test('G-22: expandGlob refuses a root outside the repository instead of returning nothing', (t) => {
  const d = tmp(t);
  const repo = path.join(d, 'repo'); fs.mkdirSync(repo);
  fs.mkdirSync(path.join(d, 'outside')); fs.writeFileSync(path.join(d, 'outside', 'x.md'), 'x');
  // Since contract-glob-grammar stage 3 the refusal is the grammar's (a `..` segment); the claim — refused, not
  // silently dropped — is unchanged.
  assert.throws(() => expandGlob(repo, '../outside/**'), /refused|outside the repository/, 'an outside root was dropped silently');
  assert.deepEqual(expandGlob(repo, 'nothing-here/**'), [], 'an inside root that matches nothing is still empty, not refused');
});

test('G-22: new-run and preflight refuse a contract whose globs leave the repository, naming each', () => {
  for (const f of ['new-run.mjs', 'preflight.mjs']) {
    assert.match(read('scripts', f), /contractGlobErrors\(contract\)[\s\S]{0,200}die\(/, `${f} does not refuse an outside glob`);
  }
});

// G-9: a later negation defeats a rule; the check reads the file in order.
test('G-9: a .gitignore whose evidence rule is negated later lacks the rule', (t) => {
  const d = tmp(t);
  fs.writeFileSync(path.join(d, '.gitignore'), '*/evidence/\n.preflight-cache/\n!*/evidence/\n');
  assert.deepEqual(ensureReviewsIgnore(d).missing, ['*/evidence/'], 'a negated rule counted as present');
});

// G-19, G-24: the gap is recorded where the run's blind spots are recorded.
test('G-19: a reviews .gitignore gap at the archive destination is recorded in the run\'s not_checked', () => {
  // Through lib/reviews-root's archiveEvidenceEntry since contract-glob-grammar stage 6; the claim is unchanged.
  assert.match(read('scripts', 'run-graph.mjs'), /const entry = archiveEvidenceEntry\(\{[\s\S]{0,300}if \(entry\) buckets\.not_checked\.push\(entry\)/,
    'the gap is only printed, never recorded');
});

// G-3, G-4: the arm's node id follows the arm's source.
// The tie-break probe moved from check-tiebreak.mjs into external-review's runProbe (reviewer-preflight stage 4); these
// three hold it to the same rules there.
const probeBlock = () => {
  const s = read('scripts', 'external-review.mjs');
  // From probeInput, which builds the probe's input for runProbe and for a --probe-run child's check (G-2 of
  // 20261020-172345-argv-remediation-review), through the end of runProbe.
  const i = s.indexOf('function runProbe(');
  return s.slice(s.indexOf('function probeInput('), s.indexOf('\n}\n', i));
};
test('G-3: the probe\'s arm finding names a node id that matches its source reviewer', () => {
  assert.match(probeBlock(), /probeDispute\(\{ armSource: args\.reviewer, armNodeId: `panel-\$\{args\.reviewer\}-code` \}\)/,
    'the arm node id is hard-coded while its source varies');
});

// G-5, G-6: the probe spawns the judge the way run-graph does.
test('G-5, G-6: the probe passes --participants and --surface, as production does', () => {
  const block = probeBlock();
  assert.match(block, /'--participants'/, 'the probe accepts a looser vote vocabulary than production');
  assert.match(block, /'--surface', surface/, 'the probe starts the judge in the caller\'s directory');
});

// G-7: a vote outside the positions is illegible, not a ruling.
test('G-7: a vote outside the participants counts as no ruling', async () => {
  const { probePassed } = await import('../scripts/lib/reviewer-probe.mjs');
  assert.equal(probePassed('tie-break', { status: 'ok', supports: 'elsewhere' }, { participants: ['a', 'b'] }), false,
    'an out-of-vocabulary vote counts as a ruling');
  assert.match(probeBlock(), /probePassed\(args\.mode, env, \{ participants \}\)/, 'and the probe gives the rule its positions');
});

// G-18: reuse is decided on the tree as it is now.
test('G-18: the pre-flight reuse decision probes the tree now, not only the flag frozen at mint', () => {
  const s = read('scripts', 'run-graph.mjs');
  // `, hashDecides: …` was added by preflight-reuse-by-hash: a declared set listed by git is decided by its hash; where the
  // dirty rule still applies, it is still the tree as it is now.
  assert.match(s, /preflightDecision\(\{ entry, hash, dirty: dirtyAtReuse(, hashDecides: [^}]+)? \}\)/, 'reuse is decided on the mint-time dirty flag');
});

// G-16: no model literal in the substitution record.
test('G-16: the defaults-substituted record names the resolved model, not a literal', () => {
  assert.doesNotMatch(read('scripts', 'run-graph.mjs'), /"review\.models\.judgment -> 'opus'"/, 'a model literal in the orchestrator');
});

// G-20: the pointer is written atomically.
test('G-20: latest.txt is written atomically', () => {
  assert.match(read('scripts', 'run-graph.mjs'), /writeTextAtomic\(path\.join\(path\.dirname\(finalDir\), 'latest\.txt'\)/, 'latest.txt is written non-atomically');
});
