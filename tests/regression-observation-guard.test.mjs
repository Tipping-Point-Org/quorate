// .claude/requests/observation-guard-and-sibling-census.md, part A: `--add` refuses to land a note on a DECIDED entry.
// A note on a closed entry, a pending claim or a standing decision used to be appended and reported afterwards ("noted
// on the CLOSED entry"), or not at all — four encounters on 2026-10-15 (.claude/findings/2026-10-15-ledger-bucket-
// collisions.md), one by the person documenting the limit. The refusal names the entry; `--onto <key>` attaches on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));

const entry = (key, line, extra) => ({
  key, file: 'a.mjs', line, severity: 'HIGH', status: 'open', first_seen: 'r0', last_seen: 'r0', times_seen: 1,
  claim: `the claim at ${line}`, nodes: ['code-audit'], ...extra,
});
const DECIDED = {
  closed: entry('a.mjs:40', 41, { status: 'closed', closed_by: 'operator', closed_in: 'r1' }),
  claimed: entry('a.mjs:40', 41, { status: 'partial', claimed_in: 'r1', claimed_from: 'open' }),
  deferred: entry('a.mjs:40', 41, { deferred_in: 'r1', decisions: [{ transition: 'T11', by: 'agent', run: 'r1', at: '2026-10-01T00:00:00.000Z', groups: ['G-2'] }] }),
};

function ledgerWith(t, entries) {
  const repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-obsguard-repo-')));
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-obsguard-home-')));
  t.after(() => { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  const ledgerPath = path.join(repo, '.claude', 'reviews', 'ledger.json');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify({ schema_version: 1, runs_folded: [], entries }));
  const add = (line, ...extra) => spawnSync(process.execPath,
    [CLI, '--add', '--file', 'a.mjs', '--line', String(line), '--claim', 'a different defect', '--ledger', ledgerPath, ...extra],
    { encoding: 'utf8', cwd: repo, env: { ...process.env, QUORATE_HOME: home } });
  return { ledgerPath, add, bytes: () => fs.readFileSync(ledgerPath, 'utf8') };
}

for (const [kind, e] of Object.entries(DECIDED)) {
  for (const line of [45, 51]) {   // 45: the entry's own bucket; 51: the next bucket, within 10 lines of 41
    test(`AC1: a note at line ${line} that would join a ${kind} entry is refused, the entry named, the ledger untouched`, (t) => {
      const { add, bytes } = ledgerWith(t, { [e.key]: e });
      const before = bytes();
      const r = add(line);
      assert.equal(r.status, 1, `exit ${r.status}; the note was taken: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /a\.mjs:40/, 'the refusal does not name the entry');
      assert.match(r.stderr, /--onto a\.mjs:40/, 'the refusal does not offer --onto');
      assert.equal(bytes(), before, 'the ledger changed');
    });
  }
}

test('AC2: --onto naming the entry the note resolves to attaches it, as today', (t) => {
  const { add, ledgerPath } = ledgerWith(t, { 'a.mjs:40': DECIDED.closed });
  const r = add(45, '--onto', 'a.mjs:40');
  assert.equal(r.status, 0, r.stderr);
  const e = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).entries['a.mjs:40'];
  assert.equal(e.observations?.length, 1);
  assert.equal(e.status, 'closed', 'an attached note changed the decided entry');
});

test('AC2: --onto naming another key is refused and changes nothing', (t) => {
  const { add, bytes } = ledgerWith(t, { 'a.mjs:40': DECIDED.closed });
  const before = bytes();
  const r = add(45, '--onto', 'a.mjs:90');
  assert.equal(r.status, 1, r.stdout);
  assert.equal(bytes(), before);
});

test('AC3: a note joining an open, undecided entry, or opening a new one, is taken as today', (t) => {
  const { add, ledgerPath } = ledgerWith(t, { 'a.mjs:40': entry('a.mjs:40', 41) });
  assert.equal(add(45).status, 0, 'a note on an open entry was refused');
  assert.equal(add(200).status, 0, 'a note opening an entry was refused');
  const entries = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).entries;
  assert.equal(entries['a.mjs:40'].observations?.length, 1);
  assert.ok(entries['a.mjs:200'], 'no entry was opened');
});
