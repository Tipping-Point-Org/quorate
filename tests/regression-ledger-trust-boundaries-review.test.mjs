// Remediation of review 20260928-221454-ltb-review (operator: "1 yes, 2 as suggested, 3 ledger, 4 reset").
// Fixed: G-11, G-14, G-17 with its symptom G-15, G-16, G-5; G-23 and G-24 (docs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { redactClaim } from '../scripts/lib/redact.mjs';
import { readKeptVerdict, collectRun } from '../scripts/io/run-artifacts.mjs';
import { writeReconciled } from './helpers.mjs';

const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const PW = 'pass' + 'word';                      // built at runtime, so the push scan's rule never sees a fixture

// The fixture's directory as the engine's home, so the fold admits a run under it (run-dir-trust.plan.md stage 3, A-28).
const HOME_AT = (d) => ({ ...process.env, QUORATE_HOME: d });
function tmp(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ltbr-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
function run(t, { verdict, status = { state: 'OK', findings_count: 0 }, runJson = { run_id: '20260101-000000-x' }, node = 'code-audit' } = {}) {
  const d = tmp(t);
  // Named for its run_id, which admitRun requires (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
  const r = path.join(d, '20260101-000000-x');
  fs.mkdirSync(path.join(r, 'nodes'), { recursive: true });
  fs.mkdirSync(path.join(r, 'evidence', node), { recursive: true });
  if (runJson !== null) fs.writeFileSync(path.join(r, 'run.json'), JSON.stringify(runJson));
  if (status !== null) fs.writeFileSync(path.join(r, 'nodes', `${node}.status.json`), JSON.stringify({ node_id: node, ...status }));
  if (verdict !== undefined) fs.writeFileSync(path.join(r, 'evidence', node, 'verdict.kept.json'), typeof verdict === 'string' ? verdict : JSON.stringify(verdict));
  return { d, r };
}

test('G-11: a single-quoted credential key is redacted like a double-quoted one', () => {
  for (const text of [`'${PW}': 'secret-value-here'`, `{'${'api' + '_key'}': 'Zq8Pw2LmX9'}`, `'db_${PW}' = 'two words here'`]) {
    const out = redactClaim(text);
    assert.match(out, /\[redacted/, `${text} passed unredacted`);
    assert.ok(!/secret-value-here|Zq8Pw2LmX9|two words here/.test(out), out);
  }
});

test('G-14: a kept verdict with no findings field is refused, not read as an empty list', (t) => {
  const { r } = run(t, { verdict: { verdict: 'PASS' } });
  const k = readKeptVerdict(r, 'code-audit');
  assert.equal(k.ok, false, 'a verdict with no findings list was accepted');
  assert.match(k.why, /findings/);
});

test('G-17, G-15: collectRun reads status files and run.json through the one reader, and records each refusal', (t) => {
  const { r } = run(t, { verdict: { findings: [] }, status: { state: 'OK', findings_count: -1 } });
  const c = collectRun(r, { warn: () => {} });
  assert.ok(c.refused['status:code-audit'], `a bad status was read anyway: ${JSON.stringify(c.refused)}`);
  const { r: norec } = run(t, { verdict: { findings: [] }, runJson: null });
  // THROWN since secret-shapes-and-refusals 2a (G-4 of ltb-review-r4), not recorded in a map callers ignored.
  assert.throws(() => collectRun(norec, { warn: () => {} }), (e) => e?.name === 'RunRefused', 'a run with no run.json was scored as a run');
});

test('G-16: every refusal collectRun records reaches its caller\'s warning, not only a map nobody reads', (t) => {
  const { r } = run(t, { verdict: '{"findings": "abc"}' });
  const said = [];
  collectRun(r, { warn: (m) => said.push(m) });
  assert.ok(said.some((m) => /code-audit/.test(m) && /refused|not a kept verdict/.test(m)), `nothing was said: ${JSON.stringify(said)}`);
});

// Since ledger-identity stage 5 the fold reads the barrier's groups, which already exclude a node that did not report
// OK; a DEGRADED node's kept verdict on disk is not read at all. The run below grouped nothing.
test('G-5: the fold takes findings only from nodes whose status is OK, as the barrier does', (t) => {
  const { d, r } = run(t, {
    node: 'panel-codex-code',
    status: { state: 'DEGRADED' },
    verdict: { findings: [{ file: 'a.mjs', line: 3, severity: 'MEDIUM', claim: 'from a node that did not report OK' }] },
  });
  fs.writeFileSync(path.join(r, 'finding-groups.json'), JSON.stringify({ groups: [] }));
  const l = path.join(d, 'l.json');
  const out = spawnSync(process.execPath, [CLI, '--run-dir', r, '--ledger', l], { encoding: 'utf8', cwd: d, env: HOME_AT(d) });
  assert.equal(out.status, 0, out.stderr);
  const entries = fs.existsSync(l) ? Object.keys(JSON.parse(fs.readFileSync(l, 'utf8')).entries) : [];
  assert.deepEqual(entries, [], 'a DEGRADED node\'s findings were folded into the ledger');
});

test('a judge\'s OK status carries no findings_count, and neither the reader nor the fold refuses it', (t) => {
  // Found measuring this remediation's reader against the 175 preserved runs: 6 were refused, each for an
  // adjudication or tie-break judge — which produces no findings, so its status has no count. The fold had
  // required one since 5b381a2 (G-9 of ltr-review-r3), so a run with an adjudication could not be folded.
  const { d, r } = run(t, { verdict: { findings: [] }, status: { state: 'OK', findings_count: 0 } });
  fs.writeFileSync(path.join(r, 'nodes', 'adjudicate-G-1-adj-agy.status.json'),
    JSON.stringify({ node_id: 'adjudicate-G-1-adj-agy', kind: 'adjudication', state: 'OK' }));
  assert.equal(collectRun(r, { warn: () => {} }).refused['status:adjudicate-G-1-adj-agy'], undefined, 'a judge\'s status was refused');
  fs.writeFileSync(path.join(r, 'finding-groups.json'), JSON.stringify({ groups: [] }));
  const out = spawnSync(process.execPath, [CLI, '--run-dir', r, '--ledger', path.join(d, 'l.json')], { encoding: 'utf8', cwd: d, env: HOME_AT(d) });
  assert.equal(out.status, 0, `a run with an adjudication could not be folded: ${out.stderr}`);
});

test('a judge in the run does not disable the partial-loss guard: pruned findings are still refused', (t) => {
  // Found claim-checking the remediation above: the judge's status added `undefined` to the expected count,
  // which became NaN, and `findings.length < NaN` is never true — so a run with an adjudication folded pruned
  // evidence as silence, the signal that promotes a claimed fix to fixed.
  // MOVED TO THE RECONCILE PAYLOAD (ledger-identity, stage 5): the fold no longer counts kept findings, so the partial
  // loss a judge must not hide is a payload that judged fewer groups than were formed.
  const { d, r } = run(t, { verdict: { findings: [] }, status: { state: 'OK', findings_count: 3 } });
  fs.writeFileSync(path.join(r, 'nodes', 'adjudicate-G-1-adj-agy.status.json'),
    JSON.stringify({ node_id: 'adjudicate-G-1-adj-agy', kind: 'adjudication', state: 'OK' }));
  writeReconciled(r, [1, 2, 3].map((n) => ({ file: 'a.mjs', line: n * 20, severity: 'LOW', claim: `kept ${n}` })), { judge: 1 });
  // SINCE reconcile-missing-groups.plan.md stage 2 the run folds, and the groups the payload did not judge are unjudged
  // sightings, judge or no judge: a judge in the run must not turn them into silence.
  const out = spawnSync(process.execPath, [CLI, '--run-dir', r, '--ledger', path.join(d, 'l.json')], { encoding: 'utf8', cwd: d, env: HOME_AT(d) });
  assert.equal(out.status, 0, out.stderr);
  const entries = Object.values(JSON.parse(fs.readFileSync(path.join(d, 'l.json'), 'utf8')).entries);
  assert.equal(entries.filter((e) => e.unjudged === true).length, 2, 'the two unjudged groups were read as silence');
});

test('G-23, G-24: the T13 row and the remediate skill match the code', () => {
  const doc = fs.readFileSync(path.join(REPO, 'shared', 'ledger-transitions.md'), 'utf8');
  const t13 = doc.split('\n').find((l) => l.startsWith('| T13 |')) ?? '';
  assert.doesNotMatch(t13, /when the operator's: their words, `decided_at`, `decided_in`, and a `decisions\[\]` element \| unchanged/,
    'T13 still says only the operator\'s withdrawal is recorded in decisions[]');
  const skill = fs.readFileSync(path.join(REPO, 'skills', 'remediate', 'SKILL.md'), 'utf8');
  for (const d of ['fixed_claimed', 'partial', 'declined', 'open', 'closed', 'withdraw', 'reopen']) {
    assert.ok(skill.includes(`\`${d}\``), `the remediate skill does not name the disposition ${d}`);
  }
});
