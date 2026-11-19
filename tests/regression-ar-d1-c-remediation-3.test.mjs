// Regression tests for remediation 20261105-024055-ar-d1-c-remediation-3, of review
// 20261105-021654-ar-d1-c-remediation-2-review. Each test names the group it pins and the defect it prevents.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const junction = (target, at) => fs.symlinkSync(target, at, 'junction');

// G-2 and G-17: check-intent-grant and resume-run chose the adapter table's default runtime and never read the
// contract's review.runtime, so the grant probe tested, and a resume reopened with, an adapter the run did not use.
for (const [group, file] of [['G-2', 'scripts/check-intent-grant.mjs'], ['G-17', 'scripts/resume-run.mjs']]) {
  test(`${group}: ${file} chooses the runtime as new-run does, review.runtime first`, () => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(src, /defaultNodeRuntime\(/, 'the runtime is the table default, review.runtime ignored');
    // The owner since contract-runtime-and-session-files.plan.md stage 1 is selectAdapters, given the whole contract.
    assert.match(src, /selectAdapters\(\{ contract/, 'the runtime is not chosen through the owner that reads review.runtime');
    assert.match(src, /ADAPTERS\.runtime/, 'the runtime is not the owner\'s');
  });
}

// G-10 of 20261105-061926-crsf-remediation-review (panel-codex-docs): the G-2 loop above matches source text only, so a dead
// or unrelated occurrence of it kept the test green while check-intent-grant's executable wiring chose another runtime.
// Run for real, armed, in a repository whose contract declares a runtime the table lacks: the probe must refuse it,
// naming it, before it builds its fixture or spawns anything. Ignoring review.runtime would pass the table's default.
test('G-10: check-intent-grant, run, refuses the review.runtime its contract declares when the table lacks it', async () => {
  const { runScript } = await import('./helpers.mjs');
  const { spawnSync } = await import('node:child_process');
  const dir = tmp('cig-runtime-');
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n  build: ""\n'
      + '  test: ""\nreview:\n  runtime: nosuch\n  models: { judgment: opus, mechanical: sonnet }\n  effort: { judgment: low }\n'
      + 'ui:\n  surface: none\n```\n');
    git('add', '-A'); git('commit', '-qm', 'init');
    const fake = path.join(dir, 'fake-runtime.mjs');
    const marker = path.join(dir, 'spawned.txt');
    fs.writeFileSync(fake, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'x');\n`);
    const r = runScript('check-intent-grant.mjs', ['--runtime-bin', fake], { cwd: dir, env: { QUORATE_LIVE: '1', GRAPH_NODE_DEPTH: '0' } });
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /review\.runtime 'nosuch' is not in the adapter table/, r.output);
    assert.equal(fs.existsSync(marker), false, 'the runtime was spawned before the declared runtime was checked');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-15: readRecords listed record roots with raw readdirSync and confined only at each file's parent, so a junction at
// .claude led it to read an outside folder's records as this repository's telemetry.
test('G-15: a junction at .claude is refused by readRecords, not followed to outside records', async () => {
  const { readRecords } = await import('../scripts/io/telemetry-record.mjs');
  const base = tmp('rr-link-');
  try {
    const repo = path.join(base, 'repo'); const out = path.join(base, 'outside', '.claude');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(path.join(out, 'claim-checks', 'c1'), { recursive: true });
    fs.writeFileSync(path.join(out, 'claim-checks', 'c1', 'telemetry.json'), JSON.stringify({ kind: 'claim-check', record_id: 'outside' }));
    junction(out, path.join(repo, '.claude'));
    const { records, unreadable } = readRecords(repo);
    assert.equal(records.length, 0, 'an outside record was read through the junction');
    assert.ok(unreadable.some((u) => /link or junction/.test(u)), `the junction was not named: ${unreadable.join(' | ')}`);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// G-14: writeClaimCheckRecord confined at the check folder itself, so a junction at .claude led its write outside.
test('G-14: writeClaimCheckRecord refuses a check folder reached through a junction at .claude', async () => {
  const { writeClaimCheckRecord } = await import('../scripts/io/telemetry-record.mjs');
  const base = tmp('cc-link-');
  try {
    const repo = path.join(base, 'repo'); const out = path.join(base, 'outside', '.claude');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(path.join(out, 'claim-checks', 'c1'), { recursive: true });
    fs.writeFileSync(path.join(out, 'claim-checks', 'c1', 'check.json'), '{}');
    junction(out, path.join(repo, '.claude'));
    const r = writeClaimCheckRecord(path.join(repo, '.claude', 'claim-checks', 'c1'), { repoRoot: repo });
    assert.equal(r.ok, false, 'the record was written through the junction');
    assert.match(r.note, /link or junction/);
    assert.ok(!fs.existsSync(path.join(out, 'claim-checks', 'c1', 'telemetry.json')), 'a record was written outside the repository');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// G-13: a missing steps.jsonl was recorded as journal_unparsed_lines: 0, a measured zero where nothing was measured.
test('G-13: a claim check with no journal records journal_unparsed_lines as null, not 0', async () => {
  const { writeClaimCheckRecord } = await import('../scripts/io/telemetry-record.mjs');
  const repo = tmp('cc-nojournal-');
  try {
    const dir = path.join(repo, '.claude', 'claim-checks', 'c1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'check.json'), '{}');
    const r = writeClaimCheckRecord(dir, { repoRoot: repo });
    assert.equal(r.ok, true, r.note);
    const rec = JSON.parse(fs.readFileSync(r.path, 'utf8'));
    assert.equal(rec.journal_unparsed_lines, null, 'an absent journal was recorded as a measured zero');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

// G-11: clearRunState ignored the bind lock, so a stop landing inside a bind had its state written back by the binder.
test('G-11: clearRunState does not remove the state while a bind holds the lock', async () => {
  const { clearRunState, runStatePath } = await import('../scripts/io/run-state.mjs');
  const home = tmp('rs-home-'); const repo = tmp('rs-repo-');
  try {
    const p = runStatePath(repo, { home });
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{}');
    fs.writeFileSync(`${p}.bind`, '1');
    assert.throws(() => clearRunState(repo, { home }), /bind/, 'a stop inside a bind went ahead');
    assert.ok(fs.existsSync(p), 'the state was removed under a held bind lock');
    fs.rmSync(`${p}.bind`);
    clearRunState(repo, { home });
    assert.ok(!fs.existsSync(p), 'with the lock free the state is removed');
    assert.ok(!fs.existsSync(`${p}.bind`), 'the stop left its lock behind');
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); }
});

// G-9: readRunState read run-state.json raw, so a link at the file itself was followed to outside JSON.
// Where a file symlink needs a privilege the host lacks, a junction at the file's name stands in: the raw read followed it
// to the directory it leads to (EISDIR), the owner refuses it as a link.
test('G-9: readRunState refuses a link at run-state.json', async () => {
  const { readRunState, runStatePath } = await import('../scripts/io/run-state.mjs');
  const home = tmp('rs-home-'); const repo = tmp('rs-repo-'); const outDir = tmp('rs-out-');
  try {
    const p = runStatePath(repo, { home });
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const outside = path.join(outDir, 'state.json');
    fs.writeFileSync(outside, '{}');
    try { fs.symlinkSync(outside, p, 'file'); } catch (e) { if (e.code !== 'EPERM') throw e; junction(outDir, p); }
    assert.throws(() => readRunState(repo, { home }), /link or junction/);
  } finally { for (const d of [home, repo, outDir]) fs.rmSync(d, { recursive: true, force: true }); }
});

// G-12: readFreshness caught every read and parse failure as a missing cache, so a corrupt cache was silently discarded.
test('G-12: readFreshness says a cache that does not parse, and null only for a missing one', async () => {
  const { readFreshness, freshnessPath } = await import('../scripts/io/run-state.mjs');
  const home = tmp('fr-home-');
  try {
    assert.equal(readFreshness({ home }), null);
    fs.writeFileSync(freshnessPath({ home }), '{not json');
    assert.throws(() => readFreshness({ home }), /cli-freshness\.json/, 'a corrupt cache was taken for a missing one');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

const behindCache = (key) => ({ checked_day: '2026-11-05', table_key: key,
  adapters: { codex: { state: 'behind', installed: '0.1.0', latest: '0.2.0', behind_since: '2026-10-01' } } });

// G-7: on a table-key mismatch the old table's adapter entry was carried into freshnessStep, so the CLI the new table
// runs inherited the old one's behind_since and was reported overdue at once.
test('G-7: a new adapter table starts its CLIs\' history afresh', async () => {
  const { checkFreshness } = await import('../scripts/io/cli-freshness.mjs');
  const { writeFreshness } = await import('../scripts/io/run-state.mjs');
  const home = tmp('fr-key-');
  try {
    writeFreshness({ ...behindCache('ANOTHER-TABLE'), checked_day: '2026-10-01' }, { home });
    const run = (c) => ({ ok: true, version: c.version_argv.includes('@openai/codex') ? '0.2.0' : (c.cmd === 'codex' ? '0.1.0' : '1.0.0') });
    const lines = checkFreshness({ home, now: new Date('2026-11-05T12:00:00Z'), run, declared: {} });
    assert.deepEqual(lines, [], `the old table's behind_since was inherited: ${lines.join(' | ')}`);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// G-6: the cache-only read (the hooks') never compared table_key, so a hook printed another table's update notices.
test('G-6: a cache-only read prints nothing from a cache computed for another adapter table', async () => {
  const { checkFreshness } = await import('../scripts/io/cli-freshness.mjs');
  const { writeFreshness } = await import('../scripts/io/run-state.mjs');
  const home = tmp('fr-only-');
  try {
    writeFreshness(behindCache('ANOTHER-TABLE'), { home });
    const lines = checkFreshness({ home, cacheOnly: true, now: new Date('2026-11-05T12:00:00Z'), declared: {} });
    assert.deepEqual(lines, [], `another table's notice was printed: ${lines.join(' | ')}`);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// G-18: `run-session status` read the state with no try, so an unreadable state crashed with a stack trace where the hook
// says the state could not be read.
test('G-18: run-session status says an unreadable state rather than crashing', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/run-session.mjs'), 'utf8');
  const branch = /cmd === 'status'\) \{([\s\S]*?)\} else if/.exec(src)?.[1] ?? '';
  assert.match(branch, /try \{[^}]*readRunState\(repoRoot\)[^}]*\} catch \(e\) \{ die\(`the run state could not be read/, 'the status read is not caught');
});

// G-16: a decision record carries string-valued `agreement` and `sample`, and neither was in the string fields the record
// contract calls exhaustive.
test('G-16: every string field of a decision record is a declared record string field', async () => {
  const { buildDecisionRecord, RECORD_STRING_FIELDS } = await import('../scripts/lib/telemetry-record.mjs');
  const rec = buildDecisionRecord('20261105-000000-d', { first: { outcome: 'A', agreement: 'majority', rounds: 1 }, sample: { mark: 'right' } });
  const strays = [];
  const walk = (o) => { for (const [k, v] of Object.entries(o)) { if (typeof v === 'string' && !RECORD_STRING_FIELDS.includes(k)) strays.push(k); else if (v && typeof v === 'object') walk(v); } };
  walk(rec);
  assert.deepEqual(strays, [], `undeclared string fields: ${strays.join(', ')}`);
});

// G-3: the reset text was cut from the reviewer's raw output and written into the panel JSON unredacted, so a credential
// after "try again" was persisted in the run's artifacts.
test('G-3: a quota failure\'s reset text is redacted where it is extracted', async () => {
  const { quotaOf, resetTextOf } = await import('../scripts/lib/quota.mjs');
  const token = `ghp_${'a1B2c3D4e5'.repeat(4).slice(0, 36)}`;
  const text = `usage limit reached; try again in ${token} hours`;
  assert.doesNotMatch(resetTextOf(text) ?? '', /ghp_[A-Za-z0-9]{36}/, 'the token was kept in the reset text');
  assert.doesNotMatch(quotaOf(text, ['usage limit'])?.reset_text ?? '', /ghp_[A-Za-z0-9]{36}/, 'the token reached the quota note');
  assert.equal(resetTextOf('limit hit, try again at 4:10 PM.'), '4:10 PM', 'a reset time is still reported as written');
});

// G-5: the detached refresh swallowed the child's error event after recording its start, so a refresh that never ran
// suppressed every retry for the retry window, silently.
test('G-5: a refresh whose spawn fails does not hold off the next one', async () => {
  const { refreshFreshnessDetached } = await import('../scripts/io/cli-freshness.mjs');
  const { readFreshness } = await import('../scripts/io/run-state.mjs');
  const home = tmp('fr-fail-');
  try {
    const failing = () => ({ on(ev, fn) { if (ev === 'error') fn(Object.assign(new Error('spawn failed'), { code: 'ENOENT' })); }, unref() {} });
    const now = new Date('2026-11-05T10:00:00Z');
    refreshFreshnessDetached({ home, now, spawn: failing, declared: {} });
    assert.equal(readFreshness({ home })?.refresh_started_at, undefined, 'a failed spawn left its start recorded');
    assert.equal(refreshFreshnessDetached({ home, now: new Date(now.getTime() + 1000), spawn: failing, declared: {} }), true, 'the retry was suppressed by a refresh that never ran');
    const throwing = () => { throw new Error('EINVAL'); };
    assert.throws(() => refreshFreshnessDetached({ home, now: new Date(now.getTime() + 2000), spawn: throwing, declared: {} }), /EINVAL/);
    assert.equal(readFreshness({ home })?.refresh_started_at, undefined, 'a spawn that threw left its start recorded');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// G-6, the callers: both hooks hand the cache-only read the table they run, so it can compare the key.
const cacheOnlyCallsPassDeclared = (src) => {
  const calls = [...src.matchAll(/checkFreshness\(\{([^}]*cacheOnly:\s*true[^}]*)\}/g)];
  assert.ok(calls.length > 0, 'no cache-only checkFreshness call found: the check would pass on nothing');
  for (const m of calls) assert.match(m[1], /declared/, `checkFreshness({${m[1]}}) reads the cache with no table`);
};
for (const file of ['scripts/stop-guard.mjs', 'scripts/run-session.mjs']) {
  test(`G-6: ${file} passes its adapter declarations to the cache-only read`, () => {
    cacheOnlyCallsPassDeclared(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  });
}
// G-21 of 20261105-052942-crsf-delivery (panel-codex-arch): the loop never asserted a call was found, so deleting the
// cache-only read left the test green on zero iterations.
test('G-21: the G-6 check fails on a file with no cache-only read', () => {
  assert.throws(() => cacheOnlyCallsPassDeclared('const x = 1;\n'), /no cache-only/);
});
