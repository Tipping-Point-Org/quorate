// Run 20261001-155615-cgg-review-r3 (operator, 2026-10-01: "Fix all six, G-22 driven offline (Recommended)").
//
// G-22 and its symptoms were tests that matched source text where the wiring could not be reached offline — or so the
// round-2 report said. It could: spawn-node already took a fake runtime through --claude-bin. run-graph, new-run and the
// grant probe now pass that override on, and these tests drive them with a FAKE RUNTIME that logs what it was handed
// (argv, cwd, the sandbox it saw) and answers like a runtime under a policy: correctly, leaking, with its policy
// dropped, or lazily. What the wiring hands a node is then observed, not spelled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as ds from '../scripts/io/doc-snapshot.mjs';
import { worktreeSha } from '../scripts/io/worktree.mjs';
import { runScript, mintedRunDir } from './helpers.mjs';

// Imported tolerantly, so a missing module fails ITS test by name rather than every test in the file.
const grant = await import('../scripts/lib/grant-probe.mjs').catch(() => ({}));

const tmp = (t, prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const put = (root, rel, body = `${rel}\n`) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const LONG = (tag) => `${tag} — a line long enough that nothing guesses it without reading this very file, ${'x'.repeat(20)}`;

// ------------------------------------------------------------------------------------------ the fake
// Serialized into the fixture, so it is written once, here, as code. It reads its prompt from stdin, which every spawner
// closes after writing it (or leaves ignored), and never prints anything but one JSON envelope.
async function fakeRuntimeMain() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const argv = process.argv.slice(2);
  const value = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const many = (flag) => {
    const i = argv.indexOf(flag);
    if (i < 0) return [];
    const out = [];
    for (let j = i + 1; j < argv.length && !argv[j].startsWith('-'); j++) out.push(argv[j]);
    return out;
  };
  // The prompt arrives on stdin (decision-panel-seats.plan.md stage 2): -p is bare. Reading fd 0 returns '' for an
  // ignored stdin, so this still never blocks.
  let prompt = '';
  try { prompt = fs.readFileSync(0, 'utf8'); } catch { /* an ignored stdin */ }
  const cwd = process.cwd();
  const roots = [cwd, ...many('--add-dir')].map((r) => path.resolve(r));
  const inside = (p) => roots.some((r) => { const rel = path.relative(r, p); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); });
  const listing = (dir, pre = '') => {
    let out = [];
    let es = [];
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of es) {
      if (e.isDirectory()) out = out.concat(listing(path.join(dir, e.name), `${pre}${e.name}/`));
      else out.push(`${pre}${e.name}`);
    }
    return out;
  };
  const mode = process.env.FAKE_RUNTIME_MODE ?? 'sandbox';
  const asked = prompt.split(/\s+/).map((s) => s.replace(/[.,;:'"`]+$/, '')).filter((s) => path.isAbsolute(s) && fs.existsSync(s));
  let text = '';
  const denials = [];
  for (const p of asked) {
    const allowed = mode === 'leaky' || (mode !== 'dropped' && inside(p));
    if (allowed) text += `\n${fs.readFileSync(p, 'utf8')}`;
    else if (mode !== 'lazy') { denials.push({ tool_name: 'Read', tool_input: { file_path: p } }); text += `\nRead of ${p} was refused.`; }
  }
  if (process.env.FAKE_RUNTIME_LOG) {
    fs.appendFileSync(process.env.FAKE_RUNTIME_LOG, JSON.stringify({ argv, cwd, settings: value('--settings'), addDirs: many('--add-dir'), sandbox: listing(cwd), envKeys: Object.keys(process.env) }) + '\n');
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, permission_denials: denials, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }));
}
function fakeRuntime(t, mode) {
  const dir = tmp(t, 'q-r3-fake-');
  const bin = path.join(dir, 'fake-runtime.mjs');
  fs.writeFileSync(bin, `(${fakeRuntimeMain.toString()})();\n`);
  const log = path.join(dir, 'calls.jsonl');
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  // A REAL RUNTIME THAT SLIPS PAST THE OVERRIDE CANNOT AUTHENTICATE. The first red run of the probe test spawned the
  // installed CLI, live, because the probe ignored a flag it did not yet know — a test that can reach a real vendor when
  // its fake is missed is a wrong test (regression-node-output-cap says the same). An empty config directory and blank
  // credentials make any such call fail before it can spend.
  const noLogin = path.join(dir, 'no-login');
  fs.mkdirSync(noLogin);
  const guard = { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' };
  return { bin, env: { ...guard, FAKE_RUNTIME_LOG: log, FAKE_RUNTIME_MODE: mode }, calls };
}

// A consuming repository with an approved request, so contract-audit — the one lens that needs intent — is selected.
function consumer(t, { docPaths, files = {}, extraYaml = [] }) {
  const repo = tmp(t, 'q-r3-repo-');
  put(repo, 'src/app.js', 'export const app = 1;\n');
  for (const [rel, body] of Object.entries(files)) put(repo, rel, body);
  put(repo, '.claude/requests/ask.md', ['---', 'request: ask', 'status: approved', '---', '', '# The ask', '', '## Acceptance criteria', '1. It works.', ''].join('\n'));
  const yaml = ['graph_contract_version: 5', 'project: r3-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', `doc_paths: ${JSON.stringify(docPaths)}`, 'ui:', '  surface: none', 'review:', '  external_panel: false',
    '  models: { judgment: opus, mechanical: sonnet }', ...extraYaml].join('\n');
  put(repo, 'CLAUDE.md', `# fixture\n\n${LONG('The contract of this fixture')}\n${LONG('Its second line')}\n${LONG('Its third line')}\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  return repo;
}
const mint = (t, repo, extra = [], env = {}) => {
  const slug = `r3${Math.floor(Math.random() * 1e6)}`;
  const r = runScript('new-run.mjs', ['--slug', slug, '--repo-root', repo, '--full-sweep', 'src', ...extra], { cwd: repo, env });
  const dir = (() => { try { return mintedRunDir(r.output); } catch { return (/Run dir: (.+)$/m.exec(r.output) ?? [])[1]?.trim() ?? null; } })();
  if (dir) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { r, dir, slug };
};
const intentCalls = (calls) => calls.filter((c) => /intent-settings\.json$/.test(c.settings ?? ''));

// ---------------------------------------------------------------------------------------------- G-5
test('G-5: a read the node never attempted is not a refusal', () => {
  assert.equal(typeof grant.judgeOriginalRead, 'function', 'the probe has no judgement of an original read');
  const file = path.join(os.tmpdir(), 'repo', 'src', 'app.js');
  const marker = 'MARKER-src_app_js';
  assert.equal(grant.judgeOriginalRead({ file, marker, denied: [file], text: '' }), 'refused');
  assert.equal(grant.judgeOriginalRead({ file, marker, denied: [], text: `got ${marker}` }), 'read');
  assert.equal(grant.judgeOriginalRead({ file, marker, denied: [], text: 'nothing' }), 'not-attempted');
  // A refused original whose COPY was read: the copy carries the same marker, so the answer holds it. Measured live on
  // the first re-run of the probe after this fix, where every inside original was denied and scored as read.
  assert.equal(grant.judgeOriginalRead({ file, marker, denied: [file], text: `copy said ${marker}` }), 'refused');
});

test('G-5: the grant probe, driven offline, does not agree with a runtime that never tried the originals', (t) => {
  const fake = fakeRuntime(t, 'lazy');
  const r = runScript('check-intent-grant.mjs', ['--runtime-bin', fake.bin], { env: { QUORATE_LIVE: '1', ...fake.env } });
  const report = JSON.parse(r.stdout);
  assert.ok(fake.calls().length >= 1, 'the probe never reached the fake runtime');
  assert.ok(report.forms.every((f) => f.outsideOriginal === 'not-attempted'), JSON.stringify(report.forms.map((f) => f.outsideOriginal)));
  assert.equal(r.status, 1, 'a probe whose node never attempted the outside read reported agreement');
});

// ---------------------------------------------------------------------------------------------- G-7
test('G-7: a document that resolves to a file its glob does not declare is refused, and recorded', (t) => {
  const repo = tmp(t, 'q-r3-g7-');
  put(repo, 'docs/a.md', 'a\n');
  put(repo, 'docs/sub/secret.md', 'undeclared\n');
  const snapDir = path.join(tmp(t, 'q-r3-g7-snap-'), 'docs');
  const skips = [];
  const target = path.join(repo, 'docs', 'sub', 'secret.md');
  // A link, as the walk sees one: the entry's real path is somewhere else. Reproducible without the privilege a real
  // symlink needs on Windows; the real-link variant below runs where links can be made.
  const realpath = (p) => (path.basename(p) === 'a.md' ? target : fs.realpathSync(p));
  ds.snapshotDocGlobs({ repoRoot: repo, docPaths: ['docs/*.md'], snap: ds.createSnapshot(snapDir), onSkip: (s) => skips.push(s), realpath });
  assert.deepEqual(fs.existsSync(snapDir) ? fs.readdirSync(snapDir) : [], [], 'a link to an undeclared document was copied');
  assert.ok(skips.some((s) => /a\.md/.test(s.item) && /does not declare/.test(s.reason)), JSON.stringify(skips));
});

test('G-7: with a real link, where this host can make one', (t) => {
  const repo = tmp(t, 'q-r3-g7l-');
  put(repo, 'docs/sub/secret.md', 'undeclared\n');
  try { fs.symlinkSync(path.join(repo, 'docs', 'sub', 'secret.md'), path.join(repo, 'docs', 'a.md')); } catch (e) {
    t.skip(`this host cannot create a symlink (${e.code}); the realpath-driven test above covers the decision`);
    return;
  }
  const snapDir = path.join(tmp(t, 'q-r3-g7l-snap-'), 'docs');
  ds.snapshotDocGlobs({ repoRoot: repo, docPaths: ['docs/*.md'], snap: ds.createSnapshot(snapDir) });
  assert.deepEqual(fs.existsSync(snapDir) ? fs.readdirSync(snapDir) : [], []);
});

// ---------------------------------------------------------------------------------------------- G-9
test('G-9: a directory the tree hash cannot list makes the hash unrepeatable', (t) => {
  const repo = tmp(t, 'q-r3-g9-');
  put(repo, 'src/a.js');
  put(repo, 'src/locked/b.js');
  const readdir = (d) => { if (path.basename(d) === 'locked') { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; } return fs.readdirSync(d); };
  const a = worktreeSha({ repoRoot: repo, paths: ['src'], readdir });
  const b = worktreeSha({ repoRoot: repo, paths: ['src'], readdir });
  assert.ok(a && b);
  assert.notEqual(a, b, 'an unlistable subtree dropped out of the hash, so two snapshots agree about files neither saw');
  assert.equal(worktreeSha({ repoRoot: repo, paths: ['src'] }), worktreeSha({ repoRoot: repo, paths: ['src'] }));
});

// --------------------------------------------------------------------------------------------- G-14
test('G-14: a scope that vanished entirely during the run is TREE-MOVED, not silence (driven)', (t) => {
  const repo = consumer(t, { docPaths: [] });
  const { r, dir } = mint(t, repo, ['--no-request', '--no-verify-sandbox']);
  assert.equal(r.status, 0, r.output.slice(-400));
  fs.rmSync(path.join(repo, 'src'), { recursive: true, force: true });
  runScript('run-graph.mjs', ['--run-dir', dir, '--repo-root', repo, '--only', 'ui-audit', '--no-archive'], { cwd: repo });
  const gate = JSON.parse(fs.readFileSync(path.join(dir, 'gate.json'), 'utf8'));
  assert.ok((gate.stamps ?? []).includes('TREE-MOVED'), `stamps: ${gate.stamps}`);
});

// -------------------------------------------------------------------------------- G-22 (gate 4) and G-12
test('G-22: gate 4 runs both intent arms under intent-settings.json, from the sandbox alone, and records them', (t) => {
  const repo = consumer(t, { docPaths: ['docs/*.md', '.claude/**'], files: {
    'docs/guide.md': `${LONG('Guide first')}\n${LONG('Guide second')}\n${LONG('Guide third')}\n`,
    'docs/sub/deep.md': 'not declared by docs/*.md\n',
    '.claude/reviews/old-run/gate.md': 'an archived run\n',
  } });
  const fake = fakeRuntime(t, 'sandbox');
  const { r, dir } = mint(t, repo, ['--no-request', '--runtime-bin', fake.bin], fake.env);
  const arms = intentCalls(fake.calls());
  assert.equal(arms.length, 2, `the intent arms did not both run under intent-settings.json:\n${r.output.slice(-600)}`);
  for (const a of arms) {
    assert.deepEqual(a.addDirs.map((d) => path.resolve(d)), [path.resolve(a.cwd)], 'an intent arm was given more than its sandbox');
    assert.ok(a.argv.includes('Grep'), 'Grep is not denied to the intent arm');
    assert.ok(a.sandbox.includes('contract.snapshot.md'));
    assert.ok(a.sandbox.some((n) => n.endsWith('guide.md')), `the declared document is not in the sandbox: ${a.sandbox}`);
    assert.ok(!a.sandbox.some((n) => n.endsWith('deep.md') || n.endsWith('gate.md')), `undeclared or archived content: ${a.sandbox}`);
  }
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'intent-canary.json'), 'utf8'));
  assert.equal(record.negative_arm.source_content_leaked, false);
  assert.equal(record.positive_arm.declared_doc_read, true);
  assert.doesNotMatch(r.output, /could not read its own declared document|Rule 2 is not enforced/);
});

test('G-22: gate 4 refuses a leaking runtime and a runtime whose policy was dropped, each for its own reason', (t) => {
  const files = { 'docs/guide.md': `${LONG('Guide first')}\n${LONG('Guide second')}\n${LONG('Guide third')}\n` };
  const leaky = fakeRuntime(t, 'leaky');
  const leak = mint(t, consumer(t, { docPaths: ['docs/*.md'], files }), ['--no-request', '--runtime-bin', leaky.bin], leaky.env);
  assert.notEqual(leak.r.status, 0);
  assert.match(leak.r.output, /Rule 2 is not enforced/);
  const dropped = fakeRuntime(t, 'dropped');
  const drop = mint(t, consumer(t, { docPaths: ['docs/*.md'], files }), ['--no-request', '--runtime-bin', dropped.bin], dropped.env);
  assert.notEqual(drop.r.status, 0);
  assert.match(drop.r.output, /could not read its own declared document/);
});

test('G-12: when doc globs are declared and nothing is copied, the canary says it read the contract snapshot instead', (t) => {
  const repo = consumer(t, { docPaths: ['docs/*.md'] });   // declared, and nothing there
  const fake = fakeRuntime(t, 'sandbox');
  const { r, dir } = mint(t, repo, ['--no-request', '--runtime-bin', fake.bin], fake.env);
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'intent-canary.json'), 'utf8'));
  assert.equal(record.positive_arm.target, 'contract.snapshot.md');
  assert.equal(record.positive_arm.declared_doc_copied, false);
  assert.match(r.output, /no declared document was copied/);
});

// ------------------------------------------------------------- G-18, G-20, G-21, G-23: run-graph's intent node
test('G-18/G-20/G-21/G-23: run-graph gives the intent node its sandbox of copies and nothing else, and records skips', (t) => {
  const repo = consumer(t, { docPaths: ['docs/*.md', '.claude/**', '**/*.md'], files: {
    'docs/guide.md': 'declared\n',
    'docs/sub/deep.md': 'not declared by docs/*.md\n',
    '.claude/reviews/old-run/gate.md': 'an archived run\n',
  } });
  const { r, dir } = mint(t, repo, ['--no-verify-sandbox']);
  assert.equal(r.status, 0, r.output.slice(-400));
  const fake = fakeRuntime(t, 'sandbox');
  // Every node this run spawns goes to the fake: --runtime-bin reaches spawn-node for each, and the panel is off.
  runScript('run-graph.mjs', ['--run-dir', dir, '--repo-root', repo, '--only', 'contract-audit', '--skip-panel', '--no-archive', '--runtime-bin', fake.bin],
    { cwd: repo, env: fake.env, mayFanOut: true });
  const intent = intentCalls(fake.calls());
  assert.equal(intent.length, 1, `the intent node did not run under intent-settings.json (${fake.calls().length} calls)`);
  const [node] = intent;
  assert.deepEqual(node.addDirs.map((d) => path.resolve(d)), [path.resolve(node.cwd)], 'G-20: a live directory was mounted');
  assert.ok(node.sandbox.includes('contract.snapshot.md'), `G-21: no contract snapshot: ${node.sandbox}`);
  assert.ok(node.sandbox.some((n) => n.endsWith('guide.md')), `G-21: the declared document was not copied: ${node.sandbox}`);
  assert.ok(!node.sandbox.some((n) => n.endsWith('deep.md')), `undeclared document copied: ${node.sandbox}`);
  assert.ok(!node.sandbox.some((n) => n.endsWith('gate.md')), `G-18: an archived run reached the sandbox: ${node.sandbox}`);
  const gate = JSON.parse(fs.readFileSync(path.join(dir, 'gate.json'), 'utf8'));
  assert.ok((gate.buckets?.not_checked ?? []).some((e) => e.node_id === 'intent-capture' && /\*\*\/\*\.md/.test(e.why)),
    `G-23: the empty-prefix glob's skip did not reach the gate: ${JSON.stringify(gate.buckets?.not_checked)}`);
});

// ------------------------------------------------------------- round 4: run 20261001-183347-cgg-review-r4
// (operator, 2026-10-01: "Fix G-18 and G-17, ledger the rest (Recommended)"). In this file because the fake runtime and
// the consumer fixture above are what drive them.

test('G-18 (r4): a scope empty at mint that holds files at the gate is TREE-MOVED (driven)', (t) => {
  const repo = consumer(t, { docPaths: [] });
  fs.rmSync(path.join(repo, 'src', 'app.js'));   // src/ exists and holds nothing to hash
  const { r, dir } = mint(t, repo, ['--no-request', '--no-verify-sandbox']);
  assert.equal(r.status, 0, r.output.slice(-400));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')).worktree_sha, null, 'the fixture must mint an empty scope');
  put(repo, 'src/added.js', 'export const added = 1;\n');
  runScript('run-graph.mjs', ['--run-dir', dir, '--repo-root', repo, '--only', 'ui-audit', '--no-archive'], { cwd: repo });
  const gate = JSON.parse(fs.readFileSync(path.join(dir, 'gate.json'), 'utf8'));
  assert.ok((gate.stamps ?? []).includes('TREE-MOVED'), `stamps: ${gate.stamps}`);
});

test('G-17 (r4): a document declared only under doc_roles reaches the intent node; the request keeps its own path', (t) => {
  const repo = consumer(t, {
    docPaths: ['docs/*.md'],
    files: { 'docs/guide.md': 'declared\n', 'ARCH.md': 'the architecture, declared only as a role\n' },
    extraYaml: ['doc_roles:', '  architecture: "ARCH.md"'],
  });
  const { r, dir } = mint(t, repo, ['--no-verify-sandbox']);
  assert.equal(r.status, 0, r.output.slice(-400));
  const fake = fakeRuntime(t, 'sandbox');
  runScript('run-graph.mjs', ['--run-dir', dir, '--repo-root', repo, '--only', 'contract-audit', '--skip-panel', '--no-archive', '--runtime-bin', fake.bin],
    { cwd: repo, env: fake.env, mayFanOut: true });
  const [node] = intentCalls(fake.calls());
  assert.ok(node, 'the intent node did not run');
  assert.ok(node.sandbox.some((n) => n.endsWith('ARCH.md')), `the doc_roles document is not in the sandbox: ${node.sandbox}`);
  assert.ok(node.sandbox.some((n) => n.endsWith('guide.md')));
  // THE REQUEST KEEPS ITS OWN PATH. effectiveDocRoles adds the run's request as a role, so without the exclusion it would
  // also arrive through the doc snapshot, under its repository path, bypassing the frozen-hash check of its own copy.
  assert.ok(node.sandbox.includes('declared-docs/request__ask.md'), `the request's own copy is missing: ${node.sandbox}`);
  assert.ok(!node.sandbox.some((n) => /requests__ask\.md$/.test(n)), `the request also came through the doc snapshot: ${node.sandbox}`);
});

// ------------------------------------------------------------- round 5: run 20261001-193417-cgg-review-r5
// G-12/G-13 (operator, 2026-10-01: "Fix the doc drift, ledger the rest (Recommended)"): both documents said the intent
// sandbox holds only the doc_paths copies and the contract snapshot, after b7b6bfa added the doc_roles documents. A doc
// statement is pinned by its text, as regression-m0-gate-review-r3-remediation does for the same document.
test('G-12/G-13 (r5): the documents name the doc_roles documents as part of the intent sandbox', () => {
  const read = (...p) => fs.readFileSync(path.join(import.meta.dirname, '..', ...p), 'utf8');
  assert.match(read('shared', 'claude-md-contract.md'), /matches are copied into the node's sandbox, together with the documents named under `doc_roles`/);
  assert.match(read('shared', 'disk-first-protocol.md'), /matches and the documents named under `doc_roles`/);
  // The intent-settings.json row of the same document repeated the old wording, and the walk's silent pass over review
  // and generated trees was unstated (found verifying the ledger's operator-only claims, 2026-10-01).
  const contract = read('shared', 'claude-md-contract.md');
  assert.doesNotMatch(contract, /exactly the documents each `doc_paths` glob matches, plus `contract\.snapshot\.md`/);
  assert.match(contract, /A document inside a review run directory or a `generated_globs` tree is never copied/);
  // G-15 of 20261001-205530-m0-pending-claims-review: the doctrine said the sandbox holds what every glob matches, and a
  // glob with no base directory is skipped (recorded) rather than walked.
  assert.match(read('shared', 'disk-first-protocol.md'), /A glob with no directory before its first wildcard \(`\*\.md`, `\*\*\/\*\.md`\) is not\nwalked/);
});

// G-15 of 20261023-040306-rdt-remediation-2-review: docReadDirs made the intent sandbox with a recursive mkdir and wrote
// the document snapshot into it with no check of where it resolved, so a `sandbox` link planted in the run sent the copies
// of the declared documents, and the node's readable root, outside the run.
test('G-15 (rdt-2): a sandbox link out of the run is refused, and nothing is written through it', (t) => {
  const repo = consumer(t, { docPaths: ['docs/*.md'], files: { 'docs/guide.md': 'declared\n' } });
  const { r, dir } = mint(t, repo, ['--no-verify-sandbox']);
  assert.equal(r.status, 0, r.output.slice(-400));
  const outside = tmp(t, 'quorate-sandbox-outside-');
  fs.rmSync(path.join(dir, 'sandbox'), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(dir, 'sandbox'), 'junction');
  const fake = fakeRuntime(t, 'sandbox');
  runScript('run-graph.mjs', ['--run-dir', dir, '--repo-root', repo, '--only', 'contract-audit', '--skip-panel', '--no-archive', '--runtime-bin', fake.bin],
    { cwd: repo, env: fake.env, mayFanOut: true });
  assert.deepEqual(fs.readdirSync(outside), [], 'the intent sandbox was made and written outside the run');
});
