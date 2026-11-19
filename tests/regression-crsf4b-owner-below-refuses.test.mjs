// G-7 (and its symptom G-9) of 20261105-074139-crsf-remediation-3-review: ownerBelow re-rooted a folder outside the root
// it was given with confined(abs) rather than refusing it, so no level above that folder was inspected and a claim-check,
// subagent, bench or suite record path outside the repository was read or written. A staged run is read with quorate's
// home as its root instead, so the report still finds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withTempDir } from './helpers.mjs';
import { ownerBelow, writeBenchRecord, readRecords } from '../scripts/io/telemetry-record.mjs';

test('G-7: a folder outside the root is refused, never re-rooted at itself', () => {
  withTempDir((tmp) => {
    const repo = path.join(tmp, 'repo'); const outside = path.join(tmp, 'outside');
    fs.mkdirSync(repo); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'x.json'), '{}');
    assert.throws(() => ownerBelow(outside, repo).exists(['x.json']), (e) => e.code === 'ECONFINED');
    assert.equal(ownerBelow(path.join(repo, 'a'), repo).exists(['x.json']), false, 'a folder inside is still owned');
  });
});

test('G-7: a bench record outside the repository is not written', () => {
  withTempDir((tmp) => {
    const repo = path.join(tmp, 'repo'); const outside = path.join(tmp, 'outside');
    fs.mkdirSync(repo); fs.mkdirSync(outside);
    const results = path.join(outside, '2026-11-05T00-00-00-000Z.json');
    fs.writeFileSync(results, JSON.stringify({ runs: [] }));
    const r = writeBenchRecord(results, { repoRoot: repo, results: { runs: [] } });
    assert.equal(r.ok, false, 'a record was written outside the repository');
    assert.equal(fs.existsSync(path.join(outside, '2026-11-05T00-00-00-000Z.telemetry.json')), false);
  });
});

test('G-9: a staged run root under quorate\'s home is still read, rooted at the home', () => {
  withTempDir((tmp) => {
    const repo = path.join(tmp, 'repo'); const home = path.join(tmp, 'home');
    const root = path.join(home, 'reviews', 'p-1');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(path.join(root, 'r1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'r1', 'telemetry.json'), JSON.stringify({ kind: 'review', run_id: 'r1' }));
    const saved = process.env.QUORATE_HOME;
    process.env.QUORATE_HOME = home;
    try {
      const got = readRecords(repo, { runRoots: [root] });
      assert.deepEqual(got.unreadable, []);
      assert.ok(got.records.some((r) => r.run_id === 'r1'), 'the staged record was not read');
    } finally { if (saved === undefined) delete process.env.QUORATE_HOME; else process.env.QUORATE_HOME = saved; }
  });
});
