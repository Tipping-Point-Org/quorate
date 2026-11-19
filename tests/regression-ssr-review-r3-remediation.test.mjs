// Remediation of review 20260929-162936-ssr-review-r3 (operator, 2026-09-29: "1 fix with B, 2 as suggested, 3 as
// suggested"). Fixed: G-10 (a refused seed still counted), G-8 (--dry-run executing the contract's build command,
// option B), and the LOWs pulled forward: G-12 (an unreadable directory read as absent), G-13 (the node-id refusal
// echoing the status file's node_id).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRun } from '../scripts/io/run-artifacts.mjs';
import { collectRun as pureCollectRun } from '../scripts/lib/run-artifacts.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const BSO = () => fs.readFileSync(path.join(REPO, 'scripts', 'bench-second-opinion.mjs'), 'utf8');
const quiet = { warn: () => {} };

function run(t) {
  const r = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ssr3-'))), 'run');
  t.after(() => fs.rmSync(path.dirname(r), { recursive: true, force: true }));
  fs.mkdirSync(path.join(r, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(r, 'run.json'), JSON.stringify({ run_id: '20260101-000000-x' }));
  return r;
}

// G-10: a seed is counted only after the read that can refuse it.
test('G-10: a seed\'s scored row is pushed only after its run is read, so a refused run is never counted', () => {
  const src = BSO();
  const read = src.indexOf('refused } = collectRun(copy)');
  const row = src.indexOf('rows.push({ seed: c.seed, mutated: scored.mutated.state');
  assert.ok(read > 0 && row > 0, 'the read or the row was not found');
  assert.ok(row > read, 'the scored row is pushed before the read that can throw RunRefused');
});

// G-8, option B: the dry run proves capture would accept the run (its pin and --cwd checks) by asking it to run a
// command the contract does not declare, and requiring the refusal to be for THAT reason. Nothing is executed.
test('G-8: --dry-run executes no contract command, and probes capture with one it must refuse as undeclared', () => {
  const src = BSO();
  const i = src.indexOf('AND ACTUALLY RUN THE EVIDENCE RECORDER');
  const block = src.slice(i, src.indexOf("say(`would rewrite:", i));
  assert.ok(i > 0 && block.length > 0, 'the dry-run probe was not found');
  assert.doesNotMatch(block, /contract\?*\.commands/, 'the dry run still runs a command from the preserved contract');
  assert.match(block, /refusing to execute/, 'the probe does not require the undeclared-command refusal');
});

// G-12: existsSync answers false for a stat error as well as for absence; only absence is absent.
test('G-12: a nodes/ or evidence/ whose stat fails for any reason but absence is refused, not read as absent', (t) => {
  for (const which of ['nodes', 'evidence']) {
    const r = run(t);
    const target = path.join(r, which);
    const h = hostPlatform();
    const io = { ...h, fs: { ...h.fs,
      existsSync: (p) => (path.resolve(String(p)) === target ? false : h.fs.existsSync(p)),
      // A permission error fails lstat as well as stat, and presence() asks lstat first (ssr-review-r4 G-11).
      statSync: (p, ...rest) => {
        if (path.resolve(String(p)) === target) throw Object.assign(new Error(`EACCES: permission denied, stat '${p}'`), { code: 'EACCES' });
        return h.fs.statSync(p, ...rest);
      },
      lstatSync: (p, ...rest) => {
        if (path.resolve(String(p)) === target) throw Object.assign(new Error(`EACCES: permission denied, lstat '${p}'`), { code: 'EACCES' });
        return h.fs.lstatSync(p, ...rest);
      },
    } };
    const c = pureCollectRun(r, { io });
    assert.ok(Object.keys(c.refused).includes(which), `an unreadable ${which}/ read as absent: ${JSON.stringify(c.refused)}`);
    assert.ok(!JSON.stringify(c.refused).includes(r), 'the refusal carries an absolute path');
  }
});

// G-13: the refusal says the identities differ; it does not echo what the file claims to be.
test('G-13: the node-id refusal does not echo the status file\'s node_id', (t) => {
  const r = run(t);
  // A marker with no characters JSON would escape: a Windows path's backslashes are doubled when echoed through
  // JSON.stringify, so searching for the raw path misses the echo.
  const claimed = '/home/SOMEONE-ELSEWHERE/run';
  fs.writeFileSync(path.join(r, 'nodes', 'code-audit.status.json'), JSON.stringify({ node_id: claimed, state: 'OK', findings_count: 0 }));
  const c = collectRun(r, quiet);
  const why = c.refused['status:code-audit'];
  assert.ok(why, `a mismatched status was accepted: ${JSON.stringify(c.refused)}`);
  assert.ok(!why.includes('SOMEONE-ELSEWHERE'), `the refusal echoes the embedded node_id: ${why}`);
});
