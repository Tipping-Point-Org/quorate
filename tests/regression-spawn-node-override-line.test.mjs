// reviewer-credential-routing.plan.md stage 3 (D1 = A, A-26): spawn-node names an override of the node
// runtime it is about to spawn, on stderr, from ITS OWN table: the one built from the run's FROZEN
// contract (run.json.contract.reviewers), which is the table the node actually runs on. Plan-review
// rounds 3, 5 and 6 each found a caller printing this line from a different table than the one that
// ran (a bench's live table against a copied run's frozen one), so no caller computes it: spawn-node
// does, and remediate, bench-second-opinion and run-graph all show its stderr.
//
// The overridden cmd does not exist, so nothing is spawned: the line must come before the spawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRunDir, runScript } from './helpers.mjs';

// spawn-node admits only one of the repository's runs, the repository being --repo-root or its cwd: run-dir-trust.plan.md
// stage 3 (ARCHITECTURE A-28). So the frozen-contract run is one of THIS repository's (cwd REPO_ROOT, runScript's default),
// and the live-contract case's run sits in the live fixture's own .claude/reviews, with the fixture as cwd.
const RUN_ID = '20260101-000000-snovr';

// --print-cmd stops before any child is spawned; no node-settings.json is written, so the policy check refuses first anyway.
const spawn = (runDir, cwd) => runScript('spawn-node.mjs', [
  '--run-dir', runDir, '--node-id', 'x', '--mode', 'lens', '--model', 'opus',
  '--schema-variant', 'code', '--skill-command', '/x', '--allowed-basis', 'convention', '--print-cmd',
], cwd ? { cwd } : {});

test('the frozen contract overrides the node runtime: spawn-node names it before spawning', () => {
  const runDir = repoRunDir({ runId: RUN_ID, prefix: 'quorate-sn-ovr-', json: { contract: { reviewers: { claude: { cmd: 'quorate-no-such-cli' } } } } }).dir;
  try {
    const r = spawn(runDir);
    assert.match(r.stderr,
      /claude \(node runtime\) — cmd set by the contract; every node spawned on this runtime gets the scrubbed environment/,
      r.output.slice(-800));
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('the LIVE contract overrides it and the frozen one does not: no line, because the frozen one runs', () => {
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-sn-live-'));
  try {
    fs.writeFileSync(path.join(live, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\nreviewers:\n  claude:\n    cmd: "quorate-no-such-cli"\n```\n');
    const runDir = path.join(live, '.claude', 'reviews', RUN_ID);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: RUN_ID, repo_root: live, contract: {} }));
    const r = spawn(runDir, live);
    // Admission must pass, or the absent line below would prove nothing: the refusal names the policy file, not the run.
    assert.doesNotMatch(r.output, /--run-dir /, `the run must be admitted for this to test anything:\n${r.output.slice(-800)}`);
    assert.doesNotMatch(r.stderr, /set by the contract/, r.output.slice(-800));
  } finally {
    fs.rmSync(live, { recursive: true, force: true });
  }
});
