// The pre-push gate ran the full declared check set on EVERY push, ignoring the ref lines git
// supplies on stdin. That taxes the cheap frequent operation — saving work in progress on a branch
// — to protect the rare expensive one, landing it on main. A gate people route around with
// --no-verify protects nothing, and charging 65 seconds for a WIP push is how that habit is taught.
//
// The DECISION now lives in lib/push-gate.mjs, not in the hook. That move was prompted by the
// operator noticing the repository is otherwise entirely JavaScript: `git ls-files` finds no .sh,
// .ps1, .bat or .cmd, and the two git hooks are the sole exception because git invokes them
// directly and `sh` is guaranteed present wherever git runs. Putting twenty lines of ref parsing
// and fail-closed handling into that shim buried a decision in the one language here with no unit
// tests — and the fail-closed half was wrong as written, which is exactly what a test catches in
// milliseconds and a shell script does not.
//
// So: the decision is unit-tested below, and ONE test covers the shim actually wiring it up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pushNeedsGate, PROTECTED_REFS } from '../scripts/lib/push-gate.mjs';
import { REPO_ROOT } from './helpers.mjs';

const line = (remoteRef, localSha = 'abc123') => `refs/heads/x ${localSha} ${remoteRef} def456`;

test('a feature-branch push is not gated', () => {
  const r = pushNeedsGate(line('refs/heads/feat'));
  assert.equal(r.gate, false);
});

test('pushing to a protected ref is gated', () => {
  for (const ref of PROTECTED_REFS) {
    assert.equal(pushNeedsGate(line(ref)).gate, true, `${ref} must be gated`);
  }
});

test('regression: it fails CLOSED when it cannot tell what is being pushed', () => {
  // The half that was wrong when first written in shell: an empty stdin left the read loop having
  // run zero times, and the hook concluded "no protected ref, skip" from having read NOTHING.
  for (const empty of ['', '   ', null, undefined, '\n\n']) {
    assert.equal(pushNeedsGate(empty).gate, true,
      `${JSON.stringify(empty)} means "I could not tell", which must never mean "no gate"`);
  }
});

test('a multi-ref push containing a protected ref is gated', () => {
  // git sends one line per ref. Deciding from the FIRST line would let a combined push through.
  const stdin = [line('refs/heads/feat'), line('refs/heads/main')].join('\n');
  assert.equal(pushNeedsGate(stdin).gate, true);
});

test('a branch DELETION does not raise the gate, and does not lower one already raised', () => {
  const ZERO = '0'.repeat(40);
  // Nothing to build or test in removing a ref.
  assert.equal(pushNeedsGate(line('refs/heads/main', ZERO)).gate, false);
  // But a deletion alongside a real push to main must still gate.
  const mixed = [line('refs/heads/old', ZERO), line('refs/heads/main')].join('\n');
  assert.equal(pushNeedsGate(mixed).gate, true, 'a deletion must not cancel a real push to main');
});

test('the reason is stated, so a skipped gate is never silent', () => {
  assert.match(pushNeedsGate(line('refs/heads/feat')).reason, /no protected ref/);
  assert.match(pushNeedsGate('').reason, /gating rather than guessing/);
});

// ---------------------------------------------------------------- the shim, end to end
test('the hook decides nothing itself and wires the decision up', () => {
  const body = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'hooks', 'pre-push'), 'utf8');
  assert.match(body, /THIS FILE DECIDES NOTHING/);
  assert.match(body, /--from-pre-push/, 'it must tell checks.mjs the ref list is on stdin');
  assert.doesNotMatch(body, /refs\/heads\/main/,
    'the protected-ref list belongs in the tested module, not the shim');
  // And it must still say what no local hook can do, so the gap is not discovered by surprise.
  assert.match(body, /git invokes it directly/);
});

test('running the hook with a feature-branch ref skips, end to end', () => {
  // THE SECRET SCAN RUNS FIRST, on every push, and this repository declares it required. So what
  // "end to end" can show depends on whether gitleaks is installed, and both outcomes are the hook's
  // designed behaviour: with gitleaks, the scan passes and the feature-branch push skips the checks;
  // without it, a required scan BLOCKS and says how to proceed. Asserting only the first failed every
  // CI run, where the offline job has no gitleaks (diagnosed 2026-10-06, run 37552051536). Neither
  // branch is a skip: each asserts what the hook must do on the machine it runs on.
  const hasGitleaks = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).error?.code !== 'ENOENT';
  // REAL SHAS, AN EMPTY RANGE (test-suite-cost.md): the placeholder shas `abc123`/`def456` are not hex, so
  // secretScanRanges read the ref list as unreadable and scanned the repository's WHOLE history, about 850 commits and
  // 105 MB, on every suite run. HEAD..HEAD adds nothing to scan, and the shim's wiring is what this test is about.
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
  const r = spawnSync('sh', [path.join(REPO_ROOT, '.claude', 'hooks', 'pre-push')],
    { cwd: REPO_ROOT, input: `refs/heads/x ${head} refs/heads/feat ${head}\n`, encoding: 'utf8' });
  if (hasGitleaks) {
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /checks skipped/);
  } else {
    assert.notEqual(r.status, 0, 'a required scan with gitleaks missing must block the push');
    assert.match(r.stderr, /gitleaks is not installed/);
    assert.match(r.stderr, /secret_scan: off/, 'and it must say how to proceed');
  }
});
