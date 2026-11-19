// THE ONE OWNER OF THE ENGINE'S GIT PROCESSES (engine-git-env.plan.md stage 1; ARCHITECTURE A-29). Every git the engine
// starts runs here, in lib/decisions.mjs gitEnvFor's environment: no secret-shaped name, no runtime auth, no run pin,
// GRAPH_NODE_DEPTH at least 1, and the SSH agent socket only for gitCommitSync. A caller cannot widen it: `env` is
// refused, and `gitVars` admits only git's own location and pathspec variables, which the arms' snapshot needs to build
// in a throwaway index and object store (scripts/io/snapshot.mjs). tests/regression-engine-git-env holds every other
// git spawn in scripts/ to this module.
import { spawnSync } from 'node:child_process';
import { gitEnvFor } from '../lib/decisions.mjs';
import { erredIsFailure } from '../lib/spawn-result.mjs';
import { shAsync } from './pool.mjs';

export const GIT_VARS = Object.freeze([
  'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_DIR', 'GIT_WORK_TREE',
  'GIT_LITERAL_PATHSPECS',
  // The commit identity, which the snapshot's commit-tree sets for its stand-in commits: a name, not a credential.
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL',
]);
const OPTIONS = new Set(['cwd', 'input', 'maxBuffer', 'encoding', 'windowsHide', 'gitVars']);
// shAsync takes no stdin and fixes its own cap and decoding, so the async call accepts only what it honours (G-6 of
// 20261023-214545-ger-remediation-review): an option it would drop is refused, as `env` is.
const ASYNC_OPTIONS = new Set(['cwd', 'windowsHide', 'gitVars']);

// The options a caller may pass, and the environment it gets: never its own.
function scoped(opts, commit, accepted = OPTIONS) {
  for (const k of Object.keys(opts ?? {})) {
    if (!accepted.has(k)) throw new Error(`io/git: option '${k}' is not accepted — ${OPTIONS.has(k) ? 'the async call does not honour it' : "the environment is the owner's (A-29)"}`);
  }
  const { gitVars = {}, ...spawnOpts } = opts ?? {};
  for (const k of Object.keys(gitVars)) {
    if (!GIT_VARS.includes(k)) throw new Error(`io/git: gitVars admits only ${GIT_VARS.join(', ')}; '${k}' refused`);
  }
  return { ...spawnOpts, env: { ...gitEnvFor(process.env, { commit }), ...gitVars } };
}
// A git that erred (past its maxBuffer) never reads as a success, whatever the timing (lib/spawn-result.mjs): every
// caller that reads status is held to the error here, once.
const run = (args, opts, commit) => erredIsFailure(spawnSync('git', args, scoped(opts, commit)));

/** git in the engine's scoped environment, without the SSH agent socket. */
export const gitSync = (args, opts = {}) => run(args, opts, false);
/** `git commit`, and only that, with the SSH agent socket, which commit signing may need. */
// Held here, not by the caller's convention: any other subcommand would receive the socket too (G-7 of
// 20261023-205906-ger-delivery). `commit` must come first, so no `-c` or `-C` before it can change what runs; only
// --literal-pathspecs, which changes how its paths are read (the runner's commit), may precede it.
export const gitCommitSync = (args, opts = {}) => {
  if ((args?.[0] === '--literal-pathspecs' ? args[1] : args?.[0]) !== 'commit') throw new Error(`io/git: gitCommitSync runs only \`git commit\`; ${JSON.stringify(args)} refused (A-29)`);
  return run(args, opts, true);
};
/** git without blocking the event loop (the bench's concurrent worktrees), through io/pool.mjs shAsync. */
export const gitAsync = (args, opts = {}) => shAsync('git', args, scoped(opts, false, ASYNC_OPTIONS));
