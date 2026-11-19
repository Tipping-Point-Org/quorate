// G-14 — THE PER-JUDGE TABLE AND THE RULING LINES WERE KEYED BY TRANSPORT.
//
// `summariseAdjudications` groups rows with `v?.reviewer ?? v?.judge`, and `reconciled.md` stores each
// ruling under `${group_id}::${judge.reviewer}`. `reviewer` is a TRANSPORT — the CLI a judge is reached
// through — and the roster explicitly supports two judges on one adapter, because agy serves Gemini
// models AND Claude models. Such a panel collapses into one row with doubled counts, and the second
// judge's ruling line overwrites the first's.
//
// The comment defending transport keys is accurate about a world that no longer exists: `judge` used to
// be the NODE id (`adjudicate-G-5-agy`), unique per group, so grouping on it produced one row per vote
// instead of one per judge — six rows for two judges. That was real, and keying on the transport fixed
// it. Then run-graph.mjs:3371 changed votes to carry the DECLARED id (`adj-agy`), which aggregates
// correctly, and the summary was never switched over. The justification outlived its input.
//
// Latent under today's roster, which happens to use one adapter per judge. "Latent" is the whole
// problem: the cross-family guarantee reads as satisfied in a configuration the roster permits and
// nothing warns.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { mergeAdjudication, summariseAdjudications } from '../scripts/lib/adjudication.mjs';

const PARTICIPANTS = ['panel-codex-perf', 'perf-audit'];

/** The roster-permitted case: two DIFFERENT judges reached through ONE adapter. */
function twoJudgesOneAdapter(supportsA, supportsB) {
  return mergeAdjudication({
    participants: PARTICIPANTS,
    scheduled: 2,
    votes: [
      { judge: 'adj-agy-gemini', reviewer: 'agy', state: 'reachable', supports: supportsA, confidence: 'high' },
      { judge: 'adj-agy-claude', reviewer: 'agy', state: 'reachable', supports: supportsB, confidence: 'high' },
    ],
  });
}

test('two judges on one adapter stay two rows', () => {
  const s = summariseAdjudications([twoJudgesOneAdapter('panel-codex-perf', 'perf-audit')]);
  const judges = (s.per_judge ?? []).map((r) => r.judge).sort();

  assert.deepEqual(judges, ['adj-agy-claude', 'adj-agy-gemini'],
    'keyed on `reviewer` these collapse into a single `agy` row with voted:2, and the per-judge table '
    + 'silently stops being per-judge. capabilities.mjs explicitly permits this roster.');
});

test('the collapsed row does not double one judge s counts', () => {
  const s = summariseAdjudications([twoJudgesOneAdapter('panel-codex-perf', 'panel-codex-perf')]);
  for (const row of s.per_judge ?? []) {
    assert.equal(row.voted, 1,
      `${row.judge} voted once; a row showing 2 is two judges merged into one identity`);
  }
});

test('one judge across several disputes still aggregates to ONE row', () => {
  // The defect the transport key was introduced to fix, which must not come back: `judge` must be the
  // DECLARED id, never the per-group node id, or every vote becomes its own row.
  const merges = ['G-1', 'G-2', 'G-3'].map(() => mergeAdjudication({
    participants: PARTICIPANTS,
    scheduled: 2,
    votes: [
      { judge: 'adj-agy', reviewer: 'agy', state: 'reachable', supports: 'panel-codex-perf', confidence: 'high' },
      { judge: 'adj-codex', reviewer: 'codex', state: 'reachable', supports: 'panel-codex-perf', confidence: 'high' },
    ],
  }));
  const s = summariseAdjudications(merges);
  assert.equal((s.per_judge ?? []).length, 2, 'two judges over three disputes is two rows, not six');
  for (const row of s.per_judge) assert.equal(row.voted, 3);
});

test('the summary keys on the declared judge, not the transport', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'adjudication.mjs'), 'utf8')
    .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(' ');
  assert.ok(!/v\?\.reviewer \?\? v\?\.judge/.test(src),
    'transport-first precedence merges distinct judges that share an adapter');
});

test('a ruling line is stored under the judge, not the adapter', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8')
    .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(' ');
  assert.ok(!/\$\{group_id\}::\$\{judge\.reviewer\}/.test(src)
    && !/::\$\{judge\.reviewer\}/.test(src),
    'reconciled.md rulings keyed by adapter mean the second judge on that adapter overwrites the first, '
    + 'so the gate cannot show which judge voted what');
});
