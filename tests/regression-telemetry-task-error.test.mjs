// G-15 of 20261025-222928-tel-remediation-3-review: telemetry-records.plan.md says "An error is kept as its kind and its
// first line, redacted and cut, as the after line of the command log does", and a task had no field for either, so why a
// node failed was dropped from its record. A task's error is its status file's first validator error: its kind a short
// label, its first line redacted and cut to 200 characters; null on a task that reported none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskEntry, checkEntry, RECORD_STRING_FIELDS } from '../scripts/lib/telemetry-record.mjs';

// Built, never written out, so this file does not trip the push scan.
const TOKEN = ['ghp', 'Z'.repeat(36)].join('_');

test('a failed task keeps its error kind and its first line, redacted and cut', () => {
  const status = { state: 'ERROR', validator_errors: [`spawn failed: token ${TOKEN} refused\nsecond line`, 'another'] };
  const t = taskEntry('security-audit', status);
  assert.equal(t.error_kind, 'spawn-failed');
  assert.ok(typeof t.error === 'string' && t.error.startsWith('spawn failed: token '), JSON.stringify(t.error));
  assert.equal(t.error.includes(TOKEN), false, 'the error line was not redacted');
  assert.equal(t.error.includes('second line'), false, 'more than the first line was kept');
  const long = taskEntry('x', { validator_errors: [`killed by signal ${'x'.repeat(500)}`] });
  assert.ok(long.error.length <= 200, `the error line was not cut: ${long.error.length}`);
  assert.ok(/^[A-Za-z0-9_.:/-]{1,64}$/.test(long.error_kind), long.error_kind);
  assert.ok(RECORD_STRING_FIELDS.includes('error') && RECORD_STRING_FIELDS.includes('error_kind'));
});

test('a task that reported no error has null error fields, and every task has them', () => {
  const t = taskEntry('security-audit', { state: 'OK', validator_errors: [] });
  assert.equal(t.error_kind, null);
  assert.equal(t.error, null);
  const c = checkEntry('test', { status: 'PASS' });
  assert.ok('error' in c && 'error_kind' in c);
});

// G-12 of 20261025-232315-tel-remediation-4-review: error_kind was cut from the UNREDACTED line, so a secret-shaped lead
// before the first `:` reached a tracked record while `error` beside it was redacted.
test('G-12: an error kind is never a secret shape, even when the line leads with one', () => {
  const t = taskEntry('x', { validator_errors: [`${TOKEN}: refused`] });
  assert.equal(String(t.error_kind).includes(TOKEN), false, `error_kind carried the credential: ${t.error_kind}`);
  assert.equal(String(t.error).includes(TOKEN), false);
});

// G-17 of the same review: spawn-node's validator errors quote the node's own envelope values (`got "..."`), and the
// first one was copied into the record, so model text reached it although shared/telemetry.md says it never does.
test('G-17: a validator error keeps the engine\'s words and drops every value it quoted from the node', () => {
  const t = taskEntry('x', { validator_errors: ['node_id mismatch: got "MODEL TEXT that the node wrote", expected "code-audit"'] });
  assert.equal(t.error_kind, 'node_id-mismatch');
  assert.equal(t.error.includes('MODEL TEXT'), false, `the record kept the node's text: ${t.error}`);
  assert.match(t.error, /^node_id mismatch: got /);
});

// G-14 of the same review: a declared check reports why it did not run through capture_error and outcome_detail, and
// checkEntry read neither, so a check's error fields were always null.
test('G-14: a check that could not start keeps its error kind and its detail line', () => {
  const c = checkEntry('test', { outcome: 'could-not-start', capture_error: 'ENOENT', outcome_detail: `spawn node ENOENT ${TOKEN}\nmore` });
  assert.equal(c.error_kind, 'ENOENT');
  assert.ok(typeof c.error === 'string' && c.error.startsWith('spawn node ENOENT'), JSON.stringify(c.error));
  assert.equal(c.error.includes(TOKEN), false, 'the detail line was not redacted');
  assert.equal(c.error.includes('more'), false);
});

// G-11 of the same review: the first-line, redacted, 200-character rule had two owners, the command log's after line and
// the telemetry builder. It has one, in lib/command-log.mjs, which both use.
test('G-11: the error-line rule has one owner, used by the command log and the telemetry builder', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { REPO_ROOT } = await import('./helpers.mjs');
  const src = (p) => fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', p), 'utf8');
  const { errorLine } = await import('../scripts/lib/command-log.mjs');
  assert.equal(typeof errorLine, 'function', 'lib/command-log.mjs exports no errorLine');
  assert.equal(/slice\(0,\s*(200|ERROR_LINE_MAX)\)/.test(src('telemetry-record.mjs')), false, 'the builder keeps its own cut');
  assert.match(src('telemetry-record.mjs'), /errorLine/);
});
