// WHERE A REPOSITORY'S RUN DIRECTORIES ARE, read with as few filesystem calls as the question needs
// (ledger-findings.plan.md stage 5; design D5). `--summary` stat'ed every run directory's run.json and only then dropped
// the runs already folded (G-3 of 20261013-023310-ledger-identity-remediation-2-review); the migration probed every
// folded run in every root, twice. `fsImpl` is a seam, so a test can count the calls.

import fs from 'node:fs';
import path from 'node:path';

/**
 * The run directories present under `roots` — a name is a run when it carries a run.json — EXCEPT those in `skip`,
 * which are never stat'ed. An absent root holds no runs; any other failure to read one, or to inspect a run.json, is
 * returned as `{ error }` for the caller to refuse on (it used to read as "nothing unfolded"). A run with no
 * finding-groups.json (a remediation, or a review that ended before its barrier) is returned in `ungrouped`, not
 * `names`: the fold refuses it, so it is not waiting to be folded (story-pipeline, 2026-10-15).
 */
export function runDirsPresent(roots, { skip = new Set(), fsImpl = fs } = {}) {
  const names = new Set();
  const ungrouped = new Set();
  for (const dir of roots) {
    let listing;
    try { listing = fsImpl.readdirSync(dir, { withFileTypes: true }); } catch (e) {
      if (e?.code === 'ENOENT') continue;
      return { error: `the reviews folder ${dir} cannot be read (${e.code ?? e.message})` };
    }
    for (const e of listing) {
      if (!e.isDirectory() || skip.has(e.name) || names.has(e.name)) continue;
      let file = path.join(dir, e.name, 'run.json');
      try {
        fsImpl.statSync(file);
        file = path.join(dir, e.name, 'finding-groups.json');
        try { fsImpl.statSync(file); names.add(e.name); } catch (err) {
          if (err?.code !== 'ENOENT') throw err;
          ungrouped.add(e.name);
        }
      } catch (err) {
        if (err?.code === 'ENOENT') continue;
        return { error: `${file} cannot be inspected (${err.code ?? err.message})` };
      }
    }
  }
  return { names: [...names].sort(), ungrouped: [...ungrouped].filter((n) => !names.has(n)).sort() };
}

/**
 * For each id, the directory that holds it: each root is LISTED once; an id found in one root is that root's; an id
 * found in several is the first whose `<id>/run.json` exists (a run whose evidence stayed staged also has a folder
 * where it was archived), else the first. Returns `{ dirs }`, a Map id -> dir without the ids found nowhere. An absent
 * root holds no runs; any other failure to list one is `{ error }` (G-13 of 20261014-181622-lf-delivery): read as empty,
 * it filed every folded run under it as lost.
 */
export function locateRunDirs(roots, ids, { fsImpl = fs } = {}) {
  const present = [];
  for (const r of roots) {
    try { present.push(new Set(fsImpl.readdirSync(r))); } catch (e) {
      if (e?.code !== 'ENOENT') return { error: `the reviews folder ${r} cannot be read (${e?.code ?? e?.message})` };
      present.push(new Set());
    }
  }
  const out = new Map();
  for (const id of ids) {
    const where = roots.filter((r, i) => present[i].has(id)).map((r) => path.join(r, id));
    if (!where.length) continue;
    out.set(id, where.length === 1 ? where[0] : (where.find((d) => fsImpl.existsSync(path.join(d, 'run.json'))) ?? where[0]));
  }
  return { dirs: out };
}
