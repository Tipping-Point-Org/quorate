// telemetry-records.plan.md stage 1c: a Claude node's status carried its exit code, signal, timeout and limit, and a
// panel arm's and an adjudicator's did not (the stage 1 inventory), so a slow or failing external reviewer could not be
// told apart from a slow or failing process. A SOURCE check, in the idiom of regression-captured-status: no test runs a
// fake arm or judge through run-graph end to end, and the delivery review's own status files are the live evidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const GRAPH = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
const between = (from, to) => {
  const at = GRAPH.indexOf(from);
  assert.ok(at >= 0, `anchor not found: ${from.slice(0, 60)}`);
  return GRAPH.slice(at, GRAPH.indexOf(to, at));
};

test('stage 1c: every record of a panel arm carries what its process did', () => {
  assert.match(GRAPH, /const armProcess = \{ exit_code: r\.status \?\? null, signal: r\.signal \?\? null, timed_out: r\.timedOut === true, timeout_minutes: armTimeout \};/);
  const writers = GRAPH.split('...capturedStatusFields(r), ...armProcess').length - 1;
  assert.equal(writers, 3, `expected the no-envelope stub, the unreachable stub and the answered status; found ${writers}`);
});

test('stage 1c: an adjudicator\'s status carries its duration, signal, timeout and limit beside its exit code', () => {
  const judge = between('// THE REST OF WHAT THE PROCESS DID, as an arm records it', '        });');
  assert.match(judge, /duration_ms: typeof tbEnvelope\?\.duration_ms === 'number' \? tbEnvelope\.duration_ms : null/);
  assert.match(judge, /signal: r\.signal \?\? null, timed_out: r\.timedOut === true, timeout_minutes: NODE_TIMEOUT/);
});
