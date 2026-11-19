// G-56 (found by panel-codex-code, no Claude lens saw it): intent-settings.json denies both Bash
// AND Grep — Grep returns file CONTENT, so an unscoped Grep is a hole straight through the
// source-before-intent sandbox that a path-scoped Read closes. The denials must ALSO ride on the
// --disallowedTools FLAG, because a settings file that fails validation is silently ignored in -p
// mode and only the flag survives. spawn-node's flag mirror pushed Bash for intent mode but omitted
// Grep, so a rejected settings file left the intent node able to read the very tree it exists to
// precede. This asserts Grep is on the flag, at the process boundary, via --print-cmd.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRunDir, runScript, REPO_ROOT, mintedRunId, mintedRunDir, mintSlug, detectorFixture } from './helpers.mjs';
import { denyToolsFor } from '../scripts/lib/decisions.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

// FROM THE RUNTIME, not from a constant in the engine. The deny set was two frozen arrays in
// lib/decisions.mjs — Claude Code's tool names, in the pure decision layer, where a second runtime
// could never reach them. They are `node_runtime.tools` on the runtime that enforces them now, so
// this test asks the same question of the same list, one level closer to the truth.
const RUNTIME = builtinReviewers().claude;
const NODE_DENY_TOOLS = RUNTIME.node_runtime.tools.deny_always;
const INTENT_DENY_TOOLS = RUNTIME.node_runtime.tools.deny_intent;

function intentDisallowedTools() {
  // One of this repository's runs, so spawn-node admits it: run-dir-trust.plan.md stage 3 (ARCHITECTURE A-28).
  const { base, dir } = repoRunDir({ prefix: 'quorate-g56-', json: { stamps: [] } });
  try {
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'intent-settings.json'), JSON.stringify({ permissions: { deny: ['Grep'] } }));
    const r = runScript('spawn-node.mjs', [
      '--run-dir', dir, '--repo-root', REPO_ROOT,
      '--node-id', 'intent-capture', '--mode', 'intent', '--prompt', 'x',
      '--settings', path.join(dir, 'intent-settings.json'),
      '--add-dir', path.join(dir, 'docs'),
      '--print-cmd',
    ]);
    assert.equal(r.status, 0, `--print-cmd should exit 0; got ${r.status}\n${r.output.slice(-400)}`);
    const cmd = JSON.parse(r.stdout);
    const i = cmd.indexOf('--disallowedTools');
    assert.notEqual(i, -1, 'intent mode must pass --disallowedTools');
    const tools = [];
    for (let k = i + 1; k < cmd.length && !cmd[k].startsWith('--'); k++) tools.push(cmd[k]);
    return tools;
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('regression: intent mode denies Grep on the --disallowedTools flag, not only in the settings file', () => {
  const tools = intentDisallowedTools();
  assert.ok(tools.includes('Grep'), `Grep must be on the flag mirror; got ${JSON.stringify(tools)}`);
  // G-52: THIS ASSERTION USED TO BE A LITERAL, and a literal cannot go red for the reason the test
  // was written. It listed the same eight tools the generator listed, so a tool missing from the
  // generator AND the mirror was missing from the literal too, and the comparison passed — which is
  // exactly what happened while PowerShell was absent from every layer on the platform this
  // framework is developed on. Compared against the OWNER now: add a tool to decisions.mjs and this
  // fails until the flag mirror actually carries it.
  for (const t of denyToolsFor('intent', RUNTIME)) {
    assert.ok(tools.includes(t), `${t} must be denied on the flag in intent mode; got ${JSON.stringify(tools)}`);
  }
});

// The owner is only an owner if nothing renders a shorter set. A generator that quietly dropped an
// entry would satisfy the test above — both sides would agree on the shortened list — so the floor
// is pinned here, in the one place a deliberate removal has to be argued for rather than typed.
test('regression: the deny set never silently shrinks', () => {
  for (const t of ['Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task']) {
    assert.ok(NODE_DENY_TOOLS.includes(t), `${t} must stay denied for every node`);
  }
  // Rule 2 is these three TOGETHER (I-27) — each reads file content on its own, so removing any one
  // voids the sandbox while the other two still look like a sandbox.
  for (const t of ['Bash', 'PowerShell', 'Grep']) {
    assert.ok(INTENT_DENY_TOOLS.includes(t), `${t} reads file content — intent nodes must be denied it`);
  }
  assert.ok(!denyToolsFor('node', RUNTIME).includes('Bash'),
    'an ordinary lens keeps Bash: it runs capture.mjs, and denying it here would be a different bug');
});

// THE SAME HOLE, ON THE PLATFORM THIS FRAMEWORK IS DEVELOPED ON (G-28). Claude Code exposes a
// separate `PowerShell` tool on Windows — new-run's NODE policy has branched on that for months,
// naming it explicitly — while the INTENT deny list and this flag mirror named only Bash. A shell
// reads file content (`Get-Content`, `Select-String`), so every intent node ever run on Windows
// could have read the implementation it exists to precede, and nothing would have looked wrong.
//
// I-27 states the sandbox is three things TOGETHER — path-scoped Read, Grep denied, shell denied —
// and that removing any one silently voids it. One of the three was never there on this platform.
test('regression: intent mode denies EVERY shell tool, not just Bash', () => {
  const tools = intentDisallowedTools();
  for (const shell of ['Bash', 'PowerShell']) {
    assert.ok(tools.includes(shell),
      `${shell} must be denied in intent mode — a shell is a content reader; got ${JSON.stringify(tools)}`);
  }
});

// ...and the settings file, which is the other half. The flag survives a rejected settings file;
// the file is what applies when it validates. Both must carry the whole deny set or the sandbox is
// only as strong as whichever one happened to be read.
test('regression: the intent SETTINGS file denies every shell tool too', () => {
  // Reads the settings file the engine ACTUALLY WROTE for a real run, not the source text of the
  // function that writes it. The source-regex version passed on a `deny: [...]` array that no
  // caller reached; this fails if the file on disk is short, whatever the source looks like.
  // Minted the way regression-intent-drift-reach does, and the run id is read from THIS mint's own
  // output rather than latest.txt — that pointer is rewritten by every run in the repository, so a
  // concurrent test's mint would hand this one the wrong directory.
  // UNIQUE, not fixed: a full suite run mints this file's runs twice at once (check-counted-facts
  // spawns an inner `node --test` to count the suite), and two mints in the same second with the
  // same slug collide on the run directory. This test had a fixed slug and failed about once per
  // full run, green every time it was re-run alone.
  const slug = mintSlug('g52denyset');
  // In a small fixture, not this repository (test-suite-cost.md): the file under test is what the engine writes for ANY
  // run, and minting here walked and hashed this whole tree.
  const fx = detectorFixture();
  const mint = runScript('new-run.mjs', ['--repo-root', fx, '--slug', slug, '--no-verify-sandbox', '--no-verify-reviewers', '--no-request', '--full-sweep', 'src'], { cwd: fx });
  assert.equal(mint.status, 0, `mint failed:
${mint.output.slice(-400)}`);
  // From the mint output, not rebuilt from a layout: this test is about the intent sandbox denying
  // shell tools, and joining .claude/reviews also pinned WHERE runs live -- which broke it when they
  // moved out of the reviewed tree, for a reason it has nothing to do with.
  const runDir = mintedRunDir(mint.output);
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(runDir, 'intent-settings.json'), 'utf8'));
    const deny = settings?.permissions?.deny ?? [];
    for (const t of denyToolsFor('intent', RUNTIME)) {
      assert.ok(deny.includes(t), `the written intent-settings.json must deny ${t}; got ${JSON.stringify(deny)}`);
    }
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

// RULE 2'S ENFORCEMENT POINT WAS NEVER PROBED (G-62, panel-codex-docs).
//
// §5 mandates it in terms — "spawning an intent-mode node that deliberately attempts a source read,
// and asserting the denial appears in permission_denials[]" — and gate 4 probed node-settings.json,
// the PERMISSIVE policy. intent-settings.json was written, structurally validated, and never
// exercised: proven well-formed, which is not proven applied, and that distinction is the entire
// reason gate 4 exists for the other file.
//
// The probe is live, so this test asserts its SHAPE rather than running it: both arms present, the
// negative arm checking for leaked CONTENT rather than for the word "denied", and the whole thing
// behind the same --no-verify-sandbox switch the offline suite already uses.
// REMOVED (G-22 of 20261001-155615-cgg-review-r3): "gate 4 probes the intent policy" asserted the canary's spelling — both arms under intent-settings.json, the leak and positive checks.
// It matched source text, so an equivalent rewrite failed it and a broken wiring with the same spelling passed. The
// property is now DRIVEN in regression-cgg-r3-remediation.test.mjs, through a fake runtime passed with --runtime-bin,
// which logs what the node was actually handed.
