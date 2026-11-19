# Session rules — when a session stops, and what it asks

The one owner of what a working session (the agent the operator talks to, not a node the graph spawns) may do without
asking, what waits for the operator, and how it stops. Source: `.claude/requests/autonomous-run-pauses.md` (approved
2026-10-24), parts 1 and 2 of `autonomous-run.md`. `QUORATE.md` and this repository's `CLAUDE.md` point here; neither
restates it. A consuming project overrides it with `.claude/quorate/session-rules.md`, which replaces this file for that
project's sessions: what they may do without asking, what waits for the operator, and what a stop for the operator
says. The stop guard does not read the override's prose: it still enforces the markers of **Stopping** below, and its
refusal names the override as the rules to follow.

## Stopping

A session continues while work remains. It stops voluntarily only for one of five reasons, and names it on the **last
line** of its final message:

| Last line | When |
|---|---|
| `Stop: done` | the task is done |
| `Stop: question` | a question needs the operator |
| `Stop: reserved` | a decision this file reserves for the operator (below) |
| `Stop: error — <what>` | an error the session cannot recover from |
| `Stop: limit — <what>` | a limit of the run is reached: its time limit (`time limit`), a reviewer's usage limit when no other work can proceed without that reviewer (`<reviewer> quota`), or its spend bound (`spend bound`) |

Only the last line names the stop. A message with more than one line shaped as a marker is ambiguous, and the guard
blocks it once so the session keeps exactly one (operator, 2026-10-25: "B"); a marker quoted inside a sentence is text.

**Waiting is not stopping.** While a process the session started is running, it starts another task if one can start:
one inside approved work that does not change what the running process reads (no editing tests while the suite runs).
If none can, it waits for the process; ending the turn to be woken by the process's notification is how the harness
waits, and the session says so with a last line `Stop: wait — <what it waits on>`. That line is the session's statement
that no other task could start; whether that is true is its judgement, which nothing here can check.

A stop the session did not choose (a crash, a timeout, a killed process) is recorded with the only cause known: the turn
ended without a Stop. It is recorded when the session's next turn starts, since only that shows the turn had ended;
until then, the record holds it as an open turn.

**A stop for the operator** (`question` or `reserved`) names the action, why it waits for them, a concrete question with
its options (each with its pros and cons) and a suggestion, and the work done or continuing meanwhile that does not
depend on the answer.

The stop guard (`scripts/stop-guard.mjs`, Claude Code's `Stop` hook) holds this: it blocks, once, a turn end with no
marker, a wait while a task runs that was not declared, and a `question` or `reserved` stop with fewer than two options;
a second attempt is allowed and counted. An option is a line of its own that starts with a bullet (`- ` or `* `) or a
label (`A.`, `B)`, `1.`, `2)`, optionally in bold), after the line that asks the question; a table row or `1:` is not
read as one, and the guard checks only that two such lines follow the question (the first line that ends in a question
mark), not that they answer it. Turn starts and ends are
recorded under the engine's home, a folder per session, its files rotated by size and its folder removed once older
than `review.session_record_retention_days` (what its values mean is `shared/claude-md-contract.md`'s), and `scripts/stop-log.mjs --summary` reports them (until telemetry takes the record
over); each turn end carries the decision panel's state when it was recorded (`on` or `off`), a `StopFailure` ending
included, so the summary sets flag-on turn ends and involuntary endings beside flag-off ones, a zero row for a state
not seen. An ending found only when the next turn started carries the panel's state as that turn start reads it; an event
recorded before turn ends carried the state, or one whose state the guard could not read, is counted as not recorded. Recording never blocks a turn: when an event cannot be written (an engine home inside the repository, which is
refused, the record's lock held past its wait, a disk error), the guard says so on stderr, allows the turn, and the
event is missing from the record. The record is bounded: every append is made under its lock, so it keeps the current
file and one previous file, each rotated once it passes 4 MiB and so at most 4 MiB and one line, and older events are dropped, so the summary adds up only what is kept
and says from when. Retention may be off, so a read of the record is capped too: it holds at most the newest 200,000
events across every session (`STOP_READ_MAX_EVENTS`, `scripts/io/stop-log.mjs`), and reads at most the newest 1,000
sessions by their last write (`STOP_READ_MAX_SESSIONS`); a summary over more says it covers only the newest and how many
it left out. Old sessions are swept, by the retention age, at most once an hour (`STOP_SWEEP_INTERVAL_MS`), by the
first write after the hour, a new session's or a later write of one already started: the marker saying when the last sweep began is read and set under the record folder's lock, so
two sessions starting together do not both sweep.

### With the decision panel on

With `review.decision_panel: on` (and `review.external_panel: true`, which the panel needs; `shared/claude-md-contract.md`
owns both keys), a question with options that would go to the operator goes to the decision panel instead:
`node <framework-root>/scripts/decide.mjs --question <file>`, and the session goes on with its answer. The question file
is JSON: `question`; `options`, each a `label` and a `description` (two or more); `category`, one of the ids in "What
waits for the operator" below or `delegable`; and optionally `stage`, the plan stage the question belongs to, and
`since`, the commit the work context's changed files are counted from, and `evidence`, the paths of the captured
artifacts the question rests on: only a seat citing one of them is grounded by `measurement`, so a question with no list
goes to the operator whenever the floor is `measurement` (`.claude/requests/grounding-and-retry-evidence.plan.md`). A reserved category is refused by `decide.mjs`:
those stay the operator's, flag on or off.

Before starting a review, a remediation or a bench run on an answer the panel gave, the session counts it:
`node <framework-root>/scripts/decide.mjs --count-spend <decision-id>`. Exit 0 starts it; exit 4 means
`review.run_spend_max` is reached, and the run ends with the last line `Stop: limit — spend bound`.

A `Stop: question` is then for one of these things only: a reserved decision, its category named in backticks (for
example `` `approval` ``); a decision the panel postponed, its record id on the line (`postponed: <id>`); a decision whose basis is below
`review.grounding_floor`, which `decide.mjs` sends to the operator with the panel's positions as the options, its record id on
the line (`to-operator: <id>`; ARCHITECTURE.md A-22); a decision the panel could not take because fewer of
its seats answered a round than its quorum (`QUORUM` in `scripts/lib/decision-panel.mjs`), which `decide.mjs` ends at once and names each silent seat with why, its record id on the
line (`seats-unavailable: <id>`); or a question without options. Where a delegated answer is recorded (a design note's status, a brief), it reads "decided by the panel
(`<id>`)", never the operator. The stop guard holds this: with the flag on, it blocks once a `Stop: question` whose
message asks a question with options (the same reading of options as above) and names neither a decision record id
(`YYYYMMDD-HHMMSS-xxxxxx`, as `decide.mjs` mints it) nor a reserved category; flag off, it is as above. A contract the
guard cannot read, or a value its reader refuses, reads as off.

### A long run

`node <framework-root>/scripts/run-session.mjs start --plan <path> [--until <stage>]` starts a run on one approved plan
(its front matter `status: approved`; anything else is refused) and keeps its state under the engine's home, outside the
repository: the plan, the stage it may stop at, its start, and its time limit (`review.run_time_limit_hours`,
`shared/claude-md-contract.md`). The session's id is bound by the first hook that runs in it. While a run is active, the
`SessionStart` hook (`run-session.mjs --session-start`) and the stop guard's turn start print it into the session, so a
resumed or compacted session knows where it is; the session continues at the first stage of that plan not yet done.
`run-session.mjs status` and `stop` show and end it. After a crash or a reboot, `node <framework-root>/scripts/resume-run.mjs`
prints the line that reopens the run's session, built from the runtime adapter's `resume_argv`, and `--exec` starts it.

Once a day, each CLI the engine runs (the node runtime and every reviewer the roster calls) is compared with the version
its adapter's `latest_version` query reports as published; a CLI behind for **3 days** or more is reported at session
start and turn start. The cache answers for one adapter table, the built-ins with the contract's overrides merged, and
records which; the hooks read the comparison from that cache only, and print nothing from a cache computed for another
table. A session start or turn start that finds the cache not from today, or from today but for another table, starts the
comparison in a detached process, its environment scrubbed of secrets, and never waits on it, so a CLI can be reported a
day late; once one is started, no other starts for that table for ten minutes, so the turns that land before it finishes
start none. It is never updated: that changes the operator's environment, which waits
for them. `run-session.mjs freshness` runs the comparison now and lists every CLI's state; a CLI whose adapter declares
no query, or whose query failed, is listed there as not checked, and the hooks print nothing for it.

At the time limit the turn-start print says so, and the session ends with `Stop: limit — time limit` (operator,
2026-10-31: "1 a"). A limit is its own reason so a run cut short is counted apart from a finished task.

**Usage limits.** Claude Code's own usage limit is the harness's to wait out: an interactive session waits for the reset
and continues by itself (stage 1 of `.claude/requests/autonomous-run.plan.md`, quoting Claude Code's documentation).
That wait is kept (operator, 2026-10-31: "2 a"); the `StopFailure` hook (`stop-guard.mjs --stop-failure`) records each
turn that ends on an API error, a usage limit among them, in the stop record with its error, its details and the reset
text the message gives, so the gap is explained. A reviewer's own usage limit (codex, agy) is not the harness's: a call
that fails with text matching the adapter's `quota_patterns` (`scripts/reviewers.json`, unverified until a real one is
seen) is recorded as `kind: quota` with its reset text, the session goes on with work that does not need that
reviewer, and ends with `Stop: limit — <reviewer> quota` when nothing else can proceed (operator, 2026-10-31: "3 a").

## What waits for the operator

<!-- rule:reserved-decisions -->
- **Approvals** (`approval`): of a request, a plan, a decision, or an operator close in the ledger.
- **Destructive actions** (`destructive`): anything that cannot be undone from git or from a backup. A backup counts only when it is known to be taken and up to date; it is never assumed.
- **Changes to the operator's environment** (`environment`): installing or updating a program, global configuration.
- **Starting an installed program unrelated to the work** (`unrelated-program`).
- **Changes to what governs every run** (`governing-change`): the contract, the lens roster, or ARCHITECTURE.md (ARCHITECTURE.md A-23, item 3).
- **Egress metered per call by an API key** (`metered-egress`): a call billed per invocation against a key, not subscription egress (ARCHITECTURE.md A-23, item 4).
<!-- /rule:reserved-decisions -->

### What holds it, and what is logged

The deny rules in `.claude/settings.json` refuse the destructive and installing commands that have a fixed spelling:
the destructive git commands, the package managers' install and sync commands, system installers, CLI self-updates,
and the evaluators `iex` and `Invoke-Expression` (so a download piped into one is refused). A deny is absolute: an
approved one is run by the operator, or the rule is lifted first. The fetchers (`curl`, `wget`, `irm`, `iwr`) stay
allowed, to retrieve documents; a download piped into a shell (`| sh`, `| bash`) cannot be told by its name from a
script run in the repository, so it is not refused.

That gap is why **every command is logged before it runs** (operator, 2026-10-25): `scripts/command-log.mjs`, a
`PreToolUse` hook on the Bash and PowerShell tools, writes each command under the engine's home, with
every secret of a shape `scripts/lib/redact.mjs` knows replaced, and those of a command line's own shapes that
`scripts/lib/command-log.mjs` knows (a secret-named variable, `-u user:password`, a URL's password, a credential flag's
value). That redaction matches shapes and is best-effort: a
secret of any other shape is written as typed, so the log is not a place a credential is safe. A command that cannot be logged is not run: the hook's command ends in `|| exit 2`, so a log that cannot even
start (a syntax error, a missing module) blocks the command too, rather than letting it run unlogged. `scripts/command-log.mjs --summary` lists the log, marking fetches,
pipes into a shell and installs first.

## What needs no confirmation

When the action is part of approved work and its conditions hold (this is not a mandate to do each whenever possible):

- **A push** to a branch, or of stable work. A push to `master` when the work is done and works: the suite green, the
  tree clean, and the work's review having met D1. How often to push is the project's own rule (CI minutes cost).
- **Starting an installed program related to the work.**
- **An action that implements a request or decision the operator approved**: a consumer's contract or hook change a
  quorate request introduced; the external panel's and candidate-pool's egress under the contract; moving a consumer's
  quorate pointer to a commit that is stable and approved by quorate (its review met D1), with the message to that
  project's session. The session cites the approved request's path when it acts on it.
- **Publishing a private document** (a claude.ai artifact or another host's) that breaks no rule its host imposes.

Where a rule here and an instruction in a session's own memory or a project's file disagree, the operator's latest words
decide; a rule that cannot be shown to apply to the action at hand is a question, not a permission.
