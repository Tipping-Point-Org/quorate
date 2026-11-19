// The consumer-test sandbox mounts quorate as a git submodule, which is a CHECKOUT. Edits made
// inside .sandbox/<project>/.claude/skills/quorate exist in no branch, are carried by no push, and
// are discarded silently the next time the pointer moves. That is the direction that loses work.
//
// The other direction — the clone sitting on an older commit — is NOT a defect: it is the normal
// state of a pinned checkout between test runs, and asserting "always at HEAD" would fail
// constantly while protecting nothing. What matters there is reading the framework stamp before
// attributing a result, which every run already records.
//
// So this checks exactly one thing: has anyone edited the mounted copy in place. It is the rule
// most easily broken by whoever is working fastest, and the one whose breakage is unrecoverable.
// It skips when no sandbox exists, so it costs nothing on a clean checkout or in CI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const SANDBOX = path.join(REPO_ROOT, '.sandbox');

function mountedCopies() {
  if (!fs.existsSync(SANDBOX)) return [];
  return fs.readdirSync(SANDBOX, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(SANDBOX, d.name, '.claude', 'skills', 'quorate'))
    .filter((p) => fs.existsSync(path.join(p, '.git')));
}

// SKIPPED, NOT SILENTLY PASSED, when there is no sandbox to check (G-66, panel-codex-perf).
//
// `if (!copies.length) return;` recorded a PASSING test on a machine with no mounted fixture — and
// the machine that most needs this check is the one that has just cloned a fixture, while the runner
// most likely to report green is CI, which never has one. A green tick for a behaviour nobody
// exercised is the same class of claim as a lens that reported nothing being read as a lens that
// found nothing.
test('regression: the mounted quorate copy has no in-place edits', (t) => {
  const copies = mountedCopies();
  if (!copies.length) {
    t.skip('no mounted sandbox on this machine — the in-place-edit check did not run');
    return;
  }
  for (const dir of copies) {
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim();
    assert.equal(dirty, '',
      `quorate was edited in place inside the sandbox — these changes exist in no branch and will\n`
      + `be discarded when the submodule pointer next moves. Move them to the framework repo:\n${dirty}`);
  }
});

test('the sandbox is gitignored, so a fixture never enters the framework repo', () => {
  const ignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.sandbox\/\s*$/m, 'a cloned consumer project must never be committed here');
  const tracked = execFileSync('git', ['ls-files', '.sandbox/'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  assert.equal(tracked, '', `sandbox files are tracked in the framework repo:\n${tracked}`);
});
