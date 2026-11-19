// regression-minutes-ratchet.test.mjs — code-index-d1-part-a.plan.md stage 3 (design note A-D1, Verification 1).
//
// The ratchet behind "one module validates every minutes value": no script reads a limit in minutes except through
// lib/check-timeout.mjs. Each round of the code-index D1 chain fixed one reader and the next found another, because the
// census of who else read the value was never taken (G-11, then G-12 drawn by its own fix, of the ciss-d1 reviews).
//
// A READ is a member access ending in `timeout_minutes` or `.timeoutMinutes`. It passes when its line calls the owner
// (or one of the thin wrappers that call it), or when ALLOWED names it with a reason. An ALLOWED entry that matches
// nothing fails, so the list cannot outlive the line it excuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const OWNER = 'scripts/lib/check-timeout.mjs';
// Dot and optional-chain access, bracket access with a literal key, and a destructuring declaration or assignment (G-19
// of 20261022-034225-cid1a-remediation-2-review: only the first was seen, so `review['x_timeout_minutes']` and
// `const { x_timeout_minutes } = review` escaped the ratchet).
const NAME = '(?:[a-z_]*timeout_minutes|timeoutMinutes)';
const READ = new RegExp([
  '[.?][a-z_]*timeout_minutes\\b', '\\.timeoutMinutes\\b',
  `\\[\\s*['"\`]${NAME}['"\`]\\s*\\]`,
  `\\{[^{}]*\\b${NAME}\\b[^{}]*\\}\\s*=(?![=>])`,
].join('|'));
const OWNER_CALL = /\b(minutes|contractMinutes|checkTimeoutMinutes|lensMinutes|armMinutes|rosterMinutes|check)\(/;

// file, a substring of the line, and why it is not a read the owner must see.
const ALLOWED = [
  ['scripts/capture.mjs', 'timeoutMinutes = opts.timeoutMinutes === undefined', 'a presence test; the value goes to checkTimeoutMinutes two lines on'],
  ['scripts/capture.mjs', 'const what = opts.timeoutMinutes === undefined', 'names the source in a message'],
  ['scripts/code-index.mjs', 'timeoutMinutes(c.review?.code_index_timeout_minutes)', 'lib/code-index-cache.mjs timeoutMinutes() is a wrapper over minutes()'],
  ['scripts/lib/consumer-lenses.mjs', 'const timeout = raw.timeout_minutes;', 'validated through minutes() on the next lines'],
  ['scripts/lib/consumer-lenses.mjs', 'errors.push(`${where}.timeout_minutes: ${e.message}`)', 'a message naming the key'],
  ['scripts/lib/remediation-chain.mjs', 'review.node_timeout_minutes is the remediation node', 'a message naming the key'],
  ['scripts/lib/remediation-chain.mjs', 'const cap = Number(record.timeout_minutes);', 'a node RECORD read back after the run: the limit it ran under, not a configured one'],
  ['scripts/new-run.mjs', '.filter((e) => /\\.timeout_minutes: /.test(e))', 'a pattern over the loader\'s error messages'],
  ['scripts/remediate.mjs', '(review.check_timeout_minutes); `', 'a message naming the key'],
  ['scripts/remediate.mjs', 'timeout_minutes: st.timeout_minutes', 'copies a node record\'s recorded limit'],
  ['scripts/lib/telemetry-record.mjs', "timeout_minutes: num(pick('timeout_minutes', status.timeout_minutes))", 'copies a task\'s recorded limit, its call entry\'s or its status\'s, into its telemetry record'],
  ['scripts/spawn-node.mjs', 'timeoutMinutes: status.timeout_minutes ?? null', 'copies the limit this node ran under, already in its status, into its call entry'],
  ['scripts/lib/telemetry-record.mjs', 'timeout_minutes: num(c.timeout_minutes)', 'copies the limit the claim checker\'s vendor call recorded into its task'],
  ['scripts/lib/telemetry-record.mjs', 'timeout_minutes: proc.timeout_minutes', 'copies the limit spawn-subagent ran under, read through minutes() there'],
  ['scripts/lib/call-entry.mjs', 'timeout_minutes: first?.timeout_minutes ?? null', 'copies the limit a retried call\'s first attempt ran under, already in its call entry, into the whole call\'s entry'],
  ['scripts/run-graph.mjs', 'if (review.barrier_timeout_minutes === undefined) substituted.push', 'a presence test for the substitution note; the value is BARRIER_TIMEOUT'],
  ['scripts/run-graph.mjs', 'timeoutMinutes: e.timeout_minutes,', 'an expected.json entry, whose limit lensMinutes() resolved when it was built'],
];

test('the ratchet sees every spelling of a read, and not a write', () => {
  for (const read of ['const t = review.node_timeout_minutes;', 'const t = review?.node_timeout_minutes;',
    "const t = review['node_timeout_minutes'];", 'const t = review["barrier_timeout_minutes"];',
    'const t = opts[`timeoutMinutes`];', 'const { node_timeout_minutes } = review;',
    'const { timeoutMinutes: t = 5 } = opts;', '({ check_timeout_minutes: cap } = review);']) {
    assert.ok(READ.test(read), `not seen as a read: ${read}`);
  }
  for (const write of ['spawn({ timeoutMinutes: 3 });', 'const o = { node_timeout_minutes: 30 };', 'if (a == { timeoutMinutes })']) {
    assert.ok(!READ.test(write), `a write seen as a read: ${write}`);
  }
});

test('no script reads a minutes value except through lib/check-timeout.mjs', () => {
  const files = execFileSync('git', ['ls-files', '--', 'scripts'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => /\.m?js$/.test(f) && f !== OWNER);
  const unowned = [];
  const used = new Set();
  let ownerReads = 0;
  for (const f of files) {
    fs.readFileSync(path.join(REPO_ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (!READ.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
      if (OWNER_CALL.test(line)) { ownerReads++; return; }
      const allowed = ALLOWED.findIndex(([af, s]) => af === f && line.includes(s));
      if (allowed >= 0) { used.add(allowed); return; }
      unowned.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(unowned, [], 'a minutes value read outside the owner: read it through minutes() (lib/check-timeout.mjs), '
    + 'or, if it is not a configured limit, add it to ALLOWED with the reason');
  assert.deepEqual(ALLOWED.filter((_, i) => !used.has(i)).map(([f, s]) => `${f}: ${s}`), [], 'an ALLOWED entry matches nothing');
  // The floor: stage 2 converted readers in run-graph, new-run, spawn-node, external-review, remediation, consumer lenses
  // and the probe limits. A pattern that stops matching must not pass vacuously.
  assert.ok(ownerReads >= 10, `only ${ownerReads} reads through the owner were found; the pattern no longer sees them`);
});

test('no script coerces a flag or contract limit in minutes with Number() or a literal fallback', () => {
  const offenders = execFileSync('git', ['grep', '-n', '-E', 'Number\\([^)]*(timeoutMinutes|_timeout_minutes)[^)]*\\)', '--', 'scripts'],
    { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter((l) => !l.includes('record.timeout_minutes'))
    // decisions.mjs builds a vendor's argv from a limit its caller already read through the owner (run-graph's arm limit);
    // it renders a flag, it does not read configuration.
    .filter((l) => !(l.startsWith('scripts/lib/decisions.mjs:') && l.includes('const mins = Number(timeoutMinutes);')));
  assert.deepEqual(offenders, []);
});
