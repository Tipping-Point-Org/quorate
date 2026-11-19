// PURE CONCURRENCY (os-platform-adapters stage 4). The child-process half — shAsync and its output
// cap — is scripts/io/pool.mjs, which re-exports this module: import from there.

// Bounded-concurrency runner, extracted so the concurrency itself can be regression-tested.
//
// It exists because the panel arms ran strictly serially — 30.5 minutes of wall clock on a
// six-arm run, each arm starting exactly when the previous one ended. Two causes: a `for await`
// loop, and underneath it a blocking `spawnSync` that pinned the event loop so nothing else could
// progress even if the loop had allowed it.
//
// WHO USES IT: the panel arms, the tie-break loop, and the bench's seed pool. The LENS fan-out has
// its own loop in run-graph — not an oversight, and not sharing: it must write a BLOCKED status stub
// for every node it declines to launch when the run budget runs out, and a pool that only drains a
// queue cannot say which items it never took. This header claimed both shared this owner (G-23);
// they share the concurrency NUMBER, which is a weaker and truer statement.

/**
 * Run `worker` over `items`, at most `limit` at a time. Resolves when all have SETTLED.
 *
 * `shouldStop` is polled before each item is taken: the orchestrator aborts a run in flight (SIGINT,
 * a killed node), and a pool that kept draining its queue after that would spawn work into a run
 * already being torn down.
 *
 * SETTLED IS THE PROMISE, so the wait is allSettled. `Promise.all` returns at the FIRST rejection
 * while the other workers keep spawning children into a run the caller now believes is finished
 * (G-24) — for the panel that means arms still writing status files after the barrier moved on. A
 * worker that threw is still reported: the rejections are collected and rethrown together, because
 * swallowing them would trade one wrong behaviour for a quieter one.
 */
export async function runPool(items, worker, limit, shouldStop = () => false) {
  const list = [...items];
  if (!list.length) return;
  const width = Math.min(Math.max(1, limit | 0), list.length);
  const workers = Array.from({ length: width }, async () => {
    while (list.length && !shouldStop()) {
      await worker(list.shift());
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.filter((s) => s.status === 'rejected').map((s) => s.reason);
  if (failed.length) {
    throw failed.length === 1
      ? failed[0]
      : new AggregateError(failed, `${failed.length} pool workers failed`);
  }
}

/**
 * A promise-chain mutex: each caller waits for the previous one to settle.
 *
 * Returned as a FACTORY rather than a module-level chain, so two independent critical sections do
 * not serialise against each other and a test can exercise one in isolation. Used for
 * `git worktree add|remove`, which mutate .git/worktrees under a repository lock and are the one
 * part of a concurrent seed that may not overlap another's.
 */
export function makeLock() {
  let chain = Promise.resolve();
  return function withLock(fn) {
    const next = chain.then(fn, fn);
    chain = next.then(() => {}, () => {});
    return next;
  };
}

/**
 * A pool that can be STOPPED BY A BUDGET, and that accounts for the work it never started.
 *
 * The lens fan-out is not the panel: it spends the operator's own quota, and when the run budget is
 * exhausted mid-fan-out the nodes that were never launched are not simply skipped — each gets a
 * BLOCKED status stub, because `expected.json` already promised them and a promised node that leaves
 * no artifact is the silence this whole system refuses. `runPool` cannot express that: it drains a
 * queue and cannot say which items it never took.
 *
 * So the fan-out kept its own hand-rolled worker array, and two loops interpreted `review.concurrency`
 * independently — with every concurrency test in the suite exercising only the other one, so the
 * pool that spends the quota had no regression coverage at all (G-23, G-47). This is the fan-out's
 * loop, in the same module, testable.
 *
 * @param overBudget  called before each item is taken; returns a REASON string to stop, or null.
 * @param onDropped   called once with the items that were never launched, and that reason.
 */
export async function runBudgetedPool(items, worker, limit, {
  shouldStop = () => false,
  overBudget = () => null,
  onDropped = () => {},
} = {}) {
  const list = [...items];
  if (!list.length) return;
  const width = Math.min(Math.max(1, limit | 0), list.length);
  const workers = Array.from({ length: width }, async () => {
    while (list.length && !shouldStop()) {
      const why = overBudget();
      if (why) {
        // SPLICED, then reported — the splice is what stops the other workers from each taking one
        // more item on their way out, which would spend past the ceiling that just stopped this one.
        const dropped = list.splice(0);
        if (dropped.length) onDropped(dropped, why);
        return;
      }
      await worker(list.shift());
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.filter((s) => s.status === 'rejected').map((s) => s.reason);
  if (failed.length) {
    throw failed.length === 1 ? failed[0] : new AggregateError(failed, `${failed.length} pool workers failed`);
  }
}
