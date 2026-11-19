// isolated.mjs — run one measurement in the exploration's sandbox, reset to a named commit first
// (test-selection-exploration.md).
//
// Usage: node bench/test-selection/isolated.mjs --commit <sha> -- <script under bench/test-selection> [args]
//
// ONE SANDBOX, RESET BEFORE EVERY RUN (operator, 2026-10-27: "I did not ask to run in parallel ... if you're not you do
// not need copies just to drop all changes before the second run"). Runs go one at a time; the overlap that broke two
// ground-truth runs was a stopped run still going while a new one started, not parallelism. So each run begins by putting
// the sandbox back to exactly the commit it measures: it is deleted and cloned fresh at <sha>, which drops every mutated
// file, scratch file and record a previous run left. A lock (`.ts-run.lock`, outside the
// clone) refuses a second run while one holds it. The reset happens only in a directory this script owns, and the
// measurement scripts refuse to run anywhere without its `.ts-isolated` marker (guard.mjs), because on 2026-10-27 one ran
// in the operator's own checkout. `{repo}` in the script's arguments is replaced with the sandbox's path.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SANDBOX = path.join(ROOT, '.sandbox', 'test-selection');
const LOCK = path.join(ROOT, '.sandbox', 'test-selection.lock');
const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep < 0) throw new Error('usage: isolated.mjs --commit <sha> -- <script> [args]');
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 && i < sep ? argv[i + 1] : null; };
const [script, ...rest] = argv.slice(sep + 1);
const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
};

const sha = git(['rev-parse', '--verify', `${opt('commit') ?? 'HEAD'}^{commit}`], ROOT);
try { fs.writeFileSync(LOCK, `${process.pid}\n`, { flag: 'wx' }); } catch {
  throw new Error(`${LOCK} exists: a run holds the sandbox, or one was stopped. Check none is going, then delete it.`);
}
let status = 1;
try {
  // Never remove a directory that is not this sandbox: it must sit under ROOT/.sandbox and not be ROOT itself.
  if (path.resolve(SANDBOX) === path.resolve(ROOT) || !path.resolve(SANDBOX).startsWith(path.join(ROOT, '.sandbox') + path.sep)) {
    throw new Error(`refusing to remove ${SANDBOX}`);
  }
  // KEEP WHAT THE LAST RUN RECORDED BEFORE THE RESET DROPS IT (operator, 2026-10-27: "Reset will drop the json"):
  // the deletion below takes ignored files with it, and the suite records a run writes (.claude/suite-runs/) are ignored. They
  // are moved to .sandbox/ts-results/suite-runs/ first; harness results are written there directly and never live here.
  const recDir = path.join(SANDBOX, '.claude', 'suite-runs');
  const keepDir = path.join(ROOT, '.sandbox', 'ts-results', 'suite-runs');
  if (fs.existsSync(recDir)) {
    fs.mkdirSync(keepDir, { recursive: true });
    for (const f of fs.readdirSync(recDir)) {
      const to = path.join(keepDir, f);
      if (!fs.existsSync(to)) fs.copyFileSync(path.join(recDir, f), to);
    }
  }
  // DELETE AND CLONE, not `reset --hard` + `clean -fdx`: the project's deny list forbids both, and running them from
  // node instead of the shell only sidestepped it (operator, 2026-10-27, offered the choice; delete-and-clone keeps it).
  fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5 });
  if (fs.existsSync(SANDBOX)) throw new Error(`could not remove ${SANDBOX}`);
  git(['clone', '-q', '--no-hardlinks', ROOT, SANDBOX], ROOT);
  git(['checkout', '-q', '--detach', sha], SANDBOX);
  fs.writeFileSync(path.join(SANDBOX, '.ts-isolated'), `${sha}\n`);
  console.log(`isolated: sandbox reset to ${sha.slice(0, 8)}`);
  const args = rest.map((a) => a.replaceAll('{repo}', SANDBOX));
  const r = spawnSync(process.execPath, [path.join(SANDBOX, 'bench', 'test-selection', script), ...args], { cwd: SANDBOX, stdio: 'inherit' });
  status = r.status ?? 1;
} finally {
  fs.rmSync(LOCK, { force: true });
}
process.exit(status);
