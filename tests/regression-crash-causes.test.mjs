// A $69.49 SWEEP THREW AWAY THE THREE ERRORS THAT EXPLAINED WHY IT THREW.
//
// The consumer-mount gate run reached the adjudication panel with five genuine lens-vs-arm disputes
// and two judges. Both vendors answered correctly and agreed. The phase threw anyway, and every
// artifact that could have said why holds one sentence: "the adjudication phase threw (3 pool
// workers failed)".
//
// `runPool` throws an `AggregateError` whose `.errors` holds one real error, with its stack, per
// failed worker. The catch did `String(e)` — which renders the COUNT and drops the array — so the
// three causes were inside the object being stringified at the moment they became the only evidence
// that would ever exist. Reproducing them costs another sweep.
//
// While fixing it, the same loss turned up one phase earlier and worse: `await panelPromise` had NO
// catch, and `spawnPanelArm` is 22k of logic with two inner catches and no wrapper. Anything it threw
// became an unhandled rejection at the top level of an ESM module, which takes the process out — no
// gate.json, no gate.md, no verdict at all, on a run that had already paid for every lens. This
// system's central rule is that silence is not a verdict; a crash before the gate is the loudest
// silence available.
//
// So the unwrapping is a tested function rather than prose retyped at each catch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { crashCauses, crashSummary, crashRecord } from '../scripts/lib/crash.mjs';

const GRAPH = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');

test('an AggregateError yields its members, not its count', () => {
  // The exact shape lib/pool.mjs throws.
  const a = new TypeError('votesByGroup.get(...) is undefined');
  const b = new Error('EPERM: operation not permitted, rename');
  const agg = new AggregateError([a, b], '2 pool workers failed');

  assert.deepEqual(crashCauses(agg), [a, b]);
  // The defect, stated as the contrast that matters: the old rendering said nothing either cause said.
  assert.equal(String(agg.message), '2 pool workers failed');
  assert.match(crashSummary(crashCauses(agg)), /TypeError: votesByGroup/);
  assert.match(crashSummary(crashCauses(agg)), /EPERM/);
});

test('a cause chain and a lone error both reduce to a list', () => {
  const root = new Error('ENOENT: no such file or directory');
  const wrapper = new Error('could not write the ruling', { cause: root });
  assert.deepEqual(crashCauses(wrapper), [wrapper, root]);
  assert.deepEqual(crashCauses(root), [root]);
  assert.deepEqual(crashCauses(null), [], 'nothing thrown is nothing to record');

  // A non-Error throw is KEPT. Something threw it, and wrapping it in an invented Error would hide
  // what the thrower actually said.
  assert.deepEqual(crashCauses('a bare string'), ['a bare string']);
  assert.match(crashSummary(crashCauses('a bare string')), /thrown string: a bare string/);
});

test('a cyclic cause chain cannot hang the code that records the crash', () => {
  // This runs inside a catch block. A stack overflow while recording why something failed replaces
  // the diagnosis with a second, less useful one.
  const a = new Error('a');
  const b = new Error('b', { cause: a });
  a.cause = b;
  const causes = crashCauses(a);
  assert.ok(causes.length >= 2 && causes.length < 10, `expected a short list; got ${causes.length}`);
  assert.match(crashSummary(causes), /Error: a/);
});

test('the summary is safe for a TRACKED artifact and the record is not', () => {
  const e = new Error(`boom\nsecond line with C:\\Users\\someone\\secrets`);
  e.stack = `Error: boom\n    at C:\\work\\quorate\\scripts\\run-graph.mjs:2974:9`;
  const summary = crashSummary(crashCauses(e));
  // FIRST LINE ONLY. The summary reaches not_checked[] and renders into gate.md; a stack carries
  // absolute paths and an error raised while handling a vendor response can quote that response.
  assert.equal(summary, 'Error: boom');
  assert.ok(!summary.includes('secrets'));
  assert.ok(!summary.includes('run-graph.mjs'), 'no stack in the tracked summary');

  // ...and the gitignored record keeps what the fix exists for.
  const rec = crashRecord({ phase: 'adjudication', error: e, at: '2026-09-24T00:00:00.000Z' });
  assert.equal(rec.phase, 'adjudication');
  assert.equal(rec.worker_failures, 1);
  assert.match(rec.causes[0].stack, /run-graph\.mjs:2974/, 'the stack names the line a count cannot');
  assert.match(rec.summary, /Error: boom/);
});

test('many causes are capped, and the cap says how many it hid', () => {
  const many = [...Array(9)].map((_, i) => new Error(`failure ${i}`));
  const s = crashSummary(crashCauses(new AggregateError(many, '9 pool workers failed')));
  assert.match(s, /failure 0/);
  assert.match(s, /…and 4 more/, 'a truncated list must say it was truncated');
  assert.ok(!s.includes('failure 8'));
});

test('regression: both pool call sites record the causes, and the panel one cannot kill the run', () => {
  assert.match(GRAPH, /import \{ crashCauses, crashSummary, crashRecord \} from '\.\/lib\/crash\.mjs';/);

  // The adjudication phase: unwrapped, summarised into the gate, stacks to evidence/.
  // `at` is supplied by the caller since os-platform-adapters criterion 5 (lib/ reads no clock).
  assert.match(GRAPH, /crashRecord\(\{ phase: 'adjudication', error: e, causes, at: [^}]+\}\)/);
  assert.match(GRAPH, /adjudicationCrashed = crashSummary\(causes\)/);
  assert.ok(!/e instanceof AggregateError \? e\.errors/.test(GRAPH),
    'the unwrapping has one owner; a second inline copy is how the two come apart');

  // THE PANEL AWAIT IS INSIDE A TRY. Without this the run ends with no gate at all.
  const at = GRAPH.indexOf('await panelPromise;');
  assert.ok(at > 0, 'could not find the panel join');
  const before = GRAPH.slice(Math.max(0, at - 400), at);
  assert.match(before, /try \{\s*$/m, 'the panel join must be guarded, or an arm worker throw ends the run');
  const after = GRAPH.slice(at, at + 1800);
  assert.match(after, /crashRecord\(\{ phase: 'panel', error: e, causes, at: [^}]+\}\)/);
  assert.match(after, /node_id: 'panel'/, 'and the gate must be told the phase threw');
  assert.match(after, /rather than ending with no verdict at all/);
});
