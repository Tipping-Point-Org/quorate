// G-7 of 20261111-224124-runtime-bin-d1-review: the shared parser admitted any number of bare arguments wherever a spec
// said `positionals: true`, and claim-check read positionals[0] alone, so `claim-check.mjs <dir> <another>` silently
// ignored the second (telemetry.mjs did the same with its subcommand). A spec may now say how many it takes, and the
// parser refuses the rest by name, as it refuses an unknown flag.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgv, ArgvError } from '../scripts/lib/argv.mjs';
import { ARGV_SPECS } from '../scripts/lib/argv-specs.mjs';
import { SCRIPTS_DIR } from './helpers.mjs';

test('G-7: a spec with a positional count refuses a bare argument past it, naming it', () => {
  assert.deepEqual(parseArgv(['a'], { positionals: 1 }).positionals, ['a']);
  assert.deepEqual(parseArgv([], { positionals: 1 }).positionals, []);
  assert.throws(() => parseArgv(['a', 'extra'], { positionals: 1 }), (e) => e instanceof ArgvError && /extra/.test(e.message));
  // `true` still admits any number: code-index joins its question's words.
  assert.deepEqual(parseArgv(['a', 'b', 'c'], { positionals: true }).positionals, ['a', 'b', 'c']);
});

test('G-7: claim-check and telemetry take one bare argument, and refuse a second', () => {
  assert.equal(ARGV_SPECS['claim-check'].positionals, 1);
  assert.equal(ARGV_SPECS.telemetry.positionals, 1);
  const env = { ...process.env }; delete env.GRAPH_NODE_DEPTH;
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'claim-check.mjs'), 'one-dir', 'stray'], { env, encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^claim-check: .*stray/m);
});
