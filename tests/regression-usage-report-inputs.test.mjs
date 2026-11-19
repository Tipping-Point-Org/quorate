// usage-report reads the ledger and the transcripts through the owner (usage-report-reviewed-runs.plan.md stage 3; U-D3 A).
//
// G-9 of 20261030-221015-usage-report-99-review: ledger.json was read with raw fs, so a link below .claude/reviews was
// followed, and the parse error quoted the linked file's bytes. G-10: one transcript that could not be read stopped the
// report; a transcript link was followed outside the --transcripts folder. G-3 of 20261030-211052: each transcript was
// read whole and split. G-8 of 20261030-195117-ciss-remaining-remediation-review, on the lines this stage rewrites: the
// last assistant reply was carried from one transcript into the next, pairing replies from different sessions.
//
// No portable fixture makes a link on every host (this one refuses symlinks, EPERM), so a preload makes the platform
// report a link, or fail a read, at a named file: the same technique as regression-telemetry-writers' G-16 test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './helpers.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-report-inputs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a],
    { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'one');
  fs.mkdirSync(path.join(dir, '.claude', 'reviews'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'transcripts'));
  return dir;
}

// A preload that makes `name` look like a link to lstat, and gives it `bytes` when read raw; or, with `deny`, fails every
// read of it with EACCES.
function preload(dir, name, { bytes = 'SECRET-BYTES-OUTSIDE', deny = false } = {}) {
  const p = path.join(dir, `preload-${name}.mjs`);
  fs.writeFileSync(p, [
    "import fs from 'node:fs';", "import { syncBuiltinESMExports } from 'node:module';",
    `const hit = (x) => String(x).endsWith(${JSON.stringify(name)});`,
    "const denied = () => Object.assign(new Error('denied'), { code: 'EACCES' });",
    'const lstat = fs.lstatSync, read = fs.readFileSync, open = fs.openSync;',
    deny
      ? 'fs.readFileSync = (x, ...a) => { if (hit(x)) throw denied(); return read(x, ...a); }; fs.openSync = (x, ...a) => { if (hit(x)) throw denied(); return open(x, ...a); };'
      : `fs.lstatSync = (x, ...a) => { const st = lstat(x, ...a); if (hit(x)) st.isSymbolicLink = () => true; return st; }; fs.readFileSync = (x, ...a) => hit(x) ? ${JSON.stringify(bytes)} : read(x, ...a);`,
    'syncBuiltinESMExports();', ''].join('\n'));
  return pathToFileURL(p).href;
}

const report = (dir, pre = null) => spawnSync(process.execPath, [...(pre ? ['--import', pre] : []), path.join(dir, 'scripts', 'usage-report.mjs'),
  '--json', '--since', '2000-01-01', '--transcripts', path.join(dir, 'transcripts')], { cwd: dir, encoding: 'utf8' });

const line = (role, text) => `${JSON.stringify({ message: { role, content: role === 'user' ? text : [{ type: 'text', text }] } })}\n`;

test('G-9: a link at ledger.json is refused and named, and its bytes never reach the report', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '.claude', 'reviews', 'ledger.json'), '{"entries":{}}');
  const r = report(dir, preload(dir, 'ledger.json'));
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /SECRET-BYTES-OUTSIDE/, 'the linked file\'s bytes reached the report');
  assert.match(JSON.parse(r.stdout).findings.ledger_unreadable ?? '', /refused/);
});

// G-13 of 20261030-174958-ciss-c-remediation-review, on the line stage 3 rewrote: valid JSON of the wrong shape (null, a
// string, entries that are not an object) crashed the report or was counted character by character.
test('a ledger of the wrong shape is reported unreadable, not crashed on or miscounted', (t) => {
  for (const text of ['null', '"a string"', '{"entries":"x"}', '[]']) {
    const dir = fixture(t);
    fs.writeFileSync(path.join(dir, '.claude', 'reviews', 'ledger.json'), text);
    const r = report(dir);
    assert.equal(r.status, 0, `${text}: ${r.stderr}`);
    const f = JSON.parse(r.stdout).findings;
    assert.equal(f.total, null, text);
    assert.match(f.ledger_unreadable ?? '', /not an object/, text);
  }
});

test('G-10: a transcript link is refused and recorded, and the report goes on', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'transcripts', 'linked.jsonl'), line('assistant', 'shall i?') + line('user', 'yes'));
  const r = report(dir, preload(dir, 'linked.jsonl', { bytes: line('assistant', 'shall i?') + line('user', 'yes') }));
  assert.equal(r.status, 0, r.stderr);
  const dep = JSON.parse(r.stdout).dependence;
  assert.deepEqual(dep.unreadable_files?.map((u) => u.file), ['linked.jsonl']);
  assert.match(dep.unreadable_files[0].reason, /refused/);
  assert.equal(dep.asked, 0, 'the linked transcript was read');
});

test('G-10: a transcript that cannot be read is recorded, and the report goes on', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'transcripts', 'locked.jsonl'), line('assistant', 'shall i?') + line('user', 'yes'));
  fs.writeFileSync(path.join(dir, 'transcripts', 'open.jsonl'), line('assistant', 'want me to go on?') + line('user', 'yes'));
  const r = report(dir, preload(dir, 'locked.jsonl', { deny: true }));
  assert.equal(r.status, 0, r.stderr);
  const dep = JSON.parse(r.stdout).dependence;
  assert.deepEqual(dep.unreadable_files?.map((u) => u.file), ['locked.jsonl']);
  assert.equal(dep.asked, 1, 'the readable transcript was not counted');
});

test('G-8: a reply is never paired with the first message of another transcript', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'transcripts', 'a.jsonl'), line('assistant', 'shall i?'));
  fs.writeFileSync(path.join(dir, 'transcripts', 'b.jsonl'), line('user', 'yes'));
  const r = report(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).dependence.asked, 0);
});

// The findings of 20261031-013928-urr-delivery, each against the report itself.
const writeRun = (dir, name, files) => {
  const runDir = path.join(dir, '.claude', 'reviews', name);
  fs.mkdirSync(path.join(runDir, 'nodes'), { recursive: true });
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(runDir, ...rel.split('/')), text);
};
const cleanRun = (scope) => ({
  'run.json': JSON.stringify({ run_id: 'r', head_commit: '0'.repeat(40), dirty: false, scope: { paths: scope } }),
  'gate.json': JSON.stringify({ gate: 'PASS' }),
});

test('G-9 of 20261031-013928-urr-delivery: a scope of `.` or a glob credits the commits it covers as swept', (t) => {
  for (const scope of [['.'], ['*.txt'], ['**']]) {
    const dir = fixture(t);
    writeRun(dir, 'run-1', cleanRun(scope));
    const r = report(dir);
    assert.equal(r.status, 0, r.stderr);
    const c = JSON.parse(r.stdout).commits;
    assert.equal(c.in_a_swept_area_but_not_reviewed, 1, `scope ${JSON.stringify(scope)} credited nothing`);
  }
});

test('G-10 of 20261031-013928-urr-delivery: a malformed ledger or run.json never quotes its bytes into the report', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '.claude', 'reviews', 'ledger.json'), '{"entries": SECRET-LEDGER-BYTES');
  writeRun(dir, 'run-1', { 'run.json': '{"run_id": SECRET-RUN-BYTES' });
  for (const r of [report(dir), spawnSync(process.execPath, [path.join(dir, 'scripts', 'usage-report.mjs'), '--since', '2000-01-01'],
    { cwd: dir, encoding: 'utf8' })]) {
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /SECRET-/, 'a parse error quoted the file\'s bytes');
  }
  const j = JSON.parse(report(dir).stdout);
  assert.match(j.findings.ledger_unreadable ?? '', /not valid JSON/);
  assert.deepEqual(j.quorate.unreadable.map((u) => u.file), ['run.json']);
});

test('G-8 of 20261031-013928-urr-delivery: an adjudication whose groups are not a list is unreadable, not a crash', (t) => {
  const dir = fixture(t);
  writeRun(dir, 'run-1', { ...cleanRun(['a.txt']), 'nodes/adjudication.json': '{"groups":{"g":1}}' });
  const r = report(dir);
  assert.equal(r.status, 0, r.stderr);
  const q = JSON.parse(r.stdout).quorate;
  assert.deepEqual(q.unreadable.map((u) => u.file), ['nodes/adjudication.json']);
  assert.equal(q.disputes_adjudicated, 0);
});

test('G-11 of 20261031-013928-urr-delivery: an unreadable transcript is recorded as {file, reason}', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'transcripts', 'linked.jsonl'), line('assistant', 'shall i?'));
  const r = report(dir, preload(dir, 'linked.jsonl'));
  assert.equal(r.status, 0, r.stderr);
  const [u] = JSON.parse(r.stdout).dependence.unreadable_files;
  assert.deepEqual(Object.keys(u).sort(), ['file', 'reason']);
  assert.match(u.reason, /refused/);
});

test('G-12 of 20261031-013928-urr-delivery: the text report prints both unproven-run counts, zero included', (t) => {
  const dir = fixture(t);
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'usage-report.mjs'), '--since', '2000-01-01'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /reviewed runs dirty when reviewed\s+0/);
  assert.match(r.stdout, /reviewed runs, no dirty flag recorded\s+0/);
});

test('readLines hands over every line across chunk boundaries, multi-byte text included', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-lines-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'f.txt'), 'one\ntwo é\n\nfour—end');
  const got = [];
  confined(fs.realpathSync(dir)).readLines(['f.txt'], (l) => got.push(l), { chunkBytes: 3 });
  assert.deepEqual(got, ['one', 'two é', '', 'four—end']);
});

// usage-report-followup.plan.md stage 3; G-19 of 20261031-055840-urr-remediation-3-review: a user event that is not plain
// text (a tool result, or text mixed with another part) returned without clearing the pending reply, so the next text
// message was paired with a reply it never answered.
test('G-19: a reply is not paired across a user event that is not plain text', (t) => {
  const dir = fixture(t);
  const toolResult = `${JSON.stringify({ message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } })}\n`;
  fs.writeFileSync(path.join(dir, 'transcripts', 'a.jsonl'), line('assistant', 'shall i?') + toolResult + line('user', 'yes'));
  const r = report(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).dependence.asked, 0, 'the reply was paired across the tool result');
});
