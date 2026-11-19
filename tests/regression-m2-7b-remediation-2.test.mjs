// Run 20261114-032609-m2-7b-remediation-review (operator: "Close and fix everything live").
//
// G-1: appendOwnFile wrote once and ignored writeSync's count, so a short write truncated a record silently.
// G-2, G-3: validateManifest let ' code-audit ' pass beside 'code-audit', and never typed scope's entries.
// G-4: a remediation's captured command lost only the fixed Anthropic names; another runtime's auth crossed.
// G-7: a missing session id and the safe id `unknown` shared a folder; 128 upper-case letters made a 256-character name.
// G-11: a forced intent re-derivation that failed left the earlier intent.md and intent_sha256 as the run's criteria.
// G-13: shared/bench-corpus.md's seed table named none of validateManifest's refusals of lenses and scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript, mintedRunDir } from './helpers.mjs';

const tmp = (t, prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const put = (root, rel, body = `${rel}\n`) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

test('G-1: a short write is continued until every byte is written', async (t) => {
  const { appendOwnFile } = await import('../scripts/io/torn-tail.mjs');
  const file = path.join(tmp(t, 'q-m27b2-'), 'r.jsonl');
  const real = fs;
  // A file system whose writeSync writes one byte a call, as a full or slow volume may.
  const oneByte = {
    ...real,
    writeSync: (fd, data, offset, length) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
      const off = Number.isInteger(offset) ? offset : 0;
      return real.writeSync(fd, buf, off, Math.min(1, buf.length - off));
    },
  };
  appendOwnFile(file, '{"a":"héllo"}\n', oneByte);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":"héllo"}\n', 'the record was truncated');
});

test('G-1: a write that makes no progress throws rather than reporting the append done', async (t) => {
  const { appendOwnFile } = await import('../scripts/io/torn-tail.mjs');
  const file = path.join(tmp(t, 'q-m27b2-'), 'r.jsonl');
  assert.throws(() => appendOwnFile(file, 'x\n', { ...fs, writeSync: () => 0 }));
});

const manifest = ({ lenses = ['code-audit'], scope = ['scripts'] } = {}) => ({
  id: 's', title: 't', source: 'mutation', removes_tests: false, scope,
  defect: { file: 'scripts/lib/decisions.mjs', anchor: 'x', lenses },
});

test('G-2: a lens name with surrounding space is refused, so it cannot pass as a second lens', async () => {
  const { validateManifest } = await import('../scripts/lib/bench-scoring.mjs');
  assert.deepEqual(validateManifest(manifest()), []);
  assert.ok(validateManifest(manifest({ lenses: ['code-audit', ' code-audit '] })).some((e) => /lenses/.test(e)));
  assert.ok(validateManifest(manifest({ lenses: ['code-audit '] })).some((e) => /lenses/.test(e)));
});

test('G-3: a scope entry that is not a nonempty path string is refused', async () => {
  const { validateManifest } = await import('../scripts/lib/bench-scoring.mjs');
  for (const bad of [[7], ['scripts', null], ['  '], [{}]]) {
    assert.ok(validateManifest(manifest({ scope: bad })).some((e) => /scope/.test(e)), JSON.stringify(bad));
  }
});

test('G-13: the seed table names what validateManifest refuses in lenses and scope', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'bench-corpus.md'), 'utf8');
  const row = (key) => doc.split('\n').find((l) => l.startsWith(`| \`${key}\` |`)) ?? '';
  assert.match(row('defect.lenses'), /distinct/);
  assert.match(row('defect.lenses'), /surrounding space/);
  assert.match(row('scope'), /strings/);
});

test('G-4: a remediation command loses the auth the run\'s runtime keeps, whatever its name; a review\'s keeps it', async () => {
  const { commandEnvFor } = await import('../scripts/lib/decisions.mjs');
  const runtime = { node_runtime: { session_env: { keep_auth: ['OPENAI_API_KEY', 'Other_Login_Token'] } } };
  const env = { PATH: 'p', openai_api_key: 'o', OTHER_LOGIN_TOKEN: 't', ANTHROPIC_API_KEY: 'k', MY_APP_KEY: 'm', QUORATE_RUN_ID: 'r' };
  const rem = commandEnvFor(env, { remediation: true, runtime });
  for (const k of ['openai_api_key', 'OTHER_LOGIN_TOKEN', 'ANTHROPIC_API_KEY', 'QUORATE_RUN_ID']) assert.ok(!(k in rem), k);
  assert.equal(rem.MY_APP_KEY, 'm', 'the project\'s own variables are its business');
  const lens = commandEnvFor(env, { remediation: false, runtime });
  assert.equal(lens.openai_api_key, 'o', 'a review\'s command keeps its environment');
  // Refused alike with scrubChildEnv: a runtime given must be its adapter.
  assert.throws(() => commandEnvFor(env, { remediation: true, runtime: 'codex' }), /adapter/);
});

test('G-4: capture.mjs scrubs a remediation command by the run\'s runtime adapter', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'capture.mjs'), 'utf8');
  assert.match(src, /commandEnvFor\(process\.env, \{[^}]*runtime/);
});

test('G-7: a missing session id and the safe id `unknown` keep separate folders', async () => {
  const lib = await import('../scripts/lib/session-record.mjs');
  assert.equal(lib.sessionFolder('unknown'), 'unknown');
  for (const missing of ['', null, undefined]) assert.notEqual(lib.sessionFolder(missing), 'unknown', String(missing));
});

test('G-7: no accepted id yields a folder name over 128 characters', async () => {
  const lib = await import('../scripts/lib/session-record.mjs');
  for (const id of ['A'.repeat(128), 'A'.repeat(65), `${'a'.repeat(100)}${'B'.repeat(28)}`]) {
    const f = lib.sessionFolder(id);
    assert.ok(f.length <= 128, `${id.length} chars gave ${f.length}`);
  }
  assert.notEqual(lib.sessionFolder('A'.repeat(128)), lib.sessionFolder('A'.repeat(127)));
  assert.equal(lib.sessionFolder('A'.repeat(64)), '^a'.repeat(64), 'a name that fits is unchanged');
});

// A runtime that answers every call as a failure, and never spends: a blank login cannot reach a vendor.
function failingRuntime(t) {
  const dir = tmp(t, 'q-m27b2-fake-');
  const bin = path.join(dir, 'fake-runtime.mjs');
  fs.writeFileSync(bin, [
    "try { (await import('node:fs')).default.readFileSync(0, 'utf8'); } catch {}",
    "process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'failed', permission_denials: [], total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }));",
    'process.exit(1);',
  ].join('\n'));
  const noLogin = path.join(dir, 'no-login');
  fs.mkdirSync(noLogin);
  return { bin, env: { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' } };
}

test('G-11: a failed --fresh-intent leaves no earlier intent.md or intent_sha256 as the run\'s criteria', (t) => {
  const repo = tmp(t, 'q-m27b2-repo-');
  put(repo, 'src/app.js', 'export const app = 1;\n');
  put(repo, 'docs/guide.md', 'declared\n');
  put(repo, '.claude/requests/ask.md', ['---', 'request: ask', 'status: approved', '---', '', '# The ask', '', '## Acceptance criteria', '1. It works.', ''].join('\n'));
  const yaml = ['graph_contract_version: 5', 'project: m27b2-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: ["docs/*.md"]', 'ui:', '  surface: none', 'review:', '  external_panel: false',
    '  models: { judgment: opus, mechanical: sonnet }'].join('\n');
  put(repo, 'CLAUDE.md', `# fixture\n\nThe contract of this fixture, a line long enough to be read rather than guessed.\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  const r = runScript('new-run.mjs', ['--slug', `m27b2${Math.floor(Math.random() * 1e6)}`, '--repo-root', repo, '--full-sweep', 'src', '--no-verify-sandbox'], { cwd: repo });
  assert.equal(r.status, 0, r.output.slice(-400));
  const dir = mintedRunDir(r.output);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  put(dir, 'intent.md', '# Intent\n\n- STALE-1: a criterion from an earlier derivation\n');
  const rjPath = path.join(dir, 'run.json');
  const rj = JSON.parse(fs.readFileSync(rjPath, 'utf8'));
  rj.intent_sha256 = 'f'.repeat(64);
  fs.writeFileSync(rjPath, JSON.stringify(rj, null, 2));
  const fake = failingRuntime(t);
  runScript('run-graph.mjs', ['--run-dir', dir, '--repo-root', repo, '--only', 'contract-audit', '--skip-panel', '--no-archive', '--fresh-intent', '--runtime-bin', fake.bin],
    { cwd: repo, env: fake.env, mayFanOut: true });
  const md = fs.existsSync(path.join(dir, 'intent.md')) ? fs.readFileSync(path.join(dir, 'intent.md'), 'utf8') : '';
  assert.ok(!md.includes('STALE-1'), 'the earlier intent.md stayed as the run\'s criteria');
  assert.notEqual(JSON.parse(fs.readFileSync(rjPath, 'utf8')).intent_sha256, 'f'.repeat(64), 'the earlier intent_sha256 stayed');
});
