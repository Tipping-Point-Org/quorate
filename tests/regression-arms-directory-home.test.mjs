// arms-directory-home.design.md (operator, 2026-10-03: "Move it into quorate's home"): D1's cap on the arms' directory,
// reached on 20261003-183350-arms-dir-ownership-confirm-3. In the shared temp directory, every round had to prove by hand
// that a path was the run's; four rounds each opened the next edge. Under quorate's own home, ownership is location.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { armsRoot, repoKey } from '../scripts/lib/reviews-root.mjs';
import { armsBuildDir, reclaimArmsRoot } from '../scripts/io/snapshot.mjs';

const scratch = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-arms-home-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
const REPO = path.resolve(os.tmpdir(), 'q-repo-a');

// G-8 of 20261003-194617-arms-dir-home-confirm: keyed by run id alone, two repositories starting the same slug in the
// same second shared one root, and either run's reclaim could delete the other's live surface. The root carries the
// same repository key the reviews root does, and the run id is judged by isSafeRunId, its one owner.
test('the run\'s arms root is <home>/arms/<repo key>/<run-id>: two repositories never share one', () => {
  const home = path.resolve(os.tmpdir(), 'q-home');
  const id = '20261003-193459-arms-dir-home';
  assert.equal(armsRoot({ home, project: 'quorate', repoRoot: REPO, runId: id }),
    path.join(home, 'arms', repoKey('quorate', REPO), id));
  assert.notEqual(armsRoot({ home, project: 'quorate', repoRoot: REPO, runId: id }),
    armsRoot({ home, project: 'quorate', repoRoot: path.resolve(os.tmpdir(), 'q-repo-b'), runId: id }));
});

test('a run id the run-id owner refuses is refused here too', () => {
  const home = path.resolve(os.tmpdir(), 'q-home');
  for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', 'a:b', path.resolve('/x'), null]) {
    assert.throws(() => armsRoot({ home, project: 'quorate', repoRoot: REPO, runId: bad }), /run id/,
      `run id ${JSON.stringify(bad)} was accepted`);
  }
  assert.throws(() => armsRoot({ home: 'relative/home', project: 'quorate', repoRoot: REPO, runId: 'r1' }), /absolute/);
});

test('each build gets its own directory under the run\'s arms root', () => {
  const root = path.join(os.tmpdir(), 'q-root');
  const a = armsBuildDir(root), b = armsBuildDir(root);
  assert.notEqual(a, b);
  assert.equal(path.dirname(a), root);
  assert.equal(path.dirname(b), root);
});

const rootIn = (home) => armsRoot({ home, project: 'quorate', repoRoot: REPO, runId: 'r1' });

// G-4 of confirm and confirm-2, G-2/G-5/G-8 of confirm-3: a hard-killed attempt's directories are reclaimed by
// location, whole, with no record to parse and no window in which one exists unrecorded.
test('a resume removes the run\'s arms root whole: every build an earlier attempt left', (t) => {
  const home = scratch(t);
  const root = rootIn(home);
  for (const b of [armsBuildDir(root), armsBuildDir(root)]) { fs.mkdirSync(b, { recursive: true }); fs.writeFileSync(path.join(b, 'x'), 'x'); }
  const r = reclaimArmsRoot(root, { home });
  assert.equal(r.removed, true, JSON.stringify(r));
  assert.equal(fs.existsSync(root), false);
});

test('a missing arms root is nothing to do, not an error', (t) => {
  const home = scratch(t);
  assert.deepEqual(reclaimArmsRoot(rootIn(home), { home }), { removed: false });
});

// G-5 (and its symptom G-6) of 20261003-194617-arms-dir-home-confirm: only the final component was checked, so a link
// at an ANCESTOR — <home>/arms, or the repository key's directory — was followed, and the matching subtree under its
// target removed. Every component below the home is checked; a link anywhere is refused.
for (const at of ['root', 'repo key', 'arms']) {
  test(`a link at the ${at} level is refused, not followed: its target survives`, (t) => {
    const home = scratch(t);
    const root = rootIn(home);
    const level = at === 'root' ? root : at === 'repo key' ? path.dirname(root) : path.join(home, 'arms');
    const victim = path.join(home, 'victim');
    // The victim mirrors what lies below the link, so a followed link would find the run's directory there and delete it.
    const below = path.relative(level, root);
    fs.mkdirSync(path.join(victim, below), { recursive: true });
    fs.writeFileSync(path.join(victim, below, 'keep.txt'), 'KEEP');
    fs.mkdirSync(path.dirname(level), { recursive: true });
    link(victim, level);
    const r = reclaimArmsRoot(root, { home });
    assert.equal(r.removed, false);
    assert.match(String(r.refused), /link/, JSON.stringify(r));
    assert.equal(fs.readFileSync(path.join(victim, below, 'keep.txt'), 'utf8'), 'KEEP');
    fs.rmSync(level, { recursive: false, force: true });
  });
}

test('a root outside the home is refused', (t) => {
  const home = scratch(t);
  const elsewhere = path.join(scratch(t), 'arms', 'x', 'r1');
  fs.mkdirSync(elsewhere, { recursive: true });
  const r = reclaimArmsRoot(elsewhere, { home });
  assert.match(String(r.refused), /outside/);
  assert.equal(fs.existsSync(elsewhere), true);
});

// G-6 of 20261003-202230-arms-dir-home-confirm-2 (operator: "Same fix, then one more review"). Containment is asked of
// isWithin, its one owner: a hand-rolled `startsWith('..')` read a directory named `..arms` inside the home as outside it.
test('G-6: a root inside the home is inside it, whatever its directory is called', (t) => {
  const home = scratch(t);
  const root = path.join(home, '..arms', 'x', 'r1');
  fs.mkdirSync(path.join(root, 'b'), { recursive: true });
  const r = reclaimArmsRoot(root, { home });
  assert.equal(r.removed, true, JSON.stringify(r));
});

// The home itself is TRUSTED, as declared: QUORATE_HOME is the operator's chosen location and may be a link to another
// drive — refusing one would leave that operator with no panel at all. Every component BELOW it is checked. The doc
// comment said "from the home down", which promised the home was checked too.
test('G-6: a home that is a link is the operator\'s declared location, and is followed; links below it are not', (t) => {
  const d = scratch(t);
  const real = path.join(d, 'real-home');
  fs.mkdirSync(real);
  const home = path.join(d, 'home-link');
  link(real, home);
  const root = rootIn(home);
  fs.mkdirSync(path.join(root, 'b'), { recursive: true });
  const r = reclaimArmsRoot(root, { home });
  assert.equal(r.removed, true, JSON.stringify(r));
  assert.equal(fs.existsSync(path.join(real, 'arms')), true, 'more than the run\'s root was removed');
  fs.rmSync(home, { recursive: false, force: true });
});

test('G-6 and G-15: what the reclaim checks, and where the arms\' directory lives, are said as they are', () => {
  const snap = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'io', 'snapshot.mjs'), 'utf8');
  assert.doesNotMatch(snap, /from the home down/, 'the reclaim still promises the home itself is checked');
  assert.doesNotMatch(snap, /startsWith\('\.\.'\) \|\| path\.isAbsolute\(rel\)\) return \{ removed: false/, 'reclaim still rolls its own containment');
  const ext = fs.readFileSync(path.join(import.meta.dirname, '..', 'shared', 'external-reviewers.md'), 'utf8');
  assert.doesNotMatch(ext, /arm is given a directory under the system temp directory/, 'external-reviewers.md still puts the arms\' directory in the temp directory');
});

// G-7 of 20261003-211407-arms-dir-home-confirm-3 (operator: "Fix G-7 first"): the location and its cleanup were stated in
// external-reviewers.md AND in ARCHITECTURE §1, and the copies had already drifted once. ARCHITECTURE §1 owns it; the
// panel guide points. G-2 of 20261003-222343-arms-dir-home-confirm-4: the guard knew two literal phrasings and read the
// whole of ARCHITECTURE, so a paraphrase, or the location moving out of §1, passed. It now reads the one paragraph and
// the one section, refuses any wording of the path or the lifecycle there, and must catch every paraphrase planted below.
const WHICH_DIRECTORY = /\*\*Which directory that is:[^\n]*\n([\s\S]*?)(?:\n\n|$)/;
// G-13 of 20261003-230257-arms-dir-home-confirm-5: "under quorate's home" passed, and the guide said exactly that. The
// paragraph now says nothing of where the directory is — only that it is the arm's own, and who owns the rest.
const RESTATES = /arms[\\/]|<quorateHome>|quorate'?s (?:own )?home|QUORATE_HOME|\bhome director|repo key|run[- ]id|temp(?:orary)? directory|tmpdir|\bremov|\bdelet|\breclaim|\bresume|\brun ends\b|at run end|\bswept\b/i;
const section1 = (arch) => (arch.match(/\n## 1\.[^\n]*\n([\s\S]*?)\n## 2\./) ?? [, ''])[1];
const ownerSays = (s1) => /arms\/<repo key>\/<run-id>/.test(s1) && /removed when the run ends/.test(s1) && /reclaimed whole/.test(s1);

test('G-7, G-2: the panel guide points at ARCHITECTURE §1 and restates nothing of where the directory lives', () => {
  const ext = fs.readFileSync(path.join(import.meta.dirname, '..', 'shared', 'external-reviewers.md'), 'utf8');
  const para = (ext.match(WHICH_DIRECTORY) ?? [, null])[1];
  assert.ok(para, 'the "Which directory that is" paragraph is gone, so nothing points at the owner');
  assert.match(para, /ARCHITECTURE\.md[^\n]*§1/, 'the paragraph does not point at ARCHITECTURE §1');
  assert.doesNotMatch(para, RESTATES, `the paragraph restates the location or its lifecycle: ${para.match(RESTATES)?.[0]}`);
  const arch = fs.readFileSync(path.join(import.meta.dirname, '..', 'ARCHITECTURE.md'), 'utf8');
  assert.ok(ownerSays(section1(arch)), 'ARCHITECTURE §1 no longer says where the arms\' directory lives and how it is cleaned up');
});

test('G-2: the guard catches every paraphrase planted, and a location moved out of §1', () => {
  for (const planted of ['deleted at run end', 'lives in <home>/arms/<key>/<id>', 'reclaimed by its resume', 'removed afterwards',
    'a temp directory', 'under arms\\<repo key>', 'keyed by run-id', 'swept when the run ends',
    'a directory of its own under quorate\'s home', 'under quorate\'s own home', 'beneath QUORATE_HOME', 'in the home directory']) {
    assert.match(planted, RESTATES, `the guard misses a restatement: ${JSON.stringify(planted)}`);
  }
  const arch = fs.readFileSync(path.join(import.meta.dirname, '..', 'ARCHITECTURE.md'), 'utf8');
  const s1 = section1(arch);
  assert.ok(ownerSays(s1));
  const moved = arch.replace(s1, s1.replace(/arms\/<repo key>\/<run-id>/g, 'ELSEWHERE')) + '\n`<quorateHome>/arms/<repo key>/<run-id>/`\n';
  assert.equal(ownerSays(section1(moved)), false, 'a location moved out of §1 still passes');
});

test('a removal that fails is reported, never thrown into the run', (t) => {
  const home = scratch(t);
  const root = rootIn(home);
  fs.mkdirSync(root, { recursive: true });
  const r = reclaimArmsRoot(root, { home, rm: () => { throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); } });
  assert.equal(r.removed, false);
  assert.match(String(r.failed), /EBUSY/);
});

test('run-graph builds under the keyed arms root, reclaims before the panel branch, and builds nothing after a refusal', () => {
  // Source-matched, as the run-graph wiring tests in regression-arms-surface-builder are: no test drives run-graph to
  // its panel step.
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  const root = src.indexOf('const armsHome = armsRoot({ home: quorateHome(), project: contract.project, repoRoot, runId: runJson.run_id });');
  const reclaim = src.indexOf('reclaimArmsRoot(armsHome, { home: quorateHome() })');
  const branch = src.indexOf('if (panelArms.length || mayAdjudicate) {');
  assert.ok(root >= 0 && reclaim > root, 'run-graph does not reclaim the run\'s keyed arms root under quorate\'s home');
  assert.ok(branch > reclaim, 'reclaim is inside the panel branch, so a --skip-panel resume never runs it (G-6)');
  // G-11: a refused reclaim was logged and the build then followed the same link.
  assert.match(src, /if \(armsRefused\) panelBuilt = \{ ok: false, why: armsRefused, withheld: \[\] \};/,
    'a refused arms root does not stop the build');
  assert.ok(src.indexOf('if (armsRefused) panelBuilt') > branch && src.indexOf('if (armsRefused) panelBuilt') < src.indexOf('const dir = armsBuildDir(armsHome);'));
  assert.doesNotMatch(src, /arms-dirs\.json|recordArmsDir|reclaimArmsDirs|armsDirFor\(os\.tmpdir\(\)/, 'the record mechanism is still in run-graph');
});

test('ARCHITECTURE §1 names quorate\'s home arms directory among the places quorate keeps state (G-1)', () => {
  const arch = fs.readFileSync(path.join(import.meta.dirname, '..', 'ARCHITECTURE.md'), 'utf8');
  assert.match(arch, /stores no state outside[\s\S]{0,400}arms/);
});
