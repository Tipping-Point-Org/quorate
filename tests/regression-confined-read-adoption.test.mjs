// run-dir-reads.plan.md stage 2 (design run-dir-reads.design.md, R-D1 A, R-D4 A; operator, 2026-10-29: "Approve"): every
// read-family call in scripts/ is allowed only through the owner or in a named place. ARCHITECTURE.md A-30 says what a
// script reads below a run directory to decide something goes through `confined`; run-dir-descendants.plan.md's stage 4
// test held only the writes, so reads were converted where a review named them, and each review found the next raw read
// (20261029-065343-rdd-remediation-2-review, 20261029-134336-rdd-remediation-3-review). This is the read side's test.
//
// Three tables, kept apart:
//   WHOLE_FILE: files whose reads decide nothing below a run, each with what it reads.
//   OUTSIDE:    lines in files that also read runs, which stay outside the owner, each with its reason.
//   PENDING:    every raw read below a run that decides something, found when this test was written, each naming the
//               plan stage that converts it (3: the helpers and the status probes; 4: the entry scripts). A stage removes
//               an entry when it converts the site. This enumeration, not the design note's census, is that set. Empty
//               since stage 4, and held empty by the last test below.
// A line entry is a prefix of the line from its first read call, with exactly how many lines it matches; the longest
// matching prefix takes the line, and an entry whose count no longer matches fails, so no table can outlive its sites.
// The count of read lines found has a floor, so a pattern that stops matching cannot pass vacuously.
//
// THE RESIDUAL, stated as the write test states its own: a read through an aliased fs (a destructured readFileSync, a
// module that re-exports fs under another name) is not seen by a source scan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

// The read-family names: the census regex of run-dir-reads.design.md, its one copy in tests/tools/read-census.mjs. `realpathSync.native(` is the same read
// (G-18 of 20261029-212858-rdr-remediation-2-review): the scan missed it, and external-review followed a link below the
// evidence sink through it unseen. A COPY READS ITS SOURCE (G-7 of 20261030-010649-rdr-remediation-5-review): --rejudge
// copied a preserved run's report with copyFileSync, following a link at any level, and the scan never saw it.
// The second alternative is the same family spelled as a promise or a callback (G-13 of
// 20261105-070121-crsf-remediation-2-review, the write census's blind spot, which this one shared), on an fs-named receiver.
import { READ } from './tools/read-census.mjs';

const WHOLE_FILE = {
  'scripts/lib/confined-path.mjs': "the owner itself",
  'scripts/bench-admit.mjs': "bench results",
  'scripts/check-counted-facts.mjs': "the documents and tests whose counts it checks",
  'scripts/check-install.mjs': "the install, the contract and the profiles",
  'scripts/publish.mjs': "a throwaway clone of one commit, its snapshot, the local identity patterns and the --out public clone (never a run directory)",
  'scripts/check-intent-grant.mjs': "a temporary probe repository and the probe run it mints there and removes",
  // capture-interactive.plan.md stage 4-5: --stdin-file and a `<` the command names are what the caller asked the command
  // to read; the evidence folder is the caller's own, never a run directory.
  'scripts/io/capture-interactive.mjs': "--stdin-file and the files a command's own `<` names, and the caller's --evidence-dir",
  'scripts/check-plan-verdict.mjs': "a plan-review verdict under .claude/plan-reviews",
  'scripts/check-quotes.mjs': "the build log and the session digests",
  'scripts/check-reviewers.mjs': "the roster",
  'scripts/check-syntax.mjs': "the source files it parses",
  'scripts/claim-check.mjs': "claim-check folders under .claude/claim-checks",
  'scripts/code-index.mjs': "the code index cache under the engine's home, and the repository",
  'scripts/decide.mjs': "the question file it is given, the roster and the seats' JSON answers (every read below .claude/decisions goes through confined since decision-records.plan.md stage 6, and the declared plan since G-2 of 20261110-025747-dps-remediation-5-review)",
  'scripts/run-session.mjs': 'the plan it is started on, inside the repository, for its front matter; nothing below a run directory',
  'scripts/io/cli-freshness.mjs': 'the roster, beside this framework\'s scripts',
  'scripts/io/decision-run.mjs': "none raw below .claude/decisions: the record and the scratch through confined (decision-records.plan.md stage 6)",
  'scripts/io/basis-values.mjs': "the verdict schema the engine ships, for its basis enum (decision-records.plan.md stage 2)",
  'scripts/extract-sessions.mjs': "the session transcripts and their digests",
  'scripts/find-inert-features.mjs': "the repository and the contract",
  'scripts/gen-rule-text.mjs': "the documents whose marked regions it writes",
  'scripts/io/doc-snapshot.mjs': "the declared documents in the repository",
  'scripts/io/glob-walk.mjs': "the repository tree",
  'scripts/io/intent-cache.mjs': "the intent cache under the engine's home",
  'scripts/io/repo-lock.mjs': "the repository lock under the engine's home",
  'scripts/io/reviewer-probe.mjs': "the reviewer probe records under the engine's home",
  'scripts/io/run-dirs.mjs': "the reviews folders listed for runs, before any is admitted",
  'scripts/io/session-contract.mjs': "the contract",
  'scripts/io/snapshot.mjs': "the arms' directory (a snapshot of the repository, not a run)",
  'scripts/io/transcript-copy.mjs': "a session transcript copied into a claim-check folder",
  'scripts/io/worktree.mjs': "the framework copied into the arms' directory",
  'scripts/lib/claim-check.mjs': "a claim-check folder",
  'scripts/lib/excerpt.mjs': "a repository file excerpted",
  'scripts/lib/project-paths.mjs': "the repository's project files",
  'scripts/lib/project-profile.mjs': "a project profile in the repository",
  'scripts/io/stdin-file.mjs': "a child's stdin text, opened for the child from its own folder below the engine home's stdin/, outside every run (stdin-folder-owner.plan.md)",
  'scripts/io/egress-read.mjs': "the egress owner's host binding: the link count of an intent document as its declared link leads (hardlink-egress.plan.md); its reads go through confined",
  'scripts/lib/reviews-root.mjs': "the run root, before admission",
  'scripts/lib/template.mjs': "a prompt template beside the engine",
  'scripts/lib/version.mjs': "the framework's version stamp",
  'scripts/preflight.mjs': "the contract",
  'scripts/spawn-subagent.mjs': "the caller's prompt file",
  'scripts/stop-guard.mjs': "the session records",
};

const OUTSIDE = {
  // Held line by line since contract-runtime-and-session-files.plan.md stage 3 (CR-D3 A): every telemetry record is read
  // through the owner (ownerBelow); these reads are of the engine's own files, a temporary file, and a real path.
  'scripts/io/telemetry-record.mjs': [
    ["readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }", 1, "readJson: the engine's own roster and adapter table, beside its scripts"],
    ["readJson(path.join(SCRIPTS, 'lens-roster.json')) ?? {};", 1, "the roster beside the engine"],
    ["realpathSync(p); return hostPlatform().caseInsensitiveFs ? real.toLowerCase() : real; };", 1, "whether the repository is the engine's own, by real path"],
  ],
  // Held line by line, not whole (G-23 of 20261105-052942-crsf-delivery): whole, its raw lock read (G-7) and its stat that
  // followed a link (G-9) passed unseen. Every other read goes through confined, rooted at the engine's home.
  'scripts/io/stop-log.mjs': [
    ["openSync(own.resolve(fsegs), 'r'); }", 1, "the tail read's descriptor, at a name the owner resolved (the owner holds no descriptor)"],
    // G-2 of 20261106-013812-stoplog-g8-remediation-review: the append asks whether the record ends mid-line, reading the
    // last byte of the file the owner resolved for the append itself, under its lock. The read is io/torn-tail.mjs's since
    // G-3, G-4 of 20261106-022028-stoplog-g8-remediation-2-review, below.
    // Each read's lines go through parseLines since G-8 of 20261106-005647-stoplog-g8-review, so the count of lines that
    // did not parse is kept: readSessionEvents joins the session's files, then parses them once.
    ["readText(own, f)).join(''));", 1, "a session file read through the owner (readText is own.read)"],
    // One file at a time since G-9 of 20261105-163851-crsf-d1-review: the tail read and the summary's sweep, each trimmed
    // or kept as it goes.
    ["readText(own, f));", 2, "a session file read through the owner, one at a time"],
  ],
  // The one owner of a JSONL file's torn-tail check (G-3, G-4 of 20261106-022028-stoplog-g8-remediation-2-review): the
  // last byte of a file its caller resolved and is about to append to (stop-log's through its owner, the claim-check
  // journal, the kill log).
  'scripts/io/torn-tail.mjs': [
    ["statSync(file).size; } catch (e) { if (e?.code === 'ENOENT') return false; throw e; }", 1, "the size of the file the caller appends to"],
    ["openSync(file, 'r');", 1, "its last byte's descriptor, at the path the caller resolved"],
    // appendOwnFile (G-8 of 20261114-022647-m2-7b-review): the append's descriptor, fstat'ed so a hard link is refused.
    ["openSync(file, 'a');", 1, "appendOwnFile's descriptor, at the path the caller resolved, its name count judged on it"],
  ],
  // THE RECORD LOCK (stop-record-bounds-and-kill-log.plan.md stage 1, KL-D1 B): the stop record's lock, moved out of
  // io/stop-log.mjs, and the kill log's since; the lock is resolved and read through the caller's confined owner.
  'scripts/io/record-lock.mjs': [
    ["openSync(lock, 'wx'); } catch (e) {", 1, "an openSync that WRITES: the lock created exclusively, at a name the owner resolved"],
  ],
  // Held line by line rather than whole (G-22 of 20261029-190658-rdr-delivery): both read runs.
  'scripts/capture.mjs': [
    ["existsSync(givenRunDir)) die(`run dir does not exist: ${givenRunDir}`);", 1, "the run root, before admission"],
    ["realpathSync(repoRootForCwd); realWanted = fs.realpathSync(wanted); } catch {", 1, "the repository and a --cwd inside it"],
    ["realpathSync(wanted); } catch {", 1, "the repository and a --cwd inside it: the second read on that line (G-16)"],
  ],
  'scripts/lib/run-artifacts.mjs': [
    ["readJson(owner, segments) {", 1, "its own owner-read helper, declared"],
    ["readJson(ownerOf(run, io), segs);", 2, "a run's record, read through the owner (ownerOf; run-dir-reads stage 3)"],
    ["readJson(ownerOf(run, io), ['run.json']);", 1, "run.json, read through the owner"],
    ["readJson(owner, parts);", 1, "a run's record, read through the owner"],
    ["readRunRecord(run, { io } = {}) {", 1, "readRunRecord declared; it reads through the owner"],
    ["readRunRecord(owner, { io });", 1, "run.json, read through the owner"],
  ],
  // Held line by line, not whole (G-9 of 20261030-153323-ciss-s7-remediation-2-review): telemetry.mjs and usage-report.mjs
  // were allowed whole, and archive-run's sibling run.json read was named here, so each read run.json raw and passed.
  // No raw read left (G-1 of 20261105-074139-crsf-remediation-3-review): the run roots are listed for citation discovery
  // through an owner walked from the repository or quorate's home, and each sibling's run.json is read through it.
  'scripts/archive-run.mjs': [],
  'scripts/telemetry.mjs': [
    // No raw listing (G-10 and G-12 of 20261105-151040-crsf-remediation-4b-review): the run roots, claim-check folders and
    // bench results were listed with a raw readdirSync named here, so a junction at a record root was followed unseen.
    // No raw stat and no raw bench read (G-12, G-15 and G-16 of 20261105-074139-crsf-remediation-3-review): a claim
    // check's files and a bench results file are asked of their owners, rooted at the repository.
    ["realpathSync(quorateHome());", 1, "quorate's home, to tell a staged root from an archived one"],
    ["realpathSync(root);", 1, "a run root, to tell a staged root from an archived one"],
  ],
  // The ledger and the transcripts are read through owners rooted at their folders (usage-report-reviewed-runs.plan.md
  // stage 3): only the listing before a run is admitted is read raw. No entry for the two roots (G-8, G-7 of
  // 20261102-211111-rbr-remediation-4-review): their realpath hid a link at the owner's root, so each folder is now the
  // owner's root as named, and the owner checks it. The reviews folder is listed through its owner too (G-11 of
  // 20261102-220302-rbr-remediation-5-review), so no raw read is left.
  'scripts/usage-report.mjs': [],
  'scripts/external-review.mjs': [
    ["existsSync(f) ? fs.readFileSync(f, 'utf8') : '';", 1, "the adapter's answer file in a temporary folder, when there is no evidence sink; with one, it is read through the sink's owner"],
    ["readFileSync(f, 'utf8') : '';", 1, "the same answer file, read after the probe on that line (G-16)"],
    ["readFileSync(path.join(HERE, 'lens-roster.json'), 'utf8'));", 1, "the roster beside the engine"],
    ["realpathSync.native(outDir);   // native: the JS one keeps", 1, "the --out folder and the run root compared at admission, before the owner exists"],
    ["realpathSync.native(lexicalRoot);", 1, "the --out folder and the run root compared at admission, before the owner exists"],
    ["openSync(path.resolve(args.out), 'wx'); } catch (e) {", 1, "an openSync that WRITES: --out created exclusively (OUT-1 to OUT-8)"],
    ["readdirSync(d, { withFileTypes: true })) {", 1, "the probe's empty surface repository, a temporary folder"],
    ["readFileSync(p, 'utf8');", 1, "the probe's empty surface repository, a temporary folder"],
    ["lstatSync(root).isDirectory() || !fs.lstatSync(path.join(root, '.git')).isDirect", 1, "the probe's empty surface repository, a temporary folder"],
    ["lstatSync(path.join(root, '.git')).isDirectory()) return", 1, "the same surface repository's .git, the second read on that line (G-16)"],
    ["readdirSync(schemaDir)) fs.unlinkSync(path.join(schemaDir, f));", 1, "the temporary schema folder emptied"],
    ["statSync(surfaceDir, { throwIfNoEntry: false })?.isDirectory()) {", 1, "the --surface folder, the arms' snapshot, not a run"],
    // Below the sink the owner says whether the answer file was written (G-8 of 20261029-212858-rdr-remediation-2-review).
    ["existsSync(f) ? 'the response did not parse' : 'the response file was never written", 1, "the adapter's answer file in a temporary folder, when there is no evidence sink"],
    ["realpathSync.native(outDir);", 1, "the --out folder's own case at admission, for OUT-8; nothing below it is resolved"],
  ],
  // Held line by line rather than whole (G-19 of 20261029-212858-rdr-remediation-2-review): both read runs.
  'scripts/bench-lenses.mjs': [
    ["readFileSync(file, 'utf8'));", 1, "a corpus manifest"],
    ["existsSync(CORPUS_DIR)) die", 1, "the corpus"],
    ["readdirSync(CORPUS_DIR, { withFileTypes: true })", 1, "the corpus"],
    ["existsSync(patch)) die", 1, "a corpus seed's patch"],
    ["readFileSync(contractPath, 'utf8');", 1, "the contract in the seeded worktree, a repository checkout"],
    ["existsSync(seededFile)) {", 1, "the seeded worktree, a repository checkout"],
    ["readFileSync(seededFile, 'utf8'), e.manifest.defect.anchor);", 1, "the seeded worktree, a repository checkout"],
    ["existsSync(runDir) && fs.existsSync(archivedDir)) runDir = archivedDir;", 1, "the run root, staged or archived, before collectRun admits it (R-D4 A)"],
    ["existsSync(archivedDir)) runDir = archivedDir;", 1, "the archived spelling of the same run root, before it is admitted (R-D4 A; G-16)"],
    ["existsSync(runDir)) {", 2, "the run root, before collectRun admits it / the run root, before it is preserved whole (R-D4 A)"],
    ["promises.cp(runDir, dest, { recursive: true });", 1, "the run root preserved whole; a link below it is copied as a link, not followed"],
  ],
  'scripts/bench-second-opinion.mjs': [
    ["readFileSync(p, 'utf8'));", 1, "the --forged file the operator names"],
    ["existsSync(RESULTS_DIR)) return null;", 1, "bench results"],
    ["readdirSync(RESULTS_DIR)", 1, "bench results"],
    ["existsSync(resultPath)) {", 1, "the bench result to mutate"],
    ["readFileSync(resultPath, 'utf8'));", 1, "the bench result to mutate"],
    ["readFileSync(ROSTER, 'utf8'));", 1, "the roster beside the engine"],
    ["existsSync(c.runDir);", 1, "display: whether a preserved run is present, listed (R-D4 A)"],
    // The forge's prompt, read once before io/forge-spawn.mjs is given it (decision-panel-seats.plan.md stage 2).
    ["readFileSync(promptPath, 'utf8');", 1, "a prompt this bench wrote itself"],
    ["existsSync(c.runDir)) {", 1, "a preserved run's root, before it is read (R-D4 A)"],
    ["lstatSync(c.runDir); }", 2, "a preserved run's root itself, for --candidate's setting in force and for the seed, refused when it is a link before it is read (R-D4 A; G-5 of 20261029-235315-rdr-remediation-4-review)"],
    ["existsSync(manifestPath)) {", 1, "the corpus manifest"],
    ["readFileSync(manifestPath, 'utf8')); } catch (e) {", 1, "the corpus manifest"],
    // A link below it is refused by the copy's filter (G-6 of 20261030-024618-rdr-remediation-6-review): it was kept.
    ["cpSync(c.runDir, copy, { recursive: true, filter: (from) => {", 1, "a preserved run copied whole into the bench's own copy, its root refused as a link above and a link below refused by the filter"],
    ["lstatSync(from);", 1, "each entry of the preserved run, looked at by the copy's filter: refused when a link, never followed, and named when a hard link (usage-report-followup.plan.md stage 1)"],
    ["readRunRecord(c.runDir);", 2, "lib/run-artifacts' readRunRecord, which reads the preserved run through its owner, for --candidate and for the seed"],
    ["readFileSync(path.join(copy, 'run.json'), 'utf8'));", 1, "the bench's own staged copy of a preserved run, rewritten for its worktree (R-D4 A)"],
    ["readFileSync(reconciledPath, 'utf8')", 3, "the bench's own staged copy of a preserved run (R-D4 A)"],
    ["readFileSync(payloadPathEarly, 'utf8'));", 1, "the bench's own staged copy of a preserved run (R-D4 A)"],
    ["readFileSync(fgPath, 'utf8')),", 2, "the bench's own staged copy of a preserved run (R-D4 A)"],
    ["readFileSync(payloadPath, 'utf8')),", 2, "the bench's own staged copy of a preserved run (R-D4 A)"],
    ["existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : null;", 1, "the bench's own staged copy of a preserved run: the control report (R-D4 A)"],
    ["readFileSync(reportPath, 'utf8') : null;", 1, "the same control report, read after the probe on that line (R-D4 A; G-16)"],
    ["existsSync(reportPath)) {", 1, "the bench's own staged copy of a preserved run: the report the node wrote (R-D4 A)"],
    ["readFileSync(reportPath, 'utf8');", 1, "the bench's own staged copy of a preserved run: the report the node wrote (R-D4 A)"],
    ["existsSync(copy)) console.log", 1, "display: whether the kept copy exists, printed (R-D4 A)"],
  ],
  'scripts/findings-ledger.mjs': [
    ["readRunRecord(admitted.dir);", 1, "lib/run-artifacts' readRunRecord, which reads the admitted run through its owner"],
    // No entry for the ledger's folder (G-8 of 20261102-201017-rbr-remediation-3-review): its realpath hid a link at the
    // owner's root, so the folder is now the owner's root as named, and the owner checks it.
    ["realpathSync.native(repo); } catch {", 1, "the ledger's repository, to find its run roots"],
    ["lstatSync(p);", 1, "the migration report beside the ledger"],
    ["readFileSync(p, 'utf8').startsWith(MIGRATION_REPORT_HEADING);", 1, "the migration report beside the ledger"],
    // No entry for the run root (G-8 of 20261102-220302-rbr-remediation-5-review): its existsSync ran after admission, on
    // the caller's spelling, and is gone; the fold uses the admitted directory only.
  ],
  'scripts/io/atomic.mjs': [
    ["openSync(tmp, 'w');", 1, "an openSync that WRITES: the temporary file of a durable write"],
    ["readFileSync(q, 'utf8') } = {}) {", 1, "the durable append reads the file it is about to replace; its callers own the path"],
    ["statSync(lockPath).mtimeMs; } catch (e) { return gone(e); }", 1, "a file lock's own age, under the engine's home or beside the ledger"],
    ["readFileSync(lockPath, 'utf8').trim()); } catch (e) { return gone(e); }", 1, "a file lock's holder"],
    ["openSync(reclaim, 'wx'));", 1, "an openSync that WRITES: a lock's reclaim marker"],
    ["statSync(reclaim).mtimeMs > RECLAIM_STALE_MS) fs.rmSync(reclaim, { force: true }", 1, "a lock's reclaim marker's age"],
  ],
  'scripts/io/preflight-cache.mjs': [
    ["existsSync(p)) files.add(p);", 1, "the repository's input files hashed for the pre-flight"],
    ["existsSync(sub) && isOwnRepo(sub) ? listRepo(sub, `${prefix}${g}/`, depth + 1) :", 1, "the repository's input files hashed for the pre-flight"],
    ["readFileSync(preflightCachePath(reviewsDir, hash), 'utf8'));", 1, "the pre-flight cache under the engine's home"],
    ["lstatSync(p);", 2, "the pre-flight cache's size, under the engine's home / the cached evidence being restored, under the engine's home"],
    ["readdirSync(p).reduce((sum, name) => sum + sizeOf(path.join(p, name)), 0);", 1, "the pre-flight cache's size, under the engine's home"],
    ["existsSync(dir)) return [];", 1, "the pre-flight cache's entries, under the engine's home"],
    ["readdirSync(dir)) {", 1, "the pre-flight cache's entries, under the engine's home"],
    ["statSync(full).mtimeMs;", 1, "the pre-flight cache's entries, under the engine's home"],
    ["lstatSync(src); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }", 1, "the cached evidence being restored, under the engine's home (its target in the run goes through the owner)"],
    ["readdirSync(dir, { withFileTypes: true })) {", 1, "the cached evidence being restored, under the engine's home"],
    ["readFileSync(e.from));", 1, "the cached evidence being restored, under the engine's home"],
  ],
  'scripts/io/reviews-root.mjs': [
    ["existsSync(ignorePath)) {", 1, "the reviews folder's .gitignore"],
    ["readFileSync(ignorePath, 'utf8')) };", 1, "the reviews folder's .gitignore"],
    ["existsSync(ignorePath) ? pure.ignoreRulesMissing(hostFs.readFileSync(ignorePath,", 1, "the reviews folder's .gitignore"],
    ["readFileSync(ignorePath, 'utf8')) : [];", 1, "the reviews folder's .gitignore: the second read on that line (G-16)"],
    ["readdirSync(plan.from)) {", 1, "the staged run's top level, listed to move it whole into the archive"],
    ["cpSync(plan.from, plan.tmp, { recursive: true, filter: (src) => !withheld(src) });", 1, "the admitted staged run copied whole into the archive; a link below it is copied as a link, not followed"],
    ["existsSync(path.join(archiveRoot, '.gitignore'))) return true;", 1, "the archive folder's .gitignore"],
    ["realpathSync.native(p); } catch { return path.resolve(p); } };", 1, "a run's parent folder and the archive folder compared (inArchive), not below a run"],
  ],
  'scripts/io/run-child.mjs': [
    ["openSync(stdoutPath, 'w');", 1, "an openSync that WRITES: a child's stdout capture"],
    ["openSync(stderrPath, 'w');", 1, "an openSync that WRITES: a child's stderr capture"],
  ],
  'scripts/lib/decision-panel.mjs': [
    ["realpathSync(root);", 1, "seatBasis: the repository's real path, to tell a cited artifact from a link to one (G-14 of 20261102-231209-rbr-remediation-6-review)"],
    ["realpathSync(path.join(root, ...n.rel.split('/')));", 1, "seatBasis: a cited file's real path, compared with the path it names, so a link under evidence/ grounds nothing (G-14)"],
  ],
  'scripts/lib/finding-scope.mjs': [
    ["readFileSync(p, 'utf8');", 1, "a repository file a lens cites"],
    ["realpathSync(dir);", 3, "a link detector: it lstats and lists without following, to report the first link (firstLinkLeaving) / a link detector (firstLinkInto) / a link detector (firstLinkOnto)"],
    ["readdirSync(d)) {", 3, "a link detector (firstLinkLeaving) / a link detector (firstLinkInto) / a link detector (firstLinkOnto)"],
    ["lstatSync(full);", 3, "a link detector (firstLinkLeaving) / a link detector (firstLinkInto) / a link detector (firstLinkOnto)"],
    ["realpathSync(full); } catch { continue; }", 3, "a link detector (firstLinkLeaving): where a found link resolves / a link detector (firstLinkInto): where a found link resolves / a link detector (firstLinkOnto): where a found link resolves"],
    ["realpathSync(into);", 1, "a link detector (firstLinkInto): the directory links are judged against"],
    ["realpathSync(onto); } catch { realOnto = absolute(onto, 'firstLinkOnto: onto'); ", 1, "a link detector (firstLinkOnto): the directory links are judged against"],
    ["realpathSync(root);", 1, "escapesAfterRealpath: containment of a repository file a lens cites"],
    ["realpathSync(abs);", 1, "escapesAfterRealpath: containment of a repository file a lens cites"],
    ["existsSync(at)) return escapesAfterRealpath(root, at, io);", 1, "a repository file a lens cites"],
    ["existsSync(at)) {", 2, "a repository file a lens cites (linkForms) / canonicalSpelling: the nearest existing ancestor of a root (CI run 43281517496)"],
    ["existsSync(q)", 2, "ancestorSpelling (rootSpelling, belowRoot): the nearest existing ancestor of a root, asked directly or once per check through belowRoot's memo (ci-path-identity.plan.md stage 1c; G-6 of 20261118-131040-cpi-remediation-review)"],
    ["existsSync(fileAbs)) {", 1, "a repository file a lens cites"],
    ["lstatSync(level).isSymbolicLink()) prefix = path.dirname(level); } catch { return lexical; }", 1, "canonicalSpelling: only the part of a root above any link is respelled, so a respelling never follows a link (CI run 43281517496)"],
  ],
  'scripts/new-run.mjs': [
    ["readFileSync(path.join(FRAMEWORK.scriptsDir, 'lens-roster.json'), 'utf8'));", 2, "the roster beside the engine"],
    ["existsSync(p)) die(`no such file: ${p}`);", 1, "a contract or request file the operator names"],
    ["readFileSync(p, 'utf8'));", 1, "a contract or request file the operator names"],
    ["existsSync(abs) ? egressReadFile(abs, 'utf8', { repoRoot }) : null };", 1, "a repository file: a contract candidate, read through the egress owner (G-12 of 20261112-063354-hl-remediation-4-review)"],
    ["existsSync(dir)) {", 1, "the requests folder, discovering a request"],
    ["readdirSync(dir)", 1, "the requests folder, discovering a request"],
    ["statSync(abs).isFile())", 1, "the requests folder, discovering a request"],
    ["readFileSync(abs, 'utf8')));", 1, "the requests folder, discovering a request"],
    ["existsSync(abs)) return { ok: false, why: `request not found at ${candidate}` };", 1, "the declared request"],
    ["readFileSync(abs, 'utf8');", 2, "the declared request / the request a remediation inherits, in the repository"],
    ["existsSync(abs)) die(`the request ${inh.path}, which ${inheritFrom.run_id} was j", 1, "the request a remediation inherits, in the repository"],
    ["existsSync(path.join(FRAMEWORK.scriptsDir, 'external-review.mjs'))) {", 1, "the engine's own scripts"],
    ["existsSync(consumerSkillsDir) && path.resolve(consumerSkillsDir) !== frameworkSk", 1, "the consumer's skills folder, for name collisions"],
    ["readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, marker)));", 1, "the consumer's skills folder, for name collisions"],
    ["existsSync(path.join(dir, d, marker)));", 1, "a skill folder inside the same skills folder (G-16)"],
    ["existsSync(runDir)) die(`run dir already exists: ${runDir}`);", 1, "the run root, before it is created exclusively"],
    ["existsSync(p)) continue;", 1, "the contract and the documents it declares"],
    ["readFileSync(p, 'utf8');", 1, "the contract and the documents it declares"],
    ["existsSync(skillFile(FRAMEWORK.skillsDir, 'plan-review')) ? 'available' : 'defer", 1, "the engine's own skills"],
    ["readFileSync(intentTarget, 'utf8')", 1, "the repository source the intent canary must not be able to read"],
  ],
  'scripts/remediate.mjs': [
    ["existsSync(path.join(repo, p))) return { hash: 'absent' };", 1, "a repository file hashed"],
    ["existsSync(path.join(repo, p))) hashes[p] = 'absent';", 1, "a repository file hashed"],
    // G-7 of 20261107-203720-co-remediation-3-review: --replay-node keeps the mode of the repository file it replaces.
    ["statSync(path.join(repo, ...segs)).mode & 0o777 : null;", 1, "--replay-node: the mode of the candidate's repository file it replaces, so an exec bit is kept"],
    ["readdirSync(root, { withFileTypes: true }); } catch (e) {", 1, "the reviews folders listed for runs of this repository, each admitted before it is read; an error other than ENOENT is named as an incomplete census (G-12 of 20261105-163851-crsf-d1-review)"],
    ["readFileSync(path.join(FRAMEWORK.scriptsDir, 'lens-roster.json'), 'utf8'));", 1, "the roster beside the engine"],
    ["realpathSync.native(path.resolve(String(p))); } catch { return null; } };", 1, "--replay-node: the run and repository a replay record names, resolved to compare with the admitted ones (repair-bench-replay.plan.md, BR-D2 A)"],
    // The --replay-node folder itself is checked by the owner, which checks its root (G-10 of
    // 20261102-184751-rbr-remediation-2-review); its own lstat and realpath here are gone.
  ],
  'scripts/run-graph.mjs': [
    ["readFileSync(path.join(scriptsDir, 'lens-roster.json'), 'utf8'));", 1, "the roster beside the engine"],
    ["existsSync(abs)) {", 1, "a repository file"],
    ["existsSync(path.join(d, 'disk-first-protocol.md'))) ?? null;", 1, "the engine's doctrine folder"],
    ["existsSync(shared)) {", 1, "the engine's doctrine folder"],
    ["readdirSync(shared).filter(isDocumentName)) {", 1, "the engine's doctrine folder"],
    ["realpathSync(repoRoot); } catch { return path.resolve(repoRoot); } })();", 1, "the repository and its declared request"],
    ["realpathSync(reqAbs); } catch { return null; } })();", 1, "the declared request"],
    ["readFileSync(resolvedReq, 'utf8')).digest('hex') : null;", 1, "the declared request"],
    ["existsSync(reqAbs)", 1, "the declared request"],
    ["existsSync(snapDir)) console.log(`   declared docs snapshotted to ${path.relativ", 1, "display: whether the declared docs were snapshotted, printed (R-D4 A)"],
    ["existsSync(finalFile); n++) {", 1, "the requests folder, for a free name for an inferred request"],
    ["readdirSync(dir)", 1, "the requests folder"],
    ["statSync(path.join(dir, f)).mtimeMs }))", 1, "the requests folder"],
    ["readFileSync(c.abs, 'utf8');", 1, "the requests folder"],
    ["existsSync(path.join(destFramework, 'scripts', 'find-inert-features.mjs'));", 1, "the framework copied into the arms' directory"],
    ["existsSync(path.join(destFramework, ...r.split('/'))));", 2, "the framework copied into the arms' directory"],
    ["existsSync(path.join(scriptsDir, 'external-review.mjs'))) return [];", 1, "the engine's own scripts"],
    // The external arm's lens instructions now read through the egress owner (G-12 of 20261112-054852-hl-remediation-3-review).
    ["existsSync(path.join(scriptsDir, 'external-review.mjs'));", 1, "the engine's own scripts"],
    // No entry for nodes/'s status files (G-17 of 20261029-190658-rdr-delivery): it was excused as display, and its
    // listing decides PANEL-DEGRADED, so it goes through the owner.
  ],
  'scripts/spawn-node.mjs': [
    ["existsSync(settingsPath);", 1, "a --settings file the caller named outside the run; one below the run is asked of its owner (policyPresent)"],
    ["existsSync(abs) && fs.statSync(abs).isDirectory();", 1, "an intent --add-dir outside the run (a repository root); one below the run is stat'ed through its owner"],
    ["statSync(abs).isDirectory();", 1, "the same --add-dir, stat'ed after the probe on that line (G-16)"],
    ["readFileSync(p)).digest('hex');", 1, "sha256File of a policy file the caller named outside the run; below the run it reads through the owner"],
    ["existsSync(givenRunDir)) die(`run dir does not exist: ${givenRunDir} (create it ", 1, "the run root, before admission"],
    ["statSync(d);", 1, "the run root, before admission"],
    ["readFileSync(path.join(FRAMEWORK.scriptsDir, 'lens-roster.json'), 'utf8'));", 1, "the roster beside the engine"],
    ["statSync(a, { bigint: true }); const y = fs.statSync(b, { bigint: true }); retur", 1, "whether two spellings name the run root itself, by identity"],
    ["statSync(b, { bigint: true }); return x.dev", 1, "the second spelling of the same identity check (G-16)"],
    ["existsSync(found.file)) {", 1, "a project profile in the repository"],
    ["statSync(p).size;", 1, "display: a capture's size, recorded in the status (R-D4 A)"],
    ["readdirSync(evidenceDir, { withFileTypes: true })", 1, "display: the evidence a killed node left, reported as forensics (R-D4 A)"],
    ["statSync(path.join(evidenceDir, e.name)).mtimeMs }));", 1, "display: the evidence a killed node left, reported as forensics (R-D4 A)"],
  ],
  'scripts/io/run-artifacts.mjs': [
    ["readRunRecord(runDir, { ...opts, io: hostPlatform() });", 1, "the host binding of lib/run-artifacts' readRunRecord, which reads through the owner"],
  ],
};

const PENDING = {
};

const codeLines = (src) => src.split(/\r?\n/).map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l));

// The scan, over { path: source }: the reads found, those in no table, and how many lines each line entry took.
function scan(sources, { outside = OUTSIDE, pending = PENDING } = {}) {
  const offenders = [];
  const used = new Map();
  let found = 0;
  for (const [f, src] of Object.entries(sources)) {
    for (const { l, n } of codeLines(src)) {
      // EVERY read on the line (G-16 of 20261029-224143-rdr-remediation-3-review): the first alone let a named read hide
      // an unnamed one after it.
      const reads = [...l.matchAll(new RegExp(READ.source, 'g'))];
      if (!reads.length) continue;
      found++;
      if (WHOLE_FILE[f]) continue;
      for (const m of reads) {
        const from = l.slice(m.index);
        const entry = [...(outside[f] ?? []), ...(pending[f] ?? [])].filter(([p]) => from.startsWith(p))
          .sort((a, b) => b[0].length - a[0].length)[0];
        if (entry) { used.set(entry, (used.get(entry) ?? 0) + 1); continue; }
        offenders.push(`${f}:${n}: ${from.trim().slice(0, 110)}`);
      }
    }
  }
  return { found, offenders, used };
}

const staleIn = (table, used) => Object.entries(table).flatMap(([f, list]) => list.filter((e) => (used.get(e) ?? 0) !== e[1])
  .map(([p, count]) => `${f}: "${p}" matched ${used.get(list.find((x) => x[0] === p)) ?? 0} line(s), named for ${count}`));

test('run-dir-reads stage 2: the scan reports a raw read below a run that no table names', () => {
  const r = scan({
    'scripts/scratch.mjs': "import fs from 'node:fs';\nconst s = fs.readFileSync(path.join(runDir, 'nodes', 'x.json'), 'utf8');\n",
    'scripts/run-graph.mjs': "if (fs.existsSync(path.join(runDir, 'evidence', id, 'new.json'))) go();\n",
  });
  assert.equal(r.found, 2);
  assert.deepEqual(r.offenders.map((o) => o.split(':')[0]), ['scripts/scratch.mjs', 'scripts/run-graph.mjs'],
    'a raw read below a run is reported, in a new file and in a file with named lines alike');
  assert.equal(scan({ 'scripts/scratch.mjs': "// fs.readFileSync(path.join(runDir, 'x'));\n" }).found, 0, 'a comment is not a read');
  assert.deepEqual(scan({ 'scripts/scratch.mjs': "const r = fs.realpathSync.native(path.join(runDir, 'evidence'));\n" }).offenders
    .map((o) => o.split(':')[0]), ['scripts/scratch.mjs'], 'realpathSync.native is a read (G-18)');
  const longest = scan({ 'scripts/a.mjs': 'fs.readdirSync(dir).length;\nfs.readdirSync(dirB);\n' },
    { outside: { 'scripts/a.mjs': [['readdirSync(dir', 2, 'x'], ['readdirSync(dir)', 1, 'y']] }, pending: {} });
  assert.deepEqual(longest.offenders, []);
  assert.deepEqual([...longest.used.values()], [1, 1], 'the longest matching prefix takes a line');
});

// G-16 of 20261029-224143-rdr-remediation-3-review (panel-codex-contract): the scan ran READ once per line and classified
// the whole line from that first match, so a named OUTSIDE read followed on the same line by an unnamed raw read below a
// run passed. Every read on a line is classified.
test('G-16: a second read on a line is classified, not hidden behind the first', () => {
  const r = scan({ 'scripts/a.mjs': "const n = fs.readdirSync(dir).length + fs.readFileSync(path.join(runDir, 'nodes', 'x.json')).length;\n" },
    { outside: { 'scripts/a.mjs': [['readdirSync(dir)', 1, 'a directory outside any run']] }, pending: {} });
  assert.equal(r.offenders.length, 1, 'the unnamed raw read after a named one on the same line is not reported');
});

// G-13 of 20261105-070121-crsf-remediation-2-review: the write census saw only synchronous names, and this one did too, so
// a read through fs.promises, a promises import, or a callback-style fs call passed unseen.
test('G-13: promise and callback reads are reads the census sees', () => {
  const lines = [
    "const s = await fs.promises.readFile(path.join(runDir, 'run.json'), 'utf8');",
    "const e = await fsp.readdir(path.join(runDir, 'nodes'));",
    "fs.readFile(path.join(runDir, 'run.json'), 'utf8', cb);",
    "fs.stat(path.join(runDir, 'gate.json'), cb);",
    "await promises.lstat(path.join(runDir, 'evidence'));",
  ];
  const r = scan({ 'scripts/scratch.mjs': `${lines.join('\n')}\n` }, { outside: {}, pending: {} });
  assert.equal(r.found, lines.length, 'a promise or callback read is not counted as a read');
  assert.equal(r.offenders.length, lines.length, 'a raw promise or callback read is not reported');
});

test('run-dir-reads stage 2: every read in scripts/ goes through the owner or is named, with its reason or its stage', () => {
  const files = spawnSync('git', ['ls-files', 'scripts/*.mjs', 'scripts/**/*.mjs'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .stdout.split(/\r?\n/).filter(Boolean);
  const { found, offenders, used } = scan(Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')])));
  assert.deepEqual(offenders, [], `reads neither through the owner nor named here:\n${offenders.join('\n')}`);
  const stale = [...staleIn(OUTSIDE, used), ...staleIn(PENDING, used)];
  assert.deepEqual(stale, [], `entries that no longer match what they name:\n${stale.join('\n')}`);
  for (const f of Object.keys(WHOLE_FILE)) assert.ok(files.includes(f), `${f} is allowed whole but no longer exists`);
  for (const [f, list] of Object.entries(PENDING)) for (const [p, , stage] of list) {
    assert.ok(stage === 3 || stage === 4, `${f}: "${p}" names stage ${stage}; only 3 and 4 convert reads`);
  }
  // Dated, indicative: 2026-10-29 the scan found 488 read lines in 59 files, and 388 once stages 3 and 4 had routed the
  // rest through the owner. A floor well below it, so a pattern that stops matching (a rename of the names above, a change
  // of quoting) fails here instead of passing on nothing.
  assert.ok(found >= 330, `only ${found} read line(s) found: the pattern has stopped matching`);
});

// G-22 of 20261029-190658-rdr-delivery (panel-codex-arch): a file allowed whole had none of its reads scanned, so a raw
// read below a run added to a file that reads runs passed. Such a file is held line by line, as run-graph.mjs is.
test('G-22: a raw read below a run added to a file that reads runs is reported', () => {
  const planted = "const s = fs.readFileSync(path.join(runDir, 'nodes', 'x.json'), 'utf8');\n";
  // The bench runners read staged and preserved runs too (G-19 of 20261029-212858-rdr-remediation-2-review), and were
  // allowed whole.
  // And telemetry.mjs and usage-report.mjs, allowed whole while they read run.json raw (G-9 of
  // 20261030-153323-ciss-s7-remediation-2-review).
  for (const f of ['scripts/capture.mjs', 'scripts/lib/run-artifacts.mjs', 'scripts/bench-lenses.mjs', 'scripts/bench-second-opinion.mjs',
    'scripts/telemetry.mjs', 'scripts/usage-report.mjs', 'scripts/archive-run.mjs']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8') + planted;
    assert.deepEqual(scan({ [f]: src }).offenders.map((o) => o.split(':')[0]), [f], `${f}: the planted read is reported`);
  }
});

// G-23 of 20261105-052942-crsf-delivery (panel-codex-contract): stop-log.mjs was allowed whole, so its raw lock read (G-7)
// and its stat that followed a link (G-9) could not fail the census. It is held line by line.
test('G-23: a raw read added to stop-log.mjs is reported', () => {
  const f = 'scripts/io/stop-log.mjs';
  const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8') + "const t = fs.readFileSync(path.join(dir, '.lock'), 'utf8');\n";
  assert.deepEqual(scan({ [f]: src }).offenders.map((o) => o.split(':')[0]), [f], 'the planted read is reported');
});

// run-dir-reads.plan.md stage 4: every raw read below a run that decides something is converted, so PENDING is empty and
// stays so. A new one is not added to it: it goes through the owner, or into OUTSIDE with its reason, which a reviewer reads.
test('run-dir-reads stage 4: no raw read below a run is pending conversion', () => {
  const left = Object.entries(PENDING).flatMap(([f, list]) => list.map(([p]) => `${f}: "${p}"`));
  assert.deepEqual(left, [], `raw reads below a run still pending:\n${left.join('\n')}`);
});
