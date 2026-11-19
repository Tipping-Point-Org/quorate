// THE CANDIDATE CHECK'S TWO BOUNDARIES (.claude/requests/candidate-check-boundaries.plan.md, approved 2026-10-14:
// "Approve, start (Recommended)"). The design step of remediation-verification's round cap: three remediation rounds
// each drew a new MEDIUM in their own fixes, in which environment reaches code the remediator wrote and in how the
// remediation path compares paths. Stage 1 here: one path key over the repository's case rule (D3, amended: git's core.ignorecase).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, runScript, privateRecord } from './helpers.mjs';
import { pathKey, classifyPath } from '../scripts/lib/finding-scope.mjs';
import { treeGuardRefusals, admitGroups, planClusterCommits, evidenceRefusal } from '../scripts/lib/remediation-chain.mjs';

const C = { source_globs: ['src/**'], test_globs: ['tests/**'], review: {} };
const BOTH = [true, false];

// ---------------------------------------------------------------------------------------------- stage 1: the path key

test('stage 1: pathKey folds only when the case flag says, and always uses forward slashes', () => {
  assert.equal(pathKey('Src\\Foo.mjs', { caseInsensitive: true }), 'src/foo.mjs');
  assert.equal(pathKey('Src\\Foo.mjs', { caseInsensitive: false }), 'Src/Foo.mjs');
});

test('stage 1: every path comparison on the remediation path REQUIRES the case flag — a forgotten one throws', () => {
  const status = { files: ['src/a.js'], refused: [] };
  assert.throws(() => treeGuardRefusals({ files: ['src/a.js'], contract: C }), /caseInsensitive/);
  assert.throws(() => admitGroups({ groups: [], contract: C }), /caseInsensitive/);
  assert.throws(() => planClusterCommits({ groups: [], status, contract: C }), /caseInsensitive/);
  assert.throws(() => evidenceRefusal({ red_evidence: 'r', green_evidence: 'g', files: [] }, {}, C), /caseInsensitive/);
  // The two primitives under them too (G-3/G-17 of 20261014-022857-ccb-delivery): classifyPath defaulted to exact.
  assert.throws(() => pathKey('src/a.js'), /caseInsensitive/);
  assert.throws(() => classifyPath('src/a.js', C), /caseInsensitive/);
  assert.throws(() => classifyPath('src/a.js', C, {}), /caseInsensitive/);
  assert.equal(classifyPath('SRC/a.js', C, { caseInsensitive: true }), 'source');
  assert.equal(classifyPath('SRC/a.js', C, { caseInsensitive: false }), 'undeclared');
});

test('stage 1: the tree guard keys by the case flag — a case variant of the manifest, an input, a source file or the contract', () => {
  const guard = (files, caseInsensitive, extra = {}) => treeGuardRefusals({ files, untracked: files, contract: C, caseInsensitive, ...extra })
    .map((r) => r.path);
  // On a case-insensitive file system these name the same files as their canonical spellings, and refuse.
  assert.deepEqual(guard(['Package.json'], true), ['Package.json']);
  assert.deepEqual(guard(['SRC/new.js'], true), ['SRC/new.js'], 'a source file in another case is still source');
  assert.deepEqual(guard(['claude.md'], true, { contractSource: 'CLAUDE.md' }), ['claude.md']);
  const declared = { ...C, review: { preflight_inputs: ['config/**'] } };
  assert.deepEqual(guard(['Config/build.json'], true, { contract: declared }), ['Config/build.json']);
  // On a case-sensitive one they are different files, none of them an input (untracked, so not the tracked-change rule).
  assert.deepEqual(guard(['Package.json'], false), []);
  assert.deepEqual(guard(['SRC/new.js'], false), []);
  assert.deepEqual(guard(['claude.md'], false, { contractSource: 'CLAUDE.md' }), []);
  assert.deepEqual(guard(['Config/build.json'], false, { contract: declared }), []);
  // Candidate membership is keyed the same way.
  for (const ci of BOTH) {
    assert.deepEqual(treeGuardRefusals({ files: ['src/a.js'], candidate: new Set(['src/a.js']), contract: C, caseInsensitive: ci }), [], `${ci}`);
  }
  assert.deepEqual(treeGuardRefusals({ files: ['src/a.js'], candidate: new Set(['SRC/A.js']), contract: C, caseInsensitive: true }), []);
});

test('stage 1: admission spreads a refusal across a case variant only where the case rule makes it one file', () => {
  const fixed = { group_id: 'G-1', disposition: 'fixed', files: ['src/Foo.mjs'], cluster: 'a' };
  const refusedSibling = { group_id: 'G-2', disposition: 'not-fixed', files: ['src/foo.mjs'], cluster: 'b' };
  const admit = (ci) => admitGroups({ groups: [fixed, refusedSibling], confirmed: ['G-1', 'G-2'], contract: C, caseInsensitive: ci });
  assert.deepEqual(admit(true).plannable.map((g) => g.group_id), [], 'one file: G-1 shares it with a refused group');
  assert.deepEqual(admit(false).plannable.map((g) => g.group_id), ['G-1'], 'two files: nothing shared');
});

test('stage 1: the planner converts to git\'s spelling BEFORE grouping, so two spellings of one file are one cluster', () => {
  const status = { files: ['src/foo.mjs', 'tests/a.test.mjs'], refused: [] };
  const a = { group_id: 'G-1', disposition: 'fixed', cluster: 'a', files: ['src/Foo.mjs', 'tests/a.test.mjs'] };
  const b = { group_id: 'G-2', disposition: 'fixed', cluster: 'b', files: ['src/foo.mjs'] };
  const ci = planClusterCommits({ groups: [a, b], status, contract: C, caseInsensitive: true });
  assert.equal(ci.length, 1, 'one cluster on a case-insensitive platform');
  assert.deepEqual([...ci[0].accepted].sort(), ['src/foo.mjs', 'tests/a.test.mjs'], 'git\'s spelling is committed');
  const cs = planClusterCommits({ groups: [a, b], status, contract: C, caseInsensitive: false });
  assert.equal(cs.length, 2, 'separate on a case-sensitive one');
  const ofA = cs.find((c) => c.groups.includes('G-1'));
  assert.ok(ofA.refused.some((r) => r.path === 'src/Foo.mjs'), 'and the variant is refused there');
});

test('stage 1: a file dirty before the remediation, reported in another case, is still left to the operator', () => {
  const status = { files: ['src/a.js', 'tests/a.test.mjs'], refused: [] };
  const g = { group_id: 'G-1', disposition: 'fixed', files: ['SRC/a.js', 'tests/a.test.mjs'] };
  const [c] = planClusterCommits({ groups: [g], status, dirtyAtStart: ['src/a.js'], contract: C, caseInsensitive: true });
  assert.equal(c.committable, false);
  assert.ok(c.refused.some((r) => /changed before the remediation began/.test(r.reason)), JSON.stringify(c.refused));
});

// G-5/G-6 of 20261014-022857-ccb-delivery: the start-state sets kept their raw spelling and were compared exactly.
test('stage 1: a file dirty at the start in ANOTHER spelling than git now reports is still the operator\'s', () => {
  const status = { files: ['src/A.js', 'tests/a.test.mjs'], refused: [] };
  const g = { group_id: 'G-1', disposition: 'fixed', files: ['src/A.js', 'tests/a.test.mjs'], red_evidence: 'red.log' }; // a fix with a test shows its red (two-ledger-mediums AC1)
  const plan = (ci) => planClusterCommits({ groups: [g], status, dirtyAtStart: ['src/a.js'], contract: C, caseInsensitive: ci })[0];
  assert.equal(plan(true).committable, false, 'one file on a case-insensitive file system');
  assert.ok(plan(true).refused.some((r) => r.path === 'src/A.js' && /changed before the remediation began/.test(r.reason)), JSON.stringify(plan(true).refused));
  assert.equal(plan(false).committable, true, 'two files on a case-sensitive one');
});

test('stage 1: a repository refused at the start still refuses its files after a case-only respelling', () => {
  const status = { files: ['src/vendor/x.js', 'tests/a.test.mjs'], refused: [] };
  const g = { group_id: 'G-1', disposition: 'fixed', files: ['src/vendor/x.js', 'tests/a.test.mjs'], red_evidence: 'red.log' }; // a fix with a test shows its red (two-ledger-mediums AC1)
  const plan = (ci, refused = []) => planClusterCommits({ groups: [g], status: { ...status, refused }, refusedAtStart: [{ path: 'src/Vendor/' }],
    contract: C, caseInsensitive: ci })[0];
  assert.ok(plan(true).refused.some((r) => r.path === 'src/vendor/x.js' && /refused at the start/.test(r.reason)), JSON.stringify(plan(true).refused));
  assert.equal(plan(false).committable, true);
  const now = plan(true, [{ path: 'SRC/vendor/' }]);
  assert.ok(now.refused.some((r) => r.path === 'src/vendor/x.js' && /a repository, not a file/.test(r.reason)), JSON.stringify(now.refused));
});

// G-14 of 20261014-022857-ccb-delivery: a retry's "still in the tree" was an exact string comparison.
test('stage 1: a retry asks whether a cluster\'s files are still changed by the path key, through one decision', async () => {
  const chain = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(typeof chain.anyStillChanged, 'function', 'remediation-chain exports anyStillChanged');
  assert.equal(chain.anyStillChanged(['src/A.js'], ['src/a.js'], { caseInsensitive: true }), true);
  assert.equal(chain.anyStillChanged(['src/A.js'], ['src/a.js'], { caseInsensitive: false }), false);
  assert.equal(chain.anyStillChanged(['src\\a.js'], ['src/a.js'], { caseInsensitive: false }), true);
  assert.throws(() => chain.anyStillChanged(['a'], ['a']), /caseInsensitive/);
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  assert.doesNotMatch(src, /changedNow\.has\(/, 'stillChanged compares exactly');
  assert.match(src, /anyStillChanged\([^)]*caseInsensitive: CASE_INSENSITIVE/);
});

// G-9 of 20261014-022857-ccb-delivery; the plan's stage 1 amendment (operator, 2026-10-14: "Git's core.ignorecase
// (Recommended)"): the platform hard-codes macOS as case-insensitive, and a case-sensitive volume exists.
test('stage 1: the remediation path\'s case rule is the repository\'s core.ignorecase, absent meaning false', async () => {
  const chain = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(typeof chain.gitIgnoresCase, 'function', 'remediation-chain exports gitIgnoresCase');
  assert.equal(chain.gitIgnoresCase({ status: 0, stdout: 'true\n' }), true);
  assert.equal(chain.gitIgnoresCase({ status: 0, stdout: 'false\n' }), false);
  assert.equal(chain.gitIgnoresCase({ status: 1, stdout: '' }), false, 'unset: git created the repository case-sensitive');
  assert.throws(() => chain.gitIgnoresCase({ status: 128, stdout: '', stderr: 'fatal: bad config' }), /core\.ignorecase/);
  assert.throws(() => chain.gitIgnoresCase({ status: 0, stdout: 'maybe\n' }), /core\.ignorecase/);
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  assert.match(src, /const CASE_INSENSITIVE = [^\n]*gitIgnoresCase\(git\('config', '--bool', 'core\.ignorecase'\)\)/);
  assert.doesNotMatch(src, /caseInsensitiveFs/, 'the platform\'s file-system flag no longer decides here');
});

// G-11 of 20261014-143305-ccb-remediation-review: the code moved to core.ignorecase and the owning contract and its
// remediate.mjs row still named the platform's case rule (caseInsensitiveFs) — I-9 of that run.
test('stage 1: the documents name the repository\'s core.ignorecase as the remediation path\'s case rule', () => {
  const contract = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  const exception = contract.slice(contract.indexOf('**One stated exception:**'), contract.indexOf('- **What the intent node reads'));
  assert.ok(exception.length > 0, 'the exception is found');
  assert.match(exception, /core\.ignorecase/, 'the exception names the repository\'s core.ignorecase');
  assert.doesNotMatch(exception, /caseInsensitiveFs|platform's case rule/, 'the exception names the superseded platform flag');
  const row = contract.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs` |'));
  assert.ok(row, 'the remediate.mjs row is found');
  assert.doesNotMatch(row, /platform's case rule/, 'the remediate.mjs row names the superseded platform rule');
  assert.match(row, /core\.ignorecase/);
  const chain = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'remediation-chain.mjs'), 'utf8');
  assert.doesNotMatch(chain, /platform's case rule/);
  assert.throws(() => pathKey('a'), /core\.ignorecase/, 'pathKey\'s refusal names where the flag comes from');
});

test('stage 1: the evidence gate finds the red\'s file among the group\'s files by key', () => {
  const ev = {
    r: { admitted: 'test_one', file: 'tests/A.test.mjs', exit: 1, timed_out: false, captured: '2026-10-14T10:00:00.000Z' },
    g: { admitted: 'test_one', file: 'tests/A.test.mjs', exit: 0, timed_out: false, captured: '2026-10-14T10:05:00.000Z' },
  };
  const group = { red_evidence: 'r', green_evidence: 'g', files: ['src/a.js', 'tests/a.test.mjs'] };
  assert.equal(evidenceRefusal(group, ev, C, { caseInsensitive: true }), null);
  assert.match(evidenceRefusal(group, ev, C, { caseInsensitive: false }), /not a test file this group commits/);
});

test('stage 1: remediate.mjs passes the repository\'s case flag at every call of a path-comparing decision', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  for (const fn of ['treeGuardRefusals', 'admitGroups', 'planClusterCommits']) {
    const calls = [...src.matchAll(new RegExp(`${fn}\\(\\{([\\s\\S]*?)\\}\\)`, 'g'))];
    assert.ok(calls.length > 0, `${fn} is called`);
    for (const m of calls) assert.match(m[1], /caseInsensitive/, `a ${fn} call omits the case flag`);
  }
  assert.match(src, /core\.ignorecase/, 'the flag comes from the repository (the plan\'s stage 1 amendment)');
});

// ---------------------------------------------------------------------------------------------- stage 2: the allow-list
// D1 (operator, 2026-10-14: "Allow-list (Recommended)"): a name reaches code the remediator wrote only if it is a
// process basic of the platform, the git identity, or declared in review.candidate_env. The deny-list missed one more
// variable each round: the runtime auth, secret names, SSH_AUTH_SOCK and the git-config tuple, GIT_CONFIG_PARAMETERS.

test('stage 2: each platform declares its process basics and whether environment names fold', async () => {
  const { interfaceGaps } = await import('../scripts/platform/interface.mjs');
  const { win32 } = await import('../scripts/platform/win32/index.mjs');
  const { linux } = await import('../scripts/platform/linux/index.mjs');
  const { macos } = await import('../scripts/platform/macos/index.mjs');
  for (const [p, ci] of [[win32, true], [linux, false], [macos, false]]) {
    assert.deepEqual(interfaceGaps(p), [], p.name);
    assert.ok(Array.isArray(p.processEnvBasics) && p.processEnvBasics.includes('PATH'), `${p.name}: PATH is a basic`);
    assert.equal(p.caseInsensitiveEnv, ci, `${p.name}: caseInsensitiveEnv`);
  }
  assert.ok(win32.processEnvBasics.includes('SystemRoot'), 'Windows needs SystemRoot to start a process');
  // libuv copies these from the parent into every child it starts on Windows, so the allow-list must name them all or
  // the candidate check's environment is wider than it says (G-18 of 20261014-022857-ccb-delivery found LOGONSERVER).
  const winBasics = win32.processEnvBasics.map((n) => n.toUpperCase());
  for (const n of ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'PATH', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR']) {
    assert.ok(winBasics.includes(n), `${n}: libuv adds it to every Windows child`);
  }
  assert.ok(linux.processEnvBasics.includes('HOME'));
});

const TRAPS = {
  PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't', GITHUB_TOKEN: 'g', SSH_AUTH_SOCK: '/s',
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: 'Authorization: x',
  GIT_CONFIG_PARAMETERS: "'http.extraheader=Authorization: x'", Git_Config_Count: '1', FOO: 'opaque',
  QUORATE_RUN_ID: 'pin', QUORATE_HOME: '/q', GRAPH_NODE_DEPTH: '0', GIT_AUTHOR_NAME: 'a', GIT_COMMITTER_EMAIL: 'c', JAVA_HOME: '/j', UV_CACHE_DIR: '/u',
};

test('stage 2: candidateEnvFor admits only the basics, the git identity and the declared names', async () => {
  const { candidateEnvFor } = await import('../scripts/lib/decisions.mjs');
  const keys = (o) => Object.keys(o).sort();
  const basics = ['PATH', 'HOME'];
  assert.deepEqual(keys(candidateEnvFor(TRAPS, { basics, declared: [], caseInsensitiveEnv: false })),
    ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_EMAIL', 'HOME', 'PATH', 'QUORATE_HOME'], 'QUORATE_HOME crosses: capture itself runs in this env');
  assert.deepEqual(keys(candidateEnvFor(TRAPS, { basics, declared: ['JAVA_HOME', 'UV_*'], caseInsensitiveEnv: false })),
    ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_EMAIL', 'HOME', 'JAVA_HOME', 'PATH', 'QUORATE_HOME', 'UV_CACHE_DIR']);
  // Windows names fold: `Path` is PATH there, and `Git_Config_Count` is a reserved git-config name, never admitted.
  const win = candidateEnvFor({ Path: 'C:/w', Git_Config_Count: '1', java_home: '/j' }, { basics, declared: ['JAVA_HOME'], caseInsensitiveEnv: true });
  assert.deepEqual(keys(win), ['Path', 'java_home']);
  assert.throws(() => candidateEnvFor(TRAPS), /basics|caseInsensitiveEnv/, 'the platform context is required');
});

test('stage 2: review.candidate_env has a grammar, and may never admit a name the runner always removes', async () => {
  const { candidateEnvErrors } = await import('../scripts/lib/decisions.mjs');
  assert.deepEqual(candidateEnvErrors(undefined), []);
  assert.deepEqual(candidateEnvErrors([]), []);
  assert.deepEqual(candidateEnvErrors(['JAVA_HOME', 'UV_*', 'LC_*']), []);
  for (const bad of [['*'], [''], ['FOO*'], ['1A'], ['A-B'], ['GIT_*'], ['GIT_CONFIG_PARAMETERS'], ['git_config_count'],
    ['SSH_AUTH_SOCK'], ['ANTHROPIC_API_KEY'], ['GRAPH_NODE_DEPTH'], ['QUORATE_RUN_ID'], ['QUORATE_FACTS_FILE'], ['GRAPH_*'], ['QUORATE_*'],
    ['JAVA_HOME', 'java_home'], 'JAVA_HOME', [3]]) {
    assert.ok(candidateEnvErrors(bad).length > 0, `${JSON.stringify(bad)} is accepted`);
  }
});

test('stage 2: new-run and preflight refuse a candidate_env outside the grammar, naming the key', (t) => {
  for (const script of ['new-run.mjs', 'preflight.mjs']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-candenv-mint-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""', 'review:', '  candidate_env: ["GIT_*"]'].join('\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
    const args = script === 'new-run.mjs'
      ? ['--slug', 'ce', '--repo-root', dir, '--no-request', '--no-verify-sandbox', '--full-sweep', 'src'] : ['--repo-root', dir];
    const r = runScript(script, args, { cwd: dir });
    assert.notEqual(r.status, 0, `${script} accepted GIT_*`);
    assert.match(r.output, /review\.candidate_env/, script);
  }
});

// ---------------------------------------------------------------------------------------------- stages 5-6: documents
const doc = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const candidateSection = () => doc('shared/remediation.md').split('## The candidate check is the check of the whole')[1] ?? '';

test('stage 5: the depth guard is a stated residual, not a boundary (D4, "Stated residual")', () => {
  assert.match(candidateSection(), /GRAPH_NODE_DEPTH[\s\S]{0,200}can reset[\s\S]{0,80}residual, not a boundary/);
});

test('stage 6: shared/remediation.md describes the candidate environment as an allow-list, not a deny-list', () => {
  const s = candidateSection();
  assert.match(s, /allow-list/);
  assert.match(s, /review\.candidate_env/);
  assert.doesNotMatch(s, /every\s+secret-shaped name are dropped/, 'the deny-list description is gone');
});

test('stage 6: the contract doc documents review.candidate_env and the remediate row names it', () => {
  const c = doc('shared/claude-md-contract.md');
  assert.match(c, /\*\*`review\.candidate_env`\*\*/, 'the key has its own entry');
  const row = c.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';
  assert.match(row, /review\.candidate_env/);
  assert.match(row, /allow-list/);
});

// G-16 of 20261014-022857-ccb-delivery: the doc said only Windows folds, but the mint-time refusals fold everywhere.
test('stage 6: the contract doc says the duplicate and reserved-name refusals compare case-folded on every platform', async () => {
  const { candidateEnvErrors } = await import('../scripts/lib/decisions.mjs');
  assert.ok(candidateEnvErrors(['FOO', 'foo']).length > 0, 'the code folds the duplicate check');
  assert.ok(candidateEnvErrors(['anthropic_api_key']).length > 0, 'and the reserved check');
  const c = doc('shared/claude-md-contract.md').split('**`review.candidate_env`**')[1].split('\n\n')[0].replace(/\s+/g, ' ');
  assert.match(c, /case-folded on every platform/);
});

// G-12 of 20261014-022857-ccb-delivery: remediate.mjs's fullCheck docblock still described the replaced deny-list.
test('stage 6: remediate.mjs describes the candidate check\'s environment as the allow-list', () => {
  const src = doc('scripts/remediate.mjs');
  const block = src.slice(src.lastIndexOf('/**', src.indexOf('async function fullCheck(')), src.indexOf('async function fullCheck('));
  assert.doesNotMatch(block, /less every secret-shaped name/);
  assert.match(block.replace(/\s+\*\s*/g, ' '), /allow-list/);
});

// G-1 of 20261014-022857-ccb-delivery: the runtime's auth names were restated in CANDIDATE_RESERVED beside their owner.
test('stage 2: the candidate check\'s reserved names take the runtime\'s auth from its one owner, CHILD_ENV_KEEP', async () => {
  const src = doc('scripts/lib/decisions.mjs');
  const reserved = src.slice(src.indexOf('const CANDIDATE_RESERVED'), src.indexOf('const isReservedCandidateName'));
  assert.match(reserved, /\.\.\.CHILD_ENV_KEEP/);
  for (const n of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) assert.ok(!reserved.includes(`'${n}'`), `${n} is restated`);
  const { candidateEnvErrors, candidateEnvFor } = await import('../scripts/lib/decisions.mjs');
  for (const n of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) {
    assert.ok(candidateEnvErrors([n]).length > 0, `${n} may be declared`);
    assert.deepEqual(Object.keys(candidateEnvFor({ [n]: 'x' }, { basics: [], declared: [n], caseInsensitiveEnv: false })), [], `${n} crosses`);
  }
});

// G-14 of 20261020-105833-ciss-remediation-2-review: candidateEnvErrors never applied the secret shape, so a declared
// MY_API_KEY was accepted and forwarded to code the remediator wrote; and a declared prefix forwarded MY_API_KEY under MY_*.
test('G-14: review.candidate_env refuses a secret-shaped name, and a declared prefix forwards none', async () => {
  const { candidateEnvErrors, candidateEnvFor } = await import('../scripts/lib/decisions.mjs');
  for (const n of ['MY_API_KEY', 'GITHUB_TOKEN', 'DB_PASSWORD', 'SERVICE_SECRET_*']) {
    assert.match(candidateEnvErrors([n]).join('\n'), /secret-shaped/, `${n} may be declared`);
  }
  assert.deepEqual(candidateEnvErrors(['QUORATE_ACORN_DIR', 'MY_*']), [], 'a plain name or prefix is still accepted');
  const env = candidateEnvFor({ MY_DIR: '/d', MY_API_KEY: 's' }, { basics: [], declared: ['MY_*'], caseInsensitiveEnv: false });
  assert.deepEqual(Object.keys(env), ['MY_DIR'], 'a secret-shaped name crossed under a declared prefix');
});

test('stage 6: the template ships candidate_env empty, with its comment', () => {
  assert.match(doc('CLAUDE.template.md'), /^\s+candidate_env: \[\]\s+#/m);
});

test('stage 6: remediation-verification.plan.md\'s environment amendments point at this plan', { skip: privateRecord('.claude/requests/remediation-verification.plan.md') }, () => {
  assert.match(doc('.claude/requests/remediation-verification.plan.md'), /candidate-check-boundaries\.plan\.md/);
});
