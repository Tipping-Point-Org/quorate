// Remediation of review 20260928-162609-ltr-review-r4 (operator: "1 A, 2 fix, 3 fix, 4 fix"; item 4 = all 11 LOWs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeRun, markFixed, addObservation } from '../scripts/lib/ledger.mjs';

const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
const GH = 'ghp_' + 'b'.repeat(36);

function tmp(t, prefix = 'q-ltr4-') {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

// A run directory with one node whose kept verdict is `verdict` (raw text).
function runWithVerdict(t, verdictText, status = { state: 'OK', findings_count: 0 }) {
  const d = tmp(t);
  // Named for its run_id: an admitted run is the run its run.json names (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
  const run = path.join(d, '20260928-000000-x');
  fs.mkdirSync(path.join(run, 'evidence', 'code-audit'), { recursive: true });
  fs.mkdirSync(path.join(run, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: '20260928-000000-x' }));
  fs.writeFileSync(path.join(run, 'nodes', 'code-audit.status.json'), JSON.stringify(status));
  if (verdictText !== null) fs.writeFileSync(path.join(run, 'evidence', 'code-audit', 'verdict.kept.json'), verdictText);
  return { d, run };
}
// `d` is the engine's home for the fold, so containment admits a run under it (run-dir-trust.plan.md stage 3, A-28).
const fold = (d, run) => spawnSync(process.execPath, [CLI, '--run-dir', run, '--ledger', path.join(d, 'l.json')],
  { encoding: 'utf8', cwd: d, env: { ...process.env, QUORATE_HOME: d } });

// MOVED TO THE RECONCILE ARTIFACTS (ledger-identity, stage 5): the fold reads finding-groups.json and the payload, not
// the kept verdicts, so the malformed shapes that must be refused rather than read as "no findings" are theirs now.
const ONE_GROUP = JSON.stringify({ groups: [{ group_id: 'G-1', file: 'a.mjs', line: 1, findings: [] }] });
function runWithArtifacts(t, groupsText, payloadText = null) {
  const { d, run } = runWithVerdict(t, null);
  fs.writeFileSync(path.join(run, 'finding-groups.json'), groupsText);
  if (payloadText !== null) {
    fs.mkdirSync(path.join(run, 'evidence', 'reconcile'), { recursive: true });
    fs.writeFileSync(path.join(run, 'evidence', 'reconcile', 'payload.json'), payloadText);
  }
  return { d, run };
}

test('G-8: a reconcile payload that parses to null is refused by name, not crashed on', (t) => {
  const { d, run } = runWithArtifacts(t, ONE_GROUP, 'null');
  const r = fold(d, run);
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stderr, /TypeError/, 'the fold crashed with a stack trace instead of refusing');
  assert.match(r.stderr, /payload\.json is not an object holding a list of groups/);
});

test('G-8: finding-groups whose groups is a string is refused, never folded character by character', (t) => {
  const { d, run } = runWithArtifacts(t, JSON.stringify({ groups: 'abc' }));
  const r = fold(d, run);
  assert.notEqual(r.status, 0, 'a string of groups was folded as entries');
  assert.match(r.stderr, /finding-groups\.json is not an object holding a list of groups/);
  assert.ok(!fs.existsSync(path.join(d, 'l.json')), 'the ledger was written');
});

test('G-8: finding-groups that is a top-level list is refused, not read as zero groups', (t) => {
  const { d, run } = runWithArtifacts(t, JSON.stringify([{ group_id: 'G-1', file: 'a.mjs', line: 1 }]));
  const r = fold(d, run);
  assert.notEqual(r.status, 0, 'an array was folded as a run with no groups');
  assert.match(r.stderr, /finding-groups\.json is not an object holding a list of groups/);
});

test('G-9: a negative or fractional findings_count stops the fold', (t) => {
  for (const n of [-1, 1.5]) {
    const { d, run } = runWithVerdict(t, null, { state: 'OK', findings_count: n });
    const r = fold(d, run);
    assert.notEqual(r.status, 0, `findings_count ${n} was accepted`);
    assert.match(r.stderr, /findings_count/);
  }
});

test('G-3: a directory in the reviews folder with no run.json at all is refused', (t) => {
  const d = tmp(t);
  git(d, 'init', '-q');
  const run = path.join(d, '.claude', 'reviews', '20260928-000000-partial');
  fs.mkdirSync(path.join(run, 'nodes'), { recursive: true });
  const r = spawnSync(process.execPath, [CLI, '--run-dir', run], { encoding: 'utf8', cwd: d });
  assert.notEqual(r.status, 0, 'a directory with no run record was folded');
  assert.match(r.stderr, /run\.json/);
});

test('G-7: --add never prints the secret it redacted from the ledger', (t) => {
  const d = tmp(t);
  const r = spawnSync(process.execPath, [CLI, '--add', '--file', 'a.mjs', '--line', '3', '--claim', `leaks ${GH} to the log`,
    '--ledger', path.join(d, 'l.json')], { encoding: 'utf8', cwd: d });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, new RegExp(GH), 'the unredacted claim was echoed');
  assert.match(r.stdout, /\[redacted/);
});

test('G-13: a disposition\'s reason and the operator\'s quote are redacted in the entry and in decisions[]', () => {
  const { ledger } = mergeRun(null, { run_id: '20260928-000000-r', at: 'T', findings: [{ file: 'a.mjs', line: 1, severity: 'LOW', claim: 'x', node: 'code-audit' }] });
  const key = Object.keys(ledger.entries)[0];
  const out = markFixed(ledger, [key], 'r2', { disposition: 'declined', reason: `the token ${GH} is a test fixture`, operator_quote: `decline it, ${GH}`, at: 'T2' });
  const e = out.ledger.entries[key];
  const text = JSON.stringify(e);
  assert.doesNotMatch(text, new RegExp(GH), 'a secret reached the tracked ledger through a decision');
  assert.match(e.reason, /\[redacted/);
  assert.match(e.decisions.at(-1).quote, /\[redacted/);
});

// G-15's cap was REVERSED by the operator (2026-09-28: "1b, 2a, 3a+3b, 4a, G-3 fix" — 4a): r5's G-10 found it
// could drop a note on a closed entry before the operator had seen it. What this test pins now is the reversal:
// nothing is dropped, and the newest note is still there.
test('G-15, reversed (4a): observations on one entry are all kept, and none is counted as dropped', () => {
  let l = null;
  for (let i = 0; i < 60; i++) l = addObservation(l, { file: 'a.mjs', line: 1, claim: `note ${i}`, at: `T${String(i).padStart(2, '0')}` });
  const e = Object.values(l.entries)[0];
  assert.equal(e.observations.length, 60);
  assert.equal(e.observations_dropped, undefined);
  assert.equal(e.observations.at(-1).claim, 'note 59');
});

test('G-6: --summary refuses when the reviews folder cannot be read, instead of reporting nothing unfolded', (t) => {
  const d = tmp(t);
  fs.writeFileSync(path.join(d, 'not-a-dir'), 'x');
  const r = spawnSync(process.execPath, [CLI, '--summary', '--ledger', path.join(d, 'not-a-dir', 'ledger.json')], { encoding: 'utf8', cwd: d });
  assert.notEqual(r.status, 0, 'an unreadable reviews folder was read as holding no runs');
  assert.match(r.stderr, /ENOTDIR|not a directory|cannot be read/i);
});

test('G-5: the CLI declares no severity vocabulary of its own', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.doesNotMatch(src, /\[\s*'(LOW|BLOCKER)',\s*'(MEDIUM|HIGH)'/, 'a literal copy of SEVERITY_RUNGS is back');
});
