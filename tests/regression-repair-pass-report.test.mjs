// THE REPAIR PASS'S BRIEF AND REPORT (remediation-repair-pass.plan.md stage 1; design RP-D1 A, operator 2026-11-01: "1 a").
// The runner's full check refused two remediations in a row (20261101-072512-dr-remediation, 20261101-075544-dr-remediation-2)
// on tests the node never ran, and nothing handed those failures to anything allowed to fix them. The repair pass hands
// them back to the node: these tests hold what it is told (every failing test, read from the check's log, with its file),
// the shape it answers in, and the reader that refuses a report that does not answer what it was given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { failingTestsWithFiles, failingTestNames } from '../scripts/lib/full-check.mjs';
import { repairReportErrors, repairFailingLines, repairGreenErrors } from '../scripts/lib/remediation-chain.mjs';
import { renderTemplate } from '../scripts/lib/template.mjs';
import { readTemplate } from '../scripts/io/template.mjs';

const SRC = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// Cut from the full check's log of 20261101-075544-dr-remediation-2 (evidence/remediation-runner/test.log): node:test's spec
// summary names each failing test's file on the line before it.
const LOG = [
  'ℹ tests 3607', 'ℹ fail 2', '', '✖ failing tests:', '',
  'test at tests\\regression-confined-read-adoption.test.mjs:368:1',
  '✖ run-dir-reads stage 2: every read in scripts/ goes through the owner or is named, with its reason or its stage (1672.0783ms)',
  '  AssertionError [ERR_ASSERTION]: reads neither through the owner nor named here:', '',
  'test at tests\\regression-decide.test.mjs:901:1',
  '✖ a decision seat silent for a usage limit is recorded as quota in its round, and is silence, not a vote (12.5ms)',
  '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:', '',
].join('\n');

test('stage 1: every failing test the log names is read with its file, in forward slashes', () => {
  const got = failingTestsWithFiles(LOG);
  assert.deepEqual(got, [
    { name: 'run-dir-reads stage 2: every read in scripts/ goes through the owner or is named, with its reason or its stage', file: 'tests/regression-confined-read-adoption.test.mjs' },
    { name: 'a decision seat silent for a usage limit is recorded as quota in its round, and is silence, not a vote', file: 'tests/regression-decide.test.mjs' },
  ]);
  // The same names the refusal already reads, so the two readers cannot disagree about which tests failed.
  assert.deepEqual(got.map((t) => t.name), failingTestNames(LOG));
});

// G-12 of 20261102-033648-rrp-remediation-review: the name reader stopped at 50, so a repair brief, which must list every
// failing test the log names, left out the 51st and later.
test('G-12: every failing test the log names reaches the repair brief, past the fiftieth', () => {
  const names = Array.from({ length: 60 }, (_, i) => `t${i} holds`);
  const log = ['✖ failing tests:', '', ...names.flatMap((n, i) => [`test at tests\\t${i}.test.mjs:1:1`, `✖ ${n} (1ms)`])].join('\n');
  assert.equal(failingTestNames(log).length, 60);
  assert.equal(failingTestsWithFiles(log).length, 60);
  assert.match(repairFailingLines(failingTestsWithFiles(log)), /t59 holds/);
});

// G-5 of 20261102-044855-rrp-remediation-2-review: the names were deduplicated by display name alone, so two failing tests
// of one name in different files reached the repair brief as one, the second file's left out.
test('G-5: two failing tests of one name in different files both reach the repair brief, each with its file', () => {
  const log = ['✖ failing tests:', '', 'test at tests\\a.test.mjs:1:1', '✖ the guard holds (1ms)',
    'test at tests\\b.test.mjs:9:1', '✖ the guard holds (2ms)', 'test at tests\\b.test.mjs:9:1', '✖ the guard holds (2ms)'].join('\n');
  assert.deepEqual(failingTestsWithFiles(log), [
    { name: 'the guard holds', file: 'tests/a.test.mjs' },
    { name: 'the guard holds', file: 'tests/b.test.mjs' },
  ]);
  assert.match(repairFailingLines(failingTestsWithFiles(log)), /b\.test\.mjs/);
  // The reader and the green check take each as its own test, told apart by test_file (two helpers, one rule).
  const failing = failingTestsWithFiles(log);
  const ans = (test_file, ev) => ({ test_name: 'the guard holds', test_file, disposition: 'fixed', cluster: 'c1', green_evidence: ev });
  const rep = (failures) => repairReportErrors({ run_id: 'r', pass: 1, failures }, { runId: 'r', pass: 1, clusterIds: ['c1'], failing, caseInsensitive: false });
  assert.deepEqual(rep([ans('tests/a.test.mjs', 'evidence/remediation/repair1-a.txt'), ans('tests/b.test.mjs', 'evidence/remediation/repair1-b.txt')]), []);
  assert.ok(rep([ans('tests/a.test.mjs', 'x')]).some((e) => /failing, not reported \(tests\/b\.test\.mjs\)/.test(e)), 'one answer covered two failing tests');
  assert.ok(rep([ans(null, 'x'), ans('tests/b.test.mjs', 'y')]).some((e) => /name which/.test(e)), 'an answer naming no file was taken for one of two');
  const facts = { 'evidence/remediation/repair1-b.txt': { admitted: 'test_one', outcome: 'passed', file: 'tests/b.test.mjs' } };
  assert.deepEqual(repairGreenErrors([ans('tests/b.test.mjs', 'evidence/remediation/repair1-b.txt')], facts, { pass: 1, failing, caseInsensitive: false }), []);
  assert.equal(repairGreenErrors([ans('tests/a.test.mjs', 'evidence/remediation/repair1-b.txt')], facts, { pass: 1, failing, caseInsensitive: false }).length, 1,
    'a green of b.test.mjs was taken for a.test.mjs\'s test');
  assert.equal(repairGreenErrors([ans(null, 'evidence/remediation/repair1-b.txt')], facts, { pass: 1, failing, caseInsensitive: false }).length, 1);
});

test('stage 1: a failing test whose file the log does not name is kept, its file null', () => {
  assert.deepEqual(failingTestsWithFiles('not ok 3 - the guard holds\n'), [{ name: 'the guard holds', file: null }]);
  assert.deepEqual(failingTestsWithFiles(''), []);
});

// G-13 of 20261102-033648-rrp-remediation-review: a pass refused because git could not be read, before or after the node,
// was recorded with started_at and its outcome only, though a refused pass keeps its times in repair_passes[].
test('G-13: every refused repair pass is recorded with its end time', () => {
  const src = SRC('scripts/remediate.mjs');
  const body = src.slice(src.indexOf('async function repairPasses('), src.indexOf('\n}\n', src.indexOf('async function repairPasses(')));
  const refused = [...body.matchAll(/record\(\{[^\n]*outcome: 'refused'[^\n]*/g)].map((m) => m[0]);
  assert.ok(refused.length > 0, 'no refused record found in repairPasses');
  const bare = refused.filter((l) => !/ended_at|\.\.\.timing/.test(l));
  assert.deepEqual(bare, [], `a refused pass is recorded with no end time:\n${bare.join('\n')}`);
});

// G-14 of 20261102-044855-rrp-remediation-2-review: shared/claude-md-contract.md documents node_exit, node_state and
// changed on every repair_passes entry, and the refusals before the node was spawned recorded none of the three.
test('G-14: every refused repair pass records node_exit, node_state and changed', () => {
  const src = SRC('scripts/remediate.mjs');
  const body = src.slice(src.indexOf('async function repairPasses('), src.indexOf('\n}\n', src.indexOf('async function repairPasses(')));
  const refused = [...body.matchAll(/record\(\{[^\n]*outcome: 'refused'[^\n]*/g)].map((m) => m[0]);
  assert.ok(refused.length > 0, 'no refused record found in repairPasses');
  const ran = body.match(/const ran = \{([^}]*)\}/)?.[1] ?? '';
  const timing = body.match(/const timing = \{([^}]*)\}/)?.[1] ?? '';
  const has = (l, f) => new RegExp(`\\b${f}\\b`).test(l) || (/\.\.\.ran\b/.test(l) && new RegExp(`\\b${f}\\b`).test(ran))
    || (/\.\.\.timing\b/.test(l) && new RegExp(`\\b${f}\\b`).test(timing)) || (/\.\.\.notRun\b/.test(l) && new RegExp(`\\b${f}\\b`).test(body.match(/const notRun = \{([^}]*)\}/)?.[1] ?? ''));
  const short = refused.filter((l) => !['node_exit', 'node_state', 'changed'].every((f) => has(l, f)));
  assert.deepEqual(short, [], `a refused pass is recorded without the documented fields:\n${short.join('\n')}`);
});

// G-8 of 20261102-044855-rrp-remediation-2-review: each full check's record read its test log three times, once per
// reading, on the first check and again on every repair pass's.
test('G-8: a full check\'s record reads its test log once for its counts and names', async () => {
  const src = SRC('scripts/remediate.mjs');
  const at = src.indexOf('const results = {};');
  const block = src.slice(at, src.indexOf('\n  }\n', at));
  assert.doesNotMatch(block, /countTestsInLog|countFailuresInLog|failingNamesInLog/, 'the record still reads the log once per reading');
  assert.match(block, /logCountsInLog\(runDir, log\)/);
  const os = await import('node:os');
  const path = await import('node:path');
  const dc = await import('../scripts/io/declared-checks.mjs');
  const { logCountsInLog } = dc;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g8-'));
  try {
    fs.writeFileSync(path.join(dir, 'test.log'), 'ℹ tests 3\nℹ fail 1\n\n✖ failing tests:\n\ntest at tests\\a.test.mjs:1:1\n✖ the guard holds (1ms)\n');
    // The same readings the three readers give, from one read.
    assert.deepEqual(logCountsInLog(dir, 'test.log'), { tests: dc.countTestsInLog(dir, 'test.log'),
      failing: dc.countFailuresInLog(dir, 'test.log'), failing_names: dc.failingNamesInLog(dir, 'test.log') });
    assert.deepEqual(logCountsInLog(dir, 'test.log').failing_names, ['the guard holds']);
    assert.deepEqual(logCountsInLog(dir, 'gone.log'), { tests: null, failing: null, failing_names: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('stage 1: the repair brief fills every slot and carries no group work list', () => {
  const text = renderTemplate(readTemplate('remediation-repair-brief.md'), {
    run_id: '20261101-000000-x', pass: '1', cap: '1', failing: repairFailingLines([{ name: 'the guard holds', file: 'tests/a.test.js' }]),
    log_path: 'evidence/remediation-runner/test.log', clusters: '- c1: src/a.js, tests/a.test.js',
    capture_cmd: 'node capture.mjs -- <command>', test_one: 'test_one: node --test {file}', limits: 'limits: 30 minutes',
  }, 'remediation-repair-brief.md');
  assert.doesNotMatch(text, /\{\{/, 'a slot was left unfilled');
  for (const s of ['- test_name: the guard holds\n  test_file: tests/a.test.js', 'evidence/remediation-runner/test.log', 'c1: src/a.js']) assert.ok(text.includes(s), s);
  assert.doesNotMatch(text, /the guard holds \(tests/, 'the name and its file are on one line again');
  assert.doesNotMatch(text, /Work list|reconciled_md/, 'the repair brief restates the first pass\'s group work list');
});

test('stage 1: the node\'s contract has a Repair pass section, and the repair schema is its own variant', () => {
  const prompt = SRC('prompts/remediation/PROMPT.md');
  assert.match(prompt, /^## Repair pass$/m);
  const spawn = SRC('scripts/spawn-node.mjs');
  assert.match(spawn, /variant === 'remediation-repair'/, 'spawn-node builds no remediation-repair schema');
  // The group report is left as it was: its rows stay keyed by group_id.
  assert.match(spawn, /required: \['group_id', 'disposition'/);
  assert.match(SRC('shared/claude-md-contract.md'), /remediation-repair/, 'the contract does not document the repair report');
});

const failing = [{ name: 'the guard holds', file: 'tests/a.test.js' }, { name: 'quota is silence', file: 'tests/b.test.js' }];
const good = () => ({ schema_version: 1, run_id: 'R', pass: 1, summary: 's', failures: [
  { test_name: 'the guard holds', test_file: 'tests/a.test.js', disposition: 'fixed', reason: 'routed through io', cluster: 'c1',
    files: ['src/a.js'], green_evidence: 'evidence/remediation/repair1-a.log' },
  { test_name: 'quota is silence', test_file: 'tests/b.test.js', disposition: 'not-fixed', reason: 'outside my globs', cluster: 'c1',
    files: [], green_evidence: '' },
] });
const ctx = { runId: 'R', pass: 1, clusterIds: ['c1'], failing, caseInsensitive: false };

test('stage 1: a repair report answering every failing test, in a known cluster, is read clean', () => {
  assert.deepEqual(repairReportErrors(good(), ctx), []);
});

test('stage 1: a repair report that does not answer what it was given is refused, naming why', () => {
  const cases = [
    [(p) => { p.run_id = 'other'; }, /names run other/],
    [(p) => { p.pass = 2; }, /pass 2, not 1/],
    [(p) => { p.failures.pop(); }, /quota is silence: failing, not reported/],
    [(p) => { p.failures[0].test_name = 'a test that did not fail'; }, /a test that did not fail: reported, but not among the failing tests/],
    [(p) => { p.failures[0].cluster = 'c9'; }, /cluster c9 is not one of this run's clusters/],
    [(p) => { p.failures[0].green_evidence = ''; }, /fixed with no green_evidence/],
    [(p) => { p.failures.push({ ...p.failures[0] }); }, /reported twice/],
  ];
  for (const [mutate, re] of cases) {
    const p = good();
    mutate(p);
    const errs = repairReportErrors(p, ctx);
    assert.ok(errs.some((e) => re.test(e)), `${re}: ${JSON.stringify(errs)}`);
  }
  assert.deepEqual(repairReportErrors(null, ctx), ['the repair pass returned no report']);
});

// G-13 of 20261102-024315-rrp-delivery (G-8, G-14 its symptoms): a fixed answer's green was admitted when it sat anywhere
// under evidence/remediation/, and its file was checked only against the answer's own test_file, skipped when null. The
// green is bound to this pass's capture name and to the file the failing log named, not to what the report says.
test('G-13: a repair green is this pass\'s own capture of the failing test\'s file, whatever the report claims', () => {
  const facts = (file) => ({ admitted: 'test_one', outcome: 'passed', file });
  const ok = { test_name: 'the guard holds', test_file: 'tests/a.test.js', disposition: 'fixed', green_evidence: 'evidence/remediation/repair1-a.log' };
  const check = (f, fact, opts = {}) => repairGreenErrors([f], { [f.green_evidence]: fact }, { pass: 1, failing, caseInsensitive: false, ...opts });
  assert.deepEqual(check(ok, facts('tests/a.test.js')), []);
  // test_file null no longer skips the file check: the failing log named tests/a.test.js.
  assert.equal(check({ ...ok, test_file: null }, facts('tests/z.test.js')).length, 1, 'test_file null admitted another file\'s green');
  // A report naming another file than the log's is refused even when its capture matches its own claim.
  assert.equal(check({ ...ok, test_file: 'tests/z.test.js' }, facts('tests/z.test.js')).length, 1, 'a self-reported test_file was trusted');
  // The first pass's capture, another pass's, and a path climbing out of the folder are not this pass's green.
  for (const g of ['evidence/remediation/green.txt', 'evidence/remediation/repair2-a.log', 'evidence/remediation/repair1-../../x.log',
    'evidence/remediation/../remediation/repair1-a.log', 'evidence\\remediation\\repair1-a.log\\..\\green.txt']) {
    assert.equal(check({ ...ok, green_evidence: g }, facts('tests/a.test.js')).length, 1, `${g} was admitted as pass 1's green`);
  }
  // G-8: the report itself is refused for naming another file than the log's.
  const p = good(); p.failures[0].test_file = 'tests/z.test.js';
  assert.ok(repairReportErrors(p, ctx).some((e) => /test_file tests\/z\.test\.js, but the failing log names tests\/a\.test\.js/.test(e)));
  // Where the log named no file, the report's test_file is required and the capture must run it.
  const unnamed = [{ name: 'the guard holds', file: null }];
  assert.deepEqual(check(ok, facts('tests/a.test.js'), { failing: unnamed }), []);
  assert.equal(check({ ...ok, test_file: null }, facts('tests/a.test.js'), { failing: unnamed }).length, 1);
  // Not passing, or not test_one, is refused as before.
  assert.equal(check(ok, { ...facts('tests/a.test.js'), outcome: 'failed' }).length, 1);
  assert.equal(check(ok, undefined).length, 1);
  // Case-insensitive file systems compare file keys without case.
  assert.deepEqual(check(ok, facts('Tests/A.test.js'), { caseInsensitive: true }), []);
});

// Case 3 of the repair-pass bench (20261030-191916-ciss-remaining-remediation): the brief listed each failing test as
// "- <name> (<file>)" and the node copied that whole line into test_name, so the reader, which matches names exactly,
// refused a pass whose fix may have been right. The name is given on a line of its own, labelled, and a node that takes
// that line's value exactly is read clean.
test('the repair brief names each failing test on its own labelled line, and the name read back from it is accepted', () => {
  const failing = [{ name: 'G-5: the preserved run\'s own root is refused as a link before run.json is read from it',
    file: 'tests/regression-bench-second-opinion-preserved-root.test.mjs' }, { name: 'a test whose file the log omits', file: null }];
  const brief = renderTemplate(readTemplate('remediation-repair-brief.md'), {
    run_id: 'R', pass: '1', cap: '1', failing: repairFailingLines(failing), log_path: 'evidence/remediation-runner/test.log',
    clusters: '- c2: scripts/bench-second-opinion.mjs', capture_cmd: 'c', test_one: 't', limits: 'l',
  }, 'remediation-repair-brief.md');
  // As a node reads it: each list entry's name is the value of its first line, after the label when there is one.
  const read = [...brief.matchAll(/^- (?:test_name: )?(.+)$/gm)].map((m) => m[1]).filter((n) => !n.startsWith('c2:'));
  const answers = read.map((n) => ({ test_name: n, test_file: null, disposition: 'not-fixed', reason: 'r', cluster: 'c2', files: [], green_evidence: '' }));
  assert.deepEqual(repairReportErrors({ run_id: 'R', pass: 1, failures: answers }, { runId: 'R', pass: 1, clusterIds: ['c2'], failing, caseInsensitive: false }), []);
  assert.match(brief, /test_file: tests\/regression-bench-second-opinion-preserved-root\.test\.mjs/);
  assert.match(brief, /test_file: not named in the log/);
});
