// REQUEST DISCOVERY READ EVERY ENTRY BEFORE PROVING IT INSIDE THE REPOSITORY (G-6 of 20261020-122714-ciss-remediation-4b-review).
//
// new-run's discovery called readFileSync (and statSync, to sort) on every `.claude/requests/*.md` entry, and only the
// one it selected met the realpath containment check afterwards. A link in that directory was followed for reading
// first: an outside approved file was counted among the candidates (two approved requests, a refusal naming a file the
// run must not judge against), and a link to a directory crashed the mint. An entry that leaves the repository is now
// not a candidate at all, so it is never opened, and the sort that nothing used is gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, makeLink } from './helpers.mjs';

const put = (root, rel, text = '') => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
};
const APPROVED = '---\nstatus: approved\n---\n\n# A request\n';

test('regression: an approved request linked from outside the repository is not discovered, and is never opened', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-req-contain-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  put(repo, 'src/app.js', 'export const x = 1;\n');
  const yaml = ['graph_contract_version: 6', 'project: req-contain', 'commands:', '  build: "node -e 0"', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'review:', '  external_panel: false'].join('\n');
  put(repo, 'CLAUDE.md', '# fixture\n\n```yaml\n' + yaml + '\n```\n');
  put(repo, '.claude/requests/real.md', APPROVED);
  put(base, 'outside/approved.md', APPROVED);
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });

  // A file link where the platform allows one; a directory junction (no privilege needed on Windows) otherwise.
  const link = path.join(repo, '.claude', 'requests', 'outside.md');
  const made = makeLink(t, { target: path.join(base, 'outside', 'approved.md'), at: link, type: 'file', fallback: { dir: path.join(base, 'outside') } });
  if (!made) { t.skip('no link can be created here'); return; }

  const mint = runScript('new-run.mjs', ['--dry-run', '--repo-root', repo, '--no-verify-sandbox', '--full-sweep', 'src'], { cwd: repo });
  assert.doesNotMatch(mint.output, /EISDIR|approved requests in|outside\.md/, mint.output.slice(-1500));
  assert.equal(mint.status, 0, mint.output.slice(-1500));
  assert.match(mint.output, /real\.md/, `the one approved request inside the repository is the one discovered:\n${mint.output.slice(-1500)}`);
});
