// lib/reviewers.mjs, BOUND TO THIS HOST (os-platform-adapters stage 3c). See
// scripts/io/finding-scope.mjs for why this layer exists. An injected reader or spawn still wins.
import * as pure from '../lib/reviewers.mjs';
import { hostPlatform } from '../platform/index.mjs';
import { readContract } from './contract-reader.mjs';

export * from '../lib/reviewers.mjs';

export const builtinReviewers = (readFile) => pure.builtinReviewers(readFile ?? hostPlatform());
export const rawTable = (readFile) => pure.rawTable(readFile ?? hostPlatform());
// The one owner of the table and runtime (contract-runtime-and-session-files.plan.md stage 1), with this host's built-ins.
export const selectAdapters = (opts = {}) => pure.selectAdapters({
  builtins: opts.builtins ?? pure.builtinReviewers(hostPlatform()),
  raw: opts.raw === undefined ? pure.rawTable(hostPlatform()) : opts.raw,
  ...Object.fromEntries(Object.entries(opts).filter(([k]) => k !== 'builtins' && k !== 'raw')),
});
// `live: true` asks the CURRENT contract when there is no run, through the one memoized reader (G-16 of
// 20261014-181622-lf-delivery); without it, outside a run, the answer is empty.
export const declaredReviewers = ({ live = false, ...opts } = {}) =>
  pure.declaredReviewers({ io: hostPlatform(), ...(live ? { readContract } : {}), ...opts });
