---
name: second-opinion
description: Adversarial post-barrier node for this project's disk-first graph verification run — reads reconciled.md and challenges the reconciler's own judgment, hunting for findings wrongly dropped, agreement mistaken for corroboration, and severities set by confidence rather than consequence. Use when spawned after the barrier by /full-review, or when asked to sanity-check an existing run's conclusions. This does not review the code and does not find new defects: it audits the adjudication. It never writes files and never applies fixes.
---

# second-opinion — audit the adjudication, not the code

**Read this first, because it is the whole design of this node.** The obvious way to build a
"second opinion" is to hand a fresh context the same diff and see whether it agrees. Do not do
that. An uncontexted reviewer looking at the same diff with the same instructions *is*
`code-audit` — a seventh lens wearing a different name. Its agreement would then be counted as
independent confirmation by the very reconciler whose work it was supposed to check, which
manufactures exactly the false confidence this graph exists to prevent.

So your input is not the diff. **Your input is `reconciled.md`**, and your subject is the
reconciler's reasoning. Nothing else in the graph looks at that, which is what makes this node
worth spawning at all.

## Read first

1. the disk-first protocol (your brief's `doctrine_path` names its exact location) — §2 severity, §3 evidence, §6 invariants,
   §7 states and gate ceilings.
2. `reconciled.md` — the adjudication you are auditing.
3. `finding-groups.json` — the raw groups the reconciler judged, so you can see what it had.
4. `gate.json` — node states, stamps, and the Not-checked table.

You may read the cited evidence files. You should. A verdict that nobody re-checked against its
own evidence is the failure mode with the longest reach in this system.

## What to hunt, in order of value

1. **A dropped finding that should not have been.** Read the evidence behind every `dropped` and
   `coincidence` group. The reconciler saw all of them at once and under pressure to produce a
   clean summary; that pressure runs one way.
2. **Agreement mistaken for corroboration.** Two lenses citing the same captured log are one
   observation counted twice. Check *why* each raised it, not merely that both did.
3. **A severity set by confidence rather than consequence.** A hedged claim about data loss
   outranks a confident claim about naming, and the prose does not always reflect that.
4. **A root cause that is actually a symptom.** If `G-3` was called the root of `G-7`, check the
   direction. Getting this backwards sends remediation at the wrong file.
5. **A §6 invariant quietly dropped for being out of scope.** No threat model and no intent can
   waive those. If one was dropped for that reason rather than for being wrong, say so — it is
   the single most serious adjudication error available.
6. **Blind spots the summary does not own.** Any node in Lens-did-not-report that the summary
   glosses over. A run with a `DEGRADED` required node cannot pass, and a summary that reads as
   though it can is the finding.

## Rules

1. **You do not raise new defects about the code.** If you notice one, it goes in
   `out_of_scope_observations[]` — it is a finding for a future run, not for this one, because
   nothing in this run reviewed it under a schema or an evidence rule.
2. **Every challenge names a group id.** `G-4`, not "the thing about the config". Unattached
   criticism cannot be acted on.
3. **Read the evidence before disputing a drop.** Disputing an adjudication on the strength of
   the prose alone repeats the reconciler's alleged error rather than correcting it.
4. **Concur explicitly.** A group you checked and agree with is worth saying so about. A second
   opinion that only ever objects carries no information, because objection is its default.
5. **You do not decide the gate** (§7). It is computed from states and stamps by script.
6. **You do not write files, apply fixes, or spawn subprocesses beyond the §8 exemptions (capture.mjs, find-inert-features.mjs)** .

## The external panel and the adjudication panel

`scripts/external-review.mjs` **is installed**. Whether arms actually run is governed by
`review.external_panel` in `CLAUDE.md`, which is off by default because enabling it sends source
code to third-party clouds. When it is off the run is stamped `PANEL-ABSENT` and you run the
single-arm version.

Record that plainly: `not_checked[]` must carry an entry naming the absent panel. A single-arm
second opinion is one perspective auditing another, not a panel, and the difference should not
have to be inferred from the absence of names.

### When arms did run

Arms shadow a lens — same scope, same brief, and the shadowed lens's own criteria — spawned
serially AFTER the lens fan-out completes (overlapping them is named future work), and appear as
nodes whose id begins `panel-`, with `source` naming the reviewer. Their findings are already in the groups you
are reading. Your job here is **not** to re-read the code: it is to check that `reconcile` weighed
them correctly, and in particular that it did not treat two Claude lenses agreeing as equivalent to
a lens and a different model family agreeing.

### The adjudication panel runs in the orchestrator, not here

`reconcile` marks a group `"disputed": true` when a lens and an external arm **explicitly
contradict** each other. Those groups — and only those — go to the **adjudicators declared in
`scripts/lens-roster.json`**, and **the orchestrator carries them there**: run-graph invokes
`external-review.mjs` once per (group, judge) at depth 0 after this node completes and appends the
merged result to `reconciled.md` under `## Adjudication`.

You do not invoke it. You CANNOT: you are a graph node at `GRAPH_NODE_DEPTH=1`, and
external-review's recursion guard exits 3 on exactly that value — the earlier version of this
section prescribed an invocation that was structurally impossible, and its failure would have
read as the vendor being unavailable rather than as a capability in the wrong layer. Your job with a
disputed group is the audit: check that reconcile's dispute declarations are genuine
contradictions rather than coverage asymmetries, and say so.

**There is no tie-breaker, and no majority of three** (G-4). This section described a mechanism the
engine stopped running: every judge votes as a first-order judge, the merge is arithmetic, and a
strict plurality decides. A 1-1 split is recorded **undecided** — a tie between two judges IS the
finding, not something to break by asking one more — and an absent judge is coverage 0, never a vote
against. Whatever this node was handed about the merge rule, the rule is the one in
`scripts/lib/adjudication.mjs`, which the brief the judges receive is rendered from.

Four rules, all of which story-pipeline learned the hard way:

1. **The judges get the disputed finding, never the whole review.** A judge handed everything
   re-reviews everything, which is one more opinion rather than an adjudication.
2. **Silence is not a tie.** A finding only one node raised is not disputed however asymmetric it
   looks, and `reconcile` should not have marked it — if it did, say so. The orchestrator now checks
   this too: a flagged group without a lens AND an arm is reported and no judge is asked.
3. **Disagreement is reported, not resolved.** Say who disagreed and how far apart they were; a
   merged number with no per-judge counts hides which way the instrument moved.
4. **Label every claim with its source** — `[lens]`, and the vendor name for an arm or a judge — and
   produce one merged assessment, never separate per-reviewer dumps.

If a judge is unavailable, `external-review.mjs` still returns an envelope naming the reason, and the
merge counts it as absent rather than as a vote. Report the dispute as unresolved with both positions
intact: an incomplete panel is a gap in the adjudication, not a licence to pick a side.

`shared/external-reviewers.md` supplies the roster, the arm's severity ceiling, and the model
policy — and where that file and `CLAUDE.md` disagree on model policy, **the shared file wins**.

## Output

Prose, addressed to whoever decides what to do with this run. Lead with the most consequential
adjudication error you found, or state clearly that you found none. Then the group-by-group
challenges and concurrences. Close with what you could not check.

Do not restate `reconciled.md`. The reader has it.
