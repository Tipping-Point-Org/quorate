// REMOVALS ARE FLAGGED BEFORE THEY HAPPEN (shared/compatibility.md, "Removals"; m3-v1.plan.md stage 3).
//
// Anything 2.0 removes is flagged by check-install for at least one 1.x release. Nothing read a deprecation list, so a
// consumer learned of a removal when its command or contract key stopped working. compatibility.json's `deprecated` is
// the list's one owner; deprecationsUsed decides which entries a project uses, and check-install reports them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript } from './helpers.mjs';
import { deprecationsUsed, deprecationEntryError } from '../scripts/lib/compatibility.mjs';

const compat = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'compatibility.json'), 'utf8'));
const entry = (kind, name) => ({ kind, name, since: '1.2.0', removed_in: '2.0.0', use_instead: 'use the new one' });

test('every entry of the shipped list is well formed', () => {
  assert.ok(Array.isArray(compat.deprecated), 'deprecated is not a list');
  assert.deepEqual(compat.deprecated.map(deprecationEntryError).filter(Boolean), []);
});

test('a deprecated contract key is found in the contract, a consumer-named map through *', () => {
  const contract = { review: { old_key: 1 }, lenses: { mine: { old_field: 'x' } } };
  const used = deprecationsUsed([entry('contract-key', 'review.old_key'), entry('contract-key', 'lenses.*.old_field'),
    entry('contract-key', 'review.absent')], { contract });
  assert.deepEqual(used.map((u) => u.where), ['contract key review.old_key', 'contract key lenses.mine.old_field']);
});

test('a deprecated flag is found where the project invokes quorate, and only as that command\'s flag', () => {
  const texts = [
    { file: '.claude/settings.json', text: '"command": "node .claude/skills/quorate/scripts/stop-guard.mjs --old-flag"' },
    { file: '.git/hooks/pre-push', text: 'node other.mjs --old-other' },
  ];
  const used = deprecationsUsed([entry('flag', 'stop-guard --old-flag'), entry('flag', 'stop-guard --old-other'),
    entry('flag', 'stop-guard --old')], { contract: null, texts });
  assert.deepEqual(used.map((u) => `${u.name} @ ${u.where}`), ['stop-guard --old-flag @ .claude/settings.json']);
});

// G-4 of 20261124-021129-m3s9-remediation-2-review-b: the match required script and flag on one physical line, so a
// hook command split with a shell line continuation (\ in sh, ` in PowerShell, ^ in cmd) used the flag unreported.
test('G-4: a deprecated flag is found across a line continuation, and not across a plain line break', () => {
  const texts = [
    { file: '.git/hooks/pre-push', text: '#!/bin/sh\nnode .claude/skills/quorate/scripts/stop-guard.mjs \\\n  --old-flag\n' },
    { file: 'hook.ps1', text: 'node .claude/skills/quorate/scripts/stop-guard.mjs `\r\n  --old-ps\r\n' },
    { file: 'hook.cmd', text: 'node .claude/skills/quorate/scripts/stop-guard.mjs ^\r\n  --old-cmd\r\n' },
    { file: '.git/hooks/pre-commit', text: 'node .claude/skills/quorate/scripts/stop-guard.mjs\nother --old-separate\n' },
  ];
  const used = deprecationsUsed(['--old-flag', '--old-ps', '--old-cmd', '--old-separate'].map((f) => entry('flag', `stop-guard ${f}`)),
    { contract: null, texts });
  assert.deepEqual(used.map((u) => `${u.name} @ ${u.where}`), [
    'stop-guard --old-flag @ .git/hooks/pre-push', 'stop-guard --old-ps @ hook.ps1', 'stop-guard --old-cmd @ hook.cmd',
  ]);
});

// G-9 of 20261124-030759-m3s9-remediation-3-review-b: all three continuation marks were joined in every file, so a caret
// or backtick ending a line of an sh hook, or a backslash ending one in PowerShell, merged two commands into one and a
// flag the quorate command never took was reported. Each file's own shell decides which mark continues a line.
test('G-9: a line ends a command unless it ends with the continuation of that file\'s own shell', () => {
  const texts = [
    { file: '.git/hooks/pre-push', text: '#!/bin/sh\nnode .claude/skills/quorate/scripts/stop-guard.mjs ^\nother --old-caret\n' },
    { file: '.git/hooks/pre-commit', text: '#!/bin/sh\necho "node .claude/skills/quorate/scripts/stop-guard.mjs `\nother --old-tick\n' },
    { file: 'hook.ps1', text: 'node .claude/skills/quorate/scripts/stop-guard.mjs \\\r\nother --old-slash\r\n' },
    { file: 'hook.cmd', text: 'node .claude/skills/quorate/scripts/stop-guard.mjs `\r\nother --old-cmd-tick\r\n' },
  ];
  const used = deprecationsUsed(['--old-caret', '--old-tick', '--old-slash', '--old-cmd-tick'].map((f) => entry('flag', `stop-guard ${f}`)),
    { contract: null, texts });
  assert.deepEqual(used.map((u) => `${u.name} @ ${u.where}`), [], 'another shell\'s continuation mark joined two commands');
});

test('a malformed entry is refused with its reason', () => {
  assert.match(deprecationEntryError({ kind: 'script', name: 'x' }), /kind/);
  assert.match(deprecationEntryError({ ...entry('flag', 'stop-guard'), name: 'stop-guard' }), /<script> --flag/);
  assert.match(deprecationEntryError({ ...entry('contract-key', 'a'), use_instead: '' }), /use_instead/);
});

test('check-install reads the shipped list and says how many entries this project uses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-compatrm-'));
  try {
    spawnSync('git', ['init', '-q', '.'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n  build: ""\n```\n');
    const r = runScript('check-install.mjs', ['--repo-root', dir], { cwd: dir });
    assert.match(r.output, new RegExp(`deprecations: ${compat.deprecated.length} listed, 0 used here`), r.output.slice(-1500));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
