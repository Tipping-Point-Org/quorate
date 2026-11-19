// THE ONE CONTRACT READER (ledger-findings.plan.md stage 4; design D4). Ten callers spawned `new-run --print-contract`
// and classified a failure each its own way — returning null, dying, or matching the owner's message text to tell "no
// contract" from "cannot read one". This spawns it once per process and repository and returns lib/contract-source.mjs's
// classification: `{ contract }`, `{ absent }` or `{ error }`. Each caller keeps its own response to each outcome.
//
// The framework's own new-run, beside this file — a hook that located a framework copy imports THIS file from that copy,
// so the reader and the new-run it runs are always the same engine.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyPrintContract } from '../lib/contract-source.mjs';

const NEW_RUN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'new-run.mjs');
const memo = new Map();

/**
 * `repoRoot` passes `--repo-root` (and runs there); `cwd` alone lets new-run find the repository from the working
 * directory, as a caller that never named one did. `spawn` is a seam for tests; a caller passing it is not memoized
 * across a real read.
 */
export function readContract({ repoRoot = null, cwd = null, spawn = null } = {}) {
  const where = repoRoot ? path.resolve(repoRoot) : path.resolve(cwd ?? process.cwd());
  const key = `${repoRoot ? 'root' : 'cwd'}:${where}${spawn ? ':seam' : ''}`;
  if (memo.has(key)) return memo.get(key);
  const run = spawn ?? ((cmd, args, opts) => spawnSync(cmd, args, opts));
  const r = run(process.execPath, [NEW_RUN, '--print-contract', ...(repoRoot ? ['--repo-root', where] : [])], {
    cwd: where, encoding: 'utf8',
  });
  const out = classifyPrintContract({ status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error ?? null });
  memo.set(key, out);
  return out;
}
