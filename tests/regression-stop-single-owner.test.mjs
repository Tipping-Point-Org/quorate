// stopping-a-child.plan.md stage 4b — ONE OWNER, ENFORCED. Beside regression-self-location's single-owner test, and for
// the same reason: four reviews running found the same kill-path defect in a different launcher each time, because "how
// is this child stopped, and what is said about it" was answered separately in run-child, spawnCapture, killAllLive and
// the reaper (stopping-a-child.design.md). Stages 1–4 moved every answer into scripts/io/stop-child.mjs; this test is what
// keeps a fifth launcher from growing its own. It is also the guard open question 2's restart rests on: D1's round count
// restarted at this delivery, and only this test shows the design did not merely re-patch the same launchers.
//
// The rule, over every script:
//   1. Nothing but io/stop-child.mjs and scripts/platform/ calls killTree.
//   2. Nothing but scripts/platform/ calls .kill( — child.kill or process.kill — the platform is where a signal is sent.
//   3. Nothing but io/stop-child.mjs keeps its own escalation or death deadline: no literal handed to escalateAfterMs,
//      deathGraceMs or deadlineMs, and no ESCALATE / DEATH_GRACE / SETTLE constant declared elsewhere.
//   4. lib/reap.mjs is the stated exception to "only the owner decides": it calls the injected io.stop and io.confirmGone
//      (renamed from its injected killTree) and imports no primitive.
//   5. Every launcher whose child the owner may have to stop starts it as a killable tree (killableSpawnOptions): on
//      posix the owner's group kill reaches nothing else. Stage 3 found the adjudicators' spawn without it.
//
// OUT OF SCOPE, stated rather than silently exempt: a SYNCHRONOUS child's deadline — spawnSync's `timeout` and
// `killSignal`, as in capture (S6) and external-review (S7) — is Node's own kill, which no asynchronous owner can stand
// in for. Making those asynchronous is outside this plan (design §5), and S7's shell:true survivor is ledgered as the case
// to revisit. They are not matched by any rule below, so nothing here pretends to cover them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SCRIPTS = path.join(import.meta.dirname, '..', 'scripts');
const rel = (f) => path.relative(SCRIPTS, f).split(path.sep).join('/');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(mjs|js)$/.test(e.name) ? [p] : [];
  });
}

// Comments are where this codebase explains its history, and they name every primitive they replaced; only code counts.
// A line comment starts at `//` preceded by start-of-line or whitespace, so a URL inside a string is left alone; a block
// comment only where it opens a line, because a glob string such as 'scripts/**' contains `/*` and the first version of
// this function ate the code from there to the next `*/`, blinding the launch check.
function code(src) {
  return src.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
}

const FILES = walk(SCRIPTS).map((f) => ({ file: rel(f), src: code(fs.readFileSync(f, 'utf8')) }));
const OWNER = 'io/stop-child.mjs';
const inPlatform = (f) => f.startsWith('platform/');

// EVERY matching line, not the first per file: a file with two private kills that lost one would still read as the same
// single hit, and the plan names run-graph's two separately.
const hits = (re, allowed) => FILES.filter(({ file }) => !allowed(file)).flatMap(({ file, src }) =>
  src.split('\n').flatMap((l, i) => (re.test(l) ? [`${file}:${i + 1}`] : [])));

// Both primitives, the asynchronous killTree and the exit hook's synchronous killTreeNow (G-10, G-1 of
// 20261106-190129-nbk-remediation-review: the pattern matched only `killTree(`, so a killTreeNow caller passed).
const KILL_TREE_CALL = /\bkillTree(?:Now)?\s*\(/;
test('stage 4b: nothing but the owner and the platform calls killTree or killTreeNow', () => {
  for (const call of ['killTree(1)', 'proc.killTreeNow(1)', 'killTreeNow (1)']) assert.match(call, KILL_TREE_CALL, `${call} is not seen`);
  const found = hits(KILL_TREE_CALL, (f) => f === OWNER || inPlatform(f));
  assert.deepEqual(found, [], `a second place stops children its own way: ${found.join(', ')}`);
});

test('stage 4b: nothing but the platform sends a signal with .kill(', () => {
  const found = hits(/\.kill\s*\(/, inPlatform);
  assert.deepEqual(found, [], `a signal is sent outside scripts/platform: ${found.join(', ')}`);
});

test('stage 4b: nothing but the owner keeps an escalation or a death deadline of its own', () => {
  const literal = hits(/\b(escalateAfterMs|deathGraceMs|deadlineMs)\s*[:=]\s*\d/, (f) => f === OWNER);
  assert.deepEqual(literal, [], `a deadline is decided outside ${OWNER}: ${literal.join(', ')}`);
  const declared = hits(/\b(const|let|var)\s+\w*(ESCALATE|DEATH_GRACE|SETTLE)\w*\s*=/, (f) => f === OWNER);
  assert.deepEqual(declared, [], `an escalation or grace constant is declared outside ${OWNER}: ${declared.join(', ')}`);
});

test('stage 4b: killTreeOf, the last private copy, does not come back', () => {
  const found = hits(/\bkillTreeOf\b/, () => false);
  assert.deepEqual(found, [], found.join(', '));
});

test('stage 4b: lib/reap.mjs, the stated exception, calls only the injected stop and wait', () => {
  const reap = FILES.find((f) => f.file === 'lib/reap.mjs');
  assert.ok(reap, 'lib/reap.mjs is gone; the exception names a file that no longer exists');
  assert.match(reap.src, /\bstop\s*\(/, 'the reaper no longer stops a held child through the injected io.stop');
  assert.match(reap.src, /\bconfirmGone\s*\(/, 'the reaper no longer watches a recorded pid through the injected io.confirmGone');
  // No primitive and no I/O layer. It may import a PURE lib/ module — since stopping-a-child-vocabulary it takes its
  // sentences from lib/stop-vocabulary.mjs — and regression-lib-takes-io refuses io/ and platform/ imports in lib/ anyway.
  assert.doesNotMatch(reap.src, /\bkillTree(?:Now)?\b/, 'the pure reaper reaches a primitive');
  assert.doesNotMatch(reap.src, /from\s+['"]\.\.\/(io|platform)\//, 'the pure reaper imports the I/O or platform layer');
});

// Each call whose child joins `live` or is run by runChild — the children the owner stops — read as its whole argument
// list, so an options object several lines below the command is still seen.
function callsOf(src, name) {
  const out = [];
  for (let i = src.indexOf(`${name}(`); i !== -1; i = src.indexOf(`${name}(`, i + 1)) {
    if (/[\w.]/.test(src[i - 1] ?? '') || /function\s+$/.test(src.slice(Math.max(0, i - 12), i))) continue;
    let depth = 0;
    let j = i + name.length;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    out.push({ line: src.slice(0, i).split('\n').length, text: src.slice(i, j + 1) });
  }
  return out;
}

test('stage 4b: every child the owner may have to stop is started as a killable tree', () => {
  const rg = FILES.find((f) => f.file === 'run-graph.mjs').src;
  const sn = FILES.find((f) => f.file === 'spawn-node.mjs').src;
  const launches = [
    ...callsOf(rg, 'spawnCapture').map((c) => ({ ...c, file: 'run-graph.mjs' })),
    ...callsOf(sn, 'runChild').map((c) => ({ ...c, file: 'spawn-node.mjs' })),
  ];
  // The arms, the adjudicators, and spawn-node's model child: if any of these stops being found, the check is blind.
  assert.ok(launches.filter((c) => c.file === 'run-graph.mjs').length >= 2, 'the panel arm and adjudicator spawns were not found');
  assert.ok(launches.some((c) => c.file === 'spawn-node.mjs'), 'spawn-node\'s runChild call was not found');
  const bare = launches.filter((c) => !c.text.includes('killableSpawnOptions()')).map((c) => `${c.file}:${c.line}`);
  assert.deepEqual(bare, [], `a child is started outside its own process group, where the owner's kill cannot reach what it starts: ${bare.join(', ')}`);
  // spawnNode's own spawn, in run-graph, is a plain spawn() and is held in `live`.
  const spawnNode = rg.slice(rg.indexOf('function spawnNode('), rg.indexOf('function readStatus('));
  assert.match(spawnNode, /killableSpawnOptions\(\)/, 'spawnNode starts spawn-node outside its own process group');
});
