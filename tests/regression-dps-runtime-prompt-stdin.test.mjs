// decision-panel-seats.plan.md stage 2 (design DP-D1 A, operator 2026-11-09: "A. Stdin, every spawn (Recommended)"): the
// node runtime was handed its prompt inline in argv (`claude -p <prompt>`, lib/decisions.mjs nodeArgv), and Windows'
// CreateProcess caps a whole command line near 32,767 characters. Decision 20261107-213602-4f3308's Claude seat failed
// every round with `spawn-subagent: could not run claude: spawn ENAMETOOLONG` on a 33,827-byte prompt. Every spawn of the
// node runtime now writes the prompt to the child's stdin and the argv carries the bare `-p` alone, through every
// spawner: spawn-subagent, spawn-node (runChild), check-intent-grant, new-run's canary and both intent probes, and the
// bench forge (moved to nodeArgv; shAsync gains `input`). Held here: the two accessors and their validation, a census
// that no module reads either `via` property itself, a census of the adapter table's transports, a census that every
// runtime spawn hands nodeArgv's `input` to its spawn, and fake runtimes that record argv and stdin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runtimePromptVia, reviewerPromptVia, adapterErrors, rolesOf } from '../scripts/lib/reviewers.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import { nodeArgv, withRuntimeOverride } from '../scripts/lib/decisions.mjs';
import { runChild } from '../scripts/io/run-child.mjs';
import { shAsync } from '../scripts/io/pool.mjs';
import { spawnForge } from '../scripts/io/forge-spawn.mjs';
import { spawnSyncFrom } from '../scripts/io/stdin-file.mjs';
import { runScript, REPO_ROOT, repoRunDir, mintedRunDir } from './helpers.mjs';

const BIG = `${'A forty-kilobyte prompt, never in argv. '.repeat(1000)}END-OF-PROMPT`;   // 41 KB
const tmp = (t, prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
/**
 * No 64-byte piece of `text` appears in any argv element, once the text a prompt shares with argv BY DESIGN is set aside:
 * a path that is itself a whole argv element (the canary prompt names the run directory and the settings file, which are
 * also --add-dir and --settings). On macOS (CI runs 44220656481, 44240829385) the longer temporary paths moved a sample
 * into such a path and the prompt was reported in argv; read from the template, not reproduced.
 */
const noneInArgv = (argv, text) => {
  const joined = argv.join('\u0000');
  let rest = text;
  for (const a of argv) if (a.length >= 16) rest = rest.split(a).join('\u0001');
  for (let i = 0; i + 64 <= rest.length; i += 997) {
    const piece = rest.slice(i, i + 64);
    if (!piece.includes('\u0001') && joined.includes(piece)) return false;
  }
  return true;
};

// ------------------------------------------------------------------------------------------------ the fake runtime
// Records its argv, cwd and the whole of its stdin to calls.jsonl beside itself (an env var may be scrubbed), then prints
// one success envelope. Reading fd 0 returns '' for an ignored stdin, so the fake never blocks.
function fakeRuntimeMain() {
  const fs = require('node:fs');
  const path = require('node:path');
  let stdin = '';
  try { stdin = fs.readFileSync(0, 'utf8'); } catch { /* an ignored stdin */ }
  fs.appendFileSync(path.join(path.dirname(process.argv[1]), 'calls.jsonl'),
    `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), stdin })}\n`);
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, num_turns: 1,
    permission_denials: [], usage: { input_tokens: 0, output_tokens: 0 },
    result: JSON.stringify({ verdict: 'PASS', findings: [], not_checked: [], status: 'ok' }) }));
}
function fakeRuntime(t) {
  const dir = tmp(t, 'dps-fake-');
  const bin = path.join(dir, 'fake-runtime.cjs.mjs');
  // An ES module with require bound, so the serialized function runs as written.
  fs.writeFileSync(bin, `import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n(${fakeRuntimeMain.toString()})();\n`);
  const log = path.join(dir, 'calls.jsonl');
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  // A real runtime that slips past the override cannot authenticate (as regression-cgg-r3-remediation's fake guards).
  const noLogin = path.join(dir, 'no-login');
  fs.mkdirSync(noLogin);
  return { bin, calls, env: { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' } };
}
/** One recorded call: the bare marker leads the argv, the whole prompt is its stdin, and none of it is in argv. */
function assertStdinCall(call, prompt, where) {
  assert.equal(call.argv[0], '-p', `${where}: the argv does not lead with the bare -p: ${call.argv.slice(0, 3).join(' ')}`);
  assert.ok(call.argv[1] === undefined || call.argv[1].startsWith('-'), `${where}: -p is followed by prompt text, not a flag: ${String(call.argv[1]).slice(0, 80)}`);
  if (prompt !== null) assert.equal(call.stdin, prompt, `${where}: the prompt did not arrive whole on stdin (${call.stdin.length} of ${prompt.length} chars)`);
  else assert.ok(call.stdin.trim().length > 0, `${where}: nothing arrived on stdin`);
  assert.ok(noneInArgv(call.argv, call.stdin), `${where}: part of the prompt is in argv`);
}

// ------------------------------------------------------------------------------------------------ the accessors
test('the two accessors read their own property, and a runtime with no via reads argv', () => {
  assert.equal(runtimePromptVia({ node_runtime: { prompt: { flag: '-p' } } }), 'argv');
  assert.equal(runtimePromptVia({ node_runtime: { prompt: { flag: '-p', via: 'stdin', argv_marker: '-p' } } }), 'stdin');
  assert.equal(runtimePromptVia({ prompt: { via: 'stdin' } }), 'argv', 'the reviewer property was read for the runtime');
  assert.equal(reviewerPromptVia({ prompt: { via: 'argv' } }), 'argv');
  assert.equal(reviewerPromptVia({ node_runtime: { prompt: { via: 'stdin' } } }), undefined, 'the runtime property was read for a reviewer');
});

test('validation: a runtime via other than stdin or argv, and a stdin prompt with no marker, are refused; flag is still required', () => {
  const base = { cmd: 'rt', roles: ['node'], node_runtime: { prompt: { flag: '-p' } } };
  assert.deepEqual(adapterErrors('rt', base).filter((e) => /prompt/.test(e)), []);
  const bad = adapterErrors('rt', { ...base, node_runtime: { prompt: { flag: '-p', via: 'pipe' } } });
  assert.ok(bad.some((e) => /via must be 'stdin' or 'argv'/.test(e)), bad.join('\n'));
  const noMarker = adapterErrors('rt', { ...base, node_runtime: { prompt: { flag: '-p', via: 'stdin' } } });
  assert.ok(noMarker.some((e) => /argv_marker/.test(e)), noMarker.join('\n'));
  const noFlag = adapterErrors('rt', { ...base, node_runtime: { prompt: { via: 'stdin', argv_marker: '-p' } } });
  assert.ok(noFlag.some((e) => /prompt\.flag/.test(e)), noFlag.join('\n'));
  assert.deepEqual(adapterErrors('claude', builtinReviewers().claude), [], 'the shipped runtime is refused');
});

test('census: no module reads either via property itself; only the two accessors in lib/reviewers.mjs do', () => {
  const RUNTIME_READ = /node_runtime\??\.prompt\??\.via\b/;
  const REVIEWER_READ = /(?<!node_runtime\??)\.prompt\??\.via\b/;
  const hits = { runtime: [], reviewer: [] };
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(r); continue; }
      if (!/\.(mjs|js)$/.test(e.name)) continue;
      fs.readFileSync(path.join(REPO_ROOT, r), 'utf8').split(/\r?\n/).forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        // A message naming the property is not a read: strip string and template literals first.
        const code = t.replace(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""');
        if (RUNTIME_READ.test(code)) hits.runtime.push(`${r}:${i + 1}: ${t}`);
        else if (REVIEWER_READ.test(code)) hits.reviewer.push(`${r}:${i + 1}: ${t}`);
      });
    }
  };
  walk('scripts');
  assert.deepEqual(hits.runtime, ['scripts/lib/reviewers.mjs:' + lineOf('const via = adapter?.node_runtime?.prompt?.via;') + ': const via = adapter?.node_runtime?.prompt?.via;'],
    'a module reads node_runtime.prompt.via itself');
  assert.deepEqual(hits.reviewer, ['scripts/lib/reviewers.mjs:' + lineOf('return adapter?.prompt?.via;') + ': return adapter?.prompt?.via;'],
    'a module reads a reviewer\'s prompt.via itself');
});
function lineOf(text) {
  return fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'reviewers.mjs'), 'utf8').split(/\r?\n/).findIndex((l) => l.trim() === text) + 1;
}

test('census of the adapter table: every adapter\'s transport is named, and none with a stdin path is held to the argv budget', () => {
  const table = builtinReviewers();
  const transports = {};
  for (const [name, a] of Object.entries(table)) {
    const roles = rolesOf(a);
    if (roles.includes('node')) transports[`${name} (runtime)`] = runtimePromptVia(a);
    if (roles.includes('reviewer')) transports[`${name} (reviewer)`] = reviewerPromptVia(a) ?? '(none: prompt.required false)';
  }
  assert.deepEqual(transports, { 'claude (runtime)': 'stdin', 'codex (reviewer)': 'stdin', 'codex-review (reviewer)': 'stdin', 'agy (reviewer)': 'stdin-ndjson' },   // agy: stage 3
    'an adapter\'s transport changed: name it here, and say why in its table entry');
  for (const [name, a] of Object.entries(table)) {
    if (reviewerPromptVia(a) && reviewerPromptVia(a) !== 'argv') assert.equal(a.prompt.budget_bytes, undefined, `${name} takes stdin and still declares an argv budget`);
  }
  // The argv budget is consulted only for a reviewer whose prompt goes by argv.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const gates = src.split('\n').filter((l) => /fitsInlineArgv\(/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/^import/.test(l));
  assert.ok(gates.length >= 1 && gates.every((l) => /reviewerPromptVia\(ADAPTER\) === 'argv' && !fitsInlineArgv\(/.test(l)), gates.join('\n'));
});

// ------------------------------------------------------------------------------------------------ the builder
test('nodeArgv: the shipped runtime gets the bare -p and the prompt as input, whole, raw, none of it in argv', () => {
  const claude = builtinReviewers().claude;
  const r = nodeArgv(claude, { prompt: BIG, model: 'opus', effort: 'low' });
  assert.equal(r.argv[0], '-p');
  assert.equal(r.argv[1], '--model', 'prompt text follows the bare marker');
  assert.equal(r.input, BIG);
  assert.ok(noneInArgv(r.argv, BIG));
  // No newline guard on stdin: a prompt starting with "-" is not an option there.
  assert.equal(nodeArgv(claude, { prompt: '---\nfront matter', model: 'opus' }).input, '---\nfront matter');
  // An argv runtime is unchanged, and returns no input.
  const argvRt = { cmd: 'tiny', node_runtime: { prompt: { flag: '-p' } } };
  assert.deepEqual(nodeArgv(argvRt, { prompt: 'hello' }), { cmd: 'tiny', argv: ['-p', 'hello'], input: null });
});

test('withRuntimeOverride carries the input, overridden or not', () => {
  const spec = { cmd: 'claude', argv: ['-p', '--model', 'x'], input: BIG };
  assert.equal(withRuntimeOverride(spec, null, process.execPath).input, BIG);
  assert.deepEqual(withRuntimeOverride(spec, '/f/fake.mjs', '/node'), { cmd: '/node', argv: ['/f/fake.mjs', '-p', '--model', 'x'], input: BIG });
  assert.equal(withRuntimeOverride(spec, '/bin/fake', '/node').input, BIG);
});

// ------------------------------------------------------------------------------------------------ the spawners' stdin
const ECHO = ['-e', "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify({len:s.length,tail:s.slice(-13)})))"];

test('runChild writes its input to the child\'s stdin and closes it; with none, stdin stays ignored', async (t) => {
  const dir = tmp(t, 'dps-runchild-');
  const run = (input) => runChild({ cmd: process.execPath, args: ECHO, cwd: dir, env: process.env,
    stdoutPath: path.join(dir, 'out.json'), stderrPath: path.join(dir, 'err.log'), timeoutMs: 30_000, outputCapBytes: 1 << 20, input });
  const res = await run(BIG);
  assert.equal(res.exitCode, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8')), { len: BIG.length, tail: 'END-OF-PROMPT' });
  const none = await run(undefined);
  assert.equal(none.exitCode, 0, 'a child given no input waited on stdin');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8')), { len: 0, tail: '' });
});

test('shAsync writes its input to the child\'s stdin; with none, stdin stays ignored', async () => {
  const r = await shAsync(process.execPath, ECHO, { input: BIG });
  assert.deepEqual(JSON.parse(r.stdout), { len: BIG.length, tail: 'END-OF-PROMPT' });
  const none = await shAsync(process.execPath, ECHO, {});
  assert.deepEqual(JSON.parse(none.stdout), { len: 0, tail: '' });
});

// THE PARENT NEVER WAITS ON THE CHILD'S READING (found 2026-11-09, the first full suite of this stage): the prompt went
// through a pipe, whose close on Windows waits until the child has read it, so a child left running after a refused kill,
// one that never read its stdin, held spawn-node open and the suite hung on regression-stop-on-exit. Stdin now comes from
// a file (io/stdin-file.mjs). Held here by driving it, and by a census that no script writes a child's stdin pipe.
test('a child that never reads its stdin, left running after a refused kill, does not hold the parent open', (t) => {
  // NOT tmp(): its removal is an after-hook registered first, and the survivor holds its output files open on Windows,
  // so the removal failed with EPERM (the stage-5 suite, 2026-11-09). The survivor is ended first, then the folder goes.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dps-noread-')));
  const script = path.join(dir, 'parent.mjs');
  fs.writeFileSync(script, [
    `import path from 'node:path';`,
    `import { runChild } from ${JSON.stringify(new URL('../scripts/io/run-child.mjs', import.meta.url).href)};`,
    `import { hostPlatform } from ${JSON.stringify(new URL('../scripts/platform/index.mjs', import.meta.url).href)};`,
    `const d = ${JSON.stringify(dir)};`,
    `const proc = { ...hostPlatform().proc, killTree: async () => false, killTreeNow: () => false };`,
    `const res = await runChild({ cmd: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: d, env: process.env,`,
    `  stdoutPath: path.join(d, 'o'), stderrPath: path.join(d, 'e'), timeoutMs: 300, outputCapBytes: 1 << 20,`,
    `  spawnOptions: hostPlatform().proc.killableSpawnOptions(), deathGraceMs: 200, proc, input: 'x'.repeat(100000) });`,
    `console.log(JSON.stringify({ killRefused: res.killRefused, orphanPid: res.orphanPid }));`,
  ].join('\n'));
  const started = Date.now();
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 30_000 });
  const took = Date.now() - started;
  let orphan = null;
  try { orphan = JSON.parse(r.stdout.trim().split('\n').at(-1)).orphanPid; } catch { /* asserted below */ }
  t.after(() => {
    if (Number.isInteger(orphan)) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(orphan), '/T', '/F'], { stdio: 'ignore' });
      else { try { process.kill(orphan, 'SIGKILL'); } catch { /* gone */ } }
    }
    // A survivor that has only just been ended may still hold its files for a moment on Windows.
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  assert.equal(r.error?.code, undefined, `the parent did not exit within 30 s (${took} ms): held open by the child's stdin`);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Number.isInteger(orphan), `the kill was not refused, so this held nothing: ${r.stdout}`);
  assert.ok(took < 15_000, `the parent took ${took} ms to exit`);
});

test('census: no script writes a child\'s stdin through a pipe; every stdin text goes through io/stdin-file.mjs', () => {
  const hits = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(r); continue; }
      if (!/\.(mjs|js)$/.test(e.name)) continue;
      fs.readFileSync(path.join(REPO_ROOT, r), 'utf8').split(/\r?\n/).forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l)) return;
        if (/\.stdin\??\.(end|write)\(|stdio:\s*\[\s*'pipe'/.test(l)) hits.push(`${r}:${i + 1}: ${l.trim()}`);
      });
    }
  };
  walk('scripts');
  assert.deepEqual(hits, [], 'a child\'s stdin is a pipe this process writes, whose close waits on the child');
  for (const f of ['scripts/io/run-child.mjs', 'scripts/io/spawn-capture.mjs', 'scripts/io/pool.mjs']) {
    assert.match(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'), /stdinFrom\(input\)/, `${f} does not take its stdin text through stdinFrom`);
  }
});

// G-15 of 20261109-232630-dps-delivery (and G-16, G-18, the documents it made false): spawnSync's `input` option is a pipe
// the parent writes, and the canary, both intent probes and check-intent-grant's probe handed it the runtime's prompt.
// Every spawn of the node runtime is in SITES below; none of them may give spawnSync an `input`.
test('census: no spawn of the node runtime hands spawnSync an input, which is a pipe', () => {
  const hits = [];
  for (const file of ['scripts/new-run.mjs', 'scripts/check-intent-grant.mjs', 'scripts/spawn-subagent.mjs', 'scripts/spawn-node.mjs', 'scripts/io/forge-spawn.mjs']) {
    const code = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    for (const m of code.matchAll(/\bspawnSync\(([^;]*?)\)\s*;/g)) if (/\binput\b\s*[:,}]/.test(m[1])) hits.push(`${file}: ${m[0].replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  assert.deepEqual(hits, [], 'a runtime spawn takes its prompt through a pipe');
});

test('spawnSyncFrom: the child reads its stdin text from a file, and the folder is removed after', () => {
  const r = spawnSyncFrom(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(0, "utf8").toUpperCase())'],
    { input: BIG, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, BIG.toUpperCase());
});

// ------------------------------------------------------------------------------------------------ every spawner, driven
test('spawn-subagent: a 40 KB prompt reaches the runtime whole on stdin, none of it in argv', (t) => {
  const fake = fakeRuntime(t);
  const dir = tmp(t, 'dps-ss-');
  fs.writeFileSync(path.join(dir, 'p.md'), BIG);
  const env = { ...process.env, ...fake.env };
  delete env.GRAPH_NODE_DEPTH;
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'spawn-subagent.mjs'), '--prompt-file', path.join(dir, 'p.md'),
    '--out', path.join(dir, 'e.json'), '--repo-root', REPO_ROOT, '--runtime-bin', fake.bin], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const calls = fake.calls();
  assert.equal(calls.length, 1);
  assertStdinCall(calls[0], BIG, 'spawn-subagent');
});

test('spawn-node: a 40 KB prompt reaches the runtime whole on stdin, none of it in argv', (t) => {
  const fake = fakeRuntime(t);
  const { base, dir } = repoRunDir({ runId: '20260101-000000-dps-stdin' });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'node-settings.json'), JSON.stringify({ permissions: { defaultMode: 'manual', allow: [], deny: [] } }));
  // The instructions inlined into the node's prompt carry the 40 KB: spawn-node's own --prompt rides in its argv.
  const instructions = path.join(base, 'big-instructions.md');
  fs.writeFileSync(instructions, BIG);
  const r = runScript('spawn-node.mjs', ['--run-dir', dir, '--repo-root', REPO_ROOT, '--node-id', 'code-audit', '--mode', 'lens',
    '--skill-command', '/code-audit', '--inline-skill', '--instructions', instructions, '--allowed-basis', 'convention',
    '--timeout-minutes', '1', '--runtime-bin', fake.bin], { env: fake.env });
  const calls = fake.calls();
  assert.equal(calls.length, 1, `spawn-node did not reach the fake:\n${String(r.output ?? r.stderr).slice(-800)}`);
  assertStdinCall(calls[0], null, 'spawn-node');
  assert.ok(calls[0].stdin.includes(BIG), 'the inlined 40 KB did not arrive whole on stdin');
});

test('the bench forge\'s spawn: a 40 KB prompt reaches the runtime whole on stdin, none of it in argv', async (t) => {
  const fake = fakeRuntime(t);
  const dir = tmp(t, 'dps-forge-');
  const r = await spawnForge({ runtime: builtinReviewers().claude, prompt: BIG, model: 'opus', effort: 'low', cwd: dir,
    env: { ...process.env, ...fake.env }, runtimeBin: fake.bin });
  assert.equal(r.status, 0, r.out);
  const calls = fake.calls();
  assert.equal(calls.length, 1);
  assertStdinCall(calls[0], BIG, 'the bench forge');
  for (const tool of ['Edit', 'Write']) assert.ok(calls[0].argv.includes(tool), `the forge is not denied ${tool}`);
});

// A consuming repository with an approved request, so the intent probes run (as regression-cgg-r3-remediation builds it).
function consumer(t) {
  const repo = tmp(t, 'dps-repo-');
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), body); };
  put('src/app.js', 'export const app = 1;\n');
  put('docs/guide.md', 'Guide first — a line long enough that nothing guesses it without reading this very file\n');
  put('.claude/requests/ask.md', ['---', 'request: ask', 'status: approved', '---', '', '# The ask', '', '## Acceptance criteria', '1. It works.', ''].join('\n'));
  const yaml = ['graph_contract_version: 5', 'project: dps-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: ["docs/*.md"]', 'ui:', '  surface: none', 'review:', '  external_panel: false',
    '  models: { judgment: opus, mechanical: sonnet }'].join('\n');
  put('CLAUDE.md', `# fixture\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  return repo;
}

test('new-run: the canary and both intent probes hand the runtime their prompts on stdin, none in argv', (t) => {
  const fake = fakeRuntime(t);
  const repo = consumer(t);
  const r = runScript('new-run.mjs', ['--slug', `dps${Math.floor(Math.random() * 1e6)}`, '--repo-root', repo, '--full-sweep', 'src',
    '--no-request', '--runtime-bin', fake.bin], { cwd: repo, env: fake.env });
  try { const d = mintedRunDir(r.output); if (d) t.after(() => fs.rmSync(d, { recursive: true, force: true })); } catch { /* refused mints leave no run */ }
  const calls = fake.calls().filter((c) => c.argv.includes('-p'));
  const canary = calls.filter((c) => !c.argv.some((a) => /intent-settings\.json$/.test(a)));
  const intent = calls.filter((c) => c.argv.some((a) => /intent-settings\.json$/.test(a)));
  assert.ok(canary.length >= 1, `the canary never reached the fake:\n${String(r.output).slice(-600)}`);
  assert.equal(intent.length, 2, `the two intent probes did not both reach the fake:\n${String(r.output).slice(-600)}`);
  for (const [i, c] of calls.entries()) assertStdinCall(c, null, `new-run call ${i + 1}`);
  assert.ok(intent.every((c) => /Read the file/.test(c.stdin)), 'an intent probe\'s prompt is not on its stdin');
});

test('check-intent-grant: the probe hands the runtime its prompt on stdin, none in argv', (t) => {
  const fake = fakeRuntime(t);
  runScript('check-intent-grant.mjs', ['--runtime-bin', fake.bin], { env: { QUORATE_LIVE: '1', ...fake.env } });
  // new-run's version probe now reaches the fake too (G-6 of 20261111-224124-runtime-bin-d1-review), and sends no prompt.
  const calls = fake.calls().filter((c) => c.argv[0] !== '--version');
  assert.ok(calls.length >= 1, 'the probe never reached the fake runtime');
  for (const [i, c] of calls.entries()) assertStdinCall(c, null, `check-intent-grant call ${i + 1}`);
  assert.ok(calls.every((c) => /Use the Read tool/.test(c.stdin)));
});

// ------------------------------------------------------------------------------------------------ the spawn census
// Every spawn of the node runtime: a script calling nodeArgv, or building an argv from node_runtime's prompt flag without
// it. For each, the prompt nodeArgv returns must reach the spawn's `input`. Lexical, so each site is named with the line
// that carries it; a new caller fails the first assertion until it is added here.
const SITES = {
  'scripts/spawn-subagent.mjs': [/const \{ argv, input \} = nodeArgv\(/, /maxBytes: 64 \* 1024 \* 1024, input \}\);/],
  'scripts/spawn-node.mjs': [/const rendered = nodeArgv\(/, /input: rendered\.input,/],
  'scripts/check-intent-grant.mjs': [/const \{ cmd, argv, input \} = withRuntimeOverride\(nodeArgv\(/, /spawnSyncFrom\(cmd, argv, \{ cwd: sandbox, input,/],
  'scripts/new-run.mjs': [/const launched = launch\(rendered\);/, /input: launched\.input,/, /let attempt = runCanaryProbe\(canaryCmd\);/,
    /attempt = runCanaryProbe\(nodeArgv\(NODE_RUNTIME, \{/, /const intentLaunch = launch\(intentCmd\);/, /input: intentLaunch\.input,/,
    /const intentDenyLaunch = launch\(intentDenyCmd\);/, /input: intentDenyLaunch\.input,/],
  'scripts/io/forge-spawn.mjs': [/withRuntimeOverride\(nodeArgv\(runtime,/, /return shAsync\(cmd, argv, \{ cwd, env, input \}\);/],
};
test('census: every spawn of the node runtime is known, and each hands nodeArgv\'s input to its spawn', () => {
  const found = new Set();
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(r); continue; }
      // lib/decisions.mjs defines nodeArgv; lib/reviewers.mjs's validator reads whether the flag is declared, spawning nothing.
      if (!/\.(mjs|js)$/.test(e.name) || r === 'scripts/lib/decisions.mjs' || r === 'scripts/lib/reviewers.mjs') continue;
      const code = fs.readFileSync(path.join(REPO_ROOT, r), 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      if (/\bnodeArgv\(/.test(code) || /node_runtime[^\n]*prompt\??\.flag|\bnr\.prompt\??\.flag/.test(code)) found.add(r);
    }
  };
  walk('scripts');
  assert.deepEqual([...found].sort(), Object.keys(SITES).sort(), 'a spawn of the node runtime is not in this census');
  for (const [file, patterns] of Object.entries(SITES)) {
    const src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    for (const p of patterns) assert.ok(p.test(src), `${file}: ${p} — the prompt nodeArgv returns does not reach this spawn's input`);
  }
  // The forge's caller goes through it, never shAsync with an argv of its own.
  const bench = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-second-opinion.mjs'), 'utf8');
  assert.match(bench, /await spawnForge\(\{ runtime: FORGE_RUNTIME,/);
  assert.doesNotMatch(bench, /shAsync\(FORGE_RUNTIME\.cmd/);
});
