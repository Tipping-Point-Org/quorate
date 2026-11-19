// runtime-call-telemetry.plan.md stage 3 (design CR-D4 A): every place that calls a model builds the call's entry with the
// one function (lib/call-entry.mjs) and puts it in the record that call site already writes. The set is re-derived by
// search, not taken from the design note's census: that census listed three sites, and this search found three more
// (bench-second-opinion's forge, check-intent-grant's live probe, new-run's canaries).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SCRIPTS_DIR } from './helpers.mjs';

const src = (f) => fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8');
const top = fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.mjs'));

// A model call: a Claude argv built with a prompt (nodeArgv), the forge's own runtime command, or the vendor spawn in
// external-review (the one place an external reviewer's CLI is started). A version probe (version_argv) spends nothing
// and is not one.
// The vendor call is `capture(withPrompt)` / `capture(shellArgv(argv))` since stop-owner-grep-state-roots.plan.md stage 1.
// The forge's spawn is `spawnForge(` (io/forge-spawn.mjs, which renders it with nodeArgv) since decision-panel-seats.plan.md
// stage 2; its caller still builds the entry.
const MODEL_CALL = /nodeArgv\(|FORGE_RUNTIME\.cmd|spawnForge\(|await capture\((?:withPrompt|shellArgv\(argv\))/;

test('stage 3: every script that calls a model builds the call\'s entry with callEntry', () => {
  const callers = top.filter((f) => MODEL_CALL.test(src(f)));
  assert.ok(callers.length >= 6, `the search found only ${callers.length} model-calling scripts: ${callers.join(', ')}`);
  const without = callers.filter((f) => !/callEntry\(/.test(src(f)));
  assert.deepEqual(without, [], 'a script calls a model without building its entry');
  // spawn-subagent calls nodeArgv too; the set the search finds today (dated, indicative), so a change to it is seen.
  assert.deepEqual(callers.sort(), ['bench-second-opinion.mjs', 'check-intent-grant.mjs', 'external-review.mjs', 'new-run.mjs',
    'spawn-node.mjs', 'spawn-subagent.mjs']);
});

test('stage 3: each call site puts the entry in the record it already writes', () => {
  assert.match(src('spawn-node.mjs'), /status\.call = callEntry\(/, 'spawn-node: the node status');
  assert.match(src('spawn-subagent.mjs'), /writeSubagentRecord\(args\.out, \{ envelope: parsed, pins, call,/, 'spawn-subagent: its record');
  // Five emitters since the decide mode (autonomous-run.plan.md stage 4): review, propose, tie-break, claim-check, decide.
  assert.equal(src('external-review.mjs').split('    call: reviewerCall,').length - 1, 5, 'external-review: every emitter\'s output');
  const graph = src('run-graph.mjs');
  assert.match(graph, /call: markAnswered\(env\?\.call \?\? null, false\),/, 'run-graph: an unreachable arm');
  assert.match(graph, /call: markAnswered\(env\?\.call \?\? null, true\),/, 'run-graph: an answered arm');
  assert.match(graph, /call: markAnswered\(tbEnvelope\?\.call \?\? null, tbProbe\.state === 'reachable'\),/, 'run-graph: a judge');
  assert.match(src('claim-check.mjs'), /call: markAnswered\(out\?\.call \?\? null, Boolean\(out\?\.result\)\) \};/, 'claim-check: the arm');
  const bench = src('bench-second-opinion.mjs');
  assert.match(bench, /call: forge\.call \?\? null/, 'bench: the forge');
  assert.match(bench, /judge_calls: \{/, 'bench: the judge');
  assert.match(src('check-intent-grant.mjs'), /skips, call, detail:/, 'check-intent-grant: its result');
  const mint = src('new-run.mjs');
  assert.match(mint, /calls: canaryCalls\.splice\(0\),/, 'new-run: the sandbox canary');
  assert.match(mint, /calls: intentCalls,/, 'new-run: the intent canary');
});
