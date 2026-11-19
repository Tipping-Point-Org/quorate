// The panel arm that could be truncated on the way out.
//
// SINCE decision-panel-seats.plan.md stage 3 the shipped agy reads its prompt from stdin (stream-json), so what follows is
// about any reviewer whose prompt still goes inline in argv; the driven case declares one in a fixture contract.
//
// agy received its prompt inline in argv before that stage; codex receives its own on stdin. Windows CreateProcess
// caps a command line near 32767 characters, so a long brief sent inline either fails to spawn or
// arrives TRUNCATED — and a truncated brief does not fail loudly. The reviewer answers the
// fragment it was given, confidently, and `reconcile` counts it as an arm that reported: the false
// corroboration the panel exists to prevent, arriving through the transport rather than the model.
//
// Found by: cross-project review, 2026-08-24. A sibling project hit the argv ceiling on the same
// CLI and had to add an explicit permission opt-in to pass a prompt FILE instead; that path is
// refused here (it needs --dangerously-skip-permissions), so the size must be a decision made
// before the spawn. See shared/external-reviewers.md, "How the prompt reaches each reviewer, and the ceiling inline argv had".
//
// Offline by construction: the guard fires during argument handling, strictly before any
// subprocess is launched, and the unit half touches no process at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { INLINE_ARGV_BUDGET, fitsInlineArgv } from '../scripts/lib/decisions.mjs';
import { runScript, withTempDir } from './helpers.mjs';

test('the budget sits below the platform limit, with room for flags and the environment block', () => {
  assert.ok(INLINE_ARGV_BUDGET < 32767, 'a budget at or above the CreateProcess limit is no budget');
  assert.ok(INLINE_ARGV_BUDGET > 8000, 'a budget this tight would refuse ordinary review briefs');
});

test('fitsInlineArgv measures BYTES, not characters', () => {
  // A brief full of em dashes and accented names is ~3x its character count in UTF-8; measuring
  // .length would let exactly the prompts this repository writes slip past the guard.
  const multibyte = '—'.repeat(INLINE_ARGV_BUDGET); // 3 bytes each
  assert.equal(multibyte.length, INLINE_ARGV_BUDGET);
  assert.equal(fitsInlineArgv(multibyte), false, 'character-length would have passed this');
  assert.equal(fitsInlineArgv('x'.repeat(INLINE_ARGV_BUDGET)), true, 'exactly at budget still fits');
  assert.equal(fitsInlineArgv('x'.repeat(INLINE_ARGV_BUDGET + 1)), false);
});

test('an empty or missing prompt is not what this guard is for', () => {
  assert.equal(fitsInlineArgv(''), true);
  assert.equal(fitsInlineArgv(undefined), true, 'the missing-prompt case has its own refusal');
});

// THE BUG: without this check the oversized brief was handed to spawnSync anyway. The refusal must
// be a normal panel refusal — exit 0, one envelope, RISK, the reviewer named in not_checked[] —
// because a panel arm that dies loudly must still not block the run (shared/external-reviewers.md,
// "Failure handling").
// The shipped agy takes its prompt on stdin since decision-panel-seats.plan.md stage 3 (stdin-ndjson), so it is not held
// to the budget any more (regression-dps-agy-stream-json holds that). The refusal is a property of an ARGV reviewer, and is
// held here with a fixture contract that declares agy's prompt back on argv, as a consumer's override could.
test('regression: an oversized brief for an argv reviewer is refused by name, never sent as a fragment', () => {
  withTempDir((dir) => {
    const promptFile = path.join(dir, 'brief.txt');
    fs.writeFileSync(promptFile, 'x'.repeat(INLINE_ARGV_BUDGET + 1), 'utf8');
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-q', '.'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 5', 'project: t', 'commands:',
      '  build: ""', '  test: ""', 'review:', '  external_panel: true', 'reviewers:', '  agy:',
      '    base_argv: ["--print", "__PROMPT__", "--disable-slash-commands"]',
      '    prompt: { via: argv, placeholder: "__PROMPT__" }', '```', ''].join('\n'));

    const r = runScript('external-review.mjs', [
      '--reviewer', 'agy',
      '--prompt-file', promptFile,
    ], { cwd: repo });

    assert.equal(r.status, 0, 'a panel refusal exits 0; it reports, it does not block');
    const env = JSON.parse(r.stdout);
    assert.equal(env.verdict, 'RISK', 'PASS here would be counted as agreement by the reconciler');
    assert.equal(env.source, 'agy');
    assert.equal(env.findings.length, 0, 'a refusal asserts nothing about the code');
    assert.equal(env.not_checked.length, 1);
    assert.match(env.not_checked[0].item, /agy/, 'the arm that did not run must be named');
    assert.match(
      env.not_checked[0].reason,
      /inline in argv|argv/i,
      'the reason must say WHY, so the caller can act (trim the brief, or use codex)',
    );
    assert.match(env.not_checked[0].reason, /\d{4,}/, 'the measured size belongs in the reason');
  });
});

// The in-budget case is asserted by fitsInlineArgv above and NOT black-box: a small brief passes
// the guard, and the next thing the script does is spawn the real agy — a model call, on every
// commit, from a suite whose first rule is that it stays free and offline (helpers.mjs). The
// boundary this file exists to pin is the refusal; letting the happy path through to a subprocess
// would test the CLI's availability, not this decision. (Measured: that version of the test took
// 10 s and reached the installed agy.)

// G-9 of 20261110-010058-dps-remediation-2-review: the budget's own comment in scripts/lib/decisions.mjs still said agy
// receives its prompt INLINE IN ARGV after the shipped adapter moved it to stdin, so the budget's reason read as the
// shipped agy's when it is only an argv reviewer's.
test('the inline-argv budget\'s comment does not claim a stdin reviewer takes its prompt in argv', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
  const via = JSON.parse(fs.readFileSync(path.join(root, 'scripts/reviewers.json'), 'utf8')).reviewers?.agy?.prompt?.via;
  assert.ok(via, 'the shipped agy adapter declares no prompt.via');
  const src = fs.readFileSync(path.join(root, 'scripts/lib/decisions.mjs'), 'utf8').replace(/\s+/g, ' ');
  if (via !== 'argv') assert.doesNotMatch(src, /agy receives its prompt inline in argv/i, `agy's prompt goes via ${via}`);
});
