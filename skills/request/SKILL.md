---
name: request
description: Records what a conversation converged on — in the operator's own words — as the approved request a verification run judges the work against, after challenging the ask and getting a second opinion from another model family. Use once an exchange has settled on something worth building, or when a run reported REQUEST-INFERRED and the real ask exists only in the conversation. Not an instruction channel: it does not shorten or replace the discussion, and it writes a document rather than implementing, planning, or reviewing code.
---

# request — the operator's own words, on disk, before the work

`contract-audit` asks one question: did the code do what was asked? It needs a statement of what
was asked. Today that statement usually does not exist, so every run fires a recovery stage,
`request-capture` drafts an *inference* from documentation, the run is stamped `REQUEST-INFERRED`,
and the conformance lens is capped, permanently, on every run, as `shared/disk-first-protocol.md` §7 states.

That cap is honest. It says: nobody wrote down what was wanted, so the lens is judging the work
against a guess. **This skill removes the guess**, because the person who knows the answer is in the
conversation and was never asked to write it down.

## What makes this different from request-capture

`request-capture` is the recovery path: an agent, sandboxed away from the source, infers a request
from documentation. It writes `status: draft` or `status: inferred`, and a human must approve it —
because an inference must never acquire the authority of a stated requirement.

This skill is the **direct** path: the content comes from the operator rather than from archaeology,
so `approved` is reachable in one sitting instead of waiting on someone to read a draft.

Reachable, not automatic. The operator still gives the approval in step 6 — authorship is what makes
their approval *meaningful*, not a substitute for it. Writing `approved` on the strength of "the
words were theirs" is the same shortcut as writing it on an inference, one step further along.

That authority rests on ONE property, and it is not negotiable:

> **The operator's words go in verbatim.** Their ask is quoted exactly as they wrote it, in a block
> that says so. If you paraphrase it, compress it, or "clean it up", you have written a draft and
> called it approved — which is precisely the failure the status ladder exists to prevent, committed
> by the skill that was supposed to honour it.

Everything you add around the quote is *your structuring of their ask*, and is marked as such.

The one permitted alteration is a **visible** redaction of a secret that shared the exchange — see
"What leaves, and what must not". It is permitted precisely because it is declared: `[redacted:
API key]` leaves the document still honest about itself, which a silent deletion would not.

## This runs at the END of a conversation, not the start of one

The operator's first statement of an ask is rarely the ask. It becomes one through disagreement —
they propose, you say where it is wrong, they refine or overrule you, and what survives is the
thing worth building. A document written from turn one records the worst version of the request and
gives it the authority of a settled one.

So this skill is **not** an instruction channel. It does not replace the conversation, shorten it,
or mark its end. It writes down what the conversation ALREADY converged on, and it may only run
once there is something converged to write.

Two failure modes, both of which this skill was first written with:

- **Outsourcing the disagreement.** An earlier draft sent the ask straight to an external reviewer
  for critique. That is delegation dressed as diligence: the reviewer has no repository, no history
  and no stake, while the model that actually knows the tree — you — is routed around. Your own
  objection comes first and is not optional; the external one is a second opinion on a request that
  has already survived yours.
- **Obedience with a paper trail.** Recording an ask verbatim and executing it is not more rigorous
  than the conversation it replaced; it is the same compliance with a document attached. If running
  this skill makes the exchange shorter, it has made things worse.

## Procedure

1. **Challenge it first, in conversation, before writing anything.** Say what would have to be true
   for the ask to work and whether it is; name a better version if one exists. If the operator
   overrules you, that is settled — build what they asked for, in full, and record the disagreement
   under `## Considered and rejected`. This step is the point of the skill. Skipping it and going
   straight to the document is the failure it exists to prevent.

2. **Quote what converged, not the opening statement.** Copy the operator's own decisive words into
   `## Asked` verbatim, inside a blockquote — usually several statements across several turns,
   including the ones that overruled you. Do not fix typos, do not merge two separate asks into one
   document, and do not substitute your own summary for their words at any point.

3. **Structure, and only what they said.** Fill `What`, `Why`, `Acceptance criteria`,
   `Non-goals` and `Expected surface` from the quoted text. Anything you cannot ground in their
   words goes in `Needs input` as a question — never in `Acceptance criteria` as a fact. An
   acceptance criterion you invented is a requirement nobody asked for, and the lens will hold the
   implementation to it.

4. **Then a second opinion from another family** (default ON; skip only if the operator says so),
   on the ASK, not the code — see below. It runs AFTER your own challenge and after the operator
   has answered it, so what it reviews is a request that already survived one round.

5. **Show the operator the critique and let them settle it.** They may accept a suggestion, reject
   it, or rewrite the ask. Amend the document to match what they decide, and record rejected
   concerns under `## Considered and rejected` with their reason — a concern that was raised and
   dismissed is evidence of a decision; a concern silently dropped is indistinguishable from one
   never raised.

6. **Get the operator's confirmation that the capture is faithful, then approve.** Show them the
   document **and name every redaction you made** — this file is about to be committed, and an
   approval given without knowing what was altered is not an approval of what was written.
   `status: approved` records THEIR approval, so they have to actually give it: writing it
   unilaterally because the content came from them is the same shortcut as writing `approved` on
   an inference, one step further along. If they correct the capture, fix it and ask again.

7. **Point the contract at it.** Set `doc_roles.request` in `CLAUDE.md` to the new file, or pass
   `--request <path>` to `new-run.mjs`. A request nothing reads changes no verdict.

## The document and the critique are two outcomes, not one

The numbered steps do not make the ordering obvious, so it is stated: **the document is built at
steps 2–3 and exists before the critique runs at step 4.** They succeed and fail independently.

- **The critique failing never invalidates the capture.** If the reviewer is unavailable, times out,
  or returns nothing usable, the document STANDS — record `critique: none — <reason>` in the
  frontmatter, note the gap under `Needs input`, and carry on to approval. Deleting or rewriting a
  faithful record of what the operator said, because an *optional* second opinion failed, would
  discard the reliable artifact to protect the unreliable one.
- **A retry amends the existing file; it never writes a second one.** The collision rule below is
  about a DIFFERENT ask reusing a name — it is not a bar on this skill resuming its own unfinished
  work. Two files for one ask is worse than none: `doc_roles.request` points at one of them and
  nobody can tell which is current.
- **The reviewer's verdict is not an approval and not a veto.** `SOUND` does not license writing
  `status: approved` — only the operator does that, at step 6. `NEEDS-WORK` does not block them
  either; they may read the concern and reject it, which is what `## Considered and rejected` is
  for. An external arm is capped at RISK everywhere else in this framework precisely because
  nothing it asserts can be checked here, and a critique of a request is no different.
- **There is no flag to be unsupported.** The critique is default-on and skipped only when the
  operator says so, so "the flag is not supported" is not a failure mode this has. Said explicitly
  because it was raised as one, and an unlisted case reads as an unconsidered case.

## What leaves, and what must not

This skill has TWO egress paths, and the panel's existing data-governance rules
(`shared/external-reviewers.md`) cover neither: they were written for source code and diffs, and
what moves here is **conversation**. A conversation carries things a repository does not — a token
pasted while debugging, a customer name in an error message, a production hostname, whatever the
operator happened to type. None of it is in `.gitignore`, because none of it was ever in a file.

| Path | Where it ends up | Why it is worse than it looks |
|---|---|---|
| `.claude/requests/<slug>.md` | **Committed to the repository**, permanently, in git history | Not gitignored. In a repository headed for a public home this is publication, and rewriting history is the only removal |
| The critique prompt | A third-party cloud (codex, agy) | The prompt is the floor of what leaves, not the ceiling — the arm is an agentic CLI that reads what it likes |

The disk path is the more dangerous one and is the easier one to overlook, because it looks like
writing a local note.

**The rule: `verbatim` governs THE ASK, not everything the operator typed.** Quote their decisive
statements about what to build. Do not transcribe credentials, tokens, keys, customer or personal
data, or internal hostnames that merely happened to share the exchange — they are not part of the
request and nothing downstream needs them.

Four constraints on doing that, because redaction is the one place this skill is allowed to alter
the operator's words and it must not become a licence to edit:

1. **Redaction is VISIBLE, never silent.** Write `[redacted: API key]` in place, never a quiet
   deletion. The whole authority of `status: approved` rests on the quote being what they said; a
   silent removal breaks that guarantee while leaving the document still claiming it.
2. **Tell the operator what you redacted, at step 6.** They are approving this document. An
   approval given without knowing what was changed is not an approval of what was written.
3. **Ambiguous is a question, not a judgement call.** If you cannot tell whether a string is a
   secret or a meaningful part of the ask, ask. Guessing wrong in one direction publishes a
   credential; in the other it silently drops something they meant.
4. **The operator may overrule you.** If they say a value belongs in the document, it goes in.

**Send the redacted document, not the raw scrollback.** This is not the "summary" the rules below
forbid, and the difference is exactly the placeholder: a reviewer reading `[redacted: API key]`
knows something was removed and can say so in `not_checked[]`, where a reviewer reading your
summary cannot tell what it never saw. Bounded and declared is not the same as filtered through
your reading of the ask.

If the operator declines the second opinion because the exchange is too sensitive to send, that is
a legitimate outcome: write the document, record `critique: none — operator declined, sensitive
content` in the frontmatter, and proceed.

## The cross-family critique

The operator's standard is cross-family review on any review here — same-family agreement may be one
opinion counted twice. That applies with more force to a request than to a diff: you are the model
that will *build* this, so you are the worst-placed reviewer of whether it should be built that way.

```
node <framework-root>/scripts/external-review.mjs --reviewer agy --mode propose \
  --evidence-dir <abs> --node-id request-critique \
  --candidate-fields kind,concern,why,suggestion,confidence \
  --schema '{"candidates":[{"kind":"ambiguity|unstated-assumption|unachievable|uncheckable|better-alternative|scope|risk","concern":"the problem in 1-2 sentences","why":"what follows if unaddressed","suggestion":"the specific change to the request","confidence":"high|medium|low"}]}' \
  --prompt-file <the prompt you wrote> --model <name>
```

Both schema flags are required and they do different jobs: `--candidate-fields` builds the STRICT
schema the reviewer's native structured output is validated against, and `--schema` is an inline
JSON *hint* pasted into the prompt so the model knows what each field means. Supplying only one
degrades to the prompt-and-scan path, which says so in `not_checked[]` and produces nothing usable
— confirmed by probe, not assumed.

**Always pass `--evidence-dir`.** Without it the reviewer's raw output is discarded, and a failure
is then indistinguishable from an empty critique. The first live probe of this path failed exactly
that way and had to be run again to learn anything.

`--evidence-dir`, not `--run-dir`: this skill runs BEFORE any run is minted, so there is no frozen
contract to consent under and the live one is the only consent there is. The two used to be the
same flag, which meant a minted run whose `run.json` was unreadable silently fell back to re-reading
the live contract — letting the egress decision change after the mint, on the one path where
freezing it was the whole point (G-8). `--run-dir` now asserts a minted run and is refused if it
cannot produce that run's contract; `--evidence-dir` claims only a place to write. Both are confined
to the repository.

Rules:

- **The critique obeys `review.external_panel`.** It is default ON, but `external-review.mjs`
  refuses to transmit anything on a project whose contract has not enabled the panel — the switch is
  enforced at the egress point, not asked of you. On such a project the critique does not happen:
  record `critique: none — external_panel is false` and carry on. Do not reach for a raw CLI to work
  around it; the operator turning the panel off IS the answer.
- **Pass the request document and the operator's quoted statements it was built from** — after the
  redaction pass above. Not your summary of the conversation: a summary is your reading of the ask,
  and handing the reviewer your reading defeats the reason for asking a different model at all.
- **`--model` and `--effort` are never defaulted** by `external-review.mjs`, deliberately. Read them
  from the roster (`shared/external-reviewers.md`), do not invent them, and record which was used —
  a critique is only reproducible if the model that produced it is named. When the response carries
  `reviewer_override`, record it beside the model: the contract overrode the built-in that critiqued,
  and the operator reads the record, not the response (ARCHITECTURE.md A-26).
- **The reviewer sees the request, not the repository.** Its `confidence` on anything depending on
  the code should be low, and its `not_checked[]` should say so. A critique that confidently asserts
  facts about a codebase it cannot read is reporting imagination; weigh it accordingly.
- **An empty `candidates[]` means "sound" ONLY when `not_checked[]` does not name the reviewer.**
  The envelope returns `candidates: []` for both "no objections" and "the reviewer never answered",
  and the two are distinguished solely by whether `not_checked[]` carries an entry for
  `external proposer '<name>'`. Read that entry before reporting a clean critique — this is the
  framework's own rule that silence is not a verdict, applied to the one place a reader is most
  likely to skip it. A live probe returned `candidates: []` three times before producing anything,
  and every one of those was a transport failure, not a sound request.
- **When it did answer, an empty `candidates[]` is a real answer.** Do not go back for a second
  opinion until one produces objections. Manufactured scrutiny is worse than none: it teaches the
  operator that the step is theatre, and the one time it matters they will skim it.
- **Expect flakiness, and retry once.** Probed live: agy returned three well-formed candidates on
  one call and `status: ERROR` ("Agent execution terminated due to error") after 74 seconds on the
  next, same prompt and model. One retry is reasonable; a second failure is a gap to name, not a
  wall to keep hitting.
- **Model names are the reviewer CLI's, not the vendor's.** agy takes its own labels — `Gemini 3.1
  Pro (High)`, not `gemini-3-pro` — and rejects `--effort` for models whose label already encodes
  it. Get the list from the CLI rather than guessing; a wrong name fails as "model not recognized",
  which reads like unavailability.
- **If the reviewer is unavailable**, say so in the document under `Needs input` and continue. An
  absent critique is a gap to name, not a reason to block the operator's work — the same rule the
  tie-breaker follows.

## Output

`.claude/requests/<slug>.md`, in the section order below. `<slug>` is kebab-case, derived from the ask,
and must not collide with a DIFFERENT ask's file — a request that overwrites another destroys the
record of what was previously asked. Resuming your own unfinished capture is not a collision: amend
that file in place rather than minting `<slug>-2.md`.

```markdown
---
request: <slug>
status: approved          # approved because a human wrote the content, not because a model judged it sound
created: <YYYY-MM-DD>
milestone: <from doc_roles.roadmap, or "none declared">
critique: <reviewer and model, or "none — <reason>">
redactions: <none, or a list naming what was removed and why — never the removed value>
---

# <One line: what is being asked for>

## Asked
> <the operator's words, verbatim>

## What
<Two or three sentences, in their terms.>

## Why
<The problem this solves. The consequence of not doing it.>

## Acceptance criteria
1. <Checkable by someone who did not write the code, and traceable to the quote above.>

## Non-goals
- <What this is explicitly not doing.>

## Expected surface
- <module or file, and why it is expected to change>

## Needs input
- <Question the operator must answer. An honest one here beats a guessed acceptance criterion.>

## Considered and rejected
- <concern raised by the critique> — rejected: <the operator's reason>
```

## Refusal conditions

Stop and say so rather than writing a document, if:

- **the operator has not actually asked for anything.** A question, a correction, or a discussion is
  not a request. Writing one anyway manufactures a requirement out of conversation, and the next run
  will hold the implementation to it. When in doubt, ask whether they want this recorded.
- **you cannot quote them**, because the ask exists only as your inference from context. That is
  exactly the case `request-capture` exists for, and it writes `inferred` for a reason. Use it
  instead, and let the cap stand.
- **the ask is two asks.** Write two requests, or ask which one this is.
- **no acceptance criterion is derivable from what they said.** `Acceptance criteria` is the only
  section `contract-audit` can actually judge against; a document with that section empty is a
  request the lens cannot use, which recreates the exact gap this skill exists to close while
  looking like it closed it — worse than the honest `REQUEST-INFERRED` cap, because the cap at
  least announces itself. Do not manufacture one to fill the space: an invented criterion is a
  requirement nobody asked for, and the implementation will be held to it. Ask the operator what
  "done" looks like. If they cannot say yet, that is real and the answer is to write the request
  later, not to write a hollow one now.

(`<framework-root>` is where this framework's `scripts/` lives: the repository root in this
checkout, `.claude/skills/quorate/` under the documented consumer mount. Spelled that way rather
than as a repo-root-relative literal, because `node scripts/...` is correct only while quorate is
the repository being worked in — which for a consumer it never is (G-49).)
