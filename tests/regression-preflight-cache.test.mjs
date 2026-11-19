// THE PRE-FLIGHT WAS RE-RUN EVERY REVIEW, AND THE ESCAPE HATCH WAS SILENT.
//
// Two defects, one fix. `--skip-preflight` was documented in skills/full-review/SKILL.md as
// "reuses an earlier barrier result" and implemented at run-graph.mjs as PURE OMISSION: the block
// was skipped, checks.json was never read back, nothing validated that any reused result described
// the same tree, and nothing was stamped. On a fresh mint there was no earlier result at all, so
// the gate went out SILENT about declared `build` and `test` having never run — declared commands,
// no result, nothing in not_checked[]. Silence standing in for a verdict, in the one project named
// for refusing that.
//
// UNBUILT and UNTESTED do not cover it: they fire only when a command is EMPTY IN THE CONTRACT
// (run-checks.mjs, new-run.mjs), never when a declared check did not run.
//
// The other half is cost. story-pipeline's declared `test` is 2,866 tests at roughly seven minutes,
// paid before every review including one scoped to a single lens.
//
// TWO INDEPENDENT INVALIDATION RULES, which is the part a loose implementation gets wrong. A
// cross-family critique and this engine's own author both argued that the barrier class (`build`)
// must be EXCLUDED from the cache — "If a build is skipped via cache on a dirty tree, downstream
// lenses may waste tokens analyzing code that fundamentally does not parse." The operator overruled
// it and named the confusion: "one thing is one thing another is another. The fact that build is
// cached do not prevent it to be invalidated if the worktree is dirty". Being CACHEABLE and being
// INVALIDATED are separate rules and both hold. Tests 2 and 5 below are that pair, and they are the
// two that must never be merged into one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, REPO_ROOT } from './helpers.mjs';
import {
  preflightInputHash, preflightDecision, preflightStamps, preflightNotChecked,
  readPreflightCache, writePreflightCache, MANIFEST_HEURISTIC,
} from '../scripts/io/preflight-cache.mjs';
import { CAPPING_STAMPS, stampCaps } from '../scripts/lib/decisions.mjs';
// The host-bound one, as new-run mints with it: it keys the repository as the filesystem spells it (8.3, CI run 43281517496).
import { defaultReviewsRoot } from '../scripts/io/reviews-root.mjs';

// ---------------------------------------------------------------------------------- the decision

const CONTRACT = {
  commands: { build: 'node ok.js', test: 'node ok.js' },
  source_globs: ['src/**'],
  test_globs: ['t/**'],
};

function tree(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-pfc-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 't'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(root, 't', 'a.test.js'), 'ok\n');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# c\n');
    fs.writeFileSync(path.join(root, 'README.md'), '# outside every glob\n');
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const hashOf = (root, contract = CONTRACT) =>
  preflightInputHash({ repoRoot: root, contract, contractSource: 'CLAUDE.md' });

const entryFor = (hash, over = {}) => ({
  input_sha256: hash, results: [{ check: 'build', status: 'PASS' }], run_id: 'r-earlier', ...over,
});

test('a clean tree with unchanged inputs reuses the earlier result', () => {
  tree((root) => {
    const { hash } = hashOf(root);
    const d = preflightDecision({ entry: entryFor(hash), hash, dirty: false });
    assert.equal(d.state, 'reuse');
    assert.equal(d.from, 'r-earlier', 'the gate has to be able to name the run the evidence came from');
  });
});

test('a DIRTY worktree is stale even when every declared input hashes identically', () => {
  tree((root) => {
    const { hash } = hashOf(root);
    // Nothing about the input set changed. This is the whole point: the dirt may be OUTSIDE the
    // set, and the declared checks may still read it. Merging this rule into the digest check is
    // exactly the "cached build on a dirty tree" failure two reviewers predicted.
    const d = preflightDecision({ entry: entryFor(hash), hash, dirty: true });
    assert.equal(d.state, 'stale');
    assert.match(d.reason, /dirty/);
  });
});

test('dirty: null — cleanliness unproven — is stale, not clean', () => {
  tree((root) => {
    const { hash } = hashOf(root);
    // new-run records null when `git status` could not be read. Unproven freshness is staleness:
    // absence of evidence that an input changed is not evidence that it did not. Collapsing null
    // into false here would make a repository with no git the one place the cache never expires.
    const d = preflightDecision({ entry: entryFor(hash), hash, dirty: null });
    assert.equal(d.state, 'stale');
    assert.match(d.reason, /could not be established/);
  });
});

test('editing a file INSIDE the input set moves the hash', () => {
  tree((root) => {
    const before = hashOf(root).hash;
    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 2;\n');
    assert.notEqual(hashOf(root).hash, before);
  });
});

test('editing a file OUTSIDE the input set does NOT move the hash', () => {
  tree((root) => {
    const before = hashOf(root).hash;
    // The half that makes the feature worth anything. A README commit must not cost seven minutes
    // of a consuming project's test suite — "a change to something no declared check reads does not
    // invalidate it". A digest over the whole tree would pass every other test here and fail this
    // one, having quietly reinvented "re-run every time".
    fs.writeFileSync(path.join(root, 'README.md'), '# edited, and no declared check reads it\n');
    assert.equal(hashOf(root).hash, before);
    const d = preflightDecision({ entry: entryFor(before), hash: hashOf(root).hash, dirty: false });
    assert.equal(d.state, 'reuse');
  });
});

test('changing a declared COMMAND invalidates the entry', () => {
  tree((root) => {
    const before = hashOf(root).hash;
    // The cached result answers the question the old command asked. Serving a `pytest -x` outcome
    // for `pytest --cov` is a different question with the same tree.
    const after = hashOf(root, { ...CONTRACT, commands: { ...CONTRACT.commands, test: 'node ok.js --cov' } }).hash;
    assert.notEqual(after, before);
    assert.equal(preflightDecision({ entry: entryFor(before), hash: after, dirty: false }).state, 'stale');
  });
});

test('a cached BARRIER FAILURE is a result, and is handed back rather than dropped', () => {
  tree((root) => {
    const { hash } = hashOf(root);
    const d = preflightDecision({ entry: entryFor(hash, { barrier_failed: 'build' }), hash, dirty: false });
    // The decision says "reuse" and the CALLER blocks on barrier_failed. A cache that only ever
    // carries good news is not a cache of the outcome — it is a cache of the passes, which would
    // let a broken build be re-established by a model call every time.
    assert.equal(d.state, 'reuse');
    assert.equal(d.entry.barrier_failed, 'build');
  });
});

test('a malformed or truncated entry reads as ABSENT, never as valid', () => {
  tree((root) => {
    const { hash } = hashOf(root);
    const reviews = path.join(root, '.reviews');
    writePreflightCache(reviews, hash, { results: [{ check: 'build', status: 'PASS' }], run_id: 'r1' });
    assert.ok(readPreflightCache(reviews, hash), 'the round trip has to work or the rest proves nothing');

    // Half-written JSON: the shape a killed process leaves behind. An entry that parsed but carried
    // no results would let a run claim evidence it does not have.
    const p = path.join(reviews, '.preflight-cache', `${hash}.json`);
    fs.writeFileSync(p, '{"input_sha256":"' + hash + '","resul');
    assert.equal(readPreflightCache(reviews, hash), null);
    fs.writeFileSync(p, JSON.stringify({ input_sha256: hash }));
    assert.equal(readPreflightCache(reviews, hash), null, 'an entry with no results is not an entry');
  });
});

test('an empty review.preflight_inputs INFERS the set and says so; declaring it does not', () => {
  tree((root) => {
    assert.equal(hashOf(root).inferred, true);
    assert.equal(hashOf(root, { ...CONTRACT, review: { preflight_inputs: [] } }).inferred, true);
    const declared = hashOf(root, { ...CONTRACT, review: { preflight_inputs: ['src/**'] } });
    assert.equal(declared.inferred, false);
    assert.match(declared.why, /declares what the pre-flight reads/);
  });
});

test('an inferred set folds in a root-level dependency manifest the globs exclude', () => {
  tree((root) => {
    const before = hashOf(root).hash;
    // The case the request names outright: `uv run pytest` behaves differently after `uv.lock`
    // changes, and story-pipeline's source_globs is ["src/storypipe/**"], which excludes it.
    // Deriving the set from the globs alone would call a stale result fresh.
    assert.ok(MANIFEST_HEURISTIC.includes('uv.lock'));
    fs.writeFileSync(path.join(root, 'uv.lock'), 'version = 1\n');
    const withLock = hashOf(root).hash;
    assert.notEqual(withLock, before, 'a lock file appearing is a change to what the checks read');
    fs.writeFileSync(path.join(root, 'uv.lock'), 'version = 2\n');
    assert.notEqual(hashOf(root).hash, withLock, 'and so is its content moving');

    // ...but only under inference. A DECLARED set is exact and is not quietly widened: the whole
    // value of declaring is that the operator said what the checks read.
    const decl = { ...CONTRACT, review: { preflight_inputs: ['src/**'] } };
    const d1 = hashOf(root, decl).hash;
    fs.writeFileSync(path.join(root, 'uv.lock'), 'version = 3\n');
    assert.equal(hashOf(root, decl).hash, d1);
  });
});

test('the stamps and the caps: REUSED does not cap, INFERRED and SKIPPED do', () => {
  assert.deepEqual(preflightStamps({ state: 'ran' }), []);
  assert.deepEqual(preflightStamps({ state: 'reuse', inferred: false }), ['CHECKS-REUSED']);
  assert.deepEqual(preflightStamps({ state: 'reuse', inferred: true }),
    ['CHECKS-REUSED', 'CHECKS-INPUTS-INFERRED']);
  assert.deepEqual(preflightStamps({ state: 'skipped' }), ['CHECKS-SKIPPED']);

  // CHECKS-REUSED is deliberately NOT capping, and the precedent is INTENT-PINNED, which is also
  // uncapped and whose stamp-consequences entry gives the reason in four words: "the inputs are
  // provably unchanged". That sentence covers a DECLARED input set and refuses to stretch over an
  // inferred one — which is why its sibling caps and it does not.
  assert.ok(!CAPPING_STAMPS.includes('CHECKS-REUSED'));
  assert.ok(!CAPPING_STAMPS.includes('INTENT-PINNED'), 'the precedent this rests on must still hold');
  assert.ok(stampCaps(['CHECKS-INPUTS-INFERRED']));
  assert.ok(stampCaps(['CHECKS-SKIPPED']));
  assert.ok(!stampCaps(['CHECKS-REUSED']));
});

test('a skipped pre-flight names EVERY declared command, and an empty one is not named twice', () => {
  const commands = { build: 'make', test: 'pytest', lint: '', fmt_check: '', typecheck: '', audit: '', deny: '' };
  const skipped = preflightNotChecked({ state: 'skipped', commands });
  assert.deepEqual(skipped.map((e) => e.node_id), ['commands.build', 'commands.test'],
    'an EMPTY key is already named by the empty-key rule; naming it here too would say the same gap twice');
  for (const e of skipped) {
    assert.match(e.why, /NOT RUN/);
    assert.match(e.why, /make|pytest/, 'the entry has to name the command, not describe one in the abstract');
  }
  // A plain reuse is not a gap and must not be listed as one; an inferred reuse is.
  assert.deepEqual(preflightNotChecked({ state: 'reuse', inferred: false, commands }), []);
  assert.deepEqual(preflightNotChecked({ state: 'ran', commands }), []);
  const inf = preflightNotChecked({ state: 'reuse', inferred: true, from: 'r-earlier', commands, why: 'because' });
  assert.equal(inf.length, 1);
  assert.match(inf[0].why, /r-earlier/);
});

// ------------------------------------------------------------------------------- the whole path
//
// BEHAVIOUR, NOT SOURCE SHAPE. G-85 is on this repository's record: a regression asserted
// `assert.match(runGraphSource, /TESTS-DID-NOT-RUN/)` and a COMMENT satisfied it, so a stamp
// shipped carrying a consequence it never had — "a source-shape assertion standing in for
// behaviour". Everything below runs the real orchestrator in a throwaway repository and reads only
// what the engine wrote.
//
// `ui.surface: none` plus `--only ui-audit` is the established way to reach the gate for the price
// of a process: ui-audit's condition is `ui.surface != none`, so declaring it deselects the lens
// and NOTHING is billed. Each test asserts the run cost $0.

function fixture(name, { build = 'node ok.js', test: testCmd = 'node ok.js', extra = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quorate-${name}-`));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `quorate-${name}home-`));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'ok.js'), '');
  fs.writeFileSync(path.join(dir, 'bad.js'), 'process.exit(1);\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
    '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n'
    + `  build: "${build}"\n  test: "${testCmd}"\n`
    + 'source_globs: ["src/**"]\n'
    + `${extra}ui:\n  surface: none\n\`\`\`\n`);
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, home, git };
}

/** One review, archived nowhere, so the tree stays clean for the next one. */
function review(f, slug, extraArgs = []) {
  const mint = runScript('new-run.mjs',
    ['--slug', slug, '--no-verify-sandbox', '--no-request', '--full-sweep', '.'],
    { cwd: f.dir, env: { QUORATE_HOME: f.home } });
  assert.equal(mint.status, 0, mint.output.slice(-400));
  const runDir = mintedRunDir(mint.output);
  const graph = runScript('run-graph.mjs',
    ['--run-dir', runDir, '--skip-panel', '--no-archive', '--only', 'ui-audit', ...extraArgs],
    { cwd: f.dir, env: { QUORATE_HOME: f.home } });
  const gatePath = path.join(runDir, 'gate.json');
  return {
    status: graph.status,
    output: graph.output,
    runDir,
    gate: fs.existsSync(gatePath) ? JSON.parse(fs.readFileSync(gatePath, 'utf8')) : null,
    gateMd: fs.existsSync(path.join(runDir, 'gate.md'))
      ? fs.readFileSync(path.join(runDir, 'gate.md'), 'utf8') : '',
  };
}

const cleanup = (f) => {
  for (const d of [f.dir, f.home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
};

test('--preflight never: the gate NAMES the declared commands that did not run, and caps', () => {
  const f = fixture('pfskip');
  try {
    const r = review(f, 'skip', ['--preflight', 'never']);
    assert.match(r.output, /cost:\s+\$0\.0+\b/, `this test must spawn no model:\n${r.output.slice(-600)}`);
    assert.ok(r.gate, 'no gate.json was written');

    // THE DEFECT, STATED AS AN ASSERTION. Before this, every line below was false: the stamp did
    // not exist, the ceiling was untouched, and not_checked[] said nothing at all about two
    // declared commands that had produced no result.
    assert.ok(r.gate.stamps.includes('CHECKS-SKIPPED'), `stamps: ${r.gate.stamps.join(', ')}`);
    assert.equal(r.gate.max_verdict, 'RISK', 'CHECKS-SKIPPED must cap the way UNBUILT caps');
    assert.equal(r.gate.preflight.state, 'skipped');

    const named = (r.gate.buckets?.not_checked ?? []).map((e) => e.node_id ?? e.item);
    for (const k of ['commands.build', 'commands.test']) {
      assert.ok(named.includes(k), `${k} was declared and did not run, and the gate does not name it: ${named.join(', ')}`);
    }
    assert.match(r.gateMd, /Pre-flight \| \*\*SKIPPED\*\*/,
      'the gate a person actually opens has to say it on its face');

    // ...and the stamps that exist for an EMPTY key must not be borrowed to say this. They mean
    // "the project declares no such command", which is a different and false statement here.
    assert.ok(!r.gate.stamps.includes('UNBUILT'));
    assert.ok(!r.gate.stamps.includes('UNTESTED'));
  } finally { cleanup(f); }
});

test('the default runs the checks once, then REUSES them and names the run they came from', () => {
  const f = fixture('pfreuse');
  try {
    const first = review(f, 'once');
    assert.match(first.output, /cost:\s+\$0\.0+\b/);
    assert.equal(first.gate.preflight.state, 'ran', 'a cold cache must execute, not skip');
    assert.match(first.output, /== pre-flight barrier ==/);

    const second = review(f, 'twice');
    assert.equal(second.gate.preflight.state, 'reuse',
      `nothing changed between the runs, so the second must not re-execute:\n${second.output.slice(-800)}`);
    assert.equal(second.gate.preflight.from, path.basename(first.runDir),
      'a reused result must name the run whose tree that evidence describes');
    assert.ok(second.gate.stamps.includes('CHECKS-REUSED'));
    assert.match(second.gateMd, /Pre-flight \| reused from/);

    // This fixture declares source_globs and NOT preflight_inputs, so the set is inferred and the
    // ceiling comes with it. The next test is the same path with the key declared, and it is the
    // pair that shows the ceiling is a consequence of the inference rather than of reuse.
    assert.ok(second.gate.stamps.includes('CHECKS-INPUTS-INFERRED'));
  } finally { cleanup(f); }
});

test('an inferred input set caps the reusing run and says why', () => {
  const f = fixture('pfinfer');
  try {
    review(f, 'seed');
    const r = review(f, 'reuse');
    assert.equal(r.gate.preflight.state, 'reuse', r.output.slice(-800));
    assert.equal(r.gate.preflight.inputs_inferred, true, 'this fixture declares no review.preflight_inputs');
    assert.ok(r.gate.stamps.includes('CHECKS-INPUTS-INFERRED'));
    assert.equal(r.gate.max_verdict, 'RISK');
    const table = r.gate.buckets?.not_checked ?? [];
    const why = table.find((e) => (e.node_id ?? e.item) === 'pre-flight input set');
    assert.ok(why, `the ceiling must be explained in the table: ${JSON.stringify(table)}`);
    assert.match(why.why, /preflight_inputs/, 'and it must say what removes it');
  } finally { cleanup(f); }
});

test('declaring review.preflight_inputs reuses WITHOUT the ceiling', () => {
  const f = fixture('pfdecl', { extra: 'review:\n  preflight_inputs: ["src/**", "ok.js", "CLAUDE.md"]\n' });
  try {
    review(f, 'seed');
    const r = review(f, 'reuse');
    assert.equal(r.gate.preflight.state, 'reuse', r.output.slice(-800));
    assert.equal(r.gate.preflight.inputs_inferred, false);
    assert.ok(!r.gate.stamps.includes('CHECKS-INPUTS-INFERRED'));
    assert.ok(!stampCaps(r.gate.stamps), `nothing should cap this run: ${r.gate.stamps.join(', ')}`);
  } finally { cleanup(f); }
});

test('a cached barrier FAILURE blocks the next run without re-running it', () => {
  const f = fixture('pfbad', { build: 'node bad.js' });
  try {
    const first = review(f, 'broken');
    assert.equal(first.status, 1, 'a failed barrier BLOCKS and exits 1');
    assert.equal(first.gate.gate, 'BLOCKED');

    const second = review(f, 'again');
    assert.equal(second.status, 1);
    assert.equal(second.gate.gate, 'BLOCKED');
    assert.match(second.output, /reused from/,
      `the second run must serve the cached failure rather than re-running it:\n${second.output.slice(-800)}`);
    assert.match(second.gate.reason ?? '', /reused from/);
    // THE REUSE IS RECORDED WHERE EVERY OTHER REUSE IS (G-9 of 20261114-042824-m2-7b-remediation-2-review): the cached
    // failure exited before preflightOutcome and run.json were told, so its gate said `ran` and run.json had no provenance.
    assert.equal(second.gate.preflight.state, 'reuse', 'a reused failure is a reuse at the gate');
    assert.equal(second.gate.preflight.from, path.basename(first.runDir));
    assert.ok(second.gate.stamps.includes('CHECKS-REUSED'), `stamps: ${second.gate.stamps.join(', ')}`);
    const rj = JSON.parse(fs.readFileSync(path.join(second.runDir, 'run.json'), 'utf8'));
    assert.equal(rj.checks_reused_from, path.basename(first.runDir), 'run.json names the run the failure came from');
    assert.match(String(rj.checks_input_sha256 ?? ''), /^[0-9a-f]{64}$/);
  } finally { cleanup(f); }
});

// G-5 and G-6 of 20261114-051141-m2-7b-remediation-3-review: the cached-failure branch was a second copy of the reuse
// transition, so its checks.json lacked the provenance the success path wrote, and its gate exited before
// preflightNotChecked ran, so an inferred input set went undisclosed on a BLOCKED gate. One owner now writes both.
test('G-5: a reused failure records the same provenance and disclosures as a reused pass', () => {
  const f = fixture('pfbadprov', { build: 'node bad.js' });
  try {
    const first = review(f, 'broken');
    assert.equal(first.gate.gate, 'BLOCKED');
    const second = review(f, 'again');
    assert.equal(second.gate.gate, 'BLOCKED');
    assert.equal(second.gate.preflight.state, 'reuse', second.output.slice(-800));
    const checks = JSON.parse(fs.readFileSync(path.join(second.runDir, 'checks.json'), 'utf8'));
    for (const k of ['reused_head_commit', 'reused_worktree_sha', 'inputs_inferred']) {
      assert.ok(Object.hasOwn(checks, k), `checks.json of a reused failure lacks ${k}: ${JSON.stringify(Object.keys(checks))}`);
    }
    assert.equal(checks.inputs_inferred, true, 'the fixture declares no preflight_inputs, so the set is inferred');
    assert.equal(checks.barrier_failed, 'build');
    const named = (second.gate.buckets?.not_checked ?? []).map((e) => e.node_id ?? e.item);
    assert.ok(named.includes('pre-flight input set'),
      `a BLOCKED gate on a reuse over an inferred set must disclose it: ${JSON.stringify(named)}`);
  } finally { cleanup(f); }
});

test('--preflight always re-executes even when the entry is fresh', () => {
  const f = fixture('pfalways');
  try {
    review(f, 'seed');
    const r = review(f, 'forced', ['--preflight', 'always']);
    assert.equal(r.gate.preflight.state, 'ran');
    assert.ok(!r.gate.stamps.includes('CHECKS-REUSED'));
  } finally { cleanup(f); }
});

test('an unrecognised --preflight value is refused rather than defaulted', () => {
  // `--preflight auot` falling through to the default would be a typo that reads as a decision,
  // and the decision it reads as is the permissive one.
  // mayFanOut: the refusal IS the test, and it happens during argument parsing.
  const r = runScript('run-graph.mjs', ['--run-dir', '.', '--preflight', 'auot'], { mayFanOut: true });
  assert.equal(r.status, 2);
  assert.match(r.output, /not one of auto, always, never/);
});

test('--skip-preflight and its documentation agree', () => {
  // The flag said "reuses an earlier barrier result" and delivered omission. Either the behaviour
  // or the sentence had to move; the sentence did, and the promise of reuse now describes the
  // DEFAULT, where it is true. This pins the two together so they cannot drift apart again.
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'full-review', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /--skip-preflight` reuses an earlier/,
    'the old promise is what the flag never delivered');
  assert.match(skill, /--skip-preflight/);
  assert.match(skill, /CHECKS-SKIPPED/,
    'the flag now stamps, and a reader of the skill has to know the gate will be capped');
});

test('a capture REFUSAL is not cached as the project\'s build being broken', () => {
  // FOUND BY RUNNING IT, on the first real seeding of this repository. `evidence_path` is what
  // capture.mjs prints once it has LAUNCHED the command — a failing command still gets one, because
  // the failure is in the log. null means capture never got that far and refused: a bad run
  // directory, or a `--cwd` it had no `host.cwd` to confine. run-checks reads the exit code, and
  // capture's refusal is exit 2, so the row reads FAIL.
  //
  // Cached, that makes an ENGINE FAULT STICKY and dresses it as the tree's verdict: every later run
  // on an unchanged tree is BLOCKED by `barrier_failed: build` without re-running anything. It did
  // exactly that — quorate's own build reported as failing on a tree that compiles.
  const f = fixture('pfnocache');
  try {
    // The shape that produced the defect was a run.json with no host.cwd. capture no longer reads host.cwd (it confines
    // --cwd to the repository it admits the run for, ARCHITECTURE A-28), so the refusal is reproduced another way: the
    // node's run pin names a different run. Staged where the fixture repository's runs are, so run-checks admits it.
    const runDir = path.join(defaultReviewsRoot({ project: 't', repoRoot: f.dir, home: f.home }), '20260101-000000-nohost');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
      run_id: '20260101-000000-nohost',
      repo_root: f.dir,
      contract: { project: 't', commands: { build: 'node ok.js', test: '' }, source_globs: ['src/**'] },
      contract_source: 'CLAUDE.md',
      stamps: [],
    }));

    const r = runScript('run-checks.mjs', ['--run-dir', runDir, '--repo-root', f.dir],
      { cwd: f.dir, env: { QUORATE_HOME: f.home, QUORATE_RUN_ID: '20260101-000000-another' } });
    const checks = JSON.parse(fs.readFileSync(path.join(runDir, 'checks.json'), 'utf8'));
    const build = checks.results.find((x) => x.check === 'build');
    assert.equal(build.evidence_path, null,
      'the fixture must actually reproduce a capture refusal, or this test pins nothing');
    assert.equal(r.status, 1, 'run-checks still reports the barrier as failed — that part is unchanged');

    assert.ok(!fs.existsSync(path.join(path.dirname(runDir), '.preflight-cache')),
      'a result with no evidence describes the engine, not the tree, and must not be cached');
    assert.match(r.output, /not caching this result/,
      'and refusing to cache must be said out loud, or it looks like the cache silently failed');
  } finally { cleanup(f); }
});

// G-10 of 20261114-032609-m2-7b-remediation-review: a result was cached under the hash taken before the checks with no
// look after them, and with no hash given run-checks hashed only after them; either way a tree that moved while the
// checks ran was cached under content they did not all see. Now hashed before and after, and cached only when equal.
test('G-10: inputs that move while the checks run are not cached', () => {
  const f = fixture('pfmoved', { build: 'node mutate.js', test: '' });
  try {
    fs.writeFileSync(path.join(f.dir, 'mutate.js'),
      "require('node:fs').writeFileSync('src/a.js', 'export const a = ' + Date.now() + ';\\n');\n".replace("require('node:fs')", "(await import('node:fs')).default"));
    fs.renameSync(path.join(f.dir, 'mutate.js'), path.join(f.dir, 'mutate.mjs'));
    const runDir = path.join(defaultReviewsRoot({ project: 't', repoRoot: f.dir, home: f.home }), '20260101-000000-moved');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
      run_id: '20260101-000000-moved',
      repo_root: f.dir,
      contract: { project: 't', commands: { build: 'node mutate.mjs', test: '' }, source_globs: ['src/**'] },
      contract_source: 'CLAUDE.md',
      stamps: [],
    }));
    const r = runScript('run-checks.mjs', ['--run-dir', runDir, '--repo-root', f.dir],
      { cwd: f.dir, env: { QUORATE_HOME: f.home, QUORATE_RUN_ID: '20260101-000000-moved' } });
    assert.equal(r.status, 0, r.output.slice(-600));
    assert.notEqual(fs.readFileSync(path.join(f.dir, 'src', 'a.js'), 'utf8'), 'export const a = 1;\n', 'the check must move an input, or this pins nothing');
    assert.ok(!fs.existsSync(path.join(path.dirname(runDir), '.preflight-cache')), 'a result over inputs that moved was cached');
    assert.match(r.output, /not caching this result/);
  } finally { cleanup(f); }
});

test('a reused run can OPEN the logs its stamps were read from', () => {
  // FOUND BY READING A REAL REUSED RUN. Each result in checks.json names an evidence_path like
  // `evidence/pre-flight/build.log`, relative to a run directory — and relative to the REUSING run
  // that file was not there. For an entry seeded by preflight.mjs it existed nowhere at all: the
  // seeder removes its own scratch directory. So a reused run inherited the stamps a log produced
  // (TESTS-THIN, TESTS-FAILING, TESTS-UNCOUNTED) while the log itself was gone — a citation with
  // nothing behind it, in the project whose whole rule is that findings cite evidence on disk.
  const f = fixture('pfevidence');
  try {
    const first = review(f, 'seed');
    assert.equal(first.gate.preflight.state, 'ran');
    const second = review(f, 'reuse');
    assert.equal(second.gate.preflight.state, 'reuse', second.output.slice(-600));
    assert.equal(second.gate.preflight.evidence_restored, true);

    const checks = JSON.parse(fs.readFileSync(path.join(second.runDir, 'checks.json'), 'utf8'));
    const cited = checks.results.filter((r) => r.evidence_path).map((r) => r.evidence_path);
    assert.ok(cited.length >= 2, `nothing was cited, so this test pins nothing: ${JSON.stringify(checks.results)}`);
    for (const rel of cited) {
      assert.ok(fs.existsSync(path.join(second.runDir, rel)),
        `checks.json cites ${rel} and the reusing run does not have it`);
    }
  } finally { cleanup(f); }
});

test('a reuse whose logs are gone still reuses, and NAMES what it cannot show', () => {
  // The other half: refusing to reuse because the logs were pruned would throw away a valid result
  // over a missing convenience, and pretending they are there is the defect above. So it reuses and
  // the gate names the gap.
  const f = fixture('pfevictevidence');
  try {
    review(f, 'seed');
    // Evict only the logs, keeping the entry — what a disk sweep or a partial copy leaves behind.
    const cacheRoot = path.join(f.home, 'reviews');
    const evicted = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name.endsWith('.evidence')) { fs.rmSync(p, { recursive: true, force: true }); evicted.push(p); }
          else walk(p);
        }
      }
    };
    walk(cacheRoot);
    assert.ok(evicted.length, 'the cache stored no evidence, so this test would pass vacuously');

    const r = review(f, 'reuse');
    assert.equal(r.gate.preflight.state, 'reuse', 'a missing log is not a reason to re-run the suite');
    assert.equal(r.gate.preflight.evidence_restored, false);
    const named = (r.gate.buckets?.not_checked ?? []).map((e) => e.node_id ?? e.item);
    assert.ok(named.includes('pre-flight captured output'),
      `the gate must name what it cannot show: ${named.join(', ')}`);
  } finally { cleanup(f); }
});
