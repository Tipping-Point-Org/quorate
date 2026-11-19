// test-names-reporter.mjs — a node:test reporter writing one line per finished test: its full name path (every enclosing
// test's name, outer first, joined by " > ") and its outcome, WITHOUT its file. split-slow-test-files.md criterion 2: the
// multiset of these lines is the same before and after a file is split, so no test is lost, added or renamed.
//
// Within a file node:test runs tests one at a time, so a stack of started names per file gives each test's path.

import { outcomeOf } from './test-outcome.mjs';

export default async function* testNames(source) {
  const stacks = new Map();
  for await (const { type, data } of source) {
    if (!data || data.file === undefined) continue;
    const stack = stacks.get(data.file) ?? [];
    stacks.set(data.file, stack);
    if (type === 'test:start') { stack.length = data.nesting; stack.push(data.name); continue; }
    if (type !== 'test:pass' && type !== 'test:fail') continue;
    stack.length = data.nesting;
    // The outcome is test-outcome.mjs's, the rule run-named.mjs fails the run by (G-8 of 20261107-072037-split-delivery-3).
    yield `${[...stack, data.name].join(' > ')}\t${outcomeOf(type, data)}\n`;
  }
}
