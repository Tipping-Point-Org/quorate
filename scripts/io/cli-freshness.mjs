// The CLI freshness check's I/O (autonomous-run.plan.md stage 7): run each adapter's installed-version and
// published-version commands, at most once a day, keep the answers in a cache under the engine's home, and return
// the lines worth printing. The decisions (parse, compare, date, due) are lib/cli-freshness.mjs's. It never updates
// anything, and a command that fails or is not declared makes that CLI `not-checked`, never `current`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawTable, selectAdapters, reviewersFromOutcome, overrideLine } from './reviewers.mjs';
import { readContract } from './contract-reader.mjs';
import { cliVersion } from './reviewer-probe.mjs';
import { freshnessStep, dueClis, freshnessAdapters, DUE_AFTER_DAYS, tableKey, cacheTableKey, freshnessCurrent, refreshWanted } from '../lib/cli-freshness.mjs';
import { readFreshness, writeFreshness } from './run-state.mjs';
import { spawn as childSpawn } from 'node:child_process';
import { scrubChildEnv } from '../lib/decisions.mjs';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The table this check is for, chosen by the one owner (contract-runtime-and-session-files.plan.md stage 1): the
 * declarations (a hook passes the ones it read; otherwise the repository's contract, through the one memoized reader) and
 * the contract's review.runtime, so the node runtime checked is the one the engine runs (G-3 of
 * 20261105-031048-ar-d1-c-remediation-3-review). The cache key names both. A runtime that cannot be chosen (no default, an
 * unknown name) leaves it out of the key and the check, rather than failing the hook.
 */
function chosenTable({ repoRoot, declared, contract }) {
  let c = contract;
  let decl = declared;
  if (decl === undefined || decl === null) {
    if (c === undefined && repoRoot) {
      const outcome = readContract({ cwd: repoRoot });
      decl = reviewersFromOutcome(outcome, 'cli-freshness');
      c = outcome?.contract ?? null;
    } else decl = c?.reviewers ?? {};
  }
  const sel = selectAdapters({ declared: decl, contract: c ?? null });
  let runtime = null;
  // A DECLARED RUNTIME THE OWNER REFUSES IS NAMED (G-8 of 20261105-163851-crsf-d1-review): every refusal was swallowed,
  // so an unknown review.runtime went unsaid while the check went on. A table with no default stays silent; a value the
  // contract declared is refused by name in every answer, and that runtime is not checked. The hook still does not fail.
  let refusal = null;
  try { runtime = sel.runtime; } catch (e) {
    if (sel.runtimeDeclared) refusal = `${e.message}; the node runtime is not checked`;
  }
  // The key names the runtime only when the contract moved it off the table's default, so a cache computed for the
  // default keeps the key it always had.
  let byDefault = null;
  try { byDefault = selectAdapters({ declared: decl }).runtime; } catch { /* no default */ }
  return { decl, sel, runtime, refusal, key: tableKey(decl, runtime !== byDefault ? runtime : null) };
}

/**
 * A hook's refresh of the daily check (autonomous-run.plan.md stage 7, amended 2026-11-04, operator "C"; G-12 of
 * 20261105-004603-ar-d1-c-review): when the cache is not from today, start `run-session.mjs freshness` DETACHED, its
 * output ignored and its environment scrubbed of every secret-shaped name (no runtime auth kept: a version query needs
 * none), and return at once. A hook never waits on the version queries; a stale CLI is reported a day late. Returns
 * whether a refresh was started. `spawn` replaces child_process.spawn in tests.
 */
// A refresh is started once per table and retry window (G-2 of 20261105-013235-ar-d1-c-remediation-review): the start is
// recorded in the cache before the spawn, so the turns that land before the refresh finishes start none. Two hooks
// reading the cache in the same instant can still both start one: bounded by the hooks, and named here as the residual.
// An override the refresh will run is named through `say`, the hook's own output, since the child's is ignored (G-3).
export function refreshFreshnessDetached({ repoRoot, home, now = new Date(), env = process.env, spawn = childSpawn, declared, contract, say = null } = {}) {
  const opts = home ? { home } : {};
  // A cache that does not parse is one to rebuild (G-12 of 20261105-021654-ar-d1-c-remediation-2-review); a link is refused.
  let cache;
  try { cache = readFreshness(opts); } catch (e) { if (e?.code !== 'EBADCACHE') throw e; cache = null; }
  const { sel, key, refusal } = chosenTable({ repoRoot, declared, contract });
  if (say && refusal) say(refusal);
  if (!refreshWanted(cache, { today: now.toISOString().slice(0, 10), key, nowMs: now.getTime() })) return false;
  writeFreshness({ ...(cache ?? {}), refresh_started_at: now.toISOString(), refresh_key: key }, opts);
  if (say) for (const o of sel.overrides) say(overrideLine(o));
  const args = [path.join(SCRIPTS, 'run-session.mjs'), 'freshness', ...(repoRoot ? ['--repo-root', repoRoot] : [])];
  const childEnv = scrubChildEnv(env, { runtime: {} }).env;
  if (home) childEnv.QUORATE_HOME = home;
  // A spawn that fails takes its recorded start back (G-5 of 20261105-021654-ar-d1-c-remediation-2-review): the start was
  // kept and the error swallowed, so a refresh that never ran held off every retry for the window. A throw is the caller's
  // to report; an error event, which arrives after the hook may have returned, undoes the start when it does arrive.
  const undo = () => {
    try {
      const c = readFreshness(opts);
      if (c && c.refresh_started_at === now.toISOString() && c.refresh_key === key) {
        const { refresh_started_at: _s, refresh_key: _k, ...rest } = c;
        writeFreshness(rest, opts);
      }
    } catch { /* the window then ends on its own */ }
  };
  let child;
  try {
    child = spawn(process.execPath, args, {
      // Not in the repository: it is told the repository by --repo-root, and a detached process whose working directory is
      // the repository holds it open on Windows after the hook has returned (a removal there failed with EPERM).
      detached: true, stdio: 'ignore', windowsHide: true, env: childEnv, cwd: SCRIPTS,
    });
  } catch (e) { undo(); throw e; }
  child?.on?.('error', undo);
  child?.unref?.();
  return true;
}

/** The installed-version command of an adapter: its own `version_argv`, or its node runtime's. */
const installedCommand = (a) => {
  const argv = Array.isArray(a?.version_argv) ? a.version_argv : a?.node_runtime?.version_argv;
  return Array.isArray(argv) ? { cmd: a.cmd, version_argv: argv, needs_shell_on_windows: a.needs_shell_on_windows } : null;
};
/** The published-version command an adapter declares in `latest_version`, or null. */
const latestCommand = (a) => {
  const q = a?.latest_version;
  return q && typeof q.cmd === 'string' && Array.isArray(q.argv)
    ? { cmd: q.cmd, version_argv: q.argv, needs_shell_on_windows: q.needs_shell_on_windows } : null;
};

/**
 * Today's check, from the cache when it already ran today (unless `force`). Returns the lines to print: each CLI due
 * an update (behind for DUE_AFTER_DAYS or more), or with `all` every CLI's state. `run` replaces cliVersion in tests.
 */
export function checkFreshness({ force = false, all = false, cacheOnly = false, home, now = new Date(), run = cliVersion, repoRoot = null, declared, contract } = {}) {
  const today = now.toISOString().slice(0, 10);
  const opts = home ? { home } : {};
  // A cache that does not parse is said: a turn start's read throws it (its hook prints nothing, and the refresh rebuilds
  // it); the full check rebuilds it and names it (G-12 of 20261105-021654-ar-d1-c-remediation-2-review). A link is refused.
  let cache; let rebuilt = null;
  try { cache = readFreshness(opts); } catch (e) {
    if (cacheOnly || e?.code !== 'EBADCACHE') throw e;
    cache = null; rebuilt = `${e.message}; rebuilt`;
  }
  // The table first, so a refused runtime is named in every answer (G-8 of 20261105-163851-crsf-d1-review).
  const { sel, runtime, refusal, key } = chosenTable({ repoRoot, declared, contract });
  const said = refusal ? [refusal] : [];
  // A turn start reads the cache only: the version queries take seconds, and a turn must not wait on the network.
  if (cacheOnly && !cache) return said;
  let overrides = [];
  // The table the engine runs, the contract's declarations merged (G-1 of 20261105-004603-ar-d1-c-review): a
  // contract overriding a built-in CLI is checked as the CLI it runs, and the override is named (A-26). A cache answers
  // only for the table it was computed for (G-2 of 20261105-013235-ar-d1-c-remediation-review), the cache-only read
  // included (G-6 of 20261105-021654-ar-d1-c-remediation-2-review): a hook passes the declarations it already read.
  if (cacheOnly && cacheTableKey(cache) !== key) return said;
  if (!cacheOnly && (force || !freshnessCurrent(cache, { today, key }))) {
    const raw = rawTable();
    const table = sel.table;
    overrides = sel.overrides;
    const roster = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'lens-roster.json'), 'utf8'));
    // The node runtime the engine runs, chosen by the owner (G-3); none chosen leaves only the roster's adapters.
    const names = freshnessAdapters({ defaultNodeRuntime: runtime, roster });
    const limits = { versionMs: (raw.probe_defaults?.version_timeout_seconds ?? 30) * 1000 };
    const ask = (c) => { if (!c) return null; const r = run(c, limits); return r.ok && r.version !== 'undeclared' ? r.version : null; };
    const adapters = {};
    for (const name of names) {
      const a = table[name];
      // Another table's history is not this one's (G-7 of 20261105-021654-ar-d1-c-remediation-2-review): its behind_since
      // would date an overriding CLI's lag from the old CLI's.
      const prior = cache && cacheTableKey(cache) === key ? cache.adapters?.[name] : undefined;
      adapters[name] = freshnessStep(prior, { installed: ask(installedCommand(a)), latest: ask(latestCommand(a)), today });
    }
    cache = { checked_day: today, table_key: key, adapters };
    writeFreshness(cache, opts);
  }
  const due = dueClis(cache, today);
  const lines = due.map((d) => `CLI update due: ${d.name} ${d.installed} is behind ${d.latest} for ${d.days} days (since ${d.since}); updating it is the operator's call.`);
  if (!all) return [...said, ...lines];
  return [
    ...said,
    ...(rebuilt ? [rebuilt] : []),
    ...overrides.map((o) => overrideLine(o)),
    ...Object.entries(cache.adapters).map(([n, e]) => `${n}: ${e.state}${e.installed ? ` installed ${e.installed}` : ''}${e.latest ? `, published ${e.latest}` : ''}${e.behind_since ? `, behind since ${e.behind_since}` : ''}`),
    ...(lines.length ? lines : [`no CLI behind for ${DUE_AFTER_DAYS} days or more`]),
  ];
}
