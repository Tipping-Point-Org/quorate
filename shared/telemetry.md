# Telemetry: the run records and the report

A finished run writes a record of what it cost and what it caught, and `scripts/telemetry.mjs report` adds the
records up. Writing it is best-effort: a record that cannot be built or written is a note in the run's output, never a
failed run, and a review stopped at the pre-flight barrier exits before its writer. Such a run has no record until
`telemetry.mjs backfill` writes one, so the report covers the runs that have records, not every run that finished. This document owns the record's format, where records are written, and what each report figure means. The
ask is `.claude/requests/telemetry-recommendations.md`; this is its first part (`.claude/requests/telemetry-records.plan.md`).
Recommendations, thresholds and queries are its second part, not built (ROADMAP.md, M2 item 6).

Nothing here is sent anywhere. Records are local files, and the report reads only local files.

## The record

At most one JSON file per finished run, written best-effort as above, built by `scripts/lib/telemetry-record.mjs` from
the run's own files (the writers' half is `scripts/io/telemetry-record.mjs`). `schema_version` is 1.

- **What it holds:** counts, ids, model and effort names, times, the runtime's usage objects, statuses and verdicts.
- **What it never holds:** model text. No finding, claim, rationale, prompt or output. A test walks every string in a
  record against the builder's declared fields (`RECORD_STRING_FIELDS`, and inside the usage objects
  `USAGE_STRING_FIELDS`).
- **Absent is null, never zero.** A field a task did not give is `null`: an unpriced task is not free, and an untimed
  one is not instant. Every task carries the whole task shape, whatever its kind.
- **Usage is projected, not copied.** Tokens are kept in the vendor's own fields, as numbers; a string inside a usage
  object is kept only under a vendor-label key (`USAGE_STRING_FIELDS`: service tier, region and the like), and only as a
  short label (letters, digits and `_.:/-`, at most 64 characters, and no secret shape `scripts/lib/secret-shapes.mjs`
  defines); any other string is dropped, and so is anything nested
  eight levels deep or more, so a usage field can be absent from a record although the runtime reported it. A usage
  object's keys pass the same test: a key that is not a short label (`[` and `]` allowed, for a model name), or that has
  a secret shape `scripts/lib/secret-shapes.mjs` defines, is dropped with its value. The runtime's
  result labels (stop reason, subtype, terminal reason, API error status) are kept under the same label rule, and are
  null otherwise. A cost is the vendor's (`total_cost_usd`, list basis), never one computed here.
- **One task per thing the run did.** Each node, each re-ask batch (the aggregate re-ask status, which sums them, is not
  a second task), each adjudicator, each declared check (and, for a remediation, its formatter baseline and each check
  of each candidate) is a task. A bench record has a task per seed and node the bench recorded anywhere, and a
  second-opinion bench a task for each priced forge; a seed the bench paid for and did not score (`unscored_spend`) is a
  task with state `UNSCORED`. A results file its bench marked `not_a_measurement` (a forge file) has no record, and a
  record beside one is not read. A task has its kind, family, model, effort, state, start, end,
  duration, usage, cost, exit code, signal, whether it timed out and the limit that applied, and the runtime's own
  result fields when it gave them. Its process facts (times, duration, exit code, signal, timeout and limit, usage,
  family, and its `outcome`: `answered`, `no-answer`, `no-output`, `timeout` or `stopped`) come from its call's entry,
  built where the runtime was called (`lib/call-entry.mjs`; `shared/adapter-contract.md`), so an external reviewer's exit
  code is the vendor process's; a status from before the entries gives them as it recorded them. A claim check's record
  also keeps its `steps`, the step journal each `--check` appends as each step ends (`steps.jsonl`), and the exit code
  the check ended with; a checker is `FAILED` only when a step charged to it failed. An error is kept as its kind and one line, by the rule the command log's after line
  uses, whose one owner is `errorLine` in `scripts/lib/command-log.mjs`: `error_kind` and `error`, from the task's first validator error with every
  value it quotes (the node's own envelope text) dropped, or a check's capture error and outcome detail; null when it
  reported none.
- **Family.** The model's, declared on the adapter that served it, by the one rule `familyOfCall`
  (`shared/adapter-contract.md`): `openai` for codex, `anthropic` for Claude, per model for agy. The adapter is an arm's
  or judge's reviewer, a finding's `source` when that is a reviewer the roster declares (a lens finding's `source` is its
  model name), or the runtime for a node that runs on it (one the roster names, or one of the engine's own kinds); any
  other node is `unknown`, and so is every declared check and every bench task, which name no family. The runtime is the one
  the run or check froze (the contract's `review.runtime`, else `run.json`'s `host.runtime`; a claim check's
  `same_family.runtime`), never today's configuration, so a backfill classifies an old run as it ran; none frozen is
  `unknown`.
- **Corroborated.** A group the reconciler decided `confirmed` that holds a finding of each family; `unknown` is not a
  family here, so it neither corroborates nor is corroborated. The reconciler's
  decision is the authority, because proximity groups are "not a corroboration claim" (`prompts/reconcile/PROMPT.md`).
- **Development data.** `development_data` is true when the engine reviewed its own repository (the framework root is
  the repository root). It is data for improving the tool, not a measure of how the tool serves a consuming project.
- **A run's start.** A review's or remediation's record starts at `run.json`'s `graph_started_at`, which `run-graph.mjs`
  records once, as it admits the run (a `--resume` keeps the first); a run from before that field starts at its mint's
  `created_at`. `started_from` says which (`run` or `mint`). Its end is the later of its last non-skipped task's end and
  `run.json`'s `graph_ended_at`, which `run-graph.mjs` records after the gate and `remediate.mjs` after its commits and
  full checks, as each writes the record (a `--resume` records its own, later end); a run from before that field ends at
  its last task's end. A claim check's start and
  end are its step journal's `start` and `end` entries; a subagent spawn's are its one task's.
- **The mint.** `new-run.mjs` records `mint_started_at` before the reviewer probes and `mint_ended_at` after the
  canaries, as its last act; a refused mint records no end. The record's `mint` holds both and their `duration_ms`. Mint
  and run are separate commands, often far apart, so the mint is its own figure and never inside the run's window.
- **Queue wait.** `run-graph.mjs` writes `queue.json` in the run directory: each lens and arm, with the time its pool
  started, when every one of them was ready. A task's `queued_ms` is its start minus that, so the wait for a concurrency
  slot; null for a task no pool held.
- **A suite run.** A record of kind `suite` holds one run of the orchestration suite: per test file its
  repository-relative path, its duration (the file's own, module load included) and its counts, slowest first, from
  `tests/tools/suite-file-reporter.mjs`. No test name, no output, no absolute path: a file outside the repository is left
  out. It has no tasks. Its `unparsed_lines` counts the reporter lines that did not parse, each one entry fewer; null
  when not counted. The newest 100 suite records are kept (`SUITE_RECORDS_KEEP`, `scripts/lib/telemetry-record.mjs`);
  each write removes the oldest past them.
- **Lines that did not parse.** A claim check's `journal_unparsed_lines` counts the step-journal lines that did not
  parse, so a torn journal is visible rather than read as fewer steps; null when not counted.
- **A decision.** A record of kind `decision` holds one decision of the decision panel (`scripts/decide.mjs`): its
  outcome (`majority`, settled by the panel at or above `review.grounding_floor`; `to-operator`, a majority below it;
  `revote` when no revote has run yet; `postponed`; `seats-unavailable`, a round in which fewer seats answered than the quorum (`QUORUM` in `scripts/lib/decision-panel.mjs`),
  which ends the decision at once and goes to the operator) and agreement (`unanimous` in round 1, `converged` when
  unanimity came in a later round, `majority`, `moderator-extended`, `majority-on-revote`, `none`), the rounds and moderator extensions of the talk and its revote,
  whether a revote ran, whether the operator overruled it, and the operator's sample mark (`agree`, `differ`, or null).
  It is BUILT when the report reads the decision's folder, not written beside it, because two of its inputs (the overrule
  and the mark) arrive later (`buildDecisionRecord`). The question, the entries and every reason stay in the folder and
  never enter the record. Dated by its id. It has no tasks.

## Where records are written, and read

The report reads exactly these locations and says how many records each held.

| Run | Written by | Record | Tracked |
|---|---|---|---|
| A review | `run-graph.mjs`, before archiving | `telemetry.json` in the run directory | with the archived run |
| A remediation | `remediate.mjs`, before archiving | `telemetry.json` in the run directory | with the archived run |
| A claim check | `claim-check.mjs`'s rules step; its `--check` when it fails after a checker ran, for any cause (the checker that failed is the task marked `FAILED`, none when a later step failed; no `check.json`) | `telemetry.json` in the check directory | no (`.claude/claim-checks/` is ignored) |
| A subagent spawn, on the node runtime | `spawn-subagent.mjs`, every caller | `<out-name>.telemetry.json` beside `--out` | where `--out` is |
| A plan-review round | `spawn-subagent.mjs` | `.claude/plan-reviews/<plan>/round-<n>/envelope.telemetry.json` | no (ignored) |
| A bench run | `bench-lenses.mjs`, `bench-second-opinion.mjs` | `<stamp>.telemetry.json` beside the results | yes, in `bench/results/` |
| An orchestration suite run | `tests/run-all.mjs`, only where `.claude/dev-install.json` exists and `GRAPH_NODE_DEPTH` is unset or 0 | `.claude/suite-runs/suite-<start>.json` | no (ignored) |
| A decision of the decision panel | built by the report from what `decide.mjs` writes (`outcome.json`, `revote/outcome.json`, `overrule.json`, `sample.json`) | `.claude/decisions/<id>/`, one record per folder holding an outcome | no (ignored) |

The run directories are every root the repository keeps runs in (`repoRunRoots`), staged runs included. A subagent
record is read only under `.claude/plan-reviews/`, because one beside a claim check's envelope is already counted in that
check's record. A record that cannot be built is a note in the writer's output, never a failed run. A run stopped at a
failed barrier exits staged without archiving, and `telemetry.mjs backfill` covers it and every run that predates the
writers; `backfill --rebuild` rewrites the records already there, so a change to what a record holds reaches them. A
remediation still staged that the runner made (its `remediate-settings.json`) and has not ended gets no record yet; an
archived one has ended by being archived. A suite record is written only in the developer's own checkout of the engine:
`.claude/dev-install.json` is machine-local and ignored, so the arms' snapshot, a test fixture's copy, a fresh clone and
the pinned install have none, and a remediation's candidate check, which runs in place, runs at `GRAPH_NODE_DEPTH` 1. A
machine without a dev install records no suite runs.

## The report

`node scripts/telemetry.mjs report [--since <date>] [--kind <kind>] [--fields]` prints each figure beside its sample
size:

- **Where the records were looked for:** each location, and how many records it held.
- **Records by kind.**
- **Run time per kind:** the runs' total and median, from each record's start to its end, with the count of records
  that have no duration, a start or an end missing. Under each kind, every phase's median span, a phase being its tasks' first start to last end:
  pre-flight (the checks), intent (intent and request capture), fan-out (lenses and arms), barrier (reconcile, re-ask,
  second-opinion, adjudication) and the remediation node. A phase whose tasks carry no times gives their count as
  untimed, never a zero. Then the time no task covers, the lens and arm waits for a slot, the mint's median, and how many
  records still start at the mint.
- **Skipped tasks** (state `SKIPPED`) are counted apart, per kind and per lens or arm, and are in no duration or median.
- **Suite:** the ten slowest test files, by their median over the suite records that timed each, with that count.
- **Tie-breaks:** adjudicator calls, and the runs they were in.
- **Findings per family:** over the runs with reconciled groups, the groups each family raised, how many the reconciler
  confirmed, and how many were corroborated by the other family.
- **Claim checks:** claims checked, discarded (dissolved) and revised (downgraded, or turned into questions).
- **Decisions:** the decision panel's decisions by outcome and by agreement, with their n; revotes; rounds per decision
  (n and median) and moderator extensions; how many of the decisions the panel took the operator overruled, out of how
  many; and the sample the operator marked (`decide.mjs --sample`, `--sample-mark`): agree and would-have-chosen-
  differently, with its n (autonomous-run.plan.md stage 8). The stop record's flag-on beside flag-off split is
  `stop-log.mjs --summary`'s, below it; which endings carry the panel's state is `shared/session-rules.md`'s.
- **Time and tokens per task:** per task kind, and per lens and per arm, per family. Each row has the task count, the
  timed count, the total and median duration, and the vendor-reported cost with its priced count. Tokens are summed per
  usage field and never across families, since two vendors' input tokens are not one unit.
- **`--fields`:** every other count the artifacts already record (criterion 7).

No threshold is built in and nothing is recommended. Both belong to the second part, once the operator has read a report
and set thresholds.

## What the second part folds in

The session records (`scripts/io/stop-log.mjs`: the stop record of `autonomous-run-pauses.plan.md`'s criterion 6, and
the command log) are a source the second part takes over. This report does not read them, and until then
`stop-log --summary` and `command-log --summary` report them.
