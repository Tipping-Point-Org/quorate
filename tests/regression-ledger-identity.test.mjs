// The ledger folds what the gate confirmed, at the severity it confirmed (.claude/requests/ledger-identity.plan.md,
// approved 2026-10-12: "Approve, start (Recommended)"; plan-review PASS on round 13). The defect: the fold read raw node
// findings, so a confirmed HIGH whose raising node said MEDIUM landed as MEDIUM in an unrelated, operator-declined
// MEDIUM entry of the same ten-line bucket and stayed hidden
// (.claude/findings/2026-10-12-ledger-absorbs-a-high-into-a-declined-entry.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeLink } from './helpers.mjs';
import { readReconcileArtifacts, collectRun } from '../scripts/io/run-artifacts.mjs';
import { sightingsFromReconcile, mergeRun, markFixed, isOpen, convergence, entryNotes, migrateIdentity } from '../scripts/lib/ledger.mjs';

const RUN = '20261012-054024-test-cost-review';
const member = (node_id, severity, claim = `${node_id} says ${severity}`) => ({ node_id, severity, claim });
const group = (group_id, file, line, findings) => ({ group_id, file, line, findings });
const row = (group_id, decision, severity, extra = {}) => ({ group_id, decision, severity, ...extra });
const sight = (groups, rows) => sightingsFromReconcile(RUN, { groups: { run_id: RUN, groups }, payload: rows && { groups: rows } });

// ---------------------------------------------------------------------------------------------- stage 2

test('stage 2: a reconciler-raised HIGH whose raising node said MEDIUM is a HIGH sighting (the 2026-10-12 defect)', () => {
  const r = sight([group('G-1', 'scripts/io/snapshot.mjs', 102, [member('panel-codex-contract', 'MEDIUM')])],
    [row('G-1', 'confirmed', 'HIGH')]);
  assert.equal(r.ok, true, r.why);
  assert.equal(r.sightings.length, 1);
  assert.equal(r.sightings[0].severity, 'HIGH');
  assert.deepEqual(
    { file: r.sightings[0].file, line: r.sightings[0].line, group_id: r.sightings[0].group_id, run_id: r.sightings[0].run_id },
    { file: 'scripts/io/snapshot.mjs', line: 102, group_id: 'G-1', run_id: RUN });
});

test('stage 2: a dropped or coincidence group yields no sighting; a symptom does, carrying its root', () => {
  const r = sight([
    group('G-1', 'a.mjs', 10, [member('code-audit', 'HIGH')]),
    group('G-2', 'a.mjs', 50, [member('code-audit', 'MEDIUM')]),
    group('G-3', 'b.mjs', 5, [member('arch-review', 'LOW')]),
    group('G-4', 'c.mjs', 7, [member('arch-review', 'LOW')]),
  ], [row('G-1', 'dropped', 'HIGH'), row('G-2', 'coincidence', 'MEDIUM'), row('G-3', 'symptom', 'LOW', { root_cause_group: 'G-4' }), row('G-4', 'confirmed', 'MEDIUM')]);
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.sightings.map((s) => [s.group_id, s.decision, s.root_cause_group ?? null]),
    [['G-3', 'symptom', 'G-4'], ['G-4', 'confirmed', null]]);
});

test('stage 2: nodes are every member, arms included; the claim is the highest-severity member, ties to the first', () => {
  const r = sight([group('G-1', 'a.mjs', 10, [
    member('code-audit', 'MEDIUM', 'first medium'), member('panel-codex-code', 'HIGH', 'the high'),
    member('security-audit', 'HIGH', 'second high'), member('code-audit', 'LOW', 'dup node'),
  ])], [row('G-1', 'confirmed', 'MEDIUM')]);
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.sightings[0].nodes, ['code-audit', 'panel-codex-code', 'security-audit']);
  assert.equal(r.sightings[0].claim, 'the high');
  assert.equal(r.sightings[0].severity, 'MEDIUM', 'the severity is the payload\'s, not the members\'');
});

// reconcile-missing-groups.plan.md stage 2 (operator, 2026-10-23: "C"): this refused the whole fold, while the gate
// named the gap and kept the rest. A group the payload did not judge is now a sighting of its own, `unjudged`, at the
// highest severity among its findings, with that finding's claim: never silence, and never a judged severity.
test('stage 2: a payload judging fewer groups than were formed folds; each unjudged group is an unjudged sighting', () => {
  const r = sight([group('G-1', 'a.mjs', 10, [member('x', 'LOW')]),
    group('G-2', 'a.mjs', 90, [member('x', 'LOW'), member('y', 'HIGH', 'y says the higher thing')])],
  [row('G-1', 'confirmed', 'LOW')]);
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.unjudged, ['G-2']);
  const g2 = r.sightings.find((s) => s.group_id === 'G-2');
  assert.equal(g2.decision, 'unjudged');
  assert.equal(g2.severity, 'HIGH', 'the highest severity among its findings');
  assert.equal(g2.claim, 'y says the higher thing');
  assert.equal(r.sightings.find((s) => s.group_id === 'G-1').decision, 'confirmed');
});

test('stage 2: an unjudged sighting opens an entry marked unjudged; a later judged sighting clears the mark', () => {
  const unjudged = sight([group('G-1', 'scripts/q.mjs', 40, [member('x', 'MEDIUM')])], []);
  assert.equal(unjudged.ok, true);
  let ledger = mergeRun(empty(), { run_id: RUN, at: '2026-10-23T00:00:00Z', sightings: unjudged.sightings, reviewed: true }).ledger;
  const [key] = Object.keys(ledger.entries);
  assert.equal(ledger.entries[key].unjudged, true);
  assert.ok(isOpen(ledger.entries[key]));
  const LATER = '20261024-000000-later-review';
  const judged = sightingsFromReconcile(LATER, { groups: { run_id: LATER, groups: [group('G-1', 'scripts/q.mjs', 40, [member('x', 'MEDIUM')])] },
    payload: { groups: [row('G-1', 'confirmed', 'MEDIUM')] } });
  ledger = mergeRun(ledger, { run_id: LATER, at: '2026-10-24T00:00:00Z', sightings: judged.sightings, reviewed: true }).ledger;
  assert.equal(ledger.entries[key].unjudged, undefined, 'a judged sighting clears the mark');
});

test('stage 2: groups present and no payload refuses; zero groups and no payload folds as silence', () => {
  assert.equal(sight([group('G-1', 'a.mjs', 10, [member('x', 'LOW')])], null).ok, false);
  const r = sight([], null);
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.sightings, []);
});

test('stage 2: a payload row whose decision or severity is not one the gate uses is refused, not guessed', () => {
  assert.equal(sight([group('G-1', 'a.mjs', 1, [member('x', 'LOW')])], [row('G-1', 'maybe', 'LOW')]).ok, false);
  assert.equal(sight([group('G-1', 'a.mjs', 1, [member('x', 'LOW')])], [row('G-1', 'confirmed', 'SEVERE')]).ok, false);
});

test('stage 2: sightings come in numeric group order (G-9 before G-10)', () => {
  const gs = ['G-10', 'G-9', 'G-2'].map((id, i) => group(id, 'a.mjs', 100 * (i + 1), [member('x', 'LOW')]));
  const r = sight(gs, gs.map((g) => row(g.group_id, 'confirmed', 'LOW')));
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.sightings.map((s) => s.group_id), ['G-2', 'G-9', 'G-10']);
});

// ---------------------------------------------------------------------------------------------- stage 3

const F = 'scripts/io/snapshot.mjs';
const KEY = `${F}:90`;
const at = (run) => { const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(run); return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`; };
const S = (run, gid, line, severity, extra = {}) => ({ run_id: run, group_id: gid, file: F, line, severity, decision: 'confirmed', claim: `${gid} of ${run}`, nodes: ['code-audit'], ...extra });
const fold = (ledger, run, sightings, extra = {}) => mergeRun(ledger, { run_id: run, at: at(run), sightings, surface: ['scripts'], reviewed: true, okNodes: new Set(['code-audit']), ...extra });
const empty = () => ({ schema_version: 1, runs_folded: [], entries: {} });
const declined = (extra = {}) => ({ schema_version: 1, runs_folded: ['20261003-000000-decl'], entries: { [KEY]: {
  key: KEY, file: F, line: 94, severity: 'MEDIUM', status: 'declined', decided_by: 'operator', declined_severity: 'MEDIUM',
  decided_at: '2026-10-03T12:00:00Z', operator_quote: 'keep it', first_seen: '20261001-000000-a', last_seen: '20261003-000000-decl',
  times_seen: 3, claim: 'the declined defect', nodes: ['code-audit'], ...extra } } });
const T = '2026-10-12T23:00:00Z';
const claim = (ledger, keys, groups) => markFixed(ledger, keys, '(manual)', { disposition: 'fixed_claimed', reason: 'fixed', at: T, groups });
const operator = (ledger, keys, disposition) => markFixed(ledger, keys, '(manual)', { disposition, reason: 'the operator', at: T, operator_quote: 'the operator said so' });

test('stage 3: the 2026-10-12 case — a confirmed HIGH on an unrelated declined MEDIUM breaks the decline, open, counted at HIGH', () => {
  const run = '20261012-054024-test-cost-review';
  const { ledger } = fold(declined(), run, [S(run, 'G-1', 102, 'HIGH')]);
  assert.equal(Object.keys(ledger.entries).length, 1, 'the HIGH lands on the declined entry, re-anchored to :100');
  const e = Object.values(ledger.entries)[0];
  assert.equal(e.severity, 'HIGH');
  assert.equal(e.severity_rose, true);
  assert.equal(isOpen(e), true);
  assert.equal(convergence(ledger).by_severity.HIGH, 1);
});

test('stage 3: a same-or-lower hit on a decline sets raised_again; open, a claim refused, T15 clears it, T17 can reopen', () => {
  for (const sev of ['LOW', 'MEDIUM']) {
    const run = '20261012-100000-hit';
    const { ledger } = fold(declined(), run, [S(run, 'G-1', 95, sev)]);
    const e = ledger.entries[KEY];
    assert.equal(e.raised_again, true, sev);
    assert.equal(e.severity_rose, undefined, `${sev} is not a rise`);
    assert.equal(isOpen(e), true);
    assert.equal(claim(ledger, [KEY], [`${run}:G-1`]).refused.length, 1, 'a claim on it is the operator\'s');
    assert.deepEqual(fold(ledger, run, [S(run, 'G-1', 95, sev)]).ledger.entries[KEY], e, 'a re-fold sets nothing new');
    const kept = operator(ledger, [KEY], 'declined').ledger.entries[KEY];
    assert.equal(kept.raised_again, undefined);
    assert.equal(isOpen(kept), false);
    const reopened = operator(ledger, [KEY], 'reopen');
    assert.deepEqual(reopened.refused, []);
    assert.equal(reopened.ledger.entries[KEY].status, 'reopened');
  }
});

test('stage 3: a run OLDER than the decision flags nothing (a backlog fold)', () => {
  const run = '20261002-000000-old';
  const e = fold(declined(), run, [S(run, 'G-1', 95, 'LOW')]).ledger.entries[KEY];
  assert.equal(e.raised_again, undefined);
  assert.equal(isOpen(e), false);
});

test('stage 3: an undated decline is anchored on identity_migrated_at — ascending backlog runs flag nothing, a newer run does', () => {
  const base = declined();
  delete base.entries[KEY].decided_at;
  base.identity_migrated_at = '2026-10-12T20:00:00Z';
  let l = base;
  for (const run of ['20260910-000000-b1', '20260911-000000-b2']) l = fold(l, run, [S(run, 'G-1', 95, 'LOW')]).ledger;
  assert.equal(l.entries[KEY].raised_again, undefined, 'backlog runs predate the anchor');
  const run = '20261012-210000-new';
  assert.equal(fold(l, run, [S(run, 'G-1', 95, 'LOW')]).ledger.entries[KEY].raised_again, true);
  const obs = { ...base, entries: { [KEY]: { ...base.entries[KEY], last_seen: 'observed-20260914020346.-c8178a' } } };
  assert.equal(fold(obs, '20260911-000000-b2', [S('20260911-000000-b2', 'G-1', 95, 'LOW')]).ledger.entries[KEY].raised_again, undefined);
  assert.equal(fold(obs, run, [S(run, 'G-1', 95, 'LOW')]).ledger.entries[KEY].raised_again, true);
  const bare = { ...base };
  delete bare.identity_migrated_at;
  assert.equal(fold(bare, run, [S(run, 'G-1', 95, 'LOW')]).ledger.entries[KEY].raised_again, undefined, 'no anchor flags nothing');
});

test('stage 3: a run already in runs_folded never sets raised_again, though it is after the decision', () => {
  const run = '20261011-034854-commit-recovery-design-r2';
  const l = declined();
  l.runs_folded.push(run);
  assert.equal(fold(l, run, [S(run, 'G-6', 95, 'MEDIUM')]).ledger.entries[KEY].raised_again, undefined);
});

test('stage 3: two groups of one run on one NEW entry — one sighting, the higher severity, shared; a one-group claim needs the operator', () => {
  const run = '20261012-120000-two';
  const { ledger, delta } = fold(empty(), run, [S(run, 'G-1', 95, 'MEDIUM'), S(run, 'G-2', 104, 'HIGH')]);
  const keys = Object.keys(ledger.entries);
  assert.equal(keys.length, 1);
  const e = ledger.entries[keys[0]];
  assert.equal(e.severity, 'HIGH');
  assert.equal(e.times_seen, 1);
  assert.equal(e.line, 104, 'the line of the group carrying the highest severity');
  assert.deepEqual(e.stay_shared, [`${run}:G-1`, `${run}:G-2`]);
  assert.deepEqual(delta.shared, [{ key: keys[0], groups: ['G-1', 'G-2'] }]);
  const c = claim(ledger, keys, [`${run}:G-1`]);
  assert.equal(c.ledger.entries[keys[0]].needs_operator, true);
  assert.notEqual(fold(c.ledger, '20261013-000000-silent', []).ledger.entries[keys[0]].status, 'fixed', 'a silent review does not close it');
  assert.notEqual(claim(ledger, keys, [`${run}:G-1`, `${run}:G-2`]).ledger.entries[keys[0]].needs_operator, true);
});

test('stage 3: a root cause and its symptom on one entry are one sighting, not shared', () => {
  const run = '20261012-130000-root';
  const { ledger, delta } = fold(empty(), run, [S(run, 'G-3', 96, 'LOW', { decision: 'symptom', root_cause_group: 'G-4' }), S(run, 'G-4', 92, 'MEDIUM')]);
  assert.equal(Object.keys(ledger.entries).length, 1);
  const e = Object.values(ledger.entries)[0];
  assert.equal(e.severity, 'MEDIUM');
  assert.equal(e.stay_shared, undefined);
  assert.deepEqual(delta.shared, []);
  assert.deepEqual(e.sightings.map((s) => s.group_ids), [['G-4']]);
});

test('stage 3: a declined MEDIUM hit in ONE run by a MEDIUM and a HIGH group, both orders — same entry, key and line', () => {
  const run = '20261012-140000-both';
  const a = S(run, 'G-1', 95, 'MEDIUM'), b = S(run, 'G-2', 101, 'HIGH');
  const one = fold(declined(), run, [a, b]).ledger, two = fold(declined(), run, [b, a]).ledger;
  assert.deepEqual(one, two);
  const [k] = Object.keys(one.entries);
  assert.equal(one.entries[k].severity_rose, true);
  assert.equal(one.entries[k].line, 101);
  assert.deepEqual(fold(one, run, [a, b]).ledger, one, 'a re-fold changes nothing');
});

test('stage 3: a re-fold of the same run is a no-op, and one reaching T2 adds no id stay_shared[] already holds', () => {
  const run = '20261012-150000-refold';
  const ss = [S(run, 'G-1', 95, 'MEDIUM'), S(run, 'G-2', 104, 'HIGH')];
  const once = fold(empty(), run, ss).ledger;
  assert.deepEqual(fold(once, run, ss).ledger, once);
  const e = Object.values(once.entries)[0];
  const moved = { ...once, entries: { [e.key]: { ...e, sightings: [{ run_id: '20261012-160000-x', group_ids: ['G-9'], severity: 'LOW' }], last_seen: '20261012-160000-x' } } };
  assert.deepEqual(Object.values(fold(moved, run, ss).ledger.entries)[0].stay_shared, [`${run}:G-1`, `${run}:G-2`]);
});

test('stage 3: T17 begins a new stay — the previous stay\'s shared ids no longer send a claim to the operator', () => {
  const run = '20261012-120000-two';
  const { ledger } = fold(empty(), run, [S(run, 'G-1', 95, 'MEDIUM'), S(run, 'G-2', 104, 'HIGH')]);
  const [k] = Object.keys(ledger.entries);
  const reopened = operator(operator(ledger, [k], 'closed').ledger, [k], 'reopen').ledger;
  assert.equal(reopened.entries[k].stay_shared, undefined);
  const later = '20261013-010000-one';
  const l2 = fold(reopened, later, [S(later, 'G-5', 100, 'MEDIUM')]).ledger;
  assert.notEqual(claim(l2, [k], [`${later}:G-5`]).ledger.entries[k].needs_operator, true);
});

test('stage 3: T3 clears stay_shared[] before the raising run\'s ids are appended', () => {
  const run = '20261012-120000-two';
  const { ledger } = fold(empty(), run, [S(run, 'G-1', 95, 'MEDIUM'), S(run, 'G-2', 104, 'HIGH')]);
  const [k] = Object.keys(ledger.entries);
  const closed = operator(ledger, [k], 'closed').ledger;
  const r2 = '20261013-020000-back';
  const back = fold(closed, r2, [S(r2, 'G-7', 99, 'MEDIUM'), S(r2, 'G-8', 102, 'LOW')]).ledger;
  assert.equal(Object.keys(back.entries).length, 1);
  const e = Object.values(back.entries)[0];
  assert.equal(e.status, 'reopened');
  assert.deepEqual(e.stay_shared, [`${r2}:G-7`, `${r2}:G-8`]);
});

test('stage 3: sightings[] keeps the last 10; a stay past 10 sightings still requires every stay_shared[] id', () => {
  const r0 = '20261001-000000-r00';
  let l = fold(empty(), r0, [S(r0, 'G-1', 95, 'MEDIUM'), S(r0, 'G-2', 104, 'HIGH')]).ledger;
  const [k] = Object.keys(l.entries);
  let last;
  for (let i = 1; i <= 11; i++) {
    last = `202610${String(i + 1).padStart(2, '0')}-000000-r${i}`;
    l = fold(l, last, [S(last, 'G-1', 100, 'HIGH')]).ledger;
  }
  assert.equal(l.entries[k].sightings.length, 10);
  assert.equal(claim(l, [k], [`${last}:G-1`]).ledger.entries[k].needs_operator, true);
});

// ---------------------------------------------------------------------------------------------- stage 4

test('stage 4: an entry shows the latest claim and keeps the earlier ones, bounded to 10, with run and group', () => {
  const r1 = '20261012-180000-c1', r2 = '20261012-190000-c2';
  let l = fold(empty(), r1, [S(r1, 'G-1', 95, 'MEDIUM', { claim: 'the first defect' })]).ledger;
  l = fold(l, r2, [S(r2, 'G-3', 96, 'MEDIUM', { claim: 'a different defect' })]).ledger;
  const e = Object.values(l.entries)[0];
  assert.equal(e.claim, 'a different defect');
  assert.deepEqual(e.claims.map((c) => [c.run_id, c.group_id, c.claim]),
    [[r1, 'G-1', 'the first defect'], [r2, 'G-3', 'a different defect']]);
  for (let i = 0; i < 12; i++) { const r = `202610${String(13 + i).padStart(2, '0')}-000000-c`; l = fold(l, r, [S(r, 'G-1', 95, 'LOW', { claim: `c${i}` })]).ledger; }
  assert.equal(Object.values(l.entries)[0].claims.length, 10);
});

test('stage 4: a combined sighting keeps the others\' claims in claims[], the shown claim being the top group\'s', () => {
  const run = '20261012-200000-comb';
  const e = Object.values(fold(empty(), run, [S(run, 'G-1', 95, 'MEDIUM', { claim: 'medium one' }), S(run, 'G-2', 104, 'HIGH', { claim: 'high one' })]).ledger.entries)[0];
  assert.equal(e.claim, 'high one');
  assert.deepEqual(e.claims.map((c) => c.group_id), ['G-1', 'G-2'], 'the shown claim is the last element');
});

test('stage 4: a decline raised again shows the newest claim; the declined one stays in claims[]', () => {
  const run = '20261012-210500-dec';
  const base = declined({ claims: [{ run_id: '20261003-000000-decl', group_id: null, claim: 'the declined defect' }] });
  const e = fold(base, run, [S(run, 'G-1', 95, 'LOW', { claim: 'something else' })]).ledger.entries[KEY];
  assert.equal(e.claim, 'something else');
  assert.equal(e.claims[0].claim, 'the declined defect');
});

test('stage 4: --summary notes a shared entry and one whose claims[] holds a different claim', () => {
  assert.deepEqual(entryNotes({ claim: 'a', claims: [{ claim: 'a' }] }), []);
  assert.deepEqual(entryNotes({ claim: 'b', claims: [{ claim: 'a' }, { claim: 'a' }, { claim: 'b' }] }),
    ['earlier claims differ: 1 other (claims[])']);
  assert.deepEqual(entryNotes({ claim: 'a', stay_shared: ['r:G-1', 'r:G-2'] }),
    ['shared by r:G-1, r:G-2 — a fix claim must name every group']);
});

test('stage 3: --summary lists a decline raised again at the same severity, and does not call it worse', (t) => {
  const run = '20261012-100000-hit';
  const { ledger } = fold(declined(), run, [S(run, 'G-1', 95, 'MEDIUM', { claim: 'a different defect' })]);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-ident-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  const script = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--summary', '--stale', '--ledger', ledgerPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const section = r.stdout.split('declined, but raised again')[1] ?? '';
  assert.match(section, new RegExp(`${KEY.replace(/[.]/g, '\\.')} — declined at MEDIUM, raised again at MEDIUM`));
  assert.doesNotMatch(r.stdout, /came back worse/);
});

// ---------------------------------------------------------------------------------------------- stage 5

// A finished run, as the fold reads it: run.json with its scope, gate.json, an OK status per lens, finding-groups.json
// and the merged reconcile payload. Every lens's kept verdict is deliberately ABSENT: the fold no longer reads them.
const LENSES = ['code-audit', 'panel-codex-code'];
function runFixture(root, runId, { groups = [], rows = null, gate = 'RISK', noGroups = false } = {}) {
  const dir = path.join(root, runId);
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: runId, scope: { paths: ['scripts'] } }));
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ gate }));
  for (const id of LENSES) {
    fs.writeFileSync(path.join(dir, 'nodes', `${id}.status.json`), JSON.stringify({ schema_version: 1, run_id: runId, node_id: id, state: 'OK', kind: 'lens', findings_count: 0 }));
  }
  if (!noGroups) fs.writeFileSync(path.join(dir, 'finding-groups.json'), JSON.stringify({ run_id: runId, groups }));
  if (rows) {
    fs.mkdirSync(path.join(dir, 'evidence', 'reconcile'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ run_id: runId, groups: rows }));
  }
  return dir;
}
// `home`: the temporary directory the fixture runs sit in, given as the engine's home, because a run directory is
// admitted only inside the repository or the home (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
const cli = (args, home = null) => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url)), ...args],
  { encoding: 'utf8', ...(home ? { env: { ...process.env, QUORATE_HOME: home } } : {}) });
function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-ident5-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
const readLedger = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('stage 5: a fold reads reconciled groups — a reconciler-raised HIGH breaks a decline, with no kept verdicts on disk', (t) => {
  const d = tmp(t);
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(declined()));
  const run = '20261012-054024-test-cost-review';
  const dir = runFixture(d, run, { groups: [group('G-1', F, 102, [member('panel-codex-code', 'MEDIUM')])], rows: [row('G-1', 'confirmed', 'HIGH')] });
  const r = cli(['--run-dir', dir, '--ledger', ledgerPath], d);
  assert.equal(r.status, 0, r.stderr);
  const e = Object.values(readLedger(ledgerPath).entries)[0];
  assert.equal(e.severity, 'HIGH');
  assert.equal(e.severity_rose, true);
});

test('stage 5: the fold report prints group ids beside the key, and a shared entry with every group', (t) => {
  const d = tmp(t);
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(empty()));
  const run = '20261012-150500-report';
  const dir = runFixture(d, run, {
    groups: [group('G-1', 'scripts/z.mjs', 15, [member('code-audit', 'MEDIUM')]), group('G-2', 'scripts/z.mjs', 19, [member('panel-codex-code', 'LOW')])],
    rows: [row('G-1', 'confirmed', 'MEDIUM'), row('G-2', 'confirmed', 'LOW')],
  });
  const r = cli(['--run-dir', dir, '--ledger', ledgerPath], d);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /new {8}scripts\/z\.mjs:10 \[G-1, G-2\] — /);
  assert.match(r.stdout, /shared {5}scripts\/z\.mjs:10 — G-1, G-2: a fix claim must name every group/);
});

test('stage 5: a dropped group reopens nothing', (t) => {
  const d = tmp(t);
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(declined()));
  const run = '20261012-100000-drop';
  const dir = runFixture(d, run, { groups: [group('G-1', F, 95, [member('code-audit', 'HIGH')])], rows: [row('G-1', 'dropped', 'HIGH')] });
  assert.equal(cli(['--run-dir', dir, '--ledger', ledgerPath], d).status, 0);
  const e = readLedger(ledgerPath).entries[KEY];
  assert.equal(e.status, 'declined');
  assert.equal(e.severity_rose, undefined);
  assert.equal(e.raised_again, undefined);
  assert.equal(e.times_seen, 3);
});

test('stage 5: a claim closes on a later run\'s silence; a zero-group run with no payload folds as silence', (t) => {
  const d = tmp(t);
  const ledgerPath = path.join(d, 'ledger.json');
  const r1 = '20261012-110000-find';
  fs.writeFileSync(ledgerPath, JSON.stringify(empty()));
  const one = runFixture(d, r1, { groups: [group('G-1', 'scripts/z.mjs', 12, [member('code-audit', 'MEDIUM')])], rows: [row('G-1', 'confirmed', 'MEDIUM')] });
  assert.equal(cli(['--run-dir', one, '--ledger', ledgerPath], d).status, 0);
  const [k] = Object.keys(readLedger(ledgerPath).entries);
  const c = cli(['--mark-fixed', k, '--ledger', ledgerPath, '--reason', 'fixed', '--evidence', 'e.log', '--group', `${r1}:G-1`]);
  assert.equal(c.status, 0, c.stderr);
  const two = runFixture(d, '20261012-120000-quiet', { groups: [] });
  const r = cli(['--run-dir', two, '--ledger', ledgerPath], d);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readLedger(ledgerPath).entries[k].status, 'fixed');
});

test('stage 5: refused — no finding-groups.json, groups with no payload, a non-list groups, a linked artifact', (t) => {
  const d = tmp(t);
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(empty()));
  const g1 = [group('G-1', 'scripts/z.mjs', 12, [member('code-audit', 'MEDIUM')])];
  const cases = {
    'no groups': runFixture(d, '20261012-130000-a', { noGroups: true }),
    'no payload': runFixture(d, '20261012-130000-b', { groups: g1 }),
  };
  const bad = runFixture(d, '20261012-130000-d', { groups: g1, rows: [row('G-1', 'confirmed', 'MEDIUM')] });
  fs.writeFileSync(path.join(bad, 'finding-groups.json'), JSON.stringify({ groups: { 'G-1': {} } }));
  cases['non-list groups'] = bad;
  const outside = path.join(d, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'payload.json'), JSON.stringify({ groups: [row('G-1', 'confirmed', 'MEDIUM')] }));
  const linked = runFixture(d, '20261012-130000-e', { groups: g1 });
  fs.mkdirSync(path.join(linked, 'evidence'), { recursive: true });
  // Said, not silent (silent-platform-skips.md): where no junction can be made, makeLink skips and the other cases still
  // run, but this one did not.
  const linkMade = makeLink(t, { target: outside, at: path.join(linked, 'evidence', 'reconcile'), type: 'junction' });
  if (linkMade) cases['linked artifact'] = linked;
  for (const [name, dir] of Object.entries(cases)) {
    const r = cli(['--run-dir', dir, '--ledger', ledgerPath], d);
    assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
    assert.deepEqual(readLedger(ledgerPath).entries, {}, `${name} must write nothing`);
  }
});

test('stage 5: the extracted reader returns both artifacts whole, and collectRun keeps its shape', (t) => {
  const d = tmp(t);
  const dir = runFixture(d, '20261012-140000-reader', { groups: [group('G-1', 'scripts/z.mjs', 12, [member('code-audit', 'MEDIUM')])], rows: [row('G-1', 'confirmed', 'HIGH')] });
  const r = readReconcileArtifacts(dir);
  assert.deepEqual(r.refused, {});
  assert.equal(r.groups.groups[0].findings[0].node_id, 'code-audit', 'member findings travel');
  assert.equal(r.payload.groups[0].severity, 'HIGH', 'the payload severity travels');
  const c = collectRun(dir, { warn: () => {} });
  assert.deepEqual(c.reconcileDecisions, { 'G-1': { decision: 'confirmed', root_cause_group: null } });
  assert.deepEqual(c.groupIndex, [{ group_id: 'G-1', file: 'scripts/z.mjs', line: 12 }]);
});

// ---------------------------------------------------------------------------------------------- stage 6

const migLedger = () => ({
  schema_version: 1,
  runs_folded: ['20261003-000000-decl', '20261012-054024-test-cost-review', 'observed-20260914020346.-c8178a'],
  entries: {
    [KEY]: { key: KEY, file: F, line: 94, severity: 'MEDIUM', status: 'declined', decided_by: 'operator', declined_severity: 'MEDIUM',
      decided_at: '2026-10-03T12:00:00Z', first_seen: '20261001-000000-a', last_seen: '20261012-060750-test-cost-r2', times_seen: 4,
      claim: 'the declined defect', nodes: ['code-audit'], decisions: [{ transition: 'T15', quote: 'keep it' }] },
    'scripts/u.mjs:0': { key: 'scripts/u.mjs:0', file: 'scripts/u.mjs', line: 3, severity: 'HIGH', status: 'declined', decided_by: 'operator',
      first_seen: '20260901-000000-a', last_seen: 'observed-20260914020346.-c8178a', times_seen: 2, claim: 'undated', nodes: [] },
    'scripts/o.mjs:20': { key: 'scripts/o.mjs:20', file: 'scripts/o.mjs', line: 25, severity: 'LOW', status: 'open',
      stay_started: '2026-10-01T00:00:00Z', first_seen: '20261001-000000-a', last_seen: '20261001-000000-a', times_seen: 1, claim: 'open one', nodes: ['x'] },
  },
});
const sighting = (run, gid, file, line, severity) => ({ run_id: run, group_id: gid, file, line, severity, decision: 'confirmed', claim: `${gid}`, nodes: ['x'] });

test('stage 6: migration seeds claims[], records identity_migrated_at once, and changes no status or disposition', () => {
  const before = migLedger();
  const m = migrateIdentity(before, { at: '2026-10-12T22:00:00Z', runs: [] });
  assert.equal(m.ok, true, m.why);
  assert.equal(m.ledger.identity_migrated_at, '2026-10-12T22:00:00Z');
  for (const [k, e] of Object.entries(before.entries)) {
    const after = m.ledger.entries[k];
    assert.deepEqual(after.claims, [{ run_id: e.last_seen, group_id: null, claim: e.claim }]);
    // The plan's stage 6: "each entry's `sightings[]` starts empty" (G-8 of 20261013-023310-ledger-identity-remediation-2-review:
    // the migration seeded claims[] and left sightings[] absent).
    assert.deepEqual(after.sightings, [], `${k}: sightings[] is seeded empty`);
    assert.deepEqual({ ...after, claims: undefined, sightings: undefined }, { ...e, claims: undefined, sightings: undefined }, `${k}: nothing but claims[] and sightings[] changes`);
  }
  // An entry that already has either keeps it as it was.
  const kept = migLedger();
  kept.entries[KEY].claims = [{ run_id: 'r', group_id: 'G-1', claim: 'c' }];
  kept.entries[KEY].sightings = [{ run_id: 'r', group_ids: ['G-1'], severity: 'MEDIUM' }];
  const mk = migrateIdentity(kept, { at: '2026-10-12T22:00:00Z', runs: [] });
  assert.deepEqual(mk.ledger.entries[KEY].claims, kept.entries[KEY].claims);
  assert.deepEqual(mk.ledger.entries[KEY].sightings, kept.entries[KEY].sightings);
  const again = migrateIdentity(m.ledger, { at: '2026-10-13T00:00:00Z', runs: [] });
  assert.equal(again.ok, false);
  assert.match(again.why, /2026-10-12T22:00:00Z/, 'the refusal names the recorded time, so the anchor never moves');
});

test('stage 6: the recheck LISTS a hidden rise and a same-or-lower hit after a dated decline — and applies neither', () => {
  const run = '20261012-054024-test-cost-review';
  const m = migrateIdentity(migLedger(), { at: '2026-10-12T22:00:00Z', runs: [
    { run_id: run, sightings: [sighting(run, 'G-1', F, 102, 'HIGH'), sighting(run, 'G-6', 'scripts/o.mjs', 27, 'MEDIUM')] },
    { run_id: '20261011-034854-commit-recovery-design-r2', sightings: [sighting('20261011-034854-commit-recovery-design-r2', 'G-6', F, 96, 'MEDIUM')] },
  ] });
  assert.equal(m.ok, true, m.why);
  const listed = m.report.listed.map((l) => [l.key, l.run_id, l.group_id, l.kind, l.anchor]);
  assert.deepEqual(listed, [
    ['scripts/io/snapshot.mjs:90', '20261011-034854-commit-recovery-design-r2', 'G-6', 'raised_again', 'decided_at'],
    ['scripts/io/snapshot.mjs:90', run, 'G-1', 'rise', 'decided_at'],
    ['scripts/o.mjs:20', run, 'G-6', 'rise', 'stay_started'],
  ]);
  const e = m.ledger.entries[KEY];
  assert.equal(e.severity, 'MEDIUM', 'a listed rise is not applied');
  assert.equal(e.severity_rose, undefined);
  assert.equal(e.raised_again, undefined);
  assert.equal(m.ledger.entries['scripts/o.mjs:20'].severity, 'LOW');
});

test('stage 6: an entry with no anchor is skipped and counted; a run before the anchor is not attributed; a partial run is named', () => {
  const m = migrateIdentity(migLedger(), { at: '2026-10-12T22:00:00Z', runs: [
    { run_id: '20261002-000000-early', sightings: [sighting('20261002-000000-early', 'G-1', F, 95, 'HIGH')] },
    { run_id: '20261005-000000-late', sightings: [sighting('20261005-000000-late', 'G-2', 'scripts/u.mjs', 4, 'BLOCKER')], partial: true },
  ] });
  assert.deepEqual(m.report.listed, [], 'the early run predates the decline; the undated decline is never checked');
  assert.deepEqual(m.report.skipped, [{ key: 'scripts/u.mjs:0', why: 'no decided_at and no stay_started' }]);
  assert.deepEqual(m.report.partial, ['20261005-000000-late']);
});

test('stage 6: --migrate-identity reads the folded runs beside the ledger, writes the report, and refuses a second time', (t) => {
  const d = tmp(t);
  const ledgerPath = path.join(d, 'ledger.json');
  const l = migLedger();
  l.runs_folded.push('20261011-000000-gone');
  fs.writeFileSync(ledgerPath, JSON.stringify(l));
  runFixture(d, '20261012-054024-test-cost-review', { groups: [group('G-1', F, 102, [member('panel-codex-code', 'MEDIUM')])], rows: [row('G-1', 'confirmed', 'HIGH')] });
  const report = path.join(d, 'report.md');
  const r = cli(['--migrate-identity', '--ledger', ledgerPath, '--report', report]);
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(report, 'utf8');
  assert.match(md, /`scripts\/io\/snapshot\.mjs:90` RISE MEDIUM -> HIGH — 20261012-054024-test-cost-review G-1 \(anchor: decided_at\)/);
  assert.match(md, /20261011-000000-gone — its directory is gone/);
  assert.match(md, /`scripts\/u\.mjs:0` — no decided_at and no stay_started/);
  assert.match(md, /Nothing below was applied/);
  const after = readLedger(ledgerPath);
  assert.ok(after.identity_migrated_at);
  assert.equal(after.entries[KEY].severity, 'MEDIUM', 'the listed rise is not applied');
  const again = cli(['--migrate-identity', '--ledger', ledgerPath, '--report', report]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, new RegExp(after.identity_migrated_at.replace(/[.]/g, '\\.')));
});

// ---------------------------------------------------------------------------------------------- stage 7

const REPO = fileURLToPath(new URL('..', import.meta.url));
const doc = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

test('stage 7: ledger-transitions.md states what a fold counts, the identity fields, and T4\'s new case', () => {
  const lt = doc('shared/ledger-transitions.md');
  assert.match(lt, /## What a fold counts — a sighting/);
  for (const f of ['sightings[]', 'claims[]', 'stay_shared[]', 'identity_migrated_at']) assert.ok(lt.includes(`\`${f}\``), `${f} is not documented`);
  const row = (n) => lt.split('\n').find((l) => l.startsWith(`| ${n} |`)) ?? '';
  assert.match(row('T4'), /`raised_again: true` when it is at or below it/);
  assert.match(row('T4'), /newer than the decision/);
  assert.match(row('T15'), /clears `severity_rose`, `raised_again`/);
  assert.match(row('T17'), /a decline a review raised again/);
  assert.match(row('T17'), /`stay_shared\[\]`/);
  assert.match(row('T9'), /every `stay_shared\[\]` id/);
  assert.doesNotMatch(lt, /operator decline whose severity rose/, 'a Refused row still names only the rise');
});

test('stage 7: the decision field list in ledger-transitions.md mirrors DECISION_FIELDS', () => {
  const lt = doc('shared/ledger-transitions.md');
  const src = doc('scripts/lib/ledger.mjs');
  const fields = JSON.parse(/const DECISION_FIELDS = (\[[^\]]*\])/.exec(src)[1].replace(/'/g, '"'));
  const listed = lt.slice(lt.indexOf('- **the decision**:'), lt.indexOf('- **the history**'));
  for (const f of fields) assert.ok(listed.includes(`\`${f}\``), `${f} is in DECISION_FIELDS and not in the doc's list`);
});

test('stage 7: the remediate skill says where a group\'s entry key comes from, and the code no longer states the old T4 rule', () => {
  assert.match(doc('skills/remediate/SKILL.md'), /`sightings\[\]`/);
  assert.match(doc('skills/remediate/SKILL.md'), /\*\*shared\*\*/);
  const src = doc('scripts/lib/ledger.mjs');
  assert.doesNotMatch(src, /STAYS DECLINED/);
  assert.doesNotMatch(src, /came back to the operator only\s+\/\/\s+when its severity rises/);
  assert.match(src, /AND THEN THE COLLISION HID A HIGH/);
});

test('stage 3: an entry with no sightings[] (migrated), claimed, then its last_seen run re-folded — nothing changes', () => {
  const run = '20261012-170000-last';
  const l0 = { schema_version: 1, runs_folded: [run], entries: { [KEY]: { key: KEY, file: F, line: 94, severity: 'MEDIUM', status: 'open',
    first_seen: run, last_seen: run, times_seen: 2, claim: 'x', nodes: ['code-audit'], stay_started: '2026-10-01T00:00:00Z' } } };
  const claimed = claim(l0, [KEY], [`${run}:G-1`]).ledger;
  assert.deepEqual(fold(claimed, run, [S(run, 'G-1', 94, 'MEDIUM')]).ledger.entries, claimed.entries);
});

// reconcile-missing-groups.plan.md stage 2: a partly judged run folds through the CLI, and its unjudged entry is listed
// among what waits on the operator, since nobody judged its severity.
test('stage 2: a partly judged run folds, and --summary --stale lists its unjudged entry', (t) => {
  const d = tmp(t);
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(empty()));
  const dir = runFixture(d, '20261023-130000-partial', { groups: [group('G-1', 'scripts/z.mjs', 12, [member('code-audit', 'MEDIUM')]),
    group('G-2', 'scripts/z.mjs', 80, [member('panel-codex-perf', 'MEDIUM', 'a whole file read before hashing')])],
  rows: [row('G-1', 'confirmed', 'MEDIUM')] });
  const r = cli(['--run-dir', dir, '--ledger', ledgerPath], d);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const entries = Object.values(readLedger(ledgerPath).entries);
  assert.equal(entries.length, 2);
  assert.equal(entries.filter((e) => e.unjudged === true).length, 1);
  const s = cli(['--summary', '--stale', '--ledger', ledgerPath], d);
  assert.match(s.stdout, /unjudged[^\n]*\(1\)/i, s.stdout);
  assert.match(s.stdout, /a whole file read before hashing/);
});
