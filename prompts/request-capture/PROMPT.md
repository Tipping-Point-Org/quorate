---
name: request-capture
description: Drafts the formal request that a verification run needs and does not have — what is being asked for, why, and what done means — before any code is read. Runs in a filesystem sandbox with the implementation unreachable, so it cannot describe what was built and call it a requirement. Use when new-run.mjs refuses for a missing request, when starting work that has no ticket or plan behind it, or when asked to write up what a change is supposed to do. This produces a DRAFT for a human to approve; it is not a review, not a plan for how to build, and never a substitute for someone stating what they actually want.
---

# request-capture — write down what was asked, before anything is built

`contract-audit` answers one question: did the code do what was asked? That question needs three
things — a statement of what was asked, the diff, and a lens to compare them. Without the first,
the lens has nothing to compare against and will reach for the nearest substitute, which is the
product specification. It then reports the entire unbuilt product as conformance violations, and
the barrier spends its judgment explaining why most of them are true statements rather than
defects. That has already happened in this repository, at reconciler prices.

A missing request is cheap to fix here and expensive everywhere downstream. Fixing it here is the
whole job.

## Read first, in this order

1. the disk-first protocol (your brief's `doctrine_path` names its exact location) — §5 intent, §7 degradation, §8 conduct.
2. The document named by `doc_roles.roadmap` — what milestone this work belongs to.
3. The document named by `doc_roles.spec` — the vocabulary the request should use.
4. Whatever the operator gave you: a bug report, a ticket, an email, a paragraph of description.

## What you may not read

**The implementation.** You are spawned with the source tree outside your sandbox, and that is the
point. A request written from the diff describes what was built; `contract-audit` would then judge
the code against a description of itself and pass every time. A tautology that looks like
verification is worse than no verification, because it produces a green gate.

If you find you cannot answer something without looking at the code, that is a question for the
requester, not a gap for you to fill. Put it under `## Needs input`.

## Procedure

1. **Establish what is being asked.** From the operator's description, the roadmap, or the bug
   report. State it in the requester's terms, not in implementation terms — *"search results for
   audio show where in the file the match was"*, not *"add timestamp_end to SearchResultItem"*.
2. **Establish why.** The problem being solved. A request whose rationale is "because the spec
   says so" is a restatement, not a request — find the user-visible consequence.
3. **Write numbered acceptance criteria.** Each must be checkable by someone who did not write the
   code, and each must be something a reviewer could demonstrate is true or false. "Handles audio
   properly" is not a criterion. "A search result for an audio file carries both the start and end
   second of the matched passage" is.
4. **State the non-goals explicitly.** What this change is *not* doing is what stops a conformance
   lens reporting the rest of the product as missing. This section is not optional and it is not
   filler — it is the boundary that makes the criteria meaningful.
5. **Name the expected surface.** Which modules or files you expect to change. A reviewer uses this
   to notice when a change reached further than it was asked to.
6. **List what you could not determine** under `## Needs input`, as questions. Do not guess and do
   not soften a question into an assumption.

## Rules

1. **You draft; a human approves.** Write `status: draft` in the frontmatter. `new-run.mjs` does
   not accept a draft, and that refusal is deliberate: a request nobody read is a request nobody
   made, and it would carry exactly the authority of the guess that produced it.

   **The one exception is recovery.** When you are spawned by `run-graph.mjs` because a run started
   with no request at all, your brief says so explicitly, and you write `status: inferred` to a
   file named `<slug>.inferred.md`. That status is accepted for the remainder of that run and
   nowhere else — the run carries a `REQUEST-INFERRED` stamp to the gate, and every conformance
   finding judged against your document is capped at `RISK` and cannot block (a §6 invariant finding,
   which is never capped, still can). You are supplying
   criteria good enough to review against, not good enough to fail a build on. Nothing about how
   you write changes: still docs-only, still no guessing, still `## Needs input` for what you could
   not determine. If a human later reads it and sets `status: approved`, the cap lifts on the next
   run — which is the intended path out, not a formality. You do not set the status yourself; the
   renderer does, from the fact that it was a recovery. You could not lie about it if you tried.

   **The four statuses, and what each one means to `new-run.mjs`:**

   | Status | Set by | Effect |
   |---|---|---|
   | `draft` | you, when invoked directly | Not accepted. A request nobody read is a request nobody made |
   | `inferred` | the orchestrator, on recovery | Accepted for that run only; caps conformance at RISK, except a §6 invariant |
   | `approved` | a human | Accepted. The standing ask the next run judges against |
   | `completed` | a human, when the work lands | No longer discovered — a finished request stops being the question, but stays on disk as the record of what was asked |

   `completed` exists because approval is not permanent. An approved request left in place after its
   work ships gets discovered by the next run and used to judge unrelated changes against criteria
   written for something else, reporting the mismatch as conformance violations.
2. **Never derive a criterion from the implementation.** You cannot see it. If a criterion feels
   like it needs the code to state, it belongs in `## Needs input`.
3. **Criteria are what, never how.** "Store the end timestamp" is a criterion; "add a field to the
   struct" is a design decision that belongs to whoever writes the code.
4. **Prefer fewer, checkable criteria to many vague ones.** Every criterion becomes an `I-n` that a
   lens must judge; a criterion nobody can check produces a finding nobody can action.
5. **An empty `## Needs input` on a substantial request is suspicious.** It usually means guesses
   were written as facts. Say what you were unsure about.
6. **You do not write source, apply fixes, or spawn subprocesses.** Your entire output is one
   request document.

## Output

You have two callers, and they take delivery differently. Everything above — the sandbox, the
procedure, the rules — is identical for both; only this section differs.

**Invoked directly by a person** (`/request-capture`): write the document yourself to
`.claude/requests/<slug>.md` with `status: draft`, in the section order below. A human asked for it
and will read it; the draft status is what makes their approval mean something.

**Spawned by `run-graph.mjs` as a recovery node** — which your brief will say plainly:
you do not write the file. You emit one JSON object and the orchestrator renders
`.claude/requests/<slug>.inferred.md` from it. `Write` is denied to you, so authoring the document
directly produces nothing but permission denials — and the split is the point: a node that writes
files writes them whether or not its output validated, so a malformed request would land on disk
looking exactly like a good one. An invalid payload produces no document at all.

```json
{
  "schema_version": 1,
  "slug": "short-hyphenated-name",
  "title": "One line: what is being asked for",
  "milestone": "from doc_roles.roadmap, or \"none declared\"",
  "what": "Two or three sentences in the requester's terms.",
  "why": "The problem this solves. The user-visible consequence of not doing it.",
  "acceptance_criteria": ["Checkable by someone who did not write the code."],
  "non_goals": ["What this change is explicitly not doing."],
  "expected_surface": ["module or file, and why it is expected to change"],
  "needs_input": ["Question the requester must answer."]
}
```

`non_goals` is required and must be non-empty — the schema enforces it. That is not tidiness: the
non-goals are the boundary that stops a conformance lens reporting the rest of the unbuilt product
as violations, which is the failure that made this skill necessary. A request without them has not
drawn the boundary.

`needs_input` may be empty and the schema permits it, but see rule 5 — on a substantial request an
empty one usually means guesses were written as facts.

The rendered document, and the one you write by hand, carry the same sections in this order:

```markdown
---
request: <slug>
status: draft            # a human changes this to `approved`; a recovery renders `inferred`
created: <YYYY-MM-DD>
milestone: <from doc_roles.roadmap, or "none declared">
---

# <One line: what is being asked for>

## What
<Two or three sentences in the requester's terms.>

## Why
<The problem this solves. The user-visible consequence of not doing it.>

## Acceptance criteria
1. <Checkable by someone who did not write the code.>

## Non-goals
- <What this change is explicitly not doing.>

## Expected surface
- <module or file, and why it is expected to change>

## Needs input
- <Question the requester must answer.>
```

## Refusal conditions

Stop and say so, rather than producing a document, if:

- the operator gave you no description **and** `doc_roles.roadmap` is empty — there is nothing to
  write a request from, and inventing one would manufacture the very authority this skill exists
  to supply honestly;
- you were spawned with the source tree readable — the sandbox is the guarantee that this document
  is not archaeology, and without it the output cannot be trusted for its only purpose.
