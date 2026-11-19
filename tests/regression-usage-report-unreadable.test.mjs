// usage-report.mjs must name what it could not read, never shrink its figures in silence.
//
// G-21 of 20261030-171256-ciss-c-review: readRun's catch returned undefined and the run was skipped like an absent one,
// so a malformed or refused run left every coverage figure understated with no warning, while the comment beside it said
// such a run was "counted as unreadable". G-23: any read or parse failure of ledger.json was swallowed as "none yet", so
// a damaged ledger printed a plausible zero findings.
//
// The script locates the repository from its own path, so it runs here from a copy of scripts/ inside a fixture repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-report-'));
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  const git = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a],
      { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'one');
  const reviews = path.join(dir, '.claude', 'reviews');
  fs.mkdirSync(path.join(reviews, 'good-run'), { recursive: true });
  fs.writeFileSync(path.join(reviews, 'good-run', 'run.json'), JSON.stringify({ run_id: 'good-run', scope: { paths: ['a.txt'] } }));
  fs.mkdirSync(path.join(reviews, 'bad-run'), { recursive: true });
  fs.writeFileSync(path.join(reviews, 'bad-run', 'run.json'), '{ not json');
  return { dir, reviews };
}

function report(dir, extra = []) {
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'usage-report.mjs'), '--json', '--since', '2000-01-01', ...extra],
    { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('G-21: a run whose run.json cannot be read is named as unreadable, not dropped', () => {
  const { dir } = fixture();
  try {
    const rep = report(dir);
    assert.equal(rep.quorate.runs, 1, 'the readable run is counted');
    assert.ok(Array.isArray(rep.quorate.unreadable), 'the report carries the runs it could not read');
    assert.deepEqual(rep.quorate.unreadable.map((u) => [u.run, u.file]), [['bad-run', 'run.json']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-23: a ledger that cannot be parsed is reported, not read as empty; an absent one is still "none yet"', () => {
  const { dir, reviews } = fixture();
  try {
    assert.equal(report(dir).findings.total, 0, 'no ledger: zero findings, as before');
    fs.writeFileSync(path.join(reviews, 'ledger.json'), '{ damaged');
    const rep = report(dir);
    assert.equal(typeof rep.findings.ledger_unreadable, 'string', 'the damaged ledger is named');
    assert.equal(rep.findings.total, null, 'no zero is printed for a ledger that was not read');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-19 of 20261030-190926-ciss-remaining: a --transcripts directory that could not be read returned null, so the report
// dropped the dependence half and told the operator to pass the option they had passed.
test('G-19: a --transcripts directory that cannot be read is named, not reported as absent', () => {
  const { dir } = fixture();
  try {
    const rep = report(dir, ['--transcripts', path.join(dir, 'no-such-dir')]);
    assert.notEqual(rep.dependence, null, 'the dependence half is not dropped as though no option was given');
    assert.equal(typeof rep.dependence.transcripts_unreadable, 'string', 'the unreadable directory is named');
    assert.equal(rep.dependence.asked, null, 'no zero is printed for transcripts that were not read');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-20: a malformed transcript line was skipped with no count, so a damaged transcript gave understated figures.
test('G-20: malformed transcript lines are counted, not dropped in silence', () => {
  const { dir } = fixture();
  try {
    const tdir = path.join(dir, 'transcripts');
    fs.mkdirSync(tdir);
    fs.writeFileSync(path.join(tdir, 's.jsonl'), `${JSON.stringify({ message: { role: 'user', content: 'hi' } })}\n{ broken\n`);
    const rep = report(dir, ['--transcripts', tdir]);
    assert.equal(rep.dependence.malformed_lines, 1, 'the one malformed line is counted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-16: a run that never reached a gate decided nothing, yet its head_commit counted the commit as reviewed.
// G-5 of 20261030-195117-ciss-remaining-remediation-review: the G-16 fix filtered the reviewed commits only, and such a
// run's scope still put the commit "in a swept area" (the fixture's good-run declares a.txt and has no gate).
test('G-16, G-5: a run that reached no gate counts neither its commit as reviewed nor its scope as swept', () => {
  const { dir, reviews } = fixture();
  try {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    const runDir = path.join(reviews, 'aborted-run');
    fs.mkdirSync(runDir);
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: 'aborted-run', head_commit: head, dirty: false }));
    const before = report(dir).commits;
    assert.equal(before.reviewed_at_that_commit, 0, 'a run with no gate is not coverage');
    assert.equal(before.in_a_swept_area_but_not_reviewed, 0, 'the scope of a run with no gate is not a swept area');
    assert.equal(before.never_in_any_run_scope, 1, 'the commit is in no decided run\'s scope');
    fs.writeFileSync(path.join(runDir, 'gate.json'), JSON.stringify({ gate: 'PASS' }));
    assert.equal(report(dir).commits.reviewed_at_that_commit, 1, 'the same run with a gate is');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-1 of 20261030-211052-usage-report-98-review: the gated-run filter was truthiness, so a BLOCKED gate (required work
// that did not report) counted as coverage, against findings-ledger's "anything BLOCKED is not" a review; and a run of a
// dirty tree credited its head commit, a state that was never what it reviewed.
test('G-1: a BLOCKED run is not coverage, and a dirty run does not credit its head commit', () => {
  const { dir, reviews } = fixture();
  try {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    const runDir = path.join(reviews, 'blocked-run');
    fs.mkdirSync(runDir);
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: 'blocked-run', head_commit: head, dirty: false, scope: { paths: ['a.txt'] } }));
    fs.writeFileSync(path.join(runDir, 'gate.json'), JSON.stringify({ gate: 'BLOCKED' }));
    const blocked = report(dir);
    assert.equal(blocked.commits.reviewed_at_that_commit, 0, 'a BLOCKED run reviewed nothing');
    assert.equal(blocked.commits.in_a_swept_area_but_not_reviewed, 0, 'nor is its scope a swept area');
    assert.equal(blocked.quorate.reached_a_gate, 1,'it still reached a gate, and is counted as one');

    fs.writeFileSync(path.join(runDir, 'gate.json'), JSON.stringify({ gate: 'PASS' }));
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: 'blocked-run', head_commit: head, dirty: true, scope: { paths: ['a.txt'] } }));
    const dirty = report(dir);
    assert.equal(dirty.commits.reviewed_at_that_commit, 0, 'a dirty run reviewed a tree, not its head commit');
    assert.equal(dirty.commits.in_a_swept_area_but_not_reviewed, 1, 'its scope was still looked at');

    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: 'blocked-run', head_commit: head, scope: { paths: ['a.txt'] } }));
    assert.equal(report(dir).commits.reviewed_at_that_commit, 0, 'an unrecorded dirty flag does not vouch for the commit');

    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: 'blocked-run', head_commit: head, dirty: false, scope: { paths: ['a.txt'] } }));
    assert.equal(report(dir).commits.reviewed_at_that_commit, 1, 'a clean, gated, unblocked run is');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-12, G-13 of 20261031-022756-urr-remediation-review: the adjudication guard checked only the outer shape, so a top-level
// array or an object with no `groups` counted as zero disputes, and `groups: [null]` crashed the whole report at g.outcome.
test('G-12, G-13: an adjudication.json of the wrong shape is unreadable, never zero disputes or a crash', () => {
  for (const bad of [[], {}, { groups: [null] }, { groups: [7] }]) {
    const { dir, reviews } = fixture();
    try {
      fs.mkdirSync(path.join(reviews, 'good-run', 'nodes'));
      fs.writeFileSync(path.join(reviews, 'good-run', 'nodes', 'adjudication.json'), JSON.stringify(bad));
      const rep = report(dir);
      assert.ok(rep.quorate.unreadable.some((u) => u.run === 'good-run' && u.file === 'nodes/adjudication.json'),
        `${JSON.stringify(bad)} is named as unreadable`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// G-10 of 20261031-033859-urr-remediation-2-review: run.json was checked for truthiness only, so `null`, `false`, `0` or
// `""` dropped the run from every total with no unreadable record, and an array or a number passed as a run record.
test('G-10: a run.json that is valid JSON but not an object is named as unreadable, not dropped or counted', () => {
  for (const bad of [null, false, 0, '', [], 7]) {
    const { dir, reviews } = fixture();
    try {
      fs.writeFileSync(path.join(reviews, 'good-run', 'run.json'), JSON.stringify(bad));
      const rep = report(dir);
      assert.equal(rep.quorate.runs, 0, `${JSON.stringify(bad)} is not counted as a run`);
      assert.ok(rep.quorate.unreadable.some((u) => u.run === 'good-run' && u.file === 'run.json'),
        `${JSON.stringify(bad)} is named as unreadable`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// G-11 of 20261031-033859-urr-remediation-2-review: the adjudication guard began `adjudication &&`, so falsy JSON skipped
// it and counted as zero disputes. An absent adjudication.json is still no disputes, and is not unreadable.
test('G-11: an adjudication.json holding falsy JSON is unreadable, never zero disputes', () => {
  for (const bad of [null, false, 0, '']) {
    const { dir, reviews } = fixture();
    try {
      fs.mkdirSync(path.join(reviews, 'good-run', 'nodes'));
      fs.writeFileSync(path.join(reviews, 'good-run', 'nodes', 'adjudication.json'), JSON.stringify(bad));
      const rep = report(dir);
      assert.ok(rep.quorate.unreadable.some((u) => u.run === 'good-run' && u.file === 'nodes/adjudication.json'),
        `${JSON.stringify(bad)} is named as unreadable`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const { dir } = fixture();
  try {
    assert.ok(!report(dir).quorate.unreadable.some((u) => u.file === 'nodes/adjudication.json'), 'an absent one is not unreadable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-13 of 20261031-033859-urr-remediation-2-review: the line callback added to the shared counters as it went, and a read
// that failed partway (ELINETOOLONG) recorded the file unreadable while its earlier pairs stayed in the totals.
test('G-13: a transcript that fails partway adds nothing to the totals', () => {
  const { dir } = fixture();
  try {
    const tdir = path.join(dir, 'transcripts');
    fs.mkdirSync(tdir);
    const ask = { message: { role: 'assistant', content: [{ type: 'text', text: 'Shall I push it?' }] } };
    const yes = { message: { role: 'user', content: 'yes' } };
    const fd = fs.openSync(path.join(tdir, 's.jsonl'), 'w');
    fs.writeSync(fd, `${JSON.stringify(ask)}\n${JSON.stringify(yes)}\n`);
    const piece = Buffer.alloc(1024 * 1024, 0x78);
    for (let i = 0; i < 65; i++) fs.writeSync(fd, piece); // one line over the 64 MB default
    fs.closeSync(fd);
    const rep = report(dir, ['--transcripts', tdir]);
    assert.equal(rep.dependence.unreadable_files.length, 1, 'the transcript is named as unreadable');
    assert.equal(rep.dependence.asked, 0, 'the pair read before the failure is not counted');
    assert.equal(rep.dependence.assent_only, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-17 of 20261031-022756-urr-remediation-review: a malformed line was counted and skipped, but the pending reply survived
// it, so a later message was paired with a reply from before an event nobody could read.
test('G-17: no reply is paired with a message across a malformed transcript line', () => {
  const { dir } = fixture();
  try {
    const tdir = path.join(dir, 'transcripts');
    fs.mkdirSync(tdir);
    const ask = { message: { role: 'assistant', content: [{ type: 'text', text: 'Shall I push it?' }] } };
    const yes = { message: { role: 'user', content: 'yes' } };
    fs.writeFileSync(path.join(tdir, 's.jsonl'), `${JSON.stringify(ask)}\n{ broken\n${JSON.stringify(yes)}\n`);
    const rep = report(dir, ['--transcripts', tdir]);
    assert.equal(rep.dependence.malformed_lines, 1);
    assert.equal(rep.dependence.asked, 0, 'the reply before the unreadable line is not paired with the message after it');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-16 of 20261031-022756-urr-remediation-review: the ledger's entries were checked as an object but not each value, so
// {entries: {x: null}} crashed the report instead of setting ledger_unreadable.
test('G-16: a ledger entry that is not an object makes the ledger unreadable, not a crash', () => {
  const { dir, reviews } = fixture();
  try {
    fs.writeFileSync(path.join(reviews, 'ledger.json'), JSON.stringify({ entries: { x: null } }));
    const rep = report(dir);
    assert.equal(typeof rep.findings.ledger_unreadable, 'string', 'the malformed ledger is named');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-8 and G-7 of 20261102-211111-rbr-remediation-4-review: usage-report realpathed the --transcripts folder and the
// reviews folder before rooting their owners there, so a link or junction AT that root was resolved away and the owner's
// root check (G-10 of 20261102-184751-rbr-remediation-2-review) never saw it. Each folder is now the owner's root as named.
const junction = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');

test('G-8: a link or junction at the --transcripts folder is refused, not followed', () => {
  const { dir } = fixture();
  try {
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 's.jsonl'), `${JSON.stringify({ message: { role: 'user', content: 'hi' } })}\n`);
    const linked = path.join(dir, 'linked');
    junction(outside, linked);
    const rep = report(dir, ['--transcripts', linked]);
    assert.equal(typeof rep.dependence.transcripts_unreadable, 'string', `transcripts behind a linked folder were read: ${JSON.stringify(rep.dependence)}`);
    assert.match(rep.dependence.transcripts_unreadable, /link or junction/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-7: a link or junction at the reviews folder is refused for the ledger, not followed', () => {
  const { dir, reviews } = fixture();
  try {
    const outside = path.join(dir, 'outside-reviews');
    fs.renameSync(reviews, outside);
    fs.writeFileSync(path.join(outside, 'ledger.json'), JSON.stringify({ schema_version: 1, entries: {} }));
    junction(outside, reviews);
    const rep = report(dir);
    assert.equal(typeof rep.findings.ledger_unreadable, 'string', `a ledger behind a linked reviews folder was read: ${JSON.stringify(rep.findings)}`);
    assert.match(rep.findings.ledger_unreadable, /refused/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-11 of 20261102-220302-rbr-remediation-5-review: the reviews folder was listed with a raw readdirSync before its owner
// saw the root, so a junction there was followed and the names in its target reached the report as unreadable runs.
test('G-11: a link or junction at the reviews folder is refused before it is listed; no name behind it is reported', () => {
  const { dir, reviews } = fixture();
  try {
    const outside = path.join(dir, 'outside-reviews');
    fs.renameSync(reviews, outside);
    fs.mkdirSync(path.join(outside, 'private-name-behind-link'));
    junction(outside, reviews);
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'usage-report.mjs'), '--json', '--since', '2000-01-01'],
      { cwd: dir, encoding: 'utf8' });
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /private-name-behind-link/, 'a name behind the linked reviews folder was listed and printed');
    assert.equal(r.status, 0, r.stderr);
    const rep = JSON.parse(r.stdout);
    assert.equal(rep.quorate.runs, 0, 'a run behind the link was counted');
    assert.ok(rep.quorate.unreadable.some((u) => /link or junction/.test(u.why)), `the refused folder is not named: ${JSON.stringify(rep.quorate.unreadable)}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
