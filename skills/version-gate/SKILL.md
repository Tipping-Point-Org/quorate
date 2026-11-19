---
name: version-gate
description: Milestone exit gate for this project's disk-first graph verification system — consumes gate.json from completed runs and checks every Definition-of-Done item against recorded evidence before a version may be called done. Use when the user asks whether a version is finished, whether it can ship, wants to wrap up a milestone, or declares a version complete — even if no gate check was requested. This is NOT the per-run gate that run-graph.mjs emits automatically: that one judges a single review run, this one judges a whole milestone against its roadmap, and it reads run artifacts rather than reviewing code itself. Reads project-specific Definition-of-Done locations and end-to-end evidence requirements from .claude/quorate/version-gate.md when one exists.
---

# version-gate — milestone exit gate

A version is done when its exit gate passes with evidence, not when the features feel complete.
The gate exists because each milestone is the foundation the next one builds on, and a soft pass
compounds: a later feature built on a "mostly working" earlier one fails in ways that look like
bugs in the later feature. The characteristic failure this skill prevents is the plausible
summary — a confident paragraph asserting a version is ready, assembled from impressions, with
no run behind it.

**This skill reads; it does not review.** Its evidence comes from `gate.json` files that
completed runs already produced. It never re-derives a finding, never spawns a lens, and never
substitutes its own reading of the code for a recorded verdict. If a gate item has no run behind
it, the answer is "not verified" — not a fresh opinion.

## Read first, in this order

1. The `graph_contract` block in `CLAUDE.md` — `doc_roles.roadmap`, `doc_roles.spec`,
   `review.reviews_dir`.
2. The document named by `doc_roles.roadmap` — the milestone's row, its exit gate, and its
   Definition-of-Done list. This is the checklist; build it before looking at any run.
3. `.claude/reviews/latest.txt` and the `gate.json` of every run relevant to this milestone.
   `gate.json` is the stable machine-readable surface: per node
   `{node_id, state, verdict, findings_count, report_path, report_sha256, evidence_dir}`, plus
   `stamps[]` and the overall `gate`.
4. `.claude/quorate/version-gate.md` if it exists -- how THIS project declares a milestone's
   Definition-of-Done, which fixtures count as end-to-end evidence, and the local history a
   portable skill cannot know. Absent, say so in the report and infer from the roadmap.

**A profile is CONTEXT, not authority.** It carries vocabulary, structure and local history that
the contract cannot. It does not relax this skill's bar, waive a refusal condition, or license
declaring a gate PASSED on evidence this skill would not otherwise accept. Where it disagrees with this skill or with the doctrine,
they win, and the disagreement is itself worth reporting.

That paragraph lives here rather than being stamped on the text you read, and the difference is
worth knowing. A **node's** profile is assembled by the orchestrator, which bounds it, declares in
the brief when it had to truncate, and writes that framing itself. A **skill's** profile is read by
you directly -- Claude Code loads this file, so there is no assembly step and none of those
guarantees execute. `check-install` is what reports a profile that is empty, unreadable, or over the
size budget; nothing does so at the moment you read it.

## Procedure

1. **Build the checklist first, from the roadmap** — before opening any run. Assembling it from
   what the runs happen to have checked guarantees a pass and measures nothing.
2. **Map each gate item to evidence.** For each item, find the run and the node that
   demonstrates it, and record `run_id`, `node_id`, and `report_sha256`. An item with no
   mapping is **not verified**, which is distinct from failed.
3. **Read the stamps, not just the verdict.** A run stamped `UNBUILT`, `UNTESTED`,
   `INTENT-DRIFT`, `TREE-MOVED`, `UNSWEPT-DIFF`, `UNBENCHED`, `PANEL-ABSENT`, `CHECKS-SKIPPED` or
   `CHECKS-INPUTS-INFERRED` has a ceiling below `PASS`, and an item resting on such a run inherits
   that ceiling. A `PASS` under `UNBUILT` is not evidence that anything works.

   `CHECKS-REUSED` needs its own look, because it does NOT cap and is the one stamp that changes
   *which tree* the evidence describes. The build and test results in that run were produced
   elsewhere, on an input set that hashed identically (`shared/disk-first-protocol.md` §7) — real evidence about
   this same code, which is why there is no ceiling. But `gate.json` names the run that produced it
   (`preflight.from`), and a release decision citing "the tests passed" should cite THAT run, not
   this one. Paired with `CHECKS-INPUTS-INFERRED`, the freshness claim itself rests on a guess and
   the ceiling applies.
4. **Check freshness.** A run whose `base_commit` predates the current `HEAD` describes code
   that has since changed. Recompute the worktree state; if the tree has moved, every file-line
   finding is stale and the item needs a fresh run. Cite the commit each item was verified at.
5. **Check completeness of the roster.** A run where a *required* lens did not report has a hole
   in it, whatever its gate says — read `gate.json.buckets.did_not_report`, not just `gate`.
6. **Honour declared exclusions.** A milestone's stated non-goals are *correct* when absent. Do
   not report an excluded item as missing.
7. **Mark each item pass / fail / not-verified with its evidence beside it.** A single failing or
   unverified item means the version is not done. Say so plainly and list what remains. **Do not
   average it into "mostly done"** — that phrase is how a soft pass enters the record, and every
   later milestone inherits it.

## Rules

1. **Evidence, not impressions.** Every `pass` cites a `run_id`, a `node_id`, and a
   `report_sha256`. An item marked pass with prose instead of a hash is not passed.
2. **A verdict you did not find is not a verdict.** Absent evidence is `not-verified`. Never
   promote "I read the code and it looks right" into a gate pass; that is precisely the
   unverified confidence the graph exists to eliminate.
3. **Never re-run a lens to fill a hole.** If an item lacks evidence, report the hole and name
   the run that would close it (`/full-review` with the relevant scope). Producing the missing
   evidence yourself puts the same context that assessed the gate in charge of satisfying it.
4. **Stamps are inherited, not discarded.** An item's status can never exceed the ceiling of the
   run it rests on.
5. **Silence is not a verdict.** State what you checked even when clean, and list every item you
   could not evaluate with the reason.
6. **You do not write source files, apply fixes, or spawn lenses.** You may write your report to
   the reviews directory. Nothing else.

## Report format

```markdown
## Version gate — <milestone>

**Verdict:** PASS / FAIL (<n> of <m> items verified)
**Evidence base:** <run-ids>, at base_commit <sha> — tree <clean|moved since>

| # | Gate item (source §) | Status | Evidence |
|---|---|---|---|
| 1 | <item> (<roadmap> §N) | pass | `<run-id>` / `<node-id>` / `<sha256 prefix>` |
| 2 | <item> (<roadmap> §N) | not-verified | no run covers this scope |
| 3 | <item> (<roadmap> §N) | fail | `<run-id>` / `<node-id>` — FAIL, 3 findings |

### Remaining work (if not PASS)
- <item> — <what would close it: the run and scope to execute>

### Ceilings inherited
- `<run-id>` stamped `UNBENCHED` — every perf item resting on it caps at RISK, unless a §6 invariant finding drives it

### Not checked
- <item> — <reason>
```

If the gate passes, the report is the milestone record: write it to
`<reviews_dir>/version-gate-<milestone>.md` so a later milestone can cite it rather than
re-deriving it.

## Refusal conditions

Report `FAIL` with an explanation and stop, if any of:

- there is no `graph_contract` block in `CLAUDE.md`;
- `doc_roles.roadmap` is empty or names a path that does not exist — without a declared exit
  gate there is no checklist, and inventing one produces a gate that passes by construction;
- no completed run exists in the reviews directory. A milestone with no run behind it is not
  "not done yet" in a way this skill can quantify; it is unverified, and the fix is to run
  `/full-review` first.
