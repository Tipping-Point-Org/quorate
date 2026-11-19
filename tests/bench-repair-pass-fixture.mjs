// bench-repair-pass-fixture.mjs — the fixture and helpers regression-bench-repair-pass.test.mjs and its siblings share,
// moved out unchanged when the file was split (split-slow-test-files.md). Every top-level name is exported.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runScript, mintedRunDir } from './helpers.mjs';
import { repairBenchSummary } from '../scripts/lib/repair-bench.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

// One fake runtime for every spawn: the run directory is the --add-dir argument named for QUORATE_RUN_ID, the repository
// its cwd. A first pass fixes src/a.js with a test; a repair pass makes the suite pass.
async function fakeNode() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (process.argv.includes('--version')) { process.stdout.write('0.0.0 (fake)'); return; }
  const runDir = process.argv.find((a) => path.basename(a) === process.env.QUORATE_RUN_ID);
  const repo = process.cwd();
  const id = String(process.env.QUORATE_NODE_ID ?? '');
  fs.appendFileSync(process.env.FAKE_LOG, `${id}\n`);
  const ev = path.join(runDir, 'evidence', 'remediation');
  fs.mkdirSync(ev, { recursive: true });
  const capture = (file, exit, at) => [`$ node --test ${file}`, `# admitted: test_one ${file}`, `# cwd: ${repo}`, `# exit: ${exit}`,
    '# timeout: 15 minute(s)', `# captured: ${at}`, '-'.repeat(72), ''].join('\n');
  const emit = (payload, cost) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1,
    total_cost_usd: cost, usage: { input_tokens: 10, output_tokens: 5 }, result: JSON.stringify(payload) }));
  if (id.startsWith('remediation-repair-')) {
    const pass = Number(id.slice('remediation-repair-'.length));
    fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'fixed\nrepaired\n');
    // A file the candidate does not hold, edited by the repair: its diff is against the head, not an empty file.
    fs.appendFileSync(path.join(repo, 'scripts', 'tool.mjs'), '// repaired\n');
    // With FAKE_BINARY set, the repair also writes a binary file, whose numstat is "-" (G-7).
    if (process.env.FAKE_BINARY) fs.writeFileSync(path.join(repo, 'src', 'b.bin'), Buffer.from([0, 1, 2, 0, 255, 0]));
    fs.writeFileSync(path.join(ev, `repair${pass}-a.txt`), capture('tests/a.test.js', 0, '2026-11-01T10:20:00.000Z'));
    emit({ schema_version: 1, run_id: path.basename(runDir), pass, summary: 'repaired', failures: [{ test_name: 'the ratchet holds',
      test_file: 'tests/a.test.js', disposition: 'fixed', reason: 'routed through the owner', cluster: 'c1',
      files: ['src/a.js', 'scripts/tool.mjs', ...(process.env.FAKE_BINARY ? ['src/b.bin'] : [])],
      green_evidence: `evidence/remediation/repair${pass}-a.txt` }] }, 0.25);
    return;
  }
  fs.writeFileSync(path.join(ev, 'red.txt'), capture('tests/a.test.js', 1, '2026-11-01T10:00:00.000Z'));
  fs.writeFileSync(path.join(ev, 'green.txt'), capture('tests/a.test.js', 0, '2026-11-01T10:05:00.000Z'));
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'fixed\n');
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 'red then green\n');
  emit({ schema_version: 1, run_id: path.basename(runDir), summary: 'fixed', groups: [{ group_id: 'G-1',
    disposition: 'fixed', reason: 'the guard was missing', red_evidence: 'evidence/remediation/red.txt',
    green_evidence: 'evidence/remediation/green.txt', cluster: 'c1', files: ['src/a.js', 'tests/a.test.js'],
    search_command: 'git grep -n guard', deferred: [] }] }, 0.01);
}

// The suite: fails "the ratchet holds" until src/a.js holds "repaired"; with <base>/always-green present, always passes.
const SUITE = [
  "import fs from 'node:fs';",
  // <always-green>.count counts the checks; with <always-green>.break-at holding N, the Nth check fails naming no test.
  "const c = process.argv[2] + '.count'; const n = (fs.existsSync(c) ? Number(fs.readFileSync(c, 'utf8')) : 0) + 1; fs.writeFileSync(c, String(n));",
  "if (fs.existsSync(process.argv[2] + '.break-at') && Number(fs.readFileSync(process.argv[2] + '.break-at', 'utf8')) === n) { process.stdout.write('suite stopped\\n'); process.exit(1); }",
  "const ok = fs.readFileSync('src/a.js', 'utf8').includes('repaired') || fs.existsSync(process.argv[2]);",
  "process.stdout.write(ok ? 'ℹ pass 1\\nℹ fail 0\\n' : 'ℹ pass 0\\nℹ fail 1\\n\\n✖ failing tests:\\n\\ntest at tests\\\\a.test.js:1:1\\n✖ the ratchet holds (1.2ms)\\n  AssertionError: a raw read\\n');",
  'process.exit(ok ? 0 : 1);', '',
].join('\n');

// A refused remediation, made by the real runner at a cap of 0, its candidate's blobs kept in git and its edits then
// discarded, as the operator does when abandoning one.
function refusedCase(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-rbench-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const fwd = (p) => p.split(path.sep).join('/');
  const repo = path.join(base, 'repo');
  for (const d of ['src', 'scripts', 'tests']) fs.mkdirSync(path.join(repo, d), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'tool.mjs'), 'export {};\n');
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 't\n');
  fs.writeFileSync(path.join(base, 'suite.mjs'), SUITE);
  const green = path.join(base, 'always-green');
  const yaml = ['graph_contract_version: 6', 'project: rbench-fixture', 'commands:', '  build: ""',
    `  test: "node ${fwd(path.join(base, 'suite.mjs'))} ${fwd(green)}"`, '  test_one: "node --test {file}"',
    'source_globs: ["src/**", "scripts/**"]', 'test_globs: ["tests/**"]', 'doc_paths: []', 'ui:', '  surface: none',
    '  static_bundle: ""', 'review:', '  external_panel: false'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/reviews/\n');
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 'x@x'); git(repo, 'config', 'user.name', 'x');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeNode.toString()})();`);
  const log = path.join(base, 'spawns.log');
  fs.writeFileSync(log, '');
  const env = { QUORATE_HOME: path.join(base, 'home'), FAKE_LOG: log, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' };
  const mint = (extra) => runScript('new-run.mjs', ['--repo-root', repo, '--no-request', '--no-verify-sandbox', '--runtime-bin', bin, ...extra], { cwd: repo, env });
  const reviewed = mintedRunDir(mint(['--slug', 'rev', '--full-sweep', 'src']).output);
  fs.writeFileSync(path.join(reviewed, 'reconciled.md'), '# Reconciled\n\n## Confirmed (1)\n');
  fs.writeFileSync(path.join(reviewed, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  fs.mkdirSync(path.join(reviewed, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(reviewed, 'evidence', 'reconcile', 'payload.json'),
    JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }] }));
  const rem = mintedRunDir(mint(['--slug', 'fix', '--remediates', reviewed]).output);
  const r = runScript('remediate.mjs', ['--run-dir', rem, '--runtime-bin', bin, '--no-verify-sandbox', '--test-repair-passes', '0'], { cwd: repo, env });
  assert.ok(JSON.parse(fs.readFileSync(path.join(rem, 'run.json'), 'utf8')).commit_check.some((c) => c.kind === 'full-run-red'), r.output);
  git(repo, 'hash-object', '-w', 'src/a.js', 'tests/a.test.js');
  git(repo, 'checkout', '--', '.');
  fs.writeFileSync(log, '');
  const results = path.join(base, 'RESULTS.md');
  const bench = () => runScript('bench-repair-pass.mjs', ['--repo-root', repo, '--case', path.basename(rem), '--runtime-bin', bin, '--results', results],
    { cwd: repo, env });
  const caseResult = () => {
    const root = path.join(base, 'home', 'bench-repair');
    const d = fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'result.json'))).sort().at(-1);
    return JSON.parse(fs.readFileSync(path.join(root, d, 'result.json'), 'utf8'));
  };
  return { base, repo, rem, reviewed, mint, bin, env, bench, caseResult, results, green, log, head: () => git(repo, 'rev-parse', 'HEAD').stdout.trim(),
    spawns: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}








// A recorded case for remediate.mjs --replay-node, built from the case's own run (f.rem): its cited captures, its report,
// the status spawn-node wrote and the candidate its full check recorded, for the run `runDir` in `repo`.
function replayOf(f, runDir, at = path.join(f.base, 'replay')) {
  fs.mkdirSync(path.join(at, 'evidence'), { recursive: true });
  for (const n of ['red.txt', 'green.txt']) fs.copyFileSync(path.join(f.rem, 'evidence', 'remediation', n), path.join(at, 'evidence', n));
  fs.copyFileSync(path.join(f.rem, 'evidence', 'remediation', 'payload.json'), path.join(at, 'payload.json'));
  fs.copyFileSync(path.join(f.rem, 'nodes', 'remediation.status.json'), path.join(at, 'status.json'));
  const run = JSON.parse(fs.readFileSync(path.join(f.rem, 'run.json'), 'utf8'));
  const check = run.full_checks.find((c) => (c.refusals ?? []).length);
  const candidate = JSON.parse(fs.readFileSync(path.join(f.rem, ...check.files_at.split(/[\\/]/)), 'utf8'));
  fs.writeFileSync(path.join(at, 'replay.json'), JSON.stringify({ run_dir: runDir, worktree: f.repo, candidate }));
  return at;
}

// A remediation run not yet run, of a fresh review confirming the case's group: the bench's scratch pair.
function freshRemediation(f, slug) {
  const rev = mintedRunDir(f.mint(['--slug', `${slug}-rev`, '--full-sweep', 'src']).output);
  for (const n of ['reconciled.md', 'gate.json']) fs.copyFileSync(path.join(f.reviewed, n), path.join(rev, n));
  fs.mkdirSync(path.join(rev, 'evidence', 'reconcile'), { recursive: true });
  fs.copyFileSync(path.join(f.reviewed, 'evidence', 'reconcile', 'payload.json'), path.join(rev, 'evidence', 'reconcile', 'payload.json'));
  return mintedRunDir(f.mint(['--slug', slug, '--remediates', rev]).output);
}















export { git, fakeNode, SUITE, refusedCase, replayOf, freshRemediation };
