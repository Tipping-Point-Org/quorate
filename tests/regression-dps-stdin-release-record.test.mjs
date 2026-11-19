// G-8 of 20261110-001436-dps-remediation-review: every stdinFrom call swept the folder of stdin folders synchronously
// before its child was spawned, so N launches enumerated it N times. The sweep now runs at most once per
// STDIN_SWEEP_INTERVAL_MS in a process, for an engine home.
//
// G-9 of the same review: release() swallowed a failed removal of the stdin folder, so when no later call came the
// plaintext prompt stayed on disk with no error and no record. A failed removal is now returned by release(), the folder
// is kept on a list of leftovers, and reportLeftoverStdin, which runs as the process exits, names each folder it still
// cannot remove. (Since stdin-folder-owner.plan.md the folders are below the engine home's `stdin/`.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as stdinFile from '../scripts/io/stdin-file.mjs';

const home = (t) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dps-relrec-'))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('G-8: N calls in one process sweep an engine home\'s stdin folder once, not N times', (t) => {
  const h = home(t);
  let sweeps = 0;
  const sweep = () => { sweeps += 1; return []; };
  for (let i = 0; i < 3; i++) stdinFile.stdinFrom('text', { home: h, sweep }).release();
  assert.equal(sweeps, 1, `the stdin folder was swept ${sweeps} times for three calls`);
});

test('G-9: a removal release() could not make is returned, kept, and named when the process exits', (t) => {
  const h = home(t);
  const refuse = () => { const e = new Error('EBUSY: resource busy or locked'); e.code = 'EBUSY'; throw e; };
  const s = stdinFile.stdinFrom('a prompt', { home: h, rm: refuse, sweep: () => [] });
  const r = s.release();
  try {
    assert.equal(r?.removed, false, 'a failed removal of the stdin folder left no record');
    assert.ok(typeof r.dir === 'string' && r.dir.length, 'the folder left behind is not named');
    const lines = [];
    stdinFile.reportLeftoverStdin({ rm: refuse, write: (l) => lines.push(l) });
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes(r.dir), `the leftover folder is not named: ${lines[0]}`);
    assert.ok(!lines[0].includes('a prompt'), 'the prompt text itself was written out');
  } finally {
    stdinFile.reportLeftoverStdin({ write: () => {} });
  }
});
