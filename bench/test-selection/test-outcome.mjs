// test-outcome.mjs — the one owner of how a finished node:test event is counted, used by run-named.mjs (whether the run
// failed) and test-names-reporter.mjs (the outcome it records), so the two cannot drift (G-8 of
// 20261107-072037-split-delivery-3).
//
// todo before fail: a failing test declared todo is no failure, as node --test counts it (G-8 and G-10 of
// 20261107-061412-split-delivery-2).

/** The outcome of a `test:pass` or `test:fail` event: todo, fail, skip or pass. */
export function outcomeOf(type, data) {
  if (data.todo !== undefined) return 'todo';
  if (type === 'test:fail') return 'fail';
  return data.skip !== undefined ? 'skip' : 'pass';
}

/** Whether the event fails the run. */
export const isFailure = (type, data) => outcomeOf(type, data) === 'fail';
