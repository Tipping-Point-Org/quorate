# Graph topologies

Doctrine for decomposing work into a graph of isolated agents. This file is cited by
`graph-plan` and is deliberately **off the review critical path** — nothing in a verification
run depends on it. It exists so that decomposition decisions for *novel* parallel work are made
against something written down rather than reinvented per task.

## Nodes and edges

A **node** is a bounded unit of work with one input payload, a clean context, and one output. A
node that reads its own earlier output is not a node; it is a loop with extra steps.

An **edge** is a dependency carrying data from one node to another. Edges are where cost hides:
every edge is a payload someone has to construct, and a payload constructed by a model is a
place where the brief can drift from what the orchestrator intended.

The reason to build a graph rather than a loop is not speed. It is that a long linear context
degrades — later work is done against a summary of earlier work, and nobody can tell which
summary lost the detail that mattered. Isolation trades that for a different problem, below.

## The three topologies worth naming

**Diamond.** One decomposer fans out to parallel workers; an aggregator recombines. Use it when
the work genuinely splits into independent pieces.

Its weakest node is the decomposer, and this is not a small caveat: **if a model invents the
split, nothing downstream can tell a bad split from a good one.** Every worker returns
confidently about its assigned slice, the aggregator sees full coverage, and a whole region that
was never assigned to anyone is invisible. Derive the split from declared data wherever you can.
This is exactly why `full-review` derives its node set from `lens-roster.json` crossed with the
contract, and why `expected.json` is written *before* anything launches.

**Fan-in at barrier.** One artifact examined concurrently through several different lenses, held
at a synchronisation point until all have reported. Use it when the work does not split — when
every worker needs the whole thing, and what differs is the question each asks.

This is the verification graph's shape. Its failure mode is the barrier: if the barrier
enumerates *results*, a worker that died silently simply does not appear, and its absence reads
as "nothing to report". Enumerate *expectations* instead, and treat a missing result as a
finding about the run.

**Adjudication panel.** Several judges of *different families* vote independently on one fixed
item, and the merge is arithmetic: a strict plurality decides, a tie is recorded **undecided**, and
an absent judge is coverage 0 rather than a vote against. Use it where the question is small, fixed,
and answerable from what you hand the judges — and where you need to know how reliable the answer is,
not just what it is.

It is the odd one out in a useful way: **disagreement is the output, not a problem to route around.**
Diamond and fan-in both converge on one answer. This one reports the spread, because the thing being
measured is partly the judges.

Three consequences, all learned by measurement rather than reasoning:

- **The categories decide the number.** The same 147 items, judged with bare category *names*, gave
  Fleiss' kappa 0.12; with one-line definitions added, 0.66 — and two judges' pairwise agreement went
  36% → 97%. *The disagreement was never about the items.* A panel handed bare labels measures how
  differently its judges read the labels, so the vocabulary and its definitions must come from one
  declaration that the brief and the merge both read.
- **Report the agreement beside the number, always.** A figure without its per-judge counts hides
  which way the instrument moved: one measured round saw kappa fall 0.66 → 0.35 while the headline
  barely changed, because a single judge's objection was a *different rule* that more items gave more
  to fire on. And a lone judge agrees with itself trivially — reporting that as 100% is a single-judge
  number in a bigger font.
- **A judge is not a function.** The same two judges, on the same fixed item, with the same brief, gave
  different answers on two consecutive runs: one round split 1-1 (`neither` against one named
  position), the next was unanimous for `neither`. Nothing about the item changed — the brief was
  rendered from the same reconciliation, byte for byte reused. So a single round's `decided` is a
  sample, not a measurement, and a `tied` outcome says at least as much about the panel as about the
  item. Treat a run's outcome as one draw: report it, keep the votes that produced it, and do not
  re-ask hoping for a cleaner answer — asking again until the split disappears is how a measurement
  becomes a preference.

Where an implementation puts it is that implementation's business — this file is doctrine for
decomposing work, deliberately off the review critical path, and a paragraph here describing what
one engine does in one phase of one run belongs with that engine's own rules. quorate's use is
described in `shared/external-reviewers.md`, which owns how the panel is configured and what its
failures mean.

Two limits worth knowing before reaching for this topology at all, because they are properties of
the method rather than of any implementation:

- **It needs enough items.** Precision of a majority vote on n items has SE ≈ √(p(1−p)/n): ~100
  items resolve ±8 points, ~400 resolve ±4. Two figures within the SE of each other are the same
  figure, and a handful of items supports no percentage at all.
- **Chance agreement needs a distribution.** Fleiss' kappa is not computable from one item, so a
  panel run over a few items reports pairwise agreement WITH its pair count and refuses kappa
  rather than inventing it.

## The three flaws, and what actually fixes them

**Attribution.** When aggregated output is wrong, the intermediate contexts are gone and you
cannot tell which node corrupted it.

*The usual claim is that this is unfixable. It is not, here.* A node runtime that persists sessions
— Claude Code does — means recording each node's `session_id` lets the node that produced a bad
finding be resumed and interrogated directly. The command is the runtime's, not this document's: an
adapter declares `node_runtime.resume_argv`, and the report renders it. That upgrades attribution
from mitigated to solved, and it costs one field in a status file. Record the session id, and do not
disable session persistence for a node whose reasoning you might need to question.

A runtime that cannot reopen a session declares no `resume_argv`, and the report says the id is
recorded with no resume path. The attribution is then mitigated rather than solved, which is a fact
worth printing — the version of this paragraph that named one CLI outright made that state
unsayable.

**Context drift.** Each node sees only its slice and produces output that is locally coherent
and globally wrong. Fixed by putting the macro brief *in* each node's payload — scope, base
commit, changed files, allowed commands, and what the node may not look at — rather than
assuming a node will infer it. A node that has to discover its own context will discover a
different one each time.

The same rule decides where a PROJECT's own knowledge goes, and it is the harder half. A portable
node carries discipline — one behaviour per test, cite the rule, assert the negative space — while the
idiom, the layout and the local history belong to the project being reviewed, and a node that has
neither reviews against conventions it inferred from whatever it happened to read. The failure mode is
not a missing file: it is that a project with knowledge to convey and nowhere to put it writes its own
node of the same name, which resolves to one or the other silently. So the project's half is declared
in files the ORCHESTRATOR inlines, bounded and marked when cut, and framed to the node as context that
cannot waive a rule. Pointing a node at a path it should read is the version that works in some runs.

**The cheap reviewer paradox.** Verification on a cheap model produces more false positives;
downstream nodes then spend real tokens "fixing" code that was never broken, so the cheap graph
costs more than the expensive one. Model choice mitigates this but is the weakest available
tool. What actually works, in descending order:

1. Criteria captured *before* the implementation is read.
2. A mandatory evidence path behind every claim, produced by a script that prints the path back.
3. Corroboration from at least two independently-reasoning nodes — checked for *why*, not merely
   that both raised it.
4. Never applying fixes in the run that found them.

## Rules that fall out of the above

- **Mechanical work is script, not model.** Grouping, diffing, collation, table rendering. A
  model asked to do judgment *and* bookkeeping does the bookkeeping unreliably, and the failure
  is silent because the judgment looks fine.
- **Concurrency is a cost decision, not a capability one.** Wide fan-out multiplies
  cache-creation tokens before any useful work happens. Measure one node before widening.
- **Depth must be guarded.** A node that can spawn nodes is an unbounded fan-out with a bill
  attached. Carry depth in the environment, check it at every entry point, and state the
  prohibition in every brief.
- **Every bound must be visible.** A graph that silently caps at the top 10 findings, or drops a
  worker on first error, reports as though it covered everything. Log what was dropped.
