// A REMEDIATION RUN FIXES THE CONFIRMED GROUPS THE OPERATOR CHOSE (.claude/requests/remediation-group-scope.md; operator,
// 2026-10-10: "Add group scoping (Recommended)"). story-pipeline's review 20261010-182849-invoke-security-audit confirmed
// 15 groups; the operator chose six to fix now and deferred nine to later designs. Nothing could say so: the node was
// handed every confirmed group (its brief carried reconciled.md and the frame), never read the ledger, and REPORT-CHECK
// required an answer for every confirmed group — so the nine would have been fixed piecemeal, pre-empting the designs.
// `new-run --remediates <run> --groups <ids> --operator-quote "<words>"` scopes the run, and the runner holds it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';
import { COMMIT_CHECK_KINDS } from '../scripts/lib/remediation-chain.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

// The fake node: for each id in FAKE_GROUPS, fixes src/<id>.js with a test in tests/<id>.test.js, as its own cluster.
async function fakeNode() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (process.argv.includes('--version')) { process.stdout.write('0.0.0 (fake)'); return; }
  const runDir = process.env.FAKE_RUN_DIR;
  if (process.env.FAKE_ARGV) fs.writeFileSync(process.env.FAKE_ARGV, JSON.stringify(process.argv.slice(2)));
  const repo = process.env.FAKE_REPO;
  const ev = path.join(runDir, 'evidence', 'remediation');
  fs.mkdirSync(ev, { recursive: true });
  // CAPTURES, as capture.mjs writes them (remediation-verification stage 5): per group, a test_one red of its own test
  // file, then a later passing green.
  const capture = (file, exit, at) => [`$ node --test ${file}`, `# admitted: test_one ${file}`, `# cwd: ${repo}`, `# exit: ${exit}`,
    '# timeout: 15 minute(s)', `# captured: ${at}`, '-'.repeat(72), ''].join('\n');
  // FAKE_SHARED: 'file' — every group edits and reports G-1's files, each in its own cluster; 'cluster' — every group
  // keeps its own files but reports one shared cluster.
  const shared = process.env.FAKE_SHARED ?? '';
  const groups = JSON.parse(process.env.FAKE_GROUPS || '[]').map((id) => {
    const slug = shared === 'file' ? 'g-1' : id.toLowerCase();
    fs.writeFileSync(path.join(repo, 'src', `${slug}.js`), 'fixed\n');
    fs.writeFileSync(path.join(repo, 'tests', `${slug}.test.js`), 'red then green\n');
    // FAKE_DISPOSITIONS (JSON {id: disposition}) overrides the default `fixed`.
    const disposition = JSON.parse(process.env.FAKE_DISPOSITIONS || '{}')[id] ?? 'fixed';
    fs.writeFileSync(path.join(ev, `red-${id}.txt`), capture(`tests/${slug}.test.js`, 1, '2026-10-13T10:00:00.000Z'));
    fs.writeFileSync(path.join(ev, `green-${id}.txt`), capture(`tests/${slug}.test.js`, 0, '2026-10-13T10:05:00.000Z'));
    return { group_id: id, disposition, reason: 'the guard was missing', red_evidence: `evidence/remediation/red-${id}.txt`,
      green_evidence: `evidence/remediation/green-${id}.txt`, cluster: shared === 'cluster' ? 'c-shared' : `c-${id.toLowerCase()}`, files: [`src/${slug}.js`, `tests/${slug}.test.js`],
      search_command: 'git grep -n guard', deferred: [] };
  });
  const payload = { schema_version: 1, run_id: path.basename(runDir), summary: 'fixed', groups };
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.01,
    usage: { input_tokens: 1, output_tokens: 1 }, result: JSON.stringify(payload) }));
}

// A finished review with three confirmed groups and one dropped.
// Where a remediation run is now: staged until it ends, then archived into the repository by remediate.mjs.
const archivedAt = new Map();
const at = (dir) => (fs.existsSync(path.join(dir, 'run.json')) || !archivedAt.has(dir) ? dir : archivedAt.get(dir));

function fixture(t) {
  // As the filesystem spells it, the spelling the runner hands the node (long where TEMP is an 8.3 short path).
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-remscope-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  for (const d of ['src', 'tests']) fs.mkdirSync(path.join(repo, d), { recursive: true });
  for (const id of ['g-1', 'g-2', 'g-3']) {
    fs.writeFileSync(path.join(repo, 'src', `${id}.js`), 'a\n');
    fs.writeFileSync(path.join(repo, 'tests', `${id}.test.js`), 't\n');
  }
  const yaml = ['graph_contract_version: 6', 'project: remscope-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'test_globs: ["tests/**"]', 'doc_paths: []', 'ui:', '  surface: none',
    '  static_bundle: ""', 'review:', '  external_panel: false'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/reviews/\n');
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 'x@x'); git(repo, 'config', 'user.name', 'x');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeNode.toString()})();`);
  const env = { QUORATE_HOME: path.join(base, 'home'), FAKE_REPO: repo,
    CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' };
  const mint = (extra) => runScript('new-run.mjs', ['--repo-root', repo, '--no-request', '--no-verify-sandbox',
    '--runtime-bin', bin, ...extra], { cwd: repo, env });
  const reviewed = mintedRunDir(mint(['--slug', 'rev', '--full-sweep', 'src']).output);
  fs.writeFileSync(path.join(reviewed, 'reconciled.md'), '# Reconciled\n\n## Confirmed (3)\n');
  fs.writeFileSync(path.join(reviewed, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  fs.writeFileSync(path.join(reviewed, 'finding-groups.json'), JSON.stringify({ groups: ['G-1', 'G-2', 'G-3', 'G-4']
    .map((g, i) => ({ group_id: g, file: `src/g-${i + 1}.js`, line: 1 })) }));
  fs.mkdirSync(path.join(reviewed, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(reviewed, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [
    { group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' },
    { group_id: 'G-2', decision: 'confirmed', severity: 'MEDIUM' },
    { group_id: 'G-3', decision: 'confirmed', severity: 'LOW' },
    { group_id: 'G-4', decision: 'dropped', severity: 'MEDIUM' },
  ] }));
  const scoped = (extra = [], slug = 'fix') => mint(['--slug', slug, '--remediates', reviewed, ...extra]);
  const runRem = (rem, groups, extraEnv = {}) => {
    archivedAt.set(rem, path.join(repo, '.claude', 'reviews', path.basename(rem)));
    return runScript('remediate.mjs', ['--run-dir', at(rem), '--runtime-bin', bin, '--no-verify-sandbox'],
      { cwd: repo, env: { ...env, FAKE_RUN_DIR: at(rem), FAKE_GROUPS: JSON.stringify(groups), ...extraEnv } });
  };
  return { base, repo, reviewed, mint, scoped, runRem };
}

const QUOTE = 'fix G-1 now; G-2 and G-3 wait for the design';
const minted = (t, r) => {
  assert.equal(r.status, 0, r.output);
  const dir = mintedRunDir(r.output);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, run: JSON.parse(fs.readFileSync(path.join(at(dir), 'run.json'), 'utf8')) };
};

test('AC1: --groups needs --remediates and the operator\'s words; --operator-quote alone is refused', (t) => {
  const f = fixture(t);
  const noRem = f.mint(['--slug', 'x', '--full-sweep', 'src', '--groups', 'G-1', '--operator-quote', QUOTE]);
  assert.notEqual(noRem.status, 0);
  assert.match(noRem.output, /--groups.*--remediates/);
  const noQuote = f.scoped(['--groups', 'G-1']);
  assert.notEqual(noQuote.status, 0);
  assert.match(noQuote.output, /--groups.*--operator-quote/);
  const blank = f.scoped(['--groups', 'G-1', '--operator-quote', '   ']);
  assert.notEqual(blank.status, 0);
  assert.match(blank.output, /--operator-quote/);
  const quoteOnly = f.scoped(['--operator-quote', QUOTE]);
  assert.notEqual(quoteOnly.status, 0);
  assert.match(quoteOnly.output, /--operator-quote.*--groups/);
});

test('AC2: an unknown, unconfirmed or repeated id, or an empty list, refuses the mint with the id named', (t) => {
  const f = fixture(t);
  for (const [groups, why] of [['G-9', /G-9.*not a confirmed group/], ['G-4', /G-4.*not a confirmed group/],
    ['G-1,G-1', /G-1.*more than once/], [' , ', /--groups names no group/]]) {
    const r = f.scoped(['--groups', groups, '--operator-quote', QUOTE]);
    assert.notEqual(r.status, 0, `${groups} should refuse`);
    assert.match(r.output, why);
  }
});

test('AC3: the run records the chosen groups, the deferred confirmed groups and the quote; unscoped records none', (t) => {
  const f = fixture(t);
  const { run } = minted(t, f.scoped(['--groups', 'G-3,G-1', '--operator-quote', QUOTE]));
  assert.deepEqual(run.remediation_frame.groups, ['G-3', 'G-1'], 'in the given order');
  assert.deepEqual(run.remediation_frame.deferred, ['G-2'], 'the other CONFIRMED groups; the dropped G-4 is not deferred');
  assert.equal(run.remediation_frame.scope_quote, QUOTE);
  const plain = minted(t, f.scoped([], 'fix-plain')).run.remediation_frame;
  for (const k of ['groups', 'deferred', 'scope_quote']) assert.equal(k in plain, false, `${k} on an unscoped run`);
});

test('AC4: the brief names the work list and the deferred groups; an unscoped brief says every confirmed group', (t) => {
  const f = fixture(t);
  const { dir } = minted(t, f.scoped(['--groups', 'G-1', '--operator-quote', QUOTE]));
  f.runRem(dir, ['G-1']);
  const brief = fs.readFileSync(path.join(at(dir), 'nodes', 'remediation-brief.md'), 'utf8');
  assert.match(brief, /work list: G-1\b/i);
  assert.match(brief, /deferred by the operator: do not fix, do not report: G-2, G-3/i);
  assert.ok(brief.includes(QUOTE), 'the operator\'s words reach the node');
  const plain = minted(t, f.scoped([], 'fix-plain')).dir;
  f.runRem(plain, ['G-1', 'G-2', 'G-3']);
  const plainBrief = fs.readFileSync(path.join(at(plain), 'nodes', 'remediation-brief.md'), 'utf8');
  assert.match(plainBrief, /work list: every confirmed group/i);
  assert.doesNotMatch(plainBrief, /deferred by the operator/i);
});

test('AC4: the node prompt says the brief\'s work list, when present, is the list', () => {
  const prompt = fs.readFileSync(new URL('../prompts/remediation/PROMPT.md', import.meta.url), 'utf8');
  assert.match(prompt, /work list[^.]*brief[^.]*(?:only|exactly)/i);
  assert.match(prompt, /deferred by the operator/i);
});

test('AC5: REPORT-CHECK asks only for the work list, and a reported deferred group is named and not committed', (t) => {
  const f = fixture(t);
  const ok = minted(t, f.scoped(['--groups', 'G-1', '--operator-quote', QUOTE])).dir;
  f.runRem(ok, ['G-1']);
  const okRun = JSON.parse(fs.readFileSync(path.join(at(ok), 'run.json'), 'utf8'));
  assert.deepEqual(okRun.report_check ?? [], [], JSON.stringify(okRun.report_check));
  assert.equal((okRun.remediation_commits ?? []).length, 1, 'G-1 is committed');

  const f2 = fixture(t);
  const missing = minted(t, f2.scoped(['--groups', 'G-1,G-2', '--operator-quote', QUOTE])).dir;
  f2.runRem(missing, ['G-1']);
  const missRun = JSON.parse(fs.readFileSync(path.join(at(missing), 'run.json'), 'utf8'));
  assert.ok((missRun.report_check ?? []).some((c) => /G-2: in the work list, not reported/.test(c)), JSON.stringify(missRun.report_check));

  const f3 = fixture(t);
  const strayDir = minted(t, f3.scoped(['--groups', 'G-1', '--operator-quote', QUOTE])).dir;
  const head = git(f3.repo, 'rev-parse', 'HEAD').stdout.trim();
  f3.runRem(strayDir, ['G-2']);
  const stray = JSON.parse(fs.readFileSync(path.join(at(strayDir), 'run.json'), 'utf8'));
  assert.ok((stray.report_check ?? []).some((c) => /G-2: deferred by the operator, but reported/.test(c)), JSON.stringify(stray.report_check));
  assert.ok((stray.commit_check ?? []).some((c) => c.kind === 'deferred-group' && /G-2/.test(c.message)), JSON.stringify(stray.commit_check));
  assert.equal(git(f3.repo, 'rev-parse', 'HEAD').stdout.trim(), head, 'the deferred group\'s files are not committed');
  assert.ok(stray.stamps.includes('COMMIT-CHECK'));
});

test('AC6, AC7: the skill says how to scope, and the contract document names the flags, fields and kind', () => {
  const skill = fs.readFileSync(new URL('../skills/remediate/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /--groups/);
  assert.match(skill, /--operator-quote/);
  assert.match(skill, /deferred[^.]*`open`/i);
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const row = (name) => doc.split('\n').find((l) => l.startsWith(`| \`${name}`)) ?? '';
  assert.match(row('scripts/new-run.mjs --remediates'), /--groups/);
  for (const k of ['scope_quote', 'deferred']) assert.ok(row('scripts/new-run.mjs --remediates').includes(k), k);
  assert.match(row('scripts/remediate.mjs'), /deferred-group/);
});

// ---------------------------------------------------------------------------------------------------------------------
// FOUND THE SAME DAY BY story-pipeline (run 20261010-190952-remediate-docs-arch-stage0, quorate fb01439d). With
// `reviews_dir: ""` a run is STAGED outside the tree, and the remediation node runs with the repository as its cwd and
// its only --add-dir. A path-scoped `Read(/C:\...)` rule grants nothing on Windows (contract-glob-grammar stage 2b), so
// the node was denied its own brief, refused, and the runner then exited 0: "nothing was committed" read as a clean
// no-op. Lenses never hit it because their cwd IS the run directory.

test('a staged remediation run is handed to the node as a directory it may read', (t) => {
  const f = fixture(t);
  const { dir } = minted(t, f.scoped());
  assert.equal(path.relative(f.repo, dir).startsWith('..'), true, 'the fixture stages the run outside the repository');
  const argvFile = path.join(f.base, 'argv.json');
  f.runRem(dir, ['G-1', 'G-2', 'G-3'], { FAKE_ARGV: argvFile });
  const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
  const dirs = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--add-dir') for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) dirs.push(path.resolve(argv[j]));
  assert.ok(dirs.includes(path.resolve(dir)), `the run directory is an --add-dir: ${JSON.stringify(dirs)}`);
  assert.ok(dirs.includes(path.resolve(f.repo)), `the repository stays one: ${JSON.stringify(dirs)}`);
});

test('a node that answered nothing it was given exits non-zero, not as a clean no-op', (t) => {
  const f = fixture(t);
  const { dir } = minted(t, f.scoped());
  const r = f.runRem(dir, []);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /REPORT-CHECK/);
});

// G-9 of 20261010-193952-group-scope-review: the deferred group was dropped only as a GROUP. Commit planning works on
// files and clusters, so a deferred group that shared a file or a cluster with a chosen one rode into its commit.
for (const shared of ['file', 'cluster']) {
  test(`G-9: a deferred group sharing a ${shared} with a chosen group commits nothing of either`, (t) => {
    const f = fixture(t);
    const { dir } = minted(t, f.scoped(['--groups', 'G-1', '--operator-quote', QUOTE]));
    const head = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
    f.runRem(dir, ['G-1', 'G-2'], { FAKE_SHARED: shared });
    const run = JSON.parse(fs.readFileSync(path.join(at(dir), 'run.json'), 'utf8'));
    assert.equal(git(f.repo, 'rev-parse', 'HEAD').stdout.trim(), head, `nothing committed: ${JSON.stringify(run.commit_check)}`);
    assert.ok((run.commit_check ?? []).some((c) => c.kind === 'shared-with-refused' && /G-1/.test(c.message) && /G-2/.test(c.message)),
      JSON.stringify(run.commit_check));
  });
}

// G-10 (root) and G-11 (its symptom) of 20261010-193952-group-scope-review: the payload was documented as one entry
// "per confirmed group", while a scoped run reports only its work list and must not report a deferred group.
test('G-10, G-11: the node row and the skill describe the payload by work list, not by every confirmed group', () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| `remediation/PROMPT.md`')) ?? '';
  assert.doesNotMatch(row, /per confirmed group/);
  assert.match(row, /work list/);
  const skill = fs.readFileSync(new URL('../skills/remediate/SKILL.md', import.meta.url), 'utf8');
  assert.doesNotMatch(skill, /per confirmed group/);
});

// ------------------------------------------------- 20261010-200303-group-scope-r2 (the review of the G-9 remediation)
import { admitGroups } from '../scripts/lib/remediation-chain.mjs';

// `fixed`, as a real report carries: a group with no disposition is not committable (commitEligible).
const row = (id, cluster, files) => ({ group_id: id, disposition: 'fixed', cluster, files });

// G-4: refusal did not spread. A chosen group in a cluster with a refused one was committed alone, splitting the cluster.
test('G-4 (r2): a refused group takes its whole cluster, and any group sharing a file, with it', () => {
  // G-3 shares a file with the deferred G-2; G-1 shares only a cluster with G-3; G-4 shares nothing.
  const r = admitGroups({ caseInsensitive: true, 
    groups: [row('G-1', 'c1', ['src/a.js']), row('G-3', 'c1', ['src/b.js']), row('G-2', 'c2', ['src/b.js']), row('G-4', 'c3', ['src/q.js'])],
    confirmed: ['G-1', 'G-2', 'G-3', 'G-4'], deferred: ['G-2'],
  });
  assert.deepEqual(r.plannable.map((g) => g.group_id), ['G-4'], JSON.stringify(r.checks));
  assert.ok(r.checks.some((c) => c.kind === 'shared-with-refused' && /^G-1 /.test(c.message)), 'G-1 refused with its cluster-mate G-3');
});

// G-3: the overlap guard learned only from deferred groups the node reported, which a conforming node never does. The
// reviewed run's own finding locations now say which committed files hold a deferred finding — noted, not refused
// (operator, 2026-10-10: "Note it, don't refuse (Recommended)").
test('G-3 (r2): a chosen group whose file holds a deferred finding is committed and noted, without a stamp', () => {
  const { plannable, checks } = admitGroups({ caseInsensitive: true, 
    groups: [row('G-1', 'c1', ['src/a.js', 'tests/a.test.js'])],
    confirmed: ['G-1', 'G-2'], deferred: ['G-2'], deferredFindingFiles: { 'G-2': ['src\\A.js'] },
  });
  assert.deepEqual(plannable.map((g) => g.group_id), ['G-1']);
  const note = checks.find((c) => c.kind === 'deferred-file');
  assert.ok(note && /G-1/.test(note.message) && /G-2/.test(note.message) && /src\/a\.js/i.test(note.message), JSON.stringify(checks));
  assert.equal(COMMIT_CHECK_KINDS['deferred-file'].stamps, false);
});

// G-7 (r2, LOW): overlap was tested before confirmation, so an unconfirmed row was labelled deferred-group.
test('G-7 (r2): an unconfirmed group is unconfirmed-group even when it overlaps a deferred one', () => {
  const { checks } = admitGroups({ caseInsensitive: true, 
    groups: [row('G-2', 'c2', ['src/b.js']), row('G-8', 'c2', ['src/b.js'])],
    confirmed: ['G-1', 'G-2'], deferred: ['G-2'],
  });
  assert.ok(checks.some((c) => c.kind === 'unconfirmed-group' && /^G-8 /.test(c.message)), JSON.stringify(checks));
});

// G-11 (r2, LOW): the staged-run test asserted the remediation run's --add-dir, not the reviewed run's.
test('G-11 (r2): a reviewed run staged outside the repository is an --add-dir too', (t) => {
  const f = fixture(t);
  const { dir, run } = minted(t, f.scoped());
  assert.equal(path.relative(f.repo, run.remediation_frame.run_dir).startsWith('..'), true, 'the reviewed run is staged too');
  const argvFile = path.join(f.base, 'argv.json');
  f.runRem(dir, ['G-1', 'G-2', 'G-3'], { FAKE_ARGV: argvFile });
  const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
  const dirs = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--add-dir') for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) dirs.push(path.resolve(argv[j]));
  assert.ok(dirs.includes(path.resolve(run.remediation_frame.run_dir)), JSON.stringify(dirs));
});

// ------------------------------------------------- 20261010-204008-group-scope-r3 (the review of the r2 remediation)
// G-1 (HIGH): an unconfirmed group was refused without entering the refused set, so refusal never spread from it and a
// confirmed group sharing its file or cluster committed its edits. A group refused for sharing is now its own kind,
// `shared-with-refused`, whatever refused the group it shares with.
test('G-1 (r3): refusal spreads from an unconfirmed group too', () => {
  const { plannable, checks } = admitGroups({ caseInsensitive: true, 
    groups: [row('G-1', 'c1', ['src/a.js']), row('G-8', 'c8', ['SRC/A.js']), row('G-3', 'c1', ['src/c.js']), row('G-4', 'c4', ['src/d.js'])],
    confirmed: ['G-1', 'G-3', 'G-4'], deferred: [],
  });
  assert.deepEqual(plannable.map((g) => g.group_id), ['G-4'], JSON.stringify(checks));
  assert.ok(checks.some((c) => c.kind === 'unconfirmed-group' && /^G-8 /.test(c.message)));
  assert.ok(checks.some((c) => c.kind === 'shared-with-refused' && /^G-1 .*G-8/.test(c.message)), JSON.stringify(checks));
  assert.ok(checks.some((c) => c.kind === 'shared-with-refused' && /^G-3 .*G-1/.test(c.message)), JSON.stringify(checks));
  assert.equal(COMMIT_CHECK_KINDS['shared-with-refused'].stamps, true);
});

// G-6 (LOW, three arms, confirmed from source): an unreadable finding-groups.json silently skipped the deferred-file
// check. A scoped run now records that it could not be done.
test('G-6 (r3): a scoped run whose reviewed finding locations are unreadable says the deferred-file check did not run', (t) => {
  const f = fixture(t);
  const { dir } = minted(t, f.scoped(['--groups', 'G-1', '--operator-quote', QUOTE]));
  fs.rmSync(path.join(f.reviewed, 'finding-groups.json'));
  f.runRem(dir, ['G-1']);
  const run = JSON.parse(fs.readFileSync(path.join(at(dir), 'run.json'), 'utf8'));
  // remediation-commit-admission D3 (operator: "Stamp COMMIT-CHECK (Recommended)"; r4's G-8): its own kind, and it stamps.
  assert.ok((run.commit_check ?? []).some((c) => c.kind === 'deferred-file-unchecked' && /finding-groups\.json/.test(c.message) && /not checked/.test(c.message)),
    JSON.stringify(run.commit_check));
  assert.ok(run.stamps.includes('COMMIT-CHECK'), JSON.stringify(run.stamps));
});

// G-8 (symptom of G-1): the row promised spreading the code lacked, and called a deferred-file note's file "committed"
// when the note is made at admission, before any commit.
test('G-8 (r3): the remediate row names shared-with-refused and does not call a deferred-file note\'s file committed', () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const r = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';
  assert.match(r, /`shared-with-refused`/);
  assert.doesNotMatch(r, /`deferred-file` \(a committed file/);
});

// ------------------------------------------------- remediation-commit-admission.plan.md (stages 1-3; r4 G-3, G-8, G-9)
// Group scoping reached the round cap: admitGroups and planClusterCommits each decided half of "which groups may be
// committed", and groups the second dropped never fed the first. One predicate now decides it for both (D1 = B,
// operator 2026-10-10: "Keep two passes"); a group failing it seeds the refusal (D2 = A: "Refuse the cluster").
import { commitEligible } from '../scripts/lib/remediation-chain.mjs';

test('commitEligible: confirmed, not deferred, and fixed or partial with files', () => {
  const ctx = { confirmed: ['G-1', 'G-2'], deferred: ['G-2'] };
  assert.equal(commitEligible({ group_id: 'G-1', disposition: 'fixed', files: [] }, ctx), true);
  assert.equal(commitEligible({ group_id: 'G-1', disposition: 'partial', files: ['src/a.js'] }, ctx), true);
  assert.equal(commitEligible({ group_id: 'G-1', disposition: 'partial', files: [] }, ctx), false);
  for (const d of ['not-fixed', 'declined']) assert.equal(commitEligible({ group_id: 'G-1', disposition: d, files: ['src/a.js'] }, ctx), false, d);
  assert.equal(commitEligible({ group_id: 'G-2', disposition: 'fixed', files: ['src/b.js'] }, ctx), false, 'deferred');
  assert.equal(commitEligible({ group_id: 'G-9', disposition: 'fixed', files: ['src/c.js'] }, ctx), false, 'unconfirmed');
});

const disp = (id, d, cluster, files) => ({ group_id: id, disposition: d, cluster, files });
for (const [label, other] of [
  ['a not-fixed group sharing a file', disp('G-2', 'not-fixed', 'c2', ['src/a.js'])],
  ['a declined group sharing a cluster', disp('G-2', 'declined', 'c1', ['src/b.js'])],
  ['a partial group with no files sharing a cluster', disp('G-2', 'partial', 'c1', [])],
]) {
  test(`r4 G-3: ${label} refuses the fixed group it shares with`, () => {
    const { plannable, checks } = admitGroups({ caseInsensitive: true, 
      groups: [disp('G-1', 'fixed', 'c1', ['src/a.js']), other, disp('G-3', 'fixed', 'c3', ['src/z.js'])],
      confirmed: ['G-1', 'G-2', 'G-3'], deferred: [],
    });
    assert.deepEqual(plannable.map((g) => g.group_id), ['G-3'], JSON.stringify(checks));
    assert.ok(checks.some((c) => c.kind === 'not-committable' && /^G-2 /.test(c.message) && c.message.includes(other.disposition)), JSON.stringify(checks));
    assert.ok(checks.some((c) => c.kind === 'shared-with-refused' && /^G-1 .*G-2/.test(c.message)), JSON.stringify(checks));
    assert.equal(COMMIT_CHECK_KINDS['not-committable'].stamps, true);
  });
}

test('r4 G-3, end to end: a not-fixed group\'s edits in a shared file are not committed with a fixed group', (t) => {
  const f = fixture(t);
  const { dir } = minted(t, f.scoped([], 'fix-shared'));
  const head = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
  f.runRem(dir, ['G-1', 'G-2', 'G-3'], { FAKE_SHARED: 'file', FAKE_DISPOSITIONS: JSON.stringify({ 'G-2': 'not-fixed', 'G-3': 'declined' }) });
  const run = JSON.parse(fs.readFileSync(path.join(at(dir), 'run.json'), 'utf8'));
  assert.equal(git(f.repo, 'rev-parse', 'HEAD').stdout.trim(), head, JSON.stringify(run.commit_check));
  assert.ok((run.commit_check ?? []).some((c) => c.kind === 'shared-with-refused' && /^G-1 /.test(c.message)), JSON.stringify(run.commit_check));
});

test('r4 G-9: the remediate row says refusal spreads from any group that may not be committed, and names the new kinds', () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const r = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';
  for (const k of ['not-committable', 'deferred-file-unchecked', 'shared-with-refused']) assert.ok(r.includes(`\`${k}\``), k);
  const stamps = fs.readFileSync(new URL('../prompts/_templates/stamp-consequences.json', import.meta.url), 'utf8');
  assert.match(stamps, /deferred/i, 'COMMIT-CHECK\'s explanation names the deferred causes (r4 G-1)');
});

// ------------------------------------------------- 20261010-233649-commit-admission-review (the delivery review)
// G-3: a refusal's group and disposition were only in the message text; the entry shape is meant to carry them as
// fields ("one entry shape ... without parsing prose", remediate.mjs's commit_check note). G-1 (part): admitGroups kept
// its own copies of the confirmed and deferred tests beside commitEligible; one function, commitRefusal, now says why.
import { commitRefusal } from '../scripts/lib/remediation-chain.mjs';

test('G-3: every refusal entry carries its group as a field, and its disposition or blocker where it has one', () => {
  const { checks } = admitGroups({ caseInsensitive: true, 
    groups: [disp('G-1', 'fixed', 'c1', ['src/a.js']), disp('G-2', 'not-fixed', 'c2', ['src/a.js']),
      disp('G-4', 'fixed', 'c4', ['src/d.js']), disp('G-8', 'fixed', 'c8', ['src/e.js'])],
    confirmed: ['G-1', 'G-2', 'G-4'], deferred: ['G-4'],
  });
  const of = (k, g) => checks.find((c) => c.kind === k && c.group === g);
  assert.equal(of('not-committable', 'G-2')?.disposition, 'not-fixed', JSON.stringify(checks));
  assert.ok(of('deferred-group', 'G-4'), JSON.stringify(checks));
  assert.ok(of('unconfirmed-group', 'G-8'), JSON.stringify(checks));
  assert.equal(of('shared-with-refused', 'G-1')?.blocked_by, 'G-2', JSON.stringify(checks));
});

test('G-1 (part): commitRefusal is the one reason, and commitEligible is its absence', () => {
  const ctx = { confirmed: ['G-1', 'G-2'], deferred: ['G-2'] };
  assert.equal(commitRefusal({ group_id: 'G-1', disposition: 'fixed' }, ctx), null);
  assert.equal(commitRefusal({ group_id: 'G-9', disposition: 'fixed' }, ctx).kind, 'unconfirmed-group');
  assert.equal(commitRefusal({ group_id: 'G-2', disposition: 'fixed' }, ctx).kind, 'deferred-group');
  assert.deepEqual(commitRefusal({ group_id: 'G-1', disposition: 'declined' }, ctx), { kind: 'not-committable', group: 'G-1', disposition: 'declined' });
});

test('G-3, end to end: run.json\'s commit_check entry carries the group and disposition', (t) => {
  const f = fixture(t);
  const { dir } = minted(t, f.scoped([], 'fix-fields'));
  f.runRem(dir, ['G-1', 'G-2'], { FAKE_SHARED: 'file', FAKE_DISPOSITIONS: JSON.stringify({ 'G-2': 'not-fixed' }) });
  const run = JSON.parse(fs.readFileSync(path.join(at(dir), 'run.json'), 'utf8'));
  const e = (run.commit_check ?? []).find((c) => c.kind === 'not-committable');
  assert.ok(e && e.group === 'G-2' && e.disposition === 'not-fixed', JSON.stringify(run.commit_check));
});

// G-10: the r2/r3 tests' fixture gained `disposition: 'fixed'`, so they no longer show what the new rule does to their
// ORIGINAL inputs. Shown here instead: a reported group with no disposition is not committable.
test('G-10: a reported group with no disposition — the r2/r3 tests\' original input — is not-committable', () => {
  const { plannable, checks } = admitGroups({ caseInsensitive: true,  groups: [{ group_id: 'G-1', cluster: 'c1', files: ['src/a.js'] }], confirmed: ['G-1'], deferred: [] });
  assert.deepEqual(plannable, []);
  assert.ok(checks.some((c) => c.kind === 'not-committable' && c.group === 'G-1' && c.disposition === null), JSON.stringify(checks));
});

test('G-9: the remediate row does not say every reported cluster is committed', () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const r = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';
  assert.doesNotMatch(r, /commits each cluster the node reported/);
});
