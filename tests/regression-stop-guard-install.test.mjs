// autonomous-run-pauses.plan.md stage 5: a consuming project gets the stop guard by declaring it in its own
// .claude/settings.json (stage 1's probe: a plugin's hooks did not fire from the project-level mount), so check-install
// must say whether it is declared, both hooks of it, or the project's sessions stop unguarded with nothing saying so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopGuardDeclared } from '../scripts/lib/stop-record.mjs';
import { runScript, REPO_ROOT } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cmd = (c) => ({ hooks: [{ type: 'command', command: c }] });

// The Stop and turn-start halves only: the StopFailure hook (autonomous-run.plan.md stage 7 part 2) is checked below.
const twoHooks = (s) => { const d = stopGuardDeclared(s); return { stop: d.stop, turnStart: d.turnStart }; };

test('regression: the guard counts as declared only with both its hooks', () => {
  const both = { hooks: {
    Stop: [cmd('node .claude/skills/quorate/scripts/stop-guard.mjs')],
    UserPromptSubmit: [cmd('node .claude/skills/quorate/scripts/stop-guard.mjs --turn-start')],
  } };
  assert.deepEqual(twoHooks(both), { stop: true, turnStart: true });
  assert.deepEqual(twoHooks({ hooks: { Stop: both.hooks.Stop } }), { stop: true, turnStart: false });
  // A Stop hook running something else is not the guard; and the turn-start hook is the one with --turn-start.
  assert.deepEqual(twoHooks({ hooks: { Stop: [cmd('node other.mjs')], UserPromptSubmit: [cmd('node .claude/skills/quorate/scripts/stop-guard.mjs')] } }),
    { stop: false, turnStart: false });
  assert.deepEqual(twoHooks(null), { stop: false, turnStart: false });
  assert.deepEqual(twoHooks({ hooks: 'nonsense' }), { stop: false, turnStart: false });
  // G-10 of 20261024-220920-arp-delivery: a command that only mentions the guard's name does not run it.
  assert.deepEqual(twoHooks({ hooks: { Stop: [cmd('echo stop-guard.mjs')], UserPromptSubmit: [cmd('echo stop-guard.mjs --turn-start')] } }),
    { stop: false, turnStart: false });
  assert.deepEqual(twoHooks({ hooks: { Stop: [cmd('node other.mjs stop-guard.mjs')] } }), { stop: false, turnStart: false });
  assert.deepEqual(twoHooks({ hooks: { Stop: [cmd('node "$CLAUDE_PROJECT_DIR/scripts/stop-guard.mjs"')] } }), { stop: true, turnStart: false });
});

test('regression: this repository declares both hooks', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(stopGuardDeclared(settings), { stop: true, turnStart: true, stopFailure: true });
  assert.ok(fs.readFileSync(path.join(ROOT, 'QUORATE.md'), 'utf8').includes('stop-guard.mjs'), 'QUORATE.md\'s setup names the hook to declare');
});

// G-16 of 20261024-220920-arp-delivery: this was a grep of check-install's source for the call, green with the result
// ignored. check-install is run here on a project in each state, and what it reports is asserted. G-4: a settings file
// that does not parse is named as that, not folded into "not declared".
test('regression: check-install reports the guard declared, half-declared, absent, or its settings unreadable', () => {
  const settingsWith = (hooks) => JSON.stringify({ hooks });
  const both = { Stop: [cmd('node .claude/skills/quorate/scripts/stop-guard.mjs')], UserPromptSubmit: [cmd('node .claude/skills/quorate/scripts/stop-guard.mjs --turn-start')] };
  const cases = [
    // G-1: the guard blocks once and allows the second attempt, so the note says that, not "only for a named reason".
    [settingsWith(both), /stop guard declared \(Stop and UserPromptSubmit\) — a stop the session rules do not allow is blocked once/],
    [settingsWith({ Stop: both.Stop }), /stop guard half-declared/],
    [null, /stop guard not declared/],
    ['{ "hooks": ', /\.claude[\\/]settings\.json could not be read as JSON/],
  ];
  for (const [settings, expected] of cases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-guard-install-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: dir });
      fs.copyFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
      if (settings != null) {
        fs.mkdirSync(path.join(dir, '.claude'));
        fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), settings);
      }
      const out = runScript('check-install.mjs', ['--repo-root', dir]).output;
      assert.match(out, expected);
      if (settings === '{ "hooks": ') assert.doesNotMatch(out, /stop guard not declared/, 'a broken settings file is not an absent guard');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
