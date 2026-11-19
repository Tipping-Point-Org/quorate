# The channel this framework does not verify

Everything here verifies **artifacts**. A diff enters the lens graph, findings carry evidence paths
produced inside the run sandbox, an external arm's verdict is capped at `RISK` precisely because
nothing it asserts can be checked here, and a reviewer that never answered is named in
`not_checked[]` rather than passing as silence. Every one of those mechanisms exists to stop an
unverifiable claim from counting as a verified one.

**None of it covers what the agent says in prose.**

A conversational assertion — "the adapter doesn't support that", "there's no launcher recorded
anywhere", "that run costs about 117 GPU-hours" — has no envelope, no `source`, no evidence field,
no reconciler, and no `not_checked[]`. It is unverified by construction. The framework whose whole
purpose is refusing unbacked claims has nothing pointed at the channel where most claims are
actually made, and where they are acted on immediately rather than reviewed.

## Why this is a gap and not a scope boundary

The obvious objection is that prose is not an artifact, so of course the graph does not review it.
But the *consequences* land in artifacts. In the sibling project this was found in, three examples
inside one working period:

- "The image adapter does not do reference conditioning" — it did. The claim came from reading a
  degrade path and treating the existence of a fallback as proof the capability was absent.
- "The server launch path is not recorded anywhere" — it was, in a documented launcher with named
  environment variables. Hand-starting the server against the wrong interpreter killed a 251-scene
  run at scene 193.
- A GPU-hours figure quoted to the operator that could not be reproduced from any measurement on
  disk; the defensible numbers were 20% either side of it.

Each is one command away from being verified. None of them was a fact the model could not have
known — they are facts it did not look up, stated in prose that reads exactly like the prose used
for facts it did look up. That is the specific failure: **fluent output carries no signal separating
"I verified this" from "this is plausible."** A stronger model does not close it, because no model
knows whether a file exists without opening it.

Absence claims are the sharp case, and they are self-sealing: concluding that something is not
recorded anywhere removes the reason to go looking for it.

## A second class: claims about WHO ASKED

Everything above concerns claims about the world -- does the adapter support that, is the launcher
recorded, what did the run cost. There is a second kind, and it is the one whose subject cannot
check it without rereading the transcript: **a claim about where a piece of work came from.**

"The review you asked for" is a claim. So is "per your decision", "your call above", and "as you
said". Each asserts provenance, and provenance is exactly what a reader has no independent access
to -- they remember the conversation roughly, the way everyone does, and a confident attribution is
easier to accept than to audit.

**It is worse than an ordinary unchecked claim, because it borrows authority.** A wrong statement
about an adapter is wrong and gets corrected. A wrong statement about who asked for something
*silences the correction*: an operator reading "the review you asked for" has no reason to question
the cost, the scope, or whether it should have run at all. The agent's own initiative arrives
wearing the operator's mandate.

Measured instance, 2026-09-20. The agent proposed a review ("Say the word and I'll run
`quorate:invoke doc-consistency-review` on the diff"), the operator approved, and the agent then
reported it three times as the review the operator had asked for -- once in a status table, and
twice as the stated warrant for killing a run and spending $18.02 again. The operator's correction:
*"That's my proposal. You approved it: not the first time like that."*

**The rule is the same one §3 applies to findings: cite, or do not claim.**

| provenance | how it is written |
|---|---|
| they asked | quote their words -- *You said "run the doc-consistency review on the diff"* |
| they approved a proposal | *I proposed the review; you approved it* |
| the agent decided | *I killed and relaunched the run* -- no appeal to their authority at all |

If the words cannot be quoted, the attribution is not available. This costs nothing to adopt and
needs no tooling, which puts it with item 1 below rather than item 2.

**A corollary about spending**, from the same incident: a proposal that costs money or is hard to
reverse is a question carrying the estimate, not a line in a list of open items. That review was
offered as "a real graph run" when `$17.85` from four hours earlier was sitting in the transcript;
the bill was $18.02.

## What would close it

Not a lens — there is no artifact to review, and adding a node that reviews chat transcripts would
be both expensive and after the fact. Two cheaper shapes:

1. **A rule that states the search, not the conclusion.** "I searched the adapters and it is not
   there" is a claim a reader can evaluate; "it doesn't do that" is not, and it is shorter, which is
   why it is the one that gets written. An unverified belief is stated as one — *"I believe X,
   unchecked"* — which is the conversational form of `not_checked[]`. This is cheap enough to adopt
   without tooling, and belongs in the consuming project's `CLAUDE.md` rather than here.
2. **A pre-flight hook or skill for absence and capability claims**, requiring the search to have
   been run before the claim is emitted. This is the part that would live in this repository, and it
   is not designed yet.

There is a second failure class that verification would not catch at all: recommendations that do
not survive one counter-question. Those are not unchecked facts but untested reasoning, and the
remedy is different — put the strongest argument against a recommendation to it before presenting
it.

## Status

**Item 2 is built: `quorate:claim-check`** (2026-09-26, `.claude/requests/claim-check.md`). The
objection above — "not a lens: there is no artifact to review" — was answered rather than overruled:
the DRAFT report is written to a file and checked before it is sent, so the artifact exists and the
check is not after the fact. A fresh checker subagent searches for what would make each claim a
non-issue and grades it; `scripts/claim-check.mjs` recomputes the grades mechanically — `observed`
survives only with a citation that resolves — and turns claims about the operator into questions.
`full-review`, `invoke` and `remediate` require it at their reporting step. It also covers the second
failure class above: every claim carries the strongest counter-question the operator could ask.

What it does not cover, stated so it is not over-trusted:

- **It checks what is written down.** A claim the agent makes without running the skill is as
  unverified as before; the rule to remember shrank from several to one, it did not disappear.
- **A checker can miss a claim**, as a lens can miss a defect. The result lists every claim it
  extracted, so a missing one is visible to whoever compares it with the draft — nothing compares
  them mechanically.
- **Claims about who asked** (the section above) are checked only against a session transcript the
  checker is given, by finding the operator's words. With no citation that resolves the claim
  becomes a question; with a command citation it stands on the checker's word, because of the limit below.
  The attribution rule — quote the operator's words — still governs them.
- **A command citation is re-runnable, not re-run.** The script cannot know the checker ran it.

Item 1 is adopted in the sibling project (`CLAUDE.md`, "State the search, not the conclusion",
2026-08-31).

## Open questions of the same class, inside this repository's own comments

The same failure has a second home: a source comment that states a mechanism nobody probed. It
reads exactly like the comments beside it that DO carry a probe, and it is load-bearing for a
security decision, so it costs a maintainer a wrong conclusion rather than merely a stale sentence.

### How does the permission policy judge a compound command? (open, 2026-09-08)

Two comments in this engine asserted opposite mechanisms, and a maintainer reading either reached an
opposite conclusion about whether the node deny-list is a boundary at all:

- `scripts/new-run.mjs` (now removed): deny rules are **prefix matches**, so `Bash(cd:*)` would
  admit `cd x && rm -rf y` past the `Bash(rm:*)` deny.
- `scripts/run-graph.mjs`, in the brief written into every lens: the policy **evaluates every
  segment**, so one denied `echo` denies the whole chain.

Under the first, every open-tail grant in the node allow-list — `Bash(git status:*)`,
`Bash(git rev-parse:*)`, `Bash(git ls-files:*)`, and the capture rules — admits an arbitrary
appended command, and the deny-list is decoration. Under the second it is a real boundary.

**Neither was probed**, which is what makes this an entry here rather than a bug fix: the same
function that carried the first claim records three live CLI probes a few lines above, because
scoping behaviour "was established by probing the CLI rather than by reasoning about it". That is
the standard, and these two did not meet it. Found as G-26 by `security-audit`.

Both texts now assert only what holds under either model, so nothing in the tree depends on the
answer — but the answer is still worth having, because it decides how much the node deny-list is
actually carrying.

**To close it**, probe rather than reason, with a harmless second segment. Allow `Bash(cd:*)`, deny
`Bash(echo:*)`, and run `cd . && echo PROBED` under `claude -p`: if `PROBED` appears, the chain ran
past the deny and the prefix-match model holds. Record the result beside the three Grep probes in
`buildNodeSettings`, and delete this entry. It costs one short live session, which is why it is
written down rather than guessed at.

---

## Does the lens policy's Bash allow-list constrain anything?

**Raised** 2026-09-18, while diagnosing why the sandbox canary refused roughly one mint in two
(G-63). Not raised by a lens — found by probing the CLI directly, which is the point of the entry.

`node-settings.json` carries an allow-list that reads as a whitelist on the shell:

```
"Bash(git status:*)", "Bash(git rev-parse:*)", "Bash(git ls-files:*)",
"Bash(node scripts/capture.mjs:*)", "Bash(node scripts/check-syntax.mjs)",
"Bash(node tests/run-all.mjs)"
```

**Measured, under that exact policy with `--permission-mode manual`: `git log --oneline -1` ran, and
so did `node --version`.** Neither is allow-listed. No permission denial was recorded for either.
So *absence from the allow-list is not a refusal*, and the list is not a gate on the shell.

What IS enforced, measured the same way: a **deny rule** refuses and records — `cp` produced a real
`permission_denials[]` entry and created no file. And a tool removed with `--disallowedTools` is
simply gone, returning a tool error that records nothing: the probe tried to Write, was refused, and
`permission_denials` stayed empty. Three different mechanisms, and only the middle one is observable
from outside.

**Why it matters.** The threat model names "arbitrary command execution through contract keys or
`capture.mjs`" as IN SCOPE, and `disk-first-protocol.md` §3 has lenses run commands through
`capture.mjs` so their output is on disk before a finding cites it. If the shell is ungated, that
discipline is carried by the prompt rather than by the policy — a lens *may* run anything. Nothing
observed suggests one has; the evidence rule is about provenance, and a lens that shelled out
directly would produce findings with no `evidence_path` and be capped for it.

Note what this does NOT touch: **Rule 2's intent sandbox does not depend on the allow-list.** It
denies `Bash` and `Grep` by FLAG, and the flag mechanism demonstrably works — that is exactly how the
Write refusal above happened. The intent canary's own negative arm asks for a line only a reader of
the forbidden file could produce, so it measures the property rather than trusting a self-report.

**The open decision, which is the operator's and not this document's.** Either the allow-list is
meant to bind — in which case the policy needs a mechanism that actually refuses unlisted shell
commands, and the canary should probe it — or it is advisory, in which case §3 and the threat model
should say so plainly instead of implying a guarantee an operator would reasonably read as enforced.
Recorded rather than resolved, because guessing which one was intended is how a wrong sentence
acquires authority.

**To close it**, decide which of the two it is, then either build the gate or correct the prose. The
measurement above is already done and needs no repeating.

**Decided 2026-09-30** — the operator's answer to G-5 of run
20260930-205455-invoke-security-audit-g6-g7-high: "Correct docs now, enforce next (Recommended)". The
prose is corrected (`disk-first-protocol.md` §8 and the two comments in `new-run.mjs` that called the
list closed); a mechanism that makes the list bind is the next plan, with a canary arm that probes it.
Until it lands, the list is advisory and says so.

**Measured again, the same day, with a lens's exact flags** (`--settings <node-settings.json>
--setting-sources project --permission-mode manual --disallowedTools Edit Write …`, and
`GRAPH_NODE_DEPTH=1`):

- `git log --oneline -1` and `git diff HEAD~1 HEAD --stat`, both unlisted: **ran**, no denial.
- `git diff --output=<a file outside the repository> HEAD~1 HEAD --stat`, unlisted and a write:
  **refused** — one `permission_denials[]` entry, no file written.

So the line the runtime draws is its own read-only classification: an unlisted read runs, an unlisted
write is held, and `-p` turns held into denied. One caution learned the hard way: the same probe
WITHOUT `--setting-sources project` ran the write, because the operator's user-level settings loaded
and allowed it. A probe of node policy that omits the node's setting sources measures the probing
machine, not the policy.
