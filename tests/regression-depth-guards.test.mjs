// The recursion guard forbids a node from STARTING GRAPH WORK. It is not "nothing may run inside
// a node", and applying it as though it were broke the system twice over.
//
// Found by: doc-consistency-review, 20260804-182221-docsync (G-1, raised to HIGH by reconcile).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, REPO_ROOT, repoRunDir, detectorFixture } from './helpers.mjs';

// find-inert-features.mjs carried the guard by copy-paste from the orchestration scripts. It runs
// ONLY inside doc-consistency-review, which runs at depth 1 by definition — so `exit 3` fired on
// every sanctioned invocation, and the mandatory inert-feature sweep silently degraded to whatever
// greps the reviewer happened to think of. Four documents mandated the call; the guard defeated
// all four. That script spawns no node: it shells out to `git ls-files` and `git grep`.
test('regression: the inert-feature detector runs at depth 1, where its only caller lives', () => {
  // Over a small fixture, not this repository (test-suite-cost.md): the property is that depth 1 does not abort it.
  const r = runScript('find-inert-features.mjs', ['--repo-root', detectorFixture()], { env: { GRAPH_NODE_DEPTH: '1' } });
  assert.equal(r.status, 0, `detector must run inside a lens; got exit ${r.status}\n${r.stderr}`);
  assert.doesNotMatch(r.output, /ABORT: GRAPH_NODE_DEPTH/);
});

// This test's sibling above was green for weeks while the capability it names was broken: a lens
// cannot invoke the detector directly (the scripts directory is in every node's deny-list) —
// capture.mjs is the ONLY sanctioned route, and its allow-list admitted only the legacy layout's
// literal path. The direct spawn therefore did not constrain what the doctrine claims; this one
// exercises the path the caller actually has (G-29).
test('regression: the detector is reachable through capture.mjs, its only sanctioned route', () => {
  // The run dir's basename must equal run.json.run_id — capture pins to run.json as authority and
  // fails closed on a mismatch (G-4). Build a dir whose name IS the run_id.
  // Inside the repository, where a real run directory lives — capture refuses one that is not (G-6).
  // host.cwd is the small fixture, where capture runs the detector (test-suite-cost.md): this repository took minutes.
  const fixture = detectorFixture();
  const { base, dir } = repoRunDir({ runId: '20260101-000000-t', prefix: 'quorate-g29-', json: { host: { cwd: fixture } } });
  try {
    // AT THE FIXTURE, by --cwd: capture runs a command at --cwd or the admitted repository, not at run.json's host.cwd (G-6
    // of 20261023-014400-rdt-delivery), so without it this swept the whole repository and timed out under the suite.
    const r = runScript('capture.mjs', [
      '--run-dir', dir, '--node', 'doc-consistency-review', '--name', 'inert-sweep', '--cwd', fixture,
      // THE PATH THE LENS CONTRACT PRESCRIBES: `node <framework-root>/scripts/find-inert-features.mjs`,
      // absolute. This used to pass the RELATIVE spelling, which capture admitted and node then
      // resolved against the spawn's working directory rather than against capture.mjs — the G-6
      // hole. So this test drove the sanctioned route by the one spelling that was not sanctioned.
      '--', 'node', path.join(REPO_ROOT, 'scripts', 'find-inert-features.mjs'),
    ], { env: { GRAPH_NODE_DEPTH: '1' } });
    assert.equal(r.status, 0, `capture refused the mandatory sweep: exit ${r.status}\n${r.output.slice(-600)}`);
    assert.match(r.stdout, /evidence\/doc-consistency-review\/inert-sweep\.log/);

    // AND THE EVIDENCE MUST EXIST. Asserting only that a path was PRINTED proves capture reported,
    // not that it captured: a capture that printed the path and wrote nothing passes every line
    // above, and evidence is the entire product of this call. Same shape as the bench listing that
    // rendered `file:undefined` past three green assertions.
    const log = path.join(dir, 'evidence', 'doc-consistency-review', 'inert-sweep.log');
    assert.ok(fs.existsSync(log), 'capture printed an evidence path it never wrote');
    const body = fs.readFileSync(log, 'utf8');
    assert.ok(body.length > 0, 'the evidence log is empty — the sweep produced nothing to cite');
    assert.match(body, /find-inert-features\.mjs/,
      'the log must record the command it ran, or a finding citing it cannot be checked');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// Removing that guard was not enough: the detector reads the contract by shelling out to
// `new-run.mjs --print-contract`, which carried its own. The abort simply moved one process along.
// --print-contract parses and prints; it starts nothing.
test('regression: --print-contract is readable at depth 1 (it starts no run)', () => {
  const r = runScript('new-run.mjs', ['--print-contract'], { env: { GRAPH_NODE_DEPTH: '1' } });
  assert.equal(r.status, 0, `--print-contract must work inside a node; got exit ${r.status}`);
  assert.doesNotMatch(r.output, /ABORT/);
  assert.doesNotThrow(() => JSON.parse(r.stdout), 'still emits parseable contract JSON');
});

// The exemption must be narrow. Minting a run IS graph work.
test('minting a run at depth 1 is still refused', () => {
  const r = runScript('new-run.mjs', ['--dry-run'], { env: { GRAPH_NODE_DEPTH: '1' } });
  assert.equal(r.status, 3);
  assert.match(r.output, /may not start a graph run/);
});

// Guards must fail CLOSED on a value they cannot read. `Number.isFinite(d) && d > 0` treats NaN as
// "not nested", so '1x' and '' let the script proceed as though at depth 0. Three scripts were
// hardened against this and two were not, which is how the runtime reference came to claim a
// uniformity that did not exist.
const UNREADABLE_DEPTHS = ['1x', 'abc', '-1', ''];
// The empty string is the value the comment above names, and `Number('')` is 0: it is the case the guards were hardened
// for, and the list omitted it (G-20 of 20261026-080302-rct-delivery).
test('the unreadable depths include the present-but-empty value', () => {
  assert.ok(UNREADABLE_DEPTHS.includes(''), `the cases are ${JSON.stringify(UNREADABLE_DEPTHS)}`);
});
for (const script of ['new-run.mjs', 'run-graph.mjs', 'spawn-node.mjs', 'run-checks.mjs', 'external-review.mjs', 'check-reviewers.mjs']) {
  for (const bad of UNREADABLE_DEPTHS) {
    test(`regression: ${script} refuses unreadable GRAPH_NODE_DEPTH=${JSON.stringify(bad)}`, () => {
      // mayFanOut: the depth guard fires before any argument is parsed, so run-graph here refuses
      // with no node set and nothing spawned. helpers.mjs's spend guard has to be told that, or it
      // refuses the invocation and this test stops exercising the guard it names.
      const r = runScript(script, script === 'new-run.mjs' ? ['--no-verify-reviewers'] : [], { env: { GRAPH_NODE_DEPTH: bad }, mayFanOut: true });
      assert.equal(r.status, 3, `must fail closed, not guess; got exit ${r.status}`);
      assert.match(r.output, /not a non-negative integer|refusing to guess/);
    });
  }
}

// The two scripts every lens must be able to call carry no guard at all, by design.
test('capture.mjs has no depth guard — every lens calls it at depth 1 to produce evidence', () => {
  const r = runScript('capture.mjs', [], { env: { GRAPH_NODE_DEPTH: '1' } });
  assert.notEqual(r.status, 3, 'capture must never abort on depth; it is the only evidence path');
});
