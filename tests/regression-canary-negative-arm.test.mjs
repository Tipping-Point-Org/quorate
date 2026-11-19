// G-63: THE SANDBOX CANARY REFUSED MINTS ON A WORKING SANDBOX, ABOUT HALF THE TIME.
//
// Its negative arm asked the probe to CREATE A FILE and required a `permission_denials[]` entry.
// Three facts, each measured against the CLI rather than read off the settings file, say why that
// cannot work:
//
//   1. A tool killed by `--disallowedTools` returns a TOOL ERROR, not a permission denial. Probed
//      directly: the model tried, Write was gone, nothing was written, and permission_denials was
//      EMPTY -- "The Write tool is disabled for this session, and the call returned an error ...
//      going around it isn't my call." A working sandbox, reported as a broken one, with a message
//      sending the operator to inspect node-settings.json, which had loaded perfectly.
//   2. It passed at all only by luck: a model that reaches for a SHELL write instead trips
//      `Bash(Set-Content:*)`, a deny RULE, which does record. Which route the probe happened to take
//      was the entire difference between a mint and a refusal.
//   3. "Not on the allow-list" is NOT a refusal. `git log --oneline -1` and `node --version` both
//      ran under this policy despite neither being allow-listed, so an arm built on an unlisted
//      command would prove nothing.
//
// So the arm now runs a command the policy DENIES BY RULE -- the only refusal that reaches
// permission_denials[] -- and `cp` because both outcomes are safe AND observable: refused, the
// denial is recorded; permitted, a file appears where none should and the canary fails loudly.
// Measured after the change: 5 mints, 5 passes, against roughly one in two before.
//
// THIS TEST PINS THE FACT THE ARM RESTS ON. It cannot exercise the CLI -- that needs a model, and a
// canary that costs a model per test run would not be run. What it can do is fail the moment the
// deny rule the arm depends on stops existing, which is the way this arm would go inert: silently,
// while still looking exactly like a guard. new-run carries the same check at mint, so the failure
// is loud in both places.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, mintedRunDir } from './helpers.mjs';
import { shellToolsOf } from '../scripts/lib/capabilities.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

/** A minted run's generated node policy. `--no-verify-sandbox` because the canary needs a model. */
function nodePolicy() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-g63-'));
  try {
    const mint = runScript('new-run.mjs',
      ['--slug', 'g63', '--no-verify-sandbox', '--no-verify-reviewers', '--no-request', '--full-sweep', 'scripts'],
      { env: { QUORATE_HOME: home } });
    assert.equal(mint.status, 0, mint.output.slice(-300));
    const runDir = mintedRunDir(mint.output);
    const settings = JSON.parse(fs.readFileSync(path.join(runDir, 'node-settings.json'), 'utf8'));
    return { settings, runDir, home };
  } catch (e) {
    fs.rmSync(home, { recursive: true, force: true });
    throw e;
  }
}

test('the node policy still DENIES BY RULE the command the canary provokes a refusal with', () => {
  const { settings, home } = nodePolicy();
  try {
    const deny = settings.permissions?.deny ?? [];
    const denied = deny.filter((r) => /^(Bash|PowerShell)\(\s*cp:/.test(String(r)));
    assert.ok(denied.length >= 1,
      'the canary\'s negative arm runs `cp` because this rule refuses it. Without the rule the '
      + 'probe simply runs the copy, no denial is recorded, and the canary proves nothing while '
      + 'continuing to look like a guard. Deny list: ' + JSON.stringify(deny));

    // EVERY SHELL THE HOST EXPOSES, because the probe picks one and the run must not depend on which.
    // On Windows `cp` is a PowerShell alias for Copy-Item, so a rule covering only Bash leaves the
    // other route open — and "which tool did the model reach for" is exactly the coin-flip this arm
    // replaced. The set comes from the runtime's grants for THIS platform: a hardcoded
    // ['Bash', 'PowerShell'] failed every Linux CI run, where no PowerShell tool exists to deny
    // (diagnosed 2026-10-06, run 37552051536).
    const shells = shellToolsOf(builtinReviewers().claude, hostPlatform().id);
    assert.ok(shells.length >= 1, 'the runtime must grant at least one shell tool on this platform');
    for (const shell of shells) {
      assert.ok(deny.some((r) => new RegExp(`^${shell}\\(\\s*cp:`).test(String(r))),
        `${shell} must deny cp too; the probe chooses its own shell`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('and a deny RULE is a different thing from a tool removed by flag', () => {
  // The distinction that cost two wrong diagnoses, written down where the next reader meets it.
  // `Write` is denied AND stripped by --disallowedTools; `cp` is denied only by rule. Only the
  // second produces a permission_denials[] entry, so only the second can be a negative arm.
  const { settings, home } = nodePolicy();
  try {
    const deny = settings.permissions?.deny ?? [];
    assert.ok(deny.includes('Write'), 'Write is still denied — that part was never the problem');
    assert.ok(deny.some((r) => /^Bash\(\s*cp:/.test(String(r))),
      'and cp is denied by RULE, which is the only kind of refusal the canary can observe');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('an unlisted command is not refused, so the allow-list cannot be a negative arm', () => {
  // MEASURED, not inferred: `git log --oneline -1` and `node --version` both ran under this exact
  // policy. Neither appears in the allow-list, which names only git status / rev-parse / ls-files
  // and three node commands. Recorded here because an earlier fix DID build the negative arm on an
  // unlisted command, and it passed review by reading the allow-list and assuming it binds.
  const { settings, home } = nodePolicy();
  try {
    const allow = settings.permissions?.allow ?? [];
    assert.ok(!allow.some((r) => /^(Bash|PowerShell)\(\s*git log\b/.test(String(r))),
      'git log is absent from the allow-list — and it RAN anyway, which is the whole point');
    assert.ok(allow.some((r) => /^Bash\(\s*git status:/.test(String(r))),
      'while git status is present, so the list is real, just not a gate on the shell');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
