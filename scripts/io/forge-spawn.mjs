// THE BENCH FORGE'S SPAWN (decision-panel-seats.plan.md stage 2; design DP-D1 A), moved out of bench-second-opinion.mjs
// so a test drives it with a fake runtime. It built its own argv from `node_runtime.prompt.flag` with the prompt inline,
// the one runtime spawn outside nodeArgv, so it would have kept the argv cap the other spawns lost: it renders through
// nodeArgv now, and the prompt goes on the child's stdin when the runtime takes it there.
//
// NO TOOLS: the union of every tool name this runtime DECLARES is denied, which is the only vocabulary the adapter
// contract lets a caller speak; the forge needs nothing but the text it was handed (its caller's prompt also forbids
// reading, and its output is checked rather than trusted).
import { shAsync } from './pool.mjs';
import { nodeArgv, withRuntimeOverride } from '../lib/decisions.mjs';

/** The forge's launch: `{cmd, argv, input}`, from the runtime's table entry. `runtimeBin` replaces its binary (tests). */
export function forgeLaunch(runtime, { prompt, model, effort = null, runtimeBin = null }) {
  const nr = runtime?.node_runtime ?? {};
  const deny = [...new Set(Object.values(nr.tools ?? {}).flat().filter((t) => typeof t === 'string'))];
  return withRuntimeOverride(nodeArgv(runtime, { prompt, model, effort: effort ?? '', denyTools: deny, sandboxed: true }),
    runtimeBin, process.execPath);
}

/** Run the forge: shAsync's result (`{status, signal, out, stdout}`), its prompt written to stdin where it goes there. */
export function spawnForge({ runtime, prompt, model, effort = null, cwd, env, runtimeBin = null }) {
  const { cmd, argv, input } = forgeLaunch(runtime, { prompt, model, effort, runtimeBin });
  return shAsync(cmd, argv, { cwd, env, input });
}
