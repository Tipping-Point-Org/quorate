---
name: plan-review
description: Pre-run scope gate for this project's disk-first graph verification system — judges a proposed plan against the roadmap named by doc_roles.roadmap before any work starts, classifying every item as in-scope, scope creep, or premature decision, and inverting the check to find gate items the plan omits. Use before starting implementation on a milestone, when a plan or todo list for this project is drafted, or when asked what a version should include — even if no review was requested. This is NOT a code review and NOT part of the verification graph: it runs before there is code to review, and it decides whether work should happen at all rather than how to split it (that is graph-plan) or whether it was done right (that is the lens roster). Reads project-specific milestone vocabulary and exit-gate locations from .claude/quorate/plan-review.md when one exists.
---

# plan-review — pre-run scope gate

Every other node in this system judges work that already exists. This one is the only chance to
prevent the wrong work from being done at all, and it is the cheapest finding the system can
produce: a milestone's worth of scope creep caught here costs a paragraph, and caught after
implementation costs the implementation. The failure it prevents is specific — a plan that is
individually reasonable at every line and collectively builds the wrong version, because each
item was justifiable and nobody checked the set against the milestone.

**This is not a graph node.** It runs *before* `new-run.mjs`, has no run directory, no scope
diff, and no evidence directory. A non-`PASS` verdict aborts before a run is minted. When this
skill is absent, `run.json.plan_review` records `"deferred"` and the run proceeds ungated.

**Run it as a fresh reviewer, at the contract's settings.** Spawn it given only the files, not the author's reasoning:
a reviewer that has read the argument agrees with it. Spawn it with
`node <framework-root>/scripts/spawn-subagent.mjs --prompt-file <brief> --out <envelope.json> --result <verdict.json>`,
with the brief, `--out` and `--result` in `.claude/plan-reviews/<plan-name>/round-<n>/` (gitignored: a verdict is model
text), where `spawn-subagent.mjs` also writes the round's telemetry record, `envelope.telemetry.json`, and a report can
find it (`.claude/requests/telemetry-records.plan.md`, stage 3). It runs it at the contract's `review.models.judgment` and `review.effort.judgment`, read-only, so a round runs alike
for every user; a session's own subagent tool takes a model but no effort, so it cannot pin one
(`.claude/requests/claim-check-cross-family.plan.md`, stage 0a). Record both with the round
(`.claude/requests/skill-subagent-pins.md`): the brief is this file, then the two values the reviewer was pinned to
(`new-run.mjs --print-contract`), then the plan's path; the verdict returns them as `settings`, and the caller checks
they match what it pinned before it accepts the round, by running
`node <framework-root>/scripts/check-plan-verdict.mjs --verdict <verdict.json> --model <model> --effort <effort>` (exit 0 accepts;
1 is a round that does not report its pins, and is not accepted). It checks `spawned_with`, which `spawn-subagent.mjs`
writes into the verdict from the model and effort it passed and the models the backend reported, not the reviewer's own
`settings`, which only echo the brief (`.claude/requests/two-ledger-mediums.md`). The backend's list attests the round
when at least one id in it contains the pinned model, case-folded; any other id (a helper model beside the main one) is
printed as also reported, not refused, and a list with no matching id, or an empty one, is refused. The effort is
**unmeasured for this task**: the contract's figure was measured on the lens corpus, not on plan review. A round's
silence is therefore weaker evidence than a lens run's. When the operator asks for one round at another effort, pass
`--effort <level>` to `spawn-subagent.mjs`, name that effort in the brief, and give the same level to
`check-plan-verdict.mjs --effort`. The stamp records `effort_from: "--effort"`, so the round never reads as one at the
contract's setting.

## Read first, in this order

1. The `graph_contract` block in `CLAUDE.md` — specifically `doc_roles.roadmap`,
   `doc_roles.spec`, and `doc_paths`.
2. The document named by `doc_roles.roadmap`, in full. This is your source of truth for what the
   current milestone contains, what it excludes, and what its exit gate requires.
3. `doc_roles.spec`, for the version target and any non-goals.
4. `.claude/quorate/plan-review.md` if it exists — how THIS project structures milestones, where
   its exit gates and Definition-of-Done are declared, and the local history a portable skill
   cannot know. Absent, say so in your output and infer from the roadmap.
5. The proposed plan itself — **last**. Reading the plan before the roadmap anchors you to the
   plan's framing, and you will find yourself checking whether the roadmap permits each item
   rather than whether the plan covers the milestone.

**A profile is CONTEXT, not authority.** It carries vocabulary, structure and local history that
the contract cannot. It does not relax this skill's bar, waive a refusal condition, or license
approving work the roadmap does not cover. Where it disagrees with this skill or with the doctrine,
they win, and the disagreement is itself worth reporting.

That paragraph lives here rather than being stamped on the text you read, and the difference is
worth knowing. A **node's** profile is assembled by the orchestrator, which bounds it, declares in
the brief when it had to truncate, and writes that framing itself. A **skill's** profile is read by
you directly — Claude Code loads this file, so there is no assembly step and none of those
guarantees execute. `check-install` is what reports a profile that is empty, unreadable, or over the
size budget; nothing does so at the moment you read it.

## Procedure

1. **Identify the milestone.** If the plan spans several, review each part against its own. A
   plan that cannot be mapped to any milestone is itself the finding.
2. **Build the in-scope set** from the roadmap: the milestone's implement list plus its exit-gate
   requirements. Do this before reading the plan's items, so the set is not contaminated by them.
3. **Classify every plan item** into exactly one bucket:
   - **In scope** — maps to an implement item or an exit-gate requirement. Name which.
   - **Scope creep** — belongs to a later milestone, or hits a declared non-goal. Name the
     milestone it belongs to. Pulling work forward is *sometimes* correct — a contract that is
     much cheaper to shape now than to retrofit later. Say so explicitly with
     `justified_pull_forward: true` rather than silently allowing it; an unjustified pull-forward
     and a justified one look identical in a plan and opposite in consequence.
   - **Premature decision** — makes a choice the roadmap defers to a later trigger. Name the
     trigger.
4. **Invert the check.** Walk the implement list and exit gate and confirm each is covered by
   the plan. **Missing gate items are the most serious finding this skill produces** — extra work
   wastes effort, but an omitted gate item means the milestone cannot ship and nobody notices
   until the gate runs.
5. **Check ordering and dependencies.** An item whose prerequisite lands in a later milestone is
   mis-sequenced even when it is in scope. Infrastructure built early is scope creep;
   infrastructure built late blocks its own gate.
6. **Check standing constraints** the roadmap declares as always-on — platform targets,
   boundaries that must hold from the first version, interaction models. These bind every
   milestone, so a plan that violates one is wrong regardless of scope.
7. **Check sets and consumers** (`.claude/requests/plan-authoring-sets-and-consumers.md`). Two things
   are findings, reported under `defective` with the item named, why, and the source of the rule:
   - an item that carries a list as the set it applies to, with no authority named for the set (a
     document, registry, schema, or the test that will enumerate it);
   - an item that changes something its consumer would refuse, such as a contract key the reader
     rejects, or a status a tool will not accept. Read the consumer to know.

   `defective` is for an item that is present but wrong, and is fixed where it stands. `missing`
   keeps its one meaning, gate work the plan does not cover, which is fixed by adding an item.
   (G-5 of 20261018-063803-pa-review: both classes went to `missing`, so a reader could not tell
   the two apart and would add work instead of correcting the item.)

## Rules

1. **Cite a source for every classification.** `source` is the document and section that puts an
   item in or out of scope. An uncited classification is a preference, and the caller cannot act
   on it.
2. **Verify the sections you cite exist.** Grep the roadmap for `^#{1,6}\s` and confirm each
   number resolves.
3. **Absence is not a gap.** A milestone's declared exclusions are *correct* when the plan omits
   them. Do not report a non-goal as missing work — that inverts the entire purpose of a
   milestone boundary.
4. **`NEEDS_CHANGES` for scope problems, `BLOCKED` for unreviewable inputs.** Use `BLOCKED` when
   no roadmap is declared, the plan targets no identifiable milestone, or the roadmap path does
   not exist. Do not grade a plan you could not compare against anything.
5. **Silence is not a verdict.** Whatever you could not evaluate goes in `not_checked[]` with a
   reason. An empty `not_checked[]` claims you checked the plan against the whole roadmap.
6. **You do not write files, edit the plan, or spawn subprocesses.** Your entire output is one
   JSON object. You report the scope decision; the human makes it.

## Degradation

`doc_roles.roadmap` empty and `doc_paths` non-empty: you may infer the roadmap from the declared
docs, but every classification must state the inference, and the verdict ceiling is
`NEEDS_CHANGES` — you cannot `PASS` a plan against a roadmap you guessed at. Record
`{"item": "doc_roles.roadmap", "reason": "not declared; milestone inferred from doc_paths"}` in
`not_checked[]`.

`doc_roles.roadmap` empty and `doc_paths` empty: emit `BLOCKED`. There is nothing to review
against, and a plan reviewed against nothing passes every time.

## Output contract

Emit exactly one JSON object matching the schema you were launched with. Nothing else: no
preamble, no markdown, no report.

```json
{
  "schema_version": 1,
  "verdict": "PASS | NEEDS_CHANGES | BLOCKED",
  "settings": { "model": "the model your brief says you were pinned to", "effort": "the effort your brief names" },
  "in_scope": [
    { "item": "Wire the LanceDB index behind the storage trait", "source": "specs/implementation_plan.md §4 (M1 implement list)" }
  ],
  "scope_creep": [
    {
      "item": "Add the Ultra model tier and its download manager",
      "defer_to": "M3",
      "why": "The tier table is declared for M3 in the roadmap; M1's gate needs only Eco to prove the embedding path end to end.",
      "justified_pull_forward": false
    }
  ],
  "premature_decision": [
    {
      "decision": "Commits to ONNX Runtime as the only inference backend",
      "trigger": "M2, after the benchmark harness exists",
      "why": "The roadmap defers backend selection until novafind-bench can compare candidates; choosing now discards the comparison the gate asks for."
    }
  ],
  "missing": [
    { "item": "Index storage estimator, required by the M1 exit gate", "source": "specs/implementation_plan.md §4.3" }
  ],
  "defective": [
    {
      "item": "Migrate every caller of the old index API (list of 6 files)",
      "why": "The list is the set under test and names no authority; the trait's registry in src/storage/mod.rs defines the callers.",
      "source": ".claude/requests/plan-authoring-sets-and-consumers.md"
    }
  ],
  "not_checked": [
    { "item": "UI milestones", "reason": "the plan targets M1 only; M4+ not evaluated" }
  ]
}
```

## Refusal conditions

Emit `verdict: "BLOCKED"` with an explanatory `not_checked[]` entry and stop, if any of:

- there is no `graph_contract` block in `CLAUDE.md`;
- `doc_roles.roadmap` names a path that does not exist on disk — a contract that lies is worse
  than one that declares nothing;
- no plan was supplied to review.
