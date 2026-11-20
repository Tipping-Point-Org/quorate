// G-12 of 20261120-010728-m2-gaps-review: tests/tools/install-from-repo.mjs is the fresh-machine install check (M2's
// Q7), and it copied the runner's whole environment, removing only QUORATE_*. Git's environment config
// (GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n), GIT_ASKPASS and SSH_AUTH_SOCK all reached the clone, so the
// "unauthenticated, fresh" install could pass on configuration or credentials only the runner had.
//
// This drives the real tool. The runner's environment carries an insteadOf rewrite, through GIT_CONFIG_*, from a URL
// nothing can clone to a small local repository. A fresh machine has no such rewrite, so the mount step must fail; with
// the leak it succeeded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(repo, 'tests', 'tools', 'install-from-repo.mjs');

test('the install check does not inherit the runner\'s git environment config', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-install-env-'));
  try {
    const source = path.join(work, 'source');
    fs.mkdirSync(source);
    const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(work, 'none.gitconfig') };
    const git = (...a) => {
      const r = spawnSync('git', a, { cwd: source, env: gitEnv, encoding: 'utf8' });
      assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
    };
    git('init', '-q');
    fs.writeFileSync(path.join(source, 'README'), 'not quorate\n');
    git('add', 'README');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'init');

    const fake = 'https://example.invalid/runner-only/quorate.git';
    const env = { ...process.env,
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: `url.${source.replace(/\\/g, '/')}.insteadOf`, GIT_CONFIG_VALUE_0: fake,
      GIT_CONFIG_KEY_1: 'protocol.file.allow', GIT_CONFIG_VALUE_1: 'always' };
    const r = spawnSync(process.execPath, [tool, '--url', fake], { env, encoding: 'utf8', timeout: 120000 });
    const out = r.stdout || '';
    const mount = out.match(/\$ git -c credential\.helper= submodule add [^\n]*\n[\s\S]*?\[exit (\S+)\]/);
    assert.ok(mount, `the mount step ran:\n${out}\n${r.stderr}`);
    assert.notEqual(mount[1], '0',
      `the mount succeeded through a rewrite only the runner's GIT_CONFIG_* carried:\n${out}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
