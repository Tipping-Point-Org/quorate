// regression-run-dir-trust-callers.test.mjs — run-dir-trust.plan.md stages 2 and 3 (ARCHITECTURE A-28; G-12 of
// 20261022-230755-ciss-d1-4-remediation-review).
//
// The G-12 scenario, per caller: a counterfeit run staged under the engine's shared home, for ANOTHER repository, whose
// run.json names that repository and carries a contract of its own. Containment alone admitted it, and remediate.mjs then
// locked, ran git in, and would have committed in the repository it named. Each caller must refuse it before it writes
// anything into the run or acts on the repository it names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, TEST_HOME, REPO_ROOT } from './helpers.mjs';
import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

function counterfeit(t, extra = {}) {
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-other-repo-')));
  const runId = `20260101-000000-counterfeit-${path.basename(other).slice(-6).toLowerCase()}`;
  const dir = path.join(defaultReviewsRoot({ project: 'other', repoRoot: other, home: TEST_HOME }), runId);
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  t.after(() => {
    for (const d of [other, path.dirname(dir)]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const marker = path.join(other, 'ran.txt');
  const command = `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')"`;
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
    run_id: runId, repo_root: other, host: { cwd: other }, stamps: [],
    contract: { project: 'other', commands: { build: command, test: command } },
    remediates: 'x', remediation_frame: { run_dir: dir }, ...extra,
  }));
  // Ended, so a script that admits it goes on to act: archive-run would move it into the repository it names.
  fs.writeFileSync(path.join(dir, 'gate.json'), '{"gate":"RISK"}');
  return { dir, other, marker, before: fs.readdirSync(dir).sort() };
}

function refused(t, script, argv, { cwd = REPO_ROOT } = {}) {
  const c = counterfeit(t);
  const r = runScript(script, argv(c.dir), { cwd, mayFanOut: script === 'run-graph.mjs', mayProbe: script === 'new-run.mjs' });
  assert.notEqual(r.status, 0, `${script} accepted another repository's staged run: ${r.stdout}${r.stderr}`);
  // Refused by THIS script, at its own admission: a refusal printed further down by a child it spawned means the script
  // itself accepted the run.
  const own = new RegExp(`^${script.replace(/\.mjs$/, '')}: (?:--(?:run-dir|remediates|follows-remediation) )?.*(not one of .*'s runs|names repo_root)`, 'm');
  assert.match(r.stderr, own, `${script} did not refuse it as another repository's at its own admission: ${r.stderr}`);
  assert.deepEqual(fs.readdirSync(c.dir).sort(), c.before, `${script} wrote into the counterfeit run`);
  assert.ok(!fs.existsSync(c.marker), `${script} ran the counterfeit run's contract command`);
  return r;
}

test('remediate.mjs refuses another repository\'s staged remediation run (G-12)', (t) => {
  refused(t, 'remediate.mjs', (dir) => ['--run-dir', dir, '--no-verify-sandbox']);
});

test('run-checks.mjs refuses another repository\'s staged run, and runs none of its commands (G-16, G-17)', (t) => {
  refused(t, 'run-checks.mjs', (dir) => ['--run-dir', dir, '--repo-root', REPO_ROOT]);
});

test('run-graph.mjs refuses another repository\'s staged run (A-28)', (t) => {
  refused(t, 'run-graph.mjs', (dir) => ['--run-dir', dir, '--repo-root', REPO_ROOT]);
});

test('capture.mjs refuses another repository\'s staged run; its contract is not this node\'s allow-list (A-28)', (t) => {
  refused(t, 'capture.mjs', (dir) => ['--run-dir', dir, '--node', 'probe', '--name', 'probe', '--', 'git', 'status']);
});

test('external-review.mjs refuses another repository\'s staged run; its frozen consent is not this repository\'s (A-28)', (t) => {
  const prompt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-er-prompt-')), 'prompt.md');
  fs.writeFileSync(prompt, 'x');
  t.after(() => fs.rmSync(path.dirname(prompt), { recursive: true, force: true }));
  refused(t, 'external-review.mjs', (dir) => ['--run-dir', dir, '--reviewer', 'codex', '--node-id', 'probe', '--surface', 'code',
    '--prompt-file', prompt]);
});

// --remediates from this repository is refused earlier, by the rule that the framework may not mint its own remediation;
// --follows-remediation reads the same kind of frame and is admitted by the same owner.
test('new-run.mjs --follows-remediation refuses another repository\'s staged remediation run (G-9, A-28)', (t) => {
  refused(t, 'new-run.mjs', (dir) => ['--slug', 'probe', '--follows-remediation', dir, '--full-sweep', 'scripts', '--no-verify-sandbox',
    '--no-verify-reviewers']);
});

test('archive-run.mjs refuses another repository\'s staged run, and moves nothing (A-28)', (t) => {
  refused(t, 'archive-run.mjs', (dir) => ['--run-dir', dir, '--repo-root', REPO_ROOT]);
});

// Stage 3: the remaining callers.
test('spawn-node.mjs refuses another repository\'s staged run; its run_id does not become this node\'s pin (A-28)', (t) => {
  refused(t, 'spawn-node.mjs', (dir) => ['--run-dir', dir, '--repo-root', REPO_ROOT, '--node-id', 'probe', '--mode', 'lens',
    '--skill-command', '/probe', '--prompt', 'x']);
});

test('findings-ledger.mjs refuses to fold another repository\'s staged run into this repository\'s ledger (A-28)', (t) => {
  refused(t, 'findings-ledger.mjs', (dir) => ['--run-dir', dir, '--repo-root', REPO_ROOT]);
});

// A scored run is read as a run of no repository (noRepository), so another repository's run is scored; what still holds
// is containment and identity: a directory that is not the run its record names is refused before anything is scored.
test('bench-lenses.mjs --score-only refuses a directory that is not the run its run.json names (A-28)', (t) => {
  const c = counterfeit(t);
  fs.writeFileSync(path.join(c.dir, 'run.json'), JSON.stringify({ run_id: 'another-run', repo_root: c.other }));
  const r = runScript('bench-lenses.mjs', ['--score-only', '--run-dir', c.dir,
    '--manifest', path.join(REPO_ROOT, 'bench', 'corpus', 'probe-substring-match', 'manifest.json'), '--defect-line', '1']);
  assert.notEqual(r.status, 0, `scored a run that is not its directory's: ${r.stdout}`);
  assert.match(r.stderr, /--score-only: --run-dir .*is not the run its run\.json names/, r.stderr);
});
