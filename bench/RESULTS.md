# Measured lens settings

**The numbers below expire; the instrument does not.** Models change and a consuming project may be
on another vendor entirely, so this file records what a sweep returned *on a stated day, on a stated
tree, at stated versions* — and names the command that reproduces it. Read the date before believing
a row. Re-run rather than trusting a number you cannot re-derive.

```
QUORATE_BENCH=1 node scripts/bench-lenses.mjs                          # the settings in the contract
QUORATE_BENCH=1 node scripts/bench-lenses.mjs --effort medium          # override the contract's effort
QUORATE_BENCH=1 node scripts/bench-lenses.mjs --model sonnet --effort xhigh
```

`--effort` and `--model` are written into the **seeded worktree's** contract, which is where
`--repo-root` reads it from. A per-lens `effort` in `scripts/lens-roster.json` is read from the
framework root instead and **will silently mask the flag for that lens** — so when you read a result,
read the per-node `effort` the result records, never the flag that was passed.

**Unmeasured at 1.0** (m3-v1.plan.md Q5; operator, 2026-11-20: "State it in the release (Recommended)"): the model and
effort of `arch-review`, `perf-audit`, `ui-audit` and `feature-verify`. The corpus has no seed for any of them, so no
pass has spawned them, and each runs at the adopted lens setting by inheritance, not by evidence (2026-09-20, "What this
does not measure", below). 1.0 ships them that way, and its release notes say so.

---

## 2026-10-13 — the agy judge's effort: not separable on this corpus

agy 1.3.3 dropped Gemini 3.1 Pro, so the `adj-agy` pin moved to Gemini 3.8 Flash (High) (`1cd5d72e`; operator:
"stat with Gemini 3.8 Flash (High) but if possible do a bench comparing efforts"). agy spells effort in the model name,
so each setting was the roster's `adj-agy` model for one pass, restored after.

```
QUORATE_BENCH=1 node scripts/bench-second-opinion.mjs --from bench/results/2026-09-21T16-35-42-060Z.json \
  --rejudge ~/.quorate/bench-second-opinion --judge adj-agy          # adj-agy's model set per pass
```

| Judge | Mutated | Control | Pass wall time |
|---|---|---|---|
| Gemini 3.8 Flash (Low) | identified | not identified | 39 s |
| Gemini 3.8 Flash (Medium) | identified | not identified | 98 s |
| Gemini 3.8 Flash (High) | identified | not identified | 117 s |
| Gemini 3.8 Flash (High), repeat | identified | not identified | 176 s |
| `adj-codex` (gpt-5.6-sol, high), reference | identified | not identified | 34 s |

**One seed of seven was scoreable**, `doc-stale-panel-contract`, so this shows every setting catching the one
mis-anchor with no false alarm — a ceiling, not a ranking. Wall time is the whole pass, and the two High passes differ
by 59 s, so it does not separate the settings either. The pin stays at High. Two instrument gaps, ledgered: `--rejudge`
takes the first preserved copy by name whatever mutation it carries, which lost three seeds; and a re-judge records no
judge tokens or vendor cost, so the per-setting cost columns a full grid needs cannot be read. Two more seeds no longer
apply their defect patch, and one has no admissible anchor to move.

---

## 2026-09-22 — `second-opinion` scored for the first time

Corpus: the 6 seeds of the 7 whose reconciliation can carry an injected anchor error. Instrument:
`scripts/bench-second-opinion.mjs`, mutation `misanchor`, injection rule `rewrite`, judge `adj-codex`
(`codex`/`gpt-5.6-sol`). Audits spawned at the run's own frozen `opus`/`medium`.

| | |
|---|---|
| seeds scoreable | **6 / 6** |
| injected error identified | **6** |
| recall | **1.0** |
| false alarms on the control | **0** |
| recall over clean-control seeds only | **6 / 6** |
| Anthropic cost | **$6.70** ($5.32 audits, $1.38 forge) |
| judge cost | $0 Anthropic — billed by its own vendor |

One invocation, six seeds, every audit freshly spawned under the corrected judge. An earlier pair of
passes produced the same 6/6 and is what found the judge defect below; this one supersedes them and
is the figure to quote, because nothing in it predates the fix.

**What this measures.** A finding group's anchor is moved to a location the reconciliation discusses
but the defect is not at, and `second-opinion` is asked, in effect, whether it noticed. The audit
identified it in every seed, in its own words and unprompted: *"It then anchored the root at line
711, which is a design comment, while writing in G-5 that 'the fix belongs at 1014'"* · *"The anchor
and the verification text are wrong and need correcting: `scripts/spawn-node.mjs:1818`"* · *"The
fix is to re-anchor G-2 at 703"* · *"the G-2 header and body name the wrong one"*. Every citation is
mechanically verified to exist in the report it is attributed to.

Checked per seed rather than taken from the summary line: `reconciled.md`'s group header and
`finding-groups.json` both carried the injected anchor when the node read them, and every forged
rationale cited the injected line and never the real one. All six controls returned
`not-identified` with no citation, which is the correct shape — that vote requires none.

**Read the false-alarm row before the recall row.** It was **5 of 6** until the instrument was fixed,
and a judge that fires on five of six reports with nothing to find makes a recall of 1.0
uninterpretable. Two causes, and the prompt was the lesser one:

- The control report was judged against the **mutated** excerpt. The harness held the excerpt
  constant on the reasoning that "the two prompts are identical except for the report, so a
  difference in the rulings is a difference between the reports and nothing else" — which sounds
  like rigour and was the defect. The judge saw a report discussing line 1014, an excerpt anchored
  at 711, spotted the mismatch ITSELF and credited the report with an observation it never made.
  Every control citation named the TRUE line, which is that signature. Each report is now judged
  against the reconciliation it actually read.
- The prompt asserted the error was present — *"it is known to be there"* — which is false for a
  control by construction. It now asks only whether the report MAKES the claim.

Same six reports, unchanged, re-judged after the fix: false alarms 5 → 0, catches 6 → 6. Because the
audits are identical rather than merely similar, the difference is the judge and nothing else.

That A/B could only ever exonerate the judge on reports it had already seen, so the pass reported
above was run afterwards with everything fresh — new forged rationales, new audits, new rulings —
and reproduced 6/6 with zero false alarms. The two are not redundant and are not interchangeable:
the re-judge isolates the judge by holding the audits constant, and the live pass is an independent
sample that the corrected prompt had never faced. The headline figures come from the live pass.

### The same day, a second mutation: `deflate`

A kept group's severity is lowered at least two rungs and its rationale regenerated to argue the
lower one. Same corpus, same judge, same instrument, one invocation.

| | `misanchor` | **`deflate`** |
|---|---|---|
| seeds scoreable | 6 / 7 | **6 / 7** |
| identified | 6 | **6** |
| false alarms on the control | 0 | **0** |
| Anthropic cost | $6.70 | **$5.69** |
| the seed it cannot reach | `clamp-silent-noop` — no admissible anchor | `doc-stale-panel-contract` — MEDIUM cannot fall two rungs |

**They are not the same question, and the corpus coverage is complementary rather than additive.**
`misanchor` asks whether the audit checks an anchor against the source — a factual mismatch anyone
can verify by opening a file. `deflate` asks whether it challenges a severity the group's own
findings do not support, which is closer to judgement, and the forged paragraphs argue it well: *"a
latent defect with a comment to restore, not a live fault"*, *"does not open a new route to any
credential"*, *"a test gap, not a verdict that is wrong today"*. The audit objected anyway, in terms
that name the rung: *"The root should carry at least the severity of its worst consequence: BLOCKER,
or HIGH at minimum"* · *"the reconciler cut G-2 from HIGH to LOW by arguing it was unlikely to
happen, not by weighing what happens when it does."*

`deflate` also reaches `clamp-silent-noop`, which `misanchor` never can — it needs no admissible
anchor — so that seed's audit is measured here for the first time. Between the two, every seed in
the corpus is covered.

**The severity analogue of `tolerance`.** A severity must fall at least TWO rungs or the seed is
refused, which is why `doc-stale-panel-contract` (MEDIUM) is out. HIGH versus BLOCKER on one finding
is an argument reviewers have in good faith; injecting it would score an auditor for failing to
agree with this harness rather than for missing a defect.

**A check this pass corrected.** The tell rule first required the rewritten rationale to NAME the
new severity, borrowed from `misanchor` where citing the injected line is the only way to commit to
a location. It refused a perfectly good LOW rationale — *"I lower it below both nodes' MEDIUM
because no run is harmed today ... a wrong answer nobody reads, not a wrong verdict"* — which
commits to the lower severity without writing the word. Severity is stated by the header and argued
by the paragraph, so the proxy went and the real tell stayed: the OLD rung must not survive. Found
for $1.05 at the `--forge-only` tier, not by reasoning about it.

### And a third: `drop`

A kept group is moved into `## Dropped`, bucket counts adjusted, and its rationale regenerated to
argue the group does not survive adjudication. **4 / 7 scoreable, 4 identified, 0 false alarms,
$3.42.**

**Read the denominator, not the recall.** Three seeds refuse structurally: their target is the root
cause of other groups, and dropping it would leave a `root_cause_group` pointing at a group that is
gone — an auditor finds that by following a pointer, not by judging the drop. `drop` will never
match the other two on this corpus, and at n=4 one seed is a quarter of the result.

**Its tell check is the one that is NOT mechanically bounded**, and the result file says so per seed
(`tell_bounded: false`). `misanchor` and `deflate` have something to look for — a line number, a
severity word. Whether a rewritten paragraph now argues for *dropping* is a judgement. What guards
it instead, none of it a content check: `injectionSurvived` requires both artifacts to say dropped;
the `--forge-only` tier exists so the paragraphs are read; and every run's paragraphs were read
afterwards from the preserved run directories. All four sat under `## Dropped` with honest counts
and argued the drop concessively — *"Cross-arm agreement of the weak kind"*, *"does run the severity
clamp ... does show the §2 floor block deleted"*, each building to a dismissal.

**A keyword check made this worse and was removed.** The first pass scored 2/7, not 4/7, because a
`\bconfirm(ed|s|ing)?\b` rule rejected two forges. Both were prose arguing FOR dropping: *"its
agreement echoes the lens's framing rather than confirming it independently"*, and
*"floor-callsites.log confirms that verdictFloorFromFindings ... are still imported"* — the second
describing what a log shows and saying nothing about the group's standing. `confirm` is ordinary
reconciler vocabulary for what evidence demonstrates. The rule refused three of eight forges,
bounded nothing, and cost two seeds; `bounded: false` was already the honest answer.

**`--forged` closes a gap the other two do not have.** `--forge-only` and a full pass forge
INDEPENDENTLY, so reading the cheap tier's paragraphs shows the forge can produce sound prose, not
that a later pass's prose was sound. For `misanchor` and `deflate` a bounded check covers every run
regardless; for `drop` nothing does. `--forged <file>` feeds a prior forge-only run's paragraphs
into a pass, comparing ground truth before accepting each, so the paragraph that was read is the one
that runs.

**What it does not measure.**

- ~~**One mutation shape.**~~ **Three measured.** `misanchor` 6/6, `deflate` 6/6, `drop` 4/4, all at
  zero false alarms. Each refuses its own seeds for its own reason, and the three refusals differ:
  no admissible anchor, a severity that cannot fall two rungs, a target that roots other groups.
- **Three models in the instrument** — one forging the error, one auditing, one judging. The forge
  is pinned to the model and effort the reconciler ran at, given no tools, shown the real source at
  the destination, and its output is checked mechanically for the tell (no line within tolerance of
  the true anchor; the injected line present). That bounds it. It does not make the injected error
  indistinguishable from one a reconciler actually made.
- **Six seeds.** One seed is 17% of the result, so no aggregate threshold is honest here — the same
  reasoning AC8 already records.
- **`clamp-silent-noop` is not in the corpus.** Its only other group sits 4 lines from the target,
  inside `tolerance`, and the other lines its prose cites belong to a different file. An anchor a
  reviewer could defensibly have cited is not a wrong anchor.
- ~~**The audits ran under the OLD judge.**~~ **Closed.** That was true of the re-judge and was the
  reason to run a live pass; the figures above come from audits spawned under the corrected prompt.
  What remains is the ordinary limit: the mutated and control rulings come from one judge on one
  corpus, and agreement between two judges has never been measured here.

**`bench/results/2026-09-21T16-35-42-060Z-second-opinion.json` now holds all six in one file**, from
the live pass. Getting there took three earlier passes whose figures are superseded and whose
history is in git: one seed alone to prove the pipeline before paying for the rest (`1a3964a`), then
the remaining five (`090c5d3`), then the re-judge of both sets after the judge was fixed. The result
path is keyed by the source stamp alone, so each pass overwrote the last — which is why the
per-pass numbers live in commits rather than in files, and why a partial pass must never be read as
a total. Summing an earlier file gave $5.13 for work that had cost more. The corrected rulings are a
`--rejudge` artifact, which is gitignored: it is an experiment on the judge, run against reports
that already existed, not a measurement of the audited node.

**AC14's second half is answered. AC15 is not.** `agy` remains unmeasured, and the instrument that
would measure it — a corpus of seeded **disputes** rather than seeded mis-anchors — is the same
missing shape in a different form. What this run does establish is that the approach works: a
mutation with known ground truth, a cross-family judge, and a negative control that is believed
before the result is.

## 2026-09-20 — `opus`/`xhigh` → `opus`/`medium`

Corpus: 7 seeds. Framework at `07db3f6` plus the harness fixes in this commit. Lenses exercised:
`code-audit` (5 seeds), `contract-audit`, `security-audit`, `doc-consistency-review` (1 each).
Every pass uniform — the `code-audit` per-lens pin was suspended so the knob actually turned.

| | `opus`/`xhigh` | **`opus`/`medium`** | `sonnet`/`xhigh` |
|---|---|---|---|
| recall | 7/7 | **7/7** | 7/7 |
| false-positive candidates | 13 | **8** | 19 |
| cost | $41.78 | **$22.68** | $25.03 |
| node wall-clock, summed | 100.7 min | **48.6 min** | 127.6 min |
| elapsed (3 seeds at a time) | 43 min | **27 min** | ~30 min |
| output tokens | 444k | **225k** | 707k |
| — of which thinking | 242k | **63k** | 517k |
| cache read | 28,567k | **14,431k** | 44,130k |
| result file | `2026-09-20T23-00-58-339Z.json` | `2026-09-20T23-46-34-579Z.json` | `2026-09-21T00-15-32-212Z.json` |

**Adopted: `medium`.** It satisfies the adoption rule in
`.claude/requests/model-and-effort-reevaluation.md` outright — AC8, no seed regressed; AC7, no
material rise in false-positive candidates. They did not rise, they **fell by 38%**. This is not a
cheaper setting bought with a tolerated loss: medium is cheapest, fastest, and quietest at equal
recall.

**Rejected: `sonnet`/`xhigh`**, and it is the result worth keeping. It matched on recall at a similar
price, then spent **517k thinking tokens against medium's 63k** to get there, took **2.6× the wall
clock**, and produced **19 false-positive candidates against 8**. A cheaper model given more thinking
bought nothing and cost the two things that are scarce: the operator's time, and the reader's
attention. AC2 required testing that trade instead of ruling it out by symmetry; the expectation
going in was the opposite of the result.

**The 2026-09-02 precedent replicated.** `code-audit` had been pinned to `medium` on an `n=3`
measurement whose own note said *"rerun the corpus before treating this as settled."* At `n=7`,
across four lenses, it holds. The pin is retired because the contract now carries that value for
every lens.

### 2026-09-21 — the arms, benched for the first time

`bench-lenses.mjs` had passed `--skip-panel` since it was written, so no external arm had ever
appeared in a bench result and AC3 ("the arms are benched too") was unsatisfiable. The flag is gone.
Both passes below ran at the adopted `opus`/`medium`.

| | arms failed (PATH) | **arms working** |
|---|---|---|
| result file | `2026-09-21T02-22-43-650Z.json` | `2026-09-21T16-35-42-060Z.json` |
| recall | 7/7 (Claude only) | **7/7 Claude AND 7/7 codex** |
| `caught_by` includes an arm | never | **every seed** |
| Anthropic cost | $36.46 | $38.96 |
| codex cost to Anthropic | — | **$0.00** |
| codex tokens (OpenAI quota) | — | ~14.0M in / 71k out |
| false-positive candidates | 10 | 18 |

**The codex arms matched the Claude lenses on every seed**, and cost no Anthropic tokens to RUN --
but they are not free, and an earlier version of this entry said "$0.00 Anthropic cost" without
qualification. Their findings flow downstream into nodes that are Claude, and the failed pass is the
control that prices it: with arms producing nothing, `reconcile` cost $8.07 and `second-opinion`
$11.54; with arms producing findings, $9.39 and $14.80. **About $4.57 of Anthropic spend is caused
by consuming the arms**, against $13.29 for the Claude lenses themselves.

Cheap, then, not free -- roughly a third of a lens-set to consume a whole second family. That is
still the most adoption-relevant number this corpus has produced, because the generation side runs
on a different vendor's quota, which is not the constraint that limits the lenses. But "free" was
the kind of claim that should have been checked before it was written, and the data to check it was
already on disk.

False-positive candidates rise from 8 (no arms) to 18 (arms working). More reporters means more
candidates; that is arithmetic, not degradation, and AC7's "no material rise" test governs a
comparison between SETTINGS, not between a run with arms and one without.

**The first attempt measured nothing and cost $36.46.** Every arm failed `'codex' is not recognized`
— the bench inherits the shell's PATH and this machine keeps two codex installs, a working 0.155.1
under `AppData/Local/Programs/OpenAI/Codex/bin` and a stale 0.130.0-alpha under
`AppData/Local/OpenAI/Codex`, which cannot decode the current model list. The failure is recorded
correctly in each arm's `failure.json` and was invisible in the summary line, which read `7/7
caught` because the Claude lenses caught everything.

**A correction worth keeping**, because it was stated confidently and was wrong: that failure was
read as evidence that arms are *structurally* unscoreable — four arm evidence directories held
`failure.json` where `verdict.kept.json` should be, and the format was blamed rather than the
failure. A SUCCEEDING arm writes `verdict.kept.json` with `file`, `line` and `severity` on every
finding, which is exactly what `collectRun` reads and `scoreSeed` iterates. Removing `--skip-panel`
genuinely was the whole fix. Diagnosing a format gap from the wreckage of an environment error is
the same mistake as reading a stale line number as a moved section.

**Arms reported no `duration_ms` and now do.** No vendor returns one, and the conclusion drawn from
that was that the axis was unavailable -- which was wrong: this framework spawns the child process
and can time it. `external-review.mjs` now records the wall clock at the spawn site and it travels
on the envelope to the arm's status, on the failure path as well as the success path, for the reason
already written there about tokens: the cost of a failed node is exactly as real as a successful
one's. `null` means the child never launched, which is a different fact from 0 ms. The numbers in
the table above predate this and still read 0.0 for every arm.

**`second-opinion` is now the bench's largest line item** — $14.80 over 7 seeds, 38% of the
Anthropic cost, 29.3 minutes — in a harness that scores nothing about it. See
`.claude/findings/2026-09-20-second-opinion-reaches-nobody.md`.

### 2026-09-21 — the barrier, scored for the first time

Every number above measures DETECTION. A `reconcile` that discarded a group the lenses correctly
found still read as recall 1.0, so the one failure mode a fan-in graph is uniquely exposed to went
unmeasured while `reconcile` took 22-34% of every pass. `scoreReconcile` closes it, joining
`evidence/reconcile/payload.json` (group_id -> decision, schema-validated) to
`finding-groups.json` (group_id -> file, line) on the same anchor and tolerance detection uses. The
prose report is never read.

**Scored over the seven preserved runs of `2026-09-21T16-35-42-060Z`: 7/7 kept.** The barrier
currently loses nothing. That is a baseline, not a guarantee, and it is the first time it has been
checked.

What counts as kept comes from the reconcile prompt's own table rather than the words'
connotations. `confirmed` is real and defensible. **`symptom` is also real** — "downstream of
another group" — and reaches the gate under its root cause, so scoring it as a loss reports false
failures on every correctly-attributed seed. The first version of the scorer did exactly that and
called `probe-substring-match` a barrier failure when the reconciler had handled it correctly.
`dropped` and `coincidence` are losses, because a seeded defect is real by construction. A symptom
is only as alive as its root cause, so the chain is followed with a cycle guard — model-authored
ids can contain one.

Three states are deliberately not failures: `not-reported` (reconcile never ran, and a node that
did not run cannot have dropped anything), `no-anchored-group` (a grouping question, not a decision
one), and a symptom with no root cause named (a missing pointer is not a discarded defect).

### What this does not measure

- **`arch-review`, `perf-audit`, `ui-audit` and `feature-verify` have no seeds.** They were never
  spawned by any pass. The adopted value applies to them by inheritance, not by evidence.
- **Recall was 1.0 at all three SETTINGS swept** on 2026-09-20, so the corpus cannot rank them above
  that ceiling. It can only show that medium loses nothing these seven seeds detect. ("Setting", not
  "arm": since 2026-09-21 an *arm* in this file is a panel reviewer.)
- **`reconcile` has a BASELINE, not a comparison.** `scoreReconcile` measured 7/7 kept — at one
  setting, the adopted `opus`/`medium`. No pass has varied the barrier's own model or effort, so
  nothing here says whether a cheaper reconciler still keeps what the lenses found. The number that
  makes that worth asking is unchanged: `reconcile` is 29–34% of every pass's cost ($14.09 at xhigh,
  $7.40 at medium, $7.23 on sonnet).
- **The ARMS have a baseline, not a comparison either.** Both 2026-09-21 passes ran the roster's
  `gpt-5.6-sol`/`high` on every arm; only the Claude side has ever been varied. AC3 ("the arms are
  benched too") is satisfied — they ran and scored — while AC1/AC2 for the arm positions are not: no
  lower codex model or effort has been tried against those seeds.
- ~~**`second-opinion` is still scored by nothing**~~ — **answered 2026-09-22, see the section
  above.** It needed what AC14 said it needed, a corpus of seeded *reconciliation errors* rather
  than seeded code defects, and that corpus is now generated rather than authored: a known-good
  reconciliation is mutated, the reconciler's own paragraph regenerated to match, and the audit
  asked whether it noticed. 6/6 identified, 0 false alarms on the control, $6.70. What remains
  unmeasured about this node is its behaviour on mutation shapes other than `misanchor`, and its
  cost is still the bench's largest line item.
- **`agy` is unmeasured entirely.** It appears at one position — adjudicator, invoked only when
  reporters contradict each other — so measuring it needs a corpus of seeded **disputes**. That is
  the same instrument in a different shape, and as of 2026-09-22 the instrument is no longer
  missing: `bench-second-opinion.mjs` mutates a finished run, re-spawns one node against it and
  scores the result against known ground truth with a cross-family judge and a negative control.
  What AC15 needs is a second mutation — a seeded contradiction between two reporters rather than a
  moved anchor — not a second harness. AC15 still records the exclusion as structural: AC3 leaves
  out the adjudicators because they emit votes rather than located findings, and that is why one
  third of the panel has no number.

### Why there is a two-week gap before this entry

`bench/results` stops at 2026-09-06 and resumed today. Not because nobody ran the bench — because
**nobody could**. The harness computed its run directory as `<worktree>/.claude/reviews/<id>` while
`review.reviews_dir: ""` stages runs under the engine's home, so `run-graph` refused the path and
every seed died at exit 2 before a lens spawned. Four defects were fixed to get a number at all:
the run directory is now read rather than computed, `duration_ms` is collected (it was measured and
dropped), the knob is a flag rather than an uncommitted edit that never reaches the seeded tree, and
a no-op replacement is no longer mistaken for a missing line
(`bench/results/2026-09-21T00-14-09-693Z.json` is that failure preserved: 7 seeds NOT RUN, $0) — which had made the control arm
(`--effort xhigh` against a contract already at `xhigh`) the one setting the harness refused to run.

## 2026-09-23 — `second-opinion` at sonnet: 0 / 6, and the first use of the admission gate

The first candidate comparison this harness has been able to make. AC1/AC2 ask every benched
position to run the setting in force against a lower one; `second-opinion` could only ever be
measured at the frozen setting until `--model` / `--effort` existed. They do now, and this is what
the first pass through them says.

| | recall | seeds | tokens | wall-clock | Anthropic $ | false alarms |
|---|---|---|---|---|---|---|
| **opus/medium** (in force) | **6 / 6** | 6 scoreable of 7 | 5,479,400 | 673 s | $6.70 | 0 |
| **sonnet/medium** (candidate) | **0 / 6** | 6 scoreable of 7 | 12,489,673 | 974 s | $6.07 | 0 |

`node scripts/bench-admit.mjs --current <opus> --candidate <sonnet> --fp-tolerance 0` →
**REJECTED**, exit 1, all six seeds named. Every seed the setting in force catches is lost.

**Sonnet is not cheaper here — it is worse on every axis that matters and barely cheaper on the one
that does not.** 2.3x the tokens, 45% more wall-clock, within 10% on dollars, and nothing caught.
That is the opposite of the trade AC6 warns the comparison exists to test: "a drop in token usage at
lower effort is EXPECTED, not a finding", and here the token usage did not even drop. The dollar
figure is the only column that flatters sonnet, and it is also the column the operator ruled is not
the unit — "a dollar total is not what runs out".

**The mutations were sound, and that is checkable rather than assumed.** `misanchor` is the one
mutation whose tell check is mechanically bounded on every rung: all six forges passed it — "the
rationale cites the injected anchor and nothing near the real one" — and every forge ran at
**opus/medium**, the reconciler's own setting, never the candidate's. A pass comparing two settings
must vary one thing, and forging the mutated paragraph at the candidate's setting would vary the
thing being audited as well as the auditor. So these are six well-formed injected errors that sonnet
read and did not report.

**Read this as low, not as zero.** An earlier single-seed pass at sonnet/medium CAUGHT
`verdict-floor-absent`, which this pass missed — same model, same seed, same effort. The difference
is the forged paragraph: `--rule rewrite` re-forges on every pass, so the two runs audited different
prose about the same injected error. Sonnet's record across the two is 1 catch in 7 attempts, not
0 in 6, and this corpus cannot separate "cannot do it" from "does it sometimes". Holding the
paragraphs fixed is what `--forged` is for and it was not used here; a re-run through it would make
the two passes the same experiment.

Sonnet's reports are about a third the length of opus's — 4.1-4.4 KB against 7-14 KB, 7 KB of
stdout against 17.7 KB — while consuming more than twice the tokens. Both nodes reported `state: OK`.

### What this does NOT settle

- **Effort was not varied.** Only the model moved. AC2 treats them as separate knobs and the lower
  efforts on opus are unmeasured, which is the cheaper question and the one more likely to have a
  usable answer.
- **One mutation shape.** `misanchor` only. `deflate` and `drop` have their own baselines at
  opus/medium (6/6 and 4/4) and no candidate pass.
- **The false-positive clause was decided by a tolerance passed on the command line, not a declared
  one.** `--fp-tolerance 0` was safe to assert here only because both sides scored 0 — the clause
  never bound. The threshold AC7 needs is still open in the request's `Needs input`, and a
  comparison where false alarms actually moved would have come back `undecided`.
- **`clamp-silent-noop` is NOT RUN at either setting** — no admissible anchor to move its one group
  to. The denominator is 6, not 7, on both sides, which is why the comparison is fair and also why
  it is narrow.

## 2026-09-23 — opus/low: the same six catches for a quarter of the tokens

The other half of AC2's search space, and the one that had the usable answer. The model was held
and the effort dropped one rung — `low` is the ONLY admissible candidate at the current model,
because AC2 admits efforts *below* the one in force and `medium` sits one above the floor.

| setting | recall | tokens | wall-clock | node $ | total $ | false alarms |
|---|---|---|---|---|---|---|
| **opus/medium** (in force) | 6 / 6 | 5,479,400 | 673 s | $5.32 | $6.70 | 0 |
| **opus/low** | **6 / 6** | **1,494,114** | **216 s** | **$2.44** | $3.75 | 0 |
| sonnet/medium | 0 / 6 | 12,489,673 | 974 s | $4.75 | $6.07 | 0 |

`bench-admit --fp-tolerance 0` → **ADMITTED**, and by **dominance** rather than the 10% tiebreak:
better or equal on tokens, wall-clock and false-positive candidates, strictly better on all three.
3.7x fewer tokens, 3.1x faster, 54% less on the node, and not one seed lost.

**This is the result AC6 says the comparison exists to produce.** "A drop in token usage at lower
effort is EXPECTED, not a finding… the job is to establish whether recall and false-positive
candidates HOLD when it is." They held, exactly.

**The confound was watched for and did not bite.** `--rule rewrite` re-forges every pass, so
opus/low audited different paragraphs than opus/medium did. The asymmetry that makes the conclusion
safe anyway: the setting in force caught 6/6 — every paragraph it was given — and opus/low caught
6/6 of its own independent draw. A regression would have needed disambiguating with `--forged`; a
clean sweep of a fresh draw does not. Compare the sonnet result, where the confound DID bite and is
recorded as such.

**Both forges ran at opus/medium on every seed**, the reconciler's own setting, so the only thing
that moved between the two passes is the auditor's effort.

### Read together, the two candidate passes say different things

- **Effort is where the slack was.** Dropping one rung cost nothing measurable and saved three
  quarters of the tokens.
- **Model is not.** sonnet/medium spent 2.3x the tokens of opus/medium to catch nothing — the
  cheaper-model hypothesis is not merely unproven here, it is contradicted on every axis.
- Which is why AC2 insists they are SEPARATE KNOBS. A sweep that moved both together would have
  found one number, somewhere between a clean win and a total loss, and learned nothing from it.

### Still not settled

- **One mutation shape.** `misanchor` only, at every setting. `deflate` (6/6) and `drop` (4/4) have
  opus/medium baselines and no candidate pass.
- **`low` is the floor of the search space, and it held.** Nothing below it exists on this runtime's
  ladder, so this corpus cannot say where the setting would start to break — only that it has not
  broken by the bottom rung. The corpus shows a CEILING effect at 6/6 and cannot separate settings
  above it.
- **The FP clause never bound.** All three passes scored 0 false alarms, so `--fp-tolerance 0` was
  safe to assert and decided nothing. The threshold AC7 needs is still open.
- **`clamp-silent-noop` is NOT RUN at every setting** — no admissible anchor. The denominator is 6
  on all three sides, which keeps the comparison fair and the corpus narrow.

## 2026-09-23 — opus/low across all three mutation shapes

The adopted setting had been measured on `misanchor` alone. These are the other two, so the
override in `lens-roster.json` rests on the whole corpus rather than a third of it.

| mutation | setting | recall | tokens | wall-clock | node $ | false alarms | gate |
|---|---|---|---|---|---|---|---|
| `misanchor` | opus/medium | 6 / 6 | 5,479,400 | 673 s | $5.32 | 0 | — |
| `misanchor` | **opus/low** | **6 / 6** | 1,494,114 | 216 s | $2.44 | 0 | **ADMITTED** (dominance) |
| `deflate` | opus/medium | 6 / 6 | 4,234,272 | 492 s | $4.43 | 0 | — |
| `deflate` | **opus/low** | **6 / 6** | 1,233,567 | 205 s | $2.38 | 0 | **ADMITTED** (dominance) |
| `drop` | opus/medium | 4 / 4 | 2,423,294 | 282 s | $2.58 | 0 | — |
| `drop` | **opus/low** | **3 / 3** | 1,067,761 | 150 s | $1.89 | 0 | **UNDECIDED** |

Every shape: roughly a **3.5x token drop, 2.3-3.1x faster, ~half the node cost, and not one seed
lost to a lower effort.** Two of the three gates admit by dominance. Nothing regressed anywhere.

**The structural refusals are identical at both settings**, which is what makes these comparisons
fair rather than merely similar: `deflate` refuses `doc-stale-panel-contract` at both (MEDIUM cannot
fall two rungs), and `drop` refuses the same three at both (their target roots other groups). Those
decisions are made before any model is called, so the denominators match by construction.

### `drop` is UNDECIDED, and the reason is the JUDGE rather than the candidate

`numeric-bundle-pager` scored `unverified`: the judge voted `identified` and cited
`"g-2: i dispute the drop..."`, **a quote that is not in the report.** So the node ran, produced an
audit, and the instrument failed to substantiate its own vote.

That is neither a catch nor a miss. Counting it as caught would accept an unchecked claim; counting
it as missed would blame the node for the judge's indecision. It is recorded as **ran but could not
be scored**, it blocks admission exactly as an absent seed does, and the verdict is `undecided`
rather than `rejected` — nothing regressed, one seed has no verdict.

This is the third verdict earning its place on real data rather than in a test fixture. It also
exposed a wording defect: the gate called such a seed "never measured by it", which is wrong twice
over — it WAS measured, and the failure was the instrument's. `unscoreable` and `absent` are now
named apart, because they call for different next steps. An absent seed means run it; an unscoreable
one means re-running may land the same way and the judge is what to look at.

`drop` at low is therefore **3 for 3 on the seeds that produced a verdict, with a fourth unsettled by
the judge.** Read the denominator: this mutation only ever had four, and at n=3 one seed is a third
of the result.

### What is now settled, and what is not

- **Settled: the adopted `effort: low` on `second-opinion` holds across all three mutation shapes.**
  It was adopted on one; it is measured on three, with no regression in any.
- **Not settled: whether the judge's `unverified` rate rises at lower effort.** One occurrence in
  15 scoreable seed-runs is not a rate, and this corpus cannot distinguish a judge that is flakier
  against shorter reports from one that was always going to miss occasionally. Worth watching rather
  than acting on.
- **Not settled: the lenses.** None of this touches `review.effort.judgment`, which stays at
  `medium`. No lens corpus has run at `low`.
- **The false-positive clause has still never bound.** Six passes, 0 false alarms in every one.

### Correction, same day: `drop` at opus/low is 4/4, not 3/3

The `unverified` seed above was an instrument false negative, and the cause is two asterisks.

`numeric-bundle-pager`'s audit caught the injected error and said so at length — "The worst
adjudication error in this run is G-2. `reconciled.md` confirms it as a BLOCKER in its summary and
then drops it in its group listing." The judge voted `identified` and cited the sentence that says
so. The scorer rejected the citation:

```
report : - **G-2: I dispute the drop.** It should be Confirmed at BLOCKER, with G-7 and G-6 ...
judge  :   G-2: I dispute the drop. It should be Confirmed at BLOCKER, with G-7 and G-6 ...
```

`flat()` in `lib/verbatim.mjs` normalised whitespace and case and left markdown emphasis in place,
so the needle was not a substring of the haystack. The check was asking "did you reproduce my
formatting", which is not the question it exists to ask — and stripping formatting is what every
quoter does, model or person.

`flat()` now drops `*`, `_` and backticks. It is a loosening in the safe direction: emphasis markers
are presentation rather than words, and every protection worth having is untouched — fragments must
still appear, in order, each longer than `minFragment`, so two unrelated sentences cannot be
stitched into a quotation nobody wrote. `check-quotes.mjs` shares the rule and still verifies all 19
build-log quotations.

Re-scored from the preserved report and the preserved citation, that seed is `identified`. So:

| mutation | setting | recall | gate |
|---|---|---|---|
| `drop` | opus/medium | 4 / 4 | — |
| `drop` | **opus/low** | **4 / 4** (was read as 3/3) | **ADMITTED** |

**All three shapes now admit opus/low by dominance, with no seed lost anywhere.**

The result FILE is left as it was written. It is a record of what that pass measured with the
instrument it had, and rewriting it would erase the only evidence that the instrument was wrong.
The correction lives here and in the fix.

**What this says about the numbers above it:** one `unverified` in 15 scoreable seed-runs was read
as a fact about the candidate and was a fact about the scorer. The earlier note wondering whether
the judge's `unverified` rate rises at lower effort is withdrawn — there is no rate to explain. It
also means the `unscoreable` branch the gate grew that day was exercised for the first time by a
bug, which is the right way round: the branch behaved correctly (blocked admission, named the seed,
refused to call it a miss) on an input that should never have reached it.

## 2026-09-23 — the lens sweep at low that could not be compared to anything

`--effort low` across the 7-seed lens corpus: **4/4 caught, 3 NOT RUN, $5.28**
(`bench/results/2026-09-23T20-28-31-915Z.json`). It is recorded here as a **measurement, not a
comparison**, because it cannot be gated against anything that exists.

**Three variables moved, not one.**

| | baseline (2026-09-20T23-46-34-579Z) | this sweep |
|---|---|---|
| effort | medium | **low** — the intended variable |
| `corpus_commit` | `07db3f6b` | **`8c23dbd6`** |
| reporters | 11 nodes, no arms | **14 nodes, 3 codex panel arms** |

The reporter set is the damaging one, and it is damaging in the direction that looks fine. Seeds
here recorded `caught by: code-audit, panel-codex-code` — **a seed the lens MISSED and an arm CAUGHT
still scores as caught**, so an unmatched panel masks exactly the regression a gate exists to find.
Tokens, wall-clock and false-positive candidates are inflated by three extra nodes besides.

The tree differs because `bench-lenses` seeds whatever `HEAD` is when it runs. **Lens comparisons
are therefore only valid within one commit**, and nothing said so — `bench-lenses` already refuses
this one level down (`--score-only` will not recompute an anchor against today's checkout, "the
cross-tree comparison this rework exists to make impossible") and nothing enforced the same rule
between two whole sweeps, where it costs a pass rather than a seed.

**What it cost, and what it bought.** $5.28 for an ungateable result, and: `comparabilityErrors`,
which now refuses a comparison differing in corpus commit, reporter set, or a sweep whose per-node
records show more than one model or effort; `--no-panel`, because `review.effort.judgment` moves
every Claude lens and no arm, so isolating the lenses is the only way to attribute a change to the
knob under test; and `config.override`, because `config.declared_effort` was not merely stale but
**off by one** — the xhigh sweep records `high` and the medium sweep records `xhigh`, each having
captured the repository's contract as it stood before its own flag.

**The canary refused 3 of 7 seeds**, reporting `node-settings.json was probably not loaded` while
each seed's own `sandbox-canary.json` recorded two denials — proof it HAD loaded. The probe was told
to run one allow-listed command, ran `ls -la` first "to check that capture.mjs and the run directory
exist", was correctly denied twice, and never reached the real one. That is G-63 in the positive
arm; the diagnosis is fixed, the flakiness is not.

### What a valid lens comparison needs

Both passes at the same commit with the same reporter set — `--no-panel` on both, which is also the
only configuration that measures what `review.effort.judgment` controls. Roughly $29 at 7 seeds,
more if the canary keeps flaking. **`review.effort.judgment` stays at `medium`** until that runs:
the `low` adoption on `second-opinion` is a per-node override in `lens-roster.json` and says nothing
about any lens.

## 2026-09-24 — the lenses at low: 7/7, and a QUARTER of the false positives

The comparison the three earlier attempts could not make. Both halves at commit `d64101ea`, the same
11 reporters, `--no-panel` on both, zero canary failures, seven seeds each.

| setting | recall | fp candidates | tokens | node-minutes | Anthropic $ |
|---|---|---|---|---|---|
| **opus/medium** (in force) | 7 / 7 | 7 | 7,537,298 | 18.2 | $10.16 |
| **opus/low** | **7 / 7** | **1** | **4,345,509** | **10.1** | **$7.26** |

Token totals corrected 2026-11-22 (G-3 of 20261122-035227-m3s7-b3-review): these rows first read 7,550,856 and
4,348,374, which added each run's top-level `thinking_tokens` (13,558 and 2,865) to `output_tokens` that already
contains them (`scripts/lib/bench-settings.mjs`, `RESTATED_TOKEN_KEYS`). The verdict below does not change.

`bench-admit --fp-tolerance 0` → **ADMITTED**, by **dominance**: better or equal on tokens,
wall-clock and false-positive candidates, strictly better on all three. Not one seed lost.

**The cheaper setting produced LESS noise, not more.** False-positive candidates fell 7 → 1. AC7
exists because "a cheaper model that matches recall by reporting far more findings has not produced
a similar result; it has moved the work to whoever reads the gate" — the opposite happened here, and
it is the reason to read the fp column before the recall column.

**The false-positive clause never bound.** Because the count FELL, any tolerance ≥ 0 admits. The
undeclared "material rise" threshold in `Needs input` still matters for a future comparison where
noise rises; it simply was not needed for this one.

**Per-node, the difference is one knob.** Six judgment-tier nodes moved medium → low — `code-audit`,
`contract-audit`, `doc-consistency-review`, `security-audit`, `intent-capture`, `reconcile`. Exactly
one node was constant: `second-opinion`, pinned at `low` on BOTH sides by the override adopted
2026-09-23. A node held constant across both sides is a **control**, not a contaminant.

### The guard refused this valid pair, and was wrong

`comparabilityErrors` asked "is each file internally uniform?" and the medium sweep reads
`mixed(low|medium)` precisely BECAUSE of that adopted override. The right question is whether the
DIFFERENCE is one coherent change, so it now lines up per-node settings instead — and refuses a pair
where nothing moved, which is the same sweep twice rather than a comparison.

That is the third time real data refuted a guard written from a plausible assumption, after
`caughtSeeds` matching a vocabulary nothing writes and the token/duration readers walking shapes no
artifact has. Each was caught by an artifact rather than by review.

### What this does and does not license

- The lens corpus now says `low` loses nothing it can detect, at the FLOOR of the runtime's ladder.
  It shows a **ceiling effect** at 7/7 and cannot locate where the setting would begin to break.
- **`review.effort.judgment` is still `medium`.** This is a measurement and a gate verdict, not an
  adoption: A-20 and I-9 both name bench tooling editing the contract as a failure mode.
- Measured with the panel OFF, which is the only configuration that isolates what
  `review.effort.judgment` controls — it moves every Claude lens and no arm. Nothing here measures
  the arms, and nothing here measures a run WITH the panel, where arms may catch what a lens missed.
