// run-dir-reads.plan.md stage 4 (design run-dir-reads.design.md, R-D2 A and R-D3 A; operator, 2026-10-29: "Approve"): the
// entry scripts read files below the admitted run raw, so a link at any level was followed. End to end, with a link
// planted INSIDE the run that resolves elsewhere inside it, each now refuses it by name. The remediation runner's and
// new-run --remediates' halves are in regression-remediate-runner-refusals.test.mjs, beside the fixture they need.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRunDir, runScript, REPO_ROOT } from './helpers.mjs';

const KIND = process.platform === 'win32' ? 'junction' : 'dir';

// G-23 of 20261029-065343-rdd-remediation-2-review and G-12 of 20261029-134336-rdd-remediation-3-review: intent.md was read
// raw while validating a lens's verdict, so a link standing at it put another file's criteria in front of the check.
test('run-dir-reads stage 4: spawn-node does not read intent.md through a link standing at it', () => {
  const { base, dir: runDir } = repoRunDir({ runId: '20261029-000000-rdrintent', prefix: 'quorate-rdr-intent-' });
  try {
    fs.writeFileSync(path.join(runDir, 'node-settings.json'), JSON.stringify({ permissions: { defaultMode: 'manual', allow: [], deny: [] } }));
    const inner = path.join(runDir, 'inner-intent');
    fs.mkdirSync(inner);
    fs.symlinkSync(inner, path.join(runDir, 'intent.md'), KIND);
    const ev = path.join(runDir, 'evidence', 'code-audit', 'x.log');
    const payload = {
      schema_version: 1, run_id: '20261029-000000-rdrintent', node_id: 'code-audit', intent_sha: '', verdict: 'PASS',
      checked_clean: [], findings: [], not_checked: [{ item: 'x', reason: 'a fixture' }], out_of_scope_observations: [],
    };
    const fake = path.join(base, 'fake-claude.mjs');
    fs.writeFileSync(fake, [
      `import fs from 'node:fs';`,
      `fs.mkdirSync(${JSON.stringify(path.dirname(ev))}, { recursive: true });`,
      `fs.writeFileSync(${JSON.stringify(ev)}, 'captured');`,
      `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, num_turns: 1, result: ${JSON.stringify(JSON.stringify(payload))} }));`,
      '',
    ].join('\n'));
    const r = runScript('spawn-node.mjs', ['--run-dir', runDir, '--repo-root', REPO_ROOT, '--node-id', 'code-audit', '--mode', 'lens',
      '--prompt', 'x', '--allowed-basis', 'convention', '--timeout-minutes', '1', '--runtime-bin', fake]);
    assert.notEqual(r.status, 0, `the verdict was judged against criteria read through the link:\n${r.output.slice(-600)}`);
    assert.match(r.output, /intent\.md[^\n]*link or junction/, r.output.slice(-600));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// archive-run decided that a run had ended from gate.json read raw below it, so a link standing at gate.json archived a
// run on the strength of another directory.
test('run-dir-reads stage 4: archive-run does not take a link at gate.json as the run having ended', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-rdr-archive-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const reviews = path.join(repo, '.claude', 'reviews');
  const runId = '20261029-000000-rdr-archive';
  const dir = path.join(reviews, runId);
  fs.mkdirSync(path.join(dir, 'inner-gate'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: runId, repo_root: repo, archive_to: reviews }));
  fs.symlinkSync(path.join(dir, 'inner-gate'), path.join(dir, 'gate.json'), KIND);
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', dir]);
  assert.notEqual(r.status, 0, `archived on a link at gate.json:\n${r.output}`);
  assert.match(r.output, /gate\.json[^\n]*link or junction/, r.output);
});
