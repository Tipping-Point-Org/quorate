# Disk-First Protocol

The single source of truth for every skill and script in the graph verification set. Every
other file in `.claude/skills/` cites this document by section number. If a rule appears
here and is contradicted elsewhere, this document wins and the contradiction is a defect to
be reported.

**Why this file exists.** A verification graph is a machine for turning many cheap opinions
into one expensive decision. That only works if every opinion is anchored to something a
second party can re-check without rerunning the model. The moment a finding rests on a
sentence rather than on a byte on disk, the whole structure inverts: the reconciler cannot
tell a real defect from a plausible one, remediation burns tokens rewriting code that was
never broken, and the final `PASS` becomes a statement about a reviewer's confidence rather
than about the code. Every rule below exists to make that specific failure impossible
rather than merely discouraged.

---

## §1 Run identity and artifact layout

A **run** is the unit of accountability. It has an id, a directory, and a manifest, all
created before any model is invoked.

**Created at mint, versus written when produced.** The tree below is the layout of a FINISHED run,
and reading it as "all of this exists before the first model call" is a misreading worth heading off
(G-31): what mint creates is the directory, `run.json`, the contract and settings snapshots, and the
empty `nodes/` and `evidence/` trees — everything needed to say what this run IS and what it is
allowed to spend. `intent.md` is written by intent-capture before the first lens launches, when the
capture succeeds; when it fails, no `intent.md` stands (an earlier one is removed), every lens that requires intent is
`BLOCKED` without launching, and only lenses that do not require it still launch, reading the criteria as not captured;
`finding-groups.json` and `reconciled.md` at the barrier; `gate.md` and `gate.json` last of all.

That ordering is the point rather than an omission. An empty `gate.md` sitting on disk from the
moment a run is minted is a verdict-shaped file that says nothing, and this system's whole argument
is that a missing artifact and an empty one must never look alike.

```
run-id = YYYYMMDD-HHMMSS-<slug>          e.g. 20260803-104512-fullsweep
```

Slug is `[a-z0-9-]+`. Run ids sort lexically by time; do not invent another ordering.

```
.claude/reviews/<run-id>/
  run.json                     manifest — see below
  contract.snapshot.md         verbatim copy of the file that CARRIED the contract at run start
                               (CLAUDE.md, or .claude/rules/quorate-contract.md); run.json
                               .contract_source names which
  node-settings.json           the permission policy every node ran under
  intent-settings.json         the intent node's own, narrower policy — Rule 2's enforcement point
  checks.json                  the pre-flight barrier's results, with pointers to the evidence
  sandbox-canary.json          proof node-settings.json was ACCEPTED, not silently ignored (both arms)
  intent-canary.json           the same proof for intent-settings.json — a source read attempted and
                               refused, and a declared document read successfully (both arms)
  sandbox/<node-id>/           what an intent node was given INSTEAD of the tree: brief, declared docs

  intent.md                    Rule 2 criteria, I-1..I-n; frozen once lenses start
  nodes/
    expected.json              which nodes were supposed to run — written BEFORE launch
    adjudication.json          the PANEL's merged result, and the only machine-readable place it
                               exists: per group an `outcome` (decided | tied | inquorate | absent),
                               what it `supports`, every vote that produced it, and a `composition`
                               naming which positions were declared arms and which were not.
                               Composition is REPORTED and gates nothing — a script-side check that
                               a dispute has two sides was tried and silenced every dispute in a
                               live run, because the most valuable class is an arm's finding against
                               a lens's `checked_clean` entry, which is not a finding at all. Also
                               per judge: voted / absent / illegible counts, whether it was a `party`
                               to the dispute it judged, and pairwise agreement with its pair count —
                               kappa is refused, with the reason stated, because a handful of items
                               cannot estimate chance agreement
    <node-id>-brief.md         scope and rules handed to one subprocess
    <node-id>-report.md        rendered from validated JSON; never model-written
    <node-id>.status.json      written even when the child dies
    <node-id>-prompt.md        what an EXTERNAL reviewer was sent — an arm's assembled prompt. A
                               Claude lens has no such file: it gets its criteria by invoking its own
                               contract, and the brief above is the whole of what the orchestrator adds
    adjudicate-<group>-prompt.md  the pointer for an adjudication, and it is named after the GROUP
                               rather than after any node id (G-44). One brief is rendered per
                               disputed group and handed to every judge unchanged — a panel whose
                               members read differently worded questions measures the wording, not the
                               dispute — so the prompt belongs to the group while the node ids are
                               per (group, judge): `adjudicate-<group>-<judge>`. The file is a pointer
                               because the prompt embeds the disputed source verbatim (G-34)
  evidence/<node-id>/          raw stdout, stderr, command logs, screenshots — and, for an
                               external reviewer, the raw vendor response and any failure detail.
                               In an ARCHIVED run this directory is present only if git would ignore
                               it at the destination; otherwise it stays staged outside the
                               repository and the gate's not-checked table says where — except
                               for a run archived by `archive-run.mjs`, which says so on stderr
                               only (claude-md-contract.md, `reviews_dir`)
  evidence/remediation-runner/ a REMEDIATION run only: what the runner writes for itself — a rejected
                               commit's output, an earlier attempt's payload — never overwritten, and
                               never admitted as a fix's evidence (only evidence/remediation/ is)
  remediate.lock               a REMEDIATION run only, while a runner holds it, or kept because the node
                               may have edited the tree with no record, or left at `committing` by a run
                               killed while it committed (once it is deleted, the next invocation finds
                               any commit that landed in git log), or left at `saved` because its removal
                               failed after the run recorded everything (claude-md-contract.md,
                               `scripts/remediate.mjs`)
  evidence/<phase>/crash.json  why a PHASE threw, with a stack per failed worker — `panel` and
                               `adjudication` have one. The tracked side (the gate's not_checked
                               entry) carries `name: message` per cause, which is the engine's own
                               text and what an operator acts on; the stack stays here because it
                               names absolute paths and an error raised while handling a vendor
                               response can quote that response. A pool throws one AggregateError
                               whose `.errors` holds the real causes, and `String(e)` renders only
                               the COUNT — a $69 sweep recorded "3 pool workers failed" and nothing
                               else, at the moment those stacks were the only evidence there would
                               ever be
  evidence/adjudicate-<group>/prompt.md
                               the adjudication brief itself, under the GROUP for the reason above.
                               It lives here rather than in nodes/ because it embeds the disputed
                               source verbatim (G-34) — so an auditor opening
                               evidence/adjudicate-G-3-agy/ finds that judge's response and finds the
                               prompt one directory over, under the group they share
  finding-groups.json          findings grouped by location — the reconciler's input when unbatched,
                               and the whole set the batch files below divide
  finding-groups.batch-N.json  only past 80 groups: one batch each, every file's groups kept together
                               (a file with more than 80 is split, and the run's not_checked[] names it),
                               judged in turn by the ONE reconcile node and merged into its payload
                               (scripts/lib/reconcile-batches.mjs; each batch's own status and payload
                               are kept under evidence/reconcile-batches/)
  finding-groups.reask-N.json  only when a reply left groups out: the re-ask's batches of them
                               ("Batched reconcile" below; written here, beside the batch files, and
                               each re-ask batch's status, payload and report (when it wrote one) kept under evidence/reconcile-reask/,
                               the re-ask node's own payload there too; its brief and its aggregated status
                               are nodes/reconcile-reask-brief.md and nodes/reconcile-reask.status.json)
  reconciled.md                barrier output
  reconcile-divergence.json    only under --reconcile-twice: the two adjudications, diffed
  gate.md   gate.json          final verdict, human and machine
.claude/reviews/latest.txt     plain file holding the newest run-id it was written for (may be stale; below)
.claude/reviews/ledger.json    CROSS-RUN state: every finding group ever raised, with the run that
                               raised it and the run that saw it stay silent. Outlives any one run,
                               and is where I-14's convergence signal is read from. Its statuses,
                               its transitions, who may make each, and the fields each records are
                               owned by `shared/ledger-transitions.md` — not restated here.
.claude/reviews/.intent-cache/<hash>.json
                               the pinned criteria, keyed by a hash of exactly what intent-capture
                               reads. Outlives any one run by design — that is what INTENT-PINNED
                               means. TRACKED, not gitignored: this said the opposite and was wrong
                               about its own tree. It holds criteria derived from committed
                               documents, not captured output, so committing it is what lets a fresh
                               clone reuse a pinned intent instead of re-deriving criteria that came
                               out 56, 49 and 38 long from identical inputs.
```

Those five were absent from this tree for months while the engine wrote them into every run (G-43),
which is the same defect as a documented artifact nobody writes — read from the other side. A layout
that annotates every entry invites the reader to treat it as complete.

And then it happened again, in the same direction, to the two entries above (G-59): `ledger.json`
and `.intent-cache/` are written by `findings-ledger.mjs` and `io/intent-cache.mjs`, sit in this
repository's own reviews directory right now, and appeared in no doctrine document. Both are the
cross-run half of the system — the part a reader is least likely to find by opening one run — which
is exactly why omitting them costs more than omitting a per-run file. I-25 is the rule: every
artifact the engine writes is documented, and every documented artifact is written.

**The directory is `.claude/reviews/`, with the leading dot, always.** A prior
implementation wrote both `claude/reviews/` and `.claude/reviews/` and silently split its
own history across two trees. There is one correct path and it is this one.

`latest.txt` is a plain file containing the run-id and a trailing newline. Not a symlink —
symlinks do not survive a Windows checkout. `new-run` writes it at mint, in the reviews directory
the run is minted in, and a failure there fails the mint, like the run's other mint writes. A staged
run's pointer is written again, beside the run, when run-graph moves the archived run into place, and
a failure of that write does not fail the run: the run completes, and run-graph warns that the
pointer was not updated and may still name an older run. `archive-run` and `remediate` archive
without writing it, and a project that declares `reviews_dir` gets the mint's write only. So
`latest.txt` names the newest run whose pointer write succeeded, which may be a run minted and not
yet finished; a run's own directory and `gate.json` are what identify it.

`run.json` records, at minimum: `run_id`, `created_at`, `base_commit`, `worktree_sha`,
`dirty` (bool), `intent_sha256`, `scope` (derived or human-asserted, with the paths),
`stamps[]`, `contract` (the parsed `graph_contract` block), `settings_sha256`, and
`host {platform, arch, node_version, runtime, runtime_version, cwd}`.

The last two named `claude_version` alone until the node runtime became an adapter entry. A field
naming one vendor in an artifact a consuming project keeps forever cannot record a run spawned on
another runtime — it would report `unknown` rather than wrong, which is the quieter failure and
therefore the worse one. `runtime` is the adapter's id; `runtime_version` is what that runtime's own
`version_argv` printed.

`worktree_sha` is a **content hash of the files under review**, not a commit. It has to be: a
commit sha cannot detect an uncommitted mid-run edit, and this field's only job is to answer
"did the tree move while we were reading it?" at the gate. It once held `head_commit`, which made
`TREE-MOVED` undetectable by construction — a field can carry the wrong answer for years while its
name promises the right one.

**`host` is recorded, never declared.** A contract that states its own operating system can
go stale and lie; `process.platform` cannot. Any report rendered from this run prints the
host line, so an artifact produced on a different platform is distinguishable at a glance.

---

## §2 Severity ladder and verdicts

Two separate scales. Do not conflate them.

**Finding severity** — a property of one defect:

| Severity | Means |
|---|---|
| `BLOCKER` | Ships broken, loses data, or exposes a credential. A single one fails the run. |
| `HIGH` | Wrong behaviour on a reachable path, or a violated declared criterion. |
| `MEDIUM` | Wrong behaviour on an unlikely path, or a violated convention with teeth. |
| `LOW` | Style, naming, or a risk with no demonstrated path to harm. |

**Node verdict** — a property of one lens's whole review: `PASS`, `RISK`, or `FAIL`.

- `FAIL` — at least one `BLOCKER` or `HIGH` finding the lens is prepared to defend.
- `RISK` — findings exist but none is demonstrated; or the lens ran degraded, unless a §6 invariant finding drives
  its verdict (§7, "Degraded lenses").
- `PASS` — the lens checked what it was scoped to check and found nothing above `LOW`.

**A single failing item means the run is not done.** There is no partial credit and no
averaging across lenses. One `FAIL` verdict is a `FAIL` gate; the gate does not take a vote.

**The floor is enforced by the validator, not asked of the lens.** A node's verdict is raised to
match the findings it kept: a `BLOCKER` or `HIGH` forces `FAIL`, anything above `LOW` forbids
`PASS`. This is checked in code because the whole design says a node cannot be trusted to
disqualify its own output, and this is the one place that principle carries the most weight — a
lens declaring `PASS` while holding a `BLOCKER` used to reach the gate unchallenged, since the gate
reads verdicts rather than severities. The floor is computed **after** the severity clamp, so it
reflects what the lens is prepared to defend rather than what it first claimed, and **before** the
verdict ceiling, so a capped node still ends at its cap — except where a §6 invariant finding drives the verdict,
which no ceiling caps (§7, "Degraded lenses"). It only ever raises: a lens may judge
worse than its findings suggest, and under-reporting is the direction that produces a false `PASS`.
When it fires, `verdict_before_floor` records what the node actually said.

**Node state is not a verdict.** `state: "OK"` with `verdict: "FAIL"` is the normal, healthy
outcome of a lens that found a real bug: the *node* did its job, the *code* did not. See §7
for the state machine.

---

## §3 Evidence: the disk-first rule

**Every finding above `LOW` cites an `evidence_path` produced during this run.**

Evidence is produced by exactly one mechanism:

```
node <framework-root>/scripts/capture.mjs --run-dir <abs> --node <node-id> --name <slug> -- <command...>
```

`<framework-root>` is where this framework's `scripts/` directory lives: the repository root when
working in the framework itself, `.claude/skills/quorate/` in the documented consumer mount. Your
brief interpolates the resolved path — prefer it verbatim. (The doctrine previously printed the
legacy vendored path here, which exists in neither supported layout — a lens following it
literally got ENOENT on the only sanctioned way to produce evidence, G-28.)

**Known residual: a captured project command inherits the operator's environment.** `capture.mjs`
spawns declared commands (`build`, `test`, `run`, …) with the environment `lib/decisions.mjs`'s
`commandEnvFor` builds: the operator's, less the run pin (`QUORATE_RUN_ID`), and — in a remediation run,
where the command may run code the remediator wrote — less the runtime's own auth variables. Everything
else crosses, so a command that prints its environment writes those values into
`evidence/<node>/<name>.log`. Raised independently
by an external arm, and declined deliberately rather than missed.

**GRAPH_NODE_DEPTH is part of what is inherited** (G-44), and that is not incidental: a declared
command therefore starts at depth 1, so any quorate script it invokes refuses to start a run or spawn
a node. The residual is that the whole environment travels; the recursion guard riding along with it
is the one part of that inheritance the system relies on rather than tolerates. Removing the
inheritance without passing the depth explicitly would open the recursion the guard exists to close.

Why it is accepted: the command is the **operator's own**, declared in their own contract, running
on a machine where those variables are already in the launching shell — and `evidence/` is
gitignored, so the output stays on local disk and is never committed. The available fixes cost more
than the risk. Scrubbing by default breaks any project whose tests legitimately need
`DATABASE_URL`, a registry token or cloud credentials, and it breaks them *at the pre-flight
barrier*, presenting as "your tests are broken" rather than "quorate removed a variable". A contract
opt-out taxes every consumer with a key to understand, and will be set reflexively the first time CI
breaks. Either fix would also be half a boundary while `run-checks` still hands `capture.mjs` the
full environment one hop earlier.

**The condition that flips this decision:** if evidence directories are ever committed, or run
directories are uploaded as CI artifacts, shared between machines, or attached to a bug report, the
disclosure stops being local and this default must change to a scrub. Anyone removing
`.claude/reviews/*/evidence/` from `.gitignore` is changing a security decision, not a housekeeping
one, and should read this paragraph first.

**The external panel is a fifth condition, and this list did not name it (G-43, 2026-09-10).** An
arm is a third-party CLI told that "reading the repository IS your job … by WHATEVER means", spawned
read-only over its working directory. While that directory was the repository root, the run's own
`evidence/` tree sat inside it — so output this document accepts as local had a route to a vendor
cloud, and the decision above rested on a premise the panel had already broken. `generated_globs`
did not help: it bounds what an arm may REPORT, not what it may read.

Arms now read a directory built for them from a SNAPSHOT of the working state
(`scripts/io/snapshot.mjs`; `.claude/requests/arms-read-surface.md`): the tracked files with their
uncommitted changes, plus untracked files not ignored — what the lens reads, less what is left out below — taken into a
throwaway index and object store, so the operator's own are never touched, and written as plain files
into a fresh directory that is a repository of its own, holding a filtered stand-in for the base commit
(`shared/external-reviewers.md`) so `git diff <base>` works for the arm as for the lens. `evidence/` is gitignored and a live run's own directory is excluded
explicitly (G-21), so neither is in it. Whatever git would have taken from outside the repository — a
symbolic link, a file reached through a linked directory, a hard link whose other links are outside —
is left out of the directory and named in the gate, as is a file whose name is not valid UTF-8 or that
changed between git capturing it and the check; the
directory is then asserted to hold no link and no hard link. It replaced a `git worktree` checkout that was patched, mirrored and then searched for
links leading out, a search that missed another kind of path in each of three review rounds.

That is narrower than "closed by construction", and the difference is MEASURED now rather than
suspected (G-32, doc-consistency-review, said this paragraph overclaimed). On 2026-09-26 a codex arm
(codex-cli 0.155.1, on Windows, with the arms' own `--sandbox read-only --ephemeral`) read files
outside its working directory by absolute and by relative path, including one in the directory that
holds the staged runs. The read-only sandbox bounds writes, not reads. So the directory guarantees what
it PRESENTS as the repository — nothing from outside reaches the arm as part of the repository — and
nothing about what an arm that goes looking can open. That a codex arm can open a live run's staged
artifacts is an open finding on the ledger (`scripts/lib/reviews-root.mjs`), not a closed one; agy, and
codex on POSIX, were not probed.

**There is no fallback to the repository root** (operator, 2026-09-26). When the directory cannot be
built safely — the working state's changed and untracked files exceed `review.panel_snapshot_max_mb`,
the snapshot cannot be taken, the finished directory holds a link, or the framework copied into it is
incomplete — no external reviewer runs, arms and judges alike, and the run is stamped
`PANEL-NO-SAFE-SURFACE` with the reason. The root was handed over before, stamped as a declared
exposure; it is the operator's real tree, and every link check that kept missing a class of path was a
check of that tree.

**No `Grep` for a lens: content search goes through `git grep` under `capture.mjs`.** `Grep` returns
file *content*, so granting it bare beside a path-scoped `Read` was a hole through that scoping — a
lens could read `~/.ssh/id_rsa` or any `.env` into its transcript and out through its rendered report.
This was probed against the CLI rather than reasoned about, and neither policy rule scopes it:
`Grep(/<repo>/**)` in **allow** does not confine the tool (with that rule in place, Grep read
`C:\Windows\win.ini` with no denial — an allow entry *grants*, it does not *scope*), and `Grep` in
**deny** removes the tool outright, with the scoped allow failing to re-admit it. It is all-or-nothing,
and the operator chose none (2026-10-22, B; `stop-owner-grep-state-roots.plan.md` stage 3, G-17 of
`20261022-200543-ciss-d1-review-2`): a lens's deny list carries the runtime's `content_tools` (`denyToolsFor('node')`),
because leaving `Grep` out of `lens_allow` is not a refusal under `defaultMode: manual` (G-7 of
`20261105-212751-sogsr-delivery`), and a lens searches
content with `git grep` through `capture.mjs`, repository-scoped by construction, tail-guarded, and leaving
evidence a finding can cite. The cost is slower searches, and a lens's recall may drop until its prompt adapts;
the bench measures that only for its seeded lenses, and it has not been measured since the change. Do not
restore `Grep` with a scoped allow rule: that ships a comment claiming a boundary that does not exist.

**The read-only subagents keep `Grep`, unconfined, by the operator's choice.** Plan-review and the same-family claim
checker run as read-only subagents (`spawn-subagent.mjs`) and keep the runtime's `Grep` (`content_tools`, through
`lib/decisions.mjs` `denyToolsFor`), so either can read any file the operator's account can, outside the repository, for
the reason above: no rule scopes it. The operator chose to keep it and name it rather than remove it (2026-11-05: "Keep,
and name it"), so this boundary differs by reviewer: a lens has no `Grep`, these two do. It is a named residual, not a
confinement.

**`commands.run` is granted to exactly one node.** It is the only declared command that *starts*
the product rather than inspecting it, and it is admitted by `capture.mjs` solely for the lens whose
contract is to exercise the built artifact and cite captured evidence. Every other node sees the
inspection set only. The gate is in `capture.mjs` rather than in a policy file because a policy file
cannot see this command at all: capture spawns it itself, and the CLI permission layer observes only
`node <framework>/scripts/capture.mjs …` (the resolved path every brief spells out: a lens brief under its Evidence heading, a remediation brief as `capture_cmd`), which every lens may already invoke — so putting `commands.run` into the
lens's *brief* changes nothing, a brief being documentation rather than enforcement.

**Its trust basis, stated rather than implied:** `--node` is **self-declared**. This confines a
careless lens, not a determined one, and there is nowhere to put a secret that would make it
stronger — node policy grants `Read` on the repository root and briefs live under
`.claude/reviews/`, so every lens can read every other lens's brief. The residual is accepted
deliberately: the worst case is a lens launching the operator's own declared command, bounded by
that lens's timeout, which is a hang or a state mutation rather than a credential loss. The boundary
that matters against a **third party** is the panel's env allow-list, and that one is closed. Do not
"harden" this with a brief-carried token: it would read as a boundary while being none.

**`commands.test_one` is granted to the remediation node of a remediation run, and is a TEMPLATE.**
Its one `{file}` token is filled by `capture.mjs` with one admissible test file (the key's rules are in
`shared/claude-md-contract.md`), so a remediation node checks a fix in seconds instead of capturing
the whole suite (`remediation-verification.plan.md`). The trust basis above is WEAKER for it: the
command is still the operator's own declaration, but its argument is chosen by a node that may have
written the file. That is why it is not granted to a lens, takes no `--cwd`, and admits only a file
git lists, classified `test`, with no flag, glob or link out. The `--node` residual stated above
applies to it unchanged.

**The runner checks what it commits.** A remediation node's red and green are narrow `test_one` captures; the check of
the whole is the runner's, once, on the commit candidate, in place, before the first commit (`full_checks`), and a group
commits only when its own red and green are on disk as capture wrote them (the evidence gate, read from each log's header;
`shared/claude-md-contract.md`, the `remediate.mjs` row).

`git diff` and `git log` are reachable **only** through `capture.mjs`, never as a direct shell
grant. Permission rules are prefix matches with an open tail, so `Bash(git diff:*)` would hand a
lens the command's whole flag surface — `--no-index` (reads any path the operator can read;
demonstrated live, teeing files from `C:\Windows` into a run's evidence), `--output=` (writes any
path, defeating the Edit/Write denies), and `--ext-diff`/`--textconv`/`-O` (launch a program). A
deny rule cannot close that, because deny rules are prefix matches too: `git diff HEAD --no-index`
escapes a deny written for `git diff --no-index`. Only a check that scans *every* token can catch a
flag in an arbitrary position, and that is what `capture.mjs` does.

**And scanning tokens is still not enough on its own.** git's parse-options *bundles* short flags,
so `-nOcat` is `-n -O cat`, and a deny-list matching whole tokens never sees the `-O`. That was
demonstrated live against this repository: the command exited 0 and wrote a file from outside the
repo into the run's own evidence directory, and because git runs its pager through a shell the
primitive was arbitrary command execution rather than launching a named program. `lib/forbidden-
tail.mjs` therefore decomposes short-flag clusters character by character. Long options are
matched BY NAME in both directions — an abbreviation git would expand to a forbidden option, and an
extension of one — because git's parse-options accepts any unambiguous prefix: `--op` reaches
`--open-files-in-pager`, and an exact match on the full spelling let it through to a shell. The moral is narrow and worth keeping: moving a capability behind a
guard is only as good as the guard, and the argument that justified moving `git diff` here — "a
token scan beats a prefix match" — was true of permission rules and false of this guard as written.

The node loses nothing — a diff
worth reading is a diff worth citing. `git status`, `git rev-parse` and `git ls-files` remain direct
grants.

What `capture.mjs` refuses in the tail of a read-only git command that is not an exact declared command (an argv that
exactly matches a declared command is the contract's, admitted as written; `scripts/lib/capture-admit.mjs`)
(`scripts/lib/forbidden-tail.mjs` is the one list):
a flag that writes a file (`--output`), one that launches a program (`--open-files-in-pager`, `-O`, `--ext-diff`,
`--textconv`, the transport overrides), and one that reads a file at any path, in every subcommand (`--no-index`,
`--contents`, `--ignore-revs-file`, `--exclude-from`) or in the one subcommand that reads with it (`git grep -f`/`--file`,
`git blame -S`, `git ls-files -X`). Short flags are checked inside a bundle and long ones by any abbreviation git would
accept. The direct `git ls-files` grant does not pass through this check, so `-X`/`--exclude-from` stays open there; it
reads that file as ignore patterns and does not print it.

`capture.mjs` tees the command's output into `evidence/<node-id>/<slug>.log`, exits with the
child's exit code, and prints the canonical relative path back on stdout. **Cite the path it
printed.** A path you did not see printed is a fabrication, and the spawner rejects the
finding that carries it (§7).

**The log is BOUNDED, and says so when it bounds.** Above 1 MiB, `capture` keeps the first quarter
and the last three quarters of that budget and writes `[TRUNCATED — <n> bytes produced; first <h>
and last <t> kept, <d> dropped from the middle]` where the missing bytes were. Head *and* tail,
because for a declared build or test suite the diagnosis is at the end — which test failed, the
error list, the counts — and head-only evidence stopped mid-run. This paragraph used to say the log
holds the command's output full stop (G-43); a reader citing a line "from the log" needs to know a
middle can be missing, and that its absence is stated rather than silent.

Rules:

1. Paths in a verdict are **relative to the run directory** and always begin `evidence/`.
   Absolute paths and `../` are rejected.
2. A node may only cite evidence under its own `evidence/<its own node-id>/`. Citing another
   node's evidence is how corroboration gets faked; it is rejected.
3. Reading a file is not evidence — it is a reference. A finding about a line of code cites
   the `file` and `line` fields. `evidence_path` is for *output that was produced*: a
   compiler diagnostic, a failing test, a benchmark number, a captured screenshot.
4. **Evidence is local and impermanent.** `.claude/reviews/*/evidence/` is gitignored, on
   purpose — it is large and machine-specific. This means a committed report's evidence
   paths dangle for anyone who did not run it. That is accepted and stated here so nobody
   discovers it during an audit: the durable trail is `status.json` plus `report_sha256`.
   Evidence validation is a local, at-review-time check.

---

## §4 Findings: required shape and the `basis` field

A finding is an object. It is not a sentence.

Required on every finding: `severity` (§2), `basis` (below), `file`, `line`, `claim`,
`evidence_path` (§3). Optional: `invariant` (§6), `intent_ref` (§5).

**A finding without a file and a line is not a finding.** If you cannot point at it, you
have not found it — you have suspected it, and suspicions go in `not_checked[]` with a
reason, or in `out_of_scope_observations[]`.

The `claim` states what is wrong, why it is wrong, and what it causes. Three clauses, not
one. "This is fragile" is not a claim; "the `?` on line 142 discards the parse error, so a
malformed config silently produces defaults and the user sees no diagnostic" is.

### `basis` — what kind of authority the finding rests on

| `basis` | The finding is true because… |
|---|---|
| `intent` | it violates a numbered criterion in `intent.md`. Requires `intent_ref`. |
| `architecture_doc` | it violates the declared architecture document. Cite the section inside `claim`. |
| `invariant` | it violates a standing invariant from §6. Requires `invariant`. |
| `measurement` | a captured measurement demonstrates it. Requires an `evidence_path` containing that measurement. A lens whose *only* permitted basis is `measurement` and which produced no findings and no `checked_clean` entries **measured nothing, and may not report a verdict at all** — it is `DEGRADED`, and if the artifact could not be exercised (no run command, no write area, capture denied) that inability is the finding, named in `not_checked[]`. Enforced in the validator, not asked for in the skill: a node cannot be trusted to disqualify its own output, and an empty `PASS` from a verifier reads at the gate exactly like a feature that was verified and worked. |
| `convention` | it departs from an observed convention in this codebase. The weakest basis; cannot exceed `MEDIUM`. |

**Each lens is launched with a restricted `basis` enum, enforced in its schema.** This is
what keeps lenses from collapsing into one another. `contract-audit` may only reason from
`intent` and `invariant`; `code-audit` only from `invariant` and `convention`;
`feature-verify` only from `measurement`. A lens that wants to make a different kind of
argument is, by construction, the wrong lens for that argument — hand it off and say so in
`out_of_scope_observations[]`.

### The `contract-audit` / `code-audit` split

Without a mechanical separator these two duplicate each other and the reconciler double-counts.

- **`contract-audit` findings must carry an `intent_ref`** (`I-n`, resolving to a real bullet
  in `intent.md`). One that does not is dropped.
- **`code-audit` is not given the intent path and may not emit `intent_ref` at all.** The key
  is deleted from its schema, so the emission is impossible rather than merely forbidden.

This is enforced twice, in two different layers, and the redundancy is deliberate: the
schema stops a model from *emitting* the wrong shape, and the spawner's validator stops the
system from *trusting* content a schema cannot judge — whether the file exists, whether the
sha matches, whether `I-7` is a real criterion.

### Test code is reviewed under one question, and that is what stops the recursion

A file matching `test_globs` is **test code**, even when it also matches `source_globs`.
`test_globs` wins.

Test code is reviewed under exactly one question: *does this test actually constrain the behaviour
it claims to?* Admissible findings are that it passes vacuously or tautologically, asserts nothing,
cannot fail for the reason it was written, is flaky, or silently skips. Style, structure,
duplication, naming, coverage gaps and refactoring suggestions are **not** admissible on a test
file.

The reason is structural, not stylistic. Once every bug produces a regression test, and a test is
itself code, reviewing tests the way production code is reviewed makes the loop non-terminating:
finding → test → finding → test. Capping the depth arbitrarily would leave real bugs uncovered,
which is the wrong end to compromise on.

The loop terminates because **a test's correctness is settled by an experiment, not by a review.**
A regression test is verified by failing before the fix and passing after — red-before-green is a
decision procedure, it runs in milliseconds, it needs no model, and it catches the entire class of
defects a test can plausibly have: vacuous, tautological, or aimed at the wrong behaviour all fail
to go red for the right reason.

So the recursion has depth one. Production code needs judgment — *is this what was asked for, is
the boundary right* — and judgment is what a review supplies. A test needs a demonstration, and the
demonstration is cheaper than the review that would replace it. There is no level-2 artifact,
because "the test that tests the test" is the red-green transition itself.

Two things this does **not** solve, and both are bounded backlogs rather than recursions:

1. **Bugs fixed before the discipline existed have no tests.** That is a finite list, and writing
   them requires reconstructing each broken state.
2. **Some bugs are expensive to reproduce** — those needing a killed subprocess, a real interrupt,
   a full run. Where a unit test pins only the pure decision, say so at the fix, and count the
   integration path as uncovered rather than as covered.

---

## §5 Intent: Rule 2, and who may cite it

`intent.md` states what was *supposed* to be built, written before the implementation is
read. It is produced by `intent-capture`, which runs with the source tree unreachable. A
criterion it cannot determine goes under `## Assumed contract (UNVERIFIED)`. **An honest gap is
the correct output; it is never grounds to widen the sandbox.**

### The criteria are pinned to their inputs, because a moving bar cannot verify anything

Deriving the criteria is a model call, so it is not deterministic: three consecutive runs over the
*same* documents produced 56, then 49, then 38 criteria. A bar that is re-drawn every run makes two
runs of identical code incomparable — a `contract-audit` `FAIL` can become `PASS` because the
criteria changed rather than the code — which is fatal for a loop whose whole job is to check
whether a fix landed.

So `intent.md` is **derived once per distinct set of inputs and reused**. The key is a hash of
exactly what intent-capture reads: the declared `doc_paths` and `doc_roles` documents, the request,
and intent-capture's own `PROMPT.md`. Change any of them and the hash moves and the criteria are
derived again; change none and the run reuses them, stamped `INTENT-PINNED` with
`intent_reused_from` naming the run that derived them. Run artifacts under `reviews_dir` are
excluded by construction — they change on every run, and counting them would silently degrade
pinning back into drift.

This is not a speed optimisation (though it does save the intent node's wall time). It is what makes
the yardstick hold still long enough to measure against. The residual is named rather than hidden:
the hash covers documents, request and skill — not the model or framework version that rendered the
criteria. `--fresh-intent` forces re-derivation when a pinned intent is suspect.

### How the sandbox is actually enforced — read this before changing any policy file

**`--add-dir` alone does NOT confine a node.** This was verified empirically and it is the
opposite of what it looks like: an unscoped tool rule in the settings file *outranks* the
directory sandbox. An intent node whose policy allowed a bare `Read` read straight through into
the source tree with **no denial recorded at all**, while the same node, same `--add-dir`, under
path-scoped rules was denied and the denial appeared in the result envelope.

**And a path-scoped `Read` rule granted nothing on Windows.** The intent node was once confined by
`Read(//abs/path/**)` rules plus `--add-dir` on the live doc directories. The canary's first live
run saw `Read(/F:\…\CLAUDE.md)` in the policy, the file present, and the read denied, and recorded
it as "a path-scoped rule does not grant a read outside `--add-dir`". The live grant probe
(`check-intent-grant.mjs`, contract-glob-grammar stage 2b) found the actual cause: that rendering
is not the runtime's absolute form, so the rules granted nothing anywhere — and `--add-dir` on a
live doc directory granted everything beneath it, whatever the glob said. Two readers of one glob,
the runtime's and quorate's, and they disagreed.

So the intent node is given **no `Read` grant and no live directory**. `run-graph` builds a sandbox
of COPIES — `declared-docs/` beside the brief, holding exactly the documents each `doc_paths` glob
matches and the documents named under `doc_roles` (`io/doc-snapshot.mjs`'s `snapshotIntentDocs`, one
owner for run-graph, the canary and the probe), the request through its own frozen-hash copy, and this
doctrine; plus `contract.snapshot.md`. A glob with no directory before its first wildcard (`*.md`, `**/*.md`) is not
walked, because its base would be the whole repository: it is skipped and the skip recorded in the run's not-checked
list — and the sandbox is the node's working directory and its only
`--add-dir`. One reader decides what the node sees, on every platform. Review run directories, in
staging and in the repository, are never copied.

Three things together make Rule 2 real, and removing any one of them silently voids it:

1. **No `Read` grant, and a sandbox of copies.** `intent-settings.json` allows only the runtime's
   name-listing tools; the node reads what is in its working directory, which holds copies and
   nothing else. Never a bare `Read`, and never a live directory: either one reaches the source.
2. **`Grep` denied.** Grep returns file *content*, so a Grep allowed beyond the sandbox is a hole
   straight through it. `Glob` stays allowed: it returns names only, and a node that cannot
   enumerate the declared docs cannot do its job.
3. **EVERY shell tool denied** — on this platform that is `Bash` *and* `PowerShell`, and on any
   runtime it is whatever that runtime's adapter lists under `node_runtime.tools.deny_intent` —
   and `--add-dir` narrowed to the sandbox, with the spawner refusing to launch an intent node
   given the repo root or any ancestor of a source directory.

   This clause said "`Bash` denied" alone for months, and so did the code: `PowerShell` was absent
   from all three of the deny lists (G-28), which shipped an intent sandbox with a working shell on
   the platform this project runs on. The code was fixed first and this list was not, which left
   the single source of truth for Rule 2 describing a sandbox one hole wider than the one the
   engine builds — and a maintainer trimming the deny list to match the doctrine would have
   reopened it. The rule is the PROPERTY (no shell), never an enumeration of one runtime's tool
   names; the adapter answers with the names.

`CLAUDE.md` cannot be passed to `--add-dir` — the CLI rejects file paths. Following its own
suggestion to "add the parent directory" would hand the node the entire repo and destroy this
sandbox, so `new-run.mjs` snapshots the file into the run directory as `contract.snapshot.md`
instead.

**A sandbox that is never tested is a sandbox that does not work.** Verify enforcement by
spawning an intent-mode node that deliberately attempts a source read, and asserting the denial
appears in `permission_denials[]`. A run in which the node simply never tried proves only that
the policy is *configured*, not that it is *effective*.

`new-run.mjs` does this at mint, as the second arm-pair of gate 4, and writes `intent-canary.json`.
For a while it did not (G-62): gate 4 probed `node-settings.json` — the permissive policy — while
`intent-settings.json`, the file this section calls Rule 2's enforcement point, was written,
structurally validated and never exercised. Proven well-formed is not proven applied, and that gap
is the entire reason gate 4 exists for the other file.

Two arms, for the same reason as the other pair. NEGATIVE: read a source file outside `doc_paths` —
it must not come back. The check is whether A LINE OF THAT FILE appears in the answer, not whether
the model said "denied": a refusal is prose that varies, while quoting a line is something only a
reader of the file can do. POSITIVE: read a declared document from the sandbox the canary builds
through the same owner — the first copy, or `contract.snapshot.md` when the contract declares no
document — without it, a policy dropped entirely produces a denial for everything and looks exactly
like a working sandbox.

Criteria are numbered `I-1`, `I-2`, … and are referenced by that id forever after.

Once the first lens launches, `intent.md` is **frozen**. Its sha256 is recorded as
`run.json.intent_sha256`, every node echoes that value back in its verdict, and `reconcile`
fails the run if the file on disk no longer hashes to it. A run whose criteria moved
mid-flight has measured nothing.

**The sha is WITHHELD from a node that may not read the file, and that is the whole detector.**
A node briefed `intent: forbidden` is given `intent_sha256: (withheld)` and must echo the empty
string. Because it was never handed the value, a verdict coming back carrying the real sha is proof
the node opened a file it was told not to open — there is nowhere else it could have got it.

This paragraph used to say the opposite ("still receives `intent_sha256` in its brief and echoes the
value it was handed") in the same breath as the empty-string rule, which is both self-contradictory
and self-defeating: a node holding the sha can echo it without ever reading anything, and the
detector detects nothing. The code was right and the doctrine was wrong (G-33).

**Intent governs contract findings only.** Taken literally, "judge against intent, not the
implementation" would pass a leaked credential or a data-loss path that intent never
mentioned. It does not. See §6.

---

## §6 Non-waivable invariants

Any lens may raise these regardless of scope, regardless of intent, and **no `intent.md` can
waive them**. No ceiling caps them either: a degraded lens's §6 invariant finding keeps its severity and the verdict it
drives (§7, "Degraded lenses"). They are the standing floor beneath every run.

| `invariant` | Covers |
|---|---|
| `data_loss` | Destroying or corrupting user data; unrecoverable writes; truncation on error. |
| `credential_exposure` | Secrets in source, logs, telemetry, error messages, or artifacts. |
| `memory_unsafety` | UB, use-after-free, data race, unchecked `unsafe`, unsound `Send`/`Sync`. |
| `crash_on_valid_input` | Panic, abort, or hang on input the contract says is legal. |
| `unbounded_resource_growth` | Leaks; unbounded queues, caches, or recursion; no backpressure. |
| `silent_error_swallowing` | An error path that discards the error and continues as if it succeeded. |

A finding with `basis: invariant` must name which one. These are the only findings that may
be raised entirely outside a lens's declared scope, and they still require a `file`, a
`line`, and an `evidence_path` like anything else — being important does not exempt a claim
from being checkable.

---

## §7 Degradation policy, node states, and gate ceilings

### Node states

Written by the spawner into `nodes/<node-id>.status.json`. State describes the *node*;
verdict describes the *code*.

| State | Set when |
|---|---|
| `RUNNING` | Written before the child is spawned. Surviving to reconcile means the orchestrator died — treated as `BLOCKED`. |
| `OK` | Exit 0, output parsed, schema valid, envelope checks passed. Any verdict, including `FAIL`. |
| `DEGRADED` | Exit 0, but the node did not deliver a usable verdict: unparseable output, missing structured output, schema violation, run-id/node-id/intent-sha mismatch, or more than half its findings rejected. **The lens claimed it finished and did not.** |
| `BLOCKED` | Spawn failed, non-zero exit, killed by signal, timed out, interrupted (the run was stopped), empty output, or aborted before launch on budget. A child not seen to exit after its stop is named in the status as `orphan_pid` — never as stopped — with `kill_refused` (the platform would not kill it, and it is still there) or `kill_unconfirmed` (it was not seen to exit after its stop, and may still be running); ARCHITECTURE A-25 owns these definitions. |
| `SKIPPED` | Never launched, by design: a condition was unmet or the skill is not installed. Carries `skip_reason`. |

**`reconcile` enumerates status files, never reports.** A `*-report.md` with no corresponding
`OK` status is ignored and logged as an orphan — a model writing a report the system then
trusts is precisely the failure this design exists to prevent. Anything not `OK` lands in a
**"Lens did not report"** bucket; `SKIPPED` lands in a separate **"Not checked"** bucket.

**A run with any non-`OK` required node cannot emit `PASS`.** The gate reads `BLOCKED` — not
`FAIL`, which would assert something about the code, and not `PASS`. **Silence is not a
verdict.**

**The adversarial audit is covered too, and more weakly.** `second-opinion` is the third aux node
outside `expected`, so its failure was invisible in the same way: a `DEGRADED`, killed or stubbed
audit appeared in no bucket and no gate row, and the gate stayed free to emit `PASS`. When it was
expected to run — the panel not skipped, the skill installed, a `reconciled.md` to audit — and did
not report `OK`, the gate is capped at `RISK` and the node is named in the did-not-report bucket.
`RISK` and not `BLOCKED` deliberately: the findings *were* adjudicated, so what is missing is the
check ON that adjudication, which makes `PASS` an overstatement rather than a verdict resting on
nothing. Skipping via `--skip-panel`, or having no `reconciled.md` to audit, are legitimate and are
not silence — a ceiling that fires on a non-problem teaches readers to ignore ceilings.

**The barrier is covered by that rule too, and needs saying separately.** `reconcile` lives in the
roster's `barrier_nodes`, not its `lenses`, so it is never in the required-node set and the check
above structurally cannot see it. A barrier that timed out, exhausted its budget, or returned
unparseable output leaves **its groups unadjudicated** — every group, or, on a barrier batched past 80
groups, those of every batch from the one that failed onward (earlier batches' rulings are kept) — and the
gate would otherwise compute from
lens verdicts alone, up to `PASS`, at the one node whose silence is least visible. So: **when there
were findings to adjudicate and the reconcile skill is installed, a reconciler that did not report
`OK` forces `BLOCKED`**, and `reconcile` is named in the run's "did not report" bucket with the
number of groups left unjudged. Having no findings to adjudicate is a legitimate `SKIPPED`, not
silence — the distinction is groups-to-judge, not the node's mere absence. This was a real defect:
`reconcile_state` was written into `gate.json` and read by no branch of the verdict.

**Batched reconcile.** This document owns the rule; ARCHITECTURE.md points here, and the code that applies it is
`scripts/lib/reconcile-batches.mjs`. Past the 80 groups one reply can carry, the ONE reconcile node judges the groups
in batches, in turn, each file's groups kept together (a file with more than 80 is split, and the run's
`not_checked[]` names it). Each batch's reply is checked against its own groups: a row for a group outside the batch,
and a second row for a group, are dropped, and every group the reply missed is named in `not_checked[]` under its
batch and recorded on that batch's status. Gaps are named, never fatal (the operator's G-16 decision). On every
barrier, batched or not, the groups an `OK` reply left out are asked again once, alone, as the reconcile prompt's own
node, `reconcile-reask`, through the same batch loop: the re-ask goes in batches packed as the barrier's are, each
file's groups together and at most 80 to a batch, with the barrier's remaining time and budget, each reply validated
and its links checked against itself. Its brief, status and payload are its own, and it writes no report, as no reconcile
node does, so the first reply's brief is never written by it; the first reply's status gains only the `reask` record below,
and its payload is replaced only by the merged payload below; the re-ask's status is aggregated over its batches, as a
batched barrier's is, its report fields those of the last batch whose reply was used, so null. When it judged
a group, the merged payload is written once, the first reply's rows and its own; a group it also misses is named as
above. The re-ask is once per run: the reconcile status records it as `reask`, a list of attempts (one), each naming
the node and carrying its status's totals and report hash, null for a reconcile node, which `gate.json`'s `reconcile_reask` and the gate read
(`reconcile-reask-shape.plan.md`, `reconcile-reask-record.plan.md`). When the barrier's time or budget is already used
up, the re-ask is not launched: its state is `NOT-LAUNCHED`, or the node's own state when a spawn was refused, and its
attempt carries the same fields, from the node's status when a spawn was refused (its validator errors with them) and
empty otherwise, the gate says the groups were not re-asked and why, and
they stay named as unjudged (`reconcile-missing-groups.plan.md`: the reconcile
node read every group and returned no row for some, in four archived runs). A re-ask whose time or budget ran out after a
batch had run is `BLOCKED`, as the barrier is, and its record counts in `batches` the batches launched, beside
`batches_planned`. `run-graph --resume` on a finished run
whose reply left groups out does the re-ask alone, re-running no lens, arm or whole reconcile, and renders
`reconciled.md` again only when the re-ask judged a group, which is also when second-opinion runs again. A `--resume` of a
run that already re-asked does not ask again: it reports the recorded attempt. On every
barrier, batched or not, a root-cause link must name a group the same reply judged; a link that does not is cleared
and named. A fresh reconcile first clears every artifact in `RECONCILE_ARTIFACTS`, so a resumed run never reuses a
mix of attempts. The batches share one barrier budget and time: each is granted, of the budget still unspent and the
time still left, the fraction its groups are of the groups left (so an 80-group batch beside a 2-group one gets 80/82,
not half), but never less than a floor -- the smaller of 5 minutes and an even share per batch left -- so a 2-group
batch AHEAD of a large one is not given a sliver it cannot start in, and a hung small batch can take at most the
floor from the batches after it. The budget follows the same fraction as the time. A batch is charged its cost when
known, nothing when it never launched, and its whole grant when it launched and its cost is unknown. A batch that
returns no reply has all its groups named as missing, under that batch. Before any of it, the
run budget admits the barrier, and `--reconcile-twice`'s calibration on top of it, through the same rule the fan-out
uses; the calibration is never run on a batched barrier.

### Missing contract keys

A missing individual key means that check is **skipped and named verbatim** in
`not_checked[]`; the run still passes on what remains. Missing the entire `graph_contract`
block means `full-review` exits `BLOCKED` exactly once, prints the block pre-filled with
what it could detect, and spawns nothing.

**Nodes never discover the environment.** Everything a node needs is in its brief. A lens
that goes looking for the build command is burning tokens to re-derive a declared fact.

### Degraded lenses

A lens runs **degraded** when the input it judges against is missing: `arch-review` with no `doc_roles.architecture`,
`perf-audit` with no `commands.bench` (`UNBENCHED`), and `contract-audit` against an inferred request
(`REQUEST-INFERRED`). Each is capped, and each cap keeps the one exception this section owns — the validator applies
it (`capVerdictKeepingInvariants`, `lib/decisions.mjs`), so a document restating the cap without it is wrong:

<!-- rule:degraded-cap subject="A degraded `arch-review`" verdict_ceiling="RISK" severity_ceiling="MEDIUM" -->
A degraded `arch-review`: its verdict is capped at `RISK` and its findings at `MEDIUM` — except a §6 invariant finding, which is never capped and keeps the verdict it drives.
<!-- /rule:degraded-cap -->
<!-- rule:degraded-cap subject="An `UNBENCHED` `perf-audit`" verdict_ceiling="RISK" severity_ceiling="LOW" -->
An `UNBENCHED` `perf-audit`: its verdict is capped at `RISK` and its findings at `LOW` — except a §6 invariant finding, which is never capped and keeps the verdict it drives.
<!-- /rule:degraded-cap -->
<!-- rule:degraded-cap subject="`contract-audit` against an inferred request" verdict_ceiling="RISK" severity_ceiling="MEDIUM" -->
`contract-audit` against an inferred request: its verdict is capped at `RISK` and its findings at `MEDIUM` — except a §6 invariant finding, which is never capped and keeps the verdict it drives.
<!-- /rule:degraded-cap -->

### Gate ceilings

| Stamp | Cause | Effect |
|---|---|---|
| `UNBUILT` | `commands.build` empty, or the pre-flight barrier could not run it | gate capped at `RISK` |
| `UNTESTED` | `commands.test` empty | gate capped at `RISK` |
| `CHECKS-SKIPPED` | the pre-flight barrier was skipped by request (`--preflight never`, or its alias `--skip-preflight`) | caps at `RISK`, and every DECLARED command is named individually in `not_checked[]`. Distinct from `UNBUILT`/`UNTESTED`, which fire only when a command is EMPTY IN THE CONTRACT: these commands exist and were not executed. The stamp is the whole point of the row -- the flag previously omitted the barrier and stamped nothing, so a gate went out silent about declared `build` and `test` having produced no result at all, which is silence standing in for a verdict |
| `PANEL-DEGRADED` | an arm or judge whose combination `run.json.reviewer_preflight` records as passed did not answer during the run (timed out, unreadable, or refused at call time when its record aged out and the re-probe failed) | caps at `RISK`, and the gate names each such call in `not_checked[]`. A run with no `reviewer_preflight` (minted before it existed, or the panel off) or with `"skipped"` gets none from this rule |
| `REVIEWERS-UNVERIFIED` | the mint skipped the reviewer preflight by request (`new-run --no-verify-reviewers`); `run.json.reviewer_preflight` reads `"skipped"` | caps at `RISK`. Without it, new-run checks every panel arm and adjudicator combination before the run exists and refuses the mint on a failure (`shared/external-reviewers.md`). Each call is still probed before it is made, so a reviewer that answered had passed its probe; what a run carrying this stamp lacks is the guarantee that its whole panel worked before it began, and a reviewer refused during it is named in `not_checked[]` rather than stamped `PANEL-DEGRADED` (nothing was promised at mint) |
| `CHECKS-REUSED` | the pre-flight result was REUSED: the files the declared checks read (git's list under the declared globs: tracked plus untracked-not-ignored, a walked file under a submodule included) hash identically to an earlier run's; with the set INFERRED, or not listed by git, the worktree is also clean | none -- `PASS` permitted. `run.json.checks_reused_from` and the gate's Pre-flight row name the run that produced the evidence, which is the thread to pull if a captured log looks wrong for the code in front of you. A changed input invalidates the entry. For a DECLARED set listed by git the hash alone decides: it reads every input's content, so a dirty file outside the set is not something the checks read (operator, 2026-10-12: "Hash decides when declared (Recommended)"; `preflight-reuse-by-hash.md`). For an INFERRED set, or one git could not list, a dirty worktree also invalidates it regardless of what moved: there the set is a guess, and that rule is what keeps caching the barrier class (`build`) safe rather than reckless |
| `CHECKS-INPUTS-INFERRED` | a result was reused, and `review.preflight_inputs` is empty so the input set was INFERRED from `source_globs`, `test_globs`, the contract file and any root-level dependency manifest | caps at `RISK` and is named in `not_checked[]`. A declared check can read a file none of those name -- `uv run pytest` behaves differently after `uv.lock` moves, and a `source_globs` of `["src/storypipe/**"]` excludes it -- so the freshness claim rests on a guess. Compare `INTENT-PINNED` directly above, which is NOT capped and whose consequence gives the reason in four words: *the inputs are provably unchanged*. That sentence covers a declared input set and refuses to stretch over an inferred one. Declaring `review.preflight_inputs` removes the ceiling |
| `TESTS-THIN` | fewer than 5 tests reported **and the runner's output was recognised** | the stamp and its consequence are stated in every lens brief: a finding may not cite test coverage as mitigation in this run, because the suite is too thin to carry that weight. **Enforced by briefing, not by the validator** — see the enforcement table in §7. Nothing mechanical can tell "the tests cover this" from any other sentence a lens writes (G-46) |
| `SKILLS-SHADOWED` | the consuming project ships skills whose names collide with the framework's, or a legacy `.claude/skills/shared` / `.claude/skills/scripts` engine directory on the doctrine-probe path | none on its own — nodes are spawned with `--inline-skill`, so the framework's own SKILL.md text reaches the model regardless. Recorded because that is an *ordering that happens to hold*, not a boundary, and a run that silently applied an older lens's criteria while reporting this one's would be very hard to notice. For any project quorate descends from, a shared ancestor is the likely case, not the edge case |
| `CONSUMER-LENS` | the project declared one or more lenses of its own in `graph_contract.lenses`, instructed by files in the tree under review rather than by this framework | the findings are COVERAGE, not authority: basis `convention` only, verdict capped at `RISK`, never `required`, and structurally unable to raise a §6 invariant because the basis list becomes the envelope schema enum. Identical treatment to an external arm, for the identical reason — quorate cannot verify the evidence discipline of instructions it did not write. Recorded because an unrecorded participant in a verdict is the defect this protocol exists to prevent |
| `TESTS-FAILING` | the declared `commands.test` RAN — reporting a countable number of tests — and returned non-zero; or it printed a failing count (`countFailures`, `lib/test-count.mjs`) however it ended, exit 0 included (G-25 of `20261020-094311-ciss-delivery`) | **gate `FAIL`, unconditionally.** The strongest effect any stamp has, and the table omitted it (G-38): a red test is deterministic, reproducible, and its failure mode is uncorrelated with any model's, so it FORCES the verdict rather than capping it. Without this the regression suite would be decorative — a resurfaced bug turns a test red and changes nothing anyone reads. The word RAN is load-bearing: see `TESTS-DID-NOT-RUN` |
| `TESTS-DID-NOT-RUN` | the test command returned non-zero having reported an EXPLICIT ZERO tests — a collection error, a failed import, a missing dependency, or a runner that never started, in a format the counter could read — or its capture's outcome is `could-not-start` (a spawn error, or no log; `check-outcomes.plan.md`) with no failing count | caps like `UNTESTED` and is named in `not_checked[]`. It does NOT force the gate, and the distinction is not pedantry: it was one case until the first real consumer run, where pytest exited 2 with `ModuleNotFoundError: No module named 'storypipe'` and 224 collection errors. Zero tests executed, and the gate reported `FAIL` — telling a project its code was broken when no test had examined it, while every node was instructed to report "anything the failures conceal" about failures that did not exist |
| `CONTRACT-STALE` | the project's `graph_contract:` version is LOWER than the version this engine implements | caps and is named in `not_checked[]`; the run proceeds. It is the one staleness nothing else can detect: `check-install` compares key PRESENCE, and the key-ratchet catches a key ADDED and forgotten — but a key whose spelling never changed and whose MEANING did is byte-identical in the consumer's file before and after the upgrade. It has happened: `budget_usd_per_node: ""` once meant a `$0` cap that blocked every node and now means uncapped. Stamped rather than refused, because breaking every consumer on a version bump punishes them for the upgrade they were told to perform, while silence is the defect being removed. A version ABOVE the engine's is fatal instead — a contract written for a newer engine may rely on meanings this one does not have |
| `TESTS-TIMED-OUT` | `capture.mjs` KILLED the test command at its own deadline — it started and did not finish | caps and is named in `not_checked[]`; does not force the gate. Ranked above `TESTS-OUTCOME-UNKNOWN` because it is strictly more specific, and below `TESTS-FAILING` because a suite that printed failures and was *then* killed still failed — a printed FAILING count, not the total. This is the engine's own fact about its own action, which is why it can be reported at all when a runner's exit vocabulary cannot be: `capture` chose the deadline and sent the signal. It was absent (G-48), so a consumer suite slower than capture's ten-minute default — which is ordinary — was stamped `TESTS-DID-NOT-RUN` and the operator was told to check their install when the instruction they needed was to size the timeout. The flag comes from `spawnSync`'s `ETIMEDOUT`, not from exit 124: capture maps every null status to 124, including a spawn failure and a 64 MiB output overflow |
| `TESTS-OUTCOME-UNKNOWN` | the test command returned non-zero and its output matched no known summary format, or it was stopped before it finished (a signal, or an output overflow: `incomplete`, `check-outcomes.plan.md`) without printing a failing count, so whether anything ran is UNKNOWN. A count of tests that all passed before it was stopped is not a failure: only a printed failing count (`countFailures`, `lib/test-count.mjs`) makes an unfinished suite `TESTS-FAILING` (G-3 of `20261018-035437-co-delivery`) | caps and is named in `not_checked[]`; asserts nothing in either direction. This row exists because the one above it originally covered this case too, on the premise that "a suite that ran and failed reports a count; one that could not be collected reports none" (G-32). That premise holds only for runners `lib/test-count.mjs` recognises — cargo, `node:test`, pytest. A red jest, vitest, mocha or go suite reports a count nothing here parses, so it was classified as never having run and **lost the forced `FAIL`, which is the one verdict that outranks every lens.** `countTests` states the governing rule in its own docstring — *unknown must mean unknown* — and the sibling `TESTS-UNCOUNTED` row below already applies it. The discriminator stays runner-independent, which is what must not be traded away to fix this: a count is evidence it ran, an explicit zero is evidence it did not, and null is the absence of evidence either way |
| `PANEL-NO-SAFE-SURFACE` | the arms' directory could not be built safely — the working state over `review.panel_snapshot_max_mb`, a snapshot that could not be taken, a finished directory holding a link, or an incomplete framework | none on its own; `PASS` permitted. No external reviewer ran: every arm is recorded `SKIPPED` and no dispute was adjudicated. The repository root is never handed over instead — there is no fallback (arms-read-surface; §3 owns the reasoning) |
| `TESTS-UNCOUNTED` | the test command ran, but its output matched no known summary format | the count is unknown, so `TESTS-THIN` does NOT fire — an unrecognised runner must not be stamped as an empty suite. Recorded so the gap is visible: a reader learns the suite's weight was never established, rather than being told it is thin. Adding a format to `lib/test-count.mjs` is the fix; guessing from a loose pattern is not, because a regex broad enough to catch every runner also catches prose in a failure message and inflates the count |
| `FMT-DIRTY` | `commands.fmt_check` ran and failed (outcome `failed`, `check-outcomes.plan.md`) — except on a remediation's commit candidate when it passed in the run's `fmt_baseline`, taken before the node ran: that refuses the candidate (`full-run-red`) instead of stamping. An `fmt_check` that did not run to its own end (timed out, stopped, could not start) never stamps it: a review names it in `not_checked[]`, a remediation records it under `full_checks[].unfinished` when it does not refuse — where it passed in `fmt_baseline`, an unfinished candidate refuses as `full-run-red` instead | recorded, and named in every lens brief with its consequence: formatting findings are inadmissible in this run because the result is already known. **Enforced by briefing, not by the validator** — see below |
| `UNBENCHED` | `commands.bench` empty | `perf-audit` is static-risk-only: its findings are capped at severity `LOW` and its verdict at `RISK` — except a §6 invariant, which is never capped |
| `UNSWEPT-DIFF` | scope was human-asserted rather than derived from a diff | `PASS` permitted, but the gate prints scope provenance |
| `ROUND-CAP` | a remediation run: three consecutive remediations drew a new MEDIUM in their own fixes (shared/remediation.md) | no gate; nothing is spawned, and the next step is a design step |
| `ROUND-CAP-REACHED` | the remediation whose own fixes drew the third consecutive MEDIUM; stamped when the next remediation found the cap | no gate; this run did spawn and patch — its fixes are the round that reached the cap |
| `CHAIN-BROKEN` | a remediation run works from a review that is not the follow-up the previous remediation minted | no gate; the round count restarts here, visibly |
| `CHAIN-UNKNOWN` | a remediation run could not read its chain, or establish a link's MEDIUMs | no gate; nothing is spawned until the chain is repaired or the operator decides |
| `REPORT-CHECK` | a remediation report left a confirmed group unanswered, named another run, or cited evidence that does not exist | no gate; the run's `report_check` names each, and the follow-up review should treat them as unremediated. Evidence that is cited but not a red-before-green pair also refuses the group at admission (`evidence-refused` under `COMMIT-CHECK`), and a group with no red and no `no_red` declaration refuses its cluster, with a test or without (`refused-cluster`; a symptom shown by its root's red is not such a group), so neither is committed |
| `COMMIT-CHECK` | the runner did not commit as reported: the node did not finish `OK`, its report was missing or named another run, a group was not confirmed in the reviewed run (`unconfirmed-group`; a symptom whose root is confirmed is judged as its root, and refused when that root is not reported), was deferred by the operator (`deferred-group`), was reported not fixed (`not-committable`), had no admissible red-before-green on disk (`evidence-refused`), or shares a file or cluster with such a group, or is a symptom whose root is such a group (`shared-with-refused`), a scoped run could not read where the deferred findings are (`deferred-file-unchecked`), a cluster had a refused file, no source file (unless every group in it was reported against a test file), a reported test not found, or a group with no red and no `no_red` declaration, with a test file or without, a symptom shown by its root's red excepted ("red-before-green skipped", `refused-cluster`), the runner's check of the commit candidate refused it (`full-run-red`) or the tree held more than the candidate or moved after the check (`tree-not-candidate`), git or a hook rejected the commit, a committed file differs from what was checked or its committed state could not be read (`committed-differs`), a commit landed whose sha could not be read (`commit-unrecorded`), a path the node's run changed — a submodule or nested repository included — is committed by no cluster and left in the working tree (`left-in-tree`), or a commit was made during the node's run; or it committed a cluster with no test because every group in it declared no possible red in `no_red` (`committed-without-test`), or the bytes of a refused cluster it set aside for the full check could not be written back as they were set aside, mode included (`set-aside-unrestored`; the definition is `shared/claude-md-contract.md`'s; the run stops with the copies kept). A `merged` entry is recorded and does not stamp: a clean merge is not a failure; nor does a `deferred-file` note, nor a `declared-no-red` entry (a committed fix the node declared has no possible red, for the follow-up review to judge), nor a `readmitted` entry (groups the evidence gate refused on the first run, planned by `--retry-commits --readmit-evidence` once it admits them), nor a `set-aside-kept` entry (a refused cluster the runner could not set aside for the full check, for a cause the `scripts/remediate.mjs` row of `shared/claude-md-contract.md` lists, so its edits stay and may block the others) | no gate; the run's `commit_check` names each, and uncommitted changes stay in the working tree unstaged — except after a failed reset, which leaves the cluster's files staged and says so |
| `UNSANDBOXED` | a remediation node ran without its sandbox, by the operator's explicit `--unsandboxed` | no gate; review its whole diff, not only the source and test globs |
| `FAN-OUT-NARROWED` | `--only` deselected one or more lenses that WOULD otherwise have run -- directly, or through the `/invoke` skill that wraps it | `PASS` permitted, and the gate headline names the lenses that ran: `# Gate -- PASS - fan-out narrowed to arch-review`. Not capped, and the three precedents are exact -- `UNSWEPT-DIFF`, `UNCAPPED-BUDGET` and `CONTRACT-PARTIAL` are all declared operator choices that permit `PASS` and print their provenance. The lens that ran is worth what it is worth in a full review. What the stamp buys is the HEADLINE, and the defect it closes was measured: `--only ui-audit` on a contract declaring `ui.surface: none` spawned zero lenses for $0 and emitted `# Gate -- PASS - every node reported`. Each part was defensible -- `required` is false for a lens nobody asked to run, so `did_not_report` is empty, so completeness reads "every node reported" -- and the composite was a clean bill of health for a review that did not happen. A typo reached it too (`--only arch-reveiw`); `--only` now refuses an id no lens matches. Deselecting a lens whose CONDITION was unmet does not stamp: nothing was lost |
| `UNCAPPED-BUDGET` | one or more `review.budget_usd_per_*` keys is `""` / `none` | no dollar ceiling is enforced on that tier; each uncapped tier is named in the gate's `not_checked[]`. `PASS` permitted — an uncapped run is a declared operator choice, not a gap in what was checked, but it must never be mistaken for a bounded one. An ABSENT key is different: it keeps the conservative built-in default and earns no stamp. An unparseable value is refused at mint, never treated as consent to spend without limit |
| `CONTRACT-PARTIAL` | one or more tracked files match no declared glob (`source_globs` / `test_globs` / `doc_paths` / `generated_globs`) | those files are invisible to scope derivation AND cannot be demoted to `out_of_scope_observations[]`, so an incomplete contract silently narrows what the gate governs. `PASS` permitted — it is a declaration gap, not a failed check — but the count and a sample are printed at mint so the operator can declare them or accept the gap knowingly |
| `COVERAGE-UNKNOWN` | listing the tracked files (`git ls-files`) failed at mint, so whether the contract's globs cover the tree was not checked | the reason is printed at mint and kept in `run.json` as `contract_coverage_unknown`; there is no count and no sample, because no file was compared. Not capped, as `CONTRACT-PARTIAL` is not, and distinct from it so a reader can tell coverage never established from coverage found partial (G-9 of 20261021-190234-ciss-d1-remediations-review) |
| `PANEL-ABSENT` | `review.external_panel` false, or the external reviewer script not installed and the mint told not to check reviewers (`--no-verify-reviewers`; otherwise a missing script refuses the mint) | `second-opinion` runs its single arm and names the gap |
| `INTENT-DRIFT` | `intent.md` no longer hashes to the value the run recorded. Rehashed **by script at the gate, unconditionally** — never taken from the reconciler's own boolean, and never nested inside the barrier. It once ran only when at least one lens produced a finding, so a run where every lens reported clean skipped the check entirely: it was present wherever it could only downgrade an already-bad verdict, and absent on the single path that emits `PASS` | gate `BLOCKED` — criteria that moved mid-flight mean the run measured nothing |
| `INTENT-PINNED` | the declared documents, request and intent-capture skill hash identically to an earlier run, so that run's `intent.md` was reused rather than re-derived | none — `PASS` permitted. `run.json.intent_reused_from` names the run that derived the criteria. This is what makes two runs *comparable*: intent-capture is a model call, and re-deriving produced 56, 49 and 38 criteria from identical documents. Use `--fresh-intent` to force re-derivation |
| `TREE-MOVED` | the reviewed files changed during the run, or one of them could not be read (an unreadable file cannot be shown unchanged) — `run.json.worktree_sha` (a content hash of the scope, excluding the run directory) no longer matches at the gate | gate capped at `RISK`, and the gap named in `not_checked[]`. Every finding cites a file and a line; if the tree moved, those citations may name lines that no longer exist, so no conclusion resting on a location can be better than `RISK`. Note this is a VERDICT ceiling on the gate — a finding carries a *severity*, and `RISK` is not one; the older wording here said "findings capped at `RISK`", which is the same severity/verdict confusion that once silently disabled the severity clamp |
| `UNREQUESTED` | `--no-request`: a code review with no conformance claim attached | `contract-audit` `SKIPPED` and named; recovery suppressed |
| `REQUEST-MISSING` | no approved request; recovery has not run yet | none on its own — it is the input to recovery, not a verdict |
| `REQUEST-DISCOVERED` | `doc_roles.request` is empty and `new-run` found exactly one approved `.claude/requests/*.md`, and used it | none — an approved request is an approved request. Recorded because NOBODY CHOSE IT FOR THIS RUN: the search picks what the run is judged against, and a run audited against a request written for other work should say so where the operator will see it (G-4) |
| `REQUEST-INFERRED` | the request was reconstructed by `request-capture`, never human-approved | gate capped at `RISK`; `contract-audit` degraded with `human-approved request` in `not_checked[]`, its verdict capped at `RISK` and its findings at `MEDIUM`, a §6 invariant excepted ("Degraded lenses" above) |
| `REQUEST-INFERRED-FAILED` | recovery ran and produced no usable request | gate capped at `RISK` — a gap the run identified in its own inputs and could not fill |

Stamps are recorded in `run.json.stamps[]` and reprinted in `gate.md`. A ceiling lowers the
best achievable verdict; it never raises one.

**Which layer enforces which rule**, because "inadmissible" and "rejected" have been read as
promises the validator makes, and for three rules it does not (G-32, G-40, G-41):

| Rule | Enforced by |
|---|---|
| A finding's shape, location, containment, basis, evidence path, severity ceiling | the **validator** in `spawn-node`, mechanically, per finding |
| `intent_ref` resolving to a real criterion | the **validator**, against `intent.md`'s criterion headings |
| `FMT-DIRTY` makes formatting findings inadmissible | the **brief**: the stamp and its consequence are stated to every lens |
| `TESTS-THIN` makes test-coverage-as-mitigation inadmissible | the **brief**, the same way and for the same reason: no parser can tell that claim from any other sentence a lens writes |
| Test files reviewed under one question, with style/naming/coverage inadmissible | the **brief**, which carries `test_globs` and the admissible list verbatim |
| A claim states what is wrong, why, and what it causes | the **brief** and the schema's shape; the three clauses are a judgement, not a parse |

This is not a gap being excused. A validator can check whether a path escapes the repository; it
cannot decide whether a sentence is about formatting, or whether a claim about a test is "it asserts
nothing" rather than "I would have named it differently" — those need a reader. Saying which layer
holds which rule is what keeps a briefing rule from being mistaken for a guarantee, and it names
exactly where a rule would go unenforced if a brief stopped carrying it.

---

## §8 Recursion guard and node conduct

`GRAPH_NODE_DEPTH` carries nesting depth. The orchestrator sets `0`; every spawned child
receives `depth + 1`.

- `new-run.mjs`, `run-graph.mjs`, `spawn-node.mjs`, `run-checks.mjs`, `external-review.mjs`,
  `check-reviewers.mjs`, `bench-lenses.mjs`, `bench-second-opinion.mjs`, `bench-repair-pass.mjs`,
  `check-intent-grant.mjs`, `remediate.mjs`, `spawn-subagent.mjs`, `claim-check.mjs`, `decide.mjs`, `run-session.mjs` (its commands: its SessionStart hook prints nothing instead), `resume-run.mjs`, `capture.mjs` (its `--interactive` front end only) and `preflight.mjs` abort with exit code `3` if they start with `GRAPH_NODE_DEPTH > 0`, **or** if the
  value is present and unreadable. `preflight.mjs` aborts at depth only when asked to `--run` the
  barrier: its freshness check starts nothing. `claim-check.mjs` likewise aborts only under `--check`, which starts a
  checker; `--new` and the rules step write files and start nothing. `capture.mjs` aborts only for `--interactive`: its lens front end, `--run-dir` and its allow-list, is how a node produces evidence, and runs at any depth (`capture-interactive.plan.md`; G-2 of 20261116-001508-ci-review-2). `bench-repair-pass.mjs` has no role the guard does
  not reach: the first node of a case it replays is installed by `remediate.mjs --replay-node`, at depth 0 and only with
  `--measure-only`, and its repair passes spawn the node runtime as any run's do (`repair-bench-replay.plan.md`; G-1 of
  20261102-060316-rrp-remediation-3-review, when the bench stood in as the node runtime and that role ran before its
  guard). A graph node may not start graph work, and a guard that cannot read its
  input fails closed rather than guessing.
- **A repair pass is the runner's spawn, not the node's** (`remediation-repair-pass.plan.md`). When `remediate.mjs`'s
  full check refuses the candidate on failing tests alone, the runner — not the remediation node, which may start
  nothing — spawns the node again, fresh, as `remediation-repair-<n>`, at the depth it spawned the first. How many
  passes, what each is given, what it must show and may change, and how the passes end are owned by
  `shared/claude-md-contract.md` (`scripts/remediate.mjs`), and are not restated here.
- **The guard covers starting graph work, not running at all.** Two scripts deliberately run at
  depth 1, because a node must be able to call them there: `capture.mjs`'s lens front end, which is
  the only way to produce an evidence path (its `--interactive` front end is guarded, above), and
  `find-inert-features.mjs`, which `doc-consistency-review` is *required* to run, and carries no guard. Two more read the depth and never abort on it: `stop-guard.mjs` and `command-log.mjs`, the
  session hooks, which use it to tell a graph node from the working session (a node's stop is never blocked). (A
  remediation node does not commit: the runner does, after it exits.) `new-run.mjs --print-contract` is exempt for the same reason — it parses and
  prints, and starts nothing.

  This is not a footnote. `find-inert-features.mjs` carried the guard by copy-paste and it fired on
  every sanctioned invocation, so the mandatory inert-feature sweep degraded to whatever greps the
  reviewer happened to think of — precisely the failure that script was written to eliminate.
  Before adding a guard here, check whether the script *starts* anything.
- `Bash(claude:*)` is in every node's deny-list. **The scripts directory is not, and must not be**
  (G-48): `node <framework>/scripts/capture.mjs` is the ONE sanctioned way a node produces evidence,
  so a deny naming that directory would deny the only route the doctrine requires. What bounds it
  instead is two things — the runtime's own permission check, and capture.mjs's payload allow-list
  on everything after `--`, which is the boundary that actually stops `-- rm` or `-- claude`. This
  line used to claim the deny existed, which reads as one control where there are two, neither of
  them that one.

  **The allow-list is not closed** (G-5 of 20260930-205455-invoke-security-audit-g6-g7-high). This
  line said it was — "anything unlisted is already denied" — and `unverified-claims.md` had measured
  otherwise. Measured again on 2026-09-30 with a lens's exact flags (`--settings`,
  `--setting-sources project`, `--permission-mode manual`): an unlisted command the runtime treats as
  read-only RUNS (`git log --oneline -1`, `git diff --stat`), and an unlisted one that writes is held
  for approval, which `-p` records as a denial (`git diff --output=<file>` was refused and wrote
  nothing). A deny rule refuses either way. So what a node may run is the list, plus whatever the
  runtime classes as read-only, minus the deny rules — the runtime's classification, not this
  policy's. A mechanism that makes the list bind is a planned piece of work, not a property.
- **Every brief states the depth and the prohibition literally.** A lens that spawns lenses
  is not a clever optimisation; it is an unbounded fan-out with a bill attached.

Standing conduct rules for every node in the graph:

1. **You do not write files.** Not reports, not fixes, not notes. The spawner renders the
   report deterministically from your validated JSON. Your entire output is one JSON object.
2. **You do not apply fixes in the run that found them.** Remediation is a separate run
   against `reconciled.md`, so that the thing being fixed and the thing judging the fix are
   never the same context.
3. **You do not spawn subprocesses beyond the §8 exemptions** — `capture.mjs` (the only way to
   produce an evidence path) and `find-inert-features.mjs` (mandatory for
   doc-consistency-review). Stated absolutely, this rule contradicted §3 and §8's own
   exemption bullet, and a node obeying it literally produced no evidence and had every
   finding rejected — a clean-looking lens instead of a blocked one (round-3 G-20).
4. **Silence is not a verdict.** Everything you could not check goes in `not_checked[]` with
   a reason. An empty `not_checked[]` on a non-trivial scope is itself a defect — it claims
   omniscience, and the reconciler treats it as one.
5. **Findings outside your declared scope are reported, never counted.** They go in
   `out_of_scope_observations[]`, which the gate prints and does not tally.

---

## Appendix A — Universal report template

Rendered by `spawn-node.mjs` from validated JSON. **No model writes this file.** Reproduced
here so every skill knows the shape its output becomes.

````markdown
# <node-id> — <verdict>

| | |
|---|---|
| Run | `<run-id>` |
| Node | `<node-id>` (`<mode>`, model `<model>`) |
| State | `<state>` |
| Scope | <derived from diff vs `<base_commit>` | human-asserted: `<paths>`> |
| Intent | `<intent_sha256>` | not provided to this node |
| Session | `<session_id>` — `<runtime.cmd> <runtime.resume_argv>` to interrogate |
| Host | `<platform>/<arch>`, `<runtime>` `<runtime_version>` |
| Cost | $<total_cost_usd> over <num_turns> turns, <duration_ms> ms |

## Findings (<n>)

### <severity> · <basis> · `<file>:<line>`
<claim>

Evidence: `<evidence_path>`
Criterion: `<intent_ref>`        <!-- contract lenses only -->
Invariant: `<invariant>`         <!-- basis: invariant only -->

## Checked clean (<n>)
- <item>

## Not checked (<n>)
- **<item>** — <reason>

## Out of scope, observed (<n>)
- `<file>` — <note>

## Rejected findings (<n>)
<!-- present only when the validator dropped something; each with the reason -->
- <severity> `<file>:<line>` — rejected: <reason>
````
