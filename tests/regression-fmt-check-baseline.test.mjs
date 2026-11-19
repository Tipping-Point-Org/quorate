// .claude/requests/remediation-fmt-check-baseline.md (story-pipeline, 2026-10-17: commit 762e1d5 of run
// 20261017-010138-remediate-mix-guard-r4 carried a node-written file its declared fmt_check failed on). fmt_check only
// stamps a candidate (operator, 2026-10-13: "a formatter difference does not block a fix"), which is right for formatting
// debt that was already there and wrong for a file the node wrote. So the runner records fmt_check before the node runs,
// and a candidate that turns a passing check red is refused (operator, 2026-10-17: "Refuse only if the fix made it red").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullCheckVerdict } from '../scripts/lib/full-check.mjs';
import { parseCaptureHeader } from '../scripts/lib/capture-header.mjs';
import { runScript, repoRunDir } from './helpers.mjs';

const SRC = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const RAN = (o) => ({ exit_code: 0, timed_out: false, tests: null, failing: null, failing_names: [], evidence_path: 'evidence/remediation-runner/fmt_check.log', ...o });

test('AC1: fmt_check that passed before the node and fails on the candidate refuses it, naming fmt_check', () => {
  const v = fullCheckVerdict({ declared: ['fmt_check'], ran: { fmt_check: RAN({ exit_code: 1 }) }, baseline: { fmt_check: { exit_code: 0 } } });
  assert.equal(v.commit, false);
  assert.deepEqual(v.refusals.map((r) => r.key), ['fmt_check']);
  assert.match(v.refusals[0].why, /passed before the node/);
  assert.deepEqual(v.stamps, []);
});

test('AC2: fmt_check that already failed before the node, or has no baseline, still only stamps', () => {
  for (const baseline of [{ fmt_check: { exit_code: 1 } }, {}, undefined]) {
    const v = fullCheckVerdict({ declared: ['fmt_check'], ran: { fmt_check: RAN({ exit_code: 1 }) }, baseline });
    assert.equal(v.commit, true, JSON.stringify(baseline));
    assert.deepEqual(v.stamps.map((s) => s.key), ['fmt_check']);
  }
});

test('AC2: a passing candidate commits whatever the baseline', () => {
  const v = fullCheckVerdict({ declared: ['fmt_check'], ran: { fmt_check: RAN() }, baseline: { fmt_check: { exit_code: 0 } } });
  assert.equal(v.commit, true);
  assert.deepEqual([...v.refusals, ...v.stamps], []);
});

// AC1, AC3 (the baseline is recorded before the node, and a retry reads it) were pinned here by source text, which
// round 3's G-8 found could not fail. check-outcomes.plan.md stage 5 replaced the pin with an end-to-end runner test,
// `check-outcomes stage 5` in tests/regression-remediate-runner-evidence-and-tree.test.mjs: a baseline recorded after the node would fail on
// the node's file, and a retry that re-measured or dropped the baseline would commit at its step 3.

// G-5 and G-6 of review 20261017-204229-fmt-review: the code changed and the two pages that own its meaning did not. The
// `full-run-red` kind still listed only build, test, lint and typecheck, and the FMT-DIRTY stamp row still promised a stamp
// for every non-zero fmt_check, so a reader looking up either got a definition that ruled out what had happened.
test('G-5, G-6: the full-run-red kind and the FMT-DIRTY stamp row both name the fmt_check baseline refusal', () => {
  const kind = SRC('shared/claude-md-contract.md').match(/`full-run-red` \(the runner's check[^)]*\)/);
  assert.ok(kind, 'the full-run-red kind definition was not found');
  assert.match(kind[0], /fmt_check/, 'the full-run-red kind does not name fmt_check as a cause');
  const row = SRC('shared/disk-first-protocol.md').split('\n').find((l) => l.startsWith('| `FMT-DIRTY` | '));
  assert.ok(row, 'the FMT-DIRTY stamp row was not found');
  assert.match(row.split(' | ')[1], /fmt_baseline|before the node/, 'the FMT-DIRTY trigger does not name the remediation exception');
  const skill = SRC('skills/remediate/SKILL.md').replace(/\s+/g, ' ').match(/`build`, `test`, `lint` and `typecheck` refusing[^(]*\(`full-run-red`\)/);
  assert.ok(skill, 'the remediate skill no longer lists what refuses as full-run-red');
  assert.match(skill[0], /fmt_check/, 'the remediate skill lists what refuses as full-run-red without fmt_check');
});

// G-1 of review 20261017-210240-fmt-remediation-review: every pending cluster was announced as "refused by git or a hook"
// followed by the --retry-commits command, but a pending cluster is also one the runner's own full check refused. For a
// formatter the candidate turned red, the operator got the wrong cause and a retry that is refused again, with nothing
// saying the cluster's files need formatting first.
test('G-1: a pending cluster is announced with its recorded reason, and a fmt_check refusal says to format its files first', async () => {
  const chain = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(typeof chain.pendingClusterLines, 'function', 'no rule says what a pending cluster is announced with');
  const fmtWhy = fullCheckVerdict({ declared: ['fmt_check'], ran: { fmt_check: RAN({ exit_code: 1 }) }, baseline: { fmt_check: { exit_code: 0 } } }).refusals[0];
  const fmt = { id: 1, groups: ['G-1'], accepted: ['scripts/a.mjs', 'tests/a.test.mjs'], pending_retry: true, fmt_turned_red: true,
    reason: `not committed: the full check refused the candidate: fmt_check ${fmtWhy.why}; its changes are left in the working tree` };
  const text = chain.pendingClusterLines([fmt]).join('\n');
  assert.doesNotMatch(text, /refused by git or a hook/, 'a full-check refusal is still blamed on git or a hook');
  assert.match(text, /cluster 1 \(G-1\)/);
  assert.match(text, /fmt_check exit 1/, 'the recorded reason is not shown');
  assert.match(text, /format/i, 'a fmt_check refusal does not say to format the files');
  assert.match(text, /scripts\/a\.mjs/, 'the files to format are not named');
  const hook = { id: 2, groups: ['G-2'], accepted: ['scripts/b.mjs'], pending_retry: true, reason: 'pre-commit hook exited 1' };
  const hookText = chain.pendingClusterLines([hook]).join('\n');
  assert.match(hookText, /pre-commit hook exited 1/);
  assert.doesNotMatch(hookText, /format/i, 'a hook refusal is told to format its files');
  // A run recorded before reasons were kept still names the old cause rather than nothing.
  assert.match(chain.pendingClusterLines([{ id: 3, groups: ['G-3'], pending_retry: true }]).join('\n'), /refused by git or a hook/);
  const src = SRC('scripts/remediate.mjs');
  const branch = src.slice(src.indexOf('if (pending.length) {'), src.indexOf('if (unrecorded.length) {'));
  assert.match(branch, /pendingClusterLines\(pending\)/, 'remediate.mjs does not announce pending clusters through the rule');
  assert.doesNotMatch(branch, /refused by git or a hook/, 'remediate.mjs still hard-codes the cause of every pending cluster');
});

// G-1 of review 20261017-212703-fmt-remediation-2-review: with a passing baseline, every fmt_check reason got the "passed
// before the node ran" sentinel, "not run: the build barrier failed first" and "timed out" included, and the pending
// message read that sentinel as a formatter failure and told the operator to format the files and retry, which a broken
// build or a timeout refuses again. Those still refuse; only a formatter that ran and exited non-zero is the node's file.
test('G-1 (fmt-remediation-2): a fmt_check that did not run or timed out refuses without being called a formatter failure', () => {
  const base = { fmt_check: { exit_code: 0 } };
  for (const ran of [{}, { fmt_check: RAN({ exit_code: null, timed_out: true }) }]) {
    const v = fullCheckVerdict({ declared: ['fmt_check'], ran, baseline: base });
    assert.equal(v.commit, false, JSON.stringify(ran));
    assert.deepEqual(v.refusals.map((r) => r.key), ['fmt_check']);
    assert.doesNotMatch(v.refusals[0].why, /passed before the node ran/, `${v.refusals[0].why}: called a formatter failure`);
    assert.notEqual(v.refusals[0].turned_red, true, 'a check that never reported is flagged as turned red');
  }
  const red = fullCheckVerdict({ declared: ['fmt_check'], ran: { fmt_check: RAN({ exit_code: 1 }) }, baseline: base }).refusals[0];
  assert.equal(red.turned_red, true, 'a formatter that ran and failed is not flagged as turned red');
  assert.match(red.why, /passed before the node ran/);
});

// G-3 of the same review: the pending message rebuilt "the formatter turned red" by parsing the free-form reason for a
// check name and a prose sentinel, so the producer and the reader jointly owned a rule a wording change could break. It is
// a field now: the full check's refusal carries it, the runner records it on the cluster, and the message reads only it.
test('G-3 (fmt-remediation-2): the format remedy is read from a recorded field, not from the reason text', async () => {
  const chain = await import('../scripts/lib/remediation-chain.mjs');
  const { FMT_TURNED_RED } = await import('../scripts/lib/full-check.mjs');
  const prose = { id: 1, groups: ['G-1'], accepted: ['scripts/a.mjs'], pending_retry: true,
    reason: `not committed: the full check refused the candidate: fmt_check timed out; ${FMT_TURNED_RED}` };
  assert.doesNotMatch(chain.pendingClusterLines([prose]).join('\n'), /format scripts/, 'the remedy is still inferred from the reason text');
  assert.match(chain.pendingClusterLines([{ ...prose, reason: 'anything', fmt_turned_red: true }]).join('\n'), /format scripts\/a\.mjs/);
  const src = SRC('scripts/remediate.mjs');
  assert.match(src, /fmt_turned_red: verdict\.refusals\.some\(\(r\) => r\.turned_red\)/, 'the full check refusal does not carry the field');
  assert.equal((src.match(/fmt_turned_red = true/g) ?? []).length, 2, 'the first run and the retry do not both record it on the cluster');
});

// G-12 of the same review: the contract row said a cluster "still refused by git or a hook stays pending", but the runner's
// full check and a tree that is not the candidate are retryable too.
test('G-12 (fmt-remediation-2): the owning documents name every cause of a pending cluster', () => {
  const doc = SRC('shared/claude-md-contract.md');
  assert.doesNotMatch(doc, /a cluster still refused by git or a hook stays pending/, 'the contract still names only git or a hook');
  assert.match(doc, /stays pending[^.]*full check/, 'the contract does not name the full check as a cause of a pending cluster');
  assert.doesNotMatch(SRC('scripts/remediate.mjs'), /none was refused by git or a hook/, 'the retry refusal still names only git or a hook');
});

// G-1 and G-8 of review 20261017-215958-fmt-remediation-3-review: capture maps every spawnSync status null to exit 124 (a
// spawn failure and an output overflow as well as its own timeout) and wrote only the timeout into the log. So a formatter
// that never started read as one that ran and failed: on the candidate it was flagged turned red and the operator told to
// format the files, and as the baseline it was recorded as a formatter's exit nobody could tell from a real one.
test('G-1, G-8 (fmt-remediation-3): capture writes a command that did not run to completion into its header', () => {
  const { base, dir } = repoRunDir({ runId: 'capture-error', prefix: 'quorate-caperr-',
    json: { contract: { commands: { fmt_check: 'quorate-no-such-formatter-7f3a' } } } });
  try {
    const r = runScript('capture.mjs', ['--run-dir', dir, '--node', 't', '--name', 'missing', '--', 'quorate-no-such-formatter-7f3a']);
    const log = r.stdout.trim();
    assert.ok(log, r.stderr);
    const h = parseCaptureHeader(fs.readFileSync(path.join(dir, log), 'utf8'));
    assert.equal(h.exit, 124);
    assert.equal(h.timed_out, false);
    assert.equal(h.error, 'ENOENT', 'a command that could not start is not marked in the log');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('G-1 (fmt-remediation-3): a fmt_check whose capture failed refuses without being called a formatter failure', () => {
  const base = { fmt_check: { exit_code: 0, evidence_path: 'evidence/remediation-runner/fmt_check.log' } };
  for (const ran of [{ fmt_check: RAN({ exit_code: 124, capture_error: 'ENOENT' }) }, { fmt_check: RAN({ exit_code: 124, capture_error: 'ENOBUFS' }) },
    { fmt_check: RAN({ exit_code: null, evidence_path: null }) }]) {
    const v = fullCheckVerdict({ declared: ['fmt_check'], ran, baseline: base });
    assert.equal(v.commit, false, JSON.stringify(ran));
    assert.deepEqual(v.refusals.map((r) => r.key), ['fmt_check']);
    assert.doesNotMatch(v.refusals[0].why, /passed before the node ran/, `${v.refusals[0].why}: called a formatter failure`);
    assert.notEqual(v.refusals[0].turned_red, true, `${JSON.stringify(ran)}: a formatter that never ran is flagged as turned red`);
  }
});

// G-8 and G-5 of the same review: the request keeps a baseline that could not be run, or none, on the stamp path (AC2), but
// the run recorded a failed baseline capture as a formatter's exit, and a missing baseline defaulted to {} in silence. Both
// still stamp; the record and the stamp now say which it was.
test('G-8, G-5 (fmt-remediation-3): a baseline that did not run, or none, still stamps and the stamp says so', () => {
  const red = { fmt_check: RAN({ exit_code: 1 }) };
  const cases = [
    [{ fmt_check: { exit_code: 124, evidence_path: 'e.log', capture_error: 'ENOENT' } }, /baseline did not run/],
    [{ fmt_check: { exit_code: 124, evidence_path: 'e.log', timed_out: true } }, /baseline did not run/],
    [{ fmt_check: null }, /baseline did not run/],
    [undefined, /no baseline was recorded/],
  ];
  for (const [baseline, says] of cases) {
    const v = fullCheckVerdict({ declared: ['fmt_check'], ran: red, baseline });
    assert.equal(v.commit, true, JSON.stringify(baseline));
    assert.deepEqual(v.stamps.map((s) => s.key), ['fmt_check']);
    assert.match(v.stamps[0].why, says, `${JSON.stringify(baseline)}: ${v.stamps[0].why}`);
  }
  // A baseline whose formatter ran and failed is formatting debt, and says nothing about the baseline.
  const debt = fullCheckVerdict({ declared: ['fmt_check'], ran: red, baseline: { fmt_check: { exit_code: 1, evidence_path: 'e.log' } } });
  assert.doesNotMatch(debt.stamps[0].why, /baseline did not run|no baseline/);
  const src = SRC('scripts/remediate.mjs');
  assert.match(src, /fmt_baseline: \{ fmt_check: r \? \{[^}]*capture_error/, 'the recorded baseline cannot tell a capture failure from a formatter exit');
  assert.doesNotMatch(src, /fmt_baseline \?\? \{\}/, 'a missing baseline is still replaced with {} in silence');
});
