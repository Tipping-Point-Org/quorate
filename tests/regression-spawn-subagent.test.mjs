// claim-check-cross-family.plan.md stage 0a (operator, 2026-10-18: "One spawn script for all three (Recommended)"). Item 1
// (skill-subagent-pins.md) told claim-check, plan-review and candidate-pool to pin their Claude subagent's model AND effort
// to the contract, and a session's subagent tool takes a model but no effort: the pin could not be met. Only
// `claude -p --effort` sets it. scripts/spawn-subagent.mjs runs that, at the contract's pins, with a lens's tool denials,
// the subscription environment spawn-node gives a node, and the whole envelope kept. Its first manual use failed 401: an
// ANTHROPIC_API_KEY in the operator's shell took precedence over the subscription.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, SCRIPTS_DIR } from './helpers.mjs';
import * as decisions from '../scripts/lib/decisions.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

// runtimeSessionEnv's names are the runtime adapter's (G-11 of 20261103-022403-rbr-remediation-8-review).
const RUNTIME = builtinReviewers().claude;

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('judgmentPins: the contract wins; an absent key falls back as the graph does, and says so', () => {
  const { judgmentPins } = decisions;
  assert.equal(typeof judgmentPins, 'function', 'lib/decisions.mjs has no judgmentPins');
  const roster = { default_models: { judgment: 'roster-model' } };
  assert.deepEqual(judgmentPins({ models: { judgment: 'm' }, effort: { judgment: 'e' } }, roster),
    { model: 'm', effort: 'e', substituted: [] });
  const fell = judgmentPins({}, roster);
  assert.equal(fell.model, 'roster-model');
  assert.equal(fell.effort, 'high');
  assert.equal(fell.substituted.length, 2, 'a defaulted pin is not distinguishable from a declared one');
  assert.throws(() => judgmentPins({}, {}), /model/, 'no model anywhere is invented rather than refused');
});

test('run-graph resolves its judgment pins through judgmentPins, the one owner of the fallback', () => {
  assert.match(read('scripts/run-graph.mjs'), /judgmentPins\(/);
});

test('runtimeSessionEnv: under subscription the API key and auth token are stripped, and the session markers always', () => {
  const { runtimeSessionEnv } = decisions;
  assert.equal(typeof runtimeSessionEnv, 'function', 'lib/decisions.mjs has no runtimeSessionEnv');
  const src = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_OAUTH_TOKEN: 'o', PATH: 'p' };
  const sub = runtimeSessionEnv(src, { authMode: 'subscription', runtime: RUNTIME });
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) {
    assert.equal(k in sub.env, false, `${k} crossed under subscription`);
  }
  assert.equal(sub.env.CLAUDE_CODE_OAUTH_TOKEN, 'o', 'the OAuth token IS subscription auth and must survive');
  assert.equal(sub.env.PATH, 'p');
  assert.deepEqual([...sub.stripped].sort(), ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']);
  const inherit = runtimeSessionEnv(src, { authMode: 'inherit', runtime: RUNTIME });
  assert.equal(inherit.env.ANTHROPIC_API_KEY, 'k', 'inherit keeps the operator\'s key');
  assert.equal('CLAUDECODE' in inherit.env, false);
});

// G-4 of 20261030-153323-ciss-s7-remediation-2-review: the names were deleted by exact case, and Windows reads environment
// names case-insensitively, so `Anthropic_Api_Key` in the operator's shell crossed into a subscription child.
test('runtimeSessionEnv: a credential or session marker in another case is stripped too', () => {
  const { runtimeSessionEnv } = decisions;
  const sub = runtimeSessionEnv({ Anthropic_Api_Key: 'k', anthropic_auth_token: 't', ClaudeCode: '1', PATH: 'p' }, { authMode: 'subscription', runtime: RUNTIME });
  for (const k of ['Anthropic_Api_Key', 'anthropic_auth_token', 'ClaudeCode']) assert.equal(k in sub.env, false, `${k} crossed under subscription`);
  assert.deepEqual([...sub.stripped].sort(), ['Anthropic_Api_Key', 'ClaudeCode', 'anthropic_auth_token']);
  assert.equal(runtimeSessionEnv({ Anthropic_Api_Key: 'k' }, { authMode: 'inherit', runtime: RUNTIME }).env.Anthropic_Api_Key, 'k', 'inherit keeps the key');
  // The subscription probe's environment stripped the same names by exact case.
  const probe = decisions.subscriptionProbeEnv({ Anthropic_Api_Key: 'k', anthropic_auth_token: 't', PATH: 'p' }, RUNTIME);
  for (const k of ['Anthropic_Api_Key', 'anthropic_auth_token']) assert.equal(k in probe.env, false, `${k} crossed into the probe`);
});

// A NODE'S `cd` MOVED ITS PROJECT ROOT (remediation 20261020-115946-ciss-remediation-4). Claude Code 2.1.304 keeps a Bash
// `cd` into an added directory as the session's working directory, and the node's write rules then resolved against the
// run directory: every later edit under the repository was refused, and nothing committed. Measured the same day:
// `cd <added dir>` then `pwd` printed the added directory without the variable, the original directory with it.
test('runtimeSessionEnv: every Claude child returns to its working directory after each Bash command', () => {
  const { runtimeSessionEnv } = decisions;
  for (const authMode of ['subscription', 'inherit']) {
    const { env } = runtimeSessionEnv({ PATH: 'p', CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '0' }, { authMode, runtime: RUNTIME });
    assert.equal(env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR, '1', `${authMode}: a cd can move the child's working directory`);
  }
  assert.match(read('scripts/spawn-node.mjs'), /Object\.assign\(childEnv, session\.env\)/,
    'spawn-node only deletes what runtimeSessionEnv drops, so a variable it sets never reaches the node');
});

test('spawn-node builds a node\'s environment through runtimeSessionEnv, so the two spawners cannot drift', () => {
  const src = read('scripts/spawn-node.mjs');
  assert.match(src, /runtimeSessionEnv\(/);
  assert.doesNotMatch(src, /for \(const k of \['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'\]\)/, 'the inline strip is still there');
});

function fakeClaude(dir) {
  const bin = path.join(dir, 'fake-claude.mjs');
  fs.writeFileSync(bin, [
    "let input = '';",
    "process.stdin.on('data', (d) => { input += d; }).on('end', () => {",
    "  const keys = Object.keys(process.env);",
    "  const report = { argv: process.argv.slice(2), env: keys, depth: process.env.GRAPH_NODE_DEPTH ?? null, stdin: input };",
    "  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(report) }));",
    "});",
  ].join('\n'));
  return bin;
}

function runSpawn(args, env = {}) {
  const base = { ...process.env };
  delete base.GRAPH_NODE_DEPTH;
  return spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'spawn-subagent.mjs'), ...args], {
    cwd: REPO_ROOT, encoding: 'utf8', env: { ...base, ...env },
  });
}

test('spawn-subagent runs claude -p at the contract\'s model and effort, with a lens\'s denials, and keeps the envelope', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-spawn-subagent-'));
  try {
    const prompt = path.join(dir, 'prompt.md');
    fs.writeFileSync(prompt, 'the brief');
    const out = path.join(dir, 'envelope.json');
    const r = runSpawn(['--prompt-file', prompt, '--out', out, '--repo-root', REPO_ROOT, '--runtime-bin', fakeClaude(dir)],
      // A short value no secret rule matches: the test is about the variable reaching the child, not its content.
      { ANTHROPIC_API_KEY: 'x', CLAUDECODE: '1' });
    assert.equal(r.status, 0, r.stderr);
    const envelope = JSON.parse(fs.readFileSync(out, 'utf8'));
    const seen = JSON.parse(envelope.result);
    const contract = JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'new-run.mjs'), '--print-contract'],
      { cwd: REPO_ROOT, encoding: 'utf8' }).stdout);
    const at = (flag) => seen.argv[seen.argv.indexOf(flag) + 1];
    assert.equal(at('--model'), contract.review.models.judgment);
    assert.equal(at('--effort'), contract.review.effort.judgment);
    assert.equal(at('--output-format'), 'json');
    for (const t of ['Edit', 'Write', 'NotebookEdit']) assert.ok(seen.argv.includes(t), `${t} is not denied`);
    assert.ok(!seen.argv.includes('bypassPermissions'), 'a subagent is never unsandboxed');
    // On stdin since decision-panel-seats.plan.md stage 2 (DP-D1 A): the argv carries the bare -p, the prompt follows on stdin.
    assert.equal(seen.stdin, 'the brief', 'the prompt does not reach the child');
    assert.equal(seen.argv[0], '-p');
    assert.ok(!seen.argv.includes('the brief'), 'the prompt is still in argv');
    assert.ok(!seen.env.includes('ANTHROPIC_API_KEY'), 'the operator\'s API key crossed and would take precedence');
    assert.ok(!seen.env.includes('CLAUDECODE'));
    assert.equal(seen.depth, '1', 'the child is not told it is nested');
    // G-15 of 20261019-014448-ccf-delivery: the lens set left the shell open, and a shell writes files.
    for (const t of ['Bash', 'PowerShell']) assert.ok(seen.argv.includes(t), `${t} is not denied`);
    assert.ok(!seen.argv.includes('Grep'), 'the read-only subagent lost its search tool');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// G-16 of 20261019-014448-ccf-delivery: a malformed node_timeout_minutes silently removed the bound, and the bound that did
// fire killed only the CLI, not its children.
test('spawn-subagent refuses a node_timeout_minutes that is not a positive number, and stops the tree when the bound fires', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-spawn-subagent-'));
  try {
    for (const bad of ['0', '-5', 'soon', '""']) {
      const repo = path.join(dir, `repo-${bad.replace(/\W/g, '_')}`);
      fs.mkdirSync(repo);
      fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: ss-fixture',
        'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:',
        '  models: { judgment: opus }', '  effort: { judgment: low }', `  node_timeout_minutes: ${bad}`, '```', ''].join('\n'));
      const prompt = path.join(dir, 'prompt.md');
      fs.writeFileSync(prompt, 'the brief');
      const r = runSpawn(['--prompt-file', prompt, '--out', path.join(dir, 'e.json'), '--repo-root', repo, '--runtime-bin', fakeClaude(dir)]);
      assert.equal(r.status, 2, `node_timeout_minutes: ${bad} was accepted: ${r.stderr}`);
      assert.match(r.stderr, /node_timeout_minutes/);
    }
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, 'spawn-subagent.mjs'), 'utf8');
    assert.match(src, /await spawnCapture\(/, 'the subagent is not run through spawnCapture, which stops the process tree');
    assert.doesNotMatch(src, /spawnSync\(/, 'spawnSync\'s timeout kills only the immediate child');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// G-4 of 20261019-211650-two-mediums-review: spawn-subagent ran a contract-overridden node runtime with the session's
// credentials and never said so, where every other path that runs an override prints its line (ARCHITECTURE.md A-26).
test('spawn-subagent names a contract override of the node runtime it launches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-spawn-subagent-'));
  try {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: ss-fixture',
      'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none',
      'reviewers:', '  claude:', '    cmd: "quorate-no-such-cli"', 'review:',
      '  models: { judgment: opus }', '  effort: { judgment: low }', '```', ''].join('\n'));
    const prompt = path.join(dir, 'prompt.md');
    fs.writeFileSync(prompt, 'the brief');
    const r = runSpawn(['--prompt-file', prompt, '--out', path.join(dir, 'e.json'), '--repo-root', repo, '--runtime-bin', fakeClaude(dir)]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /spawn-subagent: claude \(node runtime\) — cmd set by the contract/, 'the override is not named');
    const plain = runSpawn(['--prompt-file', prompt, '--out', path.join(dir, 'e2.json'), '--repo-root', REPO_ROOT, '--runtime-bin', fakeClaude(dir)]);
    assert.equal(plain.status, 0, plain.stderr);
    assert.doesNotMatch(plain.stderr, /set by the contract/, 'an override is named where the contract declares none');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('spawn-subagent --result writes the JSON object of the final answer, since the subagent itself cannot write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-spawn-subagent-'));
  try {
    const bin = path.join(dir, 'answer.mjs');
    fs.writeFileSync(bin, "process.stdout.write(JSON.stringify({ type: 'result', is_error: false, "
      + "result: 'Here it is:\\n```json\\n{\"schema_version\": 1, \"verdict\": \"PASS\"}\\n```' }));");
    const prompt = path.join(dir, 'p.md');
    fs.writeFileSync(prompt, 'x');
    const result = path.join(dir, 'result.json');
    const r = runSpawn(['--prompt-file', prompt, '--out', path.join(dir, 'e.json'), '--result', result,
      '--repo-root', REPO_ROOT, '--runtime-bin', bin]);
    assert.equal(r.status, 0, r.stderr);
    const written = JSON.parse(fs.readFileSync(result, 'utf8'));
    // The answer, plus the spawner's own stamp (two-ledger-mediums AC2, pinned in regression-spawned-with).
    const { spawned_with: stampWritten, ...answer } = written;
    assert.deepEqual(answer, { schema_version: 1, verdict: 'PASS' });
    assert.ok(stampWritten && typeof stampWritten === 'object', 'no spawned_with stamp');
    fs.writeFileSync(bin, "process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'no json here' }));");
    const bad = runSpawn(['--prompt-file', prompt, '--out', path.join(dir, 'e2.json'), '--result', path.join(dir, 'r2.json'),
      '--repo-root', REPO_ROOT, '--runtime-bin', bin]);
    assert.equal(bad.status, 1, 'an answer with no JSON object was accepted');
    assert.equal(fs.existsSync(path.join(dir, 'r2.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AN OPERATOR'S ONE-OFF EFFORT (operator, 2026-10-20: "One more review at higher effort"): the contract's pin is the
// default and stays so; --effort overrides it for one spawn, said on stderr and stamped, so a verdict never reads as
// having run at the contract's setting when it did not.
test('spawn-subagent --effort overrides the contract\'s effort for one spawn, and says so in the stamp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-spawn-subagent-'));
  try {
    const bin = path.join(dir, 'answer.mjs');
    fs.writeFileSync(bin, "process.stdout.write(JSON.stringify({ type: 'result', is_error: false, "
      + "result: JSON.stringify({ argv: process.argv.slice(2) }) }));");
    const prompt = path.join(dir, 'p.md');
    fs.writeFileSync(prompt, 'x');
    const result = path.join(dir, 'result.json');
    const r = runSpawn(['--prompt-file', prompt, '--out', path.join(dir, 'e.json'), '--result', result, '--effort', 'high',
      '--repo-root', REPO_ROOT, '--runtime-bin', bin]);
    assert.equal(r.status, 0, r.stderr);
    const written = JSON.parse(fs.readFileSync(result, 'utf8'));
    assert.equal(written.argv[written.argv.indexOf('--effort') + 1], 'high', 'the override did not reach the CLI');
    assert.equal(written.spawned_with.effort, 'high');
    assert.equal(written.spawned_with.effort_from, '--effort', 'the stamp does not say the effort was overridden');
    assert.match(r.stderr, /--effort/, 'the override is not said');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A CLI THAT FAILS BEFORE ITS ENVELOPE SAID NOTHING (found 2026-10-20, plan-review round 1 of code-index): claude -p
// exited 1 with empty stdout, and spawn-subagent reported only "printed no JSON envelope". Its stderr, the one place the
// reason was, was captured and discarded.
test('spawn-subagent names the subagent\'s stderr when it prints no envelope', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-spawn-subagent-'));
  try {
    const bin = path.join(dir, 'fails.mjs');
    fs.writeFileSync(bin, "process.stderr.write('the real reason it failed'); process.exit(1);");
    const prompt = path.join(dir, 'p.md');
    fs.writeFileSync(prompt, 'x');
    const r = runSpawn(['--prompt-file', prompt, '--out', path.join(dir, 'e.json'), '--repo-root', REPO_ROOT, '--runtime-bin', bin]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /the real reason it failed/, 'the subagent\'s stderr was discarded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('spawn-subagent refuses at depth, and on an unreadable depth', () => {
  for (const depth of ['1', '']) {
    const r = runSpawn(['--prompt-file', 'x', '--out', 'y'], { GRAPH_NODE_DEPTH: depth });
    assert.equal(r.status, 3, `GRAPH_NODE_DEPTH=${JSON.stringify(depth)} was not refused`);
  }
});

test('the three skills spawn their Claude subagent through spawn-subagent.mjs', () => {
  for (const name of ['claim-check', 'plan-review', 'candidate-pool']) {
    assert.match(read(`skills/${name}/SKILL.md`), /scripts\/spawn-subagent\.mjs/, `${name} does not name the spawn script`);
  }
});
