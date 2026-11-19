# Test selection: measured results (test-selection-exploration.md)

Raw results: `.sandbox/ts-results/` (gitignored). Machine: Windows, node 24.13.1, 32 logical cores.

## Ground truth (commit 01d94f91, 2026-10-27)

20-file sample, 0 failing clean (59 s). Affected per change, by a breaking mutation (`throw` first in `.mjs`, invalid JSON,
a garbled `.md`): C1 imported directly 2; C2 imported two levels down 11; C3 a script tests spawn 3; C4 imported only
by a spawned script 6; C5 a template a script reads 0; C6 `lens-roster.json` (read with fs) 5; C7 a test's own JSON
input 1; C8 negative control 0. A lower bound: a test that reads a file but does not fail on its mutation is not counted.

Two harness defects found on the way, both fixed before these numbers: the `.mjs` mutation was appended, so an entry
script that exits early never threw (C3 read 0); and two runs overlapped in a shared clone, one also running in the
operator's checkout (verified clean). Now one sandbox, reset before each run, with a marker guard.

## Candidates 1 and 2 (one recorder run, commit 01d94f91)

| Candidate | Misses | Over-selected | Negative control |
|---|---|---|---|
| 2: import graph, recorded in every process (`NODE_OPTIONS` preload, module hooks) | 6 (C6: 5, C7: 1) | 0 | none selected |
| 1: loads plus `fs` reads, same preload | 0 | 5 (C1: 2, C3: 1, C4: 1, C6: 1) | none selected |

Spawned children are covered by both (C3, C4: no miss). Overhead not yet measured: the recorder run took 78.4 s against
the clean run's 59 s, two unpaired single runs; the paired, interleaved measurement is pending.

## Candidate 4 (Permission Model audit mode, node 24.22.1 portable, commit 95e0d03c)

| Candidate | Misses | Over-selected | Negative control |
|---|---|---|---|
| 4: `--permission-audit` with a `node:permission-model:fs` subscriber, through `NODE_OPTIONS` | 0 | 5 (the same as 1) | none selected |

Probed first (24.22.1): module loads and fs reads are both reported, in spawned children too; a process's own entry
script is not (entry points are implicitly readable), so the subscriber records it from argv; Windows paths arrive as
`\\?\C:\...`. Every node in the tree must accept the flag: a contract command ran the installed 24.13.1 from PATH, which
refused `--permission-audit` in NODE_OPTIONS and failed 2 tests until the portable node went first on PATH. Run time
112.9 s (recorder 78.4 s, plain 59 s; single unpaired runs, overhead pending the paired measurement).

## Candidate 5 (a folder manifest per test, enforced by the Permission Model, node 24.22.1, commit a7300f07)

The manifest is candidate 4's recording collapsed to folders, a root-level file granted singly; each test runs directly
(`node <file>`) with reads limited to it.

| Candidate | Misses | Over-selected | Negative control | Tests passing under enforcement |
|---|---|---|---|---|
| 5: folder manifest, enforced | 0 | 56 (C1 selects 19 of 20) | none selected | 15 of 20 |

Why the 5 fail, none of them a read the recording missed:
- **fsync is refused outright** ("fsync API is disabled when Permission Model is enabled"): the engine's atomic writes
  fsync, so durable-writing engine code cannot run under enforcement (`m0-gate-remediation`).
- **Symlink creation needs full permissions** ("fs.symlink API requires full fs.read and fs.write permissions"):
  link-handling tests cannot run under it (`admit-run`).
- **A warning breaks a stderr check**: node writes a SecurityWarning for `--allow-child-process` into a child's stderr,
  which `ledger-review-remediation` asserts is empty.
- **Unexplained, intermittent**: `telemetry-report` and `telemetry-run-time` were denied files inside a folder their
  manifest grants (`scripts\lib\argv.mjs`, `scripts\lib\node-depth.mjs`); `telemetry-report` passes run alone.

What the probes established on the way:
- Permission flags reach a spawned child only from the command line (node passes them on); a config file's grants did
  not reach the child, and `--experimental-config-file` is refused in NODE_OPTIONS.
- A grant covers everything beneath it (granting `scripts/` allowed `scripts/lib/argv.mjs`), so per-file precision needs
  per-file grants, which do not fit: the largest test reads 1,378 files, past Windows' 32,767-character command line.
- `node --test` reads the repository root to find its file, so the root must be granted, which grants everything; the
  test file run directly needs no root grant.
- Grants compare case-sensitively on Windows: a lowercased recorded `claude.md` denied `CLAUDE.md` (a harness bug, fixed).

Timing noise, same candidate 4 run on the same commit: 112.9 s, 68.4 s, 58.6 s.

## Candidate 6 (Wireit 0.15.0, local to .sandbox/tools, commit 288b2bce)

One Wireit script per test file, its `files` declared from candidate 4's recorded reads inside the repository; the
package.json exists only in the sandbox. Check of the reader: first run 20 executed (59.2 s), an unchanged second run 0
executed (1.7 s).

| Candidate | Misses | Over-selected | Negative control |
|---|---|---|---|
| 6: Wireit, declared inputs | 0 | 7 (C1: 2, C3: 1, C4: 2, C6: 2) | none selected |

The declarations are the recording's, so the misses measure Wireit's change detection, not completeness. Its over-
selection is 2 more than candidates 1 and 4 on the same files; not traced. Adds: wireit (Apache-2.0, 30 packages) and a
package.json declaring every test's inputs, which must be kept current: the recorders produce exactly that list.

## Candidate 7 (moon 2.6.4, local to .sandbox/tools, commit 28f2f8a8)

One task per test file, its `inputs` declared from candidate 4's recorded reads; `moon query affected` reads git's local
changes and answers in JSON without running anything (0.5 s a query). Check of the reader: nothing changed, 0 affected.

| Candidate | Misses | Over-selected | Negative control |
|---|---|---|---|
| 7: moon, declared inputs | 0 | 7 (C1: 2, C3: 1, C4: 2, C6: 2) | none selected |

Identical to Wireit's selection on the same declarations, so the 7 over-selections are the declared sets' (the re-recorded
candidate 4 sets, load and read together), not either tool's. Adds: @moonrepo/cli (MIT, a native binary), a
`.moon/workspace.yml` and a `moon.yml` declaring every test's inputs.

## Candidate 10 (tup v0.8-38, local to .sandbox/tools, commit aeb24bfc): blocked by its model

One rule per test (`: |> node --test <file> |>`), nothing declared: tup observes reads through an injected DLL. The
probe worked (an undeclared imported module's edit re-ran its rule; an unchanged tree ran nothing; avp did not react).
On the sample, **10 of 20 tests fail under tup**: "File '<TEMP>/q-m0g-.../outside/secret.md' was written to, but is
not in .tup/db. You probably should specify it as an output". tup requires every file a command writes to be a declared
output, and these tests create randomly named fixture repositories in the temp folder; its manual documents no
exemption for temporary files (`updater.full_deps` tracks reads outside the tree, not writes). The selection numbers of
that run are not counted: failing commands print in a form the reader did not parse (an unchanged update took 73.8 s
and showed 0 executed). Not usable on this suite without rewriting every test that writes a temp fixture.

### Candidate 10 re-measured after the fixes (commit fdd73ccb): usable

Two fixes, then a valid run. Each rule excludes the temp folder (`^dev-temp`: tup's documented exclusion, "files that are
read or written to ... that matches these patterns are ignored"), since temp fixtures are outputs, never dependencies;
and the last failure, writes to the operator's `~/.claude.json`, turned out to be five tests starting the real Claude CLI
(ui-audit on opus, ~$0.21 a call, every suite run), fixed on deploy-test (aba5dc48, 7c479dbf). Reader check passed:
first update 20 executed, 0 failed; unchanged, 0 executed.

| Candidate | Misses | Over-selected | Negative control |
|---|---|---|---|
| 10: tup, observed reads, `^dev-temp` excluded | 0 | 5 (C1: 2, C3: 1, C4: 1, C6: 1) | none selected |

The same selection as candidates 1 and 4, with nothing declared. Adds: tup (a 3.1 MB zip; on Windows it injects a DLL
into each command; avp did not react), a Tupfile with one rule per test, and the exclusion. The whole sample took 6.1 s
on this run against 59-68 s before the fix: most of that time was the real model calls, so every timing taken before
fdd73ccb includes them and is not a baseline.

## Candidate 8 (Bazel 9.3.1 via bazelisk 1.28.1, local to .sandbox/tools; commit 0c3dc127), and 6 and 7 re-run

One `filegroup` per test, its srcs the recorded reads inside the repository, and `bazel query 'rdeps(//:all, set(<file>))'`
for the selection: no tests run, no bazel-diff, so no Java. BAZELISK_HOME and `--output_user_root` under
.sandbox/tools/bazel, the server shut down after each run; the operator's profile has no `_bazel_<user>`. On Windows Bazel
has no sandbox, so nothing enforced the declarations.

The first run's declarations held 2,802 paths outside the repository (node's own files under `C:\Program Files`, which
path.relative returns as absolute across drives and a `..` filter let through); Bazel refused them as invalid labels.
Filtered for all three declaring tools and re-run:

| Candidate | Misses | Over-selected | Negative control |
|---|---|---|---|
| 8: Bazel query, declared targets | 0 | 5 (C1: 2, C3: 1, C4: 1, C6: 1) | none selected |
| 7: moon, declared inputs (re-run) | 0 | 7 (C1: 2, C3: 1, C4: 2, C6: 2) | none selected |
| 6: Wireit, declared inputs (re-run) | 0 | 7 (the same) | none selected |

Bazel's "no such target" for C5 and C8 is its answer for a file no target declares. Same declarations, two more
over-selections in moon and Wireit: inferred, not checked, that the recorded reads include folder listings (`readdir`),
which moon and Wireit read as every file in the folder and Bazel cannot hold as a file target. Adds: Bazel (bazelisk via
npm, Apache-2.0; Bazel itself downloaded on first use), MODULE.bazel, a BUILD file declaring every test's inputs.

## Candidate 9 (BuildXL 0.1.0-20261023.5, the published package; commit 8308db3b)

Not built from source: BuildXL's own bootstrap (`bxl.cmd -minimal`) downloads `Microsoft.BuildXL.win-x64` from a public
Azure DevOps feed without credentials, and its `bxl.exe` is what was measured (the self-build then failed on a macOS
package the feed no longer has, which the measurement does not need). That bootstrap also installed Microsoft's Azure
Artifacts Credential Provider into the operator's `~\.nuget\plugins`; removed with the operator's approval ("A").

One pip per test declaring only its test file, `allowUndeclaredSourceReads` (reads observed into the fingerprint), the
temp folder, profile, system folders and the repository's `.git` untracked (a test's `git check-ignore` took
`.git\index.lock`, which BuildXL refused as an undeclared write); `/server-`. The re-run pips are read from
`DX0235 ... Cache miss` in Out/Logs/BuildXL.log.

| Candidate | Misses | Over-selected | Negative control |
|---|---|---|---|
| 9: BuildXL, observed reads | 0 | 5 (C1: 2, C3: 1, C4: 1, C6: 1) | none selected |

Reader check: first build 20 executed, 0 failed (8.2 s). The first unchanged rebuild still re-ran 1 pip (19 hits), not
identified (the log is rewritten each build); every later build was stable (C5 and C8 selected nothing), so the cache
settled after one extra build. Adds: BuildXL (a .NET distribution, MIT; downloaded, not installed), three DScript files.

## Cost: paired, interleaved runs (commit 97b82a0e, 2026-10-27, 16:51-17:08 local)

`measure-overhead.mjs`: 16 pairs per candidate after one untimed warm-up pair, each pair a plain `node --test` of the
20-test sample and a run through the candidate, the order alternating (plain first in even pairs). Before each pair every
sample test file gets a unique trailing comment, so a caching tool must run all 20 (checked: 20 run in every timed run,
and 0 in every unchanged re-run). One node for every arm (24.22.1 portable), TEMP on a dedicated folder outside the system temp. Every run passed.
moon and Bazel run no tests: their figure is the query alone (all 20 test files changed), unpaired.

| Candidate | Plain, median | Candidate, median | Added, median | Added, mean (95% CI) | Ratio | Nothing changed |
|---|---|---|---|---|---|---|
| 1: preload, loads + fs reads | 3.92 s | 5.12 s | +1.21 s | +1.17 s (1.02..1.32) | 1.31 | n/a |
| 4: Permission Model audit | 3.99 s | 4.16 s | +0.10 s | +0.19 s (0.05..0.33) | 1.04 | n/a |
| 6: Wireit | 3.99 s | 4.75 s | +0.76 s | +0.87 s (0.45..1.29) | 1.19 | 0.51 s |
| 10: tup | 3.90 s | 4.50 s | +0.69 s | +0.65 s (0.55..0.76) | 1.16 | 0.24 s |
| 9: BuildXL | 3.91 s | 7.22 s | +3.30 s | +3.44 s (3.17..3.70) | 1.85 | 2.34 s |
| 7: moon, query only | | 0.39 s | | 0.42 s mean (0.39..0.44) | | |
| 8: Bazel, query only | | 0.86 s | | 0.94 s mean (0.85..1.04) | | |

Candidate 5 (manifest enforced by the Permission Model) also has 0 misses and is not timed (operator, 2026-10-27: "A"):
5 of the 20 sample tests fail under its enforcement (fsync and symlinks refused), so its run is not like-for-like with a
plain run, and it over-selects 56 against 5.

Bazel's warm-up query took 29.0 s (the server's first start in a fresh clone); the 16 timed queries ran on a warm server.
moon and Bazel select from declarations a recorder wrote, so a run using them also pays candidate 4's recording.

Load. The sampler's rows were joined to each run afterwards (`load-join.mjs`; the harness had read the file at its start
and joined none). avp during the timed runs: mean 0.2-0.6% per candidate, highest single reading 3.8% (pair 15 of
candidate 1 and of tup, both arms of the pair alike). The one spike logged in the window, 9.4% at 16:50:06, fell before the
first timed run, while git cloned the sandbox. No adjustment was made: avp stayed below the 5% spike threshold, the pairing
puts a drift on both arms, and the sampler's total CPU includes the measured runs' own work, so it cannot serve as an
outside-load covariate (its correlation with run time ranged from -0.28 to 0.68 across arms, with no consistent sign).

## Option A on the whole suite: 458 test files, 15 changes (2026-10-27 to 10-28, node 24.22.1)

Harness `measure-full.mjs`; changes `changes-full.json` (C1-C8 as in the sample, F1-F7 added: a few files, a few scripts,
the module most tests name, the platform layer, the main script, the contract file, a second negative control). Each change
gets a GROUND TRUTH (the whole suite with the change's files broken: a leading throw in `.mjs`, invalid `.json`, `.md`
replaced), a SELECTION from candidate 4's recording, and a TIMED SELECTED RUN after a harmless edit. Three plain full runs
(start, middle, end) are the baseline. Every run gets run-all.mjs's isolation and stops if the Claude config folder is
written. Raw results are gitignored, under `.sandbox/ts-results/`.

**First run (commit 46b99daa, resumed at dff680e9): 7 misses, from two harness faults.**
- The suite was passed as a glob (`tests/**/*.test.mjs`). Given a glob, node --test's processes raised no audit event for a
  read under `tests/`, so a recording lost every test's own imports and fixtures: 274 of the 278 tests that import
  `tests/helpers.mjs` had no record of it. `probe-recorder.mjs` (commit 6a1df977) shows it on one test: named, the
  recording holds `tests/helpers.mjs` and both telemetry fixtures; through a `**` glob it holds neither. The reporter and
  the record folder's place made no difference. C7 was missed for this.
- A test that copies `scripts/` whole (`fs.cpSync`, the bench fixture) is recorded as reading the folder `scripts`, and the
  selection compared exact paths: 2 tests missed in each of C2, C6 and F1.
- C2's selected run took 1,189 s against a 905 s full run; the second run's 774 s for nearly the same selection did not
  repeat it, and no cause was found.

**Second run (commit 7b047978): every file named, and a recorded folder covers the files under it. 0 misses.**
Baselines 876, 867 and 856 s (mean 867 s), 0 of 458 failing. Recording run 1,063 s (+23% on a plain run; the sample
measured +4%, not yet reconciled). "Sum" is each file's own duration added up: files run up to 31 at once, so it exceeds
the wall clock.

| Change | Affected | Selected (exact path) | Missed | Over-selected | Wall, baseline | Wall, selected | Wall change | Sum, baseline | Sum, selected | Sum change |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 imported directly | 5 | 40 (31) | 0 | 35 | 867 s | 241 s | −72% | 1,716 s | 822 s | −52% |
| C2 imported two levels down | 164 | 189 (183) | 0 | 25 | 867 s | 774 s | −11% | 9,692 s | 9,446 s | −3% |
| C3 a script tests spawn | 21 | 60 (55) | 0 | 39 | 867 s | 249 s | −71% | 1,844 s | 1,023 s | −45% |
| C4 imported by a spawned script | 26 | 60 (50) | 0 | 34 | 867 s | 246 s | −72% | 1,878 s | 1,009 s | −46% |
| C5 a template a script reads | 5 | 28 (16) | 0 | 23 | 867 s | 301 s | −65% | 3,086 s | 1,585 s | −49% |
| C6 engine data read with fs | 93 | 169 (153) | 0 | 76 | 867 s | 767 s | −11% | 9,585 s | 9,237 s | −4% |
| C7 a test's own input | 1 | 9 (4) | 0 | 8 | 867 s | 83 s | −90% | 808 s | 208 s | −74% |
| C8 negative control | 0 | 6 (6) | 0 | 6 | 867 s | 84 s | −90% | 680 s | 174 s | −74% |
| F1 a few files at once | 149 | 180 (170) | 0 | 31 | 867 s | 805 s | −7% | 9,670 s | 10,063 s | +4% |
| F2 a few scripts at once | 18 | 58 (53) | 0 | 40 | 867 s | 387 s | −55% | 3,103 s | 1,878 s | −39% |
| F3 the module most tests name | 371 | 374 (374) | 0 | 3 | 867 s | 884 s | +2% | 12,051 s | 12,591 s | +4% |
| F4 the platform layer | 353 | 356 (356) | 0 | 3 | 867 s | 867 s | 0% | 12,143 s | 12,045 s | −1% |
| F5 the main script | 23 | 143 (138) | 0 | 120 | 867 s | 369 s | −57% | 4,935 s | 3,737 s | −24% |
| F6 the contract file | 58 | 74 (74) | 0 | 16 | 867 s | 293 s | −66% | 3,348 s | 2,375 s | −29% |
| F7 negative control | 0 | 6 (6) | 0 | 6 | 867 s | 79 s | −91% | 680 s | 165 s | −76% |

Selected runs averaged 428 s against 867 s, 51% less over these 15 hand-picked changes (an illustration, not an expected
saving). A change few tests reach saves 55-91%; one that half the suite or more depends on saves almost nothing (F3 and F4
are ties with the full suite within run-to-run variation). A selection holding `remediate-runner` or `reviewer-preflight`
cannot finish before them. A file's time depends on what runs beside it: a small selection runs each file faster than the
full suite does.

**A second ground truth (`measure-whole.mjs`, commit 944a1754): each `.mjs` and `.json` file replaced whole.** The leading
throw fails a test that runs the file and leaves its text in place, so a test that checks the source counted as
over-selected. Replaced whole, 0 misses again, and over-selection falls from 465 to 363 pairs (of 1,752 selections): F5
from 120 to 32 (111 affected against 23), C3 39 to 33, F2 40 to 34, C6, F1 by one, the rest unchanged; the `.md`-only
changes (C5, C8, F6, F7) were already replaced whole and not re-run. Every newly affected test was already selected. Two
breaks passing is still a lower bound on dependence.

**What the remaining 363 are** (119 distinct tests; classified by script from recordings and test sources, samples read):
125 start a script that reads the file as data, some tolerantly (`scripts/io/telemetry-record.mjs` reads the roster with a
`{}` fallback); 108 walk a folder and read every file's text; 77 reach it only through a recorded folder (52 list it with
`readdirSync`, 16 copy it with `fs.cpSync`); 29 copy a tree; 6 copy the file and read the copy; 18 other. Telling a module
load from a data read would remove almost none of them. The one safe cut: record the files `fs.cp`/`fs.cpSync` copy, and
apply the folder rule only to an added or removed file, for up to the 52 listing pairs. Operator, 2026-10-28: accept the 363
and carry that refinement into option A's plan ("as suggested").

**Load.** avp averaged 0.3-1.1% in every timed run; the highest single reading in a timed run was 16.5% (one 2 s sample,
F1's first-run selected run, Task Manager the busiest process). No adjustment was made.

## Item 0 of the plan: today's suite re-timed (2026-11-06, commit d02fdbbc, node 24.22.1)

`test-selection-by-recorded-reads.plan.md` item 0, run by `measure-full.mjs --truth-from full-v2.json` (raw `.sandbox/ts-results/r0-20261106.json`) in a fresh sandbox
clone: three plain full runs, one recorded run, and the 15 changes selected from today's recording and timed. **This run
measures time only.** Each change's ground truth is reused from 2026-10-28, on a suite that has since grown from 458 test
files to 622, so its "0 misses" means only that no test affected THEN is left out NOW; whether today's suite has misses is
item 7's check.

Baselines 346, 341 and 344 s (mean 343.5 s), 0 of 622 failing: the suite is 60% faster than on 2026-10-28 (867 s) with 36%
more files. One recorded full run took 350 s (+2.0% on the mean baseline, unpaired; the paired runs below are the figure).

| Change | Selected (exact path) | Selected on 10-28 | Wall, selected | Wall change | Sum, selected | Sum change | Slowest file in the run |
|---|---|---|---|---|---|---|---|
| C1 imported directly | 68 (49) | 40 | 221 s | −36% | 771 s | −73% | reviewer-preflight 219 s |
| C2 imported two levels down | 275 (261) | 189 | 331 s | −4% | 2,466 s | −14% | remediate-runner 310 s |
| C3 a script tests spawn | 92 (79) | 60 | 222 s | −35% | 697 s | −76% | reviewer-preflight 219 s |
| C4 imported by a spawned script | 90 (70) | 60 | 220 s | −36% | 662 s | −77% | reviewer-preflight 217 s |
| C5 a template a script reads | 33 (21) | 28 | 218 s | −37% | 657 s | −77% | reviewer-preflight 217 s |
| C6 engine data read with fs | 226 (196) | 169 | 328 s | −4% | 2,438 s | −15% | remediate-runner 309 s |
| C7 a test's own input | 10 (4) | 9 | 89 s | −74% | 174 s | −94% | worktree-framework-runnable 89 s |
| C8 negative control: no test uses it | 7 (7) | 6 | 88 s | −74% | 170 s | −94% | worktree-framework-runnable 88 s |
| F1 a few files at once | 254 (237) | 180 | 329 s | −4% | 2,452 s | −15% | remediate-runner 308 s |
| F2 a few scripts at once | 97 (84) | 58 | 283 s | −18% | 1,099 s | −62% | remediate-runner 280 s |
| F3 the module most test files name | 490 (489) | 374 | 346 s | +1% | 2,801 s | −3% | remediate-runner 317 s |
| F4 the platform layer every io module loads | 469 (468) | 356 | 339 s | −1% | 2,813 s | −2% | remediate-runner 308 s |
| F5 the main script | 174 (162) | 143 | 229 s | −33% | 1,134 s | −61% | reviewer-preflight 222 s |
| F6 the contract file | 90 (90) | 74 | 222 s | −35% | 864 s | −70% | reviewer-preflight 218 s |
| F7 negative control: the harness's own notes | 7 (7) | 6 | 87 s | −75% | 169 s | −94% | worktree-framework-runnable 87 s |

Wall change is against the mean baseline, 343.5 s; Sum change against the baselines' mean summed file time, 2,875 s.
Selected runs averaged 237 s against 343.5 s, **31% less** over these 15 changes (51% on 10-28, an illustration either way,
not an expected saving).

**Each selected run takes about as long as its slowest file.** In every one of the 15 runs, the wall clock is within 11% of
its single slowest file. `remediate-runner` alone takes 315 s of the full run's 344 s, and `reviewer-preflight` 238 s. A
selection holding the first finishes in 280-346 s, one holding the second (but not the first) in 218-229 s, and one holding
neither in 87-89 s. The summed file time falls much further (−73% to −94% for a narrow change) than the wall clock does,
because the suite now runs its files in parallel well enough that the long pole, not the total work, sets the time.

**The floor is 87 s.** Even the two negative controls select 7 files, the two slowest of them
(`worktree-framework-runnable`, 88 s; `staged-run-is-reachable`, 71 s), each recorded reading the changed file by its exact path.

**Load.** avp averaged 1.0-1.8% in the baselines and the recorded run, 0.5-1.1% in the selected runs; the highest single
reading in any run was 5.6% (the first baseline). Total CPU averaged 28-32% in full runs. No adjustment was made.

**The recording's cost, paired** (`measure-full-overhead.mjs`, raw `.sandbox/ts-results/ovh-20261106.json`, commit a31ad67e, 21:31-22:42 local): six pairs of full runs,
plain against recorded, alternating which runs first, every file named, 0 failing in all twelve. Plain 340.6-349.4 s,
recorded 355.1-368.7 s. The recording adds **15.0 s per full run, 95% interval 10.8-19.3 s (+4.4%, 3.1-5.6%)**, the figure
the 20-test sample gave (+4%). The +23% of 10-28 does not repeat on today's suite and was not reconciled. avp averaged
1.0-1.9% in every run, highest reading 6.3%.

**The selection's own cost**, five times on the first recording's map: the map names 32,191 files inside the repository
(31,197 still present to hash). Hashing them took 1.7 s (6.2 s on the first, cold pass), and selecting for all 15 changes
1.4-1.5 s, about 0.1 s a change.

## After split-slow-test-files (2026-11-07, commit 130bde8b, node 24.22.1)

`split-slow-test-files.md`: the twelve files over 60 s split into 40 files (645 test files in all), every test block moved
byte for byte. **The same 4020 test names, before and after** (`measure-names.mjs --compare`: lost 0, added 0; raw
`.sandbox/ts-results/names-before.json` at e8076d2e and `.sandbox/ts-results/names-after.json` at 130bde8b).
`run-all.mjs` passed three times in a row in the working tree (189-193 s).

Runs now name their files through `run-named.mjs` (node:test's `run()`, the list in a file): 656 named files from the
sandbox's paths came to 32,991 characters, past Windows' 32,767. The pre-split tree under the new launcher (scratch commit
586e0682, d02fdbbc's tree with this harness; raw `.sandbox/ts-results/names-before-launcher.json`) took 339 s, against 343.5 s through the CLI, so the launcher does not explain
the change below.

Same `measure-full.mjs --truth-from full-v2.json` run as item 0 (raw `.sandbox/ts-results/split-20261106.json`). **Baselines 183, 191 and 185 s (mean 186.6 s), 46% less
than item 0's 343.5 s.** Recorded run 203 s. Summed file time rose from 2,875 to 3,807 s, and total CPU in a full run from
28% to 58-60%: the files now share the machine, and each runs slower beside the others.

| Change | Selected (exact path) | Selected at item 0 | Wall, selected | Wall change | Sum, selected | Sum change | Slowest file in the run |
|---|---|---|---|---|---|---|---|
| C1 imported directly | 69 (50) | 68 | 55 s | −70% | 595 s | −84% | reviewer-preflight-checks 54 s |
| C2 imported two levels down | 297 (283) | 275 | 150 s | −19% | 3,397 s | −11% | remediate-runner-full-check 113 s |
| C3 a script tests spawn | 93 (80) | 92 | 52 s | −72% | 421 s | −89% | reviewer-preflight-checks 50 s |
| C4 imported by a spawned script | 91 (71) | 90 | 53 s | −71% | 447 s | −88% | reviewer-preflight-checks 51 s |
| C5 a template a script reads | 40 (26) | 33 | 101 s | −46% | 669 s | −82% | reviewer-preflight-overrun 101 s |
| C6 engine data read with fs | 248 (218) | 226 | 148 s | −21% | 3,235 s | −15% | remediate-runner-full-check 107 s |
| C7 a test's own input | 11 (4) | 10 | 39 s | −79% | 112 s | −97% | staged-run-is-reachable 39 s |
| C8 negative control: no test uses it | 8 (8) | 7 | 41 s | −78% | 124 s | −97% | staged-run-is-reachable 41 s |
| F1 a few files at once | 276 (259) | 254 | 149 s | −20% | 3,251 s | −15% | remediate-runner-full-check 104 s |
| F2 a few scripts at once | 99 (86) | 97 | 54 s | −71% | 577 s | −85% | reviewer-preflight-checks 51 s |
| F3 the module most test files name | 513 (512) | 490 | 189 s | +1% | 3,790 s | 0% | remediate-runner-repo-lock 113 s |
| F4 the platform layer every io module loads | 492 (491) | 469 | 183 s | −2% | 3,747 s | −2% | remediate-runner-full-check 108 s |
| F5 the main script | 178 (166) | 174 | 67 s | −64% | 1,028 s | −73% | reviewer-preflight-checks 57 s |
| F6 the contract file | 95 (95) | 90 | 61 s | −67% | 712 s | −81% | capture-containment-hang 61 s |
| F7 negative control: the harness's own notes | 8 (8) | 7 | 39 s | −79% | 109 s | −97% | staged-run-is-reachable 39 s |

Wall change is against this run's mean baseline, 186.6 s; Sum change against its mean summed file time, 3,807 s.
Selected runs averaged 92 s against 186.6 s, **51% less** (31% at item 0). The floor is 39 s, from 87 s.

**Three misses reported, none real.** C2, F1 and F2 report `regression-worktree-framework-runnable.test.mjs` missed: the
ground truth of 2026-10-28 names the file, which now holds only its self-layout test. Re-run under each change's breaking
mutation (`<TEMP>/split/gt-self.mjs`, in the sandbox): the self-layout test passes in all three, and the test that fails
is the consumer-layout test, now in `regression-worktree-framework-runnable-consumer.test.mjs`, which every one of the three
selects.

**Criterion 1 as first written, in a full run, is not met; as amended, run alone, it is met with three named exceptions.**
The request's criterion 1 first read "at most 60 s in the first full baseline after the change". Amended (operator,
2026-11-07: "Revert 2nd split, amend, close (Recommended)") to "at most 60 s run alone", its only allowed exception being a
single test that alone takes more than 60 s, named with its duration (operator: "Reword: one kind, three named
(Recommended)"). Alone, every new file runs in at most 56 s except three files that each hold one such test:
`reviewer-preflight-overrun` (100 s), `worktree-framework-runnable`'s self layout (75 s) and `capture-containment-hang`
(60.2 s, its own one-minute bound). In this full run 20 files took more than 60 s (61-108 s), the three slowest being
`remediate-runner-repo-lock`, `-full-check` and `-evidence-and-tree` at 107-108 s; each took 49-50 s run alone (beside the other split files, each in its own process).

**Load.** avp averaged 1.9-2.9% in the full runs, highest reading 6.1% (the recorded run); 5.0% at most in a selected run.

**A second split, then reverted** (operator, 2026-11-07: "Split the 20 further", then "Revert 2nd split, amend, close
(Recommended)"). The 16 files over 60 s that hold more than one test were split again into parts of about 20 s alone, 670
test files in all (915e409b). The same `measure-full.mjs` run (raw `.sandbox/ts-results/split2-20261107.json`, names
`.sandbox/ts-results/names-after2.json`): baselines 199, 201 and 205 s (mean 201.7 s, +8% on the first
split's 186.6 s), 12 files still over 60 s, the same 4020 test names. It is reverted (93730c3f). Its six reported misses are
the naming artifact again (C2, F1, F2 on `worktree-framework-runnable`; C3, F2, F5 on `staged-run-is-reachable`): re-run
under each change's mutation, every failing test is in a file the change selects (`<TEMP>/split/gt-staged.mjs`).

**One idle tail found and fixed** (8155af8e): `regression-spawn-capture` raced its child's exit against a 60 s timer and
never cleared it, so its process stayed open 60 s after its last test (61 s alone, 1 s with the timer cleared). Every other
file over 30 s in a full run was checked alone: wall time and its tests' summed time agree within 0.3 s.

**The final tree** (93730c3f; three plain runs through `measure-names.mjs`, raw `.sandbox/ts-results/names-final-1.json` to
`-3.json`): 188, 188 and 194 s (mean 190.0 s), 0 failing
of 645 files, the same 4020 test names in each. **45% less than item 0's 343.5 s.** The timer fix did not shorten the run:
the file was not the one the run waited for. avp averaged 2.0-2.3% (highest reading 6.1%), total CPU 57-60%.
