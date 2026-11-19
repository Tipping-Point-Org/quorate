// Run 20261114-022647-m2-7b-review (operator: "Close and fix everything live").
//
// G-23 (and its symptom G-22): the intent phase rendered intent.md from evidence/intent-capture/payload.json whenever the
// file existed, and never read the status spawnNode returned. A payload left by an earlier attempt then became this run's
// criteria although the node that ran now failed (I-5: intent.md only from an intent node that succeeded). Driven through
// run-graph with a fake runtime that fails, over a run directory holding a stale payload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';

const tmp = (t, prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const put = (root, rel, body = `${rel}\n`) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

// A runtime that answers every call as a failure, and never spends: a blank login cannot reach a vendor.
function failingRuntime(t) {
  const dir = tmp(t, 'q-m27b-fake-');
  const bin = path.join(dir, 'fake-runtime.mjs');
  fs.writeFileSync(bin, [
    "try { require('node:fs').readFileSync(0, 'utf8'); } catch {}",
    "process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'failed', permission_denials: [], total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }));",
    'process.exit(1);',
  ].join('\n').replace("require('node:fs')", "(await import('node:fs')).default"));
  const noLogin = path.join(dir, 'no-login');
  fs.mkdirSync(noLogin);
  return { bin, env: { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' } };
}

function consumer(t) {
  const repo = tmp(t, 'q-m27b-repo-');
  put(repo, 'src/app.js', 'export const app = 1;\n');
  put(repo, 'docs/guide.md', 'declared\n');
  put(repo, '.claude/requests/ask.md', ['---', 'request: ask', 'status: approved', '---', '', '# The ask', '', '## Acceptance criteria', '1. It works.', ''].join('\n'));
  const yaml = ['graph_contract_version: 5', 'project: m27b-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: ["docs/*.md"]', 'ui:', '  surface: none', 'review:', '  external_panel: false',
    '  models: { judgment: opus, mechanical: sonnet }'].join('\n');
  put(repo, 'CLAUDE.md', `# fixture\n\nThe contract of this fixture, a line long enough to be read rather than guessed.\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  return repo;
}

test('G-23: a failed intent node does not have a stale payload rendered as the run\'s criteria', (t) => {
  const repo = consumer(t);
  const r = runScript('new-run.mjs', ['--slug', `m27b${Math.floor(Math.random() * 1e6)}`, '--repo-root', repo, '--full-sweep', 'src', '--no-verify-sandbox'], { cwd: repo });
  assert.equal(r.status, 0, r.output.slice(-400));
  const dir = mintedRunDir(r.output);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stale = { criteria: [{ id: 'STALE-1', behaviour: 'a criterion from an earlier attempt', io_contract: 'none' }], assumed_contract_unverified: [], not_checked: [] };
  put(dir, 'evidence/intent-capture/payload.json', JSON.stringify(stale));
  const fake = failingRuntime(t);
  runScript('run-graph.mjs', ['--run-dir', dir, '--repo-root', repo, '--only', 'contract-audit', '--skip-panel', '--no-archive', '--runtime-bin', fake.bin],
    { cwd: repo, env: fake.env, mayFanOut: true });
  const intentPath = path.join(dir, 'intent.md');
  const md = fs.existsSync(intentPath) ? fs.readFileSync(intentPath, 'utf8') : '';
  assert.ok(!md.includes('STALE-1'), 'a failed intent node\'s stale payload was rendered as intent.md');
});

// G-10: validateManifest checked only that defect.lenses was a nonempty array, so a duplicate entry counted one seed twice
// in a lens's expected and caught totals, and a non-string entry named no lens at all.
test('G-10: a manifest naming a lens twice, or a lens that is not a name, is refused', async () => {
  const { validateManifest } = await import('../scripts/lib/bench-scoring.mjs');
  const base = (lenses) => ({
    id: 's', title: 't', source: 'mutation', removes_tests: false, scope: ['scripts'],
    defect: { file: 'scripts/lib/decisions.mjs', anchor: 'x', lenses },
  });
  assert.deepEqual(validateManifest(base(['code-audit'])), []);
  assert.ok(validateManifest(base(['code-audit', 'code-audit'])).some((e) => /lenses/.test(e)), 'a duplicate lens was accepted');
  assert.ok(validateManifest(base(['code-audit', 7])).some((e) => /lenses/.test(e)), 'a non-string lens was accepted');
  assert.ok(validateManifest(base(['  '])).some((e) => /lenses/.test(e)), 'a blank lens was accepted');
});

// G-16: every unsafe or reserved session id was written to the one folder `unknown`, so two such sessions shared a record
// folder and a tail read of one could stop at the other's turn event. Each nonempty id now keeps a folder of its own,
// named from its hash; only an id that is missing altogether, which names no session, is written to `unknown`.
test('G-16: two distinct unsafe session ids do not share a record folder', async () => {
  const lib = await import('../scripts/lib/session-record.mjs');
  const unsafe = ['../a', '../b', 'CON', 'con', 'a/b', 'foo.', 'x'.repeat(200), 'x'.repeat(201)];
  const folders = unsafe.map((s) => lib.sessionFolder(s));
  assert.equal(new Set(folders).size, unsafe.length, `unsafe ids share folders: ${folders.join(', ')}`);
  for (const f of folders) {
    assert.match(f, /^~unknown-[0-9a-f]{16}$/, f);
    // No safe id can map to it: a safe id's folder holds only [a-z0-9._^-].
    assert.notEqual(lib.sessionFolder(f), f);
  }
  assert.equal(lib.sessionFolder('../a'), folders[0], 'the folder of one id is stable');
  for (const missing of ['', null, undefined]) assert.equal(lib.sessionFolder(missing), '~unknown', String(missing));
});

// G-21: `--preflight always` ran the checks with no hash computed first, so run-checks hashed the inputs AFTER they
// finished, and a tree that moved while they ran was cached as passing under content they never ran against. Driven
// with a build that edits a declared input while it runs: the result must be cached under the tree the checks started on.
test('G-21: --preflight always caches the result under the inputs as they were before the checks ran', async (t) => {
  const { preflightInputHash, readPreflightCache } = await import('../scripts/io/preflight-cache.mjs');
  const repo = tmp(t, 'q-m27b-g21-');
  put(repo, 'src/app.js', 'export const app = 1;\n');
  put(repo, 'tools/edit.mjs', "import fs from 'node:fs';\nfs.appendFileSync('src/app.js', '// moved while the build ran');\n");
  const yaml = ['graph_contract_version: 5', 'project: m27b-g21', 'commands:', '  build: "node tools/edit.mjs"', '  test: ""',
    'source_globs: ["src/**"]', 'ui:', '  surface: none', 'review:', '  external_panel: false', '  preflight_inputs: ["src/**"]',
    '  models: { judgment: opus, mechanical: sonnet }'].join('\n');
  put(repo, 'CLAUDE.md', `# fixture\n\nThe contract of this fixture, a line long enough to be read rather than guessed.\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  const r = runScript('new-run.mjs', ['--slug', `m27b${Math.floor(Math.random() * 1e6)}`, '--repo-root', repo, '--full-sweep', 'src', '--no-verify-sandbox'], { cwd: repo });
  assert.equal(r.status, 0, r.output.slice(-400));
  const dir = mintedRunDir(r.output);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runJson = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const reviewsDir = path.dirname(dir);
  const before = preflightInputHash({ repoRoot: repo, contract: runJson.contract, contractSource: runJson.contract_source ?? null, reviewsDir }).hash;
  const fake = failingRuntime(t);
  const g = runScript('run-graph.mjs', ['--run-dir', dir, '--repo-root', repo, '--preflight', 'always', '--only', 'code-audit', '--skip-panel', '--no-archive', '--runtime-bin', fake.bin],
    { cwd: repo, env: fake.env, mayFanOut: true });
  assert.match(fs.readFileSync(path.join(repo, 'src/app.js'), 'utf8'), /moved while the build ran/, `the build did not run: ${g.output.slice(-600)}`);
  const after = preflightInputHash({ repoRoot: repo, contract: runJson.contract, contractSource: runJson.contract_source ?? null, reviewsDir }).hash;
  assert.notEqual(before, after);
  assert.equal(readPreflightCache(reviewsDir, after), null, 'the result was cached under the tree as it was after the checks ran');
  // Nor under the tree they started on (G-10 of 20261114-032609-m2-7b-remediation-review): a check moved an input, so the
  // result describes no one state of the inputs, and run-checks hashes them again after the checks before caching.
  assert.equal(readPreflightCache(reviewsDir, before), null, 'a result over inputs that moved was cached under the start hash');
});

// G-18: contextOf kept a list of lineContext's fields of its own; it is now derived from lineContext.
test('G-18: contextOf keeps exactly the fields lineContext builds', async () => {
  const lib = await import('../scripts/lib/session-record.mjs');
  const ctx = lib.lineContext({ now: 1, record: 'stops', session: 's', pid: 1, startedMs: 1, hookEvent: 'Stop' });
  assert.deepEqual(Object.keys(lib.contextOf({ ...ctx, event: 'start', at: 1 })), Object.keys(ctx));
});

// G-8: appendStopEvent (and appendRecord, the other JSONL appender) refused a symbolic link at the record file but not a
// second name: a hard link standing at current.jsonl aliased a file outside the engine home, and the next event was
// written into it. Both now append only to a file with one name, judged on the open file.
test('G-8: an event is not appended through a hard link at the record file', async (t) => {
  const { appendStopEvent, sessionDir } = await import('../scripts/io/stop-log.mjs');
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const home = tmp(t, 'q-m27b-g8-home-');
  const repo = tmp(t, 'q-m27b-g8-repo-');
  const outside = tmp(t, 'q-m27b-g8-out-');
  appendStopEvent(repo, { at: 1, event: 'start', session: 's1' }, { home });
  const current = path.join(sessionDir(repo, 's1', { home }), 'current.jsonl');
  const victim = path.join(outside, 'victim.txt');
  fs.writeFileSync(victim, 'outside\n');
  fs.rmSync(current);
  try { fs.linkSync(victim, current); } catch (e) { t.skip(`this host cannot make a hard link here (${e.code})`); return; }
  assert.throws(() => appendStopEvent(repo, { at: 2, event: 'turn', session: 's1' }, { home }), /hard link|second name|EHARDLINK/i);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'outside\n', 'the event was written into a file outside the engine home');

  const rec = path.join(outside, 'rec.jsonl');
  const other = path.join(outside, 'other.txt');
  fs.writeFileSync(other, 'other\n');
  fs.linkSync(other, rec);
  assert.throws(() => appendRecord(rec, '{"a":1}\n'), /hard link|second name|EHARDLINK/i);
  assert.equal(fs.readFileSync(other, 'utf8'), 'other\n', 'appendRecord wrote through a hard link');
});
