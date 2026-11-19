// findings-ledger reads ledger.json through the owner (usage-report-followup.plan.md stage 3).
//
// G-9 of 20261031-055840-urr-remediation-3-review: loadLedger read ledger.json with raw fs, so a link standing at it was
// followed outside the reviews folder, and a parse error quoted the linked file's bytes. It is read through an owner rooted
// at the ledger's folder: a link is refused and named, and nothing of the linked file is printed.
//
// No portable fixture makes a link on every host (this one refuses symlinks), so a preload makes the platform report one
// at ledger.json, and serve outside bytes to a raw read: regression-usage-report-inputs' technique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SCRIPTS_DIR } from './helpers.mjs';

test('G-9: a link at ledger.json is refused and named, and its bytes are never printed', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-read-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledger = path.join(dir, 'ledger.json');
  fs.writeFileSync(ledger, JSON.stringify({ schema_version: 1, entries: {} }));
  const pre = path.join(dir, 'preload.mjs');
  fs.writeFileSync(pre, ["import fs from 'node:fs';", "import { syncBuiltinESMExports } from 'node:module';",
    "const hit = (x) => String(x).endsWith('ledger.json');",
    'const lstat = fs.lstatSync, read = fs.readFileSync;',
    'fs.lstatSync = (x, ...a) => { const st = lstat(x, ...a); if (hit(x)) st.isSymbolicLink = () => true; return st; };',
    "fs.readFileSync = (x, ...a) => hit(x) ? 'SECRET-BYTES-OUTSIDE' : read(x, ...a);",
    'syncBuiltinESMExports();', ''].join('\n'));
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(pre).href, path.join(SCRIPTS_DIR, 'findings-ledger.mjs'),
    '--summary', '--ledger', ledger], { encoding: 'utf8', env: { ...process.env, QUORATE_HOME: path.join(dir, 'home') } });
  assert.notEqual(r.status, 0, 'a linked ledger was read as a ledger');
  assert.doesNotMatch(r.stdout + r.stderr, /SECRET-BYTES-OUTSIDE/, 'the linked file\'s bytes were printed');
  assert.match(r.stderr, /refused|link/, r.stderr);
});

// G-8 of 20261102-201017-rbr-remediation-3-review: loadLedger resolved the ledger's folder with realpathSync before
// handing it to the owner, so a link or junction at that folder was followed and the owner's root check (G-10 of
// 20261102-184751-rbr-remediation-2-review) never saw it. The folder named by --ledger is now the owner's root as given.
test('G-8: a link or junction at the --ledger folder is refused, not resolved away before the root check', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-root-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'ledger.json'), JSON.stringify({ schema_version: 1, entries: {} }));
  const linked = path.join(dir, 'linked');
  fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'findings-ledger.mjs'), '--summary', '--ledger',
    path.join(linked, 'ledger.json')], { encoding: 'utf8', env: { ...process.env, QUORATE_HOME: path.join(dir, 'home') } });
  assert.notEqual(r.status, 0, `a ledger behind a linked folder was read as a ledger: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /refused/, r.stderr);
  assert.match(r.stderr, /link or junction/, r.stderr);
});

// G-5 of 20261102-211111-rbr-remediation-4-review: a refused --mark-fixed applied nothing, but saveLedger still ran before
// the refusal's exit, rewriting ledger.json (its bytes re-serialized, its mtime moved) where the contract says a refused
// disposition leaves the ledger unchanged. A refusal now writes nothing.
test('G-5: a refused --mark-fixed leaves ledger.json byte-for-byte untouched', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-refused-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledger = path.join(dir, 'ledger.json');
  const run = '20260901-120000-r';
  // Compact on purpose: saveLedger writes indented JSON, so any rewrite changes these bytes.
  const bytes = JSON.stringify({ schema_version: 1, runs_folded: [], entries: { 'a.mjs:0': { key: 'a.mjs:0', file: 'a.mjs',
    line: 5, severity: 'MEDIUM', status: 'declined', decided_by: 'operator', operator_quote: 'no', reason: 'r',
    first_seen: run, last_seen: run, times_seen: 1, claim: 'x', nodes: ['code-audit'] } } });
  fs.writeFileSync(ledger, bytes);
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'findings-ledger.mjs'), '--mark-fixed', 'a.mjs:0', '--ledger', ledger,
    '--disposition', 'fixed_claimed', '--reason', 'claimed'], { encoding: 'utf8', cwd: dir, env: { ...process.env, QUORATE_HOME: path.join(dir, 'home') } });
  assert.notEqual(r.status, 0, `an agent's claim on an operator's decline was not refused: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /refused/, r.stderr);
  assert.equal(fs.readFileSync(ledger, 'utf8'), bytes, 'a refused disposition rewrote ledger.json');
});
