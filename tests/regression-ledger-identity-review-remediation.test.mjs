// Remediation of review 20261013-000416-ledger-identity-review (gate FAIL, 9 confirmed), judged against
// .claude/requests/ledger-identity.plan.md. Each test names the group it exists for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { markFixed, mergeRun } from '../scripts/lib/ledger.mjs';
import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
const F = 'scripts/io/snapshot.mjs';
const KEY = `${F}:90`;
const at = (run) => { const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(run); return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`; };
const S = (run, gid, line, severity, extra = {}) => ({ run_id: run, group_id: gid, file: F, line, severity, decision: 'confirmed', claim: `${gid} of ${run}`, nodes: ['code-audit'], ...extra });
const fold = (ledger, run, sightings) => mergeRun(ledger, { run_id: run, at: at(run), sightings, surface: ['scripts'], reviewed: true, okNodes: new Set(['code-audit']) });
const empty = () => ({ schema_version: 1, runs_folded: [], entries: {} });
const declined = () => ({ schema_version: 1, runs_folded: ['20261003-000000-decl'], entries: { [KEY]: {
  key: KEY, file: F, line: 94, severity: 'MEDIUM', status: 'declined', decided_by: 'operator', declined_severity: 'MEDIUM',
  decided_at: '2026-10-03T12:00:00Z', operator_quote: 'keep it', first_seen: '20261001-000000-a', last_seen: '20261003-000000-decl',
  times_seen: 3, claim: 'the declined defect', nodes: ['code-audit'] } } });

// ---------------------------------------------------------------------------------------------- G-14 (G-21)

test('G-14: re-folding an OLDER run already in sightings[] changes nothing, though a newer run is last_seen', () => {
  const r1 = '20261012-100000-one', r2 = '20261012-110000-two';
  const once = fold(empty(), r1, [S(r1, 'G-1', 95, 'MEDIUM')]).ledger;
  const twice = fold(once, r2, [S(r2, 'G-4', 95, 'MEDIUM')]).ledger;
  assert.deepEqual(fold(twice, r1, [S(r1, 'G-1', 95, 'MEDIUM')]).ledger.entries, twice.entries,
    'a true re-fold (I-14): times_seen, last_seen, claims and sightings must not move');
});

test('G-14: re-folding an older run on a decline raised again neither counts it again nor moves last_seen', () => {
  const r1 = '20261012-100000-hit', r2 = '20261012-120000-hit2';
  const a = fold(declined(), r1, [S(r1, 'G-1', 95, 'LOW')]).ledger;
  const b = fold(a, r2, [S(r2, 'G-2', 95, 'LOW')]).ledger;
  assert.deepEqual(fold(b, r1, [S(r1, 'G-1', 95, 'LOW')]).ledger.entries, b.entries);
});

// ---------------------------------------------------------------------------------------------- G-11

test('G-11: on an empty ledger the entries a run creates do not depend on the order its groups arrive in', () => {
  const run = '20261012-130000-order';
  const gs = [S(run, 'G-1', 19, 'MEDIUM'), S(run, 'G-2', 9, 'MEDIUM'), S(run, 'G-3', 1, 'MEDIUM')];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const shape = (l) => Object.fromEntries(Object.entries(l.entries).map(([k, e]) => [k, [e.line, e.sightings.map((s) => s.group_ids)]]));
  const first = shape(fold(empty(), run, perms[0].map((i) => gs[i])).ledger);
  for (const p of perms.slice(1)) assert.deepEqual(shape(fold(empty(), run, p.map((i) => gs[i])).ledger), first, `order ${p}`);
});

// ---------------------------------------------------------------------------------------------- CLI fixtures

const member = (node_id, severity) => ({ node_id, severity, claim: `${node_id} says ${severity}` });
const group = (group_id, file, line, findings) => ({ group_id, file, line, findings });
const row = (group_id, decision, severity) => ({ group_id, decision, severity });
function runFixture(root, runId, { groups = [], rows = null } = {}) {
  const dir = path.join(root, runId);
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: runId, scope: { paths: ['scripts'] } }));
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  fs.writeFileSync(path.join(dir, 'finding-groups.json'), JSON.stringify({ run_id: runId, groups }));
  if (rows) {
    fs.mkdirSync(path.join(dir, 'evidence', 'reconcile'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ run_id: runId, groups: rows }));
  }
  return dir;
}
const tmp = (t, prefix) => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const HIGH_RUN = '20261012-054024-test-cost-review';
const migLedger = () => ({ ...declined(), runs_folded: ['20261003-000000-decl', HIGH_RUN] });

// A repository whose ledger is in the tree and whose runs are STAGED under quorate's home, as an unconfigured
// repository's are: the ledger and its runs are not siblings.
function stagedRepo(t) {
  const repo = tmp(t, 'q-lir-repo-');
  const home = tmp(t, 'q-lir-home-');
  const ledgerPath = path.join(repo, '.claude', 'reviews', 'ledger.json');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const staged = defaultReviewsRoot({ project: null, repoRoot: repo, home });
  fs.mkdirSync(staged, { recursive: true });
  const env = { ...process.env, QUORATE_HOME: home };
  const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: repo, env });
  return { repo, home, ledgerPath, staged, cli };
}

// ---------------------------------------------------------------------------------------------- G-4

test('G-4: --migrate-identity finds a folded run where the repository\'s runs live, not only beside the ledger', (t) => {
  const { ledgerPath, staged, cli } = stagedRepo(t);
  fs.writeFileSync(ledgerPath, JSON.stringify(migLedger()));
  runFixture(staged, HIGH_RUN, { groups: [group('G-1', F, 102, [member('panel-codex-code', 'MEDIUM')])], rows: [row('G-1', 'confirmed', 'HIGH')] });
  const r = cli(['--migrate-identity', '--ledger', ledgerPath]);
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(path.join(path.dirname(path.dirname(ledgerPath)), 'requests', 'ledger-identity.migration-report.md'), 'utf8');
  assert.doesNotMatch(md, new RegExp(`${HIGH_RUN} — its directory is gone`), 'the staged run was reported gone');
  assert.match(md, /RISE MEDIUM -> HIGH — 20261012-054024-test-cost-review G-1/, 'the 2026-10-12 HIGH is missed');
});

test('G-4: a runs_folded id that is not a run id is not joined into a path', (t) => {
  const { ledgerPath, cli } = stagedRepo(t);
  const l = migLedger();
  l.runs_folded.push('20261011-000000-x/../../outside');
  fs.writeFileSync(ledgerPath, JSON.stringify(l));
  const r = cli(['--migrate-identity', '--ledger', ledgerPath]);
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(path.join(path.dirname(path.dirname(ledgerPath)), 'requests', 'ledger-identity.migration-report.md'), 'utf8');
  assert.match(md, /20261011-000000-x\/\.\.\/\.\.\/outside \(not a run id\)/);
});

// ---------------------------------------------------------------------------------------------- G-2

test('G-2: --summary names an unfolded run staged under quorate\'s home, not only the ledger\'s siblings', (t) => {
  const { ledgerPath, staged, cli } = stagedRepo(t);
  fs.writeFileSync(ledgerPath, JSON.stringify(empty()));
  runFixture(staged, '20261012-090000-unfolded');
  const r = cli(['--summary', '--ledger', ledgerPath]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /WARNING: 1 run\(s\)[^]*20261012-090000-unfolded/, 'an unfolded staged run was not counted, so DRAINED could be reported over it');
});

// ---------------------------------------------------------------------------------------------- G-5

test('G-5: a report that cannot be written leaves the ledger unmigrated, so the migration can be run again', (t) => {
  const d = tmp(t, 'q-lir5-');
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(migLedger()));
  fs.writeFileSync(path.join(d, 'a-file'), 'not a directory');
  const r = spawnSync(process.execPath, [CLI, '--migrate-identity', '--ledger', ledgerPath, '--report', path.join(d, 'a-file', 'report.md')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).identity_migrated_at, undefined, 'migrated with no report, and a retry is refused');
});

// ---------------------------------------------------------------------------------------------- G-6

test('G-6: --report may not be the ledger, nor outside the ledger\'s folder and the requests folder beside it', (t) => {
  const { repo, ledgerPath, cli } = stagedRepo(t);
  const elsewhere = tmp(t, 'q-lir6-out-');
  for (const report of [ledgerPath, path.join(elsewhere, 'report.md'), path.join(repo, 'docs', 'report.md')]) {
    fs.writeFileSync(ledgerPath, JSON.stringify(migLedger()));
    const r = cli(['--migrate-identity', '--ledger', ledgerPath, '--report', report]);
    assert.notEqual(r.status, 0, `${report} was accepted`);
    const l = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    assert.equal(l.identity_migrated_at, undefined, `${report}: the ledger was migrated`);
    assert.ok(!fs.existsSync(path.join(elsewhere, 'report.md')));
  }
  fs.writeFileSync(ledgerPath, JSON.stringify(migLedger()));
  const ok = cli(['--migrate-identity', '--ledger', ledgerPath]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(fs.existsSync(path.join(repo, '.claude', 'requests', 'ledger-identity.migration-report.md')), 'the default is the plan\'s path');
});

// ---------------------------------------------------------------------------------------------- G-3

test('G-3: --summary --stale says "raised again at Y" for a rise too, adding "came back worse"', (t) => {
  const run = '20261012-100000-rise';
  const { ledger } = fold(declined(), run, [S(run, 'G-1', 95, 'HIGH')]);
  const d = tmp(t, 'q-lir3-');
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  const r = spawnSync(process.execPath, [CLI, '--summary', '--stale', '--ledger', ledgerPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const section = r.stdout.split('declined, but raised again')[1] ?? '';
  assert.match(section, /declined at MEDIUM, raised again at HIGH, came back worse/);
});

// ---------------------------------------------------------------------------------------------- G-17

test('G-17: every refusal on a decline raised again says "a decline that was raised again" (I-11)', () => {
  const run = '20261012-100000-again';
  const { ledger } = fold(declined(), run, [S(run, 'G-1', 95, 'LOW')]);
  assert.equal(ledger.entries[KEY].raised_again, true, 'the fixture must be a decline raised again');
  const cases = [['fixed_claimed', {}], ['partial', {}], ['open', { reason: 'defer' }], ['open', { reason: 'keep', operator_quote: 'keep' }],
    ['declined', { reason: 'propose' }]];
  for (const [disposition, extra] of cases) {
    const { refused } = markFixed(ledger, [KEY], '20261012-110000-act', { disposition, at: '2026-10-12T11:00:00Z', ...extra });
    assert.equal(refused.length, 1, `${disposition} ${JSON.stringify(extra)} must be refused`);
    assert.match(refused[0].why, /a decline that was raised again/, `${disposition} ${JSON.stringify(extra)}`);
  }
});
