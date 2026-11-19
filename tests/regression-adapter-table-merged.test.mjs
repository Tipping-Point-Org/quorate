// G-1 and G-15 of 20261105-013235-ar-d1-c-remediation-review: check-intent-grant.mjs and resume-run.mjs built their
// adapter table from builtinReviewers() alone, so a contract overriding the node runtime was ignored there: resume-run
// printed and ran the built-in command for a run whose runtime the contract overrides (A-26). Every entry script that
// takes an adapter table must merge the contract's declarations into it; a bare `= builtinReviewers()` table is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'scripts');

test('no entry script builds its adapter table from builtinReviewers() alone', () => {
  const offenders = [];
  for (const f of fs.readdirSync(SCRIPTS)) {
    if (!f.endsWith('.mjs')) continue;
    const src = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
    src.split(/\r?\n/).forEach((line, i) => {
      // An assignment whose whole right side is builtinReviewers(): the table with no contract declarations merged.
      if (/=\s*builtinReviewers\(\s*\)\s*;/.test(line)) offenders.push(`scripts/${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `adapter tables that ignore the contract's reviewers: ${offenders.join(', ')}`);
});

// G-20 of 20261105-052942-crsf-delivery (panel-codex-arch): the test below matches source text only, so a call whose result
// is ignored, or one handed no contract, still passes. This one runs resume-run on a contract that overrides the node
// runtime's cmd and holds it to the overridden command and the A-26 notice.
test('G-20: resume-run reopens with the command the contract overrides, and names the override', async () => {
  const { writeRunState } = await import('../scripts/io/run-state.mjs');
  const { newRunState } = await import('../scripts/lib/run-state.mjs');
  const { selectAdapters } = await import('../scripts/io/reviewers.mjs');
  const { runScript } = await import('./helpers.mjs');
  const runtime = selectAdapters({}).runtime;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crsf-g20-'));
  try {
    const repo = path.join(base, 'repo'); const home = path.join(base, 'home');
    fs.mkdirSync(repo); fs.mkdirSync(home);
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 6', 'project: t', 'reviewers:',
      `  ${runtime}:`, '    cmd: "alt-runtime-cmd"', '```', ''].join('\n'));
    writeRunState(repo, newRunState({ plan: 'p.plan.md', startedAt: Date.now(), limitHours: null, session: 'sess-1' }), { home });
    const r = runScript('resume-run.mjs', ['--repo-root', repo], { env: { QUORATE_HOME: home }, cwd: repo });
    assert.equal(r.status, 0, r.output);
    assert.match(r.stdout, /^resume-run: alt-runtime-cmd .*sess-1/m, `the override's command was not the one resumed:\n${r.output}`);
    assert.match(r.stderr, new RegExp(`${runtime}.*cmd set by the contract`), `the override was not named:\n${r.output}`);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('resume-run and check-intent-grant merge the contract and name an override (A-26)', () => {
  for (const f of ['resume-run.mjs', 'check-intent-grant.mjs']) {
    const src = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
    // Through the one owner since contract-runtime-and-session-files.plan.md stage 1, which merges them.
    assert.match(src, /selectAdapters\(\{ contract/, `${f} merges the contract's declarations`);
    assert.match(src, /overrideLine\(/, `${f} names an override where it runs`);
  }
});
