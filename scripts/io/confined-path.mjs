// lib/confined-path.mjs, BOUND TO THIS HOST: the platform's filesystem, and durableRename as the replace's last step so a
// scanner holding the file on Windows is retried as every other atomic write here is (io/atomic.mjs).
import * as pure from '../lib/confined-path.mjs';
import { hostPlatform } from '../platform/index.mjs';
import { durableRename } from './atomic.mjs';

export * from '../lib/confined-path.mjs';

/**
 * The owner for an admitted root (admitRun's `dir`, or a directory new-run has just created exclusively).
 *
 * ITS RENAME NEVER REMOVES ITS SOURCE (G-4, G-1 of 20261106-151751-srb-d1-remediation-review): durableRename removes a
 * failed scratch file, which is right for a temporary file and wrong for an owner's rename, whose source is the caller's
 * data: a rotation whose rename failed deleted the live log or the session record it was rotating. The owner's
 * `replace` removes its own temporary file. The rename goes through the owner's platform, as every other operation does.
 */
export const confined = (root, opts = {}) => {
  const io = opts.io ?? hostPlatform();
  const rename = opts.rename ?? ((a, b) => durableRename(a, b, {
    rename: (x, y) => io.fs.renameSync(x, y),
    ...(io.transientRenameCodes ? { transientCodes: io.transientRenameCodes } : {}),
    remove: () => {},
  }));
  return pure.confined({ root, io, rename });
};
