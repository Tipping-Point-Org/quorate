// THE INTENT NODE'S DOCUMENTS, COPIED — never granted in place (contract-glob-grammar.plan.md, stage 4, as revised by the
// operator, 2026-10-01: "B: copy only matched docs (Recommended)").
//
// Measured at stage 2b (.claude/requests/contract-glob-grammar.s2b-grant-probe.json): the intent node's Read rules,
// rendered `Read(/F:\...)`, granted nothing on Windows, and `--add-dir` on a live doc directory granted everything below
// it — `docs/*.md` exposed `docs/sub/b.md`. Two readers of one glob, the runtime's and ours, and they disagreed. So the
// node reads only its sandbox, and the sandbox holds, for every doc glob, exactly the documents lib/contract-glob.mjs's
// matchesGlob admits: one reader decides what the node sees, on every platform.
//
// Moved out of run-graph's docReadDirs, where it was a closure no test could drive (r4's G-12 and G-13 were tests that
// could only match its source text). The guards travel with it unchanged: containment, lexically and through links;
// the generated-tree prune; the one classifier of what a document is and where a link resolves; the single-file check;
// and a recorded — never silent — skip or overwrite.
import fs from 'node:fs';
import { hostPlatform } from '../platform/index.mjs';
import { egressReadDeclared, hardLinkReason } from './egress-read.mjs';
import path from 'node:path';
import { walkRoot, matchesGlob, matchesAnyGlob } from '../lib/contract-glob.mjs';
import {
  escapesAfterRealpath, classifySnapshotEntry, snapshotName, snapshotNameKey, declaredFileAdmits, isWithin,
} from './finding-scope.mjs';
// The pure form, for pruneUnder's case flag, which its caller sets (the host's isWithin takes none).
import { isWithin as isWithinCase } from '../lib/finding-scope.mjs';

/**
 * A prune predicate: true for any of `roots` or a path beneath one. Absent roots are ignored. Compared case-insensitively
 * where the filesystem is (G-4 of 20261001-034021-cgg-remediation-review): `.CLAUDE/reviews` names the same directory on
 * Windows, and a case-sensitive comparison let it through.
 */
export const pruneUnder = (roots = [], { caseInsensitive = false } = {}) => {
  // Asked of isWithin, containment's one owner (G-2 of 20261105-154708-crsf-remediation-5-review): its own fold, separator
  // and prefix test needed a patch of its own for a root ending in its separator (G-3 of 4b), beside isWithin's.
  const rs = roots.filter(Boolean).map((r) => path.resolve(r));
  return (full) => { const f = path.resolve(full); return rs.some((r) => isWithinCase(r, f, { caseInsensitive })); };
};

/**
 * THE INTENT SANDBOX'S DOCUMENTS, for every caller (G-25 of 20261001-034021-cgg-remediation-review). run-graph, the
 * new-run canary and the grant probe each composed their own prune, and the in-repository archive root was missed by one
 * and then by another. The roots are decided here: the staging root the caller names, and the repository's own
 * `.claude/reviews`, always — whether or not this run archives there, it holds other runs' artifacts.
 */
//
// The case flag defaults to THE HOST'S, so a caller cannot build a case-sensitive prune on a case-insensitive filesystem by
// forgetting it — the grant probe did (G-19 of 20261001-155615-cgg-review-r3, found first by a report's claim check).
export function snapshotIntentDocs({ repoRoot, stagingRoot = null, caseInsensitive = hostPlatform().caseInsensitiveFs, ...rest }) {
  const prune = pruneUnder([stagingRoot, path.join(repoRoot, '.claude', 'reviews')], { caseInsensitive });
  return snapshotDocGlobs({ repoRoot, caseInsensitive, prune, ...rest });
}

/**
 * A snapshot directory that records, rather than hides, one document replacing another under the same name (G-12).
 * `copy(src, name)`; skips and overwrites go to `onSkip({ item, reason })`.
 */
// `write(name, content)`, when given, makes the copy, of the content read from the checked descriptor (G-5 of
// 20261112-050334-hl-review-b): run-graph passes its run owner's (run-dir-descendants.plan.md stage 2;
// G-26 of 20261024-122231-rdt-remediation-3-review), so a link planted at declared-docs/ is refused, not written through.
export function createSnapshot(snapDir, { caseInsensitive = false, onSkip = () => {}, write = null } = {}) {
  const snapped = new Map();   // snapshot name key -> real path of the file it holds
  return {
    dir: snapDir,
    copy(src, name) {
      const real = (() => { try { return fs.realpathSync(src); } catch { return path.resolve(src); } })();
      const key = snapshotNameKey(name, { caseInsensitive });
      const prior = snapped.get(key);
      if (prior && prior !== real) {
        onSkip({ item: `doc snapshot ${name}`, reason: `${prior} and ${real} share the snapshot name ${name}; the node reads only ${real}` });
      }
      // A HARD-LINKED DOCUMENT IS REFUSED (hardlink-egress.plan.md stage 2; G-2 of
      // 20261111-235524-runtime-bin-remediation-5-review): its content may be another file's, under a name the glob
      // declares, so the walk's own rule for declared links stays and the egress owner's link-count rule is added here,
      // where every document, the doctrine and the request included, enters the sandbox. Recorded like any other skip.
      // ONE DESCRIPTOR, CHECKED AND READ (G-5 of 20261112-050334-hl-review-b): the link count was stat'ed, then the file
      // copied raw, so a second name made between the two was not seen. The content is read from the open file whose
      // count was checked, and that content, not the path, is what the writer is given.
      let content;
      try { content = egressReadDeclared(src); } catch (e) {
        const hard = e?.refusal === 'hard-link' ? hardLinkReason({ isFile: () => true, nlink: e.nlink }, src)
          : e?.refusal === 'too-large' ? `a file of ${e.size} bytes, over the bound on a file that leaves the machine`
          : `a file whose link count could not be read (${e?.code ?? e?.message ?? 'read failed'}), so it is not known to have one name`;
        onSkip({ item: `doc snapshot ${name}`, reason: `${src} is ${hard}` });
        return;
      }
      snapped.set(key, real);
      if (write) { write(name, content); return; }
      fs.mkdirSync(snapDir, { recursive: true });
      fs.writeFileSync(path.join(snapDir, name), content);
    },
  };
}

/**
 * Copy, for every glob in `docPaths`, exactly the documents it matches into `snap`. Every entry it cannot honour is
 * recorded through `onSkip` — an empty walk root, a base that does not exist, one outside the repository, one leaving
 * it through a link, a document the classifier refuses (r5's G-8 and G-9: three of these were silent).
 *
 * `prune(abs)` returns true for a path never to descend into (the reviews root and the generated globs).
 */
export function snapshotDocGlobs({
  repoRoot, docPaths = [], generatedGlobs = [], prune = () => false, snap, caseInsensitive = false, onSkip = () => {},
  readdir = (dir, opts) => fs.readdirSync(dir, opts), realpath = (p) => fs.realpathSync(p),
}) {
  const realOf = (d) => { try { return realpath(d); } catch { return path.resolve(d); } };
  const realRepoRoot = realOf(repoRoot);
  const relOf = (full) => path.relative(repoRoot, full).split(path.sep).join('/');
  const skipped = (item, reason) => onSkip({ item, reason });
  // A generated tree is matched as the filesystem names it: on a case-insensitive one `.CLAUDE/reviews/x` is in
  // `.claude/reviews/**` (G-4).
  const fold = (s) => (caseInsensitive ? s.toLowerCase() : s);
  const genGlobs = generatedGlobs.map(fold);
  const excluded = (full) => prune(full) || matchesAnyGlob(genGlobs, fold(relOf(full)));
  // ONCE PER DOCUMENT (G-5 of 20261112-063354-hl-remediation-4-review): a document under two overlapping globs was read and
  // copied once per glob. The walk is still one per glob; what it copies is not repeated.
  const copied = new Set();
  /** True the first time a document is asked about, so its copy is made once. */
  const firstCopy = (full) => {
    const key = fold(path.resolve(full));
    if (copied.has(key)) return false;
    copied.add(key);
    return true;
  };

  for (const g of docPaths) {
    // WHERE TO START is the grammar's walkRoot, not the covering prefix: `docs/README*` starts its walk in `docs/`.
    const { base } = walkRoot(g);
    if (!base) {
      skipped(`doc_paths ${g}`, 'no directory before its first wildcard, so it is not given to the intent node (its base would be the whole repository)');
      continue;
    }
    const abs = path.resolve(repoRoot, base);
    if (!fs.existsSync(abs)) { skipped(`doc_paths ${g}`, `its base ${base} does not exist`); continue; }
    // Asked of isWithin, containment's one owner (G-3 of 20261105-151040-crsf-remediation-4b-review): a hand-rolled
    // `root + path.sep` prefix skipped every document of a repository at a filesystem root.
    if (!isWithin(path.resolve(repoRoot), path.resolve(abs))) {
      skipped(`doc_paths ${g}`, 'resolves outside the repository'); continue;
    }
    if (escapesAfterRealpath(repoRoot, abs)) { skipped(`doc_paths ${g}`, 'leaves the repository through a link'); continue; }

    if (fs.statSync(abs).isDirectory()) {
      const realDocRoot = realOf(abs);
      const walk = (dir) => {
        // A directory that cannot be read is RECORDED, not thrown out of the snapshot (G-1 of
        // 20261001-031029-invoke-security-audit-cgg-high): the guards around it all route a failure to skipped().
        let entries;
        try { entries = readdir(dir, { withFileTypes: true }); } catch (e) {
          skipped(`doc snapshot ${relOf(dir)}`, `the directory could not be read (${e.code ?? e.message})`);
          return;
        }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (excluded(full)) continue;
          // The one classifier: what a document is, and where a link resolves (lib/finding-scope.mjs).
          const facts = { name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory(), docRoot: realDocRoot, repoRoot: realRepoRoot };
          let c = classifySnapshotEntry(facts);
          let resolved;
          if (c.action === 'resolve') {
            resolved = (() => { try { return realpath(full); } catch { return null; } })();
            const targetIsDir = resolved !== null && (() => { try { return fs.statSync(resolved).isDirectory(); } catch { return false; } })();
            c = classifySnapshotEntry({ ...facts, resolved, targetIsDir });
          }
          if (c.action === 'skip') continue;
          if (c.action === 'refuse') { skipped(`doc snapshot ${relOf(full)}`, c.why); continue; }
          if (c.action === 'walk') { walk(full); continue; }
          // EXACTLY WHAT THE GLOB DECLARES: a file it does not match was never declared, so passing over it is no gap.
          if (!matchesGlob(g, relOf(full))) continue;
          // A LINK IS DECLARED ONLY IF WHAT IT LEADS TO IS (G-7 of 20261001-155615-cgg-review-r3). The glob was matched on
          // the link's own path and the copy followed it, so `docs/a.md` leading to `docs/sub/notes.md` put a document
          // `docs/*.md` never declared into the sandbox. A target the glob does not match is refused, and recorded.
          const target = resolved !== undefined ? resolved : (() => { try { return realpath(full); } catch { return null; } })();
          const atItsPlace = target !== null && path.resolve(target) === path.resolve(realOf(dir), e.name);
          if (!atItsPlace) {
            const targetRel = target === null ? null : path.relative(realRepoRoot, target).split(path.sep).join('/');
            if (targetRel === null || !matchesGlob(g, targetRel)) {
              skipped(`doc snapshot ${relOf(full)}`, `is a link to ${targetRel ?? 'a path that does not resolve'}, which ${g} does not declare`);
              continue;
            }
          }
          if (firstCopy(full)) snap.copy(full, snapshotName(relOf(full)));
        }
      };
      walk(abs);
      continue;
    }
    // A SINGLE DECLARED FILE is pruned like a walked one (G-6 of 20261001-034021-cgg-remediation-review): this branch
    // copied it without asking, so a doc glob naming a file inside an archived run reached the sandbox. Recorded, because
    // unlike a file the walk passes over, this one was declared.
    if (excluded(abs)) { skipped(`doc snapshot ${relOf(abs)}`, 'lies in a review run directory or a generated tree, which the intent node is never given'); continue; }
    // A SINGLE DECLARED FILE must be the file it is declared as (G-10 of post-med4): an in-repository link to source is
    // refused, not followed.
    const resolvedFile = (() => { try { return fs.realpathSync(abs); } catch { return null; } })();
    const admits = declaredFileAdmits({ realRepoRoot, rel: path.relative(repoRoot, abs), resolved: resolvedFile, caseInsensitive });
    if (!admits.ok) { skipped(`doc snapshot ${relOf(abs)}`, admits.why); continue; }
    if (matchesGlob(g, relOf(abs)) && firstCopy(abs)) snap.copy(abs, snapshotName(relOf(abs)));
  }
}
