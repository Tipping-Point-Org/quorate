// Remediation of review 20261013-042240-ledger-identity-remediation-4-review (gate RISK), judged against
// .claude/requests/ledger-identity.plan.md. Each test names the group it exists for. G-7 was declined by the operator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repoOfLedger, standingDecisions, mergeRun } from '../scripts/lib/ledger.mjs';
import { repoRunRoots } from '../scripts/io/reviews-root.mjs';

const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
const SRC = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const tmp = (t, prefix) => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
function repoWithLedger(t) {
  const repo = tmp(t, 'q-lir4-repo-');
  const home = tmp(t, 'q-lir4-home-');
  const ledgerPath = path.join(repo, '.claude', 'reviews', 'ledger.json');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify({ schema_version: 1, runs_folded: [], entries: {} }));
  const env = { ...process.env, QUORATE_HOME: home };
  const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: repo, env });
  const migrated = () => JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).identity_migrated_at;
  const defaultReport = path.join(repo, '.claude', 'requests', 'ledger-identity.migration-report.md');
  return { repo, home, ledgerPath, cli, migrated, defaultReport };
}

// ---------------------------------------------------------------------------------------------- G-5

test('G-5: a report a failed attempt left at the default path does not block the retry the error message asks for', (t) => {
  const { ledgerPath, cli, migrated, defaultReport } = repoWithLedger(t);
  fs.mkdirSync(path.dirname(defaultReport), { recursive: true });
  fs.writeFileSync(defaultReport, '# ledger-identity migration report\n\nSTALE from the attempt whose save failed\n');
  const r = cli(['--migrate-identity', '--ledger', ledgerPath]);
  assert.equal(r.status, 0, `the retry died on the earlier attempt's report (EEXIST): ${r.stderr}`);
  assert.ok(migrated(), 'the ledger was not migrated');
  assert.doesNotMatch(fs.readFileSync(defaultReport, 'utf8'), /STALE/, 'the report is still the failed attempt\'s');
});

test('G-5: a file at the report path that is not a migration report is still refused, and the operator is told what to do', (t) => {
  const { ledgerPath, cli, migrated, defaultReport } = repoWithLedger(t);
  fs.mkdirSync(path.dirname(defaultReport), { recursive: true });
  fs.writeFileSync(defaultReport, 'KEEP');
  const r = cli(['--migrate-identity', '--ledger', ledgerPath]);
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(defaultReport, 'utf8'), 'KEEP');
  assert.match(r.stderr, /--report/, 'the refusal does not say how to get past it');
  assert.equal(migrated(), undefined);
});

// ---------------------------------------------------------------------------------------------- G-11

test('G-11: the T7 row says a re-fold is a run in runs_folded and applies nothing', () => {
  const row = SRC('shared/ledger-transitions.md').split('\n').find((l) => l.startsWith('| T7 |'));
  assert.ok(row, 'no T7 row');
  assert.match(row, /runs_folded/, 'T7 still identifies a re-fold through sightings[]/last_seen');
  assert.doesNotMatch(row, /severity \(raised only/, 'T7 still says a re-fold updates line, severity and nodes');
  assert.match(row, /applies nothing/);
});

// ---------------------------------------------------------------------------------------------- G-6

test('G-6: a ledger at a filesystem root belongs to the root, not to no repository or a drive-relative path', () => {
  assert.equal(repoOfLedger('/.claude/reviews/ledger.json'), '/');
  assert.equal(repoOfLedger('C:\\.claude\\reviews\\ledger.json'), 'C:/');
  assert.equal(repoOfLedger('/repo/.claude/reviews/ledger.json'), '/repo');
  assert.equal(repoOfLedger('/repo/elsewhere/ledger.json'), null);
});

// ---------------------------------------------------------------------------------------------- G-10

test('G-10: a declared reviews_dir that is a link out of the repository is not a run root', (t) => {
  const repo = tmp(t, 'q-lir4-g10-repo-');
  const home = tmp(t, 'q-lir4-g10-home-');
  const outside = tmp(t, 'q-lir4-g10-out-');
  fs.symlinkSync(outside, path.join(repo, 'runs'), 'junction');
  fs.mkdirSync(path.join(repo, 'real-runs'));
  assert.ok(!repoRunRoots({ repoRoot: repo, home, declaredReviewsDir: 'runs' }).includes(path.join(repo, 'runs')),
    'a junction to a folder outside the repository and quorate\'s home became a root --summary and the migration read');
  assert.ok(repoRunRoots({ repoRoot: repo, home, declaredReviewsDir: 'real-runs' }).includes(path.join(repo, 'real-runs')),
    'a real in-repository reviews_dir is still a root');
});

// ---------------------------------------------------------------------------------------------- G-2

test('G-2: a repository\'s ledger is not written through a .claude link out of the repository', (t) => {
  const repo = tmp(t, 'q-lir4-g2-repo-');
  const home = tmp(t, 'q-lir4-g2-home-');
  const outside = tmp(t, 'q-lir4-g2-out-');
  fs.mkdirSync(path.join(outside, 'claude', 'reviews'), { recursive: true });
  fs.symlinkSync(path.join(outside, 'claude'), path.join(repo, '.claude'), 'junction');
  const ledgerPath = path.join(repo, '.claude', 'reviews', 'ledger.json');
  const r = spawnSync(process.execPath, [CLI, '--add', '--file', 'x.mjs', '--claim', 'c', '--ledger', ledgerPath],
    { encoding: 'utf8', cwd: repo, env: { ...process.env, QUORATE_HOME: home } });
  assert.notEqual(r.status, 0, 'the ledger was written through the link');
  assert.ok(!fs.existsSync(path.join(outside, 'claude', 'reviews', 'ledger.json')), 'a ledger landed outside the repository');
  assert.ok(!fs.existsSync(path.join(outside, 'claude', 'reviews', 'ledger.json.lock')), 'the lock landed outside the repository');
});

// ---------------------------------------------------------------------------------------------- G-1, G-3, G-4

test('G-1: findings-ledger runs and classifies --print-contract in one place', () => {
  // Since ledger-findings stage 4 that place is the framework's one reader: findings-ledger spawns it nowhere, and calls
  // the reader from contractOf alone.
  const src = SRC('scripts/findings-ledger.mjs');
  assert.equal(src.split("'--print-contract'").length - 1, 0, 'findings-ledger spawns --print-contract itself');
  const n = src.split('readContract(').length - 1;
  assert.equal(n, 1, `the reader is called in ${n} places; contractOf and declaredFloor can read one contract two ways`);
});

test('G-3: the migration resolves the requests folder through resolvedRequestsDir, not a join of REQUESTS_DIR', () => {
  const src = SRC('scripts/findings-ledger.mjs');
  assert.doesNotMatch(src, /path\.join\(ledgerRepo\(\), REQUESTS_DIR\)\s*:/, 'a second authority for where the requests folder is');
  assert.match(src, /resolvedRequestsDir\(ledgerRepo\(\)/);
});

test('G-4: the migration reads the historical runs before it takes the ledger lock', () => {
  const src = SRC('scripts/findings-ledger.mjs');
  const block = src.slice(src.indexOf('if (args.migrateIdentity) {'), src.indexOf('// ------------------------------------------------------------------------------------ ingest'));
  // The admitted directory since G-9 of 20261030-010649-rdr-remediation-5-review.
  assert.ok(block.indexOf('readReconcileArtifacts(admitted.dir)') !== -1, 'fixture: the migration block was not found');
  assert.ok(block.indexOf('lockLedger()') > block.indexOf('readReconcileArtifacts(admitted.dir)'),
    'the lock is held through every historical run\'s artifact I/O');
});

// ---------------------------------------------------------------------------------------------- G-8, G-9 (behaviour kept)

test('G-8: entries that re-anchor into new buckets are reported under their new keys', () => {
  const F = 'scripts/x.mjs';
  const r1 = '20261012-100000-one', r2 = '20261012-110000-two';
  const S = (run, gid, line) => ({ run_id: run, group_id: gid, file: F, line, severity: 'MEDIUM', decision: 'confirmed', claim: gid, nodes: ['code-audit'] });
  const fold = (l, run, s) => mergeRun(l, { run_id: run, at: '2026-10-12T10:00:00Z', sightings: s, surface: ['scripts'], reviewed: true, okNodes: new Set(['code-audit']) });
  const once = fold({ schema_version: 1, runs_folded: [], entries: {} }, r1, [S(r1, 'G-1', 15), S(r1, 'G-2', 45), S(r1, 'G-3', 75)]).ledger;
  const { ledger, delta } = fold(once, r2, [S(r2, 'G-1', 21), S(r2, 'G-2', 51), S(r2, 'G-3', 81)]);
  assert.deepEqual([...delta.recurring].sort(), Object.keys(ledger.entries).sort(), 'a recurring key names no entry');
});

test('G-9: a proposed decline is withdrawn by a later T13 and stands after one', () => {
  const d = (transition, at) => ({ transition, at });
  assert.deepEqual(standingDecisions({ decisions: [d('T12', '1'), d('T13', '2')] }), []);
  assert.deepEqual(standingDecisions({ decisions: [d('T13', '1'), d('T12', '2')] }).map((x) => x.transition), ['T12']);
  assert.deepEqual(standingDecisions({ decisions: [d('T12', '1'), d('T13', '2'), d('T12', '3'), d('T11', '4')] }).map((x) => x.at), ['3', '4']);
});
