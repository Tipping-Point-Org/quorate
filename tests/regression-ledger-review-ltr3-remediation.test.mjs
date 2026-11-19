// Remediation of review 20260928-032057-ltr-review-r3 (operator: "1 yes, 2 fix, 3 ledger, go").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeRun, addObservation, redactClaim } from '../scripts/lib/ledger.mjs';

const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });

// A throwaway repository with a run directory inside its own .claude/reviews/.
function repoWithRun(t, runJson) {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ltr3-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  git(d, 'init', '-q');
  const run = path.join(d, '.claude', 'reviews', '20260928-000000-x');
  fs.mkdirSync(path.join(run, 'nodes'), { recursive: true });
  if (runJson !== undefined) fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify(runJson));
  // The barrier's grouping, empty: the fold reads it (ledger-identity, stage 5), and a run that grouped nothing is silence.
  fs.writeFileSync(path.join(run, 'finding-groups.json'), JSON.stringify({ groups: [] }));
  return { d, run };
}

test('G-3: a run inside this repository\'s own reviews folder folds even with no repo_root in run.json', (t) => {
  const { d, run } = repoWithRun(t, { run_id: '20260928-000000-x' });
  const r = spawnSync(process.execPath, [CLI, '--run-dir', run], { encoding: 'utf8', cwd: d });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(d, '.claude', 'reviews', 'ledger.json')));
});

test('G-3: a run that is not inside the repository is refused, and the message says what is missing', (t) => {
  const { d } = repoWithRun(t, undefined);
  const elsewhere = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ltr3-out-')));
  t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  fs.writeFileSync(path.join(elsewhere, 'run.json'), JSON.stringify({ run_id: 'x' }));
  const r = spawnSync(process.execPath, [CLI, '--run-dir', elsewhere], { encoding: 'utf8', cwd: d });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stderr, /does not exist/, 'run.json exists; the message said it did not');
  // Refused at containment now, the first of admitRun's checks (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
  assert.match(r.stderr, /is neither inside the repository under review/);
});

test('G-2: a link inside the reviews folder that leads outside does not pass the containment check', (t) => {
  const { d } = repoWithRun(t, undefined);
  const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ltr3-link-')));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'run.json'), JSON.stringify({ run_id: 'x', repo_root: d }));
  fs.mkdirSync(path.join(outside, 'nodes'));
  const link = path.join(d, '.claude', 'reviews', 'linked-run');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  const r = spawnSync(process.execPath, [CLI, '--run-dir', link], { encoding: 'utf8', cwd: d });
  assert.notEqual(r.status, 0, 'a junction under the reviews folder passed as a run of this repository');
  // Refused at containment now, the first of admitRun's checks (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
  assert.match(r.stderr, /is neither inside the repository under review .* or it leaves one through a link/);
});

test('G-9: an OK node status with no findings_count stops the fold, as an unreadable one does', (t) => {
  const { d, run } = repoWithRun(t, { run_id: '20260928-000000-x', repo_root: undefined });
  fs.writeFileSync(path.join(run, 'nodes', 'code-audit.status.json'), JSON.stringify({ state: 'OK' }));
  const r = spawnSync(process.execPath, [CLI, '--run-dir', run, '--ledger', path.join(d, 'l.json')], { encoding: 'utf8', cwd: d });
  assert.notEqual(r.status, 0, 'an uncountable node was counted as zero expected findings');
  assert.match(r.stderr, /findings_count/);
});

// MOVED TO THE RECONCILE PAYLOAD (ledger-identity, stage 5): the fold reads what the barrier decided, not the kept
// verdicts, so the artifact that must not read as "contributed nothing" is the payload.
test('G-9: an unreadable reconcile payload stops the fold instead of contributing nothing', (t) => {
  // run_id is the directory's name: an admitted run is the run its run.json names (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
  const { d, run } = repoWithRun(t, { run_id: '20260928-000000-x' });
  fs.writeFileSync(path.join(run, 'finding-groups.json'), JSON.stringify({ groups: [{ group_id: 'G-1', file: 'a.mjs', line: 1, findings: [] }] }));
  fs.mkdirSync(path.join(run, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(run, 'evidence', 'reconcile', 'payload.json'), '{ not json');
  const r = spawnSync(process.execPath, [CLI, '--run-dir', run, '--ledger', path.join(d, 'l.json')], { encoding: 'utf8', cwd: d });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /payload\.json is not valid JSON/);
});

test('G-12: secret-shaped text in a claim is redacted before it reaches the tracked ledger', () => {
  const aws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const gh = 'ghp_' + 'a'.repeat(36);
  const pw = ['password', 'hunter2secret'].join('='); // built at runtime, as aws and gh are (.gitleaksignore's convention)
  const claim = `leaks ${aws} and ${gh} and ${pw} into the log`;
  const { ledger } = mergeRun(null, { run_id: '20260928-000000-r', at: 'T', findings: [{ file: 'a.mjs', line: 1, severity: 'HIGH', claim, node: 'security-audit' }] });
  const stored = Object.values(ledger.entries)[0].claim;
  assert.doesNotMatch(stored, new RegExp(aws));
  assert.doesNotMatch(stored, new RegExp(gh));
  assert.doesNotMatch(stored, /hunter2secret/);
  assert.match(stored, /\[redacted/);
  const obs = addObservation(null, { file: 'b.mjs', line: 1, claim: `token ${gh}`, at: 'T' });
  assert.doesNotMatch(Object.values(obs.entries)[0].claim, new RegExp(gh));
  assert.equal(redactClaim('an ordinary sentence about line 42'), 'an ordinary sentence about line 42');
});
