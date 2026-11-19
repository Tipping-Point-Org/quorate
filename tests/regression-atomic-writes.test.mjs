// AN APPEND ONTO AN ALREADY-AUDITED ARTIFACT (G-48, panel-codex-arch).
//
// The tie-break rulings were written with `fs.appendFileSync` onto reconciled.md — remediate's work
// list — which carries two problems at once. An interruption mid-append leaves a truncated tail in
// a file nothing marks as incomplete. And second-opinion has ALREADY audited that file by the time
// the rulings arrive, so the adjudication a reader ends up with is not the version that was audited.
//
// The ordering cannot simply be reversed: a tie-break fires only on groups reconcile declared
// disputed, and second-opinion audits the adjudication that produced them. So the write is made
// atomic and the appended section states its own provenance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './helpers.mjs';
import { writeTextAtomic } from '../scripts/io/atomic.mjs';

test('an append to a consumed artifact is atomic and says when it landed', async () => {
  const { appendTextAtomic } = await import('../scripts/io/atomic.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-append-'));
  try {
    const p = path.join(dir, 'reconciled.md');
    fs.writeFileSync(p, '# Reconciled\n');
    appendTextAtomic(p, '\n## Tie-break rulings\n');
    appendTextAtomic(p, '### G-1\n');
    assert.equal(fs.readFileSync(p, 'utf8'), '# Reconciled\n\n## Tie-break rulings\n### G-1\n',
      'content must accumulate exactly as an append would');

    // The rename is the atom, so no temp file is left behind to be mistaken for the artifact.
    assert.deepEqual(fs.readdirSync(dir), ['reconciled.md']);

    // A first write with no existing file is the same call, not a special case.
    const fresh = path.join(dir, 'new.md');
    appendTextAtomic(fresh, 'first\n');
    assert.equal(fs.readFileSync(fresh, 'utf8'), 'first\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const block = graph.slice(graph.indexOf('ATOMIC, AND IT SAYS WHEN IT LANDED'));
  // Through appendTracked since ledger-trust-boundaries 1b, which redacts and then appends atomically.
  assert.match(block, /appendTracked\(/);
  // REWRITTEN for run-dir-descendants.plan.md stage 2: appendTracked reads what is there and writes it back through the
  // run owner's atomic replace (a temporary file and a rename, as appendTextAtomic did), so the run's links are refused.
  assert.match(graph, /function appendTracked\([^)]*\) \{[^}]*runOwner\.replace\(/, 'appendTracked must still append atomically');
  assert.match(block, /APPENDED after `second-opinion` audited this file/,
    'a reader of the final file must be told which part the audit did not see');
  assert.ok(!/fs\.appendFileSync\(path\.join\(runDir, 'reconciled\.md'\)/.test(graph),
    'the bare append is the defect');
});

// THE POINTER EVERY CONSUMER READS WAS WRITTEN BARE (G-24, panel-codex-arch).
//
// `latest.txt` is what milestone gating reads to find the current run, and writeFileSync truncates
// before it writes — so an interruption inside that window leaves the pointer EMPTY while the run
// directory it names is perfectly intact: a derived file losing the reference to a durable one,
// which is the failure this module exists for.
test('the latest-run pointer is written atomically', async () => {
  const { writeTextAtomic } = await import('../scripts/io/atomic.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-latest-'));
  try {
    const p = path.join(dir, 'latest.txt');
    writeTextAtomic(p, '20260101-000000-a\n');
    assert.equal(fs.readFileSync(p, 'utf8'), '20260101-000000-a\n');
    writeTextAtomic(p, '20260202-000000-b\n');
    assert.equal(fs.readFileSync(p, 'utf8'), '20260202-000000-b\n', 'a rewrite replaces it whole');
    assert.deepEqual(fs.readdirSync(dir), ['latest.txt'], 'the rename is the atom — no tmp left behind');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  assert.match(src, /writeTextAtomic\(path\.join\(reviewsDir, 'latest\.txt'\)/);
  assert.ok(!/fs\.writeFileSync\(path\.join\(reviewsDir, 'latest\.txt'\)/.test(src),
    'the bare write is the defect');
});

// TWO WRITERS, ONE SCRATCH NAME — the flake this suite chased for a week.
//
// All three writers derived their temp path from the target alone: `${p}.tmp`. So two writers to the
// SAME file chose the SAME scratch name, the first renamed it away, and the second died on a rename
// with nothing left to rename:
//
//   ENOENT: rename '.claude/reviews/latest.txt.tmp' -> '.claude/reviews/latest.txt'
//
// It surfaced as three unrelated tests failing intermittently in full-suite runs and never in
// isolation — the intent-drift test, the egress allow-list test, the intent-SETTINGS test. Each mints
// a real run, every mint writes `latest.txt` through writeTextAtomic, and the runner executes test
// files in parallel. Whoever lost the race crashed, and the test that owned the mint reported
// something about a stamp or an allow-list, because the mint it depended on had died for a reason it
// never printed. A week of looking at the wrong three files.
//
// Two assertions, because one of them alone would not have caught it:
//
//  - the deterministic one proves no FIXED name is relied on, and fails the same way on every machine;
//  - the concurrent one reproduces the actual failure, and is the only one that would have gone red
//    for the original reason.
test('a writer does not depend on one scratch name derived from its target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-tmpname-'));
  try {
    const p = path.join(dir, 'latest.txt');
    // Occupy the name the pre-fix code computed. A directory rather than a file, so the pre-fix
    // openSync cannot merely truncate it and pass: the point is that the name must not be load-bearing.
    fs.mkdirSync(`${p}.tmp`);
    writeTextAtomic(p, 'run-a\n');
    assert.equal(fs.readFileSync(p, 'utf8'), 'run-a\n',
      'the target-derived scratch name must not be the one this writer needs');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('concurrent writers to one target all succeed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-race-'));
  try {
    const target = path.join(dir, 'latest.txt');
    const mod = pathToFileURL(path.join(REPO_ROOT, 'scripts', 'io', 'atomic.mjs')).href;
    // Four processes, 150 writes each. Pre-fix this lost the race within the first few iterations
    // every time it was run; the loop is what makes a timing bug fail like a logic bug.
    const code = `const { writeTextAtomic } = await import(${JSON.stringify(mod)});`
      + `for (let i = 0; i < 150; i++) writeTextAtomic(${JSON.stringify(target)}, process.pid + ':' + i + '\\n');`;
    const kids = Array.from({ length: 4 }, () => new Promise((resolve) => {
      const c = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      c.stderr.on('data', (b) => { err += b; });
      c.on('close', (status) => resolve({ status, err }));
    }));
    for (const { status, err } of await Promise.all(kids)) {
      assert.equal(status, 0, `a concurrent writer died: ${err.split('\n').slice(0, 4).join(' ')}`);
    }
    // And the survivor is one writer's whole line, never a splice of two.
    assert.match(fs.readFileSync(target, 'utf8'), /^\d+:\d+\n$/);
    assert.deepEqual(fs.readdirSync(dir), ['latest.txt'], 'every scratch file was renamed away');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A MINT THAT CANNOT FINISH IS NOT A SAFER MINT (G-25, panel-codex-security).
//
// Neither canary carried a timeout, so a hung runtime or a stalled transport blocked an otherwise
// valid mint indefinitely — a hang on valid input, which §6 makes non-waivable. The canary is two
// tool calls against a cheap model; the node timeout it would otherwise inherit is sized for a lens
// reading a whole scope.
test('both canaries and the version probe are bounded', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  const gate = src.slice(src.indexOf('gate 4: canary'));
  // EVERY LIVE SPAWN IN THE GATE, counted from the spawns rather than hardcoded. This asserted the
  // literal 2 and went red when the intent canary's two arms were split into separate turns -- a
  // change that ADDED a bounded spawn. A count that has to be edited whenever a spawn is added is
  // one a maintainer edits without checking, which is the opposite of what it is for.
  // Both spellings of a live spawn: node's spawnSync, and io/stdin-file's spawnSyncFrom, which the gate's
  // probes use so their prompt reaches the child from a file (G-15 of 20261109-232630-dps-delivery). Counting
  // only the first found no spawn at all once they moved, and a bound-count of zero proves nothing.
  const spawns = (gate.match(/spawnSync(?:From)?\(/g) ?? []).length;
  assert.ok(spawns >= 3, `expected the gate's live spawns, found ${spawns}`);
  assert.equal((gate.match(/timeout: CANARY_TIMEOUT_MS/g) ?? []).length, spawns,
    'every live spawn in the canary gate needs a bound, or one of them can hang the mint');
  assert.match(src, /const CANARY_TIMEOUT_MS = /);

  // The version probe is the FIRST execution of the contract-selected binary, and it runs before
  // either canary — so it needs the bound and the scrub more than they do (G-23).
  const probe = src.slice(src.indexOf('function runtimeProbe()'), src.indexOf('function globToRe('));
  assert.match(probe, /timeout: 30_000/);
  assert.match(probe, /canaryEnv\(\)/, 'a version string is not worth a credential');
  assert.ok(!/sh\(NODE_RUNTIME\.cmd/.test(src),
    'sh() inherits the operator environment and the runtime is contract-selected');
});
