// G-43 — A VENDOR'S STDERR REACHED FOUR TRACKED FILES (contract-audit, corroborated by
// panel-codex-security as G-39, run 20260914-193203-branch-verify). HIGH.
//
// When a reviewer CLI exits non-zero with no output, external-review.mjs built:
//
//   `exited ${r.status} with no output: ${(r.stderr ?? '').trim().slice(0, 400)}`
//
// and handed it to unavailable(), which puts it in the envelope's not_checked[].reason. From there
// classifyPanelProbe passes it on as tbProbe.reason, run-graph stores it on the vote,
// adjudication.mjs copies it into absent[].why, and it is written to:
//
//   nodes/adjudication.json · gate.json · gate.md · reconciled.md
//
// `git ls-files` shows all four are TRACKED. The engine's own comments already state the rule it was
// breaking — "a vendor's stderr can carry a credential and this file is tracked" — and the status-file
// path was fixed to a scrubbed message plus a `failure_detail` pointer. This is one hop past that fix,
// on every path that was not covered, and it fires on any judge auth failure, quota exhaustion or
// crash.
//
// The excerpt was never needed. external-review.mjs:859 ALREADY writes stdout AND the complete stderr
// to `evidence/<node>/raw.log`, and `.claude/reviews/.gitignore` excludes `*/evidence/`. So the full
// text was on the gitignored side the whole time and the tracked copy was a duplicate — 400 bytes of
// the one thing that must not be duplicated there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { vendorFailureReason } from '../scripts/lib/decisions.mjs';

// Built at runtime, so no secret-shaped literal sits in the source (.gitleaksignore's convention; M2 stage 9c).
const SECRET = ['ANTHROPIC_API_KEY', 'sk-ant-not-a-real-' + 'key-0123456789 refused by proxy at 10.2.3.4'].join('=');

test('the tracked reason states the failure and quotes no vendor output', () => {
  const reason = vendorFailureReason({
    status: 1, stderr: SECRET, rawLogRel: 'evidence/panel-codex-code/raw.log',
  });

  assert.match(reason, /exited 1/, 'a reader must still learn the arm failed and how');
  assert.match(reason, /evidence\/panel-codex-code\/raw\.log/,
    'and where the detail is, so the scrub does not become a dead end');

  for (const fragment of ['sk-ant-not-a-real-key', 'ANTHROPIC_API_KEY', '10.2.3.4', 'refused by proxy']) {
    assert.ok(!reason.includes(fragment), `vendor stderr leaked into a tracked artifact: ${fragment}`);
  }
});

test('it says the detail is gitignored, so nobody hunts for it in git', () => {
  const reason = vendorFailureReason({ status: 7, stderr: 'x', rawLogRel: 'evidence/n/raw.log' });
  assert.match(reason, /gitignored/i,
    'the sibling scrub in run-graph says so for the same reason: a reader who cannot find the detail '
    + 'in a tracked file should not conclude it was never captured');
});

test('no raw log path still produces a usable reason', () => {
  // outDir is optional, so a caller can reach here with nothing written. The reason must not become
  // a citation to a file that does not exist (§3: evidence is cited, never asserted).
  const reason = vendorFailureReason({ status: 2, stderr: SECRET, rawLogRel: null });
  assert.match(reason, /exited 2/);
  assert.ok(!reason.includes('sk-ant-not-a-real-key'));
  assert.ok(!/evidence\//.test(reason), 'a path that was never written must not be cited');
});

test('external-review no longer slices stderr into a reason', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8')
    .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  // The one legitimate use: the full text into the gitignored raw log.
  assert.match(src, /--- stderr ---/, 'the complete stderr must still reach evidence/<node>/raw.log');

  const intoReason = /unavailable\([^)]*stderr/.test(src) || /slice\(0, 400\)/.test(src);
  assert.ok(!intoReason,
    'the excerpt travelled into not_checked[].reason and from there into adjudication.json, gate.json, '
    + 'gate.md and reconciled.md — all four tracked');
});

// The rule this breaks is already written down in the engine. Assert it still is, so the next author
// meets it rather than rediscovering it from a finding.
test('the engine still states the rule it was breaking', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(src, /can carry a credential and this file is tracked/,
    'the sibling fix for the status-file path documents the rule; removing that sentence would leave '
    + 'the next author with only the code to infer it from');
});
