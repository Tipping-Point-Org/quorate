---
name: graph-plan
description: >-
  Decomposition doctrine for novel parallel agent work — decides how to split a
  task into nodes and edges, which topology fits, where the barrier goes, and
  what each node's payload must carry. Use when the user asks how to parallelize
  a task across agents, how to structure a multi-agent job, or wants a fan-out
  designed. This is NOT part of the verification review path: /full-review
  derives its own node set deterministically and never calls this. Use
  plan-review to decide whether work should happen at all; use this to decide
  how already-approved work should be split.
---

# graph-plan — how to split work that has no established split

**Read the boundary first, because this skill is easy to misapply.**

This is *not* on the verification critical path. `full-review` derives its node set
deterministically from `lens-roster.json` crossed with the contract, and it must keep doing so:
a model-authored decomposition is the weakest node in any fan-out graph, because nothing
downstream can tell a bad split from a good one. Every worker returns confidently about its
slice, the aggregator sees full coverage, and a region nobody was assigned is invisible.

So this skill is for the case where no declared split exists yet — genuinely novel parallel work
— and its main job is to produce a decomposition that is *declared* afterwards, so the next run
does not need a model to invent it again.

Distinguish it from its neighbour: `plan-review` decides **whether** work should happen and
whether it is in scope. This decides **how** already-approved work is split.

## Read first

`shared/graph-topologies.md` (under the framework root — `.claude/skills/quorate/shared/` when quorate is mounted as a submodule) — nodes and edges, the two topologies, the three
flaws and what actually fixes them. This skill applies that doctrine; it does not restate it.

## Method

1. **Name the artifact and the question.** What single thing is being worked on, and what is
   being asked of it. If there are two artifacts, there are probably two graphs.

2. **Choose the topology from the work, not from taste.**
   - The work splits into genuinely independent pieces → **Diamond** (decompose, fan out,
     aggregate).
   - Every worker needs the whole artifact and only the *question* differs → **fan-in at
     barrier**.
   - Neither fits and each step needs the previous step's output → **it is a loop.** Say so.
     Not all work is a graph, and forcing a fan-out onto sequential work buys latency and loses
     context for nothing.

3. **Derive the split from data if anything at all can be derived.** A file list, a module
   boundary, a declared roster, a test-suite partition. Every element you derive is an element
   that cannot drift. Only the residue should be a judgment call, and you should say which parts
   were which.

4. **Write the payload for one node in full, before designing the rest.** Scope, inputs, allowed
   commands, what it may *not* look at, and the exact output shape. If you cannot write it
   concretely, the split is wrong — that difficulty is diagnostic, not incidental.

5. **Place the barrier where cross-node information is genuinely needed.** A barrier is a
   latency tax: every node waits for the slowest. It earns that only when the next stage needs
   *all* results together — deduplication across the full set, an early exit on total count,
   comparison between results. "The stages are conceptually separate" does not justify one.

6. **Decide the output shape before the prompt.** A schema the orchestrator validates, not prose
   it parses. Free-text output between nodes is where every silent failure in a graph lives.

7. **Say what you are not covering.** An unassigned region is the Diamond's characteristic
   failure. Name it explicitly rather than letting it be inferred from absence.

## Rules

1. **Every node gets its macro brief in its payload.** Scope, base state, what it may not touch.
   A node that must discover its own context will discover a different one each time.
2. **Mechanical work is script, not model** — grouping, diffing, collation, rendering. A model
   asked to do judgment and bookkeeping does the bookkeeping unreliably, and silently.
3. **Guard depth.** If nodes can spawn nodes, the fan-out is unbounded. Carry depth in the
   environment, check it at every entry point, state the prohibition in every brief.
4. **Cap concurrency for cost, not for capability.** Cache-creation tokens dominate; a wide
   fan-out multiplies them before any useful work happens. Measure one node before widening.
5. **No silent bounds.** Any top-N, sampling, or drop-on-first-error must be logged. A graph
   that silently truncates reports as though it covered everything.
6. **Record what you decided so the next run does not re-decide it.** A decomposition used twice
   should be data — a roster file — not a judgment repeated. That is the whole reason the
   verification graph has `lens-roster.json`.

## Output

The node list with each node's payload sketch; the topology and why it fits; where the barrier
is and what it buys; what is derived versus judged; the concurrency cap and its basis; and what
is not covered.

Close with the roster entry this decomposition should become, so the split is declared before it
is used a second time.
