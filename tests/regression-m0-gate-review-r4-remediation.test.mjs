// Remediation of review 20260930-225320-m0-gate-review-r4 (operator's answers: "Fix now (Recommended)" for G-8;
// "Revert the filter (Recommended)" for G-7 and G-1; the other glob groups go to one design step).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as reviewsRoot from '../scripts/io/reviews-root.mjs';
import * as walk from '../scripts/lib/walk-rules.mjs';
import { REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
const tmp = (t) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-m0r4-'))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

// G-8: when the destination's .gitignore lacked the evidence rule, the archive warned and then copied the evidence —
// captured output that may carry the operator's environment (§3) — onto git's tracked side anyway.
// Since contract-glob-grammar stage 6 the decision is git's answer (tests/regression-archive-evidence-git.test.mjs drives
// it with real git and each .gitignore shape); what remains here is the entry it produces. A missing cache rule alone is
// named but withholds nothing; evidence git would not ignore is withheld, and the entry says where it stays.
test('G-8: evidence git would not ignore is withheld; a missing cache rule alone withholds nothing', () => {
  const runDir = path.join('X', 'run-1');
  const notIgnored = reviewsRoot.archiveEvidenceEntry({ archiveRoot: 'R', runDir, ignored: false, missing: ['*/evidence/'] });
  assert.match(notIgnored.why, /stays staged/);
  const cacheOnly = reviewsRoot.archiveEvidenceEntry({ archiveRoot: 'R', runDir, ignored: true, missing: ['.preflight-cache/'] });
  assert.doesNotMatch(cacheOnly.why, /stays staged/, 'a missing cache rule withheld the evidence');
  assert.match(cacheOnly.why, /\.preflight-cache\//);
  assert.equal(reviewsRoot.archiveEvidenceEntry({ archiveRoot: 'R', runDir, ignored: true, missing: [] }), null);
});

function stagedRun(root) {
  const from = path.join(root, 'staged', 'run-1');
  fs.mkdirSync(path.join(from, 'evidence', 'node'), { recursive: true });
  fs.mkdirSync(path.join(from, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(from, 'gate.md'), '# Gate\n');
  fs.writeFileSync(path.join(from, 'nodes', 'a.status.json'), '{}');
  fs.writeFileSync(path.join(from, 'evidence', 'node', 'test.log'), 'TOKEN=not-a-real-one\n');
  const toDir = path.join(root, 'repo', '.claude', 'reviews');
  fs.mkdirSync(toDir, { recursive: true });
  return { from, tmp: path.join(toDir, '.archiving-run-1'), to: path.join(toDir, 'run-1') };
}

test('G-8: an archive that withholds evidence moves the run and leaves the evidence staged', (t) => {
  assert.equal(typeof reviewsRoot.archiveRun, 'function', 'the archive is inline in run-graph and cannot be exercised');
  const plan = stagedRun(tmp(t));
  const r = reviewsRoot.archiveRun(plan, { withholdEvidence: true });
  assert.equal(r.to, plan.to);
  assert.ok(fs.existsSync(path.join(plan.to, 'gate.md')) && fs.existsSync(path.join(plan.to, 'nodes', 'a.status.json')));
  assert.equal(fs.existsSync(path.join(plan.to, 'evidence')), false, 'the evidence reached the repository');
  assert.ok(fs.existsSync(path.join(plan.from, 'evidence', 'node', 'test.log')), 'the evidence was lost, not withheld');
  assert.equal(r.evidenceLeftAt, path.join(plan.from, 'evidence'));
  assert.equal(fs.existsSync(path.join(plan.from, 'gate.md')), false, 'the rest of the staged run was left behind');
});

test('G-8: an archive with the rule in force moves the whole run, as before', (t) => {
  const plan = stagedRun(tmp(t));
  const r = reviewsRoot.archiveRun(plan, { withholdEvidence: false });
  assert.ok(fs.existsSync(path.join(plan.to, 'evidence', 'node', 'test.log')));
  assert.equal(fs.existsSync(plan.from), false);
  assert.equal(r.evidenceLeftAt, null);
});

test('G-8: run-graph archives through archiveRun, and the gate says where withheld evidence stays', () => {
  const s = read('scripts', 'run-graph.mjs');
  // The sequence moved into io/reviews-root's archiveStagedRun (2026-10-15), shared with remediate.mjs and archive-run.mjs.
  assert.match(s, /archiveStagedRun\(\{ runDir, archiveTo: runJson\.archive_to/, 'run-graph does not archive through the owner');
  assert.match(read('scripts', 'io', 'reviews-root.mjs'), /archiveRun\(plan, \{ withholdEvidence, skip, rm \}\)/, 'the owner still copies the evidence itself');
  // The entry's wording moved into lib/reviews-root's archiveEvidenceEntry in contract-glob-grammar stage 6.
  assert.match(s, /archiveEvidenceEntry\(\{/, 'the gate does not record the archive\'s evidence');
});

// G-7, G-1: the snapshot filter c4e6c69 added made a literal doc directory overlapping source snapshot nothing, and
// read `[!x]` as a positive class. Reverted to the behaviour before it; the exact matcher returns with the glob design.
test('G-7, G-1: the snapshot filter and globMatches are gone until the glob design replaces them', () => {
  assert.equal(walk.globMatches, undefined, 'globMatches still exists');
  assert.doesNotMatch(read('scripts', 'run-graph.mjs'), /globMatches/, 'the snapshot still filters by globMatches');
  assert.doesNotMatch(read('shared', 'claude-md-contract.md'), /only the files the glob matches are copied/,
    'the doc still promises a snapshot filter the code no longer has');
});
