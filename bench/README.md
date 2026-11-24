# bench — the measurement loop

Everything else in this framework measures whether the process ran completely. Nothing measured
whether the lenses actually catch defects: no lens had a recall figure, the reconciler had no
precision figure, and open runtime questions (reasoning effort `medium` vs `high`,
`CODEX_RUNTIME_FINDINGS.md` item 2) were unanswerable because no harness existed to answer them.
This directory is that harness. It is the Fagan feedback loop: inspections stayed effective for
decades because defect data fed back into the checklists, and that loop is what a review system
decays without.

## How it works

Each corpus entry reintroduces one **known** defect as a patch. The runner applies it to a
throwaway git worktree, has the current checkout's orchestrator review that tree
(`--repo-root` — the engine already supports a known-good checkout reviewing a broken one), and
scores whether any lens landed a finding on the seeded site.

```
node scripts/bench-lenses.mjs                        # list the corpus; spends nothing
QUORATE_BENCH=1 node scripts/bench-lenses.mjs        # run it; spawns real lenses per seed
node scripts/bench-lenses.mjs --score-only --run-dir <abs> --manifest <path>
```

The opt-in mirrors `check-reviewers`': a live run spawns model lenses per seed, which spends real
subscription quota, so it never runs implicitly and is **not** part of `commands.test`. Scoring is
pure (`scripts/lib/bench-scoring.mjs`) and covered by the offline suite, on the standing rule that
the part that must never be wrong quietly is the part that costs nothing to test.

## Corpus format

Each seed is `bench/corpus/<id>/manifest.json` plus `defect.patch`. **`shared/bench-corpus.md` owns the format** — every
manifest field as `validateManifest` checks it, how the anchor resolves — and `bench-admit`'s rules. This section listed
the fields itself, and kept listing `defect.line` after the validator began refusing it, because nothing compared the two
(`.claude/requests/bench-corpus-format.md`).

**Why a seed strips its regression tests, where it has any.** A defect the suite catches never reaches a lens — the
pre-flight barrier fails first, and the benchmark measures the tests instead of the reviewers.
Seeds recreate the *pre-discovery* state, which is the state a review exists for. The offline
corpus-integrity test enforces that patches apply cleanly; a patch that stops applying after a
refactor is a **visible** failure telling you to regenerate the seed — never a silently rotting
one. (A seeded tree's suite need not be fully green: the engine records a failing pre-flight test
check and reviews anyway, and the framework's own meta-tests fail there by design — see the
honesty rules below.)

**Historical seeds outrank mutations.** The first three entries are real defects from this
repository's own history (the silent severity clamp, the prose-node ordering bug, the probe
substring match) — defects that actually shipped are the ground truth mutations only approximate.
Mutations are welcome for volume; mark them `source: "mutation"`.

## Scoring

A finding hits the seed when it names the seeded file and lands within `--tolerance` lines
(default 15) — a real reviewer cites the call site, the guard, or the consequence, all near, none
guaranteed exact. Per-lens **recall** counts only the seeds that lens was *expected* to catch.
Findings that hit no seed are reported as **false-positive candidates**, not false positives: on a
one-seed tree they are probably noise, but only adjudication can say so, and the count is named
for what it is rather than laundered into a precision figure it does not support.

Results land in `bench/results/<timestamp>.json`, including per-seed catch lists and total cost —
which is what makes "recall per dollar" a computable number when comparing configurations
(effort levels, models, lens variants).

## Measured so far

| run | corpus | config | recall | cost | wall | FP candidates |
|---|---|---|---|---|---|---|
| 2026-09-01T19-15 | v1 (assisted) | code-audit @ xhigh | 3/3 | $13.77 | 41m | 10 |
| 2026-09-01T21-53 | v2 (tell-free) | code-audit @ xhigh | 3/3 | $12.91 | 41m | 7 |
| 2026-09-02T02-03 | v2 (tell-free) | code-audit @ medium | 3/3 | $7.11 | 20m | 2 |
| 2026-09-02T02-23 | doc seed | doc-consistency-review @ xhigh | 1/1 | $3.81 | — | 1 |
| 2026-09-02T02-34 | contract seed | contract-audit @ xhigh | 1/1 | $4.50 | — | 4 |

The medium-vs-xhigh comparison settled `CODEX_RUNTIME_FINDINGS.md` item 2's open measurement for
the internal lens: identical recall at 55% of the cost with fewer FP candidates, so code-audit
ran at `medium` through a roster override from 2026-09-02. That pin is gone: `lens-roster.json`'s
`$effort_note` records why, and every Claude lens now runs at the contract's `review.effort.judgment`
(`CLAUDE.md`, with its measurements).

The contract seed is the deepest end-to-end exercise so far: its patch carries an approved
request into the worktree, `intent-capture` derives numbered criteria from it inside the Rule 2
sandbox, and the lens convicted the seeded code of violating the specific criterion (`I-3`) —
the full intent pipeline, measured for the first time.

## The repair pass, on this repository's own refusals

`scripts/bench-repair-pass.mjs --case <remediation run id>` (`remediation-repair-pass.plan.md` stage 4) replays a
remediation whose full check refused its candidate: a worktree at the head that check recorded, under the engine's home;
a scratch review and remediation minted there, the case's reviewed judgement copied in; the first node replayed from the
case's own report, captures and node status by `remediate.mjs --replay-node` (at depth 0, with `--measure-only`;
`repair-bench-replay.plan.md`), its candidate blobs written in; the full check run once to confirm the same failing
tests (otherwise "not reproduced", not measured); then `remediate.mjs --retry-commits --repair --measure-only` at a cap
of 3, committing nothing. Its table is `bench/repair-pass/RESULTS.md`; the raw record stays under
`~/.quorate/bench-repair/`. Which cases to run, and how many, is the operator's (RP-D2, RP-D3).

## Corpus honesty rules, learned from the first live runs

- **The seeded tree must not contain its own answer key.** The checkout ships `bench/corpus`,
  whose manifests name every defect by file and anchor (`shared/bench-corpus.md` owns the format), so the runner deletes `bench/` from the
  worktree after applying the seed. A recall figure that cannot rule out the lens having read the
  manifest is not a recall figure. (Side effect: the seeded pre-flight's test check fails on the
  framework's own meta-tests — recorded noise, not a stop; the benchmark reads lens status, never
  the gate.)
- **The patch must strip the prose that narrates the fix, not just revert the code.** The v1
  seeds left docstrings and the module-header defect list intact, and the 2026-09-01T19-15 run's
  catches for `clamp-silent-noop` and `prose-before-payload` cited those docstrings directly —
  **assisted** catches measuring doc-vs-code matching rather than pre-discovery detection. The v2
  patches remove the tells. **Measured 2026-09-01T21-53: recall held at 3/3 under the tell-free
  v2 seeds** ($12.91) — the assist concern was methodologically real and did not change the
  number. The v2 claims derive the defects from the code: the ordering bug from what variant
  `none` means, the substring bug from the exact item `unavailable()` writes. One residue is
  unavoidable and named: the repository outside the seeded file still carries guards and tests
  shaped by the historical fixes (e.g. spawn-node refusing a verdict in the severity slot), and a
  reviewer cross-referencing those is doing legitimate review, not reading an answer key.

## What this does not measure — named, per the house rule

- **Ranking quality.** A caught seed says the lens fired near the site; it does not grade the
  claim's severity or explanation. Reading the finding is still a human step.
- **Reconciler precision at scale.** One seed per tree exercises detection, not adjudication under
  crowding. A multi-seed tree per run is future work.
- **Coverage breadth.** The founding corpus was `code-audit` logic defects in `scripts/lib/`; one
  doc-consistency seed and one contract seed have since been added (the table above), while perf,
  arch, ui and feature-verify seeds are an open backlog, and per-lens recall for lenses with no
  seeds is honestly absent rather than fabricated.
