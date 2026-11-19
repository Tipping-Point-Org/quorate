// Part 2 of 2 of regression-bench-repair-pass.test.mjs: cases recorded as unreadable, errors or unknown, and the stored
// results. Split by split-slow-test-files.md; the fixture is bench-repair-pass-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runScript, mintedRunDir } from './helpers.mjs';
import { repairBenchSummary } from '../scripts/lib/repair-bench.mjs';
import { git, fakeNode, SUITE, refusedCase, replayOf, freshRemediation } from './bench-repair-pass-fixture.mjs';

// G-6 of 20261102-161123-rbr-delivery: the checked-files artifact was parsed with no guard, so a missing one threw before
// the case was recorded and aborted every later --case.
test('G-6: a case whose checked-files artifact is gone or unreadable is recorded not-rebuildable, and later cases still run', (t) => {
  const f = refusedCase(t);
  const run = JSON.parse(fs.readFileSync(path.join(f.rem, 'run.json'), 'utf8'));
  const check = run.full_checks.find((c) => (c.refusals ?? []).length);
  fs.writeFileSync(path.join(f.rem, ...check.files_at.split(/[\\/]/)), '{ not json');
  const r = runScript('bench-repair-pass.mjs', ['--repo-root', f.repo, '--case', path.basename(f.rem), '--case', 'no-such-run',
    '--runtime-bin', f.bin, '--results', f.results], { cwd: f.repo, env: f.env });
  assert.equal(r.status, 0, r.output);
  const root = path.join(f.base, 'home', 'bench-repair');
  const results = fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'result.json')))
    .map((n) => JSON.parse(fs.readFileSync(path.join(root, n, 'result.json'), 'utf8')));
  const mine = results.find((c) => c.case === path.basename(f.rem));
  assert.equal(mine?.status, 'not-rebuildable', JSON.stringify(results));
  assert.match(mine.why, /checked-files/);
  assert.ok(results.some((c) => c.case === 'no-such-run' && c.status === 'not-found'), 'the later case did not run');
});

// The class of G-6: any other record of the case that is gone (here its node's report) throws inside the case, and must
// be that case's error, not an abort of the cases after it.
test('G-6 class: a case whose node report is gone is recorded as an error, and later cases still run', (t) => {
  const f = refusedCase(t);
  fs.rmSync(path.join(f.rem, 'evidence', 'remediation', 'payload.json'));
  const r = runScript('bench-repair-pass.mjs', ['--repo-root', f.repo, '--case', path.basename(f.rem), '--case', 'no-such-run',
    '--runtime-bin', f.bin, '--results', f.results], { cwd: f.repo, env: f.env });
  assert.equal(r.status, 0, r.output);
  const root = path.join(f.base, 'home', 'bench-repair');
  const results = fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'result.json')))
    .map((n) => JSON.parse(fs.readFileSync(path.join(root, n, 'result.json'), 'utf8')));
  assert.equal(results.find((c) => c.case === path.basename(f.rem))?.status, 'error', JSON.stringify(results));
  assert.ok(results.some((c) => c.case === 'no-such-run' && c.status === 'not-found'), 'the later case did not run');
  assert.equal(git(f.repo, 'worktree', 'list', '--porcelain').stdout.match(/^worktree /gm).length, 1, 'the worktree was left behind');
});

// G-7 of 20261102-161123-rbr-delivery: numstat's "-" for a binary file (or a failed diff) was coerced to 0, so the diff
// was understated with no sign of it. An unknown file's count makes the diff unknown, printed n/a.
test('G-7: a repair that changes a binary file records its diff as unknown, not as zero lines', (t) => {
  const f = refusedCase(t);
  const r = runScript('bench-repair-pass.mjs', ['--repo-root', f.repo, '--case', path.basename(f.rem), '--runtime-bin', f.bin, '--results', f.results],
    { cwd: f.repo, env: { ...f.env, FAKE_BINARY: '1' } });
  assert.equal(r.status, 0, r.output);
  const c = f.caseResult();
  assert.equal(c.status, 'measured', JSON.stringify(c));
  assert.equal(c.diff, null, `the binary file's diff was counted: ${JSON.stringify(c.diff)}`);
  assert.ok((c.diff_unknown ?? []).some((u) => u.path === 'src/b.bin'), JSON.stringify(c.diff_unknown));
});

// G-12 of 20261102-161123-rbr-delivery: a pass's why text reached the tracked results table with no redaction.
test('G-12: the results table goes through the redaction owner before it is written', (t) => {
  const f = refusedCase(t);
  const secret = `AKIA${'Q'.repeat(16)}`;
  const dir = path.join(f.base, 'home', 'bench-repair', '20261102T000000-x');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ case: 'x', started_at: '1', status: 'measured', green_after: 'never', cap: 3,
    passes: [{ pass: 1, outcome: 'refused', why: `the test printed ${secret}` }] }));
  const r = runScript('bench-repair-pass.mjs', ['--repo-root', f.repo, '--results', f.results], { cwd: f.repo, env: f.env });
  assert.equal(r.status, 0, r.output);
  const md = fs.readFileSync(f.results, 'utf8');
  assert.match(md, /pass 1 not admitted/);
  assert.ok(!md.includes(secret), 'a secret-shaped value reached the results table');
});

// G-5 of 20261102-161123-rbr-delivery: the case directory was the start time cut to whole seconds plus the id, so two
// attempts of one id in one second shared a directory and the second overwrote the first's result.
test('G-5: two attempts of one case in the same second are both recorded', (t) => {
  const f = refusedCase(t);
  const r = runScript('bench-repair-pass.mjs', ['--repo-root', f.repo, '--case', 'no-such-run', '--case', 'no-such-run', '--case', 'no-such-run',
    '--runtime-bin', f.bin, '--results', f.results], { cwd: f.repo, env: f.env });
  assert.equal(r.status, 0, r.output);
  const root = path.join(f.base, 'home', 'bench-repair');
  const dirs = fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'result.json')));
  assert.equal(dirs.length, 3, `attempts shared a directory: ${JSON.stringify(dirs)}`);
});

// G-2 of 20261102-173413-rbr-remediation-review: the case directory was named from the raw --case value before the
// per-case try, so an id holding a separator or ":" threw out of the bench and aborted every later case.
test('G-2: a --case holding a separator or ":" is recorded as that case, and later cases still run', (t) => {
  const f = refusedCase(t);
  const r = runScript('bench-repair-pass.mjs', ['--repo-root', f.repo, '--case', 'a/b', '--case', 'c:d', '--case', 'no-such-run',
    '--runtime-bin', f.bin, '--results', f.results], { cwd: f.repo, env: f.env });
  assert.equal(r.status, 0, r.output);
  const root = path.join(f.base, 'home', 'bench-repair');
  const results = fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'result.json')))
    .map((n) => JSON.parse(fs.readFileSync(path.join(root, n, 'result.json'), 'utf8')));
  for (const id of ['a/b', 'c:d']) assert.ok(results.some((c) => c.case === id && c.status), `${id} was not recorded: ${JSON.stringify(results)}`);
  assert.ok(results.some((c) => c.case === 'no-such-run' && c.status === 'not-found'), 'the later case did not run');
});

// G-2 of 20261102-184751-rbr-remediation-2-review: the name replaced only \ / : NUL, so a --case holding a character
// Windows refuses in a name (? * " < > |), or one too long for a name, still threw out of the bench before the per-case
// guard. Every such case is recorded as itself, and the cases after it run.
test('G-2: a --case holding a name-forbidden character, or too long for a name, is recorded, and later cases still run', (t) => {
  const f = refusedCase(t);
  const odd = ['a?b', 'x*y', 'q"r', 'l<m>n|o', 'dot.', `${'z'.repeat(300)}`];
  const r = runScript('bench-repair-pass.mjs', ['--repo-root', f.repo, ...odd.flatMap((c) => ['--case', c]), '--case', 'no-such-run',
    '--runtime-bin', f.bin, '--results', f.results], { cwd: f.repo, env: f.env });
  assert.equal(r.status, 0, r.output);
  const root = path.join(f.base, 'home', 'bench-repair');
  const results = fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'result.json')))
    .map((n) => JSON.parse(fs.readFileSync(path.join(root, n, 'result.json'), 'utf8')));
  for (const id of odd) assert.ok(results.some((c) => c.case === id && c.status), `${id.slice(0, 20)} was not recorded`);
  for (const n of fs.readdirSync(root)) assert.match(n, /^[A-Za-z0-9_-]{1,120}$/, `an attempt directory name is not a plain one: ${n}`);
  assert.ok(results.some((c) => c.case === 'no-such-run' && c.status === 'not-found'), 'the later case did not run');
});

// G-5 of 20261102-184751-rbr-remediation-2-review: a stored record whose passes is not an array passed the object guard,
// and the summary's passes.map threw, so the table was not written from the rest.
test('G-5: a stored record whose passes is not an array is listed as unreadable, and the table is still written', (t) => {
  const f = refusedCase(t);
  const root = path.join(f.base, 'home', 'bench-repair');
  fs.mkdirSync(path.join(root, '20261102T000000-badpasses'), { recursive: true });
  fs.writeFileSync(path.join(root, '20261102T000000-badpasses', 'result.json'), JSON.stringify({ case: 'bad-passes', started_at: '1',
    status: 'measured', green_after: 'never', cap: 3, passes: {} }));
  fs.mkdirSync(path.join(root, '20261102T000001-good'), { recursive: true });
  fs.writeFileSync(path.join(root, '20261102T000001-good', 'result.json'), JSON.stringify({ case: 'good-case', started_at: '2',
    status: 'not-found', why: 'gone', cap: 3 }));
  const r = runScript('bench-repair-pass.mjs', ['--repo-root', f.repo, '--results', f.results], { cwd: f.repo, env: f.env });
  assert.equal(r.status, 0, r.output);
  const md = fs.readFileSync(f.results, 'utf8');
  assert.match(md, /good-case/);
  assert.match(md, /20261102T000000-badpasses: unreadable/);
});

// G-3 of 20261102-173413-rbr-remediation-review: the candidate's blobs are checked in one batch, and one git no longer
// holds still makes the case not-rebuildable, naming that file and only it.
test('G-3: a candidate blob git no longer holds is named, the held ones are not', (t) => {
  const f = refusedCase(t);
  const run = JSON.parse(fs.readFileSync(path.join(f.rem, 'run.json'), 'utf8'));
  const check = run.full_checks.find((c) => (c.refusals ?? []).length);
  const at = path.join(f.rem, ...check.files_at.split(/[\\/]/));
  const cand = JSON.parse(fs.readFileSync(at, 'utf8'));
  assert.ok(cand['src/a.js'] && cand['tests/a.test.js'], JSON.stringify(cand));
  fs.writeFileSync(at, JSON.stringify({ ...cand, 'src/a.js': 'f'.repeat(40) }));
  const r = f.bench();
  assert.equal(r.status, 0, r.output);
  const c = f.caseResult();
  assert.equal(c.status, 'not-rebuildable', JSON.stringify(c));
  assert.match(c.why, /git no longer holds the candidate's src\/a\.js$/);
});

// G-5 of 20261102-173413-rbr-remediation-review: the table parsed every stored result.json with no guard, so one corrupt
// record stopped the table being written from the rest.
test('G-5: a corrupt stored result.json is listed as unreadable, and the table is still written from the rest', (t) => {
  const f = refusedCase(t);
  const root = path.join(f.base, 'home', 'bench-repair');
  fs.mkdirSync(path.join(root, '20261102T000000-bad'), { recursive: true });
  fs.writeFileSync(path.join(root, '20261102T000000-bad', 'result.json'), '{ not json');
  fs.mkdirSync(path.join(root, '20261102T000001-good'), { recursive: true });
  fs.writeFileSync(path.join(root, '20261102T000001-good', 'result.json'), JSON.stringify({ case: 'good-case', started_at: '2',
    status: 'not-found', why: 'gone', cap: 3 }));
  const r = runScript('bench-repair-pass.mjs', ['--repo-root', f.repo, '--results', f.results], { cwd: f.repo, env: f.env });
  assert.equal(r.status, 0, r.output);
  const md = fs.readFileSync(f.results, 'utf8');
  assert.match(md, /good-case/);
  assert.match(md, /20261102T000000-bad: unreadable/);
});
