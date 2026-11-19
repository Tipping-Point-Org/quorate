// G-4 of 20261110-202954-sfo-remediation-review-c: stdinFrom's once-per-hour sweep remembered only the LAST home it swept
// (`lastSweep.home !== root` swept again), so calls alternating homes A, B, A within the hour swept A twice, past the
// contract's bound of one sweep per home per interval. Now each home keeps its own time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stdinFrom } from '../scripts/io/stdin-file.mjs';

const tmp = (t, p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('G-4: calls alternating two homes within the hour sweep each home once', (t) => {
  const a = tmp(t, 'sfo-home-a-');
  const b = tmp(t, 'sfo-home-b-');
  const swept = [];
  const sweep = ({ home }) => { swept.push(home); return []; };
  for (const home of [a, b, a, b, a]) stdinFrom('p', { home, sweep }).release();
  assert.deepEqual(swept.filter((h) => h === a).length, 1, `home A was swept ${swept.filter((h) => h === a).length} times within one interval`);
  assert.deepEqual(swept.filter((h) => h === b).length, 1, `home B was swept ${swept.filter((h) => h === b).length} times within one interval`);
});
