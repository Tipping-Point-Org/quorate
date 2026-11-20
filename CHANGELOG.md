# Changelog

Notable changes to quorate. Newest first.

**0.3.0 is the first tagged release** (tagged when it is published, M2 stage 9d). Runs stamp the version in `VERSION` —
`0.1.0` from the beginning, `0.2.0` since `c21cf5d`, `0.3.0` since this release — and the history below is organised
by the dates work actually landed on `master`. A section names what a consumer moving their submodule pointer to it
would be taking on.

Two conventions worth knowing before reading:

- **Every entry says what was WRONG, not what was added.** A framework whose subject is verification
  is not improved by a feature list — what a reader needs is the defect class, because that is what
  tells them whether their own pinned version has it.
- **`⚠ BEHAVIOUR`** marks a change that alters what an existing consumer's runs do without any edit
  on their side. Those are the ones that cost a wrong conclusion if unread. Updating the submodule
  pointer is not the same as upgrading an install: it refreshes the engine and hook logic, and does
  **not** touch the `graph_contract` block copied into a consuming project's own `CLAUDE.md`, whose
  meaning can change underneath it.

---

## 0.3.1

### What a consumer coming from 0.3.0 must change

Nothing. No contract key, flag or default changed; `graph_contract_version` is still 6.

### What was wrong, and what changed

- **`QUORATE.md`'s validate step refused on a fresh install.** `new-run --dry-run` derives its scope from the last
  commit and the untracked files, and a newly mounted project usually has no source file there, so the step meant to
  say "you are set up" exited 2. The step is now `new-run --dry-run --full-sweep <your source dir>`, and the page says
  that the plain form's refusal is the scope rule working, not a broken install. Found by installing 0.3.0 from the
  public repository into a throwaway project, following `QUORATE.md` alone.
- **Nothing showed a newcomer what a run produces.** `examples/` now holds two real runs, curated: a review that
  failed (gate FAIL, a HIGH confirmed by four arms from another model family) and the separate run that fixed what it
  found, red before green. Machine paths and the operator's identity are replaced in the copies, and its README says
  what was left out.
- **The install was checked only on the developer's machine.** CI now has an `install` job, on a push to the public
  repository's `master`: it clones the repository from its public URL without credentials, mounts it in a throwaway
  project at the pushed commit, follows `QUORATE.md`'s setup with an empty home directory and an allow-listed
  environment, and requires `check-install` to pass (`tests/tools/install-from-repo.mjs`).
- **`gen-rule-text --check` could pass over a file it could not read.** A git-listed file was skipped when an
  existence check said it was absent, and that check also says "absent" for a file that exists but cannot be read. Now
  only a file that is really gone (ENOENT) is skipped, and any other read error fails the check.
- **The public `CLAUDE.md` described a build log the public tree does not have.** The build log stays private; the
  layout row says so.

## 0.3.0

### What a consumer coming from 0.2.0 must change

Checked against the contract template and `scripts/lib/contract-version.mjs` at this release, not recalled. The entries
below this one are the record of each change; this list is what to do about them.

- **`graph_contract_version` is 6** (it was 3 in 0.2.0). A block that still says 3 runs, stamped `CONTRACT-STALE` and
  capped, and the run names every key whose meaning changed since: **4**, a declared check is re-run only when the files
  it reads changed (`review.preflight_inputs` says which; `run-graph --preflight always` restores the old cadence);
  **5**, every contract glob is read by one grammar and matched exactly, and a form outside it (`?`, `[...]`, braces) is
  refused at mint; **6**, with `review.external_panel: true` every reviewer is probed before its first use and a failed
  one refuses the run. Read those three, then set the number to 6. `shared/claude-md-contract.md` owns what each means.
- **Nineteen keys were added, none removed.** Every one is optional and its absent value is the documented default
  (`shared/claude-md-contract.md`): `commands.test_one`; `code_index`; `hooks.secret_scan`; and under `review`,
  `candidate_env`, `check_timeout_minutes`, `claim_check_transcript`, `code_index_cache_max_mb`,
  `code_index_timeout_minutes`, `decision_panel`, `decision_rounds`, `decision_rounds_max`, `grounding_floor`,
  `panel_snapshot_max_mb`, `preflight_cache_max_mb`, `preflight_inputs`, `reviewer_probe_max_age_hours`,
  `run_spend_max`, `run_time_limit_hours`, `session_record_retention_days`. Two more, `review.capture_preview_lines` and
  `review.capture_max_mb`, apply only to the new interactive capture below.
- **One absent default can stop a push:** `hooks.secret_scan` absent means `required`, so if you installed quorate's git
  hooks, a push is refused while gitleaks is not installed. Install gitleaks, or declare `secret_scan: off` deliberately.
- **`--claude-bin` is removed**: pass `--runtime-bin <path>` (the entry just below).
- **New, optional, nothing to change if unused:** the stop guard, the long-run start hook and the command log, declared
  in your `.claude/settings.json` (QUORATE.md, setup step 5); `capture.mjs --interactive`, a session's command string run
  with no shell (`shared/claude-md-contract.md`, its row); vendored third-party code in `third_party/` (unbash, ISC,
  named in `NOTICE`).
- **Node 22, 24 or 26** (every maintained LTS line, QUORATE.md).

### ⚠ BEHAVIOUR — `--claude-bin` is removed; use `--runtime-bin`

The node runtime's binary override was renamed `--runtime-bin` on 2026-11-11, with `--claude-bin` kept for one release as
a warning alias, because a vendor's name in a generic seam is the defect ARCHITECTURE A-9 names. That release is this
one: every script that took `--claude-bin` now refuses it, naming `--runtime-bin`, before doing any work. **What a
consumer must change:** any script, test or hook passing `--claude-bin <path>` passes `--runtime-bin <path>` instead.

### ⚠ BEHAVIOUR — one owner stops a child; Ctrl+C waits up to 5 s; a 4 GiB file-size ceiling on POSIX

**What was wrong.** How a child is stopped, and what is said about it, was answered separately in four places — the node
runner, the panel's captured children, the interrupt handler and the end-of-run reaper — and four reviews running found
the same defect in a different one each time. A kill's return was read as a death: on Ctrl+C a child that ignored SIGTERM
outlived the run with nothing recording it. An uncaught failure in the orchestrator stopped no child at all. On POSIX the
interrupt never reached a node's model child, which sits in a process group of its own, so it kept running, uncapped. The
reaper killed and asked "alive?" in the same breath, and on Linux reported every child it had just killed as a survivor
(5 times in 5) — the gate then said "refused to be killed, stop it by hand" about a process that was already gone. And a
kill accepted but not seen to take effect was worded "the kill was refused".

**Now.**
- **One owner**, `scripts/io/stop-child.mjs`. A stop ends as `exited` (the exit seen), `refused` or `unconfirmed`, and the
  last two are said as themselves: `orphan_pid` with `kill_refused` or `kill_unconfirmed` in the node's status, and a line
  in the gate's Not-checked table if the process still answers when the run ends. A pid the run does not hold is watched,
  never killed. `tests/regression-stop-single-owner.test.mjs` refuses a second place that kills a child.
- **Ctrl+C can take up to 5 seconds.** On a signal or an uncaught failure the orchestrator stops every child at once and
  waits at most that long for their exits, then names each child it did not see exit; on any other exit it requests the
  kills and records each child as unconfirmed. It used to exit at once, which is how the survivors went unrecorded. A second Ctrl+C does not cut the wait short. A node runner
  passes the signal on to its own model child and finishes inside that window.
- **On Linux and macOS the model child runs under a 4 GiB file-size ceiling** (`ulimit -f`, through `sh`; arguments pass
  through `"$@"`, never interpolated). It bounds a runaway, not the node's output — the output cap is unchanged — and is
  what holds when the cap's kill is refused. A process that writes past it is stopped by the kernel. Each node's status
  records the ceiling that applied; Windows has none (`file_size_ceiling_bytes: null`), its job ending the child with its
  parent.
- **Not covered:** a synchronous child's own deadline (`capture`, `external-review` and the vendor CLI under it), and the
  ceiling does not apply to the external arms or the adjudicators.

### ⚠ BEHAVIOUR — one grammar for contract globs, matched exactly; the intent node reads a sandbox of copies

**What was wrong.** At least fourteen places read a contract glob, each by its own rules. One glob meant different
things for scope, for finding demotion, for the hashes, for the intent node's documents, and for `find-inert-features`,
which handed globs to git. The shipped template's own `**/*.test.*` matched nothing in the declared surface. Measured on
Windows: the intent node's Read rules granted nothing, so it never read `contract.snapshot.md`, while `--add-dir` on a
doc directory granted everything below it. And whether a run's evidence could be archived was decided by quorate's own
reading of the `.gitignore`, which missed a broad re-include such as `!*/`.

**Now.**
- **One grammar** (`scripts/lib/contract-glob.mjs`): `*`, `**` as a whole segment, and literal characters. A contract
  using `?`, `[...]`, braces, `..`, an absolute path or a leading `!` is **refused** when a run is minted, and at
  pre-flight, naming each entry and why. Write a brace list as separate entries. `--print-contract` still prints such a
  contract, for the git hooks.
- **Exact matching everywhere.** A glob that says more than its directory covers only what it says:
  `docs/**/README.md` no longer covers all of `docs/` for scope, demotion or `CONTRACT-PARTIAL`. A file that
  was covered only by such a prefix may now be demoted, or counted as uncovered.
- **The intent node reads a sandbox of copies**: for each doc glob, exactly the documents it matches, plus the run's
  `contract.snapshot.md`. No document is granted in place. `scripts/check-intent-grant.mjs` measures it (live).
- **The archive asks `git check-ignore`** whether a run's evidence would be ignored at the destination, and keeps it
  staged otherwise, recorded in the gate whether or not the external panel is on.
- **A glob key written as a single string** (`source_globs: "src/**"`) is refused at mint, naming the key; it used to
  pass the check and fail later. The worktree hash skips only the files a generated glob matches, so a narrow one no
  longer hides edits beside it. The pre-commit doc-sync reminder works again on a contract that declares
  `graph_contract_version`; since that key's introduction it had been reminding no one.
- **The archive's `git check-ignore` asked about one invented file name**, not the run's evidence, so a `.gitignore`
  ignoring only dotfiles under `evidence/` let real logs be archived where git would track them; it now asks about every
  evidence file. A doc glob over `.claude/reviews` could copy archived runs into the intent sandbox, because only the
  staging root was pruned; an unreadable directory under a doc glob aborted the snapshot instead of being recorded.
- **That evidence check answered "ignored" when it could not list the evidence**, so the archive could still move it;
  it now withholds. The intent sandbox's review-root prune was case-sensitive, so `.CLAUDE/**` escaped it on Windows,
  and a doc glob naming a single file inside a review run was copied unpruned; one function now decides those roots
  for every caller. A file the tree hash cannot read no longer drops out of it silently, so the gate cannot call such
  a tree unchanged (TREE-MOVED). The intent grant probe refuses to run inside a graph node.
- **The intent grant probe could agree without proving anything**: an original the node never tried to read counted as
  refused. Refused now means a recorded denial. A document link under a doc glob was copied by its own name even when
  the glob does not declare its target; it is refused and recorded. A directory the tree hash could not list, or a scope
  that vanished entirely, no longer reads as an unchanged tree. When doc globs are declared and nothing is copied, the
  intent canary says it read the contract snapshot instead. `run-graph`, `new-run` and `check-intent-grant` accept
  `--claude-bin` (a fake runtime for tests, as `spawn-node` always did); the probe refuses arguments it does not know.
- **A review whose scope was empty at mint never checked whether files appeared**, so they read as unchanged; that is
  TREE-MOVED now. The intent node is given the documents named under `doc_roles` as well as `doc_paths`: the intent
  cache was keyed on them while the node never saw one declared only as a role.
- **The external reviewers' snapshot failed whenever a file vanished while git indexed the tree** ("unable to index
  file", exit 128), and the error that said so was cut off behind git's line-ending warnings. It now retries from a
  fresh index, a bounded number of times, and reports git's own error lines. The suite's own trigger is gone: tests
  that made scratch directories at the repository root make them under the ignored `.sandbox/`.
- **A node child whose kill the OS refused was recorded as killed and reported as "spawn failed"**, losing its timeout
  or overflow. It is now reported as the timeout or overflow it was, with the refusal named, and the status and the
  gate say its output is no longer capped — nothing can stop a child that could not be killed.
- **`capture` called an output past its 64 MiB spawn buffer a failure to start**; it says the output overflowed.
- **A node killed for overflowing could be reported as a refused timeout kill**: the timeout stayed armed while the
  child was dying, and its second kill was refused. The first watchdog to fire now disarms the other.
- **That change left a kill the OS accepted with no deadline**: a child that survived it held the node, and the run,
  forever. Fifteen seconds after an accepted kill the node now finishes with the reason that asked for it, the child
  named as an unconfirmed survivor. `find-inert-features` searched every source file while counting only those that are
  not documents, so a name only documents mention was never reported inert where the two globs overlap.

### ⚠ BEHAVIOUR — evidence is not archived past a missing ignore rule; the doc-snapshot filter reverted

**What was wrong.** When the reviews directory's existing `.gitignore` lacked the evidence rule, archiving warned and
then copied the run's `evidence/` — captured output that may carry the operator's environment — onto git's tracked
side. And the doc-snapshot filter added in the previous entry copied nothing for a literal doc directory overlapping
source, and read `[!x]` as a positive class.

**Now.** With the evidence rule missing, the run is archived without `evidence/`, which stays staged outside the
repository; the gate's Not-checked table says where. The snapshot filter is reverted: an overlapping doc directory is
again snapshotted with every markdown file below it — wider than declared, and documented as such — until the
contract's glob grammar has one owner.

### ⚠ BEHAVIOUR — the doc-glob fixes, completed

**What was wrong.** The previous entry's fixes had gaps. A brace list with no `*` (`docs/{a,b}.md`) was taken as a
literal file and granted a document that does not exist; a `?` or `[` glob with no `*` the same. A backslash glob
(`C:\outside\*.md`, `\\host\share\*.md`) passed the outside-repository refusal. A doc glob with no directory before
its wildcard (`**/*.md`) was dropped from the intent node's grant in silence, while the doc said every glob was
granted. Where a doc directory overlapping source was snapshotted, every markdown file below it was copied, whatever
the glob said. And one sentence of the contract doc still called the node allow-list closed.

**Now.** Brace lists are refused however they are written; `?` and `[` globs are globs. Backslash globs are judged like
forward-slash ones. An empty-prefix doc glob is named by `new-run` and recorded in the run's not-checked list. The
snapshot copies only what the glob matches.

### ⚠ BEHAVIOUR — a doc glob is granted to the intent node as written; the node allow-list is documented as advisory

**What was wrong.** The intent node's read grant for a `doc_paths` glob was checked only on the text before the first
`*`, but built from the whole glob, so `docs/*/../../../x/*.md` granted a read outside the repository; the
outside-repository refusal judged the same prefix and missed it too. And every wildcard glob except a trailing `*.ext`
became a recursive grant on its directory, handing the implementation-blind node whatever lived below it. Separately,
the protocol and new-run said a node's command allow-list was closed; it is not.

**Now.** A contract glob with a `..` after a wildcard is refused. Every `doc_paths` glob is granted as written; a
brace list is refused, naming the entry — split it into one entry per alternative. The protocol (§8) says what was
measured: an unlisted command the runtime treats as read-only runs, an unlisted write is refused, a deny rule refuses
either way. Making the list bind is planned work.

### ⚠ BEHAVIOUR — JWT- and PAT-named variables no longer reach a review node

**What was wrong.** The name pattern that strips secret-looking variables from a Claude node's environment had no JWT
or PAT marker, so `GITHUB_PAT`, `CI_JOB_JWT` and the like crossed into every node and the project commands it runs.

**Now.** A name containing `JWT`, or `PAT` as a whole `_`-delimited token, is scrubbed. `PATH`, `PATHEXT`,
`PYTHONPATH` and other names that merely contain `PAT` still cross. A variable of yours so named that a node needs
will no longer reach it.

### ⚠ BEHAVIOUR — a required lens with no readable findings, or an unreadable adjudication, blocks the gate

**What was wrong.** The gate read each required lens's status file and never the list of nodes that did not report.
A required lens whose status said OK but whose `verdict.kept.json` was missing or refused was listed as silent, and the
gate still computed from the other verdicts, up to `PASS`. Separately, a reconcile `payload.json` that would not parse
set the adjudication floor to `PASS`, dropping every severity the reconciler had raised.

**Now.** Every entry in that list blocks when it is a required lens, or an aux node (reconcile, intent-capture,
second-opinion). A node the run does not require still does not block, as before: an unavailable external arm is
recorded, as `shared/external-reviewers.md` documents, and so is a lens the roster does not require in that run. A payload that is absent while reconcile reported OK, will not parse, or has no `groups` list counts as the
reconciler not reporting, so the gate reads `BLOCKED`. `shared/claude-md-contract.md` now states that a contract glob
or `doc_roles` value outside the repository is refused.

### ⚠ BEHAVIOUR — one definition of the secret shapes; a benchmark cannot score a run it refused

**What was wrong.** Redaction (`scripts/lib/redact.mjs`) and the push scan's rules (`.claude/hooks/gitleaks.toml`)
were two hand-kept pattern sets in two regex engines, with the credential words written five times. Each review
found the next shape one of them missed: keyword lists without `accesskey`, `access-key`, `privatekey` or
`private-key`, although the regexes accepted them, and an unquoted value holding `.`, `$` or `?` passed the push scan.
Separately, the benchmark reader recorded a refused run in a map no caller read, so a run with no `run.json` scored
as zero findings, and a node whose kept verdict was pruned scored as a node that found nothing.

**What changed.**
- `scripts/lib/secret-shapes.mjs` is the one definition. Redaction builds its patterns from it, and
  `node scripts/gen-gitleaks-config.mjs` writes the shipped gitleaks config from it; a test fails when the committed
  config is stale. Its `CASES` table is the scope of both guards, and every row runs through both. A shape the table
  does not list is a request for a row.
- **The push scan catches more.** Besides the keyword and `.`/`$`/`?` fixes, the shipped config gains one rule per
  token shape redaction already knew: gitleaks' defaults missed the table's `github_pat_`, `sk-` and bearer rows (a
  fine-grained token shorter than GitHub issues, an `sk-` key in no vendor's own format, a bearer token). A push whose
  history holds such a line is blocked until it is fingerprinted in `.gitleaksignore` or removed.
- A refused `run.json` throws `RunRefused`: `bench-lenses --score-only` exits non-zero, and a live seed is NOT RUN,
  never a miss. A node refusal — kept fewer findings than its status records, a status whose `node_id` differs from
  its file name, a malformed or link-escaped reconcile artifact — is written into the benchmark's result file as
  `refused`. Refusal reasons name files relative to the run directory.
- **Every benchmark result file is redacted whole where it is written** (review 20260929-124952-ssr-review): refusal
  reasons quote fragments of the files they refused, and `bench-second-opinion` wrote the judge's verbatim quote
  unredacted. A node whose kept findings DIFFER from its recorded count, in either direction, is refused; a
  `run.json` with no `run_id` is refused; a reconcile artifact whose `groups` is not a list is refused rather than
  read as empty; a `nodes/` or `evidence/` directory leading outside the run is refused unlisted. None of these
  refuses any of the 179 saved runs.
- **A refusal reason says what failed, never what the file or the disk said** (review 20260929-145942-ssr-review-r2):
  a filesystem error keeps only its code and a parse error only its position, since both messages carried absolute
  paths or the file's own text. A `nodes/` or `evidence/` that cannot be listed is refused instead of thrown, and one
  unreadable seed no longer aborts `bench-second-opinion`: it is NOT RUN, and the seeds after it still run.
- **`bench-second-opinion --dry-run` executes nothing** (review 20260929-162936-ssr-review-r3). It ran the preserved
  contract's `build` command to prove capture would accept the run; it now asks capture to run a command no
  contract declares and requires the allow-list's refusal, which capture reaches only after its pin and `--cwd`
  checks pass. A seed is counted only after the read that can refuse it.
- **One owner for "is this path there"** (review 20260929-171706-ssr-review-r4): the run reader no longer calls
  `existsSync`, which answers false for a permission error as well as for absence. Only a missing path is absent; an
  unreadable one, or a link that leads nowhere, is refused. And nothing in a `bench-second-opinion` seed's setup can
  throw before its `try`: a failure there is that seed's NOT RUN, keeping the refusals it had already collected.
- **One seed never ends a `bench-second-opinion` pass** (review 20260929-181033-ssr-review-r5). The serial loop catches
  whatever a seed throws, every cleanup step reports its failure instead of throwing or swallowing it, and a bad
  `QUORATE_HOME` is refused once at startup. A seed name that is not a single safe path segment is NOT RUN by name,
  and the forge reads a preserved anchor's file only inside the recreated tree.
- **Every seed record carries its refusals, and a dry run counts a seed ready only after its checks pass**
  (review 20260929-185355-ssr-review-r6): the dry-run and forge-only records had no `refused`, and the dry run
  recorded a seed as scoreable before its placement and capture checks, so a seed that failed them was counted twice.
- **Every refusal is printed at the end of a benchmark run** (review 20260929-195848-ssr-review-r7): both benchmarks'
  closing summaries now list each seed's refusals, a scored seed's included — they had reached only the result file
  and stderr, so a partly refused pass read as clean on stdout.

### A reviews `.gitignore` you edited is checked, and a contract glob stays in the repository

Closing the findings the platform review (`20260925-200721-platform-remediated`) left open, for M0's gate:
- **A reviews root's existing `.gitignore` is checked, not trusted.** It is still never rewritten, but `new-run`,
  `preflight` and the archive step now warn when it lacks `*/evidence/` or `.preflight-cache/`, since captured output
  there could otherwise be committed.
- **A contract glob whose root leaves the repository expands to nothing** (`../x/**`, or an absolute path).
- **A cached pre-flight failure restores its logs** into the run, as a cached success already did.
- `check-tiebreak` refuses to overwrite a prior record it cannot read, instead of treating it as a first run; the
  pre-flight checks come from one list; a scalar `env_prefixes` in a contract is reported instead of crashing.

### ⚠ BEHAVIOUR — a contract glob outside the repository is refused

`new-run` and `preflight` now refuse a contract whose `source_globs`, `test_globs`, `doc_paths`, `generated_globs`,
`review.preflight_inputs` or a `doc_roles` value names a path outside the repository (an absolute path, or `..` above the root), and say which
entries (review 20260929-225147-m0-gate-review). Such a glob was first walked and hashed as though it were the project,
then — after the fix above — silently left out of the input hashes, so an edit there kept a cached result looking fresh.
**What a consumer must do:** if you declared an input outside your repository, move it into the command that uses it.
- A reviews `.gitignore` that negates a rule later (`!*/evidence/`) no longer passes the check, and a gap is recorded in
  the run's `not_checked[]` as well as printed.
- The live tie-break probe now calls the judge as a real run does (`--participants`, `--surface`), names its arm from
  the roster, and counts a vote outside the positions as no ruling. A cached pre-flight result is reused only if the tree
  is clean now as well as at mint.

**What a consumer must do:** nothing, unless your own `.gitleaks.toml` governs your scan — then the shipped rules
are not in force, and `check-install` names them. If the push scan now blocks on a line in your history, read it
before fingerprinting it.

### ⚠ BEHAVIOUR — secret-shaped text is redacted in every tracked write, and the push scan catches quoted key-values

Review text reaches git in the findings ledger and in every committed run: `reconciled.md`, the reports,
`finding-groups.json`, the gate files, `intent.md` and the intent cache. All of it quotes what lenses and
vendors wrote. Redaction guarded only the ledger, and gitleaks' default rules missed the JSON
`"password": "…"` and spaced `db_password: "…"` shapes review text quotes. On 8.30.1 it found one of six
planted secrets. Now every tracked write goes through one best-effort redaction owner (`scripts/lib/redact.mjs`),
and the push scan and CI use a key-value rule the framework ships (`.claude/hooks/gitleaks.toml`).

**What a consumer sees:**
- **The shipped rule can block a push.** It flags quoted values after a credential name, test fixtures
  included.
- **Your own `.gitleaks.toml` governs if you have one.** `check-install` then says the shipped rule is not in
  force.

### ⚠ BEHAVIOUR — the ledger keeps every disposition, and one finding's fix no longer closes another's deferral

**Every disposition now appends to `decisions[]`, the agent's included.** Before, an agent's claim or deferral
lived only in `reason`, so the next disposition erased it.

**A fix claim now goes to the operator** when its entry holds a standing deferral, decline or keep for a
review group the claim does not name. Otherwise a silent review could close it by exit 1. This happened at
`findings-ledger.mjs:190`: one ten-line bucket held a deferred finding and a fixed one, and the fix's
confirmation closed the deferral.

**Name what a disposition concerns with `--group <run>:<G-n>`.** An unnamed deferral counts against every
later claim on its entry. A disposition made without `--run-dir` now records a dated `(manual <ISO>)` run
instead of a bare `(manual)`. See `shared/ledger-transitions.md`.

### ⚠ BEHAVIOUR — a run's files are read by one strict reader; an unreadable contract no longer means HIGH

- **One strict reader.** The fold, the barrier and the benchmarks now read `verdict.kept.json`, node statuses
  and `run.json` through `lib/run-artifacts.mjs`. It refuses a malformed file by name: null, a list, a string
  of findings, a negative count, or a file whose real path leaves the run.
- **The convergence floor.** `findings-ledger --summary` refuses when the contract cannot be resolved or
  declares a floor that is not a severity. It used to report against HIGH, which could say DRAINED with
  MEDIUMs open.
- **Observations are no longer capped.** The operator reversed the cap: it could drop a note before it was
  shown.

### ⚠ BEHAVIOUR — the findings ledger no longer closes an unclaimed entry on silence

An open entry nobody had claimed fixed was closed when a later review looked at its file and the lens
that raised it said nothing. That closed deferred entries over code that had not changed, and nothing
told the operator. Now only a claimed fix (`--mark-fixed`) plus a later silent review closes an entry.
An unclaimed entry records each silent review instead (`silent_in`), and after **2 such reviews or 14
days** since it was last raised or kept it is listed as **stale** — after every fold, and by
`findings-ledger.mjs --summary --stale` — for the operator to handle, close (`--disposition closed`,
with a reason and `--operator-quote`, the operator's words) or keep (`--disposition open`, which restarts
both clocks). A decline records who made it: without the operator's words it is listed as "declined,
awaiting the operator" after every fold until they confirm it, since a remediation may decline by itself.
A recurrence voids an earlier fix claim, so it can no longer be closed on a claim it disproved.

What a consumer should know: the open set no longer shrinks by itself, and the first lists on an existing
ledger may be long — entries last raised more than 14 days ago are all stale on day one, and every decline
recorded before this change is awaiting confirmation (16 in this repository's ledger).

**And then every transition was written down as one table** (`shared/ledger-transitions.md`), after
three consecutive reviews each found another way out of the open set without the operator:
- An entry leaves the open set by three exits only: a full fix claim confirmed by a later silent review,
  the operator's decline, the operator's close. A decline an agent records is a proposal, still open; a
  `partial` fix never closes on silence; a claim made on an entry already silent, or with no raising
  review lens, goes to the operator instead of out.
- `--disposition open` without `--operator-quote` is now a deferral: it needs a reason and restarts no
  clock. A keep is `open` WITH the operator's words. New: `withdraw` (an agent's proposed decline
  withdrawn, or rejected by the operator) and `reopen` (the operator's way back into a decided entry).
  Agent moves on a decided entry, and moves that would change nothing, are refused with a reason and
  exit 1.
- `--add` records an observation: it no longer resets an entry's silence or clocks, reopens a closed one,
  or counts its author as the lens that raised the finding.
- A declined finding a review raises again stays declined, and returns to the operator only if its
  severity rose above the level it was declined at.
- The fold lists everything waiting on the operator, including every operator decision recorded since the
  previous fold, from a `decisions[]` history on each entry that nothing clears.
- `--migrate-transitions` updates an existing ledger once: it clears disproved claims and stale decision
  fields, moves observation authors out of the raising lenses, and labels closes made under the old rule
  `legacy` without reopening them.

### ⚠ BEHAVIOUR — the external reviewers read a snapshot, and never the repository root

The directory a third-party reviewer reads was a `git worktree` checkout, patched with the uncommitted
diff, mirrored with the untracked files, and then searched for links leading out of it. Each of three
review rounds found another kind of path that search missed: a link added by the diff after the check,
links in ignored paths and in submodules, a submodule replaced by a link, and a listing that overflowed
its buffer and failed. When no checkout could be made faithful, the reviewer was handed the repository
root itself.

Now the directory is built from a SNAPSHOT of the working state — exactly what the lenses read — into a
repository of its own that holds a filtered stand-in for the base commit (excluded directories, withheld
entries and every symbolic-link entry removed), so `git diff <base>` works for the reviewer as for the
lens. What git would have taken from outside the repository (a symbolic link, a file reached through a
linked directory, a hard link whose other links are outside) is left out and named in the gate, and the
finished directory is asserted to hold no link. **There is no fallback to the repository root:** when
the directory cannot be built safely, no external reviewer runs and the run is stamped
`PANEL-NO-SAFE-SURFACE` with the reason. `PANEL-SEES-EVIDENCE` is gone with the fallback.

What a consumer should know:
- **New contract key, `review.panel_snapshot_max_mb`** — absent means 1024 MB, `""` uncapped. The
  snapshot is refused when the working state's changed and untracked files exceed it, the guard
  against a linked directory leading to a large tree outside the repository. A project with large
  untracked files it does not want reviewed can ignore them instead.
- **A run that used to fall back to the root now has no panel.** In this repository's tracked runs the
  fallback never fired; a consumer whose runs carried `PANEL-SEES-EVIDENCE` will see
  `PANEL-NO-SAFE-SURFACE` instead, and the panel lines say why.
- **A global git config no longer reaches the reviewer's repository**: it is made with no template, and
  sets `core.useReplaceRefs=true` itself, so neither a configured template nor a global
  `core.useReplaceRefs=false` changes what it holds or costs the reviewer its diff. A file name that is
  not valid UTF-8 is left out and named rather than refusing the build, and so is a file that changed
  between git capturing it and the source check — it was judged as it is now while the reviewer was
  shown what it was then.
- **`external-review.mjs --surface <dir>`**: it stays in the repository, where its containment and
  consent are decided, and starts the reviewer in the arms' directory.
- **What this does not change:** a reviewer can still open files outside its directory by path. Measured
  on Windows with codex, whose `--sandbox read-only` bounds writes, not reads; that an arm can open a live
  run's staged artifacts is an open finding. The guarantee is about what the directory presents.

### The agent's own claims were checked by nobody — `quorate:claim-check`

The graph verified every artifact and nothing verified what the supervising agent told the operator
in prose (`shared/unverified-claims.md`, item 2). In one session five issues were reported and each
dissolved under one question from the operator. A new skill writes the draft to a file, has a fresh
checker subagent search for what would make each claim a non-issue, and recomputes its grades
mechanically: `observed` survives only with a citation that resolves, a risk with no trigger does not
stand, a claim about the operator becomes a question, and an attribution stands only with the
operator's words quoted. `full-review`, `invoke` and `remediate` require it where they report.

Its trigger is the claim, not the kind of message. It was first scoped to reports that raise an issue
or recommend; a survey of the interactive sessions found 37 claims that dissolved, and issue reports
were 2 of them — decision requests, capability claims, cost estimates, attributions, explanations of
how the code behaves and "what is waiting on you" dissolved as well.

### ⚠ BEHAVIOUR — every push is scanned for secrets

Nothing checked whether a push carried a credential; a feature-branch push ran no check at all,
by design, to keep saving work in progress free. But a secret pushed to any branch has already
left the machine, and what it exposes cannot be recalled. The `pre-push` hook now runs gitleaks
over the commits each push adds, feature branches included — well under a second — before the
protected-ref decision. Found secrets are redacted and block the push.

Whether the scan is required is a new contract key, `hooks.secret_scan: required | off`, and
**absent means required**. Any other value is refused rather than guessed. CI gains a `secrets`
job that asks the engine for that flag (`scripts/check-secrets.mjs --mode`), installs a
hash-pinned gitleaks only when the scan is required, and scans the whole history. That covers merges
made on the forge, where no local hook runs.

**What a consumer must do:** install gitleaks, or declare `hooks.secret_scan: off` in the
graph_contract. With neither, **pushes are blocked** once the hook is installed, and the message
names both ways out. The key is in `CLAUDE.template.md`, so `check-install` reports it as missing
from an older contract. An earlier, unreleased version of this change let pushes through unscanned
when gitleaks was missing (G-9 of `20260926-002850-m0-close`); it never shipped.

### A bad model or effort fails at mint, not two hours in

The operator's suggestion, and the reasoning is the valuable part: most nodes spawn in the first
minute, but the tie-breaker spawns only on a genuine cross-family dispute and `ui-audit` only when a
project declares a surface. A typo in either one's model or effort surfaced **hours in, on the rare
node, after the quota was spent** — and arrived looking like a transport failure rather than a
misspelling in a config file.

Every assignment the roster makes is now checked before anything spawns. The split between fatal and
advisory is the part that decides whether such a check helps or hurts:

- An **effort vocabulary is a closed set** — the CLI parses a fixed enum — so an error cannot be a
  false refusal. Where the accepted set is not known (codex), no enum is declared: absent means *not
  checked*, which is honest; a guessed list would refuse a level the vendor accepts.
- A **model list is not closed.** Vendors ship models constantly, so an unrecognised model **warns**
  and the run continues. A preflight that blocks a model released last week is worse than the crash
  it prevents.

**It found a live inconsistency.** `shared/external-reviewers.md` says agy takes
`--effort low|medium|high`; the roster's tie-breaker note says `--effort` is *rejected* for those
names. Both are half right — agy rejects an effort for models that already encode it in the label,
like the pinned `Gemini 3.1 Pro (High)` — and nothing enforced either. It is declared as
`rejected_when_model_matches` now, and assigning an effort to that tie-breaker stops the mint.

`spawn-node` also validated `--effort` against a hardcoded `['low','medium','high','xhigh','max']`:
one CLI's vocabulary applied to every node, so a runtime with a different set would have had valid
values refused and invalid ones passed straight through to a spawn.

### Nothing about a vendor is left in the orchestrator

The operator's rule, and it is the right one: *Claude being the only CLI that works today is fine;
the orchestrator hardcoding Claude is not.* Seven sites remained, and every one is now declared by
the runtime that has to honour it.

- **`default_node_runtime`** in the adapter table. `args.runtime ?? 'claude'` was a vendor name in
  the spawner. A table with no default and a caller with no `--runtime` is refused — the
  orchestrator does not pick a vendor.
- **`node_runtime.tools`** — the deny sets and the intent allow-list were frozen arrays in
  `lib/decisions.mjs`, one runtime's tool names sitting in the pure decision layer.
- **`node_runtime.version_argv`** — the run record said `claude_version` and probed a literal
  binary. It records `runtime` and `runtime_version` now; the old field named a vendor in an
  artifact a consuming project keeps forever.
- **The sandbox canary** built ten Claude flags of its own — a second spawner, with its own copy of
  the vocabulary, inside the script that writes the policy those flags enforce.

**An entrypoint a runtime does not declare RAISES**, naming the key, rather than falling back — a
fallback is the hardcoding one level down. And a **capability with no mechanism is refused before
the spawn**: declaring `content_tool_denial` while naming no content-reading tool would have granted
the role, written a policy that denies nothing, and reported a sandboxed node. Found by this
change's own test fixture doing exactly that.

### The basis ceilings moved to where the models live

`convention → MEDIUM/RISK` was hardcoded in `lib/capabilities.mjs`, and the question was fair: why
is a judgement about what evidence is *worth* not kept beside the models, vendors and efforts? It is
`basis_ceilings` in `lens-roster.json` now, each rung carrying what it requires and why. Raising a
ceiling changes what the framework will HONOUR; the validator still rejects a basis a node was not
permitted to use.

Two bugs of my own, both caught by checking derived values against the ones the tree had always
produced. `intent` requires no capability, so counting it made **every** runtime uncapped the moment
the ladder became data — it is `role_granted` and excluded from what a runtime can substantiate. And
the cap's stated reason lost the *why*; it names the rung **and** the capability that would lift it.

Verified unchanged: both generated policy files are identical but for the run id in a path.

### The prompts left the scripts

Model-facing prose lived in four places, and the operator found it before any check did: the run
brief (167 lines in `run-graph.mjs`), the external-arm and tie-break prompts (187 in
`lib/codex-prompts.mjs`), the node prompt head (52 in `spawn-node.mjs`), and the schema
`description:` strings that reach the model verbatim through `--json-schema`. A framework whose
subject is model instructions kept most of its own instructions inside its spawner, where a prompt
author cannot find them and where editing prose means editing control flow.

They are eight templates in `prompts/_templates/` now, filled by `lib/template.mjs`: `{{name}}` and
nothing else — no conditionals, no loops. Every decision stays in code and arrives pre-rendered, and
an unfilled slot or an unused variable throws rather than putting a blank into a document a model
follows literally.

**Verified byte-identical**, which is the only way to move a prompt safely: every output of
`codex-prompts.mjs` — both shadow-arm shapes, both tie-break shapes, all three constants — renders
character-for-character as before. The static blocks were written to disk *from the live module*
rather than retyped, so there was nothing to transcribe wrongly.

**A defect the extraction found.** The brief carried two consecutive severity-ceiling sentences,
both conditioned on the same value: "clamped, not rejected" and "except a §6 invariant, which is
never capped". Both rendered together, telling a degraded node the same rule twice in different
words, and neither telling was complete. No archived brief shows it, because no lens carried a
severity ceiling until they became derived from runtime capability — it would have started firing on
the next degraded run. Merged into one sentence carrying both facts.

Six tests moved with it, and their failure was the point: each was pinned to run-graph.mjs's SOURCE
rather than to the prompt. They read the template now, which is the stronger assertion — it checks
the text a node actually receives.

The last two followed in the same pass. **`spawn-node.mjs`'s prompt head** — short, which is why it
survived: every sentence in it reaches every node in every run, so a rule that small was hiding in a
spawner while governing the whole graph. And the **schema `description:` strings**, which a model
reads to decide what to put in a field and which reach it verbatim through `--json-schema`; the base
envelope's were already data, and these three belonged to variants derived in memory. Both verified
byte-identical — three prompt-head shapes and the full reconcile schema, character for character.

Nothing model-facing is left in the scripts. `prompts/_templates/` holds thirteen files; the
orchestrator assembles them and decides what fills each slot, which is structure rather than prose.

### ⚠ BEHAVIOUR — the orchestrator no longer knows a CLI's name

`spawn-node` built eleven Claude-shaped flags inline. The vendor's *name* appeared twice, which made
the coupling look small; the coupling was the entire invocation. A node's argv is now rendered from
the runtime's own `node_runtime` block — which flag carries the prompt, the model, the schema, the
policy file, the allowed directories, the denied tools, the budget, the session — by a pure renderer
beside the reviewer one it mirrors.

Proven behaviour-preserving: every shipped node shape renders **byte-identical** argv against
baselines captured before the change. And proven real, which matters more: a runtime with a
completely alien vocabulary (`--ask`, `--policy`, `--allow`, `--forbid`, `--mode strict`), declared
only in a run's contract, spawns a lens. Indirection that can only ever render one thing is the
shape of a capability nobody has.

- `--runtime <name>` selects the runtime; the default is a **lookup**, not a literal.
- A runtime that cannot serve the role is refused **by named capability** — "does not provide
  `evidence_capture`, `path_scoped_read`", with a pointer to what each achieves. A specification
  rather than a wall.
- A consuming project declares a runtime under `reviewers:` like any adapter, engine untouched.
- The table now carries `roles:` (`reviewer` / `node`). Adding the node runtime immediately broke
  `check-panel`, which probes "every vendor the engine can spawn" and cheerfully included a runtime
  with no response mapping — it would have probed a transport that does not exist and reported on
  it.

What remains is a fact about the world, not about quorate: Claude Code is the runtime that currently
provides the full sandbox. And a declared capability is still an assertion — nothing probes that a
sandbox holds, which the contract says rather than implies.

### What a node may claim is now derived from what its runtime can do

Two facts were literals in `run-graph.mjs`, applied to every external arm unconditionally:
`allowed_basis: ['convention']`, and the ceilings `MEDIUM`/`RISK`. They are the right values for
every adapter that ships — and they were unreachable by any adapter, so the framework could not
distinguish *this runtime cannot produce verifiable evidence* from *this runtime is not ours*. Only
the first is a property of anything.

`shared/adapter-contract.md` now states each requirement, **what meeting it achieves, and what is
lost without it**; adapters declare what they provide; `lib/capabilities.mjs` derives the rest. The
shipped adapters produce byte-identical caps — no behaviour change — but now with a reason attached
that an auditor can read out of the artifact instead of out of the engine.

So the answer to "why are external findings capped" is no longer "because they are external". It is:
without a way to run `capture.mjs` inside the run directory and cite what it printed, a finding rests
on `convention`, which §4 caps at MEDIUM **for any reporter, a Claude lens included**. An adapter
that declares `evidence_capture` is not capped, by the same rule. A role refusal now names the
missing capability rather than saying "unsupported reviewer" — a specification instead of a wall.

The lens gap is restated as a **missing adapter rather than a law**: Claude Code's `--settings`,
`--permission-mode`, `--add-dir`, `--disallowedTools` and `--json-schema` are recorded as one
adapter's mechanism for meeting the requirements, not as the requirements. Not built: a second lens
runtime, which needs an adapter declaring its own equivalents and a spawn path through the adapter.
Also not promised: that declaring a capability makes it true — nothing yet probes that a runtime's
sandbox holds, and the doctrine says so rather than implying otherwise.

### The last vendor names, and what vendor-agnostic actually means here

Three `reviewer === 'codex-review'` branches survived the adapters-as-data work and were the last
places a vendor NAME decided behaviour. Both facts they encoded — which modes an adapter serves, and
whether it needs a prompt file at all — are properties of a vendor, so they are `modes:` and
`prompt.required` in the table now.

That claim had been made twice before and been wrong twice, both times because it was checked by
GREPPING FOR NAMES, which answers a question about spelling. It is now checked behaviourally: a test
renames every vendor in the shipped roster to two the framework has never heard of and requires each
arm and the tie-breaker to still resolve to a usable adapter with its own credential boundary. The
same experiment run by hand — the whole roster swapped to `grok`/`astra` — passes the full suite, so
the 242 mentions of codex and agy across the tests are fixtures, not couplings.

**What it does not mean.** The lenses are Claude-only, structurally. A lens is not "a model given a
prompt": its sandbox is enforced through Claude Code's own permission system (`--settings`,
`--setting-sources`, `--permission-mode`, `--add-dir`, `--disallowedTools`, `--json-schema`), and
Rule 2 IS those flags rather than an instruction the model is asked to respect. So "use vendor X for
the first audit" means X shadows that lens as an arm — capped at `RISK`/`MEDIUM`, seeing the same
criteria and brief but not the sandbox, which is precisely why it is capped. The asymmetry is now
stated in the README rather than left for a reader to discover.

### Bring your own vendor — a promise the code did not keep

`lib/reviewers.mjs` has said since it was written that "a CONSUMER may extend the table without
touching the engine: `reviewers:` in the graph_contract". The merge function existed, was exported,
and was tested. **Nothing read the key.** So the one question the adapter table exists to answer —
can I use a different vendor — still ended at "fork quorate and edit `scripts/reviewers.json`",
which `CLAUDE.md` separately forbids: edits inside a mounted submodule exist in no branch, are
carried by no push, and are discarded the next time the pointer moves.

`reviewers:` now works, and is documented in `shared/claude-md-contract.md`. Declared adapters are
merged over the built-ins per field, read from the run's **frozen** contract for the same reason
egress consent is (how a vendor is invoked is part of what a run was), and held to the same
credential boundary — a vendor receives only its own `env_prefixes`.

Two smaller promises failed alongside it and are now kept:

- `adapterErrors` documents itself as "checked at MINT, before anything spawns" and was checked
  inside `external-review`, at the moment an arm was about to transmit. A bad adapter now stops the
  mint, naming the field that is wrong.
- `check-panel`'s own comment says the probe "must cover whatever vendors the engine can actually
  spawn, or a newly declared reviewer ships unprobed while this script reports a clean transport" —
  and it read the built-in table only. It now probes declared reviewers too.

**Still engine-owned**: which lens an arm shadows, and who breaks ties, live in
`scripts/lens-roster.json`. Declaring a vendor does not yet assign it to a role.

### ⚠ BEHAVIOUR — the prompt library split out of `skills/`

Twelve of the twenty-two directories under `skills/` were never skills. Each is a contract the
ORCHESTRATOR spawns: it reads a brief, refuses to run outside a run directory, and emits a
schema-validated envelope. A person who typed `/code-audit` got a refusal. They now live in
`prompts/<id>/PROMPT.md`; the ten a person actually invokes stayed in `skills/<id>/SKILL.md`.

**What this changes for a consumer**: mounting quorate used to put 22 names into the project's own
`.claude/skills` namespace, twelve of them typeable and useless. It now puts 10. Six of the
original 22 collided outright with a real project's own skills the first time quorate was mounted —
the reason the `SKILLS-SHADOWED` stamp exists — so the collision surface more than halves. Nothing
a consumer configures changes, and no slash command a person could usefully run disappears.

The move is only safe because `--inline-skill` reads the file from the framework's own location and
refuses to fall back to slash-command resolution; discovery was never what put a lens's criteria in
front of a node. `prompts/**` is declared source in the contract, because a library matching no
declared glob is one whose findings are reported and not counted (§8.5) — the graph would have
reviewed its own lens contracts as out-of-scope.

Renaming `SKILL.md` to `PROMPT.md` is part of it rather than tidiness: calling a non-skill a skill
is the same false name one level down.

### Boundaries that were one flag, one boolean, or one copy short

- **The intent sandbox was open on Windows, since it was built.** Claude Code exposes a separate
  `PowerShell` tool there, and a shell reads file content. The Rule 2 sandbox is path-scoped `Read`,
  `Grep` denied and every shell denied — *together* — so every intent node ever run on Windows could
  read the implementation it exists to precede. The test that should have caught it compared a
  hardcoded literal against a copy of the same list, so it could not fail for the reason it was
  written. The deny set now has one owner in `lib/decisions.mjs`, and both the settings file and the
  `--disallowedTools` mirror render from it.
- **⚠ BEHAVIOUR — a claimed fix could be confirmed by the wrong lens.** The cross-run ledger promoted
  `fixed_claimed` to `fixed` when any non-intent node reported OK, so an `--only doc-review` re-run
  closed a security finding by the silence of a lens that never looks for it. Confirmation is now
  specific to a lens that raised the entry. **Existing claims become harder to confirm**, which is
  the correct direction — they were closing on weaker evidence than the doctrine asks for.
- **⚠ BEHAVIOUR — `--run-dir` meant two different things**, so a minted run whose `run.json` would
  not parse fell back to re-reading the *live* contract: consent to send source to a third party
  could change after the run froze it. Split into `--run-dir` (asserts a minted run, refused if it
  cannot produce that run's contract) and `--evidence-dir` (a place to write, nothing more). **A
  pre-run caller passing `--run-dir` must switch to `--evidence-dir`.**
- **A node could fill the disk before its timeout fired.** stdout and stderr were opened as
  unrestricted files with no cap. Now sampled and killed past `--output-cap-mb` (default 64), with
  the size actually reached reported rather than the cap.
- **A tie-break ruling was truncated invisibly**, head-only, at 1200 bytes — and the adjudicator's
  own `not_checked[]` items are concatenated last, so an ordinary rationale pushed the stated gaps
  off the end of `reconciled.md` with nothing marking the cut.
- **Two comments in the engine asserted opposite mechanisms** for how the permission policy judges a
  compound command, which decides whether the node deny-list is a boundary at all. Neither carried a
  probe. Both now assert only what holds either way, and the open question is recorded with a probe
  recipe in `shared/unverified-claims.md`.

### Vendors stop being names in a switch

- **Reviewer adapters are data** (`scripts/reviewers.json`): how a CLI is invoked, what it supports,
  which credential prefixes it may receive, how its usage is read back. Adding a fourth vendor is an
  entry, not a code change. The vendor branches went from 44 occurrences across four files to none
  in any decision — what remains names vendors only in comments recording why the branches existed.
- **One of those branches survived the first pass, in the worst file for it.** `lib/decisions.mjs`
  kept a hardcoded `codex`/`agy` credential-prefix map as a fallback. Every caller in the engine
  resolves prefixes from the adapter table, so the fallback was reached by nothing but a test — a
  second copy of the allow-list deciding which secrets cross a process boundary, free to disagree
  with `reviewers.json` indefinitely while the suite stayed green. Removed; a caller that resolves
  no adapter now passes no vendor credential at all.
- Panel arms inherit the clock of the lens they shadow. A 30-minute lens shadowed by a 15-minute arm
  produced a timeout that Windows reports as `ETIMEDOUT` — indistinguishable, for weeks, from a
  broken transport.

### Things that were slower or looser than they claimed

- **⚠ BEHAVIOUR — `review.checks_concurrency`** (default `1`, unchanged behaviour). The six evidence
  pre-flight checks may now overlap when the operator declares that their commands tolerate it.
  Measured on this repository: 3157 ms serial, 1073 ms pooled. Deliberately opt-in: these are
  commands a consuming project declares, and a flaky barrier is worse than a slow one.
- Tie-breaks run as a bounded pool instead of one at a time, and every `expected.json` row is now
  committed before *any* spawn rather than each row before its own.
- **The intent-input hash watched the whole repository.** A `doc_paths` glob contributed its base
  directory's entire subtree, matching or not, so `**/*.md` hashed every script and test — and any
  source edit silently invalidated the pinned intent the cache exists to keep stable.

### Documentation that described a system nobody had

- `README.md` and this file, both new.
- §8's list of scripts carrying the recursion guard named five; seven carry it. Now verified by
  name on every push — a list is a countable fact wearing different clothes.
- Three installed skills appeared in no roster list at all, which is indistinguishable from being
  forgotten. The registry is now checked for completeness, both directions.
- The build log at `blog/build-log.html` quotes the operator, and four of its eight quotations were
  wrong — the assistant's own words quoted back, a line from a continuation summary, two turns
  merged. `scripts/check-quotes.mjs` now verifies every quotation against the transcripts, and
  treats an ellipsis as a shortening rather than a licence to stitch two remarks together.

---

## 2026-09-02 → 09-08 · reviewed by itself, repeatedly

Twelve runs of the framework against itself are recorded in the cross-run ledger, the earliest dated
2026-09-02 — the ledger began then, so runs before it are not counted here rather than being
estimated. Each was remediated. The defects worth naming are the ones a reader would assume could
not exist:

- A severity clamp that silently did nothing.
- An inert-feature detector that could never run inside the lens required to run it.
- A prose node that could never report `OK`.
- A `$0` budget cap: `budget_usd_per_node: ""` meant `Number("") === 0`, which blocked every node.
  The same text now means uncapped — **the same key, the opposite behaviour, and no signal**.
- Evidence paths, run directories and excerpt reads that trusted a path without checking where it
  pointed after symlink resolution.
- `TREE-MOVED`, declared from the beginning and inert twice over.

The cross-run findings ledger dates from here: a fix records a *claim*, and only a later run that
covered the file and stayed silent turns it into a fact.

## 2026-08-31 → 09-02 · the cross-family panel

External arms became a contract rather than a hope: an enforced envelope, a declared cap on how much
weight a third party's finding carries, and a gate that says so when the panel is absent. Enabled
for every judgment lens on 2026-09-02, on the operator's decision that same-family agreement may be
one opinion counted twice.

## 2026-08-25 · options before decisions

`candidate-pool` ported from the sibling project; the panel's inline argv capped after a brief
arrived at a reviewer truncated, which does not fail loudly — the reviewer simply answers a smaller
question.

## 2026-08-03 → 08-05 · the graph

The skill set, the disk-first protocol, and the rule the whole system is named for: a required lens
that did not report makes the gate `BLOCKED`, never `PASS`. Restructured into the Claude Code plugin
layout on 08-05, which is how a consuming project mounts it as a submodule with no install step.

The second commit in the repository is `Fix: a missing required lens no longer emits PASS`.
