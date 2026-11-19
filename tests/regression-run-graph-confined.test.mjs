// run-dir-descendants.plan.md stage 2 (D-D3 A, D-D2 A), end to end: run-graph's writes below the admitted run go through
// the one owner. G-26 of 20261024-122231-rdt-remediation-3-review: the intent sandbox's declared-docs copies were made
// under a sandbox/ checked only against the run's real path, so a link resolving back inside the run passed and could be
// retargeted. With a link planted at sandbox/, the run now stops there and nothing is created through it. The fixture
// is the one regression-telemetry-run-time builds: a fake runtime and a guard environment, so no real CLI can run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintSlug, mintedRunDir } from './helpers.mjs';

function mintedRun(t) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-rgc-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), body); };
  put('src/app.js', 'export const x = 1;\n');
  put('docs/a.md', '# a declared document\n');
  const yaml = ['graph_contract_version: 5', 'project: rgc', 'commands:', '  build: "node -e 0"', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: ["docs/**"]', 'review:', '  external_panel: false'].join('\n');
  put('CLAUDE.md', '# fixture\n\n```yaml\n' + yaml + '\n```\n');
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  const fakeDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-rgc-fake-')));
  t.after(() => fs.rmSync(fakeDir, { recursive: true, force: true }));
  const fake = path.join(fakeDir, 'fake-runtime.mjs');
  fs.writeFileSync(fake, "process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{}', "
    + "total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }));\n");
  fs.mkdirSync(path.join(fakeDir, 'no-login'));
  const env = { CLAUDE_CONFIG_DIR: path.join(fakeDir, 'no-login'), CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' };
  const slug = mintSlug('rgc');
  const mint = runScript('new-run.mjs', ['--slug', slug, '--repo-root', repo, '--no-verify-sandbox', '--full-sweep', 'src', '--runtime-bin', fake], { cwd: repo, env });
  assert.equal(mint.status, 0, mint.output.slice(-500));
  const staged = mintedRunDir(mint.output);
  t.after(() => fs.rmSync(staged, { recursive: true, force: true }));
  // --no-archive (ci-path-identity.plan.md stage 3): the run reaches its gate and is moved out of staging, so on CI, where
  // the copy can re-create the planted link, the folder the test reads afterwards was gone (PR #3, every job). On a
  // machine that cannot create a symbolic link the move failed with EPERM and left the run staged, which is why it passed
  // there. What this test holds is the refusal below the sandbox, not the archive.
  const graph = () => runScript('run-graph.mjs', ['--run-dir', staged, '--repo-root', repo, '--only', 'ui-audit', '--preflight', 'always', '--skip-panel', '--no-archive', '--runtime-bin', fake], { cwd: repo, env });
  return { staged, graph };
}

// AMENDED by prompt-bound-run-reads.plan.md stage 1b (operator, 2026-11-14: "Design step: refusal classes + a run test
// (Recommended)"): a refusal below the sandbox no longer ends run-graph by an exception; the node it would have fed is
// BLOCKED with the cause and the run reaches its gate. What G-26 asked stays: nothing is created through the link.
test('run-dir-descendants stage 2: a link at sandbox/ resolving inside the run is refused and named; nothing is created through it (G-26)', (t) => {
  const { staged, graph } = mintedRun(t);
  const inner = path.join(staged, 'inner-sandbox');
  fs.mkdirSync(inner);
  fs.rmSync(path.join(staged, 'sandbox'), { recursive: true, force: true });
  fs.symlinkSync(inner, path.join(staged, 'sandbox'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = graph();
  assert.match(r.output, /link or junction/, r.output.slice(-800));
  assert.doesNotMatch(r.output, /^\s+at .*run-graph\.mjs/m, `run-graph ended by an exception:\n${r.output.slice(-800)}`);
  assert.deepEqual(fs.readdirSync(inner), [], 'nothing was created through the link');
});
