// G-2 of 20261122-204359-llo-remediation-review (panel-codex-security): gen-gitleaks-config wrote
// .claude/hooks/gitleaks.toml with writeTextAtomic on a joined path, so a link or junction standing at .claude/hooks sent
// the temporary write and its rename outside the repository. The file is now written through `confined`, rooted at the
// repository, and a link at any level is refused before anything is written. The script locates the repository from its
// own file, so it is run from a copy of scripts/ in a fixture tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, makeLink } from './helpers.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-ggc-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.cpSync(SCRIPTS_DIR, path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
  const run = () => spawnSync(process.execPath, [path.join(repo, 'scripts', 'gen-gitleaks-config.mjs')], { cwd: repo, encoding: 'utf8' });
  return { base, repo, run };
}

test('G-2: a junction at .claude/hooks is refused, and nothing is written through it', (t) => {
  const { base, repo, run } = fixture(t);
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  if (!makeLink(t, { target: outside, at: path.join(repo, '.claude', 'hooks'), type: 'dir', fallback: { dir: outside } })) return;
  const r = run();
  assert.notEqual(r.status, 0, `the rules were written through the link: ${r.stdout}`);
  assert.deepEqual(fs.readdirSync(outside), [], 'a file was written outside the repository through the link');
});

test('with no link, the rules are still written', (t) => {
  const { repo, run } = fixture(t);
  fs.mkdirSync(path.join(repo, '.claude', 'hooks'));
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(repo, '.claude', 'hooks', 'gitleaks.toml'), 'utf8'), /\[\[rules\]\]/);
});
