// A preload for scripts/remediate.mjs, through NODE_OPTIONS, that makes a removal fail as a locked file does, so a test sees
// the runner's own wiring for a throw during the put-back (G-8 of 20261108-065111-si-remediation-7-review: the diagnostic, no
// stack, every file written back, the copies removed), which an imported module cannot reach, and the runner carries no
// seam for it. It acts only in the process running remediate.mjs: NODE_OPTIONS reaches every node the runner starts, and
// those are left alone.
//
//   PROBE_THROW_RM  a repo-relative path: removing it throws EBUSY
//
// ITS MEMORY HALF IS GONE (runner-test-seam.plan.md stage 3): the one-file bound and the read order are held by
// tests/regression-set-aside-reads.test.mjs over the imported module, from its bytes-open and bytes-close channels and a
// measured child, where a whole-run child was too noisy to bound below three files (G-13 of
// 20261108-080036-si-remediation-8-review).

import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

const slashed = (p) => String(p).split(path.sep).join('/');

if (path.basename(process.argv[1] ?? '') === 'remediate.mjs') {
  const throwRm = process.env.PROBE_THROW_RM ?? '';
  const { rmSync } = fs;
  fs.rmSync = function probedRm(p, ...rest) {
    if (throwRm && slashed(p).endsWith(`/${throwRm}`)) throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${p}'`), { code: 'EBUSY' });
    return rmSync.call(fs, p, ...rest);
  };
  syncBuiltinESMExports();
}
