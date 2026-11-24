// G-7 of 20261122-193909-llo-delivery (panel-codex-security): `claim-check --new` made .claude/claim-checks and wrote its
// .gitignore there before anything confined it, so a junction standing at .claude/claim-checks was followed and the file
// written outside the repository. The folder is now made through `confined`, rooted at the repository, and a link at any
// level is refused before anything is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, withTempDir, makeLink } from './helpers.mjs';

const SCRIPT = path.join(SCRIPTS_DIR, 'claim-check.mjs');
const env = () => { const e = { ...process.env }; delete e.GRAPH_NODE_DEPTH; return e; };

test('G-7: a link at .claude/claim-checks is refused, and nothing is written through it', (t) => {
  withTempDir((dir) => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(outside);
    // Through makeLink, so a refused kind skips by name (G-9 of 20261122-204359-llo-remediation-review).
    if (!makeLink(t, { target: outside, at: path.join(repo, '.claude', 'claim-checks'), type: 'dir', fallback: { dir: outside } })) return;
    const r = spawnSync(process.execPath, [SCRIPT, '--new', 'linked'], { cwd: repo, env: env(), encoding: 'utf8' });
    assert.notEqual(r.status, 0, `--new wrote through the link: ${r.stdout}`);
    assert.deepEqual(fs.readdirSync(outside), [], 'a file was written outside the repository through the link');
  });
});
