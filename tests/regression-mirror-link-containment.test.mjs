// G-11 of run 20260925-015614-platform-review (panel-codex-security): the checkout the external
// reviewers read was built by mirroring the working tree, and untracked symbolic links were recreated
// as-is, target unexamined. An untracked link to a credential file or to source outside the
// repository was then readable from the checkout a third-party cloud reviews — the egress the threat
// model names ("source leaving the machine through the external panel").
//
// Since arms-read-surface there is no mirror: the arms' directory is a snapshot, and what a link or a
// linked directory would have brought in is left out by judgeSnapshotEntries (its rules are tested in
// regression-snapshot-surface; the classes, end to end, in regression-arms-surface-link-classes). What
// stays here is the half of G-11 that was never about the mirror: a refusal is REPORTED in the gate,
// not skipped in silence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('G-11: every entry left out of the arms\' directory is named in the gate', () => {
  const graph = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /for \(const w of panelBuilt\.withheld \?\? \[\]\)[\s\S]{0,300}mirrorRefusals\.push/,
    'the builder\'s withheld entries are collected');
  assert.match(graph, /for \(const r of mirrorRefusals\)\s*\{\s*buckets\.not_checked\.push/,
    'and each one is named in not_checked[]');
});
