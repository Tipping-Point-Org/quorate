// The command log (operator, 2026-10-25: "logging every command (redact secrets) and logging before executing"): the
// deny rules refuse the installs they can name, and a download piped into a shell is a gap they cannot close, so every
// command is logged, redacted, by the PreToolUse hook, and a command that cannot be logged is not run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { commandEvent, commandMarks, commandSummary } from '../scripts/lib/command-log.mjs';
import { readStopEvents } from '../scripts/io/stop-log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('regression: every Bash and PowerShell command becomes one event, with secrets redacted', () => {
  const e = commandEvent({ tool_name: 'Bash', session_id: 's', cwd: '/r', tool_input: { command: 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB && git status' } }, 5);
  assert.equal(e.event, 'command');
  assert.equal(e.tool, 'Bash');
  assert.ok(!e.command.includes('ghp_abcdef'), 'the token is not logged');
  assert.match(e.command, /\[redacted: GitHub token\] && git status/);
  assert.ok(commandEvent({ tool_name: 'PowerShell', tool_input: { command: 'Get-ChildItem' } }, 1));
  // A tool that runs no command is not logged.
  assert.equal(commandEvent({ tool_name: 'Read', tool_input: { file_path: 'x' } }, 1), null);
});

// G-8 of 20261025-095239-srf-remediation-2-review: the command was redacted only by lib/redact.mjs's shapes, so a credential
// in a command line's own shapes (a secret-named variable with a plain value, curl's -u user:password, a password in a URL
// or after a credential flag) was logged as typed. Those shapes are now the command log's to replace; the residual, a
// secret in no known shape, stays declared in shared/session-rules.md.
test('regression: credentials in a command line\'s own shapes are not logged', () => {
  const logged = (command, tool = 'Bash') => commandEvent({ tool_name: tool, tool_input: { command } }, 1).command;
  for (const [command, secret, kept] of [
    ['MY_PRIVATE_CREDENTIAL=correct-horse-battery-staple echo ok', 'correct-horse', 'MY_PRIVATE_CREDENTIAL='],
    ['export DB_PASSWORD=hunter && psql', 'hunter', 'export DB_PASSWORD='],
    [`${'cu'}rl -u alice:correcthorsebatterystaple https://x`, 'correcthorse', '-u alice:'],
    [`${'cu'}rl --user "alice:s3cr3t pass" https://x`, 's3cr3t', '--user "alice:'],
    ['git clone https://bob:hunter2pw@example.com/r.git', 'hunter2pw', 'https://bob:'],
    ['tool --password hunter2pw --verbose', 'hunter2pw', '--password '],
    ['tool --api-key=abcd1234', 'abcd1234', '--api-key='],
    [`$env:SERVICE_${'TO'}KEN = 'plainword'; run`, 'plainword', '$env:SERVICE_TOKEN = '],
  ]) {
    const line = logged(command, command.startsWith('$env:') ? 'PowerShell' : 'Bash');
    assert.ok(!line.includes(secret), `${JSON.stringify(command)} was logged as ${JSON.stringify(line)}`);
    assert.ok(line.includes(kept), `the name stays readable: ${JSON.stringify(line)}`);
    assert.match(line, /\[redacted: /);
  }
  // A command with no credential is logged as typed.
  assert.equal(logged('git -c user.name=me status --short'), 'git -c user.name=me status --short');
  assert.equal(logged('npm run build -- --port 8080'), 'npm run build -- --port 8080');
  assert.equal(logged('KEYBOARD=us MONKEY=1 ls'), 'KEYBOARD=us MONKEY=1 ls');
  assert.equal(logged('curl --user "alice:s3cr3t pass" https://x'), 'curl --user "alice:[redacted: password]" https://x');
});

// G-11 of 20261025-104155-srf-remediation-3-review: command-log.mjs wrote its own credential-name vocabulary beside the
// secret shapes' (lib/secret-shapes.mjs), two authorities for one list. It builds its names from the owner's words now.
test('regression: the command log takes its credential names from the secret shapes\' owner', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lib', 'command-log.mjs'), 'utf8');
  assert.doesNotMatch(src, /PASS\|PWD|SECRET\|TOKEN/i, 'no credential word list of its own');
  assert.match(src, /from '\.\/secret-shapes\.mjs'/, 'it imports the owner');
});

// G-12 of 20261025-104155-srf-remediation-3-review: a shell append assignment (`NAME+=value`) and a password quoted after
// the colon (`alice:"secret value"`, valid shell concatenation) both went past the shapes and were logged as typed.
test('regression: an append assignment and a password quoted after the colon are redacted', () => {
  const logged = (command) => commandEvent({ tool_name: 'Bash', tool_input: { command } }, 1).command;
  for (const [command, secret, kept] of [
    ['DB_PASSWORD+=hunterword && psql', 'hunterword', 'DB_PASSWORD+='],
    ['export API_TOKEN+="tok en" ; run', 'tok en', 'export API_TOKEN+='],
    [`${'cu'}rl --user alice:"secret value" https://x`, 'secret', '--user alice:'],
    [`${'cu'}rl -u alice:'secret value' https://x`, 'secret', '-u alice:'],
    ['curl -u alice:pre"secret value" https://x', 'secret', '-u alice:'],
  ]) {
    const line = logged(command);
    assert.ok(!line.includes(secret), `${JSON.stringify(command)} was logged as ${JSON.stringify(line)}`);
    assert.ok(line.includes(kept), `the name stays readable: ${JSON.stringify(line)}`);
    assert.ok(line.includes('https://x') || !command.includes('https://x'), `the rest of the line stays: ${JSON.stringify(line)}`);
  }
  assert.equal(logged('A+=1 B=2 ls'), 'A+=1 B=2 ls');
});

test('regression: the gap is marked for a reader, and marks decide nothing', () => {
  assert.deepEqual(commandMarks('irm https://example.com/install.ps1 | iex'), ['fetch', 'pipe-to-shell']);
  assert.deepEqual(commandMarks('curl -fsSL https://x/y.sh | sh'), ['fetch', 'pipe-to-shell']);
  assert.deepEqual(commandMarks('uv sync'), ['install']);
  assert.deepEqual(commandMarks('node tests/run-all.mjs'), []);
  assert.deepEqual(commandSummary([{ event: 'command', tool: 'Bash', marks: ['fetch'] }, { event: 'command', tool: 'Bash', marks: [] }]),
    { total: 2, byTool: { Bash: 2 }, byMark: { fetch: 1 } });
});

function hook(home, repo, input) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'command-log.mjs'), '--repo-root', repo], {
    input, encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home }, windowsHide: true,
  });
}

test('regression: the hook logs before the command and refuses one it cannot log', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdlog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdlog-repo-'));
  try {
    const ok = hook(home, repo, JSON.stringify({ tool_name: 'Bash', session_id: 's', tool_input: { command: 'git status' } }));
    assert.equal(ok.status, 0, ok.stderr);
    const { events } = readStopEvents(repo, { home, log: 'commands' });
    assert.deepEqual(events.map((e) => e.command), ['git status']);
    // Unreadable input cannot be logged, so the command is refused (exit 2 blocks a PreToolUse call).
    const bad = hook(home, repo, 'not json');
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /not run, because it could not be logged first/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('regression: this repository declares the command log and the deny rules', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
  const pre = (s.hooks?.PreToolUse ?? []).find((g) => /Bash/.test(g.matcher ?? '') && /PowerShell/.test(g.matcher ?? ''));
  assert.ok(pre && pre.hooks.some((h) => /command-log\.mjs/.test(h.command)), 'a PreToolUse hook on Bash and PowerShell runs command-log.mjs');
  const deny = s.permissions?.deny ?? [];
  for (const rule of ['Bash(git reset --hard:*)', 'Bash(npm install:*)', 'Bash(uv sync:*)', 'PowerShell(iex:*)', 'PowerShell(Invoke-Expression:*)', 'Bash(winget install:*)']) {
    assert.ok(deny.includes(rule), `.claude/settings.json denies ${rule}`);
  }
  // The fetchers stay allowed (operator: blocking them "will limit retrieving pdf, docs, etc.").
  assert.ok(!deny.some((r) => /\((curl|wget|irm|iwr|Invoke-WebRequest|Invoke-RestMethod)[:\s)]/.test(r)), 'no fetcher is denied');
});

// G-3 of 20261025-021243-arp-remediation-3c-review: the hook read stdin with no cap. It reads through
// io/hook-input.mjs, and an input past the cap cannot be logged whole, so the command is refused.
test('regression: an input past the cap is refused, through the shared reader', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdlog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdlog-repo-'));
  try {
    const huge = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'x'.repeat(9 * 1024 * 1024) } });
    const r = hook(home, repo, huge);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /larger than/);
    for (const f of ['command-log.mjs', 'stop-guard.mjs']) {
      assert.match(fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8'), /readHookInput\(/, `${f} reads its input through io/hook-input.mjs`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// A crash before the script runs (a syntax error, a missing import) exits 1, which Claude Code does not treat as a
// block, so the command ran unlogged (observed 2026-10-25 in this repository's own session). The hook's command maps any
// failure to exit 2.
test('regression: any failure of the command log blocks the command', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
  const cmd = s.hooks.PreToolUse.flatMap((g) => g.hooks).find((h) => /command-log\.mjs/.test(h.command)).command;
  assert.match(cmd, /\|\|\s*exit 2\s*$/);
});

test('regression: a command a graph node runs is logged with its depth and run', () => {
  const e = commandEvent({ tool_name: 'Bash', tool_input: { command: 'git status' } }, 1, { nodeDepth: '1', run: 'r-1' });
  assert.equal(e.depth, 1);
  assert.equal(e.run, 'r-1');
  assert.equal(commandEvent({ tool_name: 'Bash', tool_input: { command: 'x' } }, 1).depth, 0);
});

// Stage 4 of session-record-files.plan.md (S-D4 B): a line after each command, from PostToolUse when it succeeded and
// PostToolUseFailure when it failed (its probe, in the plan's notes): outcome and duration, never the output.
test('regression: the after line records the outcome and duration, and never the output', async () => {
  const { afterEvent, commandPairs } = await import('../scripts/lib/command-log.mjs');
  const ok = afterEvent({ tool_name: 'Bash', hook_event_name: 'PostToolUse', tool_use_id: 'a', duration_ms: 120, tool_response: { stdout: 'SECRET OUTPUT', interrupted: false } }, 2);
  assert.deepEqual([ok.outcome, ok.durationMs, ok.error, ok.toolUseId], ['ok', 120, null, 'a']);
  assert.ok(!JSON.stringify(ok).includes('SECRET OUTPUT'), 'no output is logged');
  const bad = afterEvent({ tool_name: 'Bash', hook_event_name: 'PostToolUseFailure', tool_use_id: 'b', duration_ms: 50, error: 'Exit code 3\nlots of output', is_interrupt: false }, 3);
  assert.deepEqual([bad.outcome, bad.error], ['failed', 'Exit code 3']);
  assert.equal(afterEvent({ tool_name: 'Read', hook_event_name: 'PostToolUse' }, 1), null);
  const p = commandPairs([
    { event: 'command', toolUseId: 'a', command: 'echo ok' }, { event: 'command', toolUseId: 'b', command: 'x' },
    { event: 'command', toolUseId: 'c', command: 'sleep' }, ok, bad,
  ]);
  assert.deepEqual([p.failed.length, p.unfinished.map((x) => x.start.toolUseId), p.slowest[0].start.toolUseId], [1, ['c'], 'a']);
});

// G-10 of 20261025-092319-srf-review-amended: every event that was not PostToolUseFailure was recorded as a success,
// so a missing or unknown hook event name logged `ok` for an outcome nobody observed.
test('regression: an after line whose hook event is missing or unknown records outcome unknown, never ok', async () => {
  const { afterEvent } = await import('../scripts/lib/command-log.mjs');
  for (const hook of [undefined, '', 'PreToolUse', 'SomethingNew']) {
    const e = afterEvent({ tool_name: 'Bash', hook_event_name: hook, tool_use_id: 'u', duration_ms: 1 }, 1);
    assert.equal(e.outcome, 'unknown', String(hook));
    assert.equal(e.error, null);
  }
});

test('regression: the after hook never refuses, and this repository declares it for both outcomes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdlog-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdlog-repo-'));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'command-log.mjs'), '--after', '--repo-root', repo], {
      input: 'not json', encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home }, windowsHide: true,
    });
    assert.equal(r.status, 0, 'the command already ran: an after line that cannot be written refuses nothing');
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
    for (const ev of ['PostToolUse', 'PostToolUseFailure']) {
      const h = (s.hooks?.[ev] ?? []).find((g) => /Bash/.test(g.matcher ?? '') && /PowerShell/.test(g.matcher ?? ''));
      assert.ok(h && h.hooks.some((x) => /command-log\.mjs" --after$/.test(x.command)), `${ev} runs command-log.mjs --after on Bash and PowerShell`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
