// decision-records.plan.md stage 6 (design DR-D5 A; ARCHITECTURE.md A-30): every path below .claude/decisions is opened
// through the one owner, `confined` (scripts/lib/confined-path.mjs), so a link or junction standing at the folder, at a
// decision's directory, or at a file in it is refused rather than followed (G-9 of 20261101-042446-ar-remediation-4-review;
// G-6, G-15 earlier). Each case plants a decision OUTSIDE the repository and reaches it through a link: before this stage,
// decide.mjs read and wrote it as though it were the repository's own. No seat and no model is reached from this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript } from './helpers.mjs';
import { runDecision, finalOutcome } from '../scripts/io/decision-run.mjs';

const ID = '20261101-000000-abcdef';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function repo() {
  const dir = tmp('decide-conf-');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/decisions/\n');
  git('add', '-A'); git('commit', '-qm', 'init');
  return dir;
}
/** A decision that ended postponed, in `root`/<ID>. */
function plant(root) {
  const d = path.join(root, ID);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'question.json'), JSON.stringify({ question: 'Outside?', options: [{ label: 'A' }, { label: 'B' }], category: 'delegable' }));
  fs.writeFileSync(path.join(d, 'outcome.json'), JSON.stringify({ outcome: 'postponed', entry: null }));
  return d;
}
const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');

test('a link standing at .claude/decisions is refused, never followed', () => {
  const dir = repo(); const outside = tmp('decide-outside-');
  try {
    plant(outside);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    link(outside, path.join(dir, '.claude', 'decisions'));
    const pending = runScript('decide.mjs', ['--pending', '--repo-root', dir]);
    assert.notEqual(pending.status, 0, `the linked folder was read: ${pending.output}`);
    assert.match(pending.output, /confined path refused|link/i);
    const over = runScript('decide.mjs', ['--overrule', ID, '--operator-quote', 'no', '--repo-root', dir]);
    assert.notEqual(over.status, 0);
    assert.equal(fs.existsSync(path.join(outside, ID, 'overrule.json')), false, 'nothing was written through the link');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('a link standing at a decision\'s directory is refused, never followed', () => {
  const dir = repo(); const outside = tmp('decide-outside-');
  try {
    const real = plant(outside);
    fs.mkdirSync(path.join(dir, '.claude', 'decisions'), { recursive: true });
    link(real, path.join(dir, '.claude', 'decisions', ID));
    const over = runScript('decide.mjs', ['--overrule', ID, '--operator-quote', 'no', '--repo-root', dir]);
    assert.notEqual(over.status, 0, `the linked decision was overruled: ${over.output}`);
    assert.equal(fs.existsSync(path.join(real, 'overrule.json')), false, 'nothing was written through the link');
    const pending = runScript('decide.mjs', ['--pending', '--repo-root', dir]);
    assert.doesNotMatch(pending.output, /Outside\?/, 'a linked decision is not listed as this repository\'s');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('runDecision writes and finalOutcome reads through the owner: a link at the record is refused', async () => {
  const root = tmp('decide-rec-'); const outside = tmp('decide-outside-');
  try {
    link(outside, path.join(root, 'rec'));
    await assert.rejects(() => runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
      question: { question: 'q', options: [{ label: 'A' }, { label: 'B' }] }, recordDir: path.join(root, 'rec'), seed: 'x', seats: ['s1'],
      context: '', caps: { cap: 1, hardCap: 1 }, runSeat: async () => null, runModerator: async () => null }), /confined path refused/);
    assert.equal(fs.readdirSync(outside).length, 0, 'nothing was written through the link');
    fs.writeFileSync(path.join(outside, 'outcome.json'), JSON.stringify({ outcome: 'postponed' }));
    assert.throws(() => finalOutcome(path.join(root, 'rec')), /confined path refused/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

// THE ROOTS AS NAMED, NEVER THEIR REAL PATHS (G-12 of 20261102-231209-rbr-remediation-6-review, with G-10, G-11, G-7, G-4,
// G-2): runDecision rooted the scratch owner at realpathSync(scratchRoot), moveScratchIntoRecord at realpathSync(scratch)
// and then deleted the resolved target, and recordStore's default at realpathSync(the record's parent). A link at any of
// those roots was resolved before `confined` could see it.
const ask = (extra) => runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
  question: { question: 'q', options: [{ label: 'A' }, { label: 'B' }] }, seed: 'x', seats: ['s1'],
  context: '', caps: { cap: 1, hardCap: 1 }, runModerator: async () => null, ...extra });

test('a link standing at the scratch root is refused, never followed (G-10)', async () => {
  const root = tmp('decide-scr-'); const outside = tmp('decide-outside-');
  try {
    link(outside, path.join(root, 'scratch'));
    await assert.rejects(() => ask({ recordDir: path.join(root, 'rec'), scratchRoot: path.join(root, 'scratch'),
      runSeat: async (s, p, r, scratch) => { fs.writeFileSync(path.join(scratch, 'e.txt'), 'x'); return null; } }), /confined path refused/);
    assert.equal(fs.readdirSync(outside).length, 0, 'nothing was made through the linked scratch root');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('a seat scratch replaced by a link is neither copied nor deleted through it (G-12)', async () => {
  const root = tmp('decide-scr-'); const victim = tmp('decide-victim-');
  try {
    fs.writeFileSync(path.join(victim, 'keep.txt'), 'operator data');
    fs.mkdirSync(path.join(root, 'scratch'));
    await ask({ recordDir: path.join(root, 'rec'), scratchRoot: path.join(root, 'scratch'),
      runSeat: async (s, p, r, scratch) => { fs.rmSync(scratch, { recursive: true }); link(victim, scratch); return null; } }).catch(() => {});
    assert.equal(fs.existsSync(path.join(victim, 'keep.txt')), true, 'the linked target was deleted');
    assert.equal(fs.existsSync(path.join(root, 'rec', 'evidence-r1-s1', 'keep.txt')), false, 'the linked target was copied into the record');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(victim, { recursive: true, force: true }); }
});

test('recordStore\'s default root: a link at the record\'s parent is refused (G-11)', async () => {
  const root = tmp('decide-par-'); const outside = tmp('decide-outside-');
  try {
    link(outside, path.join(root, 'parent'));
    await assert.rejects(() => ask({ recordDir: path.join(root, 'parent', 'rec'), runSeat: async () => null }), /confined path refused/);
    assert.equal(fs.readdirSync(outside).length, 0, 'nothing was written through the linked parent');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('no owner is rooted at a resolved real path in the decision run or the bench (G-4, G-2)', () => {
  const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  for (const f of ['scripts/io/decision-run.mjs', 'scripts/bench-second-opinion.mjs', 'scripts/decide.mjs']) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    assert.doesNotMatch(src, /confined\(\s*fs\.realpathSync/, `${f}: an owner rooted at realpathSync(...)`);
    assert.doesNotMatch(src, /const\s+(\w+)\s*=\s*fs\.realpathSync\([^)]*\);\s*\n\s*const\s+\w+\s*=\s*confined\(\1\)/, `${f}: a real path passed to confined`);
  }
});
