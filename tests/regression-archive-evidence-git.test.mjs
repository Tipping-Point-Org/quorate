// contract-glob-grammar.plan.md, stage 6 (design §4): whether a run's evidence may be archived into the repository is
// git's answer, not a parser's. quorate read the reviews .gitignore itself and missed a broad re-include such as `!*/`
// (r5 G-5) — the third gap in that reader. The gate's record of withheld evidence sat inside the external-panel branch
// (r5 G-14), and the test for it matched source text and passed with that defect live (r5 G-20). This file archives a
// real run into a real git repository, with each .gitignore shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as rr from '../scripts/io/reviews-root.mjs';
import { confined } from '../scripts/io/confined-path.mjs';
import { REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

function setup(t, gitignore) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-arch-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const reviews = path.join(repo, '.claude', 'reviews');
  fs.mkdirSync(reviews, { recursive: true });
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  if (gitignore !== null) fs.writeFileSync(path.join(reviews, '.gitignore'), gitignore);
  const from = path.join(root, 'staged', 'run-1');
  fs.mkdirSync(path.join(from, 'evidence', 'node'), { recursive: true });
  fs.writeFileSync(path.join(from, 'gate.md'), '# Gate\n');
  fs.writeFileSync(path.join(from, 'evidence', 'node', 'test.log'), 'captured output\n');
  return { reviews, from, plan: { from, tmp: path.join(reviews, '.archiving-run-1'), to: path.join(reviews, 'run-1') } };
}

// The archive as run-graph composes it: the .gitignore written when absent, then git asked, then the run moved.
function archive({ reviews, plan }) {
  rr.ensureReviewsIgnore(reviews);
  const ignored = rr.evidenceIgnoredByGit(reviews, 'run-1', confined(plan.from));
  return { ignored, moved: rr.archiveRun(plan, { withholdEvidence: ignored !== true }) };
}

const SHAPES = {
  'the evidence rule': ['*/evidence/\n.preflight-cache/\n', true],
  'the rule, then a broad re-include (r5 G-5)': ['*/evidence/\n.preflight-cache/\n!*/\n', false],
  'no rule': ['.preflight-cache/\n', false],
  'no file (the archive writes the full one)': [null, true],
};

for (const [shape, [gitignore, archived]] of Object.entries(SHAPES)) {
  test(`with ${shape}, evidence is ${archived ? 'archived' : 'withheld, staged'}`, (t) => {
    assert.equal(typeof rr.evidenceIgnoredByGit, 'function', 'nothing asks git whether the evidence would be ignored');
    const s = setup(t, gitignore);
    const { ignored, moved } = archive(s);
    assert.equal(ignored, archived, `git's answer for ${shape}`);
    assert.equal(fs.existsSync(path.join(s.plan.to, 'evidence')), archived, `evidence in the repository for ${shape}`);
    assert.equal(fs.existsSync(path.join(s.from, 'evidence', 'node', 'test.log')), !archived, `evidence staged for ${shape}`);
    assert.ok(fs.existsSync(path.join(s.plan.to, 'gate.md')), 'the rest of the run was archived');
  });
}

test('the gate\'s archive entry says where withheld evidence stays, and is silent when git ignores it', () => {
  assert.equal(typeof rr.archiveEvidenceEntry, 'function');
  const runDir = path.join('C:', 'staged', 'run-1');
  const withheld = rr.archiveEvidenceEntry({ archiveRoot: 'R', runDir, ignored: false, missing: ['*/evidence/'] });
  assert.match(withheld.why, /stays staged/);
  assert.match(withheld.why, /evidence/);
  const unknown = rr.archiveEvidenceEntry({ archiveRoot: 'R', runDir, ignored: null, missing: [] });
  assert.match(unknown.why, /could not|stays staged/, 'git not answering withholds, and says so');
  assert.equal(rr.archiveEvidenceEntry({ archiveRoot: 'R', runDir, ignored: true, missing: [] }), null);
});

// The panel half of this test compared source positions, so a dead `archiveEvidenceEntry(` before the panel branch kept
// it green (G-23 of 20261001-034021-cgg-remediation-review). It is now DRIVEN: regression-cgg-r2-remediation.test.mjs
// runs a real run with the panel off and reads the entry from its gate. What stays here is the parser's absence.
test('the parser-based decision is gone; git decides (r5 G-4)', () => {
  assert.doesNotMatch(read('scripts', 'lib', 'reviews-root.mjs'), /export const withholdsEvidence = \(missing/,
    'the parser-based decision (r5 G-4: a second copy of the rule) still exists');
});

test('a failed cleanup after the archive is reported, not thrown past the archive (r5 G-2)', () => {
  const s = read('scripts', 'io', 'reviews-root.mjs');
  const fn = s.slice(s.indexOf('export function archiveRun('));
  const rename = fn.indexOf('renameSync(plan.tmp, plan.to)');
  const after = fn.slice(rename, fn.indexOf('\n}\n', rename));
  assert.match(after, /try \{[\s\S]*rmSync\(plan\.from[\s\S]*\} catch/, 'the staged run\'s cleanup can throw out of a completed archive');
});
