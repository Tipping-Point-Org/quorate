// The node runtime's binary override was spelled `--claude-bin` in every entry script that takes it, a vendor's name in a
// generic seam (ARCHITECTURE A-9), and only spawn-subagent also took `--runtime-bin`; a ledger note kept the old spelling
// "for fixtures". The operator decided (2026-11-11, "A. Rename, keep an alias (Recommended)", panel decision
// 20261111-172326-aaa7f7): `--runtime-bin` in every script, `--claude-bin` kept for one release as an alias that warns
// once per process naming the new flag, and one owner for the pair (lib/argv-specs.mjs, read through io/runtime-bin.mjs)
// rather than a copy per script. The alias was REMOVED in 0.3.0 (operator, 2026-11-13: "0.3.0, remove the alias
// (Recommended)"): it is refused, naming --runtime-bin. Held here: the owner's rule, every spec taking --runtime-bin, the
// refusal end to end, and a census that no script or test spells the old flag in code outside the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ARGV_SPECS, runtimeBinFrom, RUNTIME_BIN_FLAG, RUNTIME_BIN_ALIAS } from '../scripts/lib/argv-specs.mjs';
import { REPO_ROOT, SCRIPTS_DIR } from './helpers.mjs';

test('the owner reads --runtime-bin, and refuses the removed --claude-bin naming the flag that replaced it', () => {
  assert.equal(RUNTIME_BIN_FLAG, 'runtime-bin');
  assert.equal(RUNTIME_BIN_ALIAS, 'claude-bin');
  assert.deepEqual(runtimeBinFrom({ 'runtime-bin': '/a' }), { bin: '/a' });
  assert.deepEqual(runtimeBinFrom({}), { bin: null });
  assert.throws(() => runtimeBinFrom({ 'claude-bin': '/a' }), /--claude-bin was renamed --runtime-bin in 0\.3\.0/);
  assert.throws(() => runtimeBinFrom({ 'runtime-bin': '/a', 'claude-bin': '/a' }), /renamed --runtime-bin/);
});

test('every entry script that takes the alias takes --runtime-bin too, from the one shared pair', () => {
  const takers = Object.entries(ARGV_SPECS).filter(([, s]) => s.options && ('claude-bin' in s.options || 'runtime-bin' in s.options));
  assert.ok(takers.length >= 8, `fewer scripts take the override than before: ${takers.map(([n]) => n)}`);
  // G-7 of 20261111-184046-runtime-bin-delivery: bench-repair-pass took its own --node-bin and neither spelling.
  assert.ok(takers.some(([n]) => n === 'bench-repair-pass'), 'bench-repair-pass does not take --runtime-bin');
  assert.equal(ARGV_SPECS['bench-repair-pass'].options['node-bin'], undefined, 'bench-repair-pass keeps a third spelling');
  for (const [name, s] of takers) {
    assert.equal(s.options['runtime-bin'], 'string', `${name} does not take --runtime-bin`);
    // Kept in the spec so that its refusal names the new spelling; an unknown-flag error would not.
    assert.equal(s.options['claude-bin'], 'string', `${name} lost the spelling its refusal names`);
  }
});

test('the wrapper returns the override, and refuses the removed alias', async () => {
  const { runtimeBinArg } = await import('../scripts/io/runtime-bin.mjs');
  assert.equal(runtimeBinArg({ 'runtime-bin': '/x' }), '/x');
  assert.equal(runtimeBinArg({}), null);
  assert.throws(() => runtimeBinArg({ 'claude-bin': '/x' }), /renamed --runtime-bin/);
});

// End to end: spawn-subagent given --claude-bin refuses, naming the new flag, before anything runs; --runtime-bin runs the fake.
test('end to end: --claude-bin is refused naming --runtime-bin; --runtime-bin reaches the fake runtime', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-bin-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'fake.mjs');
  fs.writeFileSync(bin, "import fs from 'node:fs';\ntry { fs.readFileSync(0); } catch {}\nprocess.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '{\"ok\":true}' }));\n");
  fs.writeFileSync(path.join(dir, 'p.md'), 'hello');
  const env = { ...process.env };
  delete env.GRAPH_NODE_DEPTH;
  const run = (flag) => spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'spawn-subagent.mjs'), '--prompt-file', path.join(dir, 'p.md'),
    '--out', path.join(dir, `e-${flag}.json`), '--repo-root', REPO_ROOT, `--${flag}`, bin], { encoding: 'utf8', env });
  const old = run('claude-bin');
  assert.notEqual(old.status, 0, 'the removed alias was accepted');
  assert.match(old.stderr, /--claude-bin was renamed --runtime-bin in 0\.3\.0/);
  assert.ok(!fs.existsSync(path.join(dir, 'e-claude-bin.json')), 'a refused call wrote an envelope');
  const now = run('runtime-bin');
  assert.equal(now.status, 0, now.stderr);
  assert.doesNotMatch(now.stderr, /deprecated/);
});

// G-5 of 20261111-184046-runtime-bin-delivery: an empty override was accepted (and warned about), then dropped by every
// forwarder's truthiness check, so the child ran the adapter's real runtime. The owner refuses it, in either spelling,
// so no reader downstream can keep or drop it differently.
test('an empty override is refused by the owner, never read as no override', () => {
  assert.throws(() => runtimeBinFrom({ 'runtime-bin': '' }), /--runtime-bin.*empty/);
  assert.throws(() => runtimeBinFrom({ 'claude-bin': '' }), /renamed --runtime-bin/, 'the removed alias, even empty, is refused as removed');
});

// G-10 of 20261111-184046-runtime-bin-delivery: `override ?? adapter cmd` was copied into spawn-node, spawn-subagent and
// check-intent-grant. One owner resolves it (lib/argv-specs.mjs runtimeCommand); no script spells the resolution itself.
test('the override is resolved against the adapter command in one owner, not copied per script', async () => {
  const specs = await import('../scripts/lib/argv-specs.mjs');
  assert.equal(typeof specs.runtimeCommand, 'function', 'no owner resolves the override against the adapter command');
  assert.equal(specs.runtimeCommand('/fake.mjs', 'claude'), '/fake.mjs');
  assert.equal(specs.runtimeCommand(null, 'claude'), 'claude');
  const hits = [];
  for (const f of fs.readdirSync(SCRIPTS_DIR)) {
    if (!/\.mjs$/.test(f)) continue;
    fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8').split(/\r?\n/).forEach((l, i) => {
      if (/runtimeBin\s*\?\?/.test(l.replace(/\/\/.*$/, ''))) hits.push(`scripts/${f}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(hits, [], 'a script resolves the override itself');
});

// G-4 of 20261111-184046-runtime-bin-delivery: check-intent-grant rethrew the owner's conflict error (not an ArgvError), so
// two disagreeing spellings crashed with a stack trace and exit 1 where every other script refuses with exit 2.
test('check-intent-grant refuses the removed alias with exit 2, not a crash', () => {
  const env = { ...process.env };
  delete env.GRAPH_NODE_DEPTH;
  delete env.QUORATE_LIVE;
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'check-intent-grant.mjs'), '--runtime-bin', '/a', '--claude-bin', '/b'],
    { encoding: 'utf8', env, cwd: REPO_ROOT });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^check-intent-grant: --claude-bin was renamed --runtime-bin/m);
  assert.doesNotMatch(r.stderr, /\n\s+at /, 'a stack trace');
});

// THE CENSUS: the old spelling in code only in its owner, the wrapper that warns, and this file. A script that reads or
// passes `--claude-bin`, or a test that hands it to a script, fails here; they use --runtime-bin. A comment may still
// name the old spelling as history; code may not.
test('census: no script or test spells --claude-bin in code outside the owner', () => {
  const allowed = new Set(['scripts/lib/argv-specs.mjs', 'scripts/io/runtime-bin.mjs', 'tests/regression-runtime-bin-rename.test.mjs']);
  const hits = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'fixtures') walk(r); continue; }
      if (!/\.(mjs|js|cjs)$/.test(e.name) || allowed.has(r)) continue;
      fs.readFileSync(path.join(REPO_ROOT, r), 'utf8').split(/\r?\n/).forEach((l, i) => {
        const code = l.replace(/\/\/.*$/, '').trim();
        if (/^\*/.test(code) || /^\/\*/.test(code)) return;
        if (/claude-bin|claudeBin/.test(code)) hits.push(`${r}:${i + 1}: ${l.trim().slice(0, 140)}`);
      });
    }
  };
  walk('scripts');
  walk('tests');
  assert.deepEqual(hits, [], 'the old spelling in code outside its owner');
});
