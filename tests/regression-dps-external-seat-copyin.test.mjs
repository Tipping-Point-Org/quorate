// decision-panel-seats.plan.md stage 6, found live (2026-11-11, decision 20261111-055540-08ae29; operator: "A. Copy-in for
// every seat (Recommended)"): the external seats stood in one EMPTY directory per decision, so agy's model, looking for the
// files the question cited, ran `Get-ChildItem -Path .`, headless agy denied it, the retry was denied the same way, and agy
// answered no round; only the node-runtime seat had copies (stage 1). Now every external seat's call stands in a
// directory of its own holding the same copies, made under the same rules (the credential screen for files git does not
// track, the size bounds, refusal of links, non-text files and line breaks, evidence outside the repository refused and
// named), recorded as `<stem>-copies.json` as the runtime seat's are; and the seat prompt says the cited files are in the
// working directory at their repository-relative paths. The revote author is as it was and the moderator gets none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const Q = (evidence) => ({ question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable', evidence });
// Built at run time, so the push scan does not read this test file as a credential.
const SECRET = `${['pass', 'word'].join('')}: "${['Sup3r', 'S3cret', 'Value9x'].join('')}"\n`;

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

// An external seat that records what stands in its working directory and the prompt it was given, then answers as its
// vendor does: codex through --output-last-message, agy as a stream-json result. The same answer serves the probe.
function fakeSeatMain() {
  const fs = require('node:fs');
  const path = require('node:path');
  const here = path.dirname(process.argv[1]);
  const name = path.basename(process.argv[1]).replace(/^fake-|\.mjs$/g, '');
  const a = process.argv.slice(2);
  if (a.includes('--version')) { process.stdout.write('fake 1.0\n'); return; }
  let stdin = '';
  try { stdin = fs.readFileSync(0, 'utf8'); } catch { /* none */ }
  let prompt = stdin;
  if (name === 'agy') { try { prompt = JSON.parse(stdin.trim().split('\n')[0]).message.content; } catch { prompt = ''; } }
  const walk = (d, pre = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === '.git' ? []
    : e.isDirectory() ? walk(path.join(d, e.name), `${pre}${e.name}/`) : [`${pre}${e.name}`]));
  fs.appendFileSync(path.join(here, `seen-${name}.jsonl`), `${JSON.stringify({ probe: /transport check/.test(prompt), cwd: process.cwd(), files: walk(process.cwd()), prompt,
    cited: fs.existsSync('docs/cited.md') ? fs.readFileSync('docs/cited.md', 'utf8') : null })}\n`);
  const answer = { status: 'ok', reason: '', choice: 'E1', rationale: 'probe', other_text: '', change_of: '', what_would_change: 'probe', citations: ['probe'] };
  if (name === 'codex') {
    const i = a.indexOf('--output-last-message');
    if (i !== -1) fs.writeFileSync(a[i + 1], JSON.stringify(answer));
    process.stdout.write(JSON.stringify(answer));
    return;
  }
  process.stdout.write(`${JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: JSON.stringify(answer),
    ...(a.includes('--json-schema') ? { structured_output: answer } : {}), usage: { input_tokens: 1, output_tokens: 1 } } })}\n`);
}

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dps-extcopy-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['codex', 'agy']) {
    fs.writeFileSync(path.join(bin, `fake-${name}.mjs`), `import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n(${fakeSeatMain.toString()})();\n`);
  }
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  const fwd = (p) => p.split(path.sep).join('/');
  const node = fwd(process.execPath);
  const limits = ['    probe_timeout_minutes: 0.5', '    version_timeout_seconds: 10', '    check_margin_seconds: 2'];
  const agyBase = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print=', '--disable-slash-commands'].map((x) => `"${x}"`).join(', ');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 5', 'project: t', 'commands:',
    '  build: ""', '  test: ""', 'review:', '  external_panel: true', '  decision_panel: on', '  grounding_floor: convention',
    '  models: { judgment: opus, mechanical: sonnet }', '  effort: { judgment: low }', 'reviewers:',
    '  codex:', ...limits, `    cmd: "${node}"`, '    needs_shell_on_windows: false',
    `    version_argv: ["${fwd(path.join(bin, 'fake-codex.mjs'))}", "--version"]`, `    base_argv: ["${fwd(path.join(bin, 'fake-codex.mjs'))}", "exec"]`,
    '  agy:', ...limits, `    cmd: "${node}"`,
    `    version_argv: ["${fwd(path.join(bin, 'fake-agy.mjs'))}", "--version"]`, `    base_argv: ["${fwd(path.join(bin, 'fake-agy.mjs'))}", ${agyBase}]`,
    '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/decisions/\n');
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.writeFileSync(path.join(repo, 'docs', 'cited.md'), '# The cited note\n\nIts one line.\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  // Untracked, so changed and named in the work context: one plain, one credential-shaped (screened, refused).
  fs.mkdirSync(path.join(repo, 'notes'));
  fs.writeFileSync(path.join(repo, 'notes', 'ok.txt'), 'a plain note\n');
  fs.writeFileSync(path.join(repo, 'notes', 'secret.txt'), SECRET);
  const q = path.join(dir, 'question.json');
  fs.writeFileSync(q, JSON.stringify(Q(['docs/cited.md'])));
  const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home'), QUORATE_REVIEWER_PROBES: path.join(dir, 'probes') };
  delete env.GRAPH_NODE_DEPTH;
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'decide.mjs'), '--repo-root', repo, '--question', q, '--runtime-bin', fakeRuntime(dir)],
    { cwd: repo, encoding: 'utf8', env, timeout: 300_000 });
  const seen = (name) => {
    const f = path.join(bin, `seen-${name}.jsonl`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((c) => !c.probe) : [];
  };
  const decisions = path.join(repo, '.claude', 'decisions');
  const id = fs.existsSync(decisions) ? fs.readdirSync(decisions).find((n) => /^\d{8}-\d{6}-[0-9a-f]{6}$/.test(n)) : null;
  return { r, seen, record: id ? path.join(decisions, id) : null };
}

test('every external seat stands in a directory of its own holding the cited copies at their relative paths, and no refused one', (t) => {
  const f = fixture(t);
  assert.equal(f.r.status, 0, `${f.r.stderr}\n${f.r.stdout}`);
  for (const name of ['codex', 'agy']) {
    const calls = f.seen(name);
    assert.ok(calls.length >= 1, `the ${name} seat was never called`);
    for (const c of calls) {
      assert.ok(c.files.includes('docs/cited.md'), `${name}'s directory lacks the cited file: ${c.files}`);
      assert.ok(c.files.includes('notes/ok.txt'), `${name}'s directory lacks a changed file: ${c.files}`);
      assert.ok(!c.files.includes('notes/secret.txt'), `${name}'s directory holds a credential-shaped file the screen refuses`);
      // Read by the seat itself: decide removes the directory when it exits.
      assert.ok(String(c.cited).startsWith('# The cited note'), `the copy is not the file: ${c.cited}`);
    }
  }
  const [codexCwd] = f.seen('codex').map((c) => c.cwd);
  const [agyCwd] = f.seen('agy').map((c) => c.cwd);
  assert.notEqual(path.resolve(codexCwd), path.resolve(agyCwd), 'two external seats shared one directory');
});

test('each external seat\'s copies are recorded beside its call, the refused path named with why', (t) => {
  const f = fixture(t);
  assert.ok(f.record, `no decision record:\n${f.r.stderr}`);
  for (const name of ['codex', 'agy']) {
    const file = path.join(f.record, `seat-${name}-r1-copies.json`);
    assert.ok(fs.existsSync(file), `no ${path.basename(file)} in the record: ${fs.readdirSync(f.record)}`);
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(c.copied.includes('docs/cited.md'));
    assert.ok(c.refused.some((x) => x.path === 'notes/secret.txt'), `the screened file is not named as refused: ${JSON.stringify(c.refused)}`);
  }
});

test('the seat prompt says the cited files are in its working directory at their repository-relative paths', (t) => {
  const f = fixture(t);
  assert.ok(f.record, `no decision record:\n${f.r.stderr}`);
  for (const name of ['codex', 'agy', 'claude']) {
    const p = fs.readFileSync(path.join(f.record, `round-1-${name}-prompt.md`), 'utf8');
    assert.match(p, /working directory/, `${name}'s prompt does not say where the cited files are`);
    assert.match(p, /repository-relative path/, `${name}'s prompt does not say how they are laid out`);
  }
  for (const c of f.seen('agy')) assert.match(c.prompt, /working directory/, 'the prompt agy received does not name the copies');
});
