# quorate

Evidence-backed planning, review, audit and code change for Claude Code. Its reviews rest on a fan-in verification graph:
parallel review lenses are spawned through the contract's node runtime (`claude -p` by default) as subprocesses, held
at a barrier, and reconciled into one gated verdict. Every finding cites evidence written to disk
before it was claimed.

The name is the adjective: a meeting is *quorate* when enough members are present for its decisions
to be valid. That is this system's central rule — a required lens that did not report makes the gate
`BLOCKED`, never `PASS`. **Silence is not a verdict.**

## Layout

This repository is a framework for Claude Code, mounted as a git submodule rather than installed from a
marketplace. Consuming projects mount it at `.claude/skills/quorate/`, where its plugin manifest,
`.claude-plugin/plugin.json`, is discovered in place with no install step and gives its skills the `quorate:` names.

| Path | What it is |
|---|---|
| `scripts/` | The orchestration engine: `new-run`, `run-graph`, `spawn-node`, `capture`, `run-checks`, `external-review`, `find-inert-features`, `check-syntax`, `check-reviewers` (every external reviewer's preflight, on demand), `check-intent-grant` (the live probe of what the runtime grants the intent node), `spawn-subagent` (a skill's Claude subagent at the contract's model and effort, which a session's own subagent tool cannot set), `decide` (a question with options answered by the decision panel instead of the operator, when `review.decision_panel` is on: three seats of different families, blind, by majority, with capped rounds and a moderator; reserved decisions refused; each decision recorded under `.claude/decisions/`), `pr-comments` (a finished review's confirmed findings posted to a pull request as one GitHub review, through `gh`: a dry run unless `--post`; `scripts/lib/pr-comments.mjs` owns what is posted), `check-plan-verdict` (the caller's check that a plan-review verdict reports the settings it was pinned to), `run-session` (a long run on one approved plan: its state under the engine's home, printed into the session by its `SessionStart` hook and at each turn start, and the daily check of which CLIs are due an update, reported and never applied; `shared/session-rules.md`, "A long run"), `resume-run` (the line that reopens a run's session after a crash or a reboot, from the runtime adapter's `resume_argv`), `claim-check` (a report's claims checked before it is sent: `--check` runs the checker, of the other family when the panel is on, and the rules step grades its answer), `remediate` (runs the remediation node in a remediation run that `new-run --remediates` minted, then commits each cluster the node reports, and archives the run when it ends), `archive-run` (moves an ended run left staged into `.claude/reviews`), `publish` (one release snapshot for the public mirror: the tracked files of one commit minus `publish/manifest.json`'s exclusions, scanned for machine-local paths, the operator's identity from a gitignored local file, placeholder markers and secrets, run on its own, then committed into a local clone of the public repository as a given identity; never pushed, ROADMAP D2), `check-counted-facts`, `check-install`, `check-secrets` (the secret scan CI runs, as `hooks.secret_scan` declares it), `gen-gitleaks-config` (writes the push scan's rules from the one definition of the secret shapes), `gen-rule-text` (writes every marked rule region in the documents from its one owner, and with `--check` names a stale region or a restatement outside one), `bench-lenses`, `bench-second-opinion`, `bench-admit`, `bench-repair-pass` (the repair pass replayed on this repository's own refused remediations, in a worktree, committing nothing), `findings-ledger`, `code-index` (the code index: runs each declared extractor, keeps its facts in a cache under the engine's home that every reader re-checks, and answers seven kinds of question, `shared/code-index.md`), `stop-log` (what the session's stop record adds up to, as `shared/session-rules.md` defines it, beside the baseline its stopping rules were built on), `stop-guard` (Claude Code's `Stop`, `UserPromptSubmit` and `StopFailure` hook, declared in `.claude/settings.json`: the stopping half of `shared/session-rules.md`, which owns what it records and refuses), `command-log` (the `PreToolUse` hook on the Bash and PowerShell tools: every command logged before it runs, secrets of known shapes masked (best-effort), a folder per session; with `--after`, the `PostToolUse` and `PostToolUseFailure` hook: its outcome and duration; `--summary` lists failed, slow and unfinished commands), `telemetry` (`report` adds up the records finished runs, claim checks, subagent spawns, bench runs and, in the developer's own checkout, suite runs write, best-effort, each figure beside its sample size, with each run's time and where it went; `backfill` writes records for runs that predate the writers; `shared/telemetry.md`), and `preflight` — the pre-flight as a thing the operator runs, because the half of it that belongs at install time has to be reachable by a command. Plus two tools for the build log, which is documentation rather than engine: `extract-sessions` (dated digests from the raw Claude Code transcripts) and `check-quotes` (every quotation on the page must exist verbatim in those digests). |
| `blog/` | Not in this repository: the project's own build log stays private (ROADMAP D4). `extract-sessions` and `check-quotes` ship as the tools that keep its quotations checked, and work for a log of your own. |
| `scripts/lib/` | Pure decisions extracted so they can be tested — no I/O, no clock, no environment; a decision that must consult the disk takes the platform as `io` (ARCHITECTURE §2, enforced by a test): caps, envelope classification, budget accounting, self-location, external-reviewer argv and schemas, bench scoring, counted facts, the findings ledger, reconcile diffing, the external review prompts (shadow arm and tie-break), the framework version stamp, the pre-flight cache's freshness rule, the secret shapes that redaction and the push scan are both built from (with the case table that is their scope), and the bench's settings layer — which model and effort a benched position runs at, whether a candidate is inside the search space, and whether it may be adopted; and what happens to a process the run could not stop — killed only if the run still holds it, otherwise reported; and what a stop says — every status field and sentence for a stop outcome, in one place; and the entry every runtime call builds where it is made (`call-entry`), with the one rule for a model's family (`familyOfCall`, declared on the adapters); and the one shape of an adapter's tool lists, the refusal of any other, and the accessor every reader goes through (`tool-lists`); and how each set `scripts/compatibility.json` freezes for 1.x is read from its owner and held against it, and which deprecations a consumer still uses (`compatibility`; `shared/compatibility.md`). |
| `scripts/io/` | The orchestration side's I/O: the modules whose purpose is I/O (atomic writes, worktrees, the caches, the glob walker, child processes), and one host-bound re-export per `lib/` module that takes `io`. Orchestration imports from here. |
| `scripts/platform/` | Everything that differs by operating system, behind one interface. Its layout and rules are owned by ARCHITECTURE §2 (the Platform row). |
| `prompts/_templates/` | The prompt fragments the engine ASSEMBLES rather than hands to a node: the run brief, the external-arm and tie-break prompts, the stamp notes, the stop guard's turn-start notices. Filled with `{{slot}}` by `lib/template.mjs` — no conditionals, no loops, so every decision stays in code and arrives pre-rendered. They lived as template literals inside `run-graph.mjs` and `lib/codex-prompts.mjs`, where a prompt author could not find them. |
| `prompts/` | The 13 node prompts the engine spawns — the lenses, `intent-capture`, `request-capture`, `reconcile`, `second-opinion`, and `remediation` (spawned by `remediate.mjs` in a remediation run, not by `run-graph`). Each is a `PROMPT.md` that refuses to run outside a run directory. Twelve emit a schema-validated envelope; `second-opinion` is the graph's one PROSE node (`schema_variant: none` in the roster, no `--json-schema`, routed to the prose output template) — the blanket "each" was false about precisely the node whose prose handling had already cost a defect: ordering the prose branch after the no-payload check left it never once reporting OK. They are NOT skills: no person can usefully invoke one, and keeping them in `skills/` put twelve false affordances into every consuming project's namespace. |
| `extractors/` | The code index's reference extractors, Python (standard library) and JavaScript (acorn, from the consumer's own tree). Separate products the engine runs as a contract command and never imports (ARCHITECTURE A-27); `extractors/README.md` is what a contributed extractor follows. |
| `skills/` | The 12 skills a person actually invokes. Plugin convention — a plugin's own skills live here. |
| `shared/` | Doctrine every skill cites: `disk-first-protocol.md` is the one to read first. |
| `QUORATE.md` | Consumer onboarding: a project mounting this submodule references it from its own `CLAUDE.md` (`@.claude/skills/quorate/QUORATE.md`) to enable everything — setup, contract template, hooks, panel, usage. |
| `tests/` | 5027 regression tests. Every one records the defect it exists to prevent. The count is verified against the tree on every push — see `scripts/check-counted-facts.mjs`. |
| `.claude/hooks/` | Git hooks (`pre-commit`, `pre-push`) and their installer. **Not** Claude Code lifecycle hooks — a different mechanism. |

## Building

There is nothing to compile. `commands.build` runs `scripts/check-syntax.mjs`, which parses every
`.mjs` and `.js` file with the same parser the runtime uses. That is the honest equivalent of a
build for this project: it catches source that cannot execute at all, which is the class the
pre-flight barrier exists to catch. It does **not** type-check and does **not** resolve imports;
both are named in `not_checked[]` rather than implied by it passing.

Leaving the key empty was the alternative, and it is worse: empty means `UNBUILT`, which caps every
gate at `RISK` permanently, and a verification system that can never report `PASS` on itself cannot
distinguish clean from broken.

## Reviewing itself

This repository is reviewed by the system it contains. That is not a novelty — it is the one place
a blind spot costs the most, and several real defects were found exactly this way: a severity clamp
that silently did nothing, an inert-feature detector that could never run inside the lens that
requires it, and a prose node that could never report `OK`.

```
node scripts/new-run.mjs --dry-run                 # resolve the contract, spawn nothing
node scripts/new-run.mjs --slug self --full-sweep scripts shared skills tests
node scripts/run-graph.mjs --run-dir <the run dir new-run printed>
```

A run is staged under the engine's home while it runs and moved into `.claude/reviews/` when it ends
(`review.reviews_dir`), so the run directory to pass is the one `new-run` prints, not a path under `.claude/reviews/`.

A known-good checkout can review a broken one: the engine locates itself relative to itself, so
`--repo-root <other-tree>` reviews that tree using *this* orchestrator.

A gap this self-review cannot reach is recorded in `shared/unverified-claims.md`: the graph verifies
artifacts, and nothing verified the agent's prose claims about a codebase. `quorate:claim-check` now
checks a report's claims before it is sent (2026-09-26); that file records what it still does not cover.

## Three layers, and the one that was missing

There are three copies of quorate in play during development, and confusing them has cost real
mistakes. They exist for different reasons:

| Layer | What it is | Why |
|---|---|---|
| `./` (this tree) | the engine **being developed** — dirty, sometimes broken | where every edit happens |
| `.claude/skills/quorate/` | a **PINNED, stable** checkout, mounted where a consumer mounts one | so this repository can use its own skills while developing the engine |
| `.sandbox/<project>/.claude/skills/quorate/` | a consumer's mount | to validate the mount itself — see the section below |

The middle one was absent for months, and its absence was invisible in exactly the way this project
keeps documenting. quorate ships its twelve person-invoked skills from `skills/`, which is the **plugin**
convention; Claude Code discovers a *project's* skills under `.claude/skills/`. Those are not the same
path, so in quorate's own repository `/request`, `/full-review` and `/remediate` resolved to **nothing**.
The tools this project ships were the only ones it never used.

What that cost is on disk: nine `.inferred.md` files in `.claude/requests/`, a contract comment
explaining that recovery fires because nobody wrote the request down, and a `/request` skill built
precisely to remove that — one keystroke away and unreachable the whole time. "Presence is not
installation" is already a rule here for the arms' checkout; it was equally true of this repo's own
skills namespace.

**It is pinned on purpose, and never the working tree.** A broken engine under development must not
break the tooling used to review it — the same property that lets `--repo-root <other-tree>` review a
tree with a known-good orchestrator. It is a `git worktree`, so it carries a real `.git` file and
reports ITS OWN commit rather than this one's; `.claude/dev-install.json` records the pin, and
`check-install` reports how many commits behind the working tree it is, because "I have a dev install"
and "my dev install runs the logic I am editing" are different claims.

It is gitignored: it is a checkout, not content. Tracking it would commit a second engine into the
engine, and leaving it untracked-but-unignored is worse still — the arms' snapshot takes untracked
files that are not ignored, so a whole second copy would ride into the directory the external reviewers
read.

**Set it up per machine, and keep all three local pieces out of git.** Mounting is only half the
install: `QUORATE.md` has to be REFERENCED to reach a session. But that reference, and the record of
what is pinned, both describe one machine — so they live in files git does not carry:

```
git worktree add --detach .claude/skills/quorate <a-commit-you-trust>
echo '@.claude/skills/quorate/QUORATE.md' > CLAUDE.local.md     # gitignored
```

This was committed the wrong way first, and the mistake is the useful part: the import line went into
the tracked `CLAUDE.md`, pointing at `.claude/skills/` — which is gitignored, so **every fresh clone of
quorate got a CLAUDE.md importing a file that clone does not have.** The pin record was tracked in the
same commit, shipping one machine's install state to every consumer. That is precisely the defect this
repository fixed twice before, for `.claude/panel-check.json` and `.claude/tiebreak-check.json`: a
probe of THIS machine must not ship to everyone. `check-install` reports the pin and its distance from
your working tree, so nothing needs to be committed for staleness to be visible.

## Testing against a consuming project

Reviewing itself cannot exercise the consumer mount, `ui-audit`, `feature-verify`, or the
`.claude/skills/quorate/shared/` doctrine path. Those need a real external project, mounted the way
the docs say. Clone one into `.sandbox/` (gitignored) — never work in the operator's checkout.

Every rule below is here because it was broken the first time, and each cost a wrong conclusion or
a silent contamination:

- **Check for skill-name collisions before running anything.** The first fixture shared an ancestor
  with quorate and six names collided, including two lenses the engine spawns; it also shipped a
  `.claude/skills/scripts` and `.claude/skills/shared` on the doctrine-probe path. This was caught
  because the operator warned us, not by anything in the tooling — `SKILLS-SHADOWED` exists now
  because of it. Park **only** what collides or sits on that path: parking a project's unrelated
  skills makes the fixture cleaner than a real consumer and weakens the test. Recompute the list
  rather than reusing it; adopting a skill into quorate can turn a previously safe name into a
  collision.

- **Nothing may escape the sandbox directory.** `pip install -e .` was run to make the fixture's
  tests importable, and it wrote a system-wide editable install pointing at a throwaway clone — so
  `import storypipe` resolved to a disposable copy while the setup was being described as
  contained. Containment means checking what leaves the directory, not what sits inside it. Anything
  that installs, links, or registers globally needs the same care as an outward-facing action.

- **All engine edits happen in this repository.** The mounted copy under
  `.sandbox/<project>/.claude/skills/quorate` is a submodule *checkout*: edits made there exist in
  no branch, are carried by no push, and are discarded silently the next time the pointer moves.
  The clone is read-only apart from its pointer.

- **Sync the pointer before a test run, and read the framework stamp before believing a result.**
  The clone sitting on an older commit is normal for a pinned checkout — it only matters at the
  moment a run is attributed to code that was not running. This happened: `feature-verify` appeared
  still broken when the clone was one commit behind its fix. Every run records the framework commit
  and `dirty` flag, and the gate prints them; the information was there and unread.

- **Updating the submodule is not the same as upgrading the install.** Moving the pointer refreshes
  the engine and hook *logic* (installed hooks are two-line shims). It does **not** add hooks the
  project never installed, and it does **not** touch the `graph_contract` block copied into the
  project's own `CLAUDE.md` — whose *meaning* can change underneath it. `budget_usd_per_node: ""`
  once meant `Number("") === 0`, a $0 cap that blocked every node; it now means uncapped. Same text,
  opposite behaviour, no signal from the text itself. The contract's `graph_contract_version` is the signal: a run whose
  contract declares an older version than the engine implements is stamped `CONTRACT-STALE`
  (`shared/claude-md-contract.md`, `graph_contract_version`), and `check-install` reports the keys the mounted quorate
  knows that the contract does not carry.

- **Presence is not installation, and the arms' directory is where that bites.** The arms do not
  merely read the tree — `doc-consistency-review` and the codex arm shadowing it are ordered to run
  `find-inert-features.mjs`, and every lens prompt names the doctrine file. So quorate has to be
  *installed* in the arms' directory, by the procedure in `QUORATE.md` rather than by a file
  happening to be there: `check-install.mjs` run from inside that directory is the test, and
  `tests/regression-worktree-framework-runnable` holds both layouts to it.

  In THIS repository the arms' snapshot satisfies that by accident, because the framework is the
  repository and its files are in the snapshot. In the consumer mount the framework is a submodule,
  which a snapshot holds only as a pointer — as the `git worktree add` it replaced left an EMPTY
  DIRECTORY, and `panel-codex-docs` reported "the required
  doctrine file and mandatory find-inert-features.mjs detector were absent", an accurate report
  about a checkout this engine had built for it, recorded in the gate as the ARM being unavailable.
  The accident was the problem: the layout that worked for free hid the one that did not.

  Two things that look like formalities are not. The detector refuses outright without a readable
  `graph_contract`, so a mounted-but-unreconciled contract is an uninstalled framework; and a copied
  framework has no `.git`, so anything asking git for its version gets the ENCLOSING repository's
  commit unless the copier wrote down what it copied.

## Working on this repository

**When a session stops, and what it asks the operator**, is owned by `shared/session-rules.md`; the stop guard
(`.claude/settings.json`) holds the stopping half.

Two rules about the SESSION rather than the graph. Both were measured on 2026-09-20, the first time
the conversation's own context was attributed: **tool results 44.6%, the supervising agent's thinking
32.2%, its tool calls 18.3%, the operator's messages 1.0%, and node output 0%.** Nothing this engine
spawns reaches the conversation. It is filled by the supervising agent's own work, and every token
that lands there is re-read on every later turn.

**Exploration is delegated; verification is not.** An agent may be spawned to search, survey, count
or read logs, and to draw a conclusion from what it finds. It returns four things: the **instrument**
-- the exact command it ran, verbatim -- a **digest**, **keys** naming the files its raw output was
written to, and, for every claim, a citation of the form `key#lines`. The caller reads the instrument
always, and an excerpt only when a decision turns on it.

The instrument is the load-bearing part. The day this rule was written, a deferral list was
enumerated with `grep -rn "_00000[0-9]"` -- a pattern matching only ids 000000 through 000009 -- and
reported four lines where there were thirty-one. A digest of that search is confidently wrong and so
is the raw output behind it; only the command shows the error, and reading it costs about fifty
tokens. **Delegation buys context, never correctness.**

Spawn when the expected output is large or the search is wide. A one-line answer costs more to
delegate than to run.

**State in-flight work on disk before `/clear`.** The cost is not in clearing, it is in clearing with
nothing written down. Measured on the `/clear` of 2026-09-20: recovering what "the next two sections"
referred to took 388 of that session's 1,876 messages, 63 tool calls and 43.5% of all its
tool-result bytes -- about 77k tokens of permanent context, re-read roughly 250 times. A plan file or
a request document would have made it one `Read`. Written down, `/clear` is cheap enough to do more
often rather than less.

## Graph verification contract

Every command, path and budget is read from the block below, and so is every LENS model. Nodes never
discover their environment. `shared/claude-md-contract.md` documents each key.

**The external arms are the exception, and they are configured next to the reviewer that has to
accept them** (G-2): an arm's model and effort live in `scripts/lens-roster.json` under
`panel_arms`, because a model name is only meaningful paired with a CLI — codex and agy disagree
even about how an effort is spelled. Changing `review.models.judgment` moves every Claude lens and
no arm. The **adjudicators** — a judge SET under `adjudicators`, not a tie-breaker — are pinned there
for a third reason, stated in that file: an unpinned judge cannot promise it is a different family
from the lenses it is deciding between. A judge's family is its adapter's, declared once in `scripts/reviewers.json` and read by
`familyOfCall` (`scripts/lib/reviewers.mjs`); a `family` the roster gives a judge is only checked against it. That file
also records what pinning does NOT buy (G-1): neither shipped judge is
neutral, because every panel arm runs on codex, so on a lens-versus-arm dispute the codex judge is a
party to its own family's position. The merge labels that per judge rather than hiding it. This
paragraph pointed at a `tie_breaker` key the roster no longer has, and implied a neutrality the file
it cited spends a paragraph denying.

The block may live here or in `.claude/rules/quorate-contract.md`, which is preferred for a
CONSUMING project because it is a file quorate may own and update. This repository keeps its own
contract here: the engine and the contract ship together, so there is nothing to install and
nothing to drift. Two locations carrying blocks that DISAGREE is refused, both paths named; two
carrying identical blocks is a migration in progress and is allowed, with the redundant copy
reported. Every run records which file it read, in `run.json` under `contract_source`.

A key that is empty means the corresponding check is skipped and named verbatim in the run's
`not_checked[]`, and the run still passes on what remains. Do not fill a key with a command that
does not run.

```yaml
graph_contract_version: 6
project: quorate
commands:                 # exact, runnable from repo root; "" = not available
  build:     "node scripts/check-syntax.mjs"   # parses every source file; see "Building" above
  test:      "node tests/run-all.mjs"
  # The framework IS the product here, so there is no second suite. In a consuming project this key
  # holds that project's own tests; run-all.mjs reads it from the contract rather than hardcoding
  # it, which is what keeps the engine free of any consumer's name.
  test_product: ""
  # ONE test file, filled into {file} by capture.mjs, for a remediation node's red and green checks only;
  # the full suite after a remediation is the runner's, through `test`.
  test_one:  "node --test {file}"
  lint:      ""           # no linter configured; zero runtime dependencies is a property worth keeping
  fmt_check: ""           # no formatter configured
  typecheck: ""           # plain ESM, no TypeScript
  bench:     ""           # nothing measured; perf-audit is therefore static-risk-only
  run:       ""           # a library and a CLI, not a launchable app; feature-verify is SKIPPED
  audit:     ""           # no package.json and nothing installed (third_party/ is vendored and pinned byte for byte), so nothing to audit
  deny:      ""
  shell:     ""           # "" = launch argv-split with no shell
source_globs:    ["scripts/**", "shared/**", "skills/**", "prompts/**", ".claude/hooks/**", "extractors/**", "bench/**/*.mjs", "publish/**"]
# publish/** is source: the release manifest and the published CLAUDE.md decide what ships, so a review counts a
# finding there and a remediation may edit them.
test_globs:      ["tests/**", "**/*.test.mjs"]   # a generated_globs file is neither (precedence: below)
# test_globs WINS over source_globs for a file matching both. Test code is reviewed under one
# question — does this test actually constrain the behaviour it claims to? — and that is what stops
# "every bug gets a test" from recursing. See shared/disk-first-protocol.md §4.
# bench/README.md and bench/**/*.md are documents: they hold the corpus format and the measurements this contract
# cites, and the harnesses beside them (bench/**/*.mjs, source) produce those figures. A file no glob covers can
# carry a finding a review never counts (shared/disk-first-protocol.md §8, rule 5). bench/results/ holds raw run
# output, not documents or code, and stays outside.
# extractors/README.md is the contract a contributed extractor follows, which a review must read as a document.
doc_paths:       ["shared/**", "CLAUDE.md", "QUORATE.md", "ARCHITECTURE.md", "ROADMAP.md", "bench/README.md", "bench/**/*.md", "extractors/README.md"]
generated_globs: [".claude/reviews/**", "node_modules/**", "third_party/**"]
# third_party/** is vendored code quorate did not write, held byte for byte by
# tests/regression-third-party-pinned.test.mjs rather than reviewed; it is a pre-flight input, since the suite
# reads it and capture runs it.
doc_roles:
  # Declared so that arch-review runs against a specification: with the key empty it is capped as
  # shared/disk-first-protocol.md §7 states, and cannot cite architecture_doc. Declaring it
  # moves arch-review from degraded:true / RISK / [convention, invariant] to
  # degraded:false / no ceiling / [architecture_doc, invariant, convention].
  #
  # ARCHITECTURE.md is a specification rather than a description for exactly that reason: a sentence
  # there can raise a finding above RISK, so one that cannot be checked grants authority to a claim
  # nobody can test. It also blocks the decision layer — a grounding floor (§7, A-22) above
  # `convention` is unreachable while `architecture_doc` is not an available basis.
  architecture: "ARCHITECTURE.md"
  roadmap:      "ROADMAP.md"   # M0 finish the remediation, M1 story-pipeline, M2 public 0.x, M3 v1
  spec:         ""
  # Empty in a copy of quorate: no request is declared, so a review finds an approved request in your own
  # .claude/requests/ (a folder you create; none ships) or recovers one, as shared/claude-md-contract.md
  # describes. Name the request your work
  # answers here, or pass --request to new-run. (The development repository records here which request each
  # stretch of work was judged against; that history stays with its private design records.)
  request:      ""
ui:
  surface: none           # no interface; ui-audit is not selected
  static_bundle: ""
# Declared with no languages: quorate has no Python, and its own JavaScript is plain ESM modules, not the
# <script>-in-HTML shape the reference extractor serves. Every query here answers not_configured.
code_index: {}
hooks:
  # The secret scan on every push (pre-push hook) and over the whole history in CI. required | off;
  # ABSENT means required, and any other value is refused rather than guessed. Required with gitleaks
  # not installed BLOCKS the push.
  secret_scan: required
threat_model: >
  A developer tool that spawns subprocesses carrying the operator's credentials, writes to a run
  directory, and executes commands declared in a consuming project's CLAUDE.md.
  In scope: arbitrary command execution through contract keys or capture.mjs; credential leakage
  into child processes; escape from the intent sandbox that keeps a node from reading the
  implementation it is supposed to precede; path traversal through run directories or evidence
  paths; a node spawning further nodes; source leaving the machine through the external panel.
  A contract overriding a built-in adapter is trusted like a command it declares, and is named
  wherever the override runs (ARCHITECTURE.md A-26).
  A link already standing below a run directory, or below another root the owner is given, is in
  scope; ARCHITECTURE.md A-30 owns which operations are held to it and how. A link swapped in
  between a check and an open, by a process that can already write the run directory, is a named
  residual.
  Out of scope: network listeners, authentication, multi-tenancy, transport security — this
  process serves nothing and listens on nothing.
review:
  concurrency: 3
  # DECLARED rather than left empty, because this repository can answer the question honestly and an
  # empty value would cost a RISK ceiling on every reused result.
  #
  # The set is wide on purpose. `node tests/run-all.mjs` is not a suite that reads only src and
  # tests: check-counted-facts reads CLAUDE.md, the contract-key ratchet reads CLAUDE.template.md
  # and shared/claude-md-contract.md, regression-prompts-out-of-scripts reads prompts/_templates,
  # and several tests read skills/**. A narrower declaration would be a shorter list that was also
  # false, and a false input set is worse than an inferred one -- it claims proof it does not have.
  #
  # There is no dependency manifest to name: this project has no package.json and installs nothing (third_party/ is
  # vendored and pinned byte for byte, and named in preflight_inputs),
  # which is a property worth keeping and the reason the manifest heuristic finds nothing here.
  # One line: the contract parser reads a flow sequence on the key's own line and refuses a
  # continuation, which is a limit worth knowing before a longer list tempts someone to wrap it.
  # The pre-flight cache is bounded by SIZE, least-recently-used evicted, the newest entry always
  # kept. Absent = 256 MB, "" = uncapped, a number = that many megabytes.
  preflight_cache_max_mb: 256
  # The code index's own cap and extractor ceiling, declared at their defaults so the choice is on the
  # page; code_index is {} here, so neither is used yet.
  code_index_cache_max_mb: 256
  code_index_timeout_minutes: 10
  # The snapshot the external arms read is refused when the working state's changed and untracked files
  # exceed this — the guard against a linked directory leading to a large tree outside the repository.
  # Absent = 1024, "" = uncapped.
  panel_snapshot_max_mb: 1024
  # How old a passing reviewer probe may be before the next call probes again (a key change probes again
  # too). Absent = 24, "" = no age limit, a number = that many hours. Declared at the default so the
  # choice is on the page: a codex or agy update between two reviews keeps its CLI version, and a day bounds how long a
  # probe of the old behaviour can vouch for the new one.
  reviewer_probe_max_age_hours: 24
  # How long the session records (the stop record, the command log) keep a session's folder. Absent = 30, a whole
  # number = that many days, 0 or any string = no limit. Declared at the default so the choice is on the page.
  session_record_retention_days: 30
  # The ceiling on each pre-flight check. Absent is 10 minutes, which kills the suite of a consumer whose
  # tests take longer on every review. This repository's full suite has taken about 15 minutes on a loaded
  # machine, and a candidate check killed while its tests are still passing reports nothing, so 25 keeps
  # about 1.7x headroom.
  check_timeout_minutes: 25
  preflight_inputs: ["scripts/**", "tests/**", "prompts/**", "shared/**", "skills/**", ".claude/hooks/**", "CLAUDE.md", "CLAUDE.template.md", "QUORATE.md", "ARCHITECTURE.md", "ROADMAP.md", "bench/README.md", "bench/**/*.md", "extractors/**", "third_party/**", "publish/**"]
  # What this suite needs beyond the platform's process basics when a remediation's candidate is checked:
  # only these, which the code index's extractor tests need to run inside that check rather than skip
  # (measured with tests/tools/run-under-candidate-env.mjs on Windows and on Linux; macOS unverified).
  # None is secret-shaped. Set them before a remediation of extractor code; unset, the tests skip as before.
  candidate_env: ["QUORATE_ACORN_DIR", "QUORATE_REQUIRE_PYTHON", "QUORATE_REQUIRE_ACORN"]
  # 30 rather than 15, measured rather than guessed: lenses that read every declared document IN FULL
  # (arch-review, doc-consistency-review, second-opinion) ran 13.5 to 15 minutes, and one was killed at a
  # 15-minute cap. A per-lens override would only have moved the next failure to a different node. This
  # is the same cause intent_timeout_minutes records below: a node that reads every declared document does
  # not fit a cap sized for a node that reads a diff.
  #
  # The cost is real and is accepted: a genuinely hung node holds a concurrency slot for 30 minutes rather
  # than 15. That is the lesser harm — a timeout kills a required lens mid-verdict and discards everything
  # it produced, which is the BLOCKED-over-nothing outcome the cap exists to prevent, not to cause.
  #
  # A remediation node checks each fix with commands.test_one in seconds and leaves the full suite to the
  # runner, so 30 fits it too; its own limit stays configurable through the roster's remediation entry
  # (remediationTimeoutMinutes).
  node_timeout_minutes: 30
  barrier_timeout_minutes: 35   # the reconciler reads every lens AND every arm at once; a large panel run broke a 15-minute cap
  intent_timeout_minutes: 30    # intent-capture reads every declared doc IN FULL; growing shared/** killed it at the 15-minute cap
  # Uncapped by choice. "" = no dollar ceiling on that tier; the run is stamped
  # UNCAPPED-BUDGET and each uncapped tier is named in the gate's not_checked[]. A consuming
  # project that copies the template stays bounded — CLAUDE.template.md declares explicit numbers
  # (4.00 / 7.00 / 32.00), so uncapping is a decision that project makes rather than one it
  # inherits from this file. Set a number here to re-arm a ceiling.
  #
  # Three states, not two: absent = built-in defaults, "" = uncapped, a number = that ceiling. A node
  # cap can kill a required lens mid-verdict, which is exactly the BLOCKED-over-nothing outcome a
  # ceiling was supposed to prevent, not cause.
  budget_usd_per_node: ""
  budget_usd_per_barrier: ""
  budget_usd_per_run: ""
  # EMPTY on purpose since graph_contract 2: a run is STAGED under the engine's own home and moved
  # back here when it ends. Writing them in-tree LIVE forced four separate places to EXCLUDE the
  # run directory — the tree hash at mint, the tree hash at the gate, the working-tree mirror into
  # the arms' checkout, and the intent sandbox — and two defects came from that class rather than
  # from any one exclusion: `mirrorWorkingTree` copied the LIVE run directory into the tree the
  # external reviewers read, and `worktreeSha` reported every run's own tree as moved.
  #
  # The evidence trail keeps growing: the run returns to .claude/reviews when it ends, so nothing
  # needs backing up separately — except its evidence/, which moves only when git would ignore it there,
  # and otherwise stays staged with the gate saying where (shared/claude-md-contract.md, `reviews_dir`).
  # The cross-run LEDGER never staged at all — it stays tracked at
  # .claude/reviews/ledger.json, because it is this project's memory rather than one run's artifacts.
  #
  # Declare a path to write runs straight there with no staging — the old value restores the old
  # behaviour exactly. `run-graph --no-archive` leaves one finished run staged instead, and a run
  # KILLED mid-flight stays staged either way, which is where `--resume` expects to find it.
  reviews_dir: ""
  models: { judgment: opus, mechanical: sonnet }
  # MEASURED on the 7-seed bench corpus at uniform settings, with the panel OFF, deliberately: this key
  # moves every Claude lens and no arm, so a sweep carrying arms cannot measure it. A seed the lens MISSED
  # and an arm CAUGHT still scores as caught, which masks a regression in the direction that looks fine.
  #
  #   opus/medium   7/7   7 fp   7,537,298 tok   18.2 node-min   $10.16
  #   opus/low      7/7   1 fp   4,345,509 tok   10.1 node-min    $7.26
  #
  # ADMITTED by DOMINANCE -- better or equal on tokens, wall-clock and false-positive candidates,
  # strictly better on all three, no seed lost. The cheaper setting produced LESS noise, which is the
  # reason to read the fp column first. Gated by `node scripts/bench-admit.mjs --position lenses`; the
  # runs, and the earlier step from xhigh to medium, are in bench/RESULTS.md.
  #
  # NOT benched, and therefore not covered by this number: arch-review, perf-audit, ui-audit and
  # feature-verify have no seeds in the corpus. `low` IS THE FLOOR of the runtime's declared ladder and
  # it held, so this corpus shows a CEILING EFFECT at 7/7 and cannot say where the setting would begin
  # to break -- only that it had not broken by the bottom rung. The corpus holds seven small seeded
  # diffs, so a review of a large diff may need a higher effort, set here for that run and set back. And
  # nothing here describes a run WITH the panel, which is how real reviews run.
  effort: { judgment: low }
  # ON: cross-family review is the standard for any review here, not a code-review special case —
  # same-family agreement may be one opinion counted twice. Enabling this sends the prompt, and
  # whatever files the arm chooses to read, to the reviewer's cloud (the prompt is the floor of what
  # leaves, not the ceiling) — accepted for this repository, which is public. See
  # shared/external-reviewers.md.
  external_panel: true
  # The session's conversation goes to the cross-family claim checker too, redacted, so attributions are
  # checked across families; commands and their outputs are dropped (lib/transcript-reduce.mjs).
  # `same-family` is the fallback, kept one line away for when the other family's quota is the smaller
  # one. Absent means `same-family`.
  claim_check_transcript: cross-family
  # A question with options goes to the decision panel (Claude, Codex and agy, blind, by majority) instead of the
  # operator. off | on; absent = off.
  decision_panel: on
  # The panel's talking rounds before the moderator is asked, and the hard cap it may extend to, both
  # contract keys. Declared at the defaults so the choice is on the page.
  decision_rounds: 3
  decision_rounds_max: 6
  # How many spends (reviews, remediations, bench runs) a run may start on delegated answers; "" = no bound
  # (the default), and a number caps a run without a coding round.
  run_spend_max: ""
  # How long a run may last before it stops and says so; absent = 72, "" = unlimited.
  run_time_limit_hours: 72
  # The floor of ARCHITECTURE.md A-22: a panel decision whose basis is at or above it is settled by the panel, one below
  # it goes to the operator. One of the basis values of disk-first §4; absent = measurement. Declared at it.
  grounding_floor: measurement
```

### Known contract consequences

`shared/claude-md-contract.md` owns what every key MEANS. This table is the shorter question — what
an empty key does **to this run** — and where the two disagree, the owning document wins (G-2). It
was a second telling of the same semantics, and the copies had already drifted: this one omitted the
owner's promise that an unbenchmarked perf finding is recorded at `LOW`, which turned out to be a
defect in the code as well (that floor was a no-op).

| Empty key | Effect on this run |
|---|---|
| `lint`, `fmt_check`, `typecheck` | Named verbatim in `not_checked[]`; no static analysis beyond parsing. |
| `bench` | `perf-audit` is static-risk-only, its verdict capped at `RISK` and every finding capped at `LOW` — except a §6 invariant, which is never capped. Run stamped `UNBENCHED`. |
| `run` | `feature-verify` is `SKIPPED` and appears in the gate's Not-checked table. |
| `audit`, `deny` | Named in `not_checked[]` like every other empty key — the run states there was no dependency surface to check rather than leaving the gap invisible. |
| `doc_roles.architecture` | `arch-review` degrades to convention-only, capped as `shared/disk-first-protocol.md` §7 states. |
| `doc_roles.request` | Discovery, then recovery — the sequence and its stamps are owned by `shared/claude-md-contract.md`, which this table deliberately does not restate. It was restated here, and a later change to the search path left this copy stale while the owner was correct (panel-codex-docs). |
| `external_panel` | `second-opinion` runs its single arm; the run is stamped `PANEL-ABSENT`. |
| `external_panel: true`, transport unprobed | The offline suite never invokes a reviewer CLI, so nothing in it exercises a transport. The run does: every arm and adjudicator combination is probed before its first use, and a mint whose reviewers fail is refused (`--no-verify-reviewers` skips the check, stamped `REVIEWERS-UNVERIFIED` and capped at `RISK`). `QUORATE_LIVE=1 node scripts/check-reviewers.mjs` checks the whole panel on demand. |
