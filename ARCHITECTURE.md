# quorate — architecture

This document is a **specification**, not a description. Every section states something the code must
satisfy, in a form a reviewer can check and fail against. `arch-review` cites it as
`basis: architecture_doc`, which is the only basis that lets a structural finding exceed `RISK` — so a
sentence here that cannot be checked is worse than an absent one: it grants authority to a claim
nobody can test.

It was written after roughly six weeks of building, from the decisions actually made and the defects
that forced them. Where an invariant names a scar, that is deliberate: a rule whose cost is recorded
survives a refactor, and a rule stated as a preference does not.

## 1. What this system is

A **fan-in verification graph**. One artifact is examined concurrently through several independent
lenses, each a separate subprocess of the contract's node runtime (`claude -p` by default) with a clean context; they are held at a barrier,
reconciled into one gated verdict, and every claim they make cites evidence a script wrote to disk
before the claim existed.

The name is the requirement: a meeting is *quorate* when enough members are present for its decisions
to be valid. A required lens that did not report makes the gate `BLOCKED`, never `PASS`.

**What it refuses to be**, because each refusal shapes the code:

- Not a linter. Every finding is a judgement by a model, held to an evidence path and a declared basis.
- Not a fixer. The graph that finds a defect never repairs it. A remediation is a later run of its own —
  minted by `new-run --remediates` from a finished review, its node spawned by `scripts/remediate.mjs` in a fresh
  context under a policy that may edit only the contract's source and test globs and cannot commit — the runner
  commits each cluster the node reports, after it exits — and the rule for what it fixes and when it stops is `shared/remediation.md`'s.
- Not a consensus engine. Disagreement between families is the *output* of the adjudication panel, not
  a problem it resolves. A tie is recorded as a tie.
- Not a service. It listens on nothing, serves nothing, and stores no state outside its run
  directories, one ledger, the two files beside them that `shared/disk-first-protocol.md` §1 lays
  out (`latest.txt` and `.intent-cache/`), and the external arms' directories under its own home,
  `<quorateHome>/arms/<repo key>/<run-id>/`, removed when the run ends and reclaimed whole by its resume
  (`arms-directory-home.design.md`), and the reviewer probe records under `<quorateHome>/reviewer-probes/` — one file
  per combination of reviewer, model, effort, mode, route, CLI version, machine and the probe's own code (a hash of
  `PROBE_CODE_FILES`, so one engine's record never vouches for another's probe), read before every external call
  (`scripts/io/reviewer-probe.mjs`; `QUORATE_REVIEWER_PROBES` relocates them, which the tests use). The rest of what it
  keeps under its home, each written by one owner:
  - `<quorateHome>/reviews/<repo key>/` — runs staged while they run, moved back when they end (`scripts/lib/reviews-root.mjs`;
    `review.reviews_dir`).
  - `<quorateHome>/locks/` — the one-remediation-per-repository lock, keyed by git's common directory
    (`scripts/io/repo-lock.mjs`).
  - `<quorateHome>/code-index/` — the code index's cache, one folder per indexed tree, size-capped
    (`scripts/code-index.mjs`; `review.code_index_cache_max_mb`).
  - `<quorateHome>/claim-check-surfaces/` — the directory a cross-family claim checker reads, removed when the check ends
    (`scripts/claim-check.mjs`).
  - `<quorateHome>/decision-surfaces/` — the decision panel seats' directories, each call's holding its copies of the paths
    the work context names, and their scratch, removed after each round or when the decision ends (`scripts/decide.mjs`).
  - `<quorateHome>/session-runs/<repo key>/` — a long run's state, and `<quorateHome>/cli-freshness.json`, the daily CLI
    version comparison (`scripts/io/run-state.mjs`).
  - `<quorateHome>/stops/` and `<quorateHome>/commands/` — the session records, the stop record and the command log, kept
    for `review.session_record_retention_days` (`scripts/io/stop-log.mjs`, written by `scripts/stop-guard.mjs` and
    `scripts/command-log.mjs`).
  - `<quorateHome>/publish/` — one folder per publish, `<stamp>-<commit>/`, holding each snapshot check's output, the
    record the release keeps of what it checked (`scripts/publish.mjs`; operator, 2026-11-16: "In the engine's home
    (Recommended)", G-11 of 20261116-231613-m2-9a2-remediation-review).
  - `<quorateHome>/bench-repair/` — the repair-pass bench's results, one `result.json` per case, committed nowhere
    (`scripts/bench-repair-pass.mjs`).
  - `<quorateHome>/stdin/` — a runtime child's stdin file, one folder per call made exclusively, removed after the
    call, and any folder there older than a day swept (`scripts/io/stdin-file.mjs`; stdin-folder-owner.plan.md).

  `tests/regression-home-state-roots.test.mjs` enumerates the names the code creates under the home and fails when this
  list does not name one (stop-owner-grep-state-roots.plan.md stage 2).

## 2. Layers, and the rule that defines each boundary

The boundaries are load-bearing; each one was crossed at some point and cost something.

| Layer | Where | The rule that defines it |
|---|---|---|
| **Pure decisions** | `scripts/lib/*.mjs` | No I/O, no clock, no environment, no spawning. Inputs arrive as parameters — including, where a decision must consult the filesystem or a process, the platform implementation as a required `io`. Testable without a filesystem. Enforced: `tests/regression-lib-takes-io.test.mjs` refuses any `lib/` module that imports `node:fs`, `node:child_process` or `node:os`, imports `scripts/platform/` or `scripts/io/`, or reads `process.env`, `process.platform`, `process.cwd()`, `Date.now()` or a bare `new Date()`. |
| **Orchestration** | `scripts/*.mjs` | Owns the run: its control flow and its I/O — directly, or through the two layers below it, which are part of the orchestration side and exist so the pure layer never has to reach the host. Contains no model-facing prose and no rule that the pure layer could hold. |
| **Host I/O** | `scripts/io/*.mjs` | The orchestration side's I/O modules: the ones whose purpose IS I/O (atomic writes, worktrees, caches, the glob walker, child processes), and one module per `lib/` module that needs `io`, re-exporting it with `io` bound to the host. Orchestration imports from here, so the parameter is supplied in one place. |
| **Platform** | `scripts/platform/` | Everything that differs by operating system, behind one interface whose members are `interface.mjs`'s own list — restated nowhere. `common/` for what is identical on all of them, `posix/` for what linux and macos share, and `win32/`, `linux/`, `macos/`. `index.mjs` is the only reader of `process.platform`, instantiates once per process, and refuses an operating system it has no implementation for rather than falling back; `check-install` and the pre-flight load it first, so that is learned at install. **This row owns these rules**; `shared/adapter-contract.md` says only why this adapter is code. `.claude/requests/os-platform-adapters.md`. |
| **Prompt library** | `prompts/_templates/`, `prompts/<node>/PROMPT.md` | Every sentence a model reads. Assembled by `lib/template.mjs` with `{{slot}}` substitution — no conditionals, no loops, so every decision is made in code and arrives pre-rendered. |
| **Doctrine** | `shared/**` | Rules cited by name from skills and briefs. Consumer-visible; changing one changes what every node is held to. |
| **Consumer surface** | `QUORATE.md`, `CLAUDE.template.md`, the `graph_contract` keys, `.claude/quorate/*` | Everything a project declares or reads. A consuming project touches nothing else. |
| **Self-location** | `lib/locate.mjs` vs `lib/project-paths.mjs` | Where the FRAMEWORK is, versus where the REVIEWED TREE is. These were one value while the framework lived inside its only consumer; separating them is what lets a known-good engine review a broken one. |

### A-1 — One owner per rule

A rule expressed in two places has two behaviours, and the one that takes effect is whichever the
caller happened to use. Every rule, constant, vocabulary and path in this system has exactly one
definition, and every other site derives from it.

*Checkable:* a literal that duplicates an exported constant; a second implementation of a decision the
pure layer already makes; a document restating a rule another document owns.

*Scars:* `EXECUTABLE_COMMAND_KEYS`, `panelProbePath`, the vote vocabulary, `globDirPrefix` (three
owners, two disagreed), `declaredReviewers` (two copies with different fallbacks), the group-id shape
(three copies), the request-status rule (discovery and acceptance disagreed, so a draft quoting
`status: approved` was discovered as approved), and argument parsing. Every entry script read its own flags, and only
some refused a missing value, so a trailing `--only` deselected every lens. The owners now are `lib/argv.mjs`
(`parseArgv`, with each script's spec in `lib/argv-specs.mjs`) and, for the depth guard's parse, `lib/node-depth.mjs`
(entrypoint-argv.plan.md). Then limits in minutes (one key fell back to 15 at four readers and 30 at two, and only one
value was bounded) and the degraded-cap sentence (dozens of statements, the owning document's among the wrong ones):
`lib/check-timeout.mjs` owns every minutes value, and a rule restated in documents reaches them as a marked region
`gen-rule-text.mjs` writes from its one owner (`lib/rule-text.mjs`; code-index-d1-part-a.plan.md).

### A-2 — The pure layer takes its inputs as parameters

A function in `lib/` reads nothing from an enclosing scope, a module-level variable, or the
environment. What it needs arrives as an argument.

That includes the filesystem, the clock and the environment themselves. A decision that must ask
the disk takes the platform implementation as `io`; one that needs the time takes `now` or `at`;
one that needs a home directory takes it. No default parameter reaches past the argument list for
them — `now = Date.now()` is the enclosing-scope read this rule forbids, spelled as a default.

*Scar:* for its whole life until 2026-09-24 the §2 table said this layer did no I/O while 15 of its
39 modules did, and every lens reading a diff that touched one raised it (G-4 of
20260924-181523-post-med5, and six ledger sightings before it). A rule stated but not checked is a
description of intent; the lock test is what turned it into a property.

*Scars:* three `ReferenceError`s in one phase — `tbStartedAt`, `judgeId`, and `groupsById` reached
through a closure into a nested block, the last of which threw inside an artifact write **after all ten
judges had already ruled**. `check-syntax` parses such code happily; only execution finds it.

## 3. The run, as a pipeline

```
contract  ──▶ mint ──▶ expected.json ──▶ fan-out ──▶ barrier ──▶ reconcile ──▶ adjudication ──▶ gate ──▶ ledger
(CLAUDE.md   (new-run)  (pre-commitment) (lenses +   (all must   (one model   (independent      (verdict) (cross-run
 or rules)                                arms)      report)     judges)      votes, merged)              memory)
```

The reconcile step is ONE node, and past the 80 groups one reply can carry it judges them in batches inside that
node (`scripts/lib/reconcile-batches.mjs`). The rules are shared/disk-first-protocol.md's ("Batched reconcile"), and
are not restated here.

### A-3 — Enumerate expectations, never results

`nodes/expected.json` is written **before anything launches**. The barrier compares what reported
against what was promised; it never derives the node set from what came back.

*Failure this prevents:* a worker that dies silently simply does not appear, and its absence reads as
"nothing to report".

### A-4 — Evidence precedes the claim

A finding cites a path that `capture.mjs` printed. The path is produced by running a command, not by
describing one. A claim whose evidence path was not printed is rejected.

### A-5 — Caps are derived, never declared by the capped party

What a node may claim — its `allowed_basis`, severity ceiling and verdict ceiling — is computed from
capabilities its adapter *declares and demonstrates*, and from the contract's own gaps. Nothing that
is subject to a cap may state its own cap. One exception, by design: an external arm or judge stands on the convention
rung, and that rung's verdict ceiling is fixed by the engine (`CONSERVATIVE_BASIS` in `scripts/lib/capabilities.mjs`); a
roster value other than it is refused at mint and otherwise ignored. A cap the roster could move is one an edited roster
could lift past RISK (G-1 of 20261111-034524-dps-remediation-12-review; operator, 2026-11-11: "A. Amend A-5
(Recommended)").

*Scars:* an arm's `['convention']`/`MEDIUM`/`RISK` were literals unreachable by any adapter; a
project-declared lens carried `verdict_ceiling: 'RISK'` in its declaration while the expected row went
out with `null`, so the cap existed in a constant and a log line and nowhere in the run.

### A-6 — Basis is the ground everything rests on, and authority is structural

A finding states what kind of ground it stands on, and that decides what it may claim. `invariant` is
the only basis that can raise a non-waivable finding, and `convention` is the weakest — which is why
the basis list becomes the envelope's **schema enum**: a node that may not cite `invariant` cannot emit
one. Authority is enforced by the validator, not requested in a prompt.

**The values themselves are owned by `shared/disk-first-protocol.md` §4 and are not restated here.**
That is A-1 applied to this document, and it is here because the copy had already drifted: this section
used to state a ladder of its own, which invented a rung called "executed" that appears in no enum, no
`basis_ceilings` entry and no row of §4 — so a finding claiming it was rejected by the validator — and
dropped `intent`, which the code accepts. The drift was invisible for the same reason every drift in
this repository has been: a second copy looks authoritative and nothing compares it to the first.

A wrong sentence here is not a documentation defect. `doc_roles.architecture` points at this file, so
`arch-review` cites it as `architecture_doc` with no verdict ceiling and can raise a `FAIL` on it. An
invented rung is a false invariant a lens can cite, and A-22's floor was resting on exactly that.

### A-7 — Silence is not a verdict

A promised node that produced no artifact makes the gate `BLOCKED`. Absence is never read as
agreement, as cleanliness, or as a vote.

*Corollaries that are separately checkable:* a `RUNNING` stub is written before every spawn, so a hard
kill leaves a trace; an absent judge is coverage 0 rather than a vote against; `--mark-fixed` records a
claim and only a later run's silence *from the lens that raised it* closes an entry. An entry leaves the
open set by three exits only — a full fix claim confirmed that way, the operator's decline, the operator's
close — and everything an agent does short of that is a claim, a deferral or a proposal that stays open;
silence on an unclaimed entry is recorded and shown, never a close. Every status and transition, and who
may make each: `shared/ledger-transitions.md`.

## 4. What crosses the boundary to a third party

### A-8 — A node's instructions come from the framework

Never from the tree under review. `--repo-root <other>` must not let that tree instruct the nodes
reviewing it. **One exception exists**, and its shape is the specification: a lens the contract
declares, instructed by a path proved to be inside the repository, capped at `convention`/`RISK`, never
required, unable to raise a §6 invariant, and stamped `CONSUMER-LENS` so a gate reader knows.

**A second exception, the project profile** (operator, 2026-11-14: "Name it in A-8 as an exception (Recommended)"):
a consumer's `.claude/quorate/project.md`, and a node's own `.claude/quorate/<node>.md`, are inlined into that node's brief
as **context, never instruction**. Its shape is QUORATE.md's ("Telling a lens how YOUR project works"): bounded at 16 KiB
and truncated with the brief saying so; framed by a header the orchestrator writes, not the profile; unable to grant a
permission, relax a severity floor, waive a §6 invariant or excuse an evidence path, the doctrine winning where they
disagree. It carries idiom and local history, never criteria, and it is the one place the reviewed tree's own words reach
its reviewers.

### A-9 — The vendor is a parameter, never a literal — including in names

An adapter is data (`scripts/reviewers.json`); every per-vendor branch is a field. A vendor name
appearing in code, in a variable, or in a message is a defect even when the value is correct. The one exception this
rule carried, the `--claude-bin` alias of `--runtime-bin`, ended in 0.3.0 (operator, 2026-11-13: "0.3.0, remove the alias
(Recommended)"): the old spelling is named only in the refusal that points at the new one (`scripts/lib/argv-specs.mjs`).

*Scars:* `'agy'` in five places while the vendor was "configurable"; `claudeBin`/`claudeCmd` naming a
generic runtime after one family.

### A-10 — Tracked artifacts carry classes; content goes where git does not follow

`nodes/*.status.json` is tracked and records *what kind of thing happened*. Vendor output, stderr,
prompts embedding source, stacks, and model prose go to `evidence/`, which is gitignored, and the
tracked side names the path.

*Reason:* command output may hold "a connection string, an environment dump, a token inside an error".

*Three things do carry model prose on the tracked side*, and say so. The findings ledger carries each
finding's claim, the reasons for its dispositions and the operator's words: it is the project's memory
and has to outlive pruned evidence. A committed run carries `reconciled.md`, its reports,
`finding-groups.json`, the gate files and `intent.md`, and the intent cache carries its intent text. The
benchmarks' result files in `bench/results/` carry finding claims, refusal reasons and a judge's quotes, and
each is redacted whole where it is written.

**Every write of that text passes through one redaction owner, `scripts/lib/redact.mjs`, which is
best-effort** (ledger-trust-boundaries 1b). It is a pattern guard for common credential shapes, not a
scanner, and a shape it does not know passes. The stronger check is the secret scan on push with the rules the
framework ships (`.claude/hooks/gitleaks.toml`). Both are built from one definition, `scripts/lib/secret-shapes.mjs`,
whose `CASES` table is their shared scope (secret-shapes-and-refusals 1a). Even the scan does not hold when:
- a consumer's own `.gitleaks.toml` governs instead (`check-install` says so);
- `hooks.secret_scan: off` is declared;
- a secret is already in local history before the scan runs, since the scan runs at push.

### A-11 — What reaches git is a decision

Machine-local state never ships. A probe's result, a dev install's pin, an import pointing into an
ignored directory — each describes one machine, and a consumer inheriting it inherits a claim about a
transport it never exercised. A run's record of what IT checked is not that: `run.json.reviewer_preflight` is
the history of one run's mint, read only by that run (to decide `PANEL-DEGRADED`), never by another run or
machine as evidence about its own transport (operator, 2026-10-10: "Decline; clarify A-11", on G-12 of
`20261010-085904-reviewer-preflight-r9`).

*Scars:* `.claude/panel-check.json`, `.claude/tiebreak-check.json`, and `.claude/dev-install.json` plus
a committed `@` import into `.claude/skills/` — the same defect three times.

### A-26 — The contract is trusted at the level of the commands it declares, and an override says so

The reviewer credential allow-list (`env_prefixes` in `scripts/reviewers.json`, `env_names` in a contract
entry) bounds what a THIRD-PARTY CLI receives. It does not bound what the contract routes. A contract
already runs its own `commands.*` with the operator's environment, less the engine's own run variables and, in a
remediation run, the node runtime's credentials (`lib/decisions.mjs` `commandEnvFor`), so an entry that overrides a built-in
adapter (`codex`, `agy`, `codex-review`) may change where that vendor's kept credentials go — its `cmd`,
any field that reaches argv, the Windows shell — and that is the contract's decision, not a leak
(operator, 2026-10-10: "A: decline, make visible (Recommended)").

The node runtime (`claude`) has no allow-list. spawn-node gives a node at most the scrubbed environment
plus `CHILD_ENV_KEEP` — the operator's Anthropic auth (`lib/decisions.mjs`); the probes get less
(`subscriptionProbeEnv` keeps only the OAuth token). So an override of the node runtime hands that auth to
the binary the contract chose, the source-editing remediation node included.

Every path that runs an overridden built-in names it where its reader looks: the gate for a minted run
(`gate.json.reviewer_overrides`), external-review's stderr and every response record, new-run at mint and
in its refusals, spawn-node, check-reviewers and both benches. One function words it
(`overrideLine`, `scripts/lib/reviewers.mjs`). No stamp and no ceiling: it is a fact for the reader, not a
gap.

**The flip condition.** This holds while the contract is the OPERATOR'S OWN. A quorate that ever reads a
contract from an untrusted source — a fetched config, a PR's own contract — must scrub the environment of
the `commands.*` it runs and refuse every override of a built-in (the design's option C), because both
arguments above stop applying the moment that is true. `scripts/capture.mjs` cites this rule.

*Scars:* G-12 of `20261010-170756-reviewer-preflight-r10` and G-1 of `20261009-055155-ero-review` — an
override of `codex.cmd` kept `CODEX_*`/`OPENAI_*` and nothing said where they went; and bench-lenses'
version probe, which handed the node runtime the whole environment until this rule was written
(`reviewer-credential-routing.plan.md`).

### A-27 — The engine never imports an extractor; it runs one, with nothing it was not given

`extractors/` holds the code index's reference extractors (`shared/code-index.md`). They are separate products
that run in a consumer's own Python and Node, and the engine reaches them only as a contract command, through
`scripts/code-index.mjs`. Nothing under `scripts/` imports from `extractors/`, so quorate keeps no runtime
dependency, and an extractor's dependency, acorn, belongs to the consumer that installs it. A test over every engine
module's import specifiers enforces this.

An extractor gets exactly the platform's process basics plus the names its language's `env` declares
(`extractorEnvFor`, `scripts/lib/code-index-cache.mjs`). That is narrower than A-26 allows a contract command,
because an extractor is a parser, and a parser needs no credential and no git identity. It is still trusted like a
contract command for files and network: nothing confines either, and every answer says so (design D7, searched
2026-10-20, no cross-platform sandbox without admin rights).

*Scar:* the plan as first written ran extractors through `scrubChildEnv`, which keeps the Claude credentials, and then
through `candidateEnvFor`, which keeps the git identity (plan-review rounds 5 and 7 of `code-index.plan.md`).

### A-28 — A run directory a caller names is admitted by one owner, for the caller's repository

A run directory carries a `run.json` that configures what a script does with it: the commands it runs, the
repository it locks, commits in and spawns a node in. So a directory is not authority for itself. Every entry script
that takes one (`--run-dir`, `--remediates`, `--follows-remediation`) admits it through `admitRun`
(`scripts/lib/reviews-root.mjs`), which checks, in order: containment in the repository or the engine's home, lexically
and after realpath; a readable `run.json`; a safe `run_id` equal to the directory's real name; what the caller requires
of it; and that the run is one of the repository's runs and names that repository as its `repo_root`. The repository is
the one the caller established (`--repo-root`, or git's toplevel of where it runs), and the script acts on the
repository `admitRun` returns, never on the record's `repo_root`; a record with no `repo_root`, which predates the field,
names no other tree and is admitted where that repository keeps its runs. Paths are compared through the native realpath
and the filesystem's case rule. A caller that reads a run of no repository declares `noRepository`, which skips only the
repository checks and says so.

After admission the directory `admitRun` returned replaces the caller's spelling: nothing reads, writes or forwards the
raw option value again. A field of a record that names another run (a remediation's `remediation_frame.run_dir` and
`reconciled_md`, a review's `follows_remediation.run_dir`, the follow-up review `new-run` prints) is admitted the same way
before its first read, and the admitted directory replaces it from then on. A test holds every entry script to this:
after its first admission, the raw value appears only as the admission, a refusal message, or a test of whether the flag
was given (`tests/regression-admitted-path-adoption.test.mjs`); a rewrite that carries the raw value under another name
is the stated residual.

*Scar:* each script composed its own subset of these checks, and the code-index chain reached D1's round cap on it:
containment alone admitted every repository's staged runs under the shared home, and `remediate.mjs` acted on the
`repo_root` the run named (G-9 of `20261022-211328-ciss-d1-2-remediation-b-review`, G-12 of
`20261022-230755-ciss-d1-4-remediation-review`; `run-dir-trust.design.md`).

### A-29 — Every git process the engine starts runs through one owner

A git process runs the repository's hooks, clean filters and fsmonitor, so its environment is theirs. Every git the
engine spawns goes through `scripts/io/git.mjs` (`gitSync`, `gitCommitSync`, `gitAsync`), in the environment
`gitEnvFor` (`scripts/lib/decisions.mjs`) decides: no secret-shaped name, no runtime auth, no run pin,
`GRAPH_NODE_DEPTH` at least 1, and the SSH agent socket only for `git commit`. A caller cannot widen it: `env` is
refused, and `gitVars` admits only git's own location, pathspec and commit-identity variables. A test enumerates every
call in `scripts/` whose first argument is the literal `git` and holds it to this module; a git binary named through a
variable is the stated residual.

*Scar:* the remediation runner scoped its own git calls, and three reviews running found another git call carrying the
operator's environment — `new-run`'s, the follow-up mint's, the framework mount's (G-9, G-11 of
`20261023-073416-rer-remediation-2b-review`; G-13 with G-2, G-3, G-10 of `20261023-081135-rer-remediation-3-review`;
`engine-git-env.design.md`).

### A-30 — A path below an admitted directory is opened only through one owner

What a script writes below a run directory — its own files, `nodes/`, `evidence/`, `sandbox/` — and what it reads there to
decide something, goes through `confined` (`scripts/lib/confined-path.mjs`, bound to the host in
`scripts/io/confined-path.mjs`), rooted at the directory `admitRun` returned, at one a script has just created
exclusively, or at a folder the operator named on the command line as the place to read (`bench-second-opinion.mjs
--rejudge`, the folder of kept runs; `usage-report.mjs --transcripts`, the session transcripts), or at the repository's
reviews folder, or the folder `--ledger` names, where `findings-ledger.mjs` reads the ledger, and where `usage-report.mjs`
reads the ledger and each run it lists there; a run so read is a record counted
in a report, never admitted for anything else. A file is read whole (`read`), or line by line in bounded chunks
(`readLines`), which never holds a large file as one string. A path is built from safe single names, never a joined string. Each level below the root is `lstat`ed
before it is used, and a link or junction at any level is refused, whatever it leads to, a link back inside the run
included. A missing directory is made one level at a time and checked again; a file is created exclusively (`wx`), so a
name already taken, a dangling link included, is refused rather than overwritten; a replace writes its temporary file
through the same exclusive create, in the same checked directory, and renames it. A test enumerates every write-family
`fs` call in `scripts/` and allows one only through the owner or in a place it names with its reason
(`tests/regression-confined-write-adoption.test.mjs`); that list is the one statement of which writes are outside it. A
second test does the same for every read-family call (`tests/regression-confined-read-adoption.test.mjs`), and its list
is the one statement of which reads are outside the owner. Nothing below a run is contained by real path: a reader that
admitted a link resolving back inside the run reads through the owner now, so such a link is refused on a read as on a
write (`run-dir-reads.design.md`, R-D3 A). A read or a write through an aliased `fs` is the stated residual.

The session records are held to the same rule (`contract-runtime-and-session-files.design.md`, CR-D3 A): the run state and
the CLI freshness cache, the stop record and the command log, each below the engine's home, through `confined` rooted at
the home; and the telemetry records below the repository through `ownerBelow`, which walks every level from the
repository down; a run outside it, a staged run, is walked from the engine's home down instead, so a link between the
home and the run is refused too; a record root outside both the repository and the engine's home is refused, never made
its own root (`ownerBelow`, ECONFINED). A link at the root, at any folder
below it or at the file is refused, for a read and for a write. Where the owner offers no operation, the stop record's
append, a lock's held descriptor and its tail read, the call is raw on a path the owner checked, and the two censuses
name each such file or line with that reason; their lists no longer exempt the run state or telemetry.

Content bound for another party is held to one more rule (`.claude/requests/hardlink-egress.design.md`, HL-D1 B, HL-D2 A,
HL-D3 A; operator, 2026-11-12). Every file whose content goes to an external vendor or a subagent, or into the intent
sandbox, is read through the egress owner (`scripts/lib/egress-read.mjs`, bound in `scripts/io/egress-read.mjs`), which is
built on `confined` and adds two refusals: a regular file with more than one name (`nlink` above 1), whose content may be
another file's under a name the check accepted, is refused with its path and its link count; and a file over
`EGRESS_MAX_FILE_BYTES` (8 MiB, `scripts/lib/egress-read.mjs`) is refused with its size, checked before the read and
again on the bytes read, a path inside the repository checked from the repository root (operator, 2026-11-12: "A. 8 MiB,
root at repo (Recommended)"). The sites are a seat's
copies, every document the intent sandbox takes (the doctrine and the request included, its declared-link rule kept), a
reviewer's prompt in a run or outside one, a subagent's prompt, a decision's question, and a claim check's draft and
transcript; the arms' snapshot refused one already. The transcript is the one streamed read: its raw file is read line by
line with no limit on its size, and the reduced, redacted copy that leaves for the checker is refused over
`EGRESS_MAX_FILE_BYTES` with its size (operator, 2026-11-12: "A. Bound the copy sent (Recommended)"; raw transcripts
of 62-65 MiB measured that day, their copies 1.25-1.38 MiB). A census (`tests/regression-hardlink-egress-census.test.mjs`) lists
them and names every other raw read in their files; the bench's preserved-run copy and `--rejudge` read are the one site
that warns and goes on, by the operator's ruling of 2026-10-31. **A run's own file whose content reaches a prompt**,
verbatim or parsed (a judge's, an arm's or a seat's prompt, the arms' read surface, the intent sandbox), is read through
the same owner rooted at the admitted run, `egressRunReader` in `scripts/io/egress-read.mjs`
(`.claude/requests/prompt-bound-run-reads.plan.md`; operator, 2026-11-14: "One owner for prompt-bound run reads
(Recommended)"), and its census (`tests/regression-prompt-bound-run-reads.test.mjs`) sees the aliased run readers
(`runRead`, `runOwner.read`, `owner.read`) in the scripts that build prompts, naming each other one with why it reaches
no prompt. What a refusal there does is set by the input's class (operator, 2026-11-14: "Design step: refusal classes +
a run test (Recommended)"): a **required** input refused, or absent, starts no node it feeds, which is recorded
`BLOCKED` with the cause; a **context** input refused is left out and named in the node's brief and the gate's
not-checked list, and the node starts; either way a refusal ends the run at its gate, never by an exception. An I/O
failure that is not a refusal (EACCES, EEXIST) still throws, as everywhere else in the engine (operator, 2026-11-15:
"Tighten A-30, decline G-4/5 (Recommended)"). Local reads below a
run keep `confined` alone. A second name made between the owner's check and its read is
the residual below; a read through a name neither census knows is outside what they see.

The check and the open are two calls, so a process that can already write the run directory can swap a level for a link
between them. That is narrowed, not closed (`run-dir-descendants.design.md`, D-D1 A); a post-open identity check and a
native addon (D-D1 B, C) are not built.

*Scar:* `admitRun` admitted a run directory, and every path below it was composed per site, so each review found the
neighbours of the sites the last remediation fixed: the run-dir-trust chain reached D1's round cap on it
(`20261024-130245-rdt-remediation-4`, refused; `run-dir-descendants.design.md`).

## 5. Honesty invariants

These are what make a verdict readable by someone who was not present.

### A-12 — Every gap is named in `not_checked[]`

An empty contract key, an unprobed transport, an uncapped budget, a skipped lens, a refused judge: each
appears verbatim in the run's `not_checked[]`. A run may pass on what remains; it may not omit what it
did not do.

### A-13 — Every stamp states its consequence

A stamp names a state the run is in; the consequences table says what that state does to *this* node.
`stampConsequence` throws for a stamp it cannot explain, so an unexplained stamp fails the run rather
than reaching a model as a bare word.

### A-14 — An unverified claim is marked, not asserted

`shared/unverified-claims.md` exists because this system's central risk is a confident report about
something nobody checked. A claim the artifacts cannot support is labelled, dated, and left visible.

### A-15 — A probe must not differ from production in any dimension that can fail

A probe that reconstructs production from memory reports the path as exercised while testing a
different path.

*Scars:* `check-tiebreak` sent a lowercase node id while the orchestrator sent `adjudicate-G-17-agy`,
which `NODE_ID_RE` refused — so every real adjudication failed at argument-parse time while the probe
passed; and it re-typed the brief, the participants and the party rule, and the copy had drifted.

### A-16 — A test must be able to fail for the reason it is named

A source-shape assertion cannot see behaviour. An assertion built from fixtures the author invented
agrees with whatever the author believed. A guard whose window can end before the fields it checks
passes vacuously.

*Scars:* a two-sidedness predicate tested against `{source: null}` lens findings — a shape the engine
never produces — which then silenced every dispute in a live run; a hygiene guard whose anchor matched
`writeStatusStub` instead of the tie-break record, passing throughout the commit where the defect was
live; a `\b` that was a literal backspace character.

### A-17 — No source file may be binary to a search tool

This engine searches its own source: every test anchor, the documented-identifier sweep, the counted
facts. A NUL byte makes `ripgrep` skip a file **silently**, so every guard over it passes vacuously.

## 6. Depth and cost

### A-18 — Depth is guarded at every entry point that can start graph work

A node that can spawn nodes is unbounded fan-out with a bill attached. `GRAPH_NODE_DEPTH` is checked at
every such entry, fails closed on a value it cannot read, and the prohibition is stated in every brief.

### A-19 — Concurrency and spend are declared, and every bound is visible

Pools take their width from the contract. A run that stops early, caps at a ceiling, or drops a worker
says so. An uncapped tier is named in `not_checked[]` rather than reading as unlimited by default.

### A-25 — One owner stops a child, and stopped means an exit was seen

Every asynchronous child this engine stops is stopped by `scripts/io/stop-child.mjs`, and by nothing else;
the platform's tree kill is the primitive beneath it: `killTree`, which answers with a promise, and for the exit hook,
which cannot wait, `killTreeNow`, its synchronous form (`non-blocking-kill.plan.md`). A kill's return means *requested*. The owner reports
one of three outcomes and no fourth: `exited` (the child's own exit event, seen within the deadline),
`refused` (the platform would not kill it: it is alive), `unconfirmed` (no exit was seen in time, after a
kill that was accepted — or that failed on a process no longer there, when the stop cannot wait for its
exit: it may be alive). A failed kill is `refused` only for a process still there: the owner asks its
own handle, then `isAlive`, because the primitive cannot tell — Windows' `taskkill` exits 128 both for a
process already gone and for one it may not end (measured; `stopping-a-child-refusal.design.md`).
`exited` is the **child's** exit — the process the run holds — not its tree's: for an accepted kill and a
failed one alike, a descendant that outlives it is not seen. On posix the kill is a group signal, delivered
while any member lives; on Windows a non-detached descendant is ended by the runtime's job when its parent
exits. That window is a stated limit, not a guarantee (operator, 2026-10-03: "Decline G-5, state the
limit"; G-5 of 20261003-012557-stop-child-refusal-review). A caller says the last two as themselves — in the node's status as
`orphan_pid` with `kill_refused` or `kill_unconfirmed`, and in the gate's `not_checked[]` if it still
answers when the run ends — never as stopped. Those fields and every sentence about a stop are built in one
place, `scripts/lib/stop-vocabulary.mjs`; a lock test refuses them anywhere else
(`stopping-a-child-vocabulary.design.md`). A pid the process does not hold is watched, never killed,
because by then it may name another process. The deadlines are the owner's named constants, stated once
there.

An orchestrator leaving on a signal or an uncaught failure stops every child it holds at once and waits at
most one deadline, so an interrupt still ends promptly and costs at most that wait: the platform's tree kill
answers asynchronously, every child's kill is started before any is awaited, and a kill still running at the
deadline is itself stopped and its child recorded unconfirmed (`non-blocking-kill.plan.md`). On any other exit it can
only request the kills — an exit hook cannot wait — and records each child as unconfirmed, or a child still
there whose kill failed as `refused`. Those requests use the synchronous tree kill and are made one after another,
so they are outside any deadline: with many children an exit takes their sum (on Windows a few hundred
milliseconds each). A node runner passes the signal on to its own child, which on POSIX sits in a process group the
orchestrator's kill does not reach.

On POSIX the model child also runs under a **file-size ceiling** (`proc.boundedLaunch`, a few GiB). It
bounds a **runaway**, not the node's output: the output cap is still run-child's, sampled and enforced by a
kill; the ceiling is what holds when that kill is refused or never seen to take effect. Windows has no such
limit; a non-detached child there is ended with its parent, and the status says `file_size_ceiling_bytes:
null`. That ending is the runtime's, not this engine's: Node documents `detached` as what lets a Windows child
"continue running after the parent exits", and libuv's job object is the mechanism (inferred; nothing here
creates or configures a job). Because this rests on it, it is measured, not assumed:
`tests/regression-windows-job.test.mjs`.

**Not covered:** the ceiling does not apply to the external arms or the adjudicators (`stopping-a-child.design.md` §5).
`capture` is covered since `capture-interactive.plan.md` stage 3 (operator, 2026-11-15: "Approve, start the bench
(Recommended)"), through either of its two front ends, which share one allow-list (`scripts/lib/capture-admit.mjs`).
The lens's, `--run-dir`, runs its command through `spawnCapture`, started killable, and a deadline stops the tree through
this owner; `spawnSync`'s own kill, which it used before, ended the direct child alone, and a grandchild holding the pipes
outlived the deadline on Linux (`tests/regression-capture-tree-deadline.test.mjs`). The interactive one, `--interactive`
(stages 4-5), runs a session's command string through `scripts/io/run-pipeline.mjs`, not `spawnCapture`: its pipelines
are built child to child, and each stage's tree is stopped by this owner at the deadline, when its downstream has closed,
or when a stream reaches its cap. (Corrected 2026-11-16: this said both ran over `spawnCapture`, G-1 of the delivery
chain's reviews.) `external-review` is covered: its reviewer **probe** runs through `spawnCapture` (G-3 of
`20261010-071234-reviewer-preflight-r7`), and so does its **vendor call** (`stop-owner-grep-state-roots.plan.md`
stage 1, G-11 of `20261022-200543-ciss-d1-review-2`), started killable, so a timed-out reviewer CLI is stopped by this
owner, tree and all, and the timeout's reason names the stop's outcome. It no longer passes Node's own `timeout` to the
spawn, which would end the direct child alone.

*Checkable:* `tests/regression-stop-single-owner.test.mjs` refuses a `killTree` or `killTreeNow`, a `.kill(` or an escalation
or grace deadline anywhere but the owner and the platform, and a launcher whose child is not a killable tree.

*Scars:* four reviews running found the same kill-path defect in a different launcher each time — a kill
counted as a death, an accepted kill with no deadline, a launcher that waited forever, a reaper that killed
and asked "alive?" in the same breath and reported every child still dying as a survivor (5 times in 5 on
Linux) — because each launcher answered "how is this child stopped, and what do we say" for itself
(`.claude/requests/stopping-a-child.design.md`).

## 7. The decision layer — BUILT (the delegated panel and the grounding floor); the floor's value uncalibrated

> **BUILT 2026-11-01** (`.claude/requests/autonomous-run.plan.md` and `.claude/requests/decision-records.plan.md`;
> the rulings: the operator, 2026-10-31, "as suggested", to "How should §7 and the decision panel be reconciled?"
> option A; and 2026-11-01, the decisions of `decision-records.design.md`, DR-D2 B "then", DR-D6 and DR-D7 "as
> suggested"). The **delegated decision panel** is `scripts/decide.mjs`, its rules in `scripts/lib/decision-panel.mjs`,
> behind `review.decision_panel` (off by default, per repository). It polls three families blind in round 1 (A-21),
> sets each decision's basis by code from the citations its seats give (A-22), settles a delegable question whose basis
> is at or above `review.grounding_floor` under A-20's one exception below, sends one below the floor to the operator
> with the panel's positions as its options, never touches what A-23 reserves, and records every decision (A-24).
> `review.decision_rounds` is read with the meaning `shared/claude-md-contract.md` gives it (rounds before the
> panel's moderator is asked, default 3; `review.decision_rounds_max` the hard cap, default 6), which replaced the
> maximum-with-default-1 A-21 item 3 first specified. `review.autonomy_floor` is not a key: A-22 says why.
>
> **What stays uncalibrated is the floor's VALUE.** The section was deferred on 2026-09-16 until there were real
> consumer runs to calibrate a floor against, and that reason still holds for the value: `measurement` is the
> operator's ruling of 2026-09-13, not a measured setting. Set from this repository alone, it would be the
> single-corpus mistake the roster already records for models and efforts; the reversal record of A-24 is what will
> correct it.

Recorded here because the architecture is where it belongs. It moved from `PROPOSED` to `SPECIFIED` on 2026-09-13 when
the operator ruled on the three questions the proposal could not answer for itself: may it decide alone, where the
floor sits, and what escalates regardless; and from `SPECIFIED` to `BUILT` with the two plans above. A proposal is one
person's preference; a specification is a ruling somebody can be held to.

**The problem, measured.** `scripts/usage-report.mjs` on this repository: 244 commits, 40 reviewed at
that commit (16%); 154 replies that ended in a question, 87% of which the operator answered with
information rather than assent. Work routes through a human continuously, and the artifacts record
none of those decisions — so neither the cost nor the quality of that routing can be checked.

Read that 16% with G-49 in hand: when it was measured, `usage-report` credited a run's `head_commit`
without consulting the `dirty` flag recorded beside it, so a run over uncommitted changes counted its
PARENT as reviewed, and the number is an upper bound. The figure stays here with the defect named rather
than being quietly restated. The report no longer does this: `scripts/lib/reviewed-run.mjs` credits a
commit only to a clean reviewed run, and the report counts the dirty and unflagged reviewed runs and
labels its figure unverified while either is above zero (usage-report-reviewed-runs.plan.md, stage 2).

### A-20 — quorate recommends; the operator decides

**quorate never settles a decision alone.** Ruled by the operator, 2026-09-13. The layer's job is to
make a decision *well-posed and well-argued* before it reaches a human, not to remove the human.

This is the narrower of the two things that were on offer, and the reason for choosing it is in the
measurement above: 87% of asks were answered with information rather than assent. A layer that
acted alone would have been wrong most of the time it acted, and the 13% it would have saved is the
cheap half.

What the layer removes is not the decision — it is the *unstructured* decision. A choice arriving as
prose in a chat message has no options, no stated cost, no basis and no record. The same choice
arriving as a decision record has all four, and the operator's answer then changes one thing rather
than reconstructing the question.

**One exception, ruled by the operator 2026-10-31** ("as suggested", to option A of "How should §7 and the decision
panel be reconciled?"; the request is `.claude/requests/autonomous-run.md`, approved 2026-10-31). With
`review.decision_panel: on`, a question with options whose category is `delegable` is settled by the decision panel
(three families, blind, by majority; `scripts/decide.mjs`) **when the decision's basis is at or above
`review.grounding_floor`** (A-22; the operator, 2026-11-01, DR-D6 A), and the work proceeds on its answer. Below the
floor, the question reaches the operator with the panel's positions as its options. Off, which is the
default in every repository, A-20 holds unchanged. Nothing A-23 lists is ever delegable: those reach the operator,
flag on or off. A panel decision is reversible by the operator (`decide.mjs --overrule`), and every one is recorded
under A-24.

### A-21 — Round 1 is blind; every later round is labelled post-exposure

For a choice arising during work, the layer:

1. **enumerates the options**, with pros, cons, and the constraint each one breaks;
2. **polls independent proposers in parallel and blind** — this is round 1, and it is the only round
   admissible as corroboration;
3. **optionally runs rounds 2..N**, in which each proposer sees the others' positions and reasons under anonymous,
   reshuffled letters. `review.decision_rounds` (default 3) is the rounds before a non-voting moderator is asked
   whether to extend, and `review.decision_rounds_max` (default 6) the hard cap (the operator, 2026-10-21, in
   `autonomous-run.md`: "configurable, default 3"; "Moderator extends, capped"); this replaced a maximum with default
   `1` on 2026-10-31;
4. **grades the choice on the basis ladder** of A-6: what does the decision actually rest on?
5. **presents options, positions and argument to the operator**, worded by the floor of A-22, or, under A-20's
   exception, settles a decision at or above the floor; and
6. **writes a decision record** — options, pros/cons, every round, the basis, the operator's choice (or the panel's,
   under the exception), and what would change it.

**The operator asked for discussion rounds with early termination on consensus. This is that, with one
line rewritten, and the disagreement is recorded rather than resolved silently.**

The proposal this replaces said a discussion between models *destroys* independence and must never
happen. That was too strong — a blind parallel poll yields three verdicts and no argument, and the
argument is most of what a reader needs. But the objection underneath it is correct and survives:

- **Consensus after exposure is convergence, not agreement.** Models drift toward whichever position
  was stated first or most confidently. Two proposers agreeing blind is evidence. Two agreeing after
  reading each other is one opinion with a witness, and this framework already knows it — adjudicators
  vote blind (§ adjudication), and pairwise agreement is reported with its pair count for exactly this
  reason.
- **"Stop early when consensus is reached" terminates soonest in the case where consensus means
  least.** Fast convergence is the signature of conformity, so that stopping rule, applied to any
  round, rewards the weakest signal available.

So both are kept, separated:

- **Round 1 unanimity ends the rounds and is reported as AGREED.** Independent agreement, admissible.
- **Convergence in any later round ends the rounds and is reported as CONVERGED**, never as agreed,
  and never silently. The round in which each proposer took each position is part of the record.
- **The two records are separate artifacts.** Round 1 is evidence; rounds 2..N are discussion. Merging
  them into one "the panel decided" would launder the weaker signal into the stronger one, which is
  the same move A-5 forbids when a capped party declares its own cap.
- **The panel has positions, not a verdict — except under A-20's exception.** Without it, the panel cannot decide, so
  it does not get a word that implies it did. With `review.decision_panel` on, a delegable decision at or above the
  floor is the panel's, recorded as "decided by the panel (`<id>`)" with its AGREED or CONVERGED label as above; the
  two-artifact rule still holds, so a CONVERGED decision is never written up as agreed.

### A-22 — `review.grounding_floor` governs what may be presented as settled

A declared basis value (A-6), shaped like `review.convergence_floor`. **Floor: `measurement`** — ruled
by the operator, 2026-09-13, in their words: "do 2. if the decision cannot be benched (some are
possible and have clear goals) just executed".

**The ruling named two rungs and the engine has one.** "executed" does not exist as a basis — the
fallback was written against a rung this document had invented (see A-6). But the operator's intent
survives the correction intact, because the distinction they drew is already inside `measurement`: §4
defines it as "a captured measurement demonstrates it. Requires an `evidence_path` containing that
measurement", and a captured artifact is by definition the output of something that was run. A
benchmark and any other executed command produce the same kind of ground; they are two sources of one
rung, not two rungs. So `measurement` IS "just executed", in the vocabulary the validator
enforces. **Flagged rather than silently reinterpreted:** this is the builder's reading of the
operator's ruling, and the operator may overrule it.

Outside A-20's exception the floor does **not** gate acting, because nothing else acts alone. There it gates **how a
recommendation may be phrased**:

| Basis of the choice | How the layer must present it |
|---|---|
| at or above the floor | *grounded* — a recommendation, with the measurement or the executed command that grounds it |
| below the floor | *taste* — options and positions only. It may not be phrased as a recommendation |

**Under A-20's exception the floor also gates acting** (the operator, 2026-11-01, DR-D6 A): with `review.decision_panel`
on, a delegable decision at or above the floor is settled by the panel; one below it goes to the operator, worded as
taste. **The basis is set by code, never declared** (DR-D7 A): each seat may cite evidence paths, a citation counts
only when it resolves to a captured artifact, as a finding's does (§3), and is among the evidence the question names in
its `evidence` list (the operator, 2026-11-03, GR-D1 A; a question with no list grounds no seat), a seat's basis is what its resolved citations
support, and the decision's basis is the lowest among the seats that formed the majority, so one ungrounded vote makes
the majority ungrounded. Seats execute nothing, so a decision is grounded only by an artifact that already exists.
`review.grounding_floor` takes one of §4's basis values; absent, it is `measurement`.

**The key is named for what it does, and it was very nearly not.** This was specified as
`review.autonomy_floor`, which is what the proposal called it — and under A-20 nothing acts alone, so
an *autonomy* floor grants no autonomy and gates nothing. Two defects in one name: a declared key with
no behaviour behind it is this repository's most frequently rediscovered class (`find-inert-features.mjs`
exists for it, the perf severity floor was a no-op for its whole life, a severity clamp silently did
nothing), and a key whose name describes a power it does not confer is worse than an inert one, because
the next maintainer reads the name and builds against it. So the behaviour was made real — it decides
presentation — and then the name was made to match the behaviour rather than the behaviour stretched to
fit the name.

What makes it non-inert is that it is testable: the same choice at `convention` and at `measurement`
must produce differently-worded presentations, or the floor changes nothing and a test should say so.

**`UNBENCHED` is the honest complication, and it is smaller than it first looked.** This repository
declares no `bench` command, so nothing here is groundable at `measurement` BY BENCHMARK. But a
benchmark is only one source of that rung: any command `capture.mjs` ran produces the captured artifact
§4 requires, and this repository has plenty. So an UNBENCHED project is not one where nothing can be
grounded — it is one where the grounding comes from executed commands rather than measurements, which
is exactly the case the operator's ruling was reaching for. A consuming project with a real benchmark
adds a source; it does not unlock the rung.

### A-23 — Escalation is unconditional for what cannot be undone

These reach the operator regardless of basis, floor, round count, or unanimity. Perfect grounding does
not help where being wrong is unrecoverable. Ruled by the operator, 2026-09-13:

1. **Anything git cannot undo** — a force-push, a history rewrite, a deleted branch or remote, a commit
   to a protected ref.
2. **Anything that installs or registers outside the working directory** — a global link, a
   system-wide editable install, anything registered beyond the repo. `pip install -e .` in a sandboxed
   fixture wrote a system-wide install pointing at a throwaway clone while the setup was being
   described as contained; containment is what leaves the directory, not what sits inside it.
3. **Any change to the contract, the lens roster, or this document** — the files that decide what every
   future run checks and what authority a finding may claim. A quiet edit here changes every later
   verdict, including the verdict on the edit.
4. **Egress metered per call by an API key.** Not egress as such: the operator ruled egress is *not*
   blanket-escalating, and the standing constraint here is a token window rather than dollars per run.
   What escalates is *metered* spend — a call billed per invocation against a key. Every node already
   records `auth_mode`, so the two are distinguishable in the artifacts rather than by assumption;
   this run recorded `subscription`.

Egress that is not metered still obeys everything in §4 — it is bounded to what the framework composed,
and the prompt is the floor of what leaves rather than the ceiling. A-23 adds an escalation, it removes
no existing rule.

**Held by the reserved categories** (2026-10-31): every item above is a category the decision panel refuses, flag on or
off, in the one owner `RESERVED_CATEGORIES` (`scripts/lib/decision-panel.mjs`), written into `shared/session-rules.md`'s
"What waits for the operator" by `scripts/gen-rule-text.mjs`. Items 1 and 2 are its `destructive` and `environment`;
items 3 and 4 are added as categories of their own by the operator's ruling of 2026-10-31 (option A, as above).

### A-24 — A decision not recorded did not happen

Options, pros, cons, every round with its number, each proposer's position and family, the basis, the
floor in force, the operator's choice, and what would change it.

**A decision the panel settled** (A-20's exception) records, where the operator's choice would go, the panel's chosen
entry, its agreement and its record id (`.claude/decisions/<id>/`), and is written up as "decided by the panel
(`<id>`)", never as the operator's; an operator overrule (`decide.mjs --overrule`) is recorded beside it with the
operator's words (ruled 2026-10-31, option A, as above). It also records each seat's citations and the basis code
set from them, the floor in force, its AGREED or CONVERGED label, and what would change it, asked of every seat
(`decision-records.design.md`, DR-D2 B and DR-D7 A, 2026-11-01); a decision below the floor records the same and that
it went to the operator.

The record is what allows the floor to be corrected **by evidence rather than by argument**: if the
operator's later reversals cluster on decisions the layer presented as *grounded*, the floor was too
low and the artifacts prove it. Without the record that correction is one person's impression against
another's, which is the position this whole section exists to get out of.

**Prerequisite, and the reason this section exists at all:** a floor above `convention` is unreachable
until `architecture_doc` is available as a basis — which requires this document. That is why it was
written first. A-7 is the standing proof that writing it is not the same as getting it right:
`doc-consistency-review` found A-7 over-broad against `CLAUDE.md` and `QUORATE.md` within a day of
this file being declared, and a sentence here can now raise a finding above `RISK`.

## 8. Deliberately unspecified

- **Language, runner, layout of the reviewed project.** Read from the contract; assumed nowhere.
- **Which defects matter in a consuming project.** That is the project's, in `.claude/quorate/*`.
- **Whether a finding is true.** The graph establishes that a claim was made with evidence and a
  declared basis, by an independent lens. Nothing here makes it correct.
- **Model quality.** Measured (`bench-lenses`), never assumed, and no rung of the basis ladder rests on
  which model spoke.
