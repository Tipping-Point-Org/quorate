// The telemetry-record groups of review 20261105-061926-crsf-remediation-review (contract-runtime-and-session-files.plan.md):
// the suite reporter's lines file was confined from its own folder, not from the repository (intent.md, criterion on
// telemetry records: "The root is the repository"). Each test names its group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');

// G-7: writeSuiteRecord read the lines file through confined(path.dirname(linesFile)), so a link at a folder between the
// repository and the file's own folder (tests/ above tests/run/) was followed and an outside file read as the suite's lines.
test('G-7: the suite reporter\'s lines are not read through a link above the file inside the repository', async () => {
  const { writeSuiteRecord } = await import('../scripts/io/telemetry-record.mjs');
  const base = tmp('crsf2-g7-');
  try {
    const repo = path.join(base, 'repo'); const outside = path.join(base, 'outside');
    fs.mkdirSync(repo); fs.mkdirSync(path.join(outside, 'run'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'run', 'lines.jsonl'), `${JSON.stringify({ event: 'file', file: path.join(repo, 'tests', 'a.test.mjs'), duration_ms: 5 })}\n`);
    link(outside, path.join(repo, 'tests'));
    const r = writeSuiteRecord(repo, { linesFile: path.join(repo, 'tests', 'run', 'lines.jsonl'), startedAt: 1, endedAt: 2, exitCode: 0 });
    assert.equal(r.ok, false, `the lines file was read through the link at tests/: ${JSON.stringify(r)}`);
    assert.match(r.note, /link|junction/, r.note);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// G-7 of 20261105-070121-crsf-remediation-2-review (panel-codex-code): the repository-relative check refused every path
// whose first name merely began with `..`, so a test file under `..fixtures/` had no file identity and left the record.
test('G-7: a test file under a folder whose name begins with .. keeps its identity; one outside the repository does not', async () => {
  const { writeSuiteRecord } = await import('../scripts/io/telemetry-record.mjs');
  const base = tmp('crsf3-g7-');
  try {
    const repo = path.join(base, 'repo');
    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    const lines = path.join(repo, 'tests', 'lines.jsonl');
    fs.writeFileSync(lines, [
      { event: 'file', file: path.join(repo, '..fixtures', 'a.test.mjs'), duration_ms: 5 },
      { event: 'file', file: path.join(base, 'elsewhere', 'b.test.mjs'), duration_ms: 5 },
    ].map((e) => JSON.stringify(e)).join('\n') + '\n');
    const r = writeSuiteRecord(repo, { linesFile: lines, startedAt: 1, endedAt: 2, exitCode: 0 });
    assert.equal(r.ok, true, r.note);
    const rec = fs.readFileSync(r.path, 'utf8');
    assert.match(rec, /"\.\.fixtures\/a\.test\.mjs"/, 'a file under ..fixtures/ lost its identity');
    assert.doesNotMatch(rec, /b\.test\.mjs/, 'a file outside the repository was given an identity');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
