// reviewer-credential-routing.plan.md stage 2 (D1 = A, A-26). A contract that overrides a built-in
// adapter keeps that vendor's credentials (G-29), so the override decides where they go. The gate is
// where a minted run's reader looks, and it said nothing. It now names every override, derived from
// the contract the run FROZE (run.json.contract.reviewers), so a run minted before this change and a
// --resume get the same answer. No stamp, no ceiling: under D1 this is a fact for the reader, not a gap.
//
// BEHAVIOUR, NOT SOURCE SHAPE: the real orchestrator runs in a throwaway repository, and only what it
// wrote is read. `ui.surface: none` plus `--only ui-audit` reaches the gate with no model spawned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';

function fixture(name, extra = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quorate-${name}-`));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `quorate-${name}home-`));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'ok.js'), '');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
    '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n'
    + '  build: "node ok.js"\n  test: "node ok.js"\n'
    + 'source_globs: ["src/**"]\n'
    + `${extra}ui:\n  surface: none\n\`\`\`\n`);
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, home };
}

function review(f) {
  const mint = runScript('new-run.mjs',
    ['--slug', 'ovr', '--no-verify-sandbox', '--no-request', '--full-sweep', '.'],
    { cwd: f.dir, env: { QUORATE_HOME: f.home } });
  assert.equal(mint.status, 0, mint.output.slice(-400));
  const runDir = mintedRunDir(mint.output);
  const graph = runScript('run-graph.mjs',
    ['--run-dir', runDir, '--skip-panel', '--no-archive', '--only', 'ui-audit'],
    { cwd: f.dir, env: { QUORATE_HOME: f.home } });
  const gatePath = path.join(runDir, 'gate.json');
  assert.ok(fs.existsSync(gatePath), `no gate.json:\n${graph.output.slice(-800)}`);
  return {
    output: graph.output,
    gate: JSON.parse(fs.readFileSync(gatePath, 'utf8')),
    gateMd: fs.readFileSync(path.join(runDir, 'gate.md'), 'utf8'),
  };
}

const cleanup = (f) => { for (const d of [f.dir, f.home]) fs.rmSync(d, { recursive: true, force: true }); };

test('the gate names a contract override of a built-in, and neither the verdict nor the ceiling moves', () => {
  const plain = fixture('ovrplain');
  const over = fixture('ovrset', 'reviewers:\n  codex:\n    cmd: "other-codex"\n');
  try {
    const a = review(plain);
    const b = review(over);
    assert.match(b.output, /cost:\s+\$0\.0+\b/, 'this test must spawn no model');

    assert.deepEqual(a.gate.reviewer_overrides, [], 'no override: the field is an empty list');
    assert.doesNotMatch(a.gateMd, /Reviewer overrides/, 'no override: no row');

    assert.deepEqual(b.gate.reviewer_overrides,
      [{ name: 'codex', roles: ['reviewer'], fields: ['cmd'], prefixes: ['CODEX_', 'OPENAI_'] }]);
    assert.match(b.gateMd, /\| Reviewer overrides \| codex — cmd set by the contract; CODEX_\*, OPENAI_\* go to it \|/);

    assert.equal(b.gate.gate, a.gate.gate, 'an override is a fact for the reader, not a verdict');
    assert.equal(b.gate.max_verdict, a.gate.max_verdict, 'and not a ceiling');
    assert.deepEqual(b.gate.stamps, a.gate.stamps, 'and not a stamp');
  } finally { cleanup(plain); cleanup(over); }
});
