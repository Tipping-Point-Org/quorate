# quorate — consumer onboarding

Reference this file from your project's `CLAUDE.md` (`@.claude/skills/quorate/QUORATE.md`) and
every quorate capability is available in your sessions. It is deliberately minimal — it loads on
every session, so it points at the deeper documents rather than repeating them. This file assumes
the standard mount below; if you mounted quorate elsewhere, adjust the paths.

Two audiences, two sections: **Setup** is for a human, once per repository. **In sessions** is
for Claude — in normal use nobody runs the engine by hand; the skills carry their own mechanics,
and the operator just asks.

quorate does evidence-backed planning, review, audit and code change. Its reviews rest on a fan-in verification graph: parallel
review lenses spawned as isolated subprocesses of the contract's node runtime
(`claude -p` by default), held at a barrier, reconciled into one gated verdict. Every finding cites evidence
written to disk before it was claimed. **A required lens that did not report makes the gate
`BLOCKED`, never `PASS` — silence is not a verdict.**

**Node.js:** quorate supports every Node LTS line still maintained, today **22, 24 and 26**, and CI runs its suite on
each. It is developed on the Active LTS, **26**, and moves to the next line when that one enters maintenance. A line
leaves the supported set at its end of life, by Node's own schedule
(`https://raw.githubusercontent.com/nodejs/Release/main/schedule.json`). No engine code may need a feature newer than
the oldest supported line.

**Test selection needs Node ≥ 24.20 to record at full speed** (decided 2026-10-27, not built yet, and
deferred past 1.0). It will record which files each test reads with Node's
Permission Model in audit mode (`--permission-audit`), which every process of the recorded run must accept, so every
`node` the suite starts has to be 24.20 or newer. On an older line it falls back to a slower recorder: on a 20-test
sample on Windows, +1.2 s per run against +0.1 s. That fallback is what keeps the rule above; that it works on Node 22
is still to be checked.

## Setup, once per repository

1. **Check for name collisions first**, then **mount** as a git submodule. The plugin
   (`.claude-plugin/plugin.json`) is discovered in place; the 12 skills need no other install step:

   ```
   ls .claude/skills/          # any of these names colliding with quorate's 12?
   git submodule add https://github.com/Tipping-Point-Org/quorate .claude/skills/quorate
   ```

   **If your project already has skills of its own, read this before mounting.** Quorate's names
   are ordinary words — `plan-review` and `version-gate` among its skills, `arch-review`,
   `code-audit` and `doc-consistency-review` among the node contracts under `prompts/` — and a
   project that already does structured review very likely has some of them. This is not a rare
   edge case: on the first real install, **six names collided**, two of them lenses the engine
   spawns.

   The node contracts live in `prompts/`, not `skills/`, so they add no skills to your namespace —
   but a skill of YOURS carrying one of their names still sits in the namespace a node can invoke
   from, which is the collision this is about. `new-run` checks both sets of names and stamps the
   run `SKILLS-SHADOWED`; for a while it enumerated only `skills/` and so could not see the two
   names that made the check exist (G-2).

   Nodes are spawned with `--inline-skill`, so the framework's own SKILL.md text reaches the model
   regardless — a collision is unlikely to change what a lens is told. But that is an ordering
   that happens to hold, not a boundary, and a review that silently applied *your* older
   `arch-review` while reporting quorate's would be very hard to notice, because the two would
   look similar enough to be plausible. `new-run` warns and stamps `SKILLS-SHADOWED` when it sees
   this, including a `.claude/skills/shared` or `.claude/skills/scripts` left over from an older
   engine, which sit on the path quorate probes for its doctrine. Rename yours, or move them, if
   you want a review that is unambiguous about whose criteria it applied.

2. **Declare the contract.** Copy the ready-made template —
   `.claude/skills/quorate/CLAUDE.template.md` — and put the `graph_contract` YAML block in
   **one** of two places:

   | Location | When to choose it |
   |---|---|
   | `.claude/rules/quorate-contract.md` *(preferred)* | A file quorate owns: `check-install` can diff it against the template and tell you when the mounted quorate knows a key yours does not carry. It compares key PRESENCE, not meaning: a key whose behaviour changed under the same spelling — `budget_usd_per_node: ""` once meant a $0 cap and now means uncapped — is exactly what it cannot see, and reading the release notes remains the only guard against that. Your `CLAUDE.md` stays yours. Auto-loaded as memory exactly like `CLAUDE.md`, so it costs no extra context. |
   | `CLAUDE.md` at your repo root | The original location, still fully supported. Choose it if you would rather keep one file. |

   Either way the `@.claude/skills/quorate/QUORATE.md` import line goes in your `CLAUDE.md`.
   The engine parses the contract file directly and does **not** follow imports, so the YAML has
   to be in the file itself, not pulled in from elsewhere.

   **Do not put a contract in both.** If the two blocks differ, every run refuses and names both
   paths rather than silently preferring one. Identical copies are fine — that is what a migration
   looks like mid-way — and the redundant one is reported so you remember to delete it. Each run
   records which file it read, in `run.json` under `contract_source`.

   Fill the keys marked `<...>`; every key is annotated in place, and an
   empty key is honest (skipped and named in `not_checked[]`) while a command that does not run
   is worse than empty. Alternatively, ask for `quorate:full-review` with no block present and it prints
   one pre-filled with what it detected. Then validate:

   ```
   node .claude/skills/quorate/scripts/new-run.mjs --dry-run --full-sweep <your source dir>
   ```

   It prints the resolved contract and what each empty key will cost a run, and spawns nothing. Name a
   directory your `source_globs` match. Without `--full-sweep`, the scope is derived from your last commit
   and untracked files, and a fresh install usually has no source file there, so the dry run refuses
   (exit 2, "Refusing to infer a whole-repo scope"). That refusal is the scope rule working, not a broken
   install.

   Every key is documented in `shared/claude-md-contract.md` (in this submodule). The rules that
   matter most: commands must be **exact and runnable from your repo root**; an empty key means
   that check is skipped and named in `not_checked[]`, and the run still passes on what remains;
   **never fill a key with a command that does not run.**

3. **Check the install is current**, whenever you move the submodule pointer:

   ```
   node .claude/skills/quorate/scripts/check-install.mjs
   ```

   Moving the pointer is an *update*: it refreshes the engine, and hook behaviour too, since
   installed hooks are two-line shims pointing back into the submodule. It does **not** add a hook
   you never installed, and it does **not** touch the `graph_contract` block in your own
   `CLAUDE.md` — whose *meaning* can change underneath it. `budget_usd_per_node: ""` once meant a
   `$0` cap that blocked every node and now means uncapped: same text, opposite behaviour, no
   signal. This names anything stale and how to fix it, by comparing actual state rather than a
   version recorded at install time. Its `upgrade:` line lists every change your contract needs for
   the mounted quorate, and a release's CHANGELOG list of what a consumer must change is held to it
   (`shared/compatibility.md` says what 1.x keeps compatible).

   It also reports whether `.claude/quorate/test-profile.md` exists, because a MOUNTED test writer is not a
   LOCALISED one. `unit-test-writer` and `integration-test-writer` are deliberately portable: they
   read the runner and test locations from your contract, and read everything the contract cannot
   carry — assertion idiom, fixture convention, how an expensive boundary is faked, and **where your
   project declares what is worth testing** — from that file. Produce it once by running the
   `ADAPT.md` prompt beside either skill; it derives each item from evidence in your tree, cites the
   file it learned each one from, and records what it could not determine instead of guessing.

   Without it the skills still work and say so in `not_checked[]`, inferring conventions from your
   existing tests. What you lose is the half a project-specific test skill is mostly made of: which
   subsystems are worth pinning, and which document declares that bar. The profile records that **by
   citation, not by copy** — a restated checklist becomes a second bar that drifts from the first.

   ### Telling a lens how YOUR project works

   `.claude/quorate/` is yours, and it feeds two different kinds of reader:

   ```
   .claude/quorate/project.md            every node gets this
   .claude/quorate/code-audit.md         only that node gets this
   .claude/quorate/test-profile.md       the two test writers (produced by their ADAPT.md)
   .claude/quorate/plan-review.md        plan-review          (its own ADAPT.md)
   .claude/quorate/plan-authoring.md     plan-authoring       (its own ADAPT.md)
   .claude/quorate/version-gate.md       version-gate         (its own ADAPT.md)
   ```

   This is the mechanism that makes a same-named skill of your own unnecessary. Put the project half —
   idiom, layout, local history, which subsystem is load-bearing and why — in a profile, and quorate's
   portable skill or lens keeps the discipline half. Nothing to rename, nothing discarded silently, and
   it survives every `git submodule update` because it is outside the submodule.

   **The two readers are not equivalent, and the difference is where the guard runs.**

   A profile naming a **node** is INLINED into that node's brief — not pointed at, because a node that
   has to go and find its context finds a different one each run. The orchestrator assembles that
   brief, so it bounds the file, declares in the brief when it had to truncate, and writes the
   context-not-authority header itself. Those are guarantees that EXECUTE.

   A profile naming a **skill you invoke** is READ BY THAT SKILL. Claude Code loads `SKILL.md`
   directly, so there is no assembly step for quorate to hook and none of those guarantees can run at
   read time. They do not disappear — they move to where they still can:

   | Guarantee | For a node | For a skill |
   |---|---|---|
   | Bounded | truncated at the cap, and the brief says so | `check-install` reports a file over budget; nothing truncates |
   | Context, not authority | header written by the orchestrator | stated in the skill's own text, and by its `ADAPT.md` at the top of the generated file |
   | Empty or unreadable is visible | the brief says which | `check-install` names it |

   Three limits, all deliberate:

   - **Bounded** at 16 KiB per file. Over that a node's section is truncated *and the brief says so* —
     a silently shortened instruction is worse than a short one, because a reader cannot tell a cut
     instruction from a complete one and will follow half of it. A skill reads the whole file, so the
     budget there is enforced only by `check-install`. If you need more, you are describing a
     document: put it in `doc_paths` where a lens can cite it. (Raised from 6 KiB when profiles
     reached the person-invoked skills: a milestone vocabulary and an exit-gate map do not fit in the
     space sized for a lens's idiom notes.)
   - **Context, not authority.** A profile cannot grant a permission, relax a severity floor, waive a
     §6 invariant, or excuse an evidence path — and where it contradicts the doctrine, the doctrine
     wins and the contradiction is itself worth reporting as a finding about the profile. For
     `version-gate` specifically: a profile may ADD requirements to a release gate; it may never
     remove one.
   - **Named after a node or skill that exists.** `check-install` lists your profiles and flags any
     whose name matches nothing this quorate ships, because a file nothing reads looks exactly like
     one that works.

   If your project already has skills of those names, this is the decision to make deliberately:
   generate the profile, then drop your own pair rather than keeping both. Two skills answering to
   one name is not a merge — it is an ambiguity resolved differently each time it is invoked.

   `check-install` lists every colliding name, split by what the collision actually costs, because the
   two halves are not equivalent:

   - **A lens the engine spawns** (`arch-review`, `doc-consistency-review`, …) is **safe by
     construction.** Nodes are spawned with `--inline-skill`, so the orchestrator hands the model the
     framework's own text no matter what shares the name. Review integrity does not depend on you
     resolving these.
   - **A skill YOU invoke** (`unit-test-writer`, `plan-review`, `version-gate`, …) does NOT shadow
     quorate's, and this page said for months that it did — "the runtime picks one" — 65 lines from
     the section stating why it cannot. quorate's skills are NAMESPACED by the plugin
     (`quorate:plan-review`); yours sits at `.claude/skills/<name>/SKILL.md` and is invoked bare.
     Two different strings, and nothing resolves between them.

     What genuinely collides is **selection**: two skills whose descriptions answer the same request,
     where the model chooses one. That is worth resolving and is a smaller thing than was claimed —
     the old sentence sent a real consumer to rename six skills that were never going to be
     mis-resolved. Resolve it by MIGRATING rather than renaming: put the project half in
     `.claude/quorate/<name>.md` and delete your copy, so one name answers to one skill.

   Nothing resolves this automatically, and nothing should: quorate does not rename your skills, and
   shipping fewer of its own would take capability away from projects that have no conflict. Every run
   also stamps `SKILLS-SHADOWED` so a gate cannot be read as unambiguous when it was not.

   It also names any **empty `doc_roles` key whose document appears to be sitting in your
   repository** — measured on a real consumer, whose contract said `architecture: ""` ("no single
   architecture document declared") while `docs/architecture.md` was tracked. Empty is a legal, honest
   declaration: it degrades the check and says so; a degraded `arch-review` is capped as
   `.claude/skills/quorate/shared/disk-first-protocol.md` §7 states. It is still
   worth knowing when the document exists, which is the one thing nothing used to tell you.

4. **Seed the pre-flight, once.** This is where a long test suite should be paid for:

   ```
   node .claude/skills/quorate/scripts/preflight.mjs --run
   ```

   A review does **not** re-run your declared `build`/`test`/`lint` commands every time. It hashes
   the files those commands read, compares that against the last result, and re-executes only when
   the result no longer applies. The files are git's list under your globs (tracked, plus untracked files that are not
   ignored), so an ignored leftover never counts. With `review.preflight_inputs` **declared**, the hash alone decides:
   change an input and the checks re-run; edit a file outside the set and they do not. With the set **inferred**, a
   dirty worktree also invalidates, whatever moved — there the input set is a guess, and that rule is what keeps
   caching the build safe rather than reckless.

   Run it with no arguments to ask the question without paying for it: it prints `FRESH` or `STALE`
   with the reason, and exits 3 when a seed is needed.

   **Declare `review.preflight_inputs` if you can.** Left empty, the input set is INFERRED from
   `source_globs`, `test_globs`, your contract file and any root-level dependency manifest — and a
   declared check can read a file none of those name. `uv run pytest` behaves differently after
   `uv.lock` moves, and a `source_globs` of `["src/app/**"]` excludes it. So a run reusing an
   inferred result is stamped `CHECKS-INPUTS-INFERRED` and **capped at `RISK`**: unproven freshness
   is staleness, and where quorate had to guess it says so rather than inferring silently. Declaring
   the globs removes the ceiling, because the claim stops being a guess.

   `--preflight always` on `run-graph.mjs` restores the old cadence exactly. `--preflight never`
   (alias `--skip-preflight`) skips the checks, stamps `CHECKS-SKIPPED`, caps the gate, and names
   every declared command in the Not-checked table.

5. **Install the git hooks** (optional). `.git/hooks` is not tracked by git, so quorate's hook
   bodies ship inside the submodule and are **inert until copied into your `.git/hooks`** — that
   copy is what "installing" means here. The installed files are short shims that call back into
   the submodule, so a later `git submodule update` refreshes their behaviour without re-running
   this.

   ```
   node .claude/skills/quorate/.claude/hooks/install.mjs
   ```

   You get a **`pre-push` gate** that runs your declared build/test **only when the push targets
   `main` or `master`** — feature-branch pushes are free, so saving work in progress is never
   taxed — and a non-blocking **`pre-commit`** reminder to update governing documents alongside
   code. The engine does not depend on either: reviews behave identically without them.

   The `pre-push` hook also runs a **secret scan** with [gitleaks](https://github.com/gitleaks/gitleaks),
   governed by `hooks.secret_scan` in your contract. Read that key in `shared/claude-md-contract.md`
   before your first push: it owns what the scan covers, what blocks a push, which rules it applies,
   and how to turn it off deliberately.

   If you already have your own `pre-commit`/`pre-push`, the installer **refuses rather than
   overwriting**, tells you which guarantee you therefore do not have, and offers both ways out
   (chain ours from yours, or `--force`). Declining is fine — just decline knowingly.

   **What no local hook can do:** a merge performed on the forge — a GitHub PR "Merge" button —
   runs server-side, where no hook of yours executes. Local hooks gate *your* machine only.

   **The stop guard** is a Claude Code hook, not a git hook, and it goes in your `.claude/settings.json`. It holds the
   stopping half of `shared/session-rules.md`, which owns what it records. A plugin's own hooks did not fire from this mount
   when tested, so the project declares it:

   ```json
   { "hooks": {
       "Stop": [ { "hooks": [ { "type": "command",
         "command": "node .claude/skills/quorate/scripts/stop-guard.mjs"
       } ] } ],
       "StopFailure": [ { "hooks": [ { "type": "command",
         "command": "node .claude/skills/quorate/scripts/stop-guard.mjs --stop-failure"
       } ] } ],
       "UserPromptSubmit": [ { "hooks": [ { "type": "command",
         "command": "node .claude/skills/quorate/scripts/stop-guard.mjs --turn-start"
       } ] } ]
   } }
   ```

   The `StopFailure` hook records a turn that ends on an API error, a usage limit among them, with its cause
   (`shared/session-rules.md`, "Usage limits"). `check-install` says whether these are declared. `node .claude/skills/quorate/scripts/stop-log.mjs --summary` reports
   what the record holds.

   **A long run's start hook** goes beside them, so a session that starts or resumes inside a run started with
   `run-session.mjs` is told where it is (`shared/session-rules.md`, "A long run", owns what it prints):

   ```json
   { "hooks": {
       "SessionStart": [ { "hooks": [ { "type": "command",
         "command": "node .claude/skills/quorate/scripts/run-session.mjs --session-start"
       } ] } ]
   } }
   ```

   **The command log and the deny rules** go in the same file. A `PreToolUse` hook with the matcher `Bash|PowerShell`
   runs `node .claude/skills/quorate/scripts/command-log.mjs`, which logs every command before it runs, and
   refuses one it cannot log. Redaction is best-effort: it masks the secret shapes it knows, and a secret of any other
   shape is logged as typed, so the log is not a credential-safe place (`shared/session-rules.md` owns the rule). A `PostToolUse` and a `PostToolUseFailure` hook with the same matcher run it with `--after`,
   which adds each command's outcome and duration, never its output, and never refuses. The deny rules are `permissions.deny` entries for the commands `shared/session-rules.md`
   names; quorate's own `.claude/settings.json` carries the full list to copy.

6. **CI, and the price of skipping it.** Without a server-side check, the only thing standing
   between an unreviewed branch and `main` is whoever clicks Merge. Local hooks cannot cover that,
   and neither can quorate. A minimal workflow closes it — copy
   `.claude/skills/quorate/.github/workflows/checks.yml` as a starting point and swap in your own
   declared commands; it runs the same commands the pre-flight barrier does, on
   `push` to the default branch **and `pull_request`**, with no model spawned and nothing to pay
   for. Check the branch name in the file against your own default — the shipped copy says
   `master`, and a workflow watching a branch you do not have is a gate that never runs.

   Skipping it is a real choice with a stated cost: your gate then exists only where the hooks are
   installed, so a teammate without them, a merge from the web UI, or `--no-verify` all bypass it
   silently. On a solo repository that may be an acceptable trade; on a shared one it means the
   gate is advisory.

7. **External review panel** (optional, OFF by default — enforced at the single egress point, so
   skills that call a reviewer directly are covered by the same switch): cross-model corroboration via the
   `codex` and `agy` CLIs. Enabling it sends prompts to third-party clouds — a data-governance
   decision, documented in `shared/external-reviewers.md`. Opt in with
   `review.external_panel: true` in the contract. Every reviewer is then probed before its first use, and a
   mint refuses a run whose reviewers fail; to see the panel's state beforehand, deliberately:

   ```
   QUORATE_LIVE=1 node .claude/skills/quorate/scripts/check-reviewers.mjs                      # bash, zsh
   $env:QUORATE_LIVE='1'; node .claude/skills/quorate/scripts/check-reviewers.mjs              # PowerShell
   ```

## Activating it — the part that is not mounting

Mounting puts the files in place. Two more things decide whether a session can actually reach them,
and both cost time to discover the first time:

1. **The skills are NAMESPACED by the plugin**, so they are `quorate:full-review`,
   `quorate:request`, `quorate:remediate` — not bare `/full-review`. A bare name works only for a
   skill placed directly at `.claude/skills/<name>/SKILL.md`, which is not how a mounted quorate is
   laid out. Every reference below uses the namespaced form for that reason.

2. **A newly mounted quorate does not appear in a session that was already open.** Run
   `/reload-plugins` — no restart needed. Edits to an existing `SKILL.md` take effect immediately;
   it is *new* skills, plugins, agents and hooks that need the reload. It warns if reloading would
   invalidate prompt caching, and `--force` overrides.

**Verified rather than assumed** (2026-09-13): a folder carrying `.claude-plugin/plugin.json` placed
at `.claude/skills/quorate/` IS discovered at project level — `/reload-plugins` loaded it and the
skills were invocable immediately after. That is worth stating explicitly because Claude Code's own
documentation describes this auto-discovery for the USER-level `~/.claude/skills/` directory, and
project-level discovery is not documented; this repository depended on it in every mount while
carrying no evidence for it. If a future version stops honouring it, the symptom is precisely this:
the mount is present, `check-install` is happy, and no `quorate:` skill exists.

## In sessions — how Claude uses quorate here

The skills are the interface; each carries its own commands and rules, so invoke the skill and
follow it rather than reconstructing the engine invocation.

**When to stop, and what to ask the operator**, is owned by `.claude/skills/quorate/shared/session-rules.md`: read it
there. It is the default; a project replaces its rules with `.claude/quorate/session-rules.md`. The stop guard still
enforces the stop markers of quorate's own `shared/session-rules.md` either way; the override changes only which rules
its refusal points at. **Where a question with options goes when `review.decision_panel` is on** is owned by the same
file, "With the decision panel on".

- When the operator asks for a **review** of finished work — “review this”, “full review”, “run
  the graph” — invoke `quorate:full-review`. Do not review the code yourself in its place: an inline
  opinion is an uncontexted extra lens with no schema and no evidence discipline. Scope derives
  from the diff and the untracked files git does not ignore; if those hold no source file the run
  refuses, and the operator asserts scope explicitly
  rather than you inferring a whole-repo sweep.
- **Before starting planned work**, offer `quorate:plan-review` — it gates whether the work should
  happen at all, and it is cheaper than reviewing work that should not exist.
- **Before a hard-to-reverse choice** (library, framework, algorithm, model, topology), invoke
  `quorate:candidate-pool` to widen the options — even when a shortlist already exists; finding what the
  shortlist is missing is the point.
- **After a run reports**, relay `gate.md` faithfully: lead with the gate verdict, name any lens
  that did not report, and the Not-checked table. Never soften a `BLOCKED` into “mostly fine”.
  Then fold the run into the cross-run ledger and mention what is new versus recurring:

  ```
  node .claude/skills/quorate/scripts/findings-ledger.mjs --run-dir <abs-run-dir>
  ```

  Run it from the repository (or name it with `--repo-root`): a run directory is folded only as one of that
  repository's runs, into that repository's ledger, whatever its `run.json` names.

  The fold ends with **what is waiting on the operator**, each with its command: declines an agent
  proposed; declines a later review raised again, at any severity (T4 of `shared/ledger-transitions.md` marks the
  ones that came back higher); claims a silent review cannot close; stale
  entries; agents' notes on closed entries; and **every operator decision recorded since the previous
  fold** — check each is theirs, since the words behind it are not verified yet. Relay these as
  decisions, not as noise; `--summary --stale` lists them at any time. Only the operator's words close
  an entry or restart its clocks (`--operator-quote`); who may do what is `shared/ledger-transitions.md`.

- **To fix findings**, invoke `quorate:remediate` — a separate, later run: `new-run --remediates <review>` mints it
  and `remediate.mjs` runs its node in a fresh context. Never apply fixes in the run (or the session context) that
  found them, even obvious ones, even when asked in the same breath: say why and start the remediation run instead. `quorate:version-gate` consumes `gate.json`
  for release decisions.
- **When patching stops converging**, stop patching and run a design step: when that is, is the round cap of
  `.claude/skills/quorate/shared/remediation.md`, and `.claude/skills/quorate/shared/design-step.md` says how.

  `second-opinion` adversarially audits a run's reconciliation, and this line used to name it as
  `/second-opinion` — **which resolves to nothing.** It is a node under `prompts/`, spawned by the
  orchestrator inside a run, not a skill a person can invoke. The claim is removed rather than
  satisfied: making it invokable needs an invocation shape that points at a FINISHED run, and
  `scripts/lens-roster.json`'s `$invokable` block records that as the one exclusion worth revisiting.
- **When the operator names ONE dimension** — "arch-review this adapter", "security-audit that
  endpoint", "check the docs are consistent" — invoke `quorate:invoke <lens>`. It runs that single
  lens through the whole path: mint, brief, the lens, its cross-family shadow arm, the barrier,
  reconciliation, adjudication on dispute, and a gate. It narrows the fan-out and **nothing else** —
  same models, same effort, same budgets, same panel switch — so it costs quorate's price for the
  work it does and is not a cheaper review. The gate headline names the narrowing
  (`# Gate — PASS · fan-out narrowed to arch-review`); relay that scope rather than "the review
  passed".
- The lenses themselves (`code-audit`, `contract-audit`, `arch-review`,
  `doc-consistency-review`, `feature-verify`, `perf-audit`, …) are never invoked **directly** in the
  session — they are spawned by the orchestrator as isolated subprocesses, which is what gives them
  a run directory and therefore real evidence. `quorate:invoke` is how a person reaches one: it does
  the spawning rather than pasting a lens prompt into the conversation.
- **Capture's interactive front end** (`node .claude/skills/quorate/scripts/capture.mjs --interactive`) runs a session's
  own command string with its streams kept apart and on disk; it is built and not yet adopted for sessions, and
  `shared/claude-md-contract.md` (its `scripts/capture.mjs --interactive` row) owns how it is called and what it refuses.
- **When a question is about the code's structure** — does this symbol exist, who calls F, which handlers sit in
  functions that call G — and the project declares `code_index`, ask
  `node .claude/skills/quorate/scripts/code-index.mjs <shape> --args '<json>'` rather than writing a throwaway sweep.
  An `unresolved` or `partial` answer means "could not tell", never "no". `shared/code-index.md` owns the shapes,
  the outcomes and the extractors.
- **When the operator asks for a review's findings on a pull request**, run
  `node .claude/skills/quorate/scripts/pr-comments.mjs --run-dir <run> --pr <number>` once the run has gated. It prints
  the one GitHub review it would post (an inline comment per confirmed finding whose line is in the pull request's diff,
  and a summary with the gate, the lenses that did not report and the rest) and sends nothing; show it to the operator,
  and add `--post` only on their word. It goes through `gh` and its login, and refuses a run whose tree was dirty outside
  `generated_globs` (or could not tell) or whose reviewed commit is not the pull request's head. `scripts/lib/pr-comments.mjs` owns what is posted and when it is
  refused.
- **When the operator asks what reviews cost or catch**, run `node .claude/skills/quorate/scripts/telemetry.mjs report`
  (`--since <date>`, `--kind <kind>`). Finished runs, claim checks, plan-review rounds and bench runs write a local
  record, best-effort (one that could not be written is missing until `telemetry.mjs backfill`), and the report adds up
  the records it finds, each figure beside its sample size and each location's count. Relay the figures with their n,
  as a sample of the runs that have records, and do not
  read a threshold or a recommendation into them; none is built. `shared/telemetry.md` owns the format, the locations
  and what each figure means.

## Rules your sessions inherit

Each of these is a POINTER, not a second copy: the section named beside it owns the rule, and where
this page and that section differ, the section wins. Four rules restated in full here was four more
places for the doctrine to drift away from itself (G-5).

- **Nodes never discover the environment** (§7, and `claude-md-contract.md`) — commands, paths, budgets and models come from
  the contract. Do not go looking for the build command; declare it.
- **Findings need evidence** (§3) — a claim above LOW cites an `evidence_path` produced during the
  run by `capture.mjs`. Everything not checked is named in `not_checked[]`.
- **No fixes in the run that found them** (§8 rule 2) — remediation is a separate run, so the thing fixed
  and the thing judging the fix never share a context.
- **`GRAPH_NODE_DEPTH` guards recursion** (§8) — a graph node may not start graph work.
- **Attribution needs a citation** (`unverified-claims.md`, "A second class: claims about WHO
  ASKED") — say "you asked" only where their words can be quoted; otherwise "I proposed, you
  approved" or "I decided". A claim about provenance borrows the operator's authority, and it is
  the one claim they cannot audit without rereading the conversation.
- **A decision comes with options, pros, cons and a suggestion, checked before it is sent**
  (`skills/claim-check/SKILL.md`, "Presenting a decision" and "When"), in conversation as much as in a
  report.

Doctrine lives in `shared/` — read `.claude/skills/quorate/shared/disk-first-protocol.md` first;
the framework's own `CLAUDE.md` (in this submodule) shows a complete working contract, including the
honest use of empty keys.
