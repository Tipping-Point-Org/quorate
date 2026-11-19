// The arms' isolated checkout had an EMPTY directory where the framework is supposed to be.
//
// `git worktree add` checks out tracked files and leaves every submodule an empty directory. In
// this repository that costs nothing -- quorate IS the repository, so its doctrine and detector
// scripts are ordinary tracked files and appear in any checkout, and the condition guarding this
// copy is false. In the documented consumer mount the framework is a submodule at
// `.claude/skills/quorate`, so the arms stood in a tree where shared/ and
// scripts/find-inert-features.mjs did not exist, while their prompts required both.
//
// Measured in the story-pipeline sandbox fixture on the first full consumer-mount run:
// panel-codex-docs came back DEGRADED with "The required doctrine file and mandatory
// find-inert-features.mjs detector were absent" -- an accurate report about a checkout the
// orchestrator had built for it, which the gate then recorded as the ARM being unavailable. This is
// exactly the class CLAUDE.md says self-review cannot reach: "the consumer mount, ui-audit,
// feature-verify, or the .claude/skills/quorate/shared/ doctrine path".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { copyTrackedInto } from '../scripts/io/worktree.mjs';

test('regression: only TRACKED files cross into the arms\' tree', () => {
  // The arms are third-party cloud reviewers, so what lands in their tree is what can leave the
  // machine. The framework checkout holds untracked machine-local artifacts -- `.claude/panel-check
  // .json`, this operator's transport probe, among them -- and a recursive directory copy would put
  // every one of them in front of a vendor. That is the precise exposure the worktree exists to
  // prevent.
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-fw-'));
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-wt-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: src });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: src });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: src });
    fs.mkdirSync(path.join(src, 'shared'), { recursive: true });
    fs.writeFileSync(path.join(src, 'shared', 'disk-first-protocol.md'), '# doctrine\n');
    fs.writeFileSync(path.join(src, '.gitignore'), 'secret-local.json\n');
    execFileSync('git', ['add', '-A'], { cwd: src });
    execFileSync('git', ['commit', '--quiet', '-m', 'x'], { cwd: src });

    // One IGNORED and one merely UNTRACKED: neither is part of the pinned commit, and the ignored
    // one is the shape the real leak had.
    fs.writeFileSync(path.join(src, 'secret-local.json'), '{"host":"this-laptop"}\n');
    fs.writeFileSync(path.join(src, 'scratch.txt'), 'untracked\n');

    const r = copyTrackedInto(src, dst);
    assert.equal(r.ok, true, r.why);
    assert.ok(fs.existsSync(path.join(dst, 'shared', 'disk-first-protocol.md')),
      'the doctrine the arm prompts require must exist in the tree the arm reads');
    assert.ok(!fs.existsSync(path.join(dst, 'secret-local.json')),
      'an ignored machine-local artifact must not be handed to a third-party reviewer');
    assert.ok(!fs.existsSync(path.join(dst, 'scratch.txt')), 'nor an untracked one');
    assert.ok(!fs.existsSync(path.join(dst, '.git')), 'nor the git directory');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test('regression: it copies rather than re-cloning the submodule', () => {
  // `git submodule update --init` was the first attempt, and it does NOT populate from the
  // superproject's .git/modules -- it re-clones. Measured in the fixture, it failed outright:
  // `transport 'file' not allowed`, git having refused file:// submodule clones since
  // CVE-2022-39253. A real consumer, whose submodule URL is an https remote, would instead have
  // reached the NETWORK -- a silent dependency on connectivity in the middle of a review, for files
  // already sitting on disk at the commit that consumer pinned.
  const lib = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'worktree.mjs'), 'utf8');
  const code = lib.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /'submodule'/, 'a re-clone needs a transport; a copy does not');
  // `-s` since arms-read-surface Stage 3: the mode tells the snapshot rule which entries are links.
  assert.match(code, /'ls-files', (?:'-s', )?'-z'/, 'tracked files come from git, not from a directory walk');

  // WHEN run-graph invokes this is not asserted here, and deliberately. That condition -- inside the
  // reviewed repository, and not already present -- was pinned in BOTH this file and
  // regression-worktree-framework-runnable, in the same source-shape regex. Adding the
  // already-present guard turned one of them red and left the other green, which is the duplication
  // failure this project keeps finding in its own documents: two copies of one fact, and only one
  // gets edited. The call site has one owner now; this file owns what copyTrackedInto DOES.
});
