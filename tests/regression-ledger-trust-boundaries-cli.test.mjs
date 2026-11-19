// ledger-trust-boundaries, stage 1 — the CLI half (plan: .claude/requests/ledger-trust-boundaries.plan.md).
// G-3 — the convergence floor is never silently HIGH when the contract cannot say what it is.
// The (manual <ISO>) run id — a disposition without --run-dir is dated, unique, and never the newest cycle.
// G-4 — a child run directory that cannot be inspected stops the unfolded-run listing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { convergence } from '../scripts/lib/ledger.mjs';

const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });

function tmp(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ltb-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
const contract = (extra = '') => `# x\n\n\`\`\`yaml\ngraph_contract_version: 5\nproject: p\n${extra}\`\`\`\n`;
const summary = (d) => spawnSync(process.execPath, [CLI, '--summary', '--ledger', path.join(d, 'l.json')], { encoding: 'utf8', cwd: d });

// ------------------------------------------------------------------------------------------------ G-3
test('G-3: a declared floor that is not a severity is refused by name, not read as HIGH', (t) => {
  const d = tmp(t);
  git(d, 'init', '-q');
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), contract('review:\n  convergence_floor: MEDIUMM\n'));
  const r = summary(d);
  assert.notEqual(r.status, 0, 'a misspelt floor was silently replaced with HIGH');
  assert.match(r.stderr, /MEDIUMM/);
});

test('G-3: a contract that cannot be resolved makes the floor unknown, and --summary refuses', (t) => {
  const d = tmp(t);
  git(d, 'init', '-q');
  // Two locations whose blocks disagree: new-run refuses rather than choose (CLAUDE.md, "Graph verification contract").
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), contract('review:\n  convergence_floor: MEDIUM\n'));
  fs.mkdirSync(path.join(d, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(d, '.claude', 'rules', 'quorate-contract.md'), contract('review:\n  convergence_floor: LOW\n'));
  const r = summary(d);
  assert.notEqual(r.status, 0, 'an unresolvable contract was read as the HIGH default');
  assert.match(r.stderr, /floor/i);
  assert.match(r.stderr, /unknown|cannot/i);
});

test('G-3: a repository with no contract keeps the documented HIGH default (pins existing behaviour)', (t) => {
  const d = tmp(t);
  git(d, 'init', '-q');
  const r = summary(d);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /HIGH/);
});

// ------------------------------------------------------------------------------------ (manual <ISO>)
function ledgerWithOneEntry(d) {
  const run = '20260901-000000-review';
  const l = { schema_version: 1, runs_folded: [run], entries: { 'a.mjs:0': {
    key: 'a.mjs:0', file: 'a.mjs', line: 5, severity: 'MEDIUM', status: 'open', first_seen: run, last_seen: run,
    times_seen: 1, claim: 'x', nodes: ['code-audit'], at: '2026-09-01T00:00:00.000Z' } } };
  fs.writeFileSync(path.join(d, 'l.json'), JSON.stringify(l));
  return run;
}
const markFixed = (d, ...args) => spawnSync(process.execPath, [CLI, '--mark-fixed', 'a.mjs:0', '--ledger', path.join(d, 'l.json'), ...args], { encoding: 'utf8', cwd: d });

test('a disposition without --run-dir records a dated (manual <ISO>) run, distinct each time', (t) => {
  const d = tmp(t);
  ledgerWithOneEntry(d);
  let r = markFixed(d, '--disposition', 'open', '--reason', 'deferred once');
  assert.equal(r.status, 0, r.stderr);
  r = markFixed(d, '--disposition', 'open', '--reason', 'deferred twice');
  assert.equal(r.status, 0, r.stderr);
  const e = JSON.parse(fs.readFileSync(path.join(d, 'l.json'), 'utf8')).entries['a.mjs:0'];
  const runs = (e.decisions ?? []).map((x) => x.run);
  assert.equal(runs.length, 2, 'the two deferrals were not both recorded');
  for (const id of runs) assert.match(id, /^\(manual \d{4}-\d{2}-\d{2}T/, `undated or bare manual id: ${id}`);
  assert.notEqual(runs[0], runs[1], 'two manual deferrals share one id');
});

test('a claim made without --run-dir never becomes the newest review cycle (G-19 not reintroduced)', (t) => {
  const d = tmp(t);
  const run = ledgerWithOneEntry(d);
  const r = markFixed(d, '--disposition', 'fixed_claimed', '--reason', 'fixed by hand');
  assert.equal(r.status, 0, r.stderr);
  const l = JSON.parse(fs.readFileSync(path.join(d, 'l.json'), 'utf8'));
  assert.match(l.entries['a.mjs:0'].claimed_in, /^\(manual /);
  assert.equal(convergence(l, { floor: 'MEDIUM' }).newest_run, run);
});

// ------------------------------------------------------------------------------------------------ G-4
test('G-4: a child run directory whose run.json cannot be inspected stops the listing (POSIX: a looping link)', { skip: process.platform === 'win32' && 'a symlink loop needs a privilege this platform does not grant' }, (t) => {
  const d = tmp(t);
  git(d, 'init', '-q');
  const child = path.join(d, 'reviews', '20260901-000000-x');
  fs.mkdirSync(child, { recursive: true });
  fs.symlinkSync('run.json', path.join(child, 'run.json'));   // run.json -> itself: ELOOP, not ENOENT
  const r = spawnSync(process.execPath, [CLI, '--summary', '--ledger', path.join(d, 'reviews', 'ledger.json')], { encoding: 'utf8', cwd: d });
  assert.notEqual(r.status, 0, 'an uninspectable run directory was read as not a run');
  assert.match(r.stderr, /ELOOP|cannot/i);
});
