# External review panel — Opus internal, Codex external, and a judge SET for disputes

Every lens in this graph runs on the contract's node runtime, so every lens is one model family (Claude under the
default runtime; the family of a call is its adapter's, `familyOfCall` in `scripts/lib/reviewers.mjs`). That is a single
point of correlated failure: a blind spot shared by the model family is invisible to every node simultaneously, and the
reconciler cannot detect it because agreement among correlated reviewers looks exactly like
corroboration. The panel exists to add an arm that fails differently.

| Role | Reviewer | How |
|---|---|---|
| Primary internal | **Opus** | the `second-opinion` node, spawned by `run-graph.mjs` |
| Primary external | **Codex** | `scripts/external-review.mjs` with `--reviewer codex`, spawned by `run-graph.mjs` |
| Adjudicators | **the judge set** in `lens-roster.json` (`adjudicators`) | `scripts/external-review.mjs` with `--reviewer <judge>`, spawned by `run-graph.mjs` — **only** on a group where two positions explicitly contradict each other |

Neither is a command to paste: each mode needs inputs these rows leave out (`--prompt-file`, `--schema`, and for a judge
its mode and dispute). The full invocation is owned by `shared/claude-md-contract.md` (`scripts/external-review.mjs`, under
"Installed since first delivery").

## The uses of the panel, and why the rules invert

The same reviewers answer four different questions, and every rule below belongs to the first one
only:

- **Review** — *is this correct?* Findings converge on defects. Agreement across arms is
  corroboration, an explicit contradiction goes to every judge of the adjudicator set (a split is recorded
  `outcome: tied`, as "Merging and tie-breaking" below states), and an external arm's verdict is capped
  because it asserts something about code without evidence this run can verify.
- **Candidate generation** (`skills/candidate-pool`) — *what exists?* All three are
  **first-order proposers**, agy included, with no tie-breaking role. Answers are additive: a
  candidate only one advisor names is not a weaker finding, it is the one that escaped the shared
  bias, so **never tie-break a candidate away**. Nothing is asserted about the code and no verdict
  is produced, so the `RISK` ceiling below has nothing to cap; what constrains that skill instead
  is that it decides nothing — it filters only against constraints the caller stated explicitly,
  and the calling task selects.
- **Claim checking** (`skills/claim-check`, `--mode claim-check`) — *does this report's prose survive the check its
  author skipped?* One checker, the roster's `claim_checker`, of the other family than the session that wrote the draft
  (`.claude/requests/claim-check-cross-family.md`). It produces no verdict and no finding: its answer is the result
  `scripts/claim-check.mjs` grades mechanically, so the `RISK` ceiling has nothing to cap there either.
- **Deciding** (`scripts/decide.mjs`, `--mode decide`) — *which of these options?* With `review.decision_panel: on`, a
  question with options the session would put to the operator goes to a panel instead: the roster's `decision_panel`
  seats, each through `--mode decide`, beside a seat of the node runtime (a Claude subagent under the default runtime)
  at the contract's judgment model and effort, answering
  blind and anonymously, the answer taken by majority (`.claude/requests/autonomous-run.plan.md`;
  `scripts/lib/decision-panel.mjs` owns the rules). A seat answers an entry, an "Other" or a change, always with its
  reason; a seat that did not answer is silence, never a vote. It produces no verdict and no finding, so the `RISK`
  ceiling has nothing to cap. What leaves the machine is the question, its options and the work context the caller
  builds in code (the request or plan, the stage, the changed files, and the evidence list: the paths the question
  names), never the conversation, and the COPIES of the files those paths name, which every seat stands among. Every
  seat runs in a directory of its own outside the repository, one per call, and before it runs, every path its work
  context names (the request, the changed files, the question's evidence) is copied into that directory at the same
  repository-relative path (`scripts/io/seat-copies.mjs`), read through the repository's owner, so a path through a link
  is refused, never followed; its prompt says the files are there, to read with its file tools. It was the node-runtime
  seat's alone until 2026-11-11: `claude -p` refuses a Read or a Grep outside its working directory (measured 2026-11-09,
  `.claude/requests/decision-panel-seats.design.md`, "DP-D4, measured"), and the external seats stood in one EMPTY
  directory, where agy's model ran a command to look for the cited files, which headless agy denied, so agy answered no
  round (decision 20261111-055540-08ae29; operator: "A. Copy-in for every seat (Recommended)"). Each external seat's
  directory is also made a git repository (`git init`) before its copies go in, which codex requires. Headless agy denies
  every tool needing a permission it cannot prompt for, and its model began with a listing of that directory, so even
  with the copies there agy answered nothing (decision 20261111-172326-aaa7f7; operator: "A. Allow listing only
  (Recommended)"): a decide-mode call of agy, and no other mode, passes `--settings`, a per-call settings object agy never
  saves, allowing a fixed list of bare directory listings (the adapter's `listing_allow`, `scripts/reviewers.json`). agy's
  `command(<x>)` rule admits exactly the line `x`, so each entry is a listing command with flags only, never a path, a
  chain or a redirect (`listingAllowErrors`, `scripts/lib/reviewers.mjs`), and a listing spelled any other way is still
  denied; the operator's own agy settings are not touched. So the copied files' contents leave the machine,
  with every seat's vendor, as part of what a decision sends; and a directory bounds what a seat finds, not what it
  can open: a codex process still reads outside its working directory (the read-only sandbox bounds writes, not reads;
  measured below, for the arms), so a path it is given or guesses can leave with its answer too. Evidence outside the
  repository (a staged run below a reviews root) has no repository-relative path: it is
  not copied, the seat cannot read it, and `decide.mjs` says so on stderr and in the seat's `-copies.json` record. So is
  every other path a copy refuses: one ARCHITECTURE.md A-30 refuses, a link or junction among them; a file over its size bound, or one that would take
  the call's copies past their total (`SEAT_COPY_MAX_FILE_BYTES` and `SEAT_COPY_MAX_TOTAL_BYTES` in
  `scripts/io/seat-copies.mjs`); a file git does not track, an ignored one included, that is not UTF-8 text or holds a
  NUL, since the credential screen reads only text; a file git does not track holding what looks like a credential (any
  shape redaction applies); and a path whose name holds a line break, which the seat is shown as a space and so could
  not address (`seatCopyPaths` in `scripts/lib/decision-panel.mjs`). Each is named with why and the seat never sees it; a changed file git lists
  as deleted is named as missing. The revote note's author gets the same copies; the moderator, given no work context,
  none.
  Name in a question only evidence you would send to the seats' vendors. A seat may cite a path, and the runner checks
  the cited file exists on this machine before it counts toward a basis.
  A round in which fewer seats answered than the panel's quorum (`QUORUM` in `scripts/lib/decision-panel.mjs`, its one
  owner) ends the decision at once as `seats-unavailable`, each silent seat named
  with why (its envelope's reason, or its call's failure), for the operator: a round below quorum decides nothing, and a broken
  panel must not read as a divided one.

Convergence also means different things in the two modes. In review, three arms agreeing is
evidence (weighted by whether they share a model family). In candidate generation, three arms
agreeing means the candidate is the most *written about* — a popularity signal, and often exactly
the bias the caller already had.

**A hard-linked file is held to one more rule** before its content goes to a vendor or a subagent, or into the intent
sandbox (`.claude/requests/hardlink-egress.design.md`, HL-D1 B, HL-D2 A, HL-D3 A; operator, 2026-11-12). ARCHITECTURE.md
A-30 owns that rule: the egress owner, the sites it holds, the bench's exception and the residual. This file does not
restate it (G-12 of 20261112-035452-hl-delivery: the copy here had already drifted from the owner, and said links "at any
level" are refused for the intent sandbox, whose walk keeps its own rule for declared links, G-13). What is particular to
the arms is below, with their snapshot: it refuses a hard link whose other names are outside it.

The data-governance rule does not invert: a brief sent to Codex or agy leaves the machine either
way. A candidate-pool brief carries the goal and the constraints, never the repository.

**Claim checking sends the most of any mode, and says so.** The checker reads the draft and whatever it opens, as an arm
does. It stands in the arms' snapshot with the draft added (`--surface`), which narrows what it is shown and does not
bound what it reads: the surface is its working directory, and the read-only sandbox bounds writes, not reads (below).
What the snapshot left out is named in `check.json` and the result's `not_checked`. Under `review.claim_check_transcript: cross-family` it also reads the session's transcript —
the conversation the draft was written in, reduced: the operator's words, the session's text, the question tool's
exchanges and one line per file change and commit, with commands and their outputs dropped (`scripts/lib/transcript-reduce.mjs`;
operator, 2026-10-25) — as a copy redacted of every secret shape (`scripts/io/transcript-copy.mjs`), so that conversation reaches
the checker's vendor as well as the one the session runs on. Under `same-family`, which is what an absent key means, no
transcript reaches it; the former `claude` is refused at mint. `checked.md` names which happened, with the copy's size and its redaction count.

## Opt-in, and why it is off by default

The panel runs only when `review.external_panel: true` in the `graph_contract` block **and**
`scripts/external-review.mjs` exists. The panel off stamps the run `PANEL-ABSENT`. The panel on with the script
missing refuses the mint, since no reviewer can be checked; only `new-run --no-verify-reviewers` mints it, stamped
`PANEL-ABSENT`.

That sentence was a claim about the GRAPH and was read as a claim about the project. `external_panel`
was consulted by run-graph and new-run and by nothing else, while `/request`'s cross-family critique
and `candidate-pool` invoke `external-review.mjs` directly — so a project that deliberately set it
false still sent conversation and briefs to a vendor's cloud (G-23). It is now enforced at the one
place anything leaves the machine: `external-review.mjs` reads the contract itself and refuses
without recorded consent, failing closed when the contract cannot be read. The deliberate transport
probe passes `--consent transport-probe`, which is recorded in its envelope; it opens the gate for a
probe only (`--probe-run`, `--preflight-only`), and a call given it is decided by the contract. Any caller can type
`--probe-run`, so a call carrying it must carry the probe's own input — its prompt, its schema and fields, and an empty
git repository as `--surface` — or it is refused before anything is sent. What is then sent is what was checked: the
prompt text read once by the check, and a directory of the script's own, a fresh empty repository rather than the
caller's `--surface`, which the caller could fill after the check. The rule above is
therefore true of every path, not just the graph.

It is opt-in because **Codex and agy transmit whatever you pass them to their own cloud
providers.** For a local-first product this is a real decision, not a formality: the rule that
keeps user data on the device governs the shipped application, not the development tooling, but
a diff is still source code leaving the machine. A shadow arm receives the shadowed lens's own criteria and the run brief (it runs DURING the fan-out, not after reconciliation), and each adjudicating judge receives the specific
excerpt under dispute — never the whole repository, and never user data or fixtures containing
it. **The prompt file is the floor of what leaves the machine, not the ceiling**: the arm is an
agentic CLI launched over a working directory it may read freely, codex runs under
`--sandbox read-only` (which bounds writes, not reads — measured below), and the shadow
prompt tells it to read files as needed — so the reviewer transmits whatever it chooses to open,
which is exactly the "source leaving the machine through the external panel" egress the threat
**Which directory that is: one built for the arms, or none (G-40; `.claude/requests/arms-read-surface.md`).**
The arm is given a directory of its own (where it is, and how it is cleaned up: `ARCHITECTURE.md` §1, which owns
both), built from a SNAPSHOT of the working
state — the tracked files with their uncommitted changes, plus untracked files not ignored, what the lens
reads less the entries left out below — as a repository of its own holding a filtered stand-in for the base commit (below), so
`git diff <base>` works for the arm as for the lens. The run's own artifacts and `evidence/` are not in it. A symbolic link, a file
reached through a linked directory, and a hard link whose other links are outside are left out and
named in the gate, as is a file whose name is not valid UTF-8, which cannot be judged at its source, and a
file that changed between git capturing it and the check (G-3 of review 20260927-200901-ars-r5); and the finished directory is asserted to hold no link. **What that guarantees is
what the directory PRESENTS**: nothing from outside the repository reaches the arm as part of it.

The base commit the arm diffs against is a STAND-IN, filtered like the snapshot, installed under the
real base's own id with a git replace ref (`refs/replace/<base>`), so the arm uses the id it is told
and the real base is never copied in. The stand-in leaves out every symbolic-link entry of the base, not
only those the snapshot withheld: a link the working state deleted is otherwise still readable there.
The arms' repository sets `core.useReplaceRefs=true` in its own config, which outranks a global
`core.useReplaceRefs=false` (that setting once cost the arm its diff: "bad object", the real commit not
being there). `GIT_NO_REPLACE_OBJECTS`, which outranks both, cannot reach an arm, whose environment is an
allow-list.

It does not bound what an arm CAN open. Measured on 2026-09-26 (Windows, codex-cli 0.155.1, the arms' own
`--sandbox read-only --ephemeral`), a codex arm read files outside its working directory by absolute and
by relative path, including one in the directory that holds the staged runs: the read-only sandbox
bounds writes, not reads. That an arm can open a live run's staged artifacts is an open finding on the
ledger (`scripts/lib/reviews-root.mjs`), not a closed one. agy, and codex on POSIX, were not probed.

**There is no fallback to the repository root.** When the directory cannot be built safely — the working
state over `review.panel_snapshot_max_mb`, a snapshot that could not be taken, a link left in the
finished directory, or an incomplete framework — no external reviewer runs and the run is stamped
`PANEL-NO-SAFE-SURFACE` with the reason. Read that stamp before deciding what a given run sent: it
means nothing was sent by the panel at all. (The root used to be handed over instead, stamped
`PANEL-SEES-EVIDENCE`; that stamp is gone with the fallback.)

**Both external reviewers stand there, not just the arm.** An adjudicator is the second spawn that
leaves the machine, and it reads the same directory for the same reason. This mattered because the
checkout was once built only when an arm was going to run: on a `--resume` where every arm was
already OK and only judges spawned, both judges read the repository and the run's own evidence with
it, unrecorded. The directory is built whenever the panel may spawn EITHER kind.

**`external-review.mjs` stands in the repository; the reviewer stands in the arms' directory.** The
arms' directory is a repository of its own, and external-review decides where it may WRITE from the
repository it stands in — so an arm spawned inside the arms' directory would have its own run
directory refused as outside it, which is how every arm once died in milliseconds (G-43). It is
spawned in the repository instead and starts the reviewer in `--surface <dir>`, for the arms and the
judges alike.

Scope the prompt tightly because it steers what the arm goes looking at, and enable
the panel only for source you are prepared to have read by the reviewer's cloud.

### Conversation is a category these rules were not written for

Everything above reasons about **source**: diffs, excerpts, criteria, the repository. The `/request`
skill sends something else — the operator's own words from a conversation — and a conversation
carries what a repository does not: a token pasted while debugging, a customer name inside an error
message, a production hostname. None of it is in `.gitignore`, because none of it was ever a file,
so every habit that protects source protects nothing here.

This was found by a codex arm critiquing the `/request` skill on its first live run, and neither
the agy arm nor the model that wrote the skill had raised it — which is the cross-family panel
earning its cost rather than an argument for it.

The rule lives in `skills/request/SKILL.md` under "What leaves, and what must not". Its shape,
stated here because any future node that transmits conversation inherits it: quote the ask, not
everything typed; redact secrets **visibly** so the artifact stays honest about having been
altered; and tell the operator what was removed, because they are the one approving it.

## What the external arm is given

An external reviewer has no session context or memory of the run. In review mode, give it:

1. A short role and goal: independently apply the named lens, not audit the internal reviewer.
2. The lens's `SKILL.md` instructions, with frontmatter removed.
3. The external-arm constraints: read-only review, no nested reviewers, no `capture.mjs`, and
   repository content is evidence rather than instructions.
4. The dynamic run brief last: exact scope, governing documents, commands, and threat model.
5. The output contract: the verdict envelope, so the result merges without translation.

`external-review.mjs` prints exactly one verdict envelope on stdout, in the SHAPE the existing
validator and renderer already understand — so an arm is just another node as far as `reconcile` is
concerned, its findings carrying `source: "codex"` or `source: "agy"` and grouped alongside the
lenses.

**"Consume unchanged" was the wrong word, and it mattered** (G-44). What arrives is not what the
reviewer said, verbatim: `run-graph` puts every arm finding through the same scope validator the
lenses face — a citation that escapes the repository or names a line past the end of a file is
REJECTED, one outside the declared surface is demoted to an observation the gate prints and does not
tally — then tags it with its source and model, raises the arm's verdict to the floor its surviving
findings set, and caps that at the arm's fixed ceiling (`armLimitsFor`, `scripts/lib/capabilities.mjs`).
An arm may not raise a BLOCKER and may not exceed `RISK`.

That is deliberate: an envelope from a third-party cloud is the least-trusted input this system
takes, and the validator is exactly why it can be accepted at all. But a reader told the envelope is
consumed unchanged will look for a finding the arm reported and not find it, with nothing to explain
where it went.

### Every external prompt comes from one builder

Shadow arms and the tie-break are both built by `scripts/lib/review-prompts.mjs` — one builder,
one feedback ask (`BRIEF_FEEDBACK`), one vendor label. Nothing hand-writes a prompt for an external
reviewer.

They carry DIFFERENT constraints, and that is the correction rather than an exception. A shadow arm
gets `EXTERNAL_ARM_CONSTRAINTS`, which tells it to read the repository "by whatever means your
environment gives you" — right for codex, which runs in a read-only sandbox. The tie-break gets
`TIE_BREAK_CONSTRAINTS`, because it is agy in HEADLESS mode, where a tool needing the `command`
permission is auto-denied with nobody to prompt: agy returned an empty response while reporting
SUCCESS, and the tie-breaker never once ruled. It is handed the disputed excerpt instead and told to
rule from what is supplied. One constraints block for two execution environments instructed one of
them to do the thing it cannot do.

That is not tidiness. The tie-break prompt *was* hand-written, and it was the only external prompt
in the system carrying neither the constraints nor the mandated feedback ask — so the one reviewer
this document names as the tie-breaker was the one reviewer whose brief omitted what every brief is
required to include. Both tie-break nodes came back `DEGRADED` with zero findings: the third family
spawned and produced nothing, at exactly the point where a genuine cross-family dispute needed
deciding. An absent adjudicator is the same false corroboration an absent arm is.

The vendor is a **parameter**, never a literal. `arm.reviewer` reaches the adapter flag, the
credential allow-list, the probe, the source tag and the status record; it must also reach the
sentence telling the model which reviewer it is. A seam that is swappable everywhere except where
it is named is not swappable — an `agy` arm would have launched under a prompt calling itself Codex
and carrying codex-shaped constraints.

### What the arm's environment is, and where the boundary is enforced

An external arm is a **third party**. It gets a strict **allow-list**, never a deny-list: a
deny-list cannot bound an open set of secret names, and only naming what the arm *needs* can.
`reviewerEnv()` in `scripts/lib/decisions.mjs` owns which variables cross. It passes the
variables a process needs to execute at all, the depth guard, and **only the selected vendor's own
prefixes**, as that adapter declares them in `env_prefixes` (`scripts/reviewers.json`, their one owner). A reviewer the allow-list does not
recognise gets no vendor prefix at all: an arm that cannot authenticate is a visible `DEGRADED`, a
leaked key is not.

One variable that crosses is then rewritten: `shellLaunchEnv()` in `scripts/lib/reviewers.mjs` owns the
reviewer's `PATH`, for the version probe and the call alike. It drops every entry that is empty,
relative, or leads into the repository, the snapshot or the launch directory, judged by where an
existing entry leads, so a reviewer is never resolved to a file in the reviewed tree
(`.claude/requests/reviewer-path-entries.md`); the count dropped is said on stderr.

That boundary is the vendor's, not the contract's. A contract entry that OVERRIDES a built-in keeps that
vendor's prefixes, so an override of its `cmd` or argv decides where the variables matching them go. That is a
decision the contract is trusted to make, like the commands it declares, and every path that runs the
override names it — ARCHITECTURE.md A-26, which also owns the condition that would make it refused.

Two rules follow, both learned from real defects:

- **Scope credentials to the vendor whose CLI is running.** Applying every prefix to every reviewer
  handed an agy process the operator's OpenAI and Codex keys, and a codex process the operator's
  AGY keys — a secret crossing a vendor boundary it has no business crossing, on every arm and
  every tie-break.
- **Enforce at the last hop before the vendor process, not at the caller.** The boundary belongs
  inside `external-review.mjs`'s own spawn, because it holds for *every* caller then. Applying it
  only in `run-graph` left `check-panel.mjs` — then the probe this document told operators to run, retired since for
  `check-reviewers.mjs` —
  handing the reviewer CLI the operator's entire shell. A boundary enforced per-caller is a
  boundary that the next caller ships without.

What the allow-list **passed** is recorded on the arm's status as `env_passed`; it is not quite all that crosses,
and the one name it leaves out is said where the record is defined (`shared/claude-md-contract.md`, `auth_mode`).
For an allow-list that is the fact an auditor needs; a stripped-name list only ever names the secrets the code already knew about.

Candidate generation uses `--mode propose` with the same outcome-first brief for every proposer.
The brief defines the goal, success criteria, caller-stated constraints, inputs, output fields,
and stop rules. The adapter returns a proposal record, whose fields are the `scripts/external-review.mjs` row of
`shared/claude-md-contract.md`, their one copy; it does not manufacture a verdict for a task that decides nothing. A proposer that
reports a status other than `ok` gets an empty `candidates` — a partial batch must not read as
complete — and what it did propose in `incomplete_candidates`, counted in `not_checked[]`. The
`--out` flag and its rules are stated once, in `shared/claude-md-contract.md` (the
`scripts/external-review.mjs` row), as `OUT-1` … `OUT-8`; each refusal names its id.

A candidate with no fields is **dropped and counted in `not_checked[]`**, not returned. An empty
candidate is the proposal-mode form of the silent PASS this adapter exists to prevent: it makes a
pool look full while carrying nothing the caller can filter against their constraints.

## Which model an arm runs, and where that is declared

An arm's **model and reasoning effort are declared per arm in `scripts/lens-roster.json`**
(`panel_arms[].model` / `.effort`), never in a script. They live beside the reviewer rather than in
`CLAUDE.md` because a model name is only meaningful paired with a CLI, and the two CLIs do not even
share an effort vocabulary — agy takes `--effort low|medium|high`, codex takes
`-c model_reasoning_effort=<level>`. Normalising that in code would hide a real difference; keeping
it in config puts the value next to the reviewer that has to accept it.

`run-graph.mjs` passes both to `external-review.mjs`, which builds the command line through the
pure `reviewerArgv()` in `scripts/lib/decisions.mjs`. That function is pure so the exact flags are
asserted offline — the live transport is behind `QUORATE_LIVE`, so a wrong flag would otherwise
only be discovered by paying for it.

**An unset value sends no flag**, which means the arm runs on whatever the developer's local CLI
defaults to. That is a real reproducibility gap and is named in the arm's `not_checked[]`, on the
same rule as an empty contract key: the framework states what it did not check rather than
implying a guarantee it cannot give. The effective model and effort are recorded on
`nodes/expected.json` and on the arm's status file, so a finding can be reproduced without
re-deriving them from config that may since have moved.

Codex arms also run `--sandbox read-only --ephemeral`. The arm is a reviewer with no authorized
write step, so the runtime is made to match the prompt boundary rather than relying on the model to
honour it. `--dangerously-bypass-approvals-and-sandbox` is never used.

The declared values are a **starting point, not a proven optimum** — see
`CODEX_RUNTIME_FINDINGS.md`. Compare `medium` against `high` on archived reviews and change the
value in the roster, not in a script.

## How the answer comes back

Both reviewers enforce a JSON Schema natively, so the answer is **read from a known place rather
than recovered from stdout by a scanner**:

| | codex | agy |
|---|---|---|
| schema flag | `--output-schema <file>` | `--json-schema <file>` |
| prompt goes | on stdin (`codex exec -`) | on stdin, one NDJSON `user` line (`--input-format stream-json --print=`) |
| answer arrives in | the `--output-last-message` file | the final `result` event of stdout's NDJSON, under `structured_output` |
| needs | — | `--output-format stream-json`; a result whose `status` is not `SUCCESS` is agy's failure, named by its status |

Schemas are built by `scripts/lib/reviewer-schemas.mjs` and written into the run's evidence
directory (or a temp directory that is removed afterwards, for a call with no run directory), so a
run records the exact contract the arm was held to.

**codex enforces through OpenAI structured outputs in STRICT mode.** Probed 2026-08-31, and it is
unforgiving in a way that shapes the schemas: every object needs `additionalProperties: false` and
every property listed in `required` — strict mode has no optional fields. A schema breaking either
rule is rejected with HTTP 400, exit 1 and no output file, which costs the whole arm. `validateStrict()`
catches both rules before the schema is written.

The consequence for proposals: **candidates cannot be free-form objects**. The caller names its
fields with `--candidate-fields`, or no schema can be built at all — in which case the adapter falls
back to the prompt-and-scan path and names the downgrade in `not_checked[]`. Narrowing the caller's
fields to something expressible would answer a question they did not ask.

A native run that produced no readable payload is a **hard failure**. It is never retried by
scanning stdout: a `PASS` recovered that way would mask a transport failure as a result, and that
guessing is exactly what the schema was adopted to remove.

### codex requires a git repository

`codex exec` refuses to run outside one — *"Not inside a trusted directory and
--skip-git-repo-check was not specified"* — unless the directory carries a `trust_level` in the
user's `config.toml`. The graph is unaffected: the reviewer is started in the arms' directory
(`--surface`), which is built as a git repository of its own — what codex requires. The stale claim was `cwd: repoRoot`, and it mattered in the worst way: it points
a maintainer debugging a dead arm AWAY from the arm's working directory, which is exactly where the
regression that killed every arm in one run actually was. A `candidate-pool` call made from a scratch
directory is not, and will fail
through the ordinary unavailable path with a reason that reads like a transport error rather than
a working-directory problem. Run proposal calls from the repository.

## Giving the reviewer a legal way to fail

The adapter appends a `status` field to whatever schema the caller asked for: `"ok" | "refused" |
"incomplete"`, plus a `reason` required whenever status is not `ok`. The caller owns the payload
shape; this contract belongs to the adapter.

It exists because **"Silence is not a verdict" was enforced for our own scripts and never for the
reviewer they call.** `external-review.mjs` always emits, even when the CLI is missing or times
out — but the reviewer was handed a schema that described only success. A model that refuses, runs
short, or is denied by the sandbox then has two options: violate the schema, or fabricate a passing
answer. A success-only schema actively pressures a stuck model toward the second.

With `status`, the two failure classes separate and neither can become a PASS:

| Observed | Class | Handling |
|---|---|---|
| no output, unparseable, or wrong shape | **hard** — the transport or runtime broke | `not_checked`, arm unavailable |
| `status != "ok"` | **soft** — the reviewer answered and said it could not | `not_checked`, carrying the reviewer's own reason |
| `status == "ok"` | a real result | validated and converted normally |

A soft failure's own `verdict` does not survive: a reviewer that reports `refused` and `PASS` in the
same object told us it did not do the work, and the second field cannot outrank the first. In
proposal mode the pool is emptied rather than returned partial, because a truncated pool presented
as complete is the proposal-mode form of a false PASS.

This does **not** make a dishonest answer safe, and nothing here can — a model may still claim `ok`
having done nothing. That is why an arm is capped at `RISK`, its findings at `MEDIUM`/`convention`,
and why corroboration with a lens rather than the arm alone is what makes a finding actionable.
What the contract removes is the case where the reviewer *would* have told us and had no field to
say it in.

## The ceiling on an external arm

**An external arm's verdict is capped at `RISK`, and its findings at `MEDIUM`/`convention`.**
Both caps are enforced in `external-review.mjs`, not left to the reviewer's discretion.

The verdict cap is the engine's, for an arm and for a judge alike: it is the `convention` rung's in
`CONSERVATIVE_BASIS` (`scripts/lib/capabilities.mjs`), for every adapter and every roster, because a
roster's ceiling once turned an arm's `RISK` into a `PASS`. A roster entry for an arm or a judge, and
the `convention` rung of `basis_ceilings`, may only repeat it, and mint refuses any other value.

The reason is structural rather than a judgement about reviewer quality. An arm running outside
the run sandbox has no capture channel into the run, so nothing it claims carries an evidence path this run can
verify. `writeGate` promotes any `FAIL` verdict to a `FAIL` gate, so an uncapped arm could turn
the whole run red on the strength of assertions no one can check — the cheap-reviewer cascade,
arriving through the panel instead of through a cheap model. A reviewer that is confident and
wrong is exactly as expensive here as one that is cheap and wrong.

So a `FAIL` from Codex reads as `RISK`, and its findings enter reconciliation at `MEDIUM`. This
does not discard the finding — it declines to let one unverifiable arm decide the run. What
promotes such a finding is **corroboration**: a lens that reaches the same conclusion *with*
evidence, at which point the cross-arm agreement is stronger than either arm alone. That
promotion is `reconcile`'s judgement to make, which is why it must not be pre-empted here.

## Every brief asks the reviewer to fix the brief

**Every brief this panel sends — to a lens, to `second-opinion`, to Codex, to agy — ends by asking
the reviewer what the brief itself was missing.** Append a final section:

> **Before your report, one line on this brief:** what did it fail to ask you to check, what did it
> point you at that wasted your time, and what context would have made your findings better? Answer
> even if the answer is "nothing".

The reason is structural rather than a courtesy. A brief's gaps are invisible from the side that
wrote it: re-reading your own instructions tells you what you meant to ask, never what you did not
think to ask. The reviewer is the only party positioned to see the difference, and only while the
work is fresh.

This matters most where this panel is already weakest. The graph's arms are correlated by model
family, and the external arms exist to fail differently — but a shared *brief* re-correlates them
through the back door. Two arms given the same blind spot in their instructions will agree, and
agreement is what `reconcile` reads as corroboration. Asking each arm what it was not asked is the
cheapest available check on that, and it costs one paragraph per brief.

**Where the briefs are equivalent and the findings differ, the difference is the model, not the
instructions.** Do not respond by writing a longer brief for the arm that found less — that treats a
model difference as an instruction defect and inflates every future brief. Ask that arm the same
question and add only what it names.

**Fix the brief, not the round.** A gap an arm reports is worth more than the finding it produced,
because the brief is the reusable artifact and the round is not. Record it where the brief lives
before starting the next one.

## Merging and tie-breaking

- **Label every finding with its source.** `[opus]`, `[codex]`, `[agy]`.
- **Agreement is corroboration only across arms.** Two lenses agreeing is weaker evidence
  than a lens and an arm of another family agreeing, because the lenses share the node runtime's model family. `reconcile` must weigh
  a cross-arm agreement above a same-arm one, and the envelope's `source` is how it can tell.
- **Disagreement goes to a PANEL, narrowly, and is counted rather than broken.** When one arm
  asserts a finding the other explicitly contradicts, and you cannot settle it against the code
  yourself, the orchestrator sends *that one disputed finding* — the claim, both positions, the
  mechanical facts and the relevant excerpt — to **every judge in `lens-roster.json`'s
  `adjudicators`**, each on the same blind brief. A graph node cannot do this: external-review
  exits 3 at depth 1.

  **A numeric majority IS computed**, and this paragraph said the opposite until 2026-09-12,
  when the tie-breaker became a judge set (`.claude/requests/adjudication-merge-for-disputes.md`).
  `lib/adjudication.mjs` owns the arithmetic; the rules that matter to a reader of the gate:

  - a **strict plurality** decides — 1-1 and 1-1-1 do not;
  - a **tie is the finding**, recorded `outcome: tied` and left standing. Nobody breaks it,
    because a split between judges is information about the dispute;
  - a judge that did not answer is `absent` with coverage 0, **never a vote against** — and
    `outcome: absent` is a different value from `tied`, so a panel that never reported cannot
    read as one that weighed the dispute and split;
  - reconcile's own adjudication remains the run's output either way. The panel informs the
    gate; it does not overrule the barrier.

  The gate prints the per-judge votes and a pairwise agreement figure beside the outcome.
  Fleiss' kappa is deliberately NOT reported: a run produces 0-2 disputes, and chance
  agreement cannot be estimated from that.
- **The panel is NOT fully independent today, and the run says so.** Only two adapters serve the
  reviewer role, and every shadow arm runs on codex — so on a lens-versus-arm dispute the codex
  judge is a party to the position its own family raised. That is a limit of what is installed, not
  a design choice, and it is recorded rather than glossed: the merge sets `party` on each such vote,
  the gate prints which judges had a stake, and `non_party_votes` is the figure that would make the
  panel neutral if it ever reached two. A third vendor family fixes it. Until one is declared, a
  labelled vote beats a hidden one — and a document claiming the adjudicator is simply "a different
  vendor" would be describing a guarantee this configuration does not provide.

- **Silence is not contradiction.** A finding only one arm raises, where the others simply did
  not mention it, is not a tie and does not go to agy. Verify it against the code and report it
  as confirmed or unverified.
- **One merged report**, never separate per-reviewer dumps.

## Model policy

The panel is independent of the session's default model, and every delegation pins its model
explicitly so the policy survives a change to that default.

- **Judgment** — every lens, `reconcile`, and `second-opinion` → **Opus**. The panel ARMS are a different family by design (that is the point of a panel): Codex, at the model pinned per arm in `lens-roster.json` under `panel_arms`, its one owner. Moving them onto Opus would delete the cross-family property the panel exists for.
- **Mechanical** — collation, diffing, rendering → **Sonnet**, or better, a script and no model
  at all.
- **Never Haiku for a verification node.** A cheap reviewer produces more false positives, and
  each one costs a remediation cycle downstream; the saving is nominal and the cascade is not.
  `spawn-node.mjs` enforces this by refusing any node whose model `lens-roster.json`'s `lens_models_refused` names,
  in every mode it spawns, and by refusing when that list cannot be read.

This section is the policy those settings follow, not their owner: the model a Claude node runs is read from the
contract's `review.models` (`shared/claude-md-contract.md`), and an arm's or a judge's from `lens-roster.json`.
Where this section and those settings disagree, the settings are what runs, and the disagreement is a defect in one of
them to fix, not a precedence.

## How the prompt reaches each reviewer, and the ceiling inline argv had

Both shipped reviewers now read their prompt from **stdin**: codex as text (`codex exec -`), agy as
one NDJSON line, `{"event":"user","message":{"role":"user","content":<prompt>}}`, under
`--input-format stream-json --output-format stream-json --print=` (`scripts/reviewers.json`,
`prompt.via: stdin-ndjson`; `shared/adapter-contract.md`, "How the prompt reaches the CLI"). How
the node runtime takes its prompt is its adapter's `node_runtime.prompt.via`, owned by the same section. Until 2026-11-09 agy took its prompt
**inline in argv** (`agy --print <prompt>`), and a decision seat's 33,827-byte prompt and an
adjudicator's 49,582-byte one were refused at the budget below: that is what moved it
(`.claude/requests/decision-panel-seats.design.md`, DP-D2 A, measured with agy 1.5.3). Stdin text
reaches each child from a file (`scripts/io/stdin-file.mjs`), never a pipe; where that file is made is owned by
`shared/adapter-contract.md`, "How the prompt reaches the CLI". What follows still holds
for any adapter a contract declares with `prompt.via: argv`, and the shell rules hold for agy
whatever its prompt channel:

- agy must not run under a shell (see the comment at the spawn site): with one, cmd.exe rebuilds
  the command line and can mangle what it carries (a multi-line prompt, when the prompt rode in it),
  and the reviewer answers something
  unparseable that this script would honestly-but-uselessly report as "no parseable verdict".
- Passing agy a prompt **file** instead would need `--dangerously-skip-permissions`, because
  headless agy cannot prompt for the file-read permission. That flag auto-approves every tool
  request for the invocation, including command execution. A shared script must not hand a cloud
  CLI unrestricted tool access to save an argv byte, so this repository does not take that path.
  The flag is not read-only however read-only the task looks: on its first use in a sibling
  project agy created an unrequested `AGENTS.md` in the repo root, which a blanket `git add -A`
  then swept into a commit. After any tool-enabled external run, check `git status` before
  staging.
- **A quoting trap that is NOT one here, recorded so nobody fixes a non-bug:** passing this same
  prompt through PowerShell 5.1 truncates it at the first embedded double quote, far below any
  size limit — a 12 KB quote-free brief round-trips while a 14 KB one containing dialogue arrives
  cut off, which looks exactly like a size cap and is not. `external-review.mjs` spawns **agy**
  with `shell:false`, so Node hands argv straight to CreateProcess and quotes survive. Measure with
  a quote-free prompt before concluding anything about length.

  **The one exception, and why it is not a loophole.** `shell:false` is the rule and holds for
  every vendor that ships a real executable. codex ships as an npm `.ps1`/`.cmd` shim, which
  `CreateProcess` cannot execute at all, so its adapter declares `needs_shell_on_windows` and that
  arm alone spawns through `cmd.exe`. There is no argv-only way to launch a `.cmd`; the honest
  choices were a shell or no codex arm on Windows. Two things bound it: the argv is quoted by
  `windowsShellArgv` before cmd.exe re-splits it (a checkout under a path with a space had
  `--output-schema` split in half, and the reviewer then read a schema file that does not exist),
  and a vendor that takes its prompt INLINE IN ARGV must never get a shell, because cmd.exe would
  re-parse the command line and truncate a multi-line prompt (agy, which ships an `.exe`, gets none
  either way). This paragraph said
  `external-review.mjs` spawns with `shell:false` full stop, which a reader checking the code
  against it found false (G-10); the rule and its one exception are both written down now, because
  a rule with a silent exception is the kind a maintainer "fixes" by removing the exception.

Inline argv has a hard ceiling: Windows `CreateProcess` accepts about 32 767 characters for the
whole command line. Beyond it the spawn fails — or worse, delivers a truncated prompt, which
produces a confident answer to a question nobody asked: the false corroboration this panel exists
to prevent. `external-review.mjs` therefore measures the prompt before spawning a reviewer whose
`prompt.via` is `argv` and, when it will not fit, refuses and names the reviewer in `not_checked[]`
with the measured size rather than sending a fragment; a reviewer on stdin is never held to it, and
one that declares a budget anyway is refused at mint. Trim the brief (the disputed finding and its
excerpt, not the whole review) or use a reviewer whose stdin path has no such limit.

Neither the ceiling nor the shell rules are checked by the offline suite — it stops before every
spawn. The live path is checked by the reviewer preflight (below, under "Failure handling"):
every reviewer combination is probed before its first use, and `QUORATE_LIVE=1 node
scripts/check-reviewers.mjs` runs that check for the whole panel on demand — the arms in review
mode and the adjudicators in tie-break mode, as run-graph will call them, plus every reviewer the
contract declares that the roster does not use, whatever its schema, in the first mode it supports
(review, else propose, else tie-break). It also probes propose, on both its routes (prompt-and-scan, and native with the
probe's own candidate fields), for each reviewer, model and effort the roster uses, because `candidate-pool` and
`request`'s critique call that mode and no run does. `--force` re-probes a combination whose record
still counts. Run it after touching transport code, when a reviewer CLI updates, and before trusting
`external_panel: true`.

**The judges are checked in their own mode (G-42).** The tie-breaker is a different vendor, a
different mode and a different prompt shape, and a check of the arms alone said nothing about it:
it is the path that had never once produced a ruling. check-panel.mjs and check-tiebreak.mjs probed
the two halves separately until reviewer-preflight stage 4 replaced both with check-reviewers.

## Failure handling

**A reviewer is tested before it is used, and one that fails is refused** (operator, 2026-10-08:
"no fallback. preflight test for what is needed and fails if something is missing";
`.claude/requests/reviewer-preflight.plan.md`). Before every call, `external-review.mjs` looks for
a passing probe record for the exact combination it is about to use — adapter and its definition,
model, effort, mode, schema route, CLI version, host, and the hash of the probe's own code (`PROBE_CODE_FILES`, so a record one engine wrote never vouches for another engine's probe) — that is younger than
`review.reviewer_probe_max_age_hours`. With none, it probes that combination itself: a small
known task in the same mode, run in an empty temporary directory. A probe that fails refuses the
call: the mode's unavailable envelope, naming the reviewer and
`reviewer preflight failed for <adapter>/<model>/<effort>/<mode>/<route>: <reason>`, and exit 5.
The reviewer is never called. Changing the reviewer, its model or its effort is a new combination,
so it is probed again before its first use.

**And before a run exists.** With the panel on, `new-run` checks every combination the run can call — the roster's
panel arms in review mode and its adjudicators in tie-break mode, as run-graph will invoke them — through
`external-review.mjs --preflight-only`, before it creates the run directory. A failed probe, a check that exits
otherwise, crashes, or overruns its bound (its worst case from the adapter's limits: its version command, a wait on another check's probe, its own probe, and the margins) refuses
the mint, naming each failed combination; what passed is frozen into `run.json.reviewer_preflight`.
`--no-verify-reviewers` skips the check, and the run is stamped `REVIEWERS-UNVERIFIED`, which caps the gate at `RISK`.

**One retry, for one named failure.** A headless agy cannot ask for a permission, so when its model tries a tool it may
not run (a shell command), agy denies it and can end the turn `SUCCESS` with an empty answer. `external-review.mjs`
recognises that shape in the stream of a process that exited cleanly (a denied tool step, then an empty result;
`ndjsonDeniedTools` and `deniedEmptyAnswer` in `scripts/lib/reviewers.mjs`), keeps that attempt's raw output where it has
an evidence directory and the write succeeds (`not_checked[]` names a write that failed), and calls
once more with the same prompt and settings, within what is left of the call's one limit. The usage it reports is both
calls' sum, in the envelope and in the call's entry, which also keeps each attempt's own record; `not_checked[]` says so
whether the retry answers or ends unavailable. A retry that could not be started ran nothing: the reviewer is unavailable,
the usage and the entry are the first call's alone, and `not_checked[]` says that instead. Denied again, the reviewer is
unavailable with that cause, the tool named, never as "no parseable" answer (operator, 2026-11-10: "A. Detect, retry
once (Recommended)"; `.claude/requests/decision-panel-seats.followup.md`). No other failure is retried.

What this replaced: a missing or broken reviewer used to be an exit 0 with the reason in
`not_checked[]`, and the run continued — "external tooling absence must never block a review". It
was never invisible, but a review could proceed on a reviewer nobody had shown to work.

A reviewer that PASSED its preflight and then fails during the call — times out, errors, returns
something unparseable — is still reported the old way: exit 0, an envelope whose `not_checked[]`
names the reviewer and the reason, and the run continues. That is never silent either: a run where
Codex failed and one where Codex found nothing would otherwise be indistinguishable, and the first
would read as corroboration it never provided.
With one arm down there are no ties, so agy is not consulted unless you deliberately substitute
it as the second arm.
