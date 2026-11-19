# Remediation — which findings a change fixes, which it ledgers, and when to stop patching

This document owns the rule a remediation follows. It was D1 in quorate's own `ROADMAP.md` ("D1 — when a review has
converged", settled with the operator 2026-09-25), which a consuming project does not have and which
`skills/remediate` then pointed at as a bare `ROADMAP.md` — the consumer's own file (G-2 of
`20261008-155128-remediate-siblings-r3`). It moved here by the operator's decision (2026-10-08, "Move into shared/
(Recommended)"); `ROADMAP.md` D1 keeps the release-gate sentence and points here. Nothing below is restated anywhere
else: `skills/remediate`, its node contract and `shared/design-step.md` cite this file, and where a model must read a
rule in place (the node's prompt, the stamp and schema text) it is generated from one template, never written again
(`prompts/_templates/rule-no-red.md`, written by `scripts/gen-rule-text.mjs`).

## Fix or ledger

A release gate is met when every confirmed finding is resolved — fixed and promoted by a later review, or declined with
an operator-approved reason — except the one class deferred to the ledger as tracked work:

| | Related to the task | Unrelated |
|---|---|---|
| **Introduced by the task** — NOT reproducible on the task's base commit | fix | fix — the task caused it, wherever it lives |
| **Pre-existing** — reproducible on the base commit | fix | **ledger** |

*Related* means: in a function the task changes, or — anywhere else, same module included — leaving it unfixed would
stop the task from being completed. The operator's example: if the task is "fix `fizz()`" and `fizz()`'s description is
incomplete, that is part of fixing `fizz()`. Every deferral records its reason in the ledger, where the operator can
overrule it. "Pre-existing" is shown, not judged: the finding's failing test fails on the base commit too.

For a remediation, "the task" is the reviewed run's frame: its base commit, its scope and the request it was judged
against, which a remediation run carries in its `run.json`.

**Other instances of the same defect** are found by a search for the defect's class, named by its mechanism, with the
exact command in the report (operator, 2026-10-08: "Make the smallest change: you can still obey that but add other
findings to a roadmap and keep the actual change small"). This table decides which of them the change fixes; every one
it sends to the ledger is ledgered with its reason. The ledger is the record — a roadmap entry may be added beside it,
never instead — and a deferral made only in a code comment or a commit message is not a deferral.

The search is reported with its **census** (observation-guard-and-sibling-census.md; operator, 2026-10-17: "Prompt
census now, check in M3 (Recommended)"): every site it matched, each matched site judged outside the rule with why, and
the spellings of the rule its shape could not have matched. A test written from the same reading as the fix shares the
fix's blind spot, so the census is the part a later reader can check: the follow-up review's lenses are pointed at it.
No mechanical check compares the changed files with the sites yet. That is M3 (ROADMAP item 9).

## What a fix must show

A fix commits on its own experiment: a `commands.test_one` red that ran and failed for the reason the finding names, and
a later green of the same test file (`scripts/lib/remediation-chain.mjs`, `evidenceRefusal`). Three cases are shown
otherwise (`remediation-evidence-rules.plan.md`):

- **A finding about a test.** A cluster that changes only test files is a fix when every group in it was reported
  against a test file. Its red is the strengthened check run against the old test, failing because the old test does
  not constrain what the finding names.
- **A symptom fixed with its root.** It is planned in its root's cluster and shown by the root's red and green; it may
  cite them, or none.
- **A fix with no possible red.** <!-- rule:no-red -->A fix has no possible red when no test can fail before it for the reason the finding names: a race between two reads, a read no test can observe, a static change. Its red is then empty and its `no_red` says why, naming the before-state it changed; the runner admits it in any cluster (a cluster with no test only when every group in it declares one) and records each reason as `declared-no-red`, for the follow-up review to judge. An empty red with no `no_red` is a skipped red, and its whole cluster is refused.<!-- /rule:no-red -->

## Single-family LOWs

A LOW raised by ONE model family with no other family corroborating it goes to the ledger; a MEDIUM or above blocks
whoever raised it. Family-neutral — Claude-only findings included; it only looked codex-specific because every panel arm
runs on codex today.

## Round cap

If a third consecutive remediation still produces new MEDIUMs in its own fixes, stop patching and review the design
(`shared/design-step.md` says how). **A feature delivery between two remediations resets the count** (operator,
2026-09-26: "feature resets it").

**Which remediations are consecutive** (operator, 2026-10-08: "B: follow the links (Recommended)"): they form a chain
along their links — a remediation run, the follow-up review it minted (that review's `run.json` records
`follows_remediation: {run_id, run_dir}`: the remediation run's id, and its directory when the link was recorded; it is
followed to the run's current place by that id, `shared/claude-md-contract.md`, `reviews_dir`), the remediation of that
review, and so on. Any other review — a feature
delivery's, or a fresh sweep — starts a new chain, so a remediation of it is round one. When a remediation's reviewed
run is not the follow-up its predecessor minted, the remediation run is stamped `CHAIN-BROKEN`, naming the previous
remediation, so a fresh sweep run in place of the minted follow-up is visible rather than a silent reset.

A new MEDIUM counts against the remediation whose commits introduced it, traced by `git blame` of the finding's cited
line against that remediation's commits — a proxy, and said so wherever it is used.

## The residual a remediation accepts

A remediator that edits a test and then runs the declared test command executes code it wrote. Red-before-green requires
exactly this, and an interactive remediating session does the same. The threat model puts command execution through
contract keys and `capture.mjs` in scope; this residual was put to the operator and accepted (2026-10-08: "Accept and
record (Recommended)"). The remediation sandbox bounds what a remediator may edit (how its changes are committed is `shared/claude-md-contract.md`'s);
it does not bound what the project's own test command does.

The same holds for the project's pre-commit hooks, which run when the runner commits a cluster: they execute code the
remediator may have written, in the commit's own environment (`gitEnvFor` with `commit: true`, `scripts/lib/decisions.mjs`).
What that environment strips and keeps is ARCHITECTURE A-29's, and so is the rule that
every git process the engine starts — the runner's `status`, `add`, `hash-object` and commit, and the git calls of `new-run`, the follow-up mint and
every other script — runs in it, through `scripts/io/git.mjs`, so the candidate hashes as the commit will
(`remediation-commit-env.md`; operator, 2026-10-11: "Scrub secret names (Recommended)"). A hook that needs a secret fails
visibly as a refused commit. What this document adds is the residual: the scoped git config crosses whole, VALUES
included, because git rejects a partial tuple, so a credential an operator puts in a `GIT_CONFIG_VALUE_<n>` (an
`http.extraheader`, say) reaches the hooks, and the repository's clean filters and fsmonitor with them. The follow-up mint itself is spawned with the operator's environment,
because its sandbox canary and reviewer probes need the runtime's credentials; its git calls are scoped where they run
(`engine-git-env.plan.md`). Skipping them would let a remediation commit bypass the project's own gate, and would not close the
residual, which the test command already carries. Accepted with it (operator, 2026-10-09: "Extend the residual
(Recommended)"; G-11 of `20261009-011732-remediation-paths-r1`).

## The candidate check is the check of the whole

A remediation node checks each fix narrowly, with `commands.test_one`, red then green; the runner checks the whole once,
on the commit candidate, in the working tree, before it commits anything (`remediation-verification.plan.md`; operator,
2026-10-13: "The runner, once (Recommended)", "In place, guarded (Recommended)"). That check is what a commit rests on,
and it accepts three residuals, stated rather than engineered:

- The suite it runs includes tests the remediator wrote, which could write the channel files or print count lines: the
  same trust basis as the test command itself (the residual above). Its environment is an allow-list of its own, not
  the commit's (`candidateEnvFor`, `scripts/lib/decisions.mjs`; `candidate-check-boundaries.plan.md`; operator,
  2026-10-14: "Allow-list (Recommended)"); what crosses is owned by the `review.candidate_env` entry of
  `shared/claude-md-contract.md`. Unlike the commit's, it never admits the SSH agent socket or any `GIT_CONFIG_*` name.
  The residual it leaves: a name the suite needs and nobody declared fails the candidate check, visibly. It runs at
  `GRAPH_NODE_DEPTH` 1, which code the remediator wrote can reset: a residual, not a boundary.
- Two suites running at once share one test home (`tests/helpers.mjs`), so a candidate check that overlaps another
  suite can go red for that reason. It is named (`full-run-red`) and retryable.
- When one cluster is refused by a hook, the clusters already committed form an intermediate commit that was checked
  only as part of the whole candidate.

The working tree it checks is the candidate's: a cluster the runner rules not committable is set aside first, its exact bytes
copied under the run directory and its paths put back to HEAD, and written back once the commits are made, so a refused
cluster of regular files no longer blocks the others (`remediation-cluster-order.plan.md`; operator, 2026-11-07: "A. Copy
bytes aside (Recommended)"). Not every such cluster can be set aside: one the row below names `set-aside-kept` stays in
the tree and may still block them. The check still runs in place. An edit outside every planned cluster is not set aside
and still refuses the candidate; which clusters are set aside, the mechanism and its record are the `scripts/remediate.mjs`
row of `shared/claude-md-contract.md`.
