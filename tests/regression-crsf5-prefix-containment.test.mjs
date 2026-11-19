// G-2, G-3, G-4, G-8 and G-9 of 20261105-151040-crsf-remediation-4b-review: containment decided by a character prefix.
// - `rel.startsWith('..')` (bench-repair-pass, run-artifacts' keepBatchReport, run-graph's belowRun, run-session start)
//   read an in-repository or in-run name beginning with two dots, `..x`, as outside.
// - `abs.startsWith(root + path.sep)` (doc-snapshot) breaks at a filesystem root, which already ends in a separator, so
//   every descendant of a repository at `F:\` failed the test and was skipped.
// Containment is isWithin, its one owner, or the segment test (`r === '..' || r.startsWith(`..${path.sep}`)`).
// This census scans scripts/ for both prefix spellings on code lines, so a new one fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { pruneUnder } from '../scripts/io/doc-snapshot.mjs';

// A bare two-dot prefix, and a root joined to a separator by `+` inside startsWith.
const PREFIX = /\.startsWith\(\s*(['"])\.\.\1\s*\)|\.startsWith\((?:[^()]|\([^()]*\))*\+\s*path\.sep\s*\)/;

// Each matched site left as it is, with why. A site here is a deferral recorded in the remediation's report.
const ALLOWED = {
  // Deferred (LOW): the evidence tree compared with a link's target; a run directory is never a filesystem root.
  'scripts/external-review.mjs': 1,
};

const codeLines = (src) => src.split(/\r?\n/).map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l));

test('no containment in scripts/ is decided by a character prefix', () => {
  const files = spawnSync('git', ['ls-files', 'scripts/*.mjs', 'scripts/**/*.mjs'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .stdout.split(/\r?\n/).filter(Boolean);
  assert.ok(files.length > 50, 'git listed the scripts');
  const hits = {};
  const offenders = [];
  for (const f of files) {
    for (const { l, n } of codeLines(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'))) {
      if (!PREFIX.test(l)) continue;
      hits[f] = (hits[f] ?? 0) + 1;
      offenders.push(`${f}:${n}: ${l.trim().slice(0, 120)}`);
    }
  }
  const unexplained = offenders.filter((o) => !ALLOWED[o.split(':')[0]]);
  assert.deepEqual(unexplained, [], `containment by character prefix:\n${unexplained.join('\n')}`);
  for (const [f, count] of Object.entries(ALLOWED)) assert.equal(hits[f] ?? 0, count, `${f}: the allowance no longer matches`);
});

test('the census pattern sees both spellings and not the segment test', () => {
  assert.ok(PREFIX.test("if (rel.startsWith('..')) x();"));
  assert.ok(PREFIX.test('if (abs.startsWith(path.resolve(root) + path.sep)) x();'));
  assert.ok(!PREFIX.test("if (rel === '..' || rel.startsWith(`..${path.sep}`)) x();"));
});

test('G-3: the prune at a filesystem root admits its descendants', () => {
  const root = path.parse(process.cwd()).root;
  const under = pruneUnder([root]);
  assert.equal(under(path.join(root, 'a', 'b')), true, `a descendant of ${root} is not under it`);
});
