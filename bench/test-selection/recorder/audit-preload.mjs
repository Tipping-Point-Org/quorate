// audit-preload.mjs — candidate 4: node's Permission Model in audit mode as the recorder (test-selection-exploration.md).
//
// Passed to every process through NODE_OPTIONS together with --permission-audit (node >= 24.20). With no grants, every
// file access is a "violation", published on the diagnostics channel `node:permission-model:fs` with the file as
// `resource` and nothing denied. Probed 2026-10-27 on 24.22.1: module loads and fs reads are both reported, in the
// parent and in a child spawned with the inherited NODE_OPTIONS; a process's own entry script is NOT (entry points are
// implicitly readable), so it is recorded here from argv, as preload.mjs does. Windows paths arrive as `\\?\C:\...`.
// Writes are skipped: an output is not a dependency.
import dc from 'node:diagnostics_channel';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.TS_RECORD_DIR;
if (dir) {
  if (!process.env.TS_TEST_FILE && /\.test\.mjs$/.test(process.argv[1] ?? '')) process.env.TS_TEST_FILE = path.resolve(process.argv[1]);
  const test = process.env.TS_TEST_FILE ?? null;
  const outFile = path.join(dir, `audit-${process.pid}.jsonl`);
  const seen = new Set();
  const note = (file) => {
    if (!test || !file || seen.has(file)) return;
    seen.add(file);
    try { fs.appendFileSync(outFile, `${JSON.stringify({ test, kind: 'read', file })}\n`); } catch { /* a lost record shows as a miss */ }
  };
  const clean = (p) => String(p).replace(/^\\\\\?\\/, '');
  if (process.argv[1]) note(path.resolve(process.argv[1]));
  dc.channel('node:permission-model:fs').subscribe((m) => {
    if (m?.permission === 'FileSystemRead' && typeof m.resource === 'string') note(clean(m.resource));
  });
}
