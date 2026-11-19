// G-2 and G-4 of 20261029-235315-rdr-remediation-4-review (panel-codex-code, panel-codex-security; MEDIUM).
// G-2: lensesThatReported accepted any OK status without checking its embedded node_id, so a misnamed status could make
// a lens that never reported count as having run, and be scored as a miss rather than NOT RUN.
// G-4: when admitRun refused the run, the finally block still handed the unadmitted spelling to collectRun, reading the
// very directory admission had refused.
//
// bench-lenses is an entry script that runs a live benchmark on import, so its shape is read rather than executed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-lenses.mjs'), 'utf8');

test('G-2: a lens counts as reported only when its status names that lens', () => {
  const fn = src.slice(src.indexOf('function lensesThatReported'), src.indexOf('async function runSeed'));
  assert.ok(fn.length > 0, 'lensesThatReported not found');
  assert.match(fn, /status\.node_id\s*===\s*lens/, 'an OK status is accepted without checking its node_id');
});

test('G-4: the spend fallback reads only a run directory that was admitted', () => {
  const seed = src.slice(src.indexOf('async function runSeed'));
  const fin = seed.slice(seed.indexOf('} finally {'));
  const call = fin.indexOf('collectRun(');
  assert.ok(call >= 0, 'the finally block no longer reads the run');
  assert.match(fin.slice(0, call), /admitRun\(/, 'the finally block reads the run without admitting it');
  assert.doesNotMatch(fin.slice(call, call + 40), /collectRun\(runDir\)/, 'the finally block reads the unadmitted spelling');
});
