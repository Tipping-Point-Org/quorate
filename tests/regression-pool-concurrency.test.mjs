// The panel arms ran strictly serially: six arms, 30.5 minutes of wall clock, each one's
// started_at stamped exactly at the previous one's ended_at. Two causes stacked — a `for await`
// loop, and beneath it a blocking spawnSync that pinned the event loop so nothing could interleave
// even in principle. The panel arms, the tie-break loop and the bench's seed pool run through
// runPool; the LENS fan-out runs through runBudgetedPool, which is the same loop plus the one thing
// runPool cannot do — write a BLOCKED stub for each node the run budget stopped, since expected.json
// already promised them. Both live in lib/pool.mjs and both are exercised here: the fan-out is the
// pool that spends the operator's own quota, and it had no coverage at all while its loop was
// hand-rolled inside run-graph (G-23, G-47).
//
// These tests pin the properties that matter: work actually overlaps, it never exceeds the declared
// limit, every worker settles before the caller is told the pool is done, and nothing the budget
// stopped disappears without being accounted for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { runPool, runBudgetedPool, shAsync, CHILD_OUTPUT_CAP } from '../scripts/io/pool.mjs';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('regression: work actually runs concurrently, not one-at-a-time', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = [1, 2, 3, 4, 5, 6];
  await runPool(items, async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await tick(20);
    inFlight -= 1;
  }, 3);
  assert.equal(maxInFlight, 3, `expected 3 concurrent, saw ${maxInFlight} — serialised again`);
});

test('concurrency never exceeds the declared limit', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  await runPool(Array.from({ length: 20 }, (_, i) => i), async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await tick(5);
    inFlight -= 1;
  }, 4);
  assert.equal(maxInFlight, 4, 'the operator declared a ceiling; the pool must honour it');
});

test('every item runs exactly once', async () => {
  const seen = [];
  await runPool(['a', 'b', 'c', 'd', 'e'], async (x) => { await tick(1); seen.push(x); }, 2);
  assert.equal(seen.length, 5);
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('a limit wider than the work does not over-spawn workers', async () => {
  let maxInFlight = 0, inFlight = 0;
  await runPool([1, 2], async () => {
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    await tick(5); inFlight -= 1;
  }, 10);
  assert.equal(maxInFlight, 2, 'width is bounded by the number of items, not the limit');
});

test('an empty item list is a no-op, not a hang', async () => {
  await runPool([], async () => { throw new Error('must not run'); }, 3);
});

// The orchestrator aborts a run in flight (SIGINT, a killed node). A pool that kept draining its
// queue after that would spawn new work into a run already being torn down.
test('regression: the pool stops taking new work once the run aborts', async () => {
  let started = 0;
  let abort = false;
  await runPool(Array.from({ length: 50 }, (_, i) => i), async () => {
    started += 1;
    if (started >= 4) abort = true;
    await tick(2);
  }, 2, () => abort);
  assert.ok(started < 50, `pool must stop early on abort; started ${started}/50`);
});

// SETTLED IS THE PROMISE THE DOCSTRING MAKES. The wait was `Promise.all`, which returns at the FIRST
// rejection while every other worker keeps going — for the panel that means arms still spawning
// children and writing status files into a run whose caller has already moved past the barrier
// (G-24). A rejection must stop nothing else and must still reach the caller.
test('regression: one failing worker does not release the caller while others are still running', async () => {
  const finished = [];
  let released = null;

  const items = ['boom', 'slow-a', 'slow-b'];
  const err = await runPool(items, async (item) => {
    if (item === 'boom') throw new Error('worker failed');
    await tick(30);
    finished.push(item);
  }, 3).then(() => null, (e) => e);

  released = finished.slice();
  assert.ok(err instanceof Error, 'the failure must still reach the caller, never be swallowed');
  assert.match(err.message, /worker failed/);
  assert.deepEqual(released.sort(), ['slow-a', 'slow-b'],
    'every worker had settled before the caller was told the pool was done');
});

test('several failing workers are reported together, not one at a time', async () => {
  const err = await runPool([1, 2, 3], async (n) => { throw new Error(`fail ${n}`); }, 3)
    .then(() => null, (e) => e);
  assert.ok(err instanceof AggregateError);
  assert.equal(err.errors.length, 3);
});

// THE CAP HAD NO READER AND NO TEST. shAsync used to accumulate a child's output without bound —
// the bench runs whole graph runs as children, several at once — and the fix added CHILD_OUTPUT_CAP,
// a truncation notice and a `truncated` flag with nothing anywhere asserting any of it (G-25, I-59).
// It could silently stop working and the suite would stay green.
test('regression: a child cannot fill the pool process with its own output', async () => {
  const big = await shAsync(process.execPath, ['-e', `process.stdout.write('x'.repeat(${3 * 1024 * 1024}))`]);
  assert.ok(big.out.length < CHILD_OUTPUT_CAP + 500,
    `kept ${big.out.length} characters against a ${CHILD_OUTPUT_CAP} cap`);
  assert.equal(big.truncated, true);
  // The notice reports BYTES PRODUCED rather than a count of dropped characters (G-18): the old
  // wording could only be computed by decoding every chunk after the cap, which is the allocation
  // the cap exists to avoid. What a reader of a truncated log needs is how much is missing, and
  // that is exactly what this states.
  assert.match(big.out, /output capped at \d+ characters; this child produced \d+ bytes in total/,
    'truncation is STATED — a log that quietly stops reads like a child that quietly stopped');
  const produced = Number(/produced (\d+) bytes/.exec(big.out)[1]);
  assert.ok(produced >= 3 * 1024 * 1024, `the stated size must be the real one; got ${produced}`);
  assert.match(big.out.slice(0, 50), /^x+$/, 'the head is kept, which is what diagnoses an early death');
});

test('an ordinary child is untouched by the cap, and its exit code survives', async () => {
  const ok = await shAsync(process.execPath, ['-e', 'console.log("hello"); process.exit(3)']);
  assert.equal(ok.status, 3);
  assert.equal(ok.truncated, false);
  assert.match(ok.out, /^hello\s*$/);
});

// THE LENS FAN-OUT — the pool that spends the operator's own quota — had no coverage at all: it was
// a hand-rolled worker array in run-graph, while every test in this file exercised the panel's pool
// (G-23, G-47). These pin the two properties that are specific to it.
test('the budgeted pool stops launching once the budget is gone, and accounts for what it dropped', async () => {
  const launched = [];
  let dropped = null;
  const items = [1, 2, 3, 4, 5, 6, 7, 8];

  await runBudgetedPool(items, async (n) => { launched.push(n); await tick(5); }, 2, {
    // "Spent" after four launches — the shape of a run budget crossing mid-fan-out.
    overBudget: () => (launched.length >= 4 ? 'run budget exhausted before launch: $12.00 >= $12' : null),
    onDropped: (items_, why) => { dropped = { items: items_, why }; },
  });

  assert.equal(launched.length, 4, 'not one node past the ceiling');
  assert.ok(dropped, 'a node that expected.json promised must not vanish without a stub');
  assert.equal(dropped.items.length, items.length - launched.length,
    'every un-launched node is accounted for, exactly once');
  assert.match(dropped.why, /budget exhausted/);
});

test('the drop is reported ONCE, however many workers noticed it', async () => {
  let calls = 0;
  await runBudgetedPool([1, 2, 3, 4, 5, 6], async () => { await tick(5); }, 3, {
    overBudget: () => 'stop',
    onDropped: () => { calls += 1; },
  });
  assert.equal(calls, 1,
    'the queue is spliced before reporting, so the other workers find nothing left to drop');
});

test('a budgeted pool with no budget pressure behaves like an ordinary pool', async () => {
  const seen = [];
  let inFlight = 0, maxInFlight = 0;
  await runBudgetedPool([1, 2, 3, 4, 5], async (n) => {
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    await tick(10); seen.push(n); inFlight -= 1;
  }, 2);
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5], 'every item runs exactly once');
  assert.ok(maxInFlight <= 2, `concurrency ${maxInFlight} exceeded the declared limit`);
  assert.equal(maxInFlight, 2, 'and work actually overlapped');
});

test('the budgeted pool stops taking new work once the run aborts', async () => {
  let aborted = false;
  const done = [];
  await runBudgetedPool([1, 2, 3, 4, 5, 6], async (n) => {
    done.push(n);
    if (done.length === 2) aborted = true;
    await tick(5);
  }, 1, { shouldStop: () => aborted });
  assert.equal(done.length, 2, 'a pool that kept draining would spawn into a run being torn down');
});

// THE BUDGET CHECK AND THE RESERVATION MUST NOT BE SEPARATED BY AN AWAIT (G-19).
//
// A node's own RUNNING status — the thing that makes its cost visible to the next budget check — is
// written by the CHILD process, after the parent spawns it. So three workers could pass the check in
// the same tick, each seeing a total none of them had yet affected, and all three launch: the run
// overshoots review.budget_usd_per_run by up to (concurrency - 1) node caps, with the artifacts
// showing a budget that was respected.
//
// The fix is not in this module — run-graph writes the reservation itself, synchronously, before any
// await — but the property belongs here, because it is a property of how this pool interleaves.
test('regression: a synchronous reservation is enough to hold a ceiling three workers share', async () => {
  const CAP = 3;

  // Without a reservation: every worker sees the same untouched ledger and launches.
  let ledger = 0;
  let launchedNaive = 0;
  await runBudgetedPool([1, 2, 3, 4, 5, 6], async () => {
    launchedNaive += 1;                       // the cost only becomes visible LATER, as in a child
    await tick(15);
    ledger += 1;
  }, 3, { overBudget: () => (ledger >= CAP ? 'exhausted' : null) });
  assert.ok(launchedNaive > CAP,
    'this is the defect being pinned: without a reservation the ceiling does not hold');

  // With the reservation taken in the same synchronous step as the check, the ceiling holds exactly.
  ledger = 0;
  let launched = 0;
  await runBudgetedPool([1, 2, 3, 4, 5, 6], async () => { await tick(15); }, 3, {
    overBudget: () => {
      if (ledger >= CAP) return 'exhausted';
      ledger += 1;                            // reserve BEFORE yielding — no await in between
      launched += 1;
      return null;
    },
  });
  assert.equal(launched, CAP, 'not one node past the ceiling, however many workers are running');
});

test('the orchestrator writes that reservation before it awaits the spawn', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const at = graph.indexOf('await runBudgetedPool(toRun');
  assert.notEqual(at, -1);
  const body = graph.slice(at, graph.indexOf('}, CONCURRENCY,', at));
  const reserve = body.indexOf("writeStatusStub(e.node_id, 'RUNNING'");
  const spawn = body.indexOf('await spawnNode(');
  assert.notEqual(reserve, -1, 'the fan-out must reserve the node before launching it');
  assert.ok(reserve < spawn, 'and it must do so BEFORE the await, or the reservation races the check');
});
