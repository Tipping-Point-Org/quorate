// decision-panel-seats.plan.md stage 6, found live (2026-11-11): the stage's real decision exited 1 with "decide: git
// ls-files -z failed (exit null); the panel is not asked without its work context". decide.mjs's gitOut read every git
// list with spawnSync's default maxBuffer, 1 MiB, and this repository's `git ls-files -z` is 2,485,356 bytes (31,630
// tracked files), so the read died with ENOBUFS and status null; and gitOut's message dropped r.error, so the cause read
// as "exit null". Now every list gitOut reads is bounded as this engine's other git listings are (1 GiB, the convention
// of io/worktree.mjs, io/preflight-cache.mjs, check-install, find-inert-features, new-run), a failure names the error's
// code, and a census holds every git call in decide.mjs that reads git's output to that bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const Q = { question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable' };
const MIB = 1024 * 1024;

function fakeRuntime(dir) {
  const bin = path.join(dir, 'fake-runtime.mjs');
  const seat = { status: 'ok', choice: 'E1', rationale: 'the size bounds the disk', other_text: '', change_of: '', what_would_change: 'a measured cost', citations: [] };
  fs.writeFileSync(bin, [
    "import fs from 'node:fs';",
    "try { fs.readFileSync(0, 'utf8'); } catch {}",
    `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, result: ${JSON.stringify(JSON.stringify(seat))} }));`,
  ].join('\n'));
  return bin;
}
function failingReviewer(dir, name) {
  const bin = path.join(dir, `fake-${name}.mjs`);
  fs.writeFileSync(bin, [
    "import fs from 'node:fs';",
    "if (process.argv.includes('--version')) { process.stdout.write('fake 1.0\\n'); process.exit(0); }",
    'try { fs.readFileSync(0); } catch {}',
    `process.stderr.write('${name} fake: the service is down for maintenance\\n');`,
    'process.exit(1);',
  ].join('\n'));
  return bin;
}

/**
 * A repository whose `git ls-files -z` is over `bytes`: index entries for one blob under long generated names, committed
 * and marked skip-worktree, so no file is written to disk and nothing reads as changed.
 */
function bigIndexRepo(t, bytes) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'decide-buffer-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (args, opts = {}) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  git(['init', '-q', '.']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 'T']);
  const fwd = (p) => p.split(path.sep).join('/');
  const node = fwd(process.execPath);
  const codex = fwd(failingReviewer(dir, 'codex'));
  const agy = fwd(failingReviewer(dir, 'agy'));
  const limits = ['    probe_timeout_minutes: 0.5', '    version_timeout_seconds: 10', '    check_margin_seconds: 2'];
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 5', 'project: t', 'commands:',
    '  build: ""', '  test: ""', 'review:', '  external_panel: true', '  decision_panel: on', '  grounding_floor: convention',
    '  models: { judgment: opus, mechanical: sonnet }', '  effort: { judgment: low }', 'reviewers:',
    '  codex:', ...limits, `    cmd: "${node}"`, '    needs_shell_on_windows: false', `    version_argv: ["${codex}", "--version"]`, `    base_argv: ["${codex}", "exec"]`,
    '  agy:', ...limits, `    cmd: "${node}"`, `    version_argv: ["${agy}", "--version"]`, `    base_argv: ["${agy}"]`,
    '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/decisions/\n');
  git(['add', '-A']);
  const blob = git(['hash-object', '-w', '--stdin'], { input: 'x\n' }).trim();
  const lines = [];
  let total = 0;
  for (let i = 0; total <= bytes; i++) {
    const name = `generated/d${String(i % 50).padStart(2, '0')}/${'n'.repeat(180)}-${i}.txt`;
    lines.push(`100644 ${blob}\t${name}\n`);
    total += name.length + 1;
  }
  git(['update-index', '--index-info'], { input: lines.join('') });
  git(['commit', '-qm', 'init']);
  const listed = git(['ls-files', '-z']);
  git(['update-index', '-z', '--skip-worktree', '--stdin'], { input: listed.split('\0').filter((n) => n.startsWith('generated/')).join('\0') + '\0' });
  const q = path.join(dir, 'question.json');
  fs.writeFileSync(q, JSON.stringify(Q));
  const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home'), QUORATE_REVIEWER_PROBES: path.join(dir, 'probes') };
  delete env.GRAPH_NODE_DEPTH;
  const decide = (args) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'decide.mjs'), '--repo-root', repo, ...args],
    { cwd: repo, encoding: 'utf8', env, timeout: 300_000 });
  return { repo, q, decide, runtime: fakeRuntime(dir), listedBytes: Buffer.byteLength(listed) };
}

test('a repository whose git ls-files is over 1 MiB still reaches the panel', (t) => {
  const f = bigIndexRepo(t, 1.2 * MIB);
  assert.ok(f.listedBytes > MIB, `the fixture's listing is only ${f.listedBytes} bytes`);
  const r = f.decide(['--question', f.q, '--runtime-bin', f.runtime]);
  assert.doesNotMatch(`${r.stderr}`, /ls-files|work context/, `the work context was not built:\n${r.stderr}`);
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  // The panel was asked: both external seats here fail, so the decision ends seats-unavailable with a record.
  const decisions = path.join(f.repo, '.claude', 'decisions');
  const id = fs.readdirSync(decisions).find((n) => /^\d{8}-\d{6}-[0-9a-f]{6}$/.test(n));
  assert.ok(id, 'no decision record: the panel was never asked');
  assert.ok(fs.existsSync(path.join(decisions, id, 'round-1-seats.json')), 'no round was run');
});

test('census: every git call in decide.mjs that reads git\'s output reads it with the listing bound, and a failure names its error', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'decide.mjs'), 'utf8');
  const def = src.match(/const gitOut = \(args\) => \{[\s\S]*?\n\};/);
  assert.ok(def, 'gitOut is not where this census looks for it');
  assert.match(def[0], /gitSync\(args, \{[^}]*maxBuffer: GIT_LISTING_MAX_BUFFER/, 'gitOut reads with spawnSync\'s default 1 MiB');
  assert.match(def[0], /r\.error/, 'a failed read drops its error, so ENOBUFS reads as "exit null"');
  assert.match(src, /const GIT_LISTING_MAX_BUFFER = 1 << 30;/, 'the bound is not the engine\'s listing convention');
  // Every other gitSync in decide.mjs reads only its status, or the one line of rev-parse --show-toplevel.
  const others = src.split('\n').filter((l) => /gitSync\(/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/const r = gitSync\(args, \{/.test(l));
  for (const l of others) {
    assert.ok(/\.status\b/.test(l) || /'--show-toplevel'/.test(l) || /gitSync\(\['init', '-q'\]/.test(l),
      `a git call in decide.mjs reads its output without the listing bound: ${l.trim()}`);
  }
});
