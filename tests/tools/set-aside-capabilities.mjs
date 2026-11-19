// set-aside-capabilities.mjs — the set-aside's real capabilities over a fixture repository, and a faulting decorator over
// them (runner-test-seam.plan.md stage 2, design RT-D2 A). A module with no tests of its own, so importing it runs none twice.
//
// The capabilities are built through scripts/io/set-aside.mjs's own setAsideCapabilities, so every test runs the shipped
// withFileBytes, never a copy; only the record of run.json is kept in memory, as the runner's run.read and run.save would
// keep it on disk. The decorator counts every call of every capability, in the order the module makes them, and throws at
// the one numbered `failAt`, so a sweep can fail each step of a set-aside in turn.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { confined } from '../../scripts/io/confined-path.mjs';
import { setAsideCapabilities } from '../../scripts/io/set-aside.mjs';

/**
 * A repository with `committed` ({ path: text }) at HEAD and `working` ({ path: text | null }) written over it (null
 * removes), and an empty run directory beside it, both under a fresh folder removed when `t` ends.
 */
export function setAsideFixture(t, { committed = {}, working = {} } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-set-aside-caps-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const runDir = path.join(base, 'run');
  fs.mkdirSync(repo);
  fs.mkdirSync(runDir);
  const git = (...a) => {
    const r = spawnSync('git', ['-c', 'user.email=x@x', '-c', 'user.name=x', ...a], { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fixture git ${a.join(' ')} failed: ${r.stderr}`);
    return r;
  };
  const write = (p, text) => {
    const abs = path.join(repo, ...p.split('/'));
    if (text === null) { fs.rmSync(abs, { force: true }); return; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  };
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  for (const [p, text] of Object.entries(committed)) write(p, text);
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  for (const [p, text] of Object.entries(working)) write(p, text);
  return { base, repo, runDir };
}

/** The real capabilities for `fixture`, with run.json held in `record` and printed lines in `lines`. */
export function realCapabilities({ repo, runDir }, { record = {}, lines = [] } = {}) {
  const caps = setAsideCapabilities({
    tree: confined(repo),
    owner: confined(runDir),
    git: (argv, { input } = {}) => spawnSync('git', argv, { cwd: repo, encoding: 'utf8', ...(input === undefined ? {} : { input }) }),
    run: { dir: runDir, read: () => JSON.parse(JSON.stringify(record)), save: (fields) => { Object.assign(record, JSON.parse(JSON.stringify(fields))); } },
    firstFree: (taken) => { for (let n = 1; n <= 100; n += 1) if (!taken(n)) return n; throw new Error('no free number below 100'); },
    log: (line) => lines.push(line),
  });
  return { caps, record, lines };
}

/** The error the decorator throws: `injected` marks it as the test's, never the module's. */
export const isInjected = (err) => Boolean(err && err.injected === true);

/**
 * `caps` with every capability call counted and, when `failAt` is a number, the call of that number thrown at before it
 * runs. Returns { caps, calls }: `calls` names each call made, in order (`tree.stat`, `git ls-tree`, `run.save`, ...).
 */
// `error`, when given, makes the thrown error: (label) => Error, marked injected here, e.g. one with code ENOENT, so a fault
// can stand for a path that went away as well as for a failure.
export function faulting(caps, { failAt = null, error = null } = {}) {
  const calls = [];
  const wrap = (name, fn) => (...a) => {
    const label = name === 'git' ? `git ${a[0]?.[0] ?? ''}` : name;
    calls.push(label);
    if (calls.length === failAt) {
      const err = error ? error(label) : Object.assign(new Error(`injected fault at call ${failAt} (${label})`), { code: 'EINJECTED' });
      throw Object.assign(err, { injected: true });
    }
    return fn(...a);
  };
  const each = (prefix, obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'function' ? wrap(`${prefix}.${k}`, v) : v]));
  return {
    calls,
    caps: {
      tree: each('tree', caps.tree),
      owner: each('owner', caps.owner),
      git: wrap('git', caps.git),
      run: each('run', caps.run),
      firstFree: wrap('firstFree', caps.firstFree),
      log: wrap('log', caps.log),
    },
  };
}
