// THE OPEN LEDGER-IDENTITY FINDINGS, BY MECHANISM (.claude/requests/ledger-findings.plan.md, approved 2026-10-14:
// "Approve, start (Recommended)"). Each stage closes one rule at every site the design's survey found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { mergeRun } from '../scripts/lib/ledger.mjs';

// ---------------------------------------------------------------------------------------------- stage 1: one re-fold rule
// D2 (operator, 2026-10-14: "Code follows T7 (Recommended)"): a run already in runs_folded changes nothing, whatever
// the input. The guard covered only a grouped fold, so a legacy re-fold counted a run twice and raised the severity.
test('stage 1: a legacy re-fold of a run already folded changes nothing (T7)', () => {
  const r1 = '20261001-000000-a';
  const r2 = '20261002-000000-b';
  const f = (severity, claim) => [{ file: 'b.mjs', line: 5, severity, claim, node: 'n' }];
  let l = mergeRun(null, { run_id: r1, at: 't1', findings: f('LOW', 'x') }).ledger;
  l = mergeRun(l, { run_id: r2, at: 't2', findings: f('LOW', 'x') }).ledger;
  const before = JSON.parse(JSON.stringify(l));
  const again = mergeRun(l, { run_id: r1, at: 't3', findings: f('HIGH', 'y') });
  assert.equal(again.delta.refold, true, 'the re-fold is reported as one');
  assert.deepEqual(again.ledger.entries, before.entries, 'no entry changes: times_seen, severity, last_seen stay');
  assert.equal(again.ledger.last_fold_at, before.last_fold_at, 'last_fold_at does not move');
});

// ---------------------------------------------------------------------------------------------- stage 2: symptom chains
// D3: a symptom folds into its root when the root, followed through the chain, is on the same entry; a cycle keeps both.
const RUN = '20261014-120000-chain';
const S = (g, line, root) => ({ run_id: RUN, group_id: g, file: 'a.mjs', line, severity: 'MEDIUM',
  decision: root ? 'symptom' : 'confirmed', claim: g, nodes: ['code-audit'], ...(root ? { root_cause_group: root } : {}) });
const entryAt = (r, key) => r.ledger.entries[key];

test('stage 2: a chain G-3 -> G-2 -> G-1 on one entry is one defect, not a shared entry', () => {
  const r = mergeRun(null, { run_id: RUN, at: '2026-10-14T12:00:00Z', sightings: [S('G-1', 11), S('G-2', 12, 'G-1'), S('G-3', 13, 'G-2')] });
  const e = Object.values(r.ledger.entries)[0];
  assert.deepEqual(e.sightings[0].group_ids, ['G-1']);
  assert.deepEqual(e.stay_shared ?? [], []);
  assert.deepEqual(r.delta.shared, []);
});

test('stage 2: a symptom whose root sits on another entry is NOT folded away there', () => {
  const r = mergeRun(null, { run_id: RUN, at: '2026-10-14T12:00:00Z', sightings: [S('G-1', 11), S('G-2', 80), S('G-3', 13, 'G-2')] });
  const here = Object.values(r.ledger.entries).find((e) => e.line < 50);
  assert.deepEqual(here.sightings[0].group_ids, ['G-1', 'G-3'], 'G-3\'s root is on the other entry, so G-3 stays a group here');
});

test('stage 2: a two-member cycle on one entry keeps both members', () => {
  const r = mergeRun(null, { run_id: RUN, at: '2026-10-14T12:00:00Z', sightings: [S('G-1', 11, 'G-2'), S('G-2', 12, 'G-1')] });
  const e = Object.values(r.ledger.entries)[0];
  assert.deepEqual(e.sightings[0].group_ids, ['G-1', 'G-2']);
});

// ---------------------------------------------------------------------------------------------- stage 3: one refusal source
// D6: the raised-again refusal is one definition every branch uses, and the two phrasings narrower than T4 are gone.
test('stage 3: the raised-again refusal phrase is defined once in lib/ledger.mjs and every refusing branch uses it', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'ledger.mjs'), 'utf8');
  const literal = (src.match(/'a decline that was raised again/g) ?? []).length;
  assert.equal(literal, 1, `the phrase is written ${literal} times; one definition is the rule`);
  const uses = (src.match(/if \(rose\) \{ refuse\(raisedAgain\(/g) ?? []).length;
  assert.equal(uses, 4, 'each of the four branches refuses through the one helper');
});

test('stage 3: no script still says a decline comes back only when its severity rose', () => {
  for (const rel of ['scripts/findings-ledger.mjs', 'scripts/lib/ledger.mjs']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /declines whose severity rose|a decline whose severity rose/, rel);
  }
});

// ---------------------------------------------------------------------------------------------- stage 4: one contract reader
// D4: ten callers spawned `new-run --print-contract` and each classified failure its own way, one by matching the
// owner's message text. One pure classifier decides contract / absent / error, `new-run` says "absent" with its own
// exit code, and one io reader spawns once per process and repository.
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';

test('stage 4: the classifier tells a contract, an absent contract and an error apart without reading message text', async () => {
  const { classifyPrintContract, NO_CONTRACT_EXIT } = await import('../scripts/lib/contract-source.mjs');
  assert.deepEqual(classifyPrintContract({ status: 0, stdout: '{"project":"p"}' }), { contract: { project: 'p' } });
  assert.equal(classifyPrintContract({ status: NO_CONTRACT_EXIT, stderr: 'anything at all' }).absent, true);
  assert.ok(classifyPrintContract({ status: 2, stderr: 'no graph_contract found' }).error, 'text alone never decides absent');
  assert.ok(classifyPrintContract({ status: 0, stdout: 'not json' }).error);
  assert.ok(classifyPrintContract({ status: null, error: new Error('spawn failed') }).error);
});

test('stage 4: new-run --print-contract exits NO_CONTRACT_EXIT when there is no contract, and another code when one is unreadable', async (t) => {
  const { NO_CONTRACT_EXIT } = await import('../scripts/lib/contract-source.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-nocontract-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = () => spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), '--print-contract', '--repo-root', dir], { cwd: dir, encoding: 'utf8' });
  assert.equal(run().status, NO_CONTRACT_EXIT, 'no contract file at all');
  const block = (p) => '```yaml\ngraph_contract_version: 6\nproject: ' + p + '\n```\n';
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), block('a'));
  fs.mkdirSync(path.join(dir, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'rules', 'quorate-contract.md'), block('b'));
  const conflicting = run();
  assert.notEqual(conflicting.status, 0);
  assert.notEqual(conflicting.status, NO_CONTRACT_EXIT, 'two disagreeing contracts are an error, not an absence');
});

test('stage 4: readContract spawns once per process and repository', async () => {
  const { readContract } = await import('../scripts/io/contract-reader.mjs');
  let spawned = 0;
  const spawn = () => { spawned += 1; return { status: 0, stdout: '{"project":"x"}', stderr: '' }; };
  const a = readContract({ repoRoot: '/r1', spawn });
  const b = readContract({ repoRoot: '/r1', spawn });
  assert.deepEqual(a, { contract: { project: 'x' } });
  assert.deepEqual(b, a);
  assert.equal(spawned, 1);
  readContract({ repoRoot: '/r2', spawn });
  assert.equal(spawned, 2, 'another repository is another read');
});

test('stage 4: no caller spawns --print-contract or matches the owner\'s "no graph_contract found" text itself', () => {
  const files = execFileSync('git', ['ls-files', 'scripts', '.claude/hooks'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n')
    .filter((f) => /\.(mjs|js)$/.test(f));
  // lib/reviewers.mjs is NOT an owner (G-16/G-19 of 20261014-181622-lf-delivery): exempting it let declaredReviewers keep
  // spawning new-run itself, past the reader's memo.
  const owners = new Set(['scripts/io/contract-reader.mjs', 'scripts/lib/contract-source.mjs', 'scripts/new-run.mjs']);
  const spawners = [];
  const matchers = [];
  for (const f of files) {
    if (owners.has(f)) continue;
    const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
    if (/['"]--print-contract['"]/.test(src)) spawners.push(f);
    if (/no graph_contract found/.test(src)) matchers.push(f);
  }
  assert.deepEqual(spawners, [], 'these still spawn --print-contract themselves');
  assert.deepEqual(matchers, [], 'these still match the owner\'s message text');
});

// G-16 of 20261014-181622-lf-delivery: declaredReviewers spawned `new-run --print-contract` through its own seam, so a
// process reading the live reviewers and then the contract (bench-lenses) spawned new-run twice. It takes the one reader
// now: the pure owner is handed it, and the io re-export hands it the shared, memoized one.
test('G-16: declaredReviewers reads the live contract through the injected reader, never by spawning', async () => {
  const pure = await import('../scripts/lib/reviewers.mjs');
  const asked = [];
  const readContract = (o) => { asked.push(o); return { contract: { reviewers: { z: { cmd: 'z' } } } }; };
  assert.deepEqual(pure.declaredReviewers({ readContract, cwd: '/w' }), { z: { cmd: 'z' } });
  assert.deepEqual(asked, [{ cwd: '/w' }]);
  assert.deepEqual(pure.declaredReviewers(), {}, 'no reader, no run: nothing to ask');
  const io = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'reviewers.mjs'), 'utf8');
  assert.match(io, /import \{ readContract \} from '\.\/contract-reader\.mjs'/, 'the io re-export binds the one reader');
});

// G-5 of 20261014-193710-lf-remediation-review: the live branch read `.contract?.reviewers ?? {}`, so `{ absent }` and
// `{ error }` both became an empty table, and check-reviewers and both benches went on with the built-ins after a
// contract they could not read — a table that decides where credentials go (A-26). No contract is still nothing
// declared; an unreadable one is refused, and every live caller says so before anything spends. The two benches left
// this loop with bench-contract-root (their one read is benchContract's); their refusal is held by the fixture cases in
// tests/regression-bench-contract-root.test.mjs, which run them on an unreadable framework contract.
test('G-5: an unreadable live contract is refused, not read as declaring no reviewers', async () => {
  const pure = await import('../scripts/lib/reviewers.mjs');
  assert.deepEqual(pure.declaredReviewers({ readContract: () => ({ absent: 'no contract' }) }), {}, 'no contract: nothing declared');
  assert.throws(() => pure.declaredReviewers({ readContract: () => ({ error: 'exit 1' }) }), /contract could not be read: exit 1/);
  for (const f of ['check-reviewers.mjs']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', f), 'utf8');
    assert.match(src, /try \{ \w+ = declaredReviewers\(\{ live: true \}\); \} catch \(e\) \{ die\(e\.message\); \}/, `${f} refuses with the reason`);
  }
});

// G-7 of 20261014-204537-lf-remediation-r3-review (G-8, G-4 its symptoms): bench-lenses read the contract's review
// settings with `readContract({ cwd: FRAMEWORK_ROOT }).contract?.review ?? null`, after the sweep had spent, so `{ error }`
// became the same null as `{ absent }` — and from another memo key than declaredReviewers' read, so the error that read
// refuses was never seen. One decision owns the response to each outcome (bench-contract-root's benchContract), asked of
// the ONE read, before spending.
test('G-7: bench-lenses decides its declared review settings per reader outcome, through the one read', async () => {
  const lib = await import('../scripts/lib/bench-settings.mjs');
  const review = { models: { judgment: 'm' }, effort: { judgment: 'e' } };
  assert.equal(lib.benchContract({ contract: { review } }).review, review);
  assert.equal(lib.benchContract({ contract: {} }).review, null, 'a contract without review: null');
  assert.equal(lib.benchContract({ absent: 'no contract' }).review, null, 'no contract: null');
  assert.throws(() => lib.benchContract({ error: 'exit 1' }), /contract could not be read: exit 1/,
    'an unreadable contract is refused, not recorded as declaring nothing');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-lenses.mjs'), 'utf8');
  assert.doesNotMatch(src, /\.contract\?\.review \?\? null/, 'bench-lenses still collapses { error } into null itself');
  const call = src.search(/try \{ \(\{ reviewers: \w+, review: \w+ \} = benchContract\(readContract\(\{ cwd: FRAMEWORK_ROOT \}\)\)\); \} catch \(e\) \{ die\(e\.message\); \}/);
  assert.ok(call > 0, 'bench-lenses refuses an unreadable contract with the reason');
  assert.ok(call < src.indexOf('const seeds = fs.readdirSync(CORPUS_DIR'), 'and does so before the corpus, so before anything spends');
});

// G-12 of 20261014-212054-lf-remediation-r4-review: benchDeclaredReview asked readContract({}), which resolves to
// process.cwd(), so a bench launched from another directory recorded that directory's review settings (or none) as the
// ones it measured. The read now names the framework root in orchestration (bench-contract-root D1); a read with no
// directory cannot happen, because there is exactly one and it names FRAMEWORK_ROOT.
test('G-12: bench-lenses reads its declared review settings from the framework root, not the working directory', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-lenses.mjs'), 'utf8');
  assert.match(src, /readContract\(\{ cwd: FRAMEWORK_ROOT \}\)/, 'bench-lenses passes its framework root');
  assert.doesNotMatch(src, /readContract\(\{\}\)|readContract\(\)/, 'a read left to process.cwd()');
});

// G-1 of 20261014-200907-lf-remediation-r2-review (bench-lenses read the live contract before parsing its arguments, so an
// unreadable contract aborted --score-only) is held by 'stage 3: an unreadable framework contract refuses the listing
// (D2 B) but not --score-only (D2)' in tests/regression-bench-contract-root.test.mjs: the bench reads its FRAMEWORK
// root's contract now, so the unreadable contract has to be there, in a fixture, not in the launch directory.

// The hooks find the reader beside the framework they run from. A consumer mount: the framework under
// .claude/skills/quorate, the hook run from there, the contract the consumer's own.
function consumerMount(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-mount-reader-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '--quiet', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  const mount = path.join(dir, '.claude', 'skills', 'quorate');
  for (const sub of ['scripts', '.claude-plugin', path.join('.claude', 'hooks')]) {
    fs.cpSync(path.join(REPO_ROOT, sub), path.join(mount, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# c\n\n```yaml\ngraph_contract_version: 6\nproject: c\ncommands:\n  build: "node --version"\n  test: ""\n  shell: ""\n```\n');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  g('add', '-A'); g('commit', '--quiet', '-m', 'init');
  return { dir, mount };
}

test('stage 4: the pre-push checks hook reads the contract through the reader beside the framework, in a consumer mount', (t) => {
  const { dir, mount } = consumerMount(t);
  const hook = path.join(mount, '.claude', 'hooks', 'checks.mjs');
  const ok = spawnSync(process.execPath, [hook], { cwd: dir, encoding: 'utf8' });
  assert.equal(ok.status, 0, `the hook could not run the declared checks:\n${ok.stdout}${ok.stderr}`);
  fs.rmSync(path.join(mount, 'scripts', 'io', 'contract-reader.mjs'));
  const missing = spawnSync(process.execPath, [hook], { cwd: dir, encoding: 'utf8' });
  assert.equal(missing.status, 2, 'a missing reader is a configuration error, not a pass');
  assert.match(`${missing.stdout}${missing.stderr}`, /contract-reader/, 'and it is named');
});

// ---------------------------------------------------------------------------------------------- stage 5: read run dirs once
// D5: --summary stat'ed every run directory before dropping the folded ones (G-3 of 20261013-023310); the migration
// probed every folded run in every root, twice.
function countingFs(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-rundirs-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const counts = { stat: [], exists: [], readdir: 0 };
  const fsImpl = {
    readdirSync: (...a) => { counts.readdir += 1; return fs.readdirSync(...a); },
    statSync: (p) => { counts.stat.push(p); return fs.statSync(p); },
    existsSync: (p) => { counts.exists.push(p); return fs.existsSync(p); },
  };
  return { base, counts, fsImpl };
}
const mkRun = (root, id, withJson = true) => {
  fs.mkdirSync(path.join(root, id), { recursive: true });
  if (withJson) fs.writeFileSync(path.join(root, id, 'run.json'), '{}');
};

test('stage 5: --summary\'s run listing stats no run already folded', async (t) => {
  const { runDirsPresent } = await import('../scripts/io/run-dirs.mjs');
  const { base, counts, fsImpl } = countingFs(t);
  const root = path.join(base, 'reviews');
  for (const id of ['20261001-000000-a', '20261002-000000-b', '20261003-000000-c']) mkRun(root, id);
  fs.writeFileSync(path.join(root, '20261003-000000-c', 'finding-groups.json'), '{}');
  const out = runDirsPresent([root], { skip: new Set(['20261001-000000-a', '20261002-000000-b']), fsImpl });
  assert.deepEqual(out.names, ['20261003-000000-c']);
  assert.ok(counts.stat.length > 0 && counts.stat.every((p) => p.includes('20261003-000000-c')),
    `stat'ed a folded run: ${counts.stat.join(', ')}`);
});

// story-pipeline, 2026-10-15: the unfolded-run warning told the operator to fold three remediation runs, which carry no
// finding-groups.json; the fold refuses such a run (findings-ledger.mjs), so the warning asked for an action that
// cannot be done. A run with no finding-groups.json is listed apart, as having nothing to fold.
test('a run with no finding-groups.json is listed as ungrouped, not as waiting to be folded', async (t) => {
  const { runDirsPresent } = await import('../scripts/io/run-dirs.mjs');
  const { base } = countingFs(t);
  const root = path.join(base, 'reviews');
  mkRun(root, '20261001-000000-review');
  fs.writeFileSync(path.join(root, '20261001-000000-review', 'finding-groups.json'), '{}');
  mkRun(root, '20261002-000000-remediation');
  const out = runDirsPresent([root]);
  assert.deepEqual(out.names, ['20261001-000000-review']);
  assert.deepEqual(out.ungrouped, ['20261002-000000-remediation']);
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs'), 'utf8');
  assert.match(src, /present\.ungrouped/, '--summary names the ungrouped runs apart');
});

test('stage 5: the migration lists each root once and probes run.json only for an id found in two roots', async (t) => {
  const { locateRunDirs } = await import('../scripts/io/run-dirs.mjs');
  const { base, counts, fsImpl } = countingFs(t);
  const archived = path.join(base, 'archived');
  const staged = path.join(base, 'staged');
  mkRun(archived, '20261001-000000-a');
  mkRun(staged, '20261002-000000-b');
  mkRun(archived, '20261003-000000-c', false);   // archived without its run.json (its evidence stayed staged)
  mkRun(staged, '20261003-000000-c');
  const ids = ['20261001-000000-a', '20261002-000000-b', '20261003-000000-c', '20261004-000000-gone'];
  const { dirs: map } = locateRunDirs([archived, staged], ids, { fsImpl });
  assert.equal(map.get('20261001-000000-a'), path.join(archived, '20261001-000000-a'));
  assert.equal(map.get('20261002-000000-b'), path.join(staged, '20261002-000000-b'));
  assert.equal(map.get('20261003-000000-c'), path.join(staged, '20261003-000000-c'), 'the root holding run.json wins');
  assert.equal(map.has('20261004-000000-gone'), false);
  assert.equal(counts.readdir, 2, 'one listing per root');
  assert.ok(counts.exists.length > 0 && counts.exists.length <= 2, `probed ${counts.exists.length}: at most one per root holding the id`);
  assert.ok(counts.exists.every((p) => p.includes('20261003-000000-c')), `only the id in two roots is probed: ${counts.exists.join(', ')}`);
});

// G-13 of 20261014-181622-lf-delivery: locateRunDirs caught every listing failure as an empty root, so an unreadable
// root filed each folded run under it as `lost` and the migration stamped identity_migrated_at over the gap. An absent
// root still holds nothing; any other failure is `{ error }`, as in its sibling runDirsPresent.
test('G-13: locateRunDirs refuses a root it cannot list, and only an absent root reads as empty', async (t) => {
  const { locateRunDirs } = await import('../scripts/io/run-dirs.mjs');
  const { base } = countingFs(t);
  const root = path.join(base, 'reviews');
  mkRun(root, '20261001-000000-a');
  const failing = (code) => ({
    readdirSync: (p) => { if (p === root) throw Object.assign(new Error(code), { code }); return fs.readdirSync(p); },
    existsSync: fs.existsSync,
  });
  const denied = locateRunDirs([root], ['20261001-000000-a'], { fsImpl: failing('EACCES') });
  assert.ok(denied.error, 'an unreadable root is a refusal, not a root holding nothing');
  assert.match(denied.error, /EACCES/);
  assert.equal(denied.dirs, undefined);
  const absent = locateRunDirs([path.join(base, 'nowhere'), root], ['20261001-000000-a']);
  assert.equal(absent.error, undefined, 'an absent root holds no runs');
  assert.equal(absent.dirs.get('20261001-000000-a'), path.join(root, '20261001-000000-a'));
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs'), 'utf8');
  assert.match(src, /if \(located\.error\) die\(/, 'the migration refuses before it takes the lock or stamps anything');
});

test('stage 5: findings-ledger uses the run-dirs owner for --summary and the migration', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs'), 'utf8');
  assert.match(src, /runDirsPresent\(runRoots\(\), \{ skip: folded \}\)/, '--summary skips folded runs before any stat');
  assert.match(src, /locateRunDirs\(roots,/, 'the migration lists each root once');
  assert.doesNotMatch(src, /function runDirsPresent\(/, 'no second copy of the listing');
});

// ---------------------------------------------------------------------------------------------- stage 6: one list of run roots
// D7: runBelongsToRepo built its list without io, so it kept a declared root the io-filtered list drops; and the archived
// and staging roots were never checked on real paths. A junction stands in for a link (no privilege needed on Windows).
function linkRepo(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-roots-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const home = path.join(base, 'home');
  const outside = path.join(base, 'outside');
  for (const d of [repo, home, outside]) fs.mkdirSync(d, { recursive: true });
  return { base, repo, home, outside };
}
const link = (target, at) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(target, at, 'junction'); };

test('stage 6: runBelongsToRepo and repoRunRoots agree that a declared reviews_dir linked out of the repository is no root', async (t) => {
  const { repoRunRoots, runBelongsToRepo } = await import('../scripts/io/reviews-root.mjs');
  const { repo, home, outside } = linkRepo(t);
  link(outside, path.join(repo, 'runs'));
  const opts = { repoRoot: repo, project: 'p', home, declaredReviewsDir: 'runs' };
  assert.ok(!repoRunRoots(opts).includes(path.join(repo, 'runs')), 'precondition: the io list drops it');
  const verdict = runBelongsToRepo({ ...opts, runDir: path.join(repo, 'runs', '20261014-000000-x') });
  assert.equal(verdict.ok, false, 'a run under the link does not belong: the two lists agree');
});

test('stage 6: an archived .claude/reviews linked out of the repository is not a root', async (t) => {
  const { repoRunRoots } = await import('../scripts/io/reviews-root.mjs');
  const { repo, home, outside } = linkRepo(t);
  link(outside, path.join(repo, '.claude', 'reviews'));
  const roots = repoRunRoots({ repoRoot: repo, project: 'p', home });
  assert.ok(!roots.includes(path.join(repo, '.claude', 'reviews')), `still a root: ${roots.join(', ')}`);
});

test('stage 6: a staging root linked out of quorate\'s home is not a root', async (t) => {
  const { repoRunRoots, defaultReviewsRoot } = await import('../scripts/io/reviews-root.mjs');
  const { repo, home, outside } = linkRepo(t);
  const staging = defaultReviewsRoot({ project: 'p', repoRoot: repo, home });
  link(outside, staging);
  const roots = repoRunRoots({ repoRoot: repo, project: 'p', home });
  assert.ok(!roots.includes(staging), `still a root: ${roots.join(', ')}`);
});

// G-1 of 20261014-181622-lf-delivery: stage 4 put the reader lookup, `path.dirname(NEW_RUN)`, ABOVE the `!NEW_RUN`
// guard, so a hook that finds no framework crashed with a TypeError (exit 1, "a check failed") instead of the named
// configuration error (exit 2) the guard exists to give.
test('G-1: a hook with no framework beside it exits 2 with the named configuration error, not a TypeError', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-g1-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    const hooks = path.join(tmp, 'hooks');
    fs.mkdirSync(hooks);
    fs.copyFileSync(path.join(REPO_ROOT, '.claude', 'hooks', 'checks.mjs'), path.join(hooks, 'checks.mjs'));
    const r = spawnSync(process.execPath, [path.join(hooks, 'checks.mjs')], { cwd: tmp, encoding: 'utf8' });
    assert.doesNotMatch(r.stderr, /TypeError/, r.stderr);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /could not locate a quorate checkout/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
