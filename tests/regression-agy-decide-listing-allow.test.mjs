// decision-panel-seats.plan.md stage 6, found live (2026-11-11, decision 20261111-172326-aaa7f7; operator: "A. Allow
// listing only (Recommended)"): with the cited copies in its directory and the prompt saying so, agy's model still began
// with a directory listing (`Get-ChildItem -Force`, then `dir` on the retry), headless agy denied both, and the seat
// answered nothing. agy reads a per-call `--settings` (a JSON object of settings.json keys, never saved), and its
// `command(<x>)` rule admits exactly the command line x: `command(Get-ChildItem)` does not admit `Get-ChildItem -Force`,
// `*` and `:*` are not wildcards, and an admitted line chained with `;`, `|` or `&` is refused (measured with agy 1.5.5
// and 1.5.6; scripts/reviewers.json's `$listing_allow` records it). So a decide-mode call of agy, and no other mode, now carries
// `--settings` allowing a fixed list of bare directory listings, each a listing command and flags only, never a path; a
// validator holds the list to that shape, so no rule can admit a path, a chain or another command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { reviewerArgv } from '../scripts/lib/decisions.mjs';
import { adapterErrors, listingAllowErrors } from '../scripts/lib/reviewers.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import { runScript } from './helpers.mjs';

const settingsOf = (argv) => {
  const i = argv.indexOf('--settings');
  return i === -1 ? null : JSON.parse(argv[i + 1]);
};

test('agy\'s decide-mode argv carries --settings allowing the listings, exactly, and no other mode does', () => {
  const agy = builtinReviewers().agy;
  const decide = reviewerArgv({ adapter: agy, reviewer: 'agy', model: 'Gemini 3.8 Flash (High)', mode: 'decide', schemaFile: '/s.json' }).argv;
  const s = settingsOf(decide);
  assert.ok(s, `no --settings in a decide-mode call: ${decide.join(' ')}`);
  assert.deepEqual(Object.keys(s), ['permissions'], 'the per-call settings carry more than the permission');
  assert.deepEqual(s.permissions.allow, agy.listing_allow.commands.map((c) => `command(${c})`));
  for (const mode of ['review', 'tie-break', 'propose', 'claim-check', undefined]) {
    const argv = reviewerArgv({ adapter: agy, reviewer: 'agy', model: 'm', mode, schemaFile: '/s.json' }).argv;
    assert.equal(settingsOf(argv), null, `a ${mode ?? 'mode-less'} call carries the listing rule`);
  }
  // Another adapter declaring nothing gets nothing.
  assert.equal(settingsOf(reviewerArgv({ adapter: builtinReviewers().codex, reviewer: 'codex', mode: 'decide' }).argv), null);
});

test('the shipped list holds the sighted listings, each a listing command and flags only', () => {
  const { commands } = builtinReviewers().agy.listing_allow;
  for (const sighted of ['Get-ChildItem', 'Get-ChildItem -Force', 'dir']) assert.ok(commands.includes(sighted), `${sighted} is not allowed`);
  for (const refused of ['Get-ChildItem -Path ..', 'Get-ChildItem -Path .', 'Get-Content', 'Remove-Item']) assert.ok(!commands.includes(refused), `${refused} is allowed`);
  assert.deepEqual(listingAllowErrors('agy', builtinReviewers().agy), []);
  assert.deepEqual(adapterErrors('agy', builtinReviewers().agy), []);
});

test('the validator refuses a rule that names a path, a chain, a redirect or any other command', () => {
  const with_ = (commands) => ({ cmd: 'x', roles: ['reviewer'], prompt: { via: 'stdin' }, response: { from: 'file' },
    listing_allow: { modes: ['decide'], flag: '--settings', commands } });
  assert.deepEqual(listingAllowErrors('x', with_(['ls -la', 'dir /a', 'Get-ChildItem -Force -Recurse'])), []);
  for (const bad of ['Get-ChildItem -Path ..', 'ls ..', 'ls /etc', 'dir C:\\', 'Get-ChildItem; Remove-Item x', 'ls | rm',
    'dir & del x', 'ls > out', 'Get-Content note.txt', 'Remove-Item -Force', 'cat x', 'ls -la\nrm x', '', 'ls  -la']) {
    const errs = listingAllowErrors('x', with_([bad]));
    assert.ok(errs.length, `${JSON.stringify(bad)} was admitted as a bare listing`);
  }
  assert.ok(listingAllowErrors('x', { ...with_(['ls']), listing_allow: { modes: ['review'], flag: '--settings', commands: ['ls'] } }).length,
    'a listing rule in a mode other than decide was admitted');
  assert.ok(adapterErrors('x', with_(['ls ..'])).some((e) => /listing/.test(e)), 'adapterErrors does not hold the rule');
});

// ------------------------------------------------------------------------------------------------ driven, with a fake agy
function fakeAgyMain() {
  const fs = require('node:fs');
  const path = require('node:path');
  const here = path.dirname(process.argv[1]);
  const a = process.argv.slice(2);
  if (a.includes('--version')) { process.stdout.write('fake-agy 1.0\n'); return; }
  try { fs.readFileSync(0, 'utf8'); } catch { /* none */ }
  fs.appendFileSync(path.join(here, 'calls.jsonl'), `${JSON.stringify({ argv: a })}\n`);
  const answer = { status: 'ok', reason: '', verdict: 'PASS', findings: [], checked_clean: [], not_checked: [],
    choice: 'E1', rationale: 'probe', other_text: '', change_of: '', what_would_change: 'probe', citations: ['probe'] };
  process.stdout.write(`${JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: JSON.stringify(answer),
    ...(a.includes('--json-schema') ? { structured_output: answer } : {}), usage: { input_tokens: 1, output_tokens: 1 } } })}\n`);
}
function call(t, mode) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-allow-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const fake = path.join(bin, 'fake-agy.mjs');
  fs.writeFileSync(fake, `import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n(${fakeAgyMain.toString()})();\n`);
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  const fwd = (p) => p.split(path.sep).join('/');
  const base = builtinReviewers().agy.base_argv.map((x) => `"${x}"`).join(', ');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 5', 'project: t', 'commands:',
    '  build: ""', '  test: ""', 'review:', '  external_panel: true', 'reviewers:', '  agy:',
    '    probe_timeout_minutes: 0.5', '    version_timeout_seconds: 10', '    check_margin_seconds: 2',
    `    cmd: "${fwd(process.execPath)}"`, `    version_argv: ["${fwd(fake)}", "--version"]`, `    base_argv: ["${fwd(fake)}", ${base}]`,
    '```', ''].join('\n'));
  const ev = path.join(dir, 'home', 'ev');
  fs.mkdirSync(ev, { recursive: true });
  const prompt = path.join(dir, 'prompt.md');
  fs.writeFileSync(prompt, 'Choose an entry.\n');
  const r = runScript('external-review.mjs', ['--reviewer', 'agy', '--prompt-file', prompt, '--mode', mode,
    ...(mode === 'review' ? ['--schema', '{"verdict":"PASS|RISK|FAIL"}'] : []), '--evidence-dir', ev, '--out', path.join(ev, 'out.json')],
    { cwd: repo, env: { QUORATE_HOME: path.join(dir, 'home'), QUORATE_REVIEWER_PROBES: path.join(dir, 'probes') } });
  const calls = fs.readFileSync(path.join(bin, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { r, calls };
}

test('through external-review: every decide-mode call of agy, its probe included, carries the listing rule; a review call none', (t) => {
  const d = call(t, 'decide');
  assert.equal(d.r.status, 0, d.r.output);
  assert.ok(d.calls.length >= 2, 'the probe and the call did not both reach the fake');
  for (const c of d.calls) {
    const s = settingsOf(c.argv);
    assert.ok(s, `a decide-mode call carried no --settings: ${c.argv.join(' ')}`);
    assert.ok(s.permissions.allow.includes('command(Get-ChildItem -Force)'));
  }
  const rv = call(t, 'review');
  for (const c of rv.calls) assert.equal(settingsOf(c.argv), null, `a review call carried the listing rule: ${c.argv.join(' ')}`);
});
