// Remediation of review 20261013-023310-ledger-identity-remediation-2-review (gate RISK), judged against
// .claude/requests/ledger-identity.plan.md (amended 2026-10-13: a re-fold is a run already in runs_folded). Each test
// names the group it exists for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeRun, ledgerPathFor } from '../scripts/lib/ledger.mjs';
import { repoRunRoots, runBelongsToRepo } from '../scripts/lib/reviews-root.mjs';

const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
const SRC = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const F = 'scripts/io/snapshot.mjs';
const at = (run) => { const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(run); return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`; };
const S = (run, gid, line, severity, extra = {}) => ({ run_id: run, group_id: gid, file: F, line, severity, decision: 'confirmed', claim: `${gid} of ${run}`, nodes: ['code-audit'], ...extra });
const fold = (ledger, run, sightings, when = at(run)) => mergeRun(ledger, { run_id: run, at: when, sightings, surface: ['scripts'], reviewed: true, okNodes: new Set(['code-audit']) });
const empty = () => ({ schema_version: 1, runs_folded: [], entries: {} });

// ---------------------------------------------------------------------------------------------- G-9

test('G-9: re-folding a run already in runs_folded but evicted from sightings[] (bounded to 10) changes nothing', () => {
  const first = '20261001-000000-first';
  let l = fold(empty(), first, [S(first, 'G-1', 95, 'MEDIUM')]).ledger;
  for (let i = 10; i < 22; i++) {
    const r = `202610${String(i).padStart(2, '0')}-000000-later`;
    l = fold(l, r, [S(r, 'G-1', 95, 'MEDIUM')]).ledger;
  }
  const [e] = Object.values(l.entries);
  assert.ok(!e.sightings.some((s) => s.run_id === first), 'fixture: the first run has been evicted from sightings[]');
  const again = fold(l, first, [S(first, 'G-1', 95, 'MEDIUM')]).ledger;
  assert.deepEqual(again, l, 'a run in runs_folded is a re-fold and applies nothing: times_seen, sightings and claims moved');
});

test('G-9: re-folding an evicted run on an operator decline does not raise it again', () => {
  const first = '20261001-000000-first';
  let l = fold(empty(), first, [S(first, 'G-1', 95, 'MEDIUM')]).ledger;
  for (let i = 10; i < 22; i++) {
    const r = `202610${String(i).padStart(2, '0')}-000000-later`;
    l = fold(l, r, [S(r, 'G-1', 95, 'MEDIUM')]).ledger;
  }
  const [k] = Object.keys(l.entries);
  l = { ...l, entries: { [k]: { ...l.entries[k], status: 'declined', decided_by: 'operator', declined_severity: 'MEDIUM', decided_at: '2026-09-30T00:00:00Z' } } };
  assert.deepEqual(fold(l, first, [S(first, 'G-1', 95, 'MEDIUM')]).ledger, l, 'old evidence reopened a decided entry');
});

// ---------------------------------------------------------------------------------------------- G-10

test('G-10: re-folding an older run still in sightings[] does not move the entry\'s line or key back', () => {
  const r1 = '20261012-100000-one', r2 = '20261012-110000-two';
  const once = fold(empty(), r1, [S(r1, 'G-1', 95, 'MEDIUM')]).ledger;
  const twice = fold(once, r2, [S(r2, 'G-4', 101, 'MEDIUM')]).ledger;
  const [k] = Object.keys(twice.entries);
  assert.equal(twice.entries[k].line, 101, 'fixture: the newer sighting re-anchored the entry');
  const again = fold(twice, r1, [S(r1, 'G-1', 95, 'MEDIUM')]).ledger;
  assert.deepEqual(Object.keys(again.entries), [k], 'the key migrated back to the older run\'s bucket');
  assert.deepEqual(again.entries, twice.entries);
});

// ---------------------------------------------------------------------------------------------- G-11

test('G-11: a re-fold does not move last_fold_at', () => {
  const run = '20261012-100000-one';
  const once = fold(empty(), run, [S(run, 'G-1', 95, 'MEDIUM')]).ledger;
  const again = fold(once, run, [S(run, 'G-1', 95, 'MEDIUM')], '2026-10-13T05:00:00Z').ledger;
  assert.equal(again.last_fold_at, once.last_fold_at);
  assert.deepEqual(again, once);
});

// ---------------------------------------------------------------------------------------------- CLI fixtures

const tmp = (t, prefix) => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const unmigrated = () => ({ schema_version: 1, runs_folded: [], entries: {} });
function repoWithLedger(t) {
  const repo = tmp(t, 'q-lir2-repo-');
  const home = tmp(t, 'q-lir2-home-');
  const ledgerPath = path.join(repo, '.claude', 'reviews', 'ledger.json');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(unmigrated()));
  const env = { ...process.env, QUORATE_HOME: home };
  const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: repo, env });
  const migrated = () => JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).identity_migrated_at;
  return { repo, home, ledgerPath, cli, migrated };
}

// ---------------------------------------------------------------------------------------------- G-2

test('G-2: a contract that cannot be read is not "no contract" — --migrate-identity refuses and leaves the ledger unmigrated', (t) => {
  const { repo, ledgerPath, cli, migrated } = repoWithLedger(t);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# x\n\n```yaml\ngraph_contract_version: 999\nproject: myproj\n```\n');
  const r = cli(['--migrate-identity', '--ledger', ledgerPath]);
  assert.notEqual(r.status, 0, 'a failed --print-contract was read as no contract, and the runs were searched for under project=null');
  assert.match(r.stderr, /contract/);
  assert.equal(migrated(), undefined, 'stamped migrated, so a second attempt is refused');
});

// ---------------------------------------------------------------------------------------------- G-7

test('G-7: --report may not overwrite an existing file, such as an archived run.json', (t) => {
  const { repo, ledgerPath, cli, migrated } = repoWithLedger(t);
  const runJson = path.join(repo, '.claude', 'reviews', '20261012-000000-kept', 'run.json');
  fs.mkdirSync(path.dirname(runJson), { recursive: true });
  fs.writeFileSync(runJson, 'KEEP');
  const r = cli(['--migrate-identity', '--ledger', ledgerPath, '--report', runJson]);
  assert.notEqual(r.status, 0, 'an existing file was accepted as the report');
  assert.equal(fs.readFileSync(runJson, 'utf8'), 'KEEP', 'the archived run record was truncated and replaced');
  assert.equal(migrated(), undefined);
});

test('G-7: --report through a link in the reviews folder to a sibling under .claude is refused', (t) => {
  const { repo, ledgerPath, cli, migrated } = repoWithLedger(t);
  const sibling = path.join(repo, '.claude', 'hooks-x');
  fs.mkdirSync(sibling, { recursive: true });
  const link = path.join(repo, '.claude', 'reviews', 'via');
  fs.symlinkSync(sibling, link, 'junction');
  const r = cli(['--migrate-identity', '--ledger', ledgerPath, '--report', path.join(link, 'report.md')]);
  assert.notEqual(r.status, 0, 'the containment check was anchored one folder too high (.claude, not .claude/reviews)');
  assert.ok(!fs.existsSync(path.join(sibling, 'report.md')), 'the report was written outside the reviews folder');
  assert.equal(migrated(), undefined);
});

// ---------------------------------------------------------------------------------------------- G-13

test('G-13: a declared reviews_dir outside the repository and quorate\'s home is not a run root', () => {
  const repo = path.resolve(os.tmpdir(), 'q-g13-repo');
  const home = path.resolve(os.tmpdir(), 'q-g13-home');
  for (const declared of ['../outside', path.resolve(os.tmpdir(), 'q-g13-elsewhere')]) {
    const outside = path.resolve(repo, declared);
    assert.ok(!repoRunRoots({ repoRoot: repo, home, declaredReviewsDir: declared }).includes(outside), `${declared} became a run root`);
    assert.equal(runBelongsToRepo({ runDir: path.join(outside, '20261012-000000-x'), repoRoot: repo, home, declaredReviewsDir: declared }).ok, false,
      `a run under ${declared} was accepted as the repository's`);
  }
  assert.ok(repoRunRoots({ repoRoot: repo, home, declaredReviewsDir: 'runs' }).includes(path.join(repo, 'runs')), 'an in-repository reviews_dir is still a root');
  assert.ok(repoRunRoots({ repoRoot: repo, home, declaredReviewsDir: path.join(home, 'runs') }).includes(path.join(home, 'runs')), 'an in-home reviews_dir is still a root');
});

// ---------------------------------------------------------------------------------------------- G-1, G-4

test('G-1: which repository a ledger belongs to is read through the ledger location\'s one owner', async () => {
  const { repoOfLedger } = await import('../scripts/lib/ledger.mjs');
  assert.equal(typeof repoOfLedger, 'function', 'no inverse of ledgerPathFor: findings-ledger spells the layout itself');
  const repo = path.resolve(os.tmpdir(), 'q-g1-repo');
  assert.equal(path.resolve(repoOfLedger(ledgerPathFor(repo))), repo);
  assert.equal(repoOfLedger(path.join(repo, 'elsewhere', 'ledger.json')), null);
  assert.equal(path.resolve(path.dirname(ledgerPathFor(repo))), repoRunRoots({ repoRoot: repo })[0], 'the ledger\'s folder and the archived-runs root disagree');
  assert.doesNotMatch(SRC('scripts/findings-ledger.mjs'), /basename\([^)]*\) === 'reviews'/, 'findings-ledger still matches the literal path shape');
});

test('G-4: the migration report\'s requests folder comes from REQUESTS_DIR, not the ledger path plus a literal', () => {
  assert.doesNotMatch(SRC('scripts/findings-ledger.mjs'), /path\.join\(path\.dirname\(ledgerDir\), 'requests'\)/);
});
