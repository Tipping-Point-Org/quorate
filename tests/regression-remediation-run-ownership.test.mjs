// WHO OWNS WHAT IN A REMEDIATION RUN (remediation-run-ownership.plan.md; design decided, operator 2026-10-09: D1 "Runner
// folder (Recommended)", D2 "Lock file (Recommended)", D3 "Pass them (Recommended)"). remediation-paths' delivery review
// reached the round cap in three rounds, every finding at what the runner reads and writes beside the node.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planClusterCommits } from '../scripts/lib/remediation-chain.mjs';

// ------------------------------------------------------------------ stage 1 (D3): refused at the start reaches the planner
// G-9 (a) of 20261009-014530-remediation-paths-r2: dirty_at_start.refused was recorded and never passed on, so a
// repository the operator had changed, turned into plain files by the node, had those files committed. The repository
// sits inside source_globs and the cluster carries a test, so at HEAD the file is otherwise committable.
const CONTRACT = { source_globs: ['src/**'], test_globs: ['tests/**'] };
const group = { group_id: 'G-1', disposition: 'fixed', cluster: 'c1', files: ['src/vendor/x.js', 'tests/a.test.js'], red_evidence: 'r' };

test('stage 1: a file inside a repository refused at the start is refused, and the reason says so', () => {
  const [c] = planClusterCommits({ caseInsensitive: false, 
    groups: [group],
    status: { files: ['src/vendor/x.js', 'tests/a.test.js'], refused: [] },
    dirtyAtStart: [], refusedAtStart: [{ path: 'src/vendor/', reason: 'a nested repository: another repository, not a file' }],
    contract: CONTRACT,
  });
  const r = c.refused.find((x) => x.path === 'src/vendor/x.js');
  assert.ok(r, JSON.stringify(c.refused));
  assert.match(r.reason, /refused at the start/);
  assert.equal(c.committable, false);
});

// ------------------------------------------------------------------ stage 2 (D1): the runner's folder
// G-9 of 20261009-021636-remediation-paths-r3: the runner wrote into evidence/remediation/, the node's folder and the
// admission rule for a fix's evidence. Every write the runner makes for itself goes through runnerPath(), rooted at
// evidence/remediation-runner/; the other writes are named here and fixed. A writer of any other kind fails the test.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const WRITERS = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'openSync', 'rmSync', 'unlinkSync', 'writeJsonAtomic'];
// Any other fs call that can create, change or remove a file is unknown to this test, and fails it until it is listed.
// By VERB, sync, callback and promise alike (G-13 of 20261009-035141-run-ownership-review): the first list named only
// sync and stream calls, so fs.rename, fs.appendFile and fs.promises.* passed.
const FS_CALL = /\b(?:fs(?:\.promises)?|fsp)\.(\w+)\s*\(/g;
const WRITE_VERB = /write|append|rename|^rm|unlink|mkdir|mkdtemp|copy|^cp|symlink|link|truncate|chmod|chown|utimes|^open/i;
const unknownWriter = (line) => [...line.matchAll(FS_CALL)].some((m) => WRITE_VERB.test(m[1]) && !WRITERS.includes(m[1]));
// The named fixed writes (plan stage 2): run.json through saveRun, the brief and its nodes/ folder, and the lock.
const FIXED = new Set([
  "path.join(dir, 'run.json')",
  "path.join(runDir, 'nodes')",
  "path.join(runDir, 'nodes', 'remediation-brief.md')",
  'lockPath',
]);

// The text of each argument of the call that opens at `open` (the index of its "("), split at top-level commas.
function callArgs(src, open) {
  const args = [];
  let depth = 0, start = open + 1, quote = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) { args.push(src.slice(start, i).trim()); return args; }
    } else if (ch === ',' && depth === 1) { args.push(src.slice(start, i).trim()); start = i + 1; }
  }
  throw new Error(`unclosed call at ${open}`);
}

export function runnerWriteViolations(src) {
  const out = [];
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const re = new RegExp(`\\b(?:fs\\.)?(${WRITERS.join('|')})\\s*\\(`, 'g');
  for (const m of src.matchAll(re)) {
    if (/^\s*(?:import|export)\b/.test(src.slice(src.lastIndexOf('\n', m.index) + 1, m.index + m[0].length))) continue;
    const open = m.index + m[0].length - 1;
    const args = callArgs(src, open);
    const fn = m[1];
    const ok = (a) => a.startsWith('runnerPath(') || FIXED.has(a);
    if (fn === 'renameSync') {
      if (args[0] !== 'payloadPath') out.push(`${lineOf(m.index)}: renameSync source ${args[0]}`);
      if (!ok(args[1])) out.push(`${lineOf(m.index)}: renameSync destination ${args[1]}`);
    } else if (!ok(args[0])) out.push(`${lineOf(m.index)}: ${fn} ${args[0]}`);
  }
  for (const [i, l] of src.split('\n').entries()) if (unknownWriter(l)) out.push(`${i + 1}: an fs writer this test does not know`);
  return out;
}

test('stage 2: every write remediate.mjs makes is a runnerPath() or a named fixed write', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  assert.deepEqual(runnerWriteViolations(src), []);
});

test('stage 2: the scanner itself catches a write under the node\'s folder, an unknown writer, and a bad rename', () => {
  const v = runnerWriteViolations([
    "fs.writeFileSync(path.join(runDir, 'evidence', 'remediation', 'x.log'), 'x');",
    "fs.copyFileSync(a, b);",
    "fs.renameSync(other, runnerPath('attempt-1', 'payload.json'));",
    "fs.writeFileSync(runnerPath('commit-c1-1.log'), out);",
  ].join('\n'));
  assert.equal(v.length, 3, JSON.stringify(v));
});

// runnerPath's rule, in the lib so it can be tested: written with the code, checked by mutation
// (evidence/rro-s2-runnerpath-mutation-red.txt).
import { runnerPathIn } from '../scripts/lib/remediation-chain.mjs';
test('stage 2: runnerPath stays in evidence/remediation-runner/ and refuses .. and an absolute part', () => {
  const root = path.resolve('run');
  assert.equal(runnerPathIn(root, 'attempt-1', 'payload.json'), path.join(root, 'evidence', 'remediation-runner', 'attempt-1', 'payload.json'));
  for (const bad of ['..', '../remediation/x.log', 'a/../../x', path.resolve('elsewhere')]) assert.throws(() => runnerPathIn(root, bad), /leave the runner's folder/, bad);
});

// ------------------------------------------------------------------ stage 4: documents
// The contract doc owns these artifacts: the runner's folder, the lock and its phases, clusters' `output?` (G-11/G-10 of
// 20261009-021636-remediation-paths-r3), and the mint's refusal of an unreadable reconcile payload. The skill tells a
// person what a stale lock means.
test('stage 4: the contract rows and the skill document the runner folder, the lock and the payload refusal', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8').split('\n');
  const runner = doc.find((l) => l.startsWith('| `scripts/remediate.mjs`'));
  assert.match(runner, /evidence\/remediation-runner\//);
  assert.match(runner, /remediate\.lock/);
  for (const phase of ['started', 'node-running', 'node-ran', 'saved']) assert.match(runner, new RegExp(`\`${phase}\``), phase);
  assert.match(runner, /exit 6/);
  // `pending_retry?` and `unrecorded?` added by remediation-commit-recovery (G-10 of 20261011-005705-commit-recovery-r2;
  // its round-cap design step).
  // `attempting?` and `seq` added by G-9 of 20261011-031727-commit-recovery-design-review.
  // `fmt_turned_red?` added by G-3 of 20261017-212703-fmt-remediation-2-review (a field, not a sentence to parse).
  // `readmitted?` added by the shape --readmit-evidence writes on a planned cluster (scripts/remediate.mjs).
  assert.match(runner, /clusters: \[\{id, merged_from, groups, accepted, refused, notes, commit, reason\?, output\?, pending_retry\?, fmt_turned_red\?, unrecorded\?, attempting\?, readmitted\?, seq\}\]/);
  const mint = doc.find((l) => l.startsWith('| `scripts/new-run.mjs --remediates'));
  assert.match(mint, /readable `evidence\/reconcile\/payload\.json` with a groups list/);
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'remediate', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(skill, /remediate\.lock/);
  assert.match(skill, /only `"started"` means the node never ran/);
});

// G-13 of 20261009-035141-run-ownership-review: the guard claimed any unknown fs writer fails it, but its list named only
// sync and stream calls; fs.rename, fs.appendFile and fs.promises.* passed. Red against the old list.
test('r1: the writer guard catches async and promise writers too', () => {
  for (const line of ["fs.rename(a, b, cb);", "fs.appendFile(p, 'x', cb);", "await fs.promises.writeFile(p, 'x');", "await fsp.rm(p);"]) {
    assert.equal(runnerWriteViolations(line).length, 1, line);
  }
});

// G-12: the lock-order test matched only the literal readRun(runDir), so any other read of run.json before the lock
// passed. Every read before the lock's creation is found: a readFileSync of any kind, or a readRun( call that is not
// readRun's own definition.
// The lock is the run owner's exclusive create since run-dir-descendants.plan.md stage 2 (it was writeFileSync with `wx`).
export function preLockReads(src) {
  const lock = src.search(/owner\.create\(\['remediate\.lock'\], /);
  if (lock === -1) return ['no lock'];
  const before = src.slice(0, lock).split('\n');
  return before.map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /\breadFileSync\s*\(/.test(l) && !/^const readRun = /.test(l.trim()) || /\breadRun\s*\(/.test(l) && !/^const readRun = /.test(l.trim()))
    .map(({ l, n }) => `${n}: ${l.trim()}`);
}
test('r1: nothing reads run.json before the lock, in any spelling', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  assert.deepEqual(preLockReads(src), []);
  const lockLine = "try { owner.create(['remediate.lock'], '{}'); } catch {}";
  for (const early of ["const r = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));", 'const r = readRun(args.runDir);']) {
    assert.equal(preLockReads(`${early}\n${lockLine}\nconst run = readRun(runDir);`).length, 1, early);
  }
});

// G-8, G-11, G-9 of 20261009-035141-run-ownership-review: the contract said the lock is released on exit AND never
// removed automatically; the skill sent a reader to payload.json for a commit the runner records in run.json; the run
// layout omitted the runner's folder and the lock.
test('r1: the lock has one rule, the skill points at run.json for commits, the layout names the runner\'s files', () => {
  const runner = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8').split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`'));
  assert.doesNotMatch(runner, /released on exit unless[^.]*and is never removed automatically/);
  assert.match(runner, /an orderly exit releases it/);
  assert.match(runner, /exits 7/);
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'remediate', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.doesNotMatch(skill, /green evidence, the commit,/);
  assert.match(skill, /The commits are the runner's, in `<remediation run>\/run\.json`/);
  const layout = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8');
  assert.match(layout, /^ {2}evidence\/remediation-runner\//m);
  assert.match(layout, /^ {2}remediate\.lock/m);
});

// G-3 of 20261009-041724-run-ownership-r1: the lock was created EMPTY and its {pid, started_at, phase} written a step
// later, so a kill in between left a lock with no phase to diagnose. Created with its content, exclusively, in one call.
test('r2: the lock is created exclusively WITH its content, in one call', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  assert.doesNotMatch(src, /openSync\(lockPath, 'wx'\)/, 'no empty create');
  // Through the run owner's exclusive create since run-dir-descendants.plan.md stage 2: one call, content included.
  assert.match(src, /owner\.create\(\['remediate\.lock'\], JSON\.stringify\(\{[^;]*phase: 'started'[^;]*\}\)\)/s);
});

// G-10, G-11 of 20261009-041724-run-ownership-r1: a lock whose removal failed stays at phase `saved` — the run finished
// and recorded everything — and neither the layout nor the skill said so, sending the operator to look for edits.
test('r2: the layout and the skill name a lock left at saved by a failed removal', () => {
  const layout = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(layout, /remediate\.lock [^|]*`saved`[^|]*removal failed/);
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'remediate', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(skill, /`"saved"` means the run finished and recorded everything/);
});
