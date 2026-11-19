// capture-containment-fixture.mjs — the run-directory helper regression-capture-containment.test.mjs and its sibling
// regression-capture-containment-hang.test.mjs share, moved out unchanged when the file was split (split-slow-test-files.md).

import fs from 'node:fs';
import { repoRunDir } from './helpers.mjs';

// INSIDE THE REPOSITORY, because that is where a real run directory is: new-run refuses a
// reviews_dir that leaves the tree, and capture now refuses a --run-dir that is not under the
// repository it is running in — a directory carrying its own self-consistent run.json is not
// authority for where it may be (G-6). The old fixture built its run under os.tmpdir(), which no
// real caller does, and it would now be refused for the right reason.
function inRun(fn) {
  const { base, dir } = repoRunDir({ runId: 'containment', prefix: 'quorate-contain-' });
  try { return fn(dir, base); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

export { inRun };
