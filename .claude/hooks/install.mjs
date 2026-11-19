#!/usr/bin/env node
// install.mjs — copy the committed hook bodies into .git/hooks.
//
// .git/hooks is not tracked, so the real hook bodies live here and this copies them into place.
// Run once per clone:
//
//     node .claude/hooks/install.mjs
//
// Idempotent. Refuses to clobber a hook this installer does not manage unless --force is given —
// a developer's own pre-commit is not ours to overwrite silently.
//
// Exit codes: 0 installed (or already current)   1 refused to overwrite   2 configuration error

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANAGED = ['pre-commit', 'pre-push'];

// What the operator LOSES by not having each one. Named at the point of refusal, because
// "refused" on its own says a file was not written — not which guarantee they no longer hold.
const WHAT_EACH_HOOK_GIVES = {
  'pre-push': 'the blocking gate that runs your declared build/test before work reaches main or master',
  'pre-commit': 'the non-blocking reminder to update governing documents alongside the code',
};
const MARKER = 'Committed copy — install with `node .claude/hooks/install.mjs`.';
const force = process.argv.includes('--force');
const uninstall = process.argv.includes('--uninstall');

function die(msg, code = 2) {
  console.error(`install: ${msg}`);
  process.exit(code);
}

const rr = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (rr.status !== 0) die('not inside a git repository');
const root = rr.stdout.trim();

// Respect core.hooksPath: a repo that redirects its hooks elsewhere would otherwise get files
// installed into a directory git never reads, and the installer would report success.
const hp = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' });
const hooksDir =
  hp.status === 0 && hp.stdout.trim()
    ? path.resolve(root, hp.stdout.trim())
    : path.join(root, '.git', 'hooks');

fs.mkdirSync(hooksDir, { recursive: true });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

for (const name of MANAGED) {
  const src = path.join(HERE, name);
  const dst = path.join(hooksDir, name);
  if (!fs.existsSync(src)) die(`missing committed hook body: ${src}`);

  if (uninstall) {
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8').includes(MARKER)) {
      fs.unlinkSync(dst);
      console.log(`removed  ${path.relative(root, dst)}`);
    } else {
      console.log(`skipped  ${path.relative(root, dst)} (not managed by this installer)`);
    }
    continue;
  }

  const body = fs.readFileSync(src, 'utf8');
  if (fs.existsSync(dst)) {
    const existing = fs.readFileSync(dst, 'utf8');
    if (sha(existing) === sha(body)) {
      console.log(`current  ${path.relative(root, dst)}`);
      continue;
    }
    if (!existing.includes(MARKER) && !force) {
      console.error(
        // Refusing is right — someone else's hook is not ours to overwrite — but refusing QUIETLY
        // is not. The operator walks away believing a gate is in place when it is not, and a
        // believed-in absent guard is worse than an obviously absent one. Say what was refused,
        // WHAT IS THEREFORE MISSING, and both ways to resolve it.
        `refused  ${path.relative(root, dst)} exists and was not installed by this script.\n` +
          `         NOT INSTALLED, so this repository does NOT have:\n` +
          `           ${WHAT_EACH_HOOK_GIVES[name] ?? 'this hook'}\n` +
          `         Two ways to resolve it:\n` +
          `           - keep yours and call ours from it: our body is ${path.relative(root, src)},\n` +
          `             and it is a short shim, so chaining it costs you nothing; or\n` +
          `           - inspect yours, then re-run with --force to replace it.\n` +
          `         Doing neither is a defensible choice — but make it knowingly.`,
      );
      process.exitCode = 1;
      continue;
    }
  }

  // THE BODY, VERBATIM. There used to be a path rewrite here, substituting the installer's own
  // offset for `/.claude/hooks/` so a plugin-layout install would point at the right file. It
  // predates the shims learning to probe for themselves, and once they did the two mechanisms
  // solved the same problem — except the rewrite is textual and hits EVERY occurrence, including
  // the consumer path already written in the second probe.
  //
  // Measured, by running this installer in a consumer layout for the first time: the installed
  // pre-commit read
  //     for p in ".../quorate/.claude/hooks/branch-guard.mjs" \
  //              ".../quorate/.claude/skills/quorate/.claude/hooks/branch-guard.mjs"
  // — the fallback rewritten into a path that exists in no layout. Harmless only because the first
  // probe now resolves, which is exactly the shape of a guard that is already gone before anyone
  // notices it is needed.
  //
  // The runtime probe is also the better of the two: it keeps working when the framework moves,
  // where a path baked in at install time silently stops.
  //
  // Hooks must be LF regardless of the checkout — git runs them through sh, and a CRLF shebang
  // fails with a confusing "bad interpreter" on some shells. That half stays.
  const resolved = body.replace(/\r\n/g, '\n');

  fs.writeFileSync(dst, resolved, { mode: 0o755 });
  try {
    fs.chmodSync(dst, 0o755); // no-op on Windows, load-bearing everywhere else
  } catch {
    /* ignore */
  }
  console.log(`installed ${path.relative(root, dst)}`);
}

if (!uninstall && process.exitCode !== 1) {
  console.log('\npre-commit  branch guard (BLOCKS on the default branch) + doc-sync reminder');
  console.log('pre-push    declared checks from CLAUDE.md (blocks; --no-verify bypasses)');
}
