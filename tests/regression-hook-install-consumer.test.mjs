// NOTHING EVER RAN THE INSTALLER.
//
// Every test that mentioned install.mjs read its SOURCE TEXT. The installer was executed exactly
// once, by hand, in this repository -- the layout where its path substitution happened to be the
// identity -- and never in the consumer layout it exists for. The operator asked the right
// question: "so it was not tested?" No. It was not.
//
// Running it in a consumer layout immediately produced a defect. The committed shims probe two
// locations for their helper (`$root/.claude/hooks/...` then
// `$root/.claude/skills/quorate/.claude/hooks/...`), and the installer rewrote the string
// `/.claude/hooks/` to its own offset -- textually, every occurrence, INCLUDING the consumer path
// already written in the second probe. The installed hook read:
//
//     ".../quorate/.claude/hooks/branch-guard.mjs" ".../quorate/.claude/skills/quorate/.claude/hooks/branch-guard.mjs"
//
// a fallback pointing into a path that exists in no layout. Harmless only because the first probe
// now resolves -- which is precisely the shape of a guard that is already gone before anything
// needs it. The substitution predates the shims learning to probe for themselves; once they did,
// the two mechanisms solved one problem and only one of them could be wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

/** A throwaway git repository with quorate's hooks mounted the way a CONSUMER mounts them. */
function consumerRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-consumer-')));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '--quiet', '.');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  const hooks = path.join(dir, '.claude', 'skills', 'quorate', '.claude', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO_ROOT, '.claude', 'hooks'))) {
    fs.copyFileSync(path.join(REPO_ROOT, '.claude', 'hooks', f), path.join(hooks, f));
  }
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'init');
  return { dir, hooks, git };
}

test('regression: the installer RUNS, in the consumer layout it exists for', () => {
  const { dir, hooks } = consumerRepo();
  try {
    const r = spawnSync(process.execPath, [path.join(hooks, 'install.mjs')], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `installer failed:\n${r.stdout}${r.stderr}`);

    for (const name of ['pre-commit', 'pre-push']) {
      const installed = path.join(dir, '.git', 'hooks', name);
      assert.ok(fs.existsSync(installed), `${name} was not installed`);
      const body = fs.readFileSync(installed, 'utf8');

      // EVERY PATH THE SHIM PROBES MUST BE ONE THAT COULD EXIST. The mangled fallback was a real
      // path-shaped string that no layout produces, so nothing pointed at it and nothing noticed.
      const probes = [...body.matchAll(/"\$root\/([^"]+)"/g)].map((m) => m[1]);
      assert.ok(probes.length >= 2, `${name} must probe both layouts, found ${probes.length}`);
      for (const p of probes) {
        assert.ok(!/skills\/quorate\/.*skills\/quorate/.test(p),
          `${name} probes a doubled path no layout produces: ${p}`);
      }
      // And at least one of them is the file that is actually there.
      assert.ok(probes.some((p) => fs.existsSync(path.join(dir, p))),
        `${name} probes ${probes.join(' and ')}, neither of which exists in this layout`);

      assert.ok(!body.includes('\r'), 'a CRLF hook fails with "bad interpreter" under sh');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('regression: the installed pre-commit actually blocks a commit on the trunk', () => {
  // The whole chain, end to end, in one assertion: installer -> shim -> probe -> branch-guard ->
  // refusal. Reading the installer's source can show none of it. This is the test that answers
  // "is it installed AND does it work", which is the only question the operator asked.
  const { dir } = consumerRepo();
  try {
    execFileSync(process.execPath, [path.join(dir, '.claude/skills/quorate/.claude/hooks/install.mjs')],
      { cwd: dir, encoding: 'utf8' });

    fs.appendFileSync(path.join(dir, 'a.txt'), 'two\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    const onTrunk = spawnSync('git', ['commit', '-m', 'on the trunk'], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(onTrunk.status, 0, 'a commit on the default branch must be refused');
    assert.match(`${onTrunk.stdout}${onTrunk.stderr}`, /branch-guard: refusing a commit directly on/);

    // And it is a guard, not a wall: the same commit succeeds on a branch. A hook that refused
    // everything would pass the assertion above for the wrong reason.
    execFileSync('git', ['switch', '--quiet', '-c', 'feature'], { cwd: dir });
    const onBranch = spawnSync('git', ['commit', '-m', 'on a branch'], { cwd: dir, encoding: 'utf8' });
    assert.equal(onBranch.status, 0, `refused on a branch too:\n${onBranch.stdout}${onBranch.stderr}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('regression: the installer no longer rewrites paths, and check-install matches it', () => {
  // The two must move together. check-install compares against "what the installer WOULD write
  // now", so a rewrite removed from one and left in the other reports every installed hook as
  // drifted -- a ceiling firing on a non-problem, which teaches readers to ignore ceilings.
  const inst = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'hooks', 'install.mjs'), 'utf8');
  const chk = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'check-install.mjs'), 'utf8');
  for (const [name, src] of [['install.mjs', inst], ['check-install.mjs', chk]]) {
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.ok(!code.includes("split('/.claude/hooks/')"),
      `${name} still rewrites the shim's paths; the shims probe for themselves`);
  }
});
