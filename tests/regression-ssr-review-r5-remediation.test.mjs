// Remediation of review 20260929-181033-ssr-review-r5 (operator, 2026-09-29: "1 A, 2 fix, 3 fix, 4 as suggested, 5 yes").
// Option A makes "nothing a seed throws ends the benchmark" STRUCTURAL: the serial loop catches, every cleanup step
// is guarded and said, and QUORATE_HOME is resolved once at startup. Two attempts to close this by listing calls
// before a seed's try each missed one (G-6 of ssr-review-r4, then G-8 here). Also G-4 (a seed name joined into paths
// unchecked), G-5 (a preserved anchor read outside the recreated tree) and G-11 (a --keep message for no copy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const BSO = path.join(REPO, 'scripts', 'bench-second-opinion.mjs');
const src = () => fs.readFileSync(BSO, 'utf8');
const env = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'GRAPH_NODE_DEPTH' && k !== 'QUORATE_BENCH')), ...extra });
// A preserved pass to run the dry run against. bench/results' run directories are local, not tracked.
const RESULTS = path.join(REPO, 'bench', 'results');
const latest = fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS).filter((f) => /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/.test(f)).sort().pop() : null;
const seedWithRun = latest && JSON.parse(fs.readFileSync(path.join(RESULTS, latest), 'utf8')).scores
  ?.map((s) => s.seed).find((s) => fs.existsSync(path.join(RESULTS, `${latest.replace(/\.json$/, '')}-${s}-run`)));
const noPreserved = !seedWithRun && 'no preserved benchmark run on this machine (bench/results run directories are not tracked)';

// G-8: the home is one setting for the whole process, resolved once. A bad one refuses at startup — before any seed
// starts — instead of throwing out of the first seed that reaches it.
test('G-8: a relative QUORATE_HOME refuses at startup, before any seed starts', { skip: noPreserved }, () => {
  const r = spawnSync(process.execPath, [BSO, '--dry-run', '--seed', seedWithRun], { encoding: 'utf8', env: env({ QUORATE_HOME: 'relative-home' }), cwd: REPO });
  assert.notEqual(r.status, 0, 'a relative QUORATE_HOME was accepted');
  assert.doesNotMatch(r.stdout, /== seed/, `a seed started before the home was checked:\n${r.stdout}`);
  assert.match(r.stderr, /QUORATE_HOME/, `the refusal does not name the setting:\n${r.stderr}`);
});

// G-4: a seed name from a --from file becomes a path segment; one that is not a single safe segment is refused by name.
test('G-4: a seed name that is not a single safe path segment is NOT RUN for that reason', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-ssr5-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const from = path.join(d, '2026-01-01T00-00-00-000Z.json');
  fs.writeFileSync(from, JSON.stringify({ scores: [{ seed: '../escape', defect_line: 1 }] }));
  const r = spawnSync(process.execPath, [BSO, '--dry-run', '--from', from], { encoding: 'utf8', env: env(), cwd: REPO });
  assert.match(`${r.stdout}${r.stderr}`, /not a (single )?safe path segment/, `an unsafe seed name was not refused by name:\n${r.stdout}${r.stderr}`);
});

// A: the serial loop is the one place that holds the guarantee, so it holds for calls nobody listed.
test('A: the serial loop catches whatever a seed throws, and does not record a seed twice', () => {
  const s = src();
  // Anchored on the one call of runSeed: the file has another `for (const c of candidates)` loop, over settings.
  const at = s.indexOf('await runSeed(c)');
  assert.ok(at > 0, 'the serial loop was not found');
  const loop = s.slice(s.lastIndexOf('for (const c of candidates)', at), at + 700);
  assert.match(loop, /try \{[\s\S]*await runSeed\(c\)[\s\S]*\} catch/, 'the serial loop does not catch a seed that throws');
  assert.match(loop, /notRun\.push/, 'a seed the loop catches is not recorded as NOT RUN');
  assert.match(loop, /perSeed\.some|already recorded|recorded\(/, 'the loop can record a seed that already recorded itself');
});

// G-10 (and G-9 of ssr-review-r2): every cleanup step is guarded, and a failure is said, not swallowed.
test('G-10: the seed\'s cleanup swallows nothing and cannot throw', () => {
  const s = src();
  const start = s.indexOf('async function runSeed(');
  const fin = s.slice(s.indexOf('} finally {', start), s.indexOf('\n}\n', s.indexOf('} finally {', start)));
  assert.doesNotMatch(fin, /\.catch\(\(\) => \{\}\)/, 'an empty catch swallows a failed worktree removal');
  // Guarded means inside a try on the line, or passed to the finally's own cleanup() guard, whose body is a try.
  assert.match(fin, /const cleanup = \(what, step\) => \{\s*try \{ return step\(\); \} catch/, 'the cleanup guard is not a try');
  const unguarded = fin.split('\n').filter((l) => /fs\.rmSync\(/.test(l) && !/\btry \{/.test(l) && !/cleanup\('[^']*', \(\) => fs\.rmSync\(/.test(l));
  assert.deepEqual(unguarded, [], 'a cleanup step that can throw out of finally');
});

// G-5: the misanchor destination is read only inside the recreated tree. THROUGH readInTree (usage-report-followup.plan.md
// stage 2; G-3 of 20261031-033859-urr-remediation-2-review): a containment check followed by a raw read left a window in
// which the path could be swapped for a link. The read is reached only on a live forge, which spends, so this holds the
// call; what readInTree refuses is held by tests/regression-bench-tree-reads.test.mjs's defect.file case.
test('G-5: the forge reads a preserved anchor\'s file only through readInTree, never joined and read raw', () => {
  const s = src();
  assert.doesNotMatch(s, /path\.join\(wt, to\.file\)/, 'the destination is joined onto the tree raw');
  assert.match(s, /readInTree\(wt, to\.file\)/, 'the destination is not read through readInTree');
});

// G-11: --keep reports a copy only when one exists.
test('G-11: --keep says a copy was kept only if it exists', () => {
  const s = src();
  assert.match(s, /args\.keep && copy && fs\.existsSync\(copy\)/, '--keep reports a copy that was never made');
});
