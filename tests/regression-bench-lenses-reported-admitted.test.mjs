// G-3 of 20261029-224143-rdr-remediation-3-review (panel-codex-arch + panel-codex-contract, MEDIUM). bench-lenses decided
// which lenses REPORTED by parsing each status file itself, through an owner built on the raw run spelling it never
// admitted: a replaced or linked run root could make the probe read another run, and `state: "OK"` was accepted with no
// findings_count, so a malformed or silent lens was scored as a miss rather than excluded as not reported. The one strict
// owner is run-artifacts' readNodeStatus, read through the directory admitRun returned.
//
// bench-lenses is an entry script that runs a live benchmark on import, so its shape is read rather than executed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-lenses.mjs'), 'utf8');

test('G-3: whether a lens reported is decided by the strict status owner, not a raw parse', () => {
  const fn = src.slice(src.indexOf('function lensesThatReported'), src.indexOf('async function runSeed'));
  assert.ok(fn.length > 0, 'lensesThatReported not found');
  assert.match(fn, /readNodeStatus\(/, 'the status is not read through readNodeStatus');
  assert.doesNotMatch(fn, /JSON\.parse/, 'the status is still parsed raw, OK accepted with no findings_count');
});

test('G-3: the live seed admits its run directory before reading which lenses reported', () => {
  const seed = src.slice(src.indexOf('async function runSeed'));
  const admit = seed.search(/admitRun\(\{ runDir/);
  const reported = seed.indexOf('lensesThatReported(');
  assert.ok(admit >= 0, 'runSeed never admits the run directory');
  assert.ok(admit < reported, 'the run is read before it is admitted');
  assert.match(seed.slice(admit, reported), /\.dir\b/, 'the admitted directory is not the one read');
});
