// M0's gate (ledger-transitions stage 7): the platform-remediated run's findings still present in the code, fixed
// (operator, 2026-09-29: "1 as suggested, 2 as suggested, 3 as suggested"). Groups of
// 20260925-200721-platform-remediated: G-2, G-3, G-7, G-13, G-14, G-22, G-24, G-27, G-30.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandGlob } from '../scripts/io/glob-walk.mjs';
import { declaredEnvErrors } from '../scripts/lib/reviewers.mjs';
import { ensureReviewsIgnore } from '../scripts/io/reviews-root.mjs';
import { PREFLIGHT_COMMAND_KEYS } from '../scripts/lib/preflight-cache.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');
const tmp = (t) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-m0g-'))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

// G-2: the probe's finding carries a basis a code-audit finding can actually have.
test('G-2: the tie-break probe\'s code-audit finding uses a basis code-audit is allowed', async () => {
  const roster = JSON.parse(read('scripts', 'lens-roster.json'));
  const allowed = (roster.lenses ?? roster.nodes ?? []).find?.((l) => l.id === 'code-audit')?.allowed_basis
    ?? JSON.stringify(roster).match(/"code-audit"[\s\S]*?"allowed_basis"\s*:\s*(\[[^\]]*\])/)?.[1];
  const allowedList = Array.isArray(allowed) ? allowed : JSON.parse(allowed);
  // The synthetic dispute moved from check-tiebreak.mjs to lib/reviewer-probe.mjs's probeDispute (reviewer-preflight
  // stage 4), which external-review's tie-break probe renders; read from the dispute itself rather than from source text.
  const { probeDispute } = await import('../scripts/lib/reviewer-probe.mjs');
  const lens = probeDispute({ armSource: 'codex', armNodeId: 'panel-codex-code' }).findings.find((f) => f.node_id === 'code-audit');
  assert.ok(lens, 'the probe finding was not found');
  assert.ok(allowedList.includes(lens.basis), `basis '${lens.basis}' is not one code-audit may use (${allowedList.join(', ')})`);
});

// G-3 (only a missing tiebreak-check.json is a first run) went with the record: check-tiebreak.mjs and its file were
// retired in reviewer-preflight stage 4, and a probe record is now one file per combination, read by readProbeRecord.

// G-7: a contract glob whose root leaves the repository expands to nothing.
test('G-7: expandGlob does not walk outside the repository', (t) => {
  const d = tmp(t);
  const repo = path.join(d, 'repo'); fs.mkdirSync(repo);
  fs.mkdirSync(path.join(d, 'outside')); fs.writeFileSync(path.join(d, 'outside', 'secret.md'), 'x');
  // REFUSED since G-22 of 20260929-225147-m0-gate-review (operator: "refuse"): returning nothing dropped the glob from
  // the input hashes silently. Either way, nothing outside the repository is walked.
  // Since contract-glob-grammar stage 3 the refusal is the grammar's (`..`, absolute); nothing outside is walked.
  assert.throws(() => expandGlob(repo, '../outside/**'), /refused|outside the repository/, 'a ../ root walked outside the repository');
  assert.throws(() => expandGlob(repo, `${path.join(d, 'outside').split(path.sep).join('/')}/**`), /refused|outside the repository/, 'an absolute root walked outside the repository');
});

// G-13: one list of pre-flight checks.
test('G-13: run-checks builds its checks from PREFLIGHT_COMMAND_KEYS, not a second list', () => {
  const s = read('scripts', 'run-checks.mjs');
  assert.match(s, /PREFLIGHT_COMMAND_KEYS\.map\(/, 'run-checks keeps its own list of checks');
  assert.equal(PREFLIGHT_COMMAND_KEYS.length, 7);
});

// G-14: a scalar env_prefixes is reported, not thrown on.
test('G-14: declaredEnvErrors reports a scalar env_prefixes instead of throwing', () => {
  let errs;
  assert.doesNotThrow(() => { errs = declaredEnvErrors({ x: { env_prefixes: 'AWS_' } }); });
  assert.ok(errs.some((e) => /env_prefixes/.test(e)), JSON.stringify(errs));
});

// G-22: a cached failure restores the logs its checks.json names.
test('G-22: the cached-failure branch restores the pre-flight evidence before writing checks.json', () => {
  // THE ORDER, not where the call sits (operator, 2026-11-14: "Fix the test line, retry (Recommended)"): this test looked
  // for the restore inside the barrier-failed branch, and remediation 20261114-053608-m2-7b-remediation-4 moved it ahead of
  // the branch, shared by both reuse paths. What G-22 needs, whichever layout: on the path a cached failure runs, from the
  // reuse decision to the branch's exit, the evidence is restored before the last checks.json write on that path.
  const s = read('scripts', 'run-graph.mjs');
  const start = s.indexOf('const decision = ');
  const branch = s.indexOf('if (decision.entry.barrier_failed) {', start);
  assert.ok(start > 0 && branch > start, 'the reuse decision or its barrier-failed branch is gone');
  const exit = s.indexOf('process.exit(1);', branch);
  const path_ = s.slice(start, exit);
  const write = path_.lastIndexOf("writeJson(path.join(runDir, 'checks.json')");
  assert.ok(write > 0, 'the cached-failure path writes no checks.json');
  const restore = path_.lastIndexOf('restorePreflightEvidence(', write);
  assert.ok(restore > 0, 'a cached failure names evidence logs it never restored before writing checks.json');
});

// G-24: an existing .gitignore is checked for the rules the reviews root needs, and a gap is reported.
test('G-24: ensureReviewsIgnore reports an existing .gitignore that does not ignore evidence', (t) => {
  const d = tmp(t);
  fs.writeFileSync(path.join(d, '.gitignore'), '# someone else\'s file\nnode_modules/\n');
  const r = ensureReviewsIgnore(d);
  assert.ok(r && Array.isArray(r.missing) && r.missing.includes('*/evidence/'), `a .gitignore that tracks evidence was trusted: ${JSON.stringify(r)}`);
  assert.equal(fs.readFileSync(path.join(d, '.gitignore'), 'utf8'), '# someone else\'s file\nnode_modules/\n', 'the operator\'s file was overwritten');
  const fresh = tmp(t);
  assert.deepEqual(ensureReviewsIgnore(fresh).missing, [], 'a freshly written .gitignore reports rules missing');
});

// G-27, G-30: a document that says another owns a rule does not restate it.
test('G-27: adapter-contract points at the platform rules without listing them', () => {
  const s = read('shared', 'adapter-contract.md');
  const i = s.indexOf('That is all this section owns.');
  assert.doesNotMatch(s.slice(i, i + 500), /single reader of\s+`process\.platform`/, 'the section lists the rules it says it does not restate');
});

test('G-30: claude-md-contract points at external-reviewers.md for the arm ceilings without restating them', () => {
  const s = read('shared', 'claude-md-contract.md');
  const i = s.indexOf('Its `basis` and its ceilings are owned by `shared/external-reviewers.md`');
  assert.ok(i > 0, 'the pointer was not found');
  assert.doesNotMatch(s.slice(i, i + 600), /In short: `convention`, capped at `MEDIUM`/, 'the ceilings are restated beside the pointer');
});
