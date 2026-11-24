// G-31: THE WIDENING THAT LET EVERY NODE READ ITS OWN BRIEF ALSO REOPENED THE RULE 2 SANDBOX.
//
// Staging runs outside the repository broke a node's ability to read its own brief -- the runtime
// refuses a path outside its cwd whatever the permission rules say -- so run-graph began appending
// the run directory to `--add-dir` for EVERY node. That is correct for a lens and wrong for exactly
// one node: the run directory holds `evidence/pre-flight/build.log` and `test.log`, which name the
// implementation's own symbols and test names. Handing those to intent-capture is handing it the
// diff it exists to precede.
//
// It was undone 42 lines from the comment stating it, which is why nobody saw it:
//   run-graph.mjs docReadDirs -- "What is deliberately withheld here is the run directory as a
//   --add-dir ROOT ... the exact context intent-capture must not have"
//
// The sweep that found it MEASURED all three halves in one run's artifacts: intent-settings.json
// granted Read on the run directory, intent-capture.status.json listed the run directory among
// add_dirs, and intent.md's own not_checked recorded the node noticing the pre-flight logs were
// readable and choosing not to read them. Rule 2 resting on a node's discretion is precisely the
// failure that narrowing its cwd to sandbox/<node-id> was built to end.
//
// EVERY EXISTING §5 ROOT IS DERIVED FROM THE REPOSITORY -- "contains the repo root", "inside a
// source_globs prefix" -- so a run staged OUTSIDE the repository satisfies all of them while
// carrying the forbidden context. Same shape as the four reachability defects that came from the
// same move: a guarantee written as "prove it relative to the repository", which out-of-tree
// satisfies more strongly while failing the test written for it.
//
// The guard lives at the ENFORCEMENT point, not in run-graph's good manners, following the rule
// spawn-node already states about the source-root check beside it. That is what makes this test
// sufficient for the caller too: run-graph cannot reintroduce the widening SILENTLY, because doing
// so now kills the intent node loudly instead of quietly enlarging its sandbox.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRunDir, runScript, REPO_ROOT, makeLink } from './helpers.mjs';

/**
 * A minimal staged run directory, with the pre-flight logs this guard exists to withhold. Staged in this repository's
 * staging root under the engine's home -- still OUTSIDE the repository, which is the shape this guard is about -- because
 * spawn-node now admits only one of the repository's runs: run-dir-trust.plan.md stage 3 (ARCHITECTURE A-28).
 */
function stagedRunDir() {
  const { dir } = repoRunDir({ prefix: 'quorate-g31-', json: { contract: { source_globs: ['scripts/**'] }, stamps: [] } });
  const rel = path.relative(REPO_ROOT, dir);   // absolute when the two sit on different drives
  assert.ok(rel.startsWith('..') || path.isAbsolute(rel), `the fixture must be staged outside the repository: ${dir}`);
  fs.mkdirSync(path.join(dir, 'sandbox', 'intent-capture'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'evidence', 'pre-flight'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'pre-flight', 'test.log'), 'promoteVerified lensLooked\n');
  fs.writeFileSync(path.join(dir, 'intent-settings.json'), JSON.stringify({ permissions: { deny: ['Grep'] } }));
  return dir;
}

function spawnIntent(dir, addDir) {
  return runScript('spawn-node.mjs', [
    '--run-dir', dir, '--repo-root', REPO_ROOT,
    '--node-id', 'intent-capture', '--mode', 'intent', '--prompt', 'x',
    '--settings', path.join(dir, 'intent-settings.json'),
    '--add-dir', addDir,
    '--print-cmd',
  ]);
}

test('the intent node is refused the run directory as --add-dir', () => {
  const dir = stagedRunDir();
  try {
    const r = spawnIntent(dir, dir);
    assert.notEqual(r.status, 0,
      'spawn-node must REFUSE, not merely decline to add: the run directory carries the pre-flight '
      + 'build and test logs, which name the implementation intent-capture must precede');
    assert.match(r.output, /run directory as --add-dir/,
      `the refusal must name what it refused and why. Got:\n${r.output.slice(-400)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('and any ANCESTOR of the run directory, which is how a staging root would arrive', () => {
  // `~/.quorate/reviews/<repo-key>/` holds every run of this project, and its parent every run of
  // every project. Neither is inside the repository, so no repository-derived root refuses them.
  const dir = stagedRunDir();
  try {
    const r = spawnIntent(dir, path.dirname(dir));
    assert.notEqual(r.status, 0, 'an ancestor contains the run directory and is just as open');
    assert.match(r.output, /run directory as --add-dir/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// G-14 of 20261025-092319-srf-review-amended: every check compared lexical paths, so a link whose own path passed them
// all while its target was the source tree opened the sandbox onto the implementation. The link sits beneath the run
// directory, the one place the guards admit by its path.
test('and a link whose target is the source tree, whatever its own path', (t) => {
  const dir = stagedRunDir();
  const link = path.join(dir, 'sandbox', 'intent-capture', 'docs-link');
  try {
    // Through makeLink (G-13 of 20261122-214154-llo-remediation-2-review): a refused kind skips by name, never fails at setup.
    if (!makeLink(t, { target: path.join(REPO_ROOT, 'scripts'), at: link, type: process.platform === 'win32' ? 'junction' : 'dir' })) return;
    const r = spawnIntent(dir, link);
    assert.notEqual(r.status, 0, `a link onto scripts/ must be refused:\n${r.output.slice(-400)}`);
    assert.match(r.output, /would expose the source tree/);
  } finally {
    try { fs.unlinkSync(link); } catch { /* not made */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// G-12 of 20261025-095239-srf-remediation-2-review: spawn-node kept its own link-aware containment (`forms`, `anyWithin`),
// which fell back to the lexical path when realpath failed while the owner, lib/finding-scope.mjs, fails closed. The rule
// has one owner, withinThroughLinks, and spawn-node's guards call it.
test('the sandbox guards use the one link-aware containment owner, and it fails closed', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  assert.ok(!/const (forms|anyWithin) = /.test(src), 'spawn-node defines no containment rule of its own');
  assert.match(src, /withinThroughLinks\(/, 'spawn-node calls the owner');
});

// G-13 of 20261025-095239-srf-remediation-2-review: the guards judged each --add-dir by its own path and target, so a
// link INSIDE the admitted floor that resolves to evidence/pre-flight, another part of the run directory, passed them all.
test('and a link inside an --add-dir that leads elsewhere in the run directory', (t) => {
  const dir = stagedRunDir();
  const floor = path.join(dir, 'sandbox', 'intent-capture');
  const link = path.join(floor, 'preflight-link');
  try {
    if (!makeLink(t, { target: path.join(dir, 'evidence', 'pre-flight'), at: link, type: process.platform === 'win32' ? 'junction' : 'dir' })) return;
    const r = spawnIntent(dir, floor);
    assert.notEqual(r.status, 0, `a link onto the pre-flight logs must be refused:\n${r.output.slice(-400)}`);
    assert.match(r.output, /run directory/);
  } finally {
    try { fs.unlinkSync(link); } catch { /* not made */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// G-17 of 20261025-104155-srf-remediation-3-review: the scan of links inside an admitted directory looked only for links
// into the run directory, so a link in the floor onto the implementation (`src -> <repo>/scripts`) passed every guard.
test('and a link inside an --add-dir that leads to the source tree', (t) => {
  const dir = stagedRunDir();
  const floor = path.join(dir, 'sandbox', 'intent-capture');
  const link = path.join(floor, 'src');
  try {
    if (!makeLink(t, { target: path.join(REPO_ROOT, 'scripts'), at: link, type: process.platform === 'win32' ? 'junction' : 'dir' })) return;
    const r = spawnIntent(dir, floor);
    assert.notEqual(r.status, 0, `a link onto scripts/ inside the floor must be refused:\n${r.output.slice(-400)}`);
    assert.match(r.output, /source tree/);
  } finally {
    try { fs.unlinkSync(link); } catch { /* not made */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // G-16 of 20261122-144505-m3s7-b3-remediation-3-review: a link in the floor to a directory that is neither the run nor
  // the source tree passed, so the floor held a door to anywhere else on the machine.
  const dir2 = stagedRunDir();
  const floor2 = path.join(dir2, 'sandbox', 'intent-capture');
  const elsewhere = fs.mkdtempSync(path.join(path.dirname(dir2), 'q-g16-elsewhere-'));
  const link2 = path.join(floor2, 'elsewhere');
  try {
    if (!makeLink(t, { target: elsewhere, at: link2, type: process.platform === 'win32' ? 'junction' : 'dir' })) return;
    const r = spawnIntent(dir2, floor2);
    assert.notEqual(r.status, 0, `a link out of the floor to an unrelated directory must be refused:\n${r.output.slice(-400)}`);
    assert.match(r.output, /leads out of the sandbox floor/);
  } finally {
    try { fs.unlinkSync(link2); } catch { /* not made */ }
    fs.rmSync(dir2, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('but the sandbox floor BENEATH the run directory is still admitted', () => {
  // The guard must refuse containers, not descendants: `<runDir>/sandbox/<node-id>` is the intent
  // node's cwd and its only legitimate root. A guard that refused everything under the run
  // directory would refuse the sandbox itself and take the whole node down with the defect.
  const dir = stagedRunDir();
  try {
    const r = spawnIntent(dir, path.join(dir, 'sandbox', 'intent-capture'));
    assert.equal(r.status, 0,
      `the node's own sandbox floor must survive the guard:\n${r.output.slice(-400)}`);
    const cmd = JSON.parse(r.stdout);
    // Plain containment, no regex: the run directory is an absolute Windows path full of
    // backslashes, and building a pattern out of it is how this assertion got written wrong twice.
    // --print-cmd writes the argv itself, a JSON array: reading `.argv` off it was always [] (G-15).
    assert.ok(Array.isArray(cmd), `--print-cmd must print the argv array: ${r.stdout.slice(0, 200)}`);
    const addDirValues = cmd.filter((_, i, a) => a[i - 1] === '--add-dir');
    // The floor this test passed must be among them, or the list read is not the child's argv and the check below
    // cannot fail (G-15 of 20261025-095239-srf-remediation-2-review).
    assert.ok(addDirValues.some((v) => path.resolve(v) === path.join(dir, 'sandbox', 'intent-capture')),
      `the floor passed as --add-dir must reach the child's argv. --add-dir: ${JSON.stringify(addDirValues)}`);
    assert.ok(!addDirValues.includes(dir),
      `the run directory must not have arrived by some other route. --add-dir: ${JSON.stringify(addDirValues)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// THROUGH THE ONE LINK-LEAVING OWNER (link-leaving-owner.plan.md stage 2): a hard-linked file in a floor was passed by two of
// the three scans (G-8 of 20261122-164811-m3s7-b3-remediation-5-review), and a floor outside the run had no hard-link check
// at all. Each refusal names the kind, so a hard link is not reported as a link into the run.
test('a hard-linked file in an --add-dir is refused, named, below the run and outside it', (t) => {
  const dir = stagedRunDir();
  const floor = path.join(dir, 'sandbox', 'intent-capture');
  const outsideFile = path.join(path.dirname(dir), `q-hl-${process.pid}-${Date.now()}.txt`);
  const outsideFloor = fs.mkdtempSync(path.join(path.dirname(dir), 'q-hl-floor-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outsideFloor, { recursive: true, force: true });
    fs.rmSync(outsideFile, { force: true });
  });
  fs.writeFileSync(outsideFile, 'content from elsewhere');
  if (!makeLink(t, { target: outsideFile, at: path.join(floor, 'same.txt'), type: 'hard' })) return;
  const below = spawnIntent(dir, floor);
  assert.notEqual(below.status, 0, `a hard link in the floor must be refused:\n${below.output.slice(-400)}`);
  assert.match(below.output, /a hard-linked file \(same\.txt\)/);
  fs.rmSync(path.join(floor, 'same.txt'));
  if (!makeLink(t, { target: outsideFile, at: path.join(outsideFloor, 'same.txt'), type: 'hard' })) return;
  const outside = spawnIntent(dir, outsideFloor);
  assert.notEqual(outside.status, 0, `a hard link in a floor outside the run must be refused:\n${outside.output.slice(-400)}`);
  assert.match(outside.output, /a hard-linked file \(same\.txt\)/);
});
