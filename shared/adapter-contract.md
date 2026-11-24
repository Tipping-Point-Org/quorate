# What quorate needs from a runtime, and what each requirement buys

This document exists because the framework had the dependency backwards. A node's sandbox was
*Claude Code's permission flags*, and an external reviewer's findings were capped by two literals
that no adapter could ever change. Both are the same mistake: an implementation standing in for a
requirement, so a runtime that could satisfy the requirement differently had no way to say so.

The inversion is the whole point of this file. **quorate states the requirement and what meeting it
achieves. An adapter declares which requirements it meets and by what mechanism. What a node is
allowed to claim is then DERIVED, not assigned.**

Nothing here asks an adapter to be Claude Code. It asks for properties, and names what is lost when
a property is absent — because "lost" is the honest word: a runtime that cannot isolate a node from
the source can still review, it simply cannot be trusted with the one job that isolation exists to
protect.

---

## The requirements

Each is declared by an adapter under `capabilities: [...]` in its table entry. An adapter that
declares nothing is treated as a **prompt-only** runtime: it can read a prompt and return an
envelope, which is the floor and is genuinely useful — the cross-family panel has run on exactly
that since it was built.

### `structured_output`

**Needed:** the runtime returns a machine-checkable object conforming to a supplied schema, not
prose that must be parsed out of a transcript.

**Achieved:** the node's answer can be *validated* rather than interpreted. Every finding gets a
shape check — file, line, claim, basis, evidence path — before it reaches the reconciler.

**Lost without it:** the framework must scan free text for something that looks like a verdict. A
reviewer that answered a different question, or was truncated mid-sentence, is indistinguishable
from one that found nothing. This is a floor requirement: without it a runtime cannot be a node at
all, only a source of commentary.

### `evidence_capture`

**Needed:** the runtime can execute a command *inside the run directory* through quorate's own
`capture.mjs`, and cite the path that capture prints.

**Achieved:** the basis ladder above `convention` (§4). A finding may claim `measurement` — "a
captured measurement demonstrates it" — because the measurement exists on disk, was produced during
this run, and any reader can open it. `invariant` findings become checkable the same way.

**Lost without it:** every finding falls back to `convention`, "it departs from an observed
convention in this codebase", **which §4 caps at MEDIUM for any reporter — a Claude lens included.**
This is the real and only reason external arms are capped (`shared/external-reviewers.md`, "The
ceiling on an external arm", owns the values). It was never a judgement about third parties: a `FAIL`
resting on an evidence path nobody can verify would promote the whole gate on an unverifiable claim.

### `path_scoped_read`

**Needed:** the runtime can be constrained to read only declared paths, enforced by the runtime
itself rather than by asking the model.

**Achieved:** half of Rule 2 — a node that reads intent cannot reach the implementation it is
supposed to precede.

**Lost without it:** intent capture is unsound. A criterion written after seeing the implementation
describes what was built, so conformance passes by construction. A runtime without this cannot hold
the `intent` role, whatever it promises in its prompt.

### `content_tool_denial`

**Needed:** the runtime can be made to refuse *every* tool that returns file content — search,
shell, and any equivalent — enforced, not requested.

**Achieved:** the other half of Rule 2, and the reason it is stated as three things TOGETHER.

**Lost without it:** path-scoped reads are decoration. A shell reads content (`Get-Content`,
`Select-String`), and so does a grep. This framework shipped an intent sandbox with a working
PowerShell for months because the deny list named only `Bash` — the failure is silent and looks
exactly like a sandbox.

### `no_write`

**Needed:** the runtime cannot modify the tree under review.

**Achieved:** a review that cannot become an edit. Findings are reported, never applied.

**Lost without it:** the artifact under review changes while it is being reviewed, and the run's
own `TREE-MOVED` detection is measuring the reviewer.

### `budget_bound` · `wall_clock_bound`

**Needed:** the runtime accepts a spend ceiling and a time ceiling, and stops at them.

**Achieved:** a barrier that terminates. A node that cannot be bounded holds a concurrency slot
forever and takes the run with it.

**Lost without it:** quorate applies its own outer kill (it does this regardless), so the run still
ends — but the node's own accounting is unavailable and the spend is recorded as unmeasured rather
than as zero, which is a different and more honest claim.

**Declare only what the runtime actually provides.** `budget_bound` needs `node_runtime.budget.flag`
and `wall_clock_bound` needs `node_runtime.timeout.flag`; either declared without its mechanism is
refused by name before the spawn. A graph node's spawn (`scripts/spawn-node.mjs`) renders the timeout flag with the node's own timeout in whole seconds. The engine's other runtime calls (`spawn-subagent.mjs`, `io/forge-spawn.mjs`, `check-intent-grant.mjs`, and `new-run.mjs`'s canary and intent probes) pass no timeout to `nodeArgv`, so they render no timeout flag, and this bound does not cover them (G-19 of 20261122-144505-m3s7-b3-remediation-3-review). The shipped `claude` entry declared `wall_clock_bound` for a while
and there is no such flag — nothing required it, nothing rendered it, and no check looked, so the
claim could not be wrong (G-18). A capability nothing consumes is worse than an absent one: in the
run's artifact it reads exactly like a guarantee.

### `credential_scoping`

**Needed:** the adapter declares which environment prefixes it may receive, and receives only those.

**Achieved:** a secret cannot cross a vendor boundary. One vendor's process never sees another's
keys, and neither sees the operator's shell.

**Lost without it:** an adapter that declares no prefixes receives **no credentials at all**. That
is the fail-closed direction on purpose: an arm that cannot authenticate is a visible `DEGRADED`, a
leaked key is not.

---

## Declaring is not enough: the mechanism

A capability list is a **claim**. `evidence_capture` tells the orchestrator that a runtime *can* run
`capture.mjs`; it does not tell it how to **say so** — and quorate writes the policy file a node runs
under before that node exists. Those spellings were hardcoded as `Bash`/`PowerShell` and
`Tool(command:*)`, which is one runtime's vocabulary, so a second runtime would have been granted
nothing and denied nothing while declaring both capabilities.

So an adapter carries its grant vocabulary alongside its claims:

```json
"node_runtime": {
  "grants": {
    "shell_tools":  { "win32": ["Bash", "PowerShell"], "default": ["Bash"] },
    "content_tools": ["Grep"],
    "command_rule": "{{tool}}({{command}}:*)"
  }
}
```

- **`shell_tools`** — what can execute a command, per platform. `evidence_capture` is granted by
  naming these in an allow rule. Platform-keyed because availability is: a rule for a tool the host
  cannot expose is dead weight in a file whose value is being small and auditable.
- **`content_tools`** — what returns file CONTENT, on top of the shells. This is what
  `content_tool_denial` has to deny, and shells count: `Get-Content` and `Select-String` read a file
  as surely as a search tool does. That omission is exactly how every intent node on this platform
  kept a working shell for months.
- **`command_rule`** — how one grant is spelled. The CALLER supplies every spelling it needs, and
  quoting is the caller's business, because only the caller knows which part of its command is a
  path. The first implementation wrapped the whole command instead of the path and produced
  `Tool("node <path>":*)` where the tree has `Tool(node "<path>":*)` — the same length, a different
  rule, and a silent loss of the evidence channel for any checkout under a directory with a space.

A runtime that declares no grant vocabulary gets **no rules**, not guessed ones.

### The tool vocabulary, and the entrypoints

```json
"node_runtime": {
  "tools": {
    "deny_always":  ["Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Task"],
    "deny_intent":  ["Bash", "PowerShell", "Grep"],
    "edit_tools":   ["Edit", "Write"],
    "lens_allow":   ["Glob"],
    "name_tools":   ["Glob"]
  },
  "version_argv": ["--version"],
  "resume_argv":  ["--resume", "{{session}}"]
}
```

`edit_tools` is what writes files: every mode denies them through `deny_always` except a REMEDIATE node, which is granted
them through path rules scoped to the contract's globs, and `no_write` requires `deny_always` to name every one of them.

**Every tool list has one shape**, held by `scripts/lib/tool-lists.mjs`: an array of non-empty strings. `shell_tools` is
an object whose keys are a platform id (`win32`, `linux`, `darwin`), `default`, or a `$` comment key, each other value
such a list; the platform's own list is used where it has one, else `default`'s. `adapterErrors` refuses an adapter whose
list has any other shape, by name, at mint and before each external call, and every reader goes through one accessor
that reads a malformed list as empty rather than throwing. Each reader used to decide shape itself, and a bare spread
crashed on `shell_tools: { default: 1 }` (adapter-tool-lists.plan.md).

`lens_allow` is what a LENS gets besides a scoped read: no content tool, since none can be confined to the repository
(`disk-first-protocol.md`, "No `Grep` for a lens"; a lens searches content with `git grep` through `capture.mjs`). `name_tools` is what the INTENT node gets:
tools that return names and no content, because it must enumerate the declared documents and a name
is not content. They are two keys, not one, and the difference is the sandbox — a content tool in
`name_tools` voids Rule 2. The intent list held the literal `Glob` inside the orchestrator until
G-54, in the one policy file §5 calls the Rule 2 sandbox, so a second runtime got a rule for a tool
it does not have while its own name-lister went ungranted.

`resume_argv` is OPTIONAL and is the one entrypoint that does not raise when absent: it renders the
"how to reopen this node's session" line in a node report, and a runtime that cannot reopen a
session has the report say so. Every node report printed `claude --resume <id>` as a literal until
G-53 — a vendor name in an artifact a consuming project keeps forever, naming a binary the node may
never have run on.

These were frozen arrays inside `lib/decisions.mjs` — one runtime's tool names, in the pure decision
layer, where a second runtime could never reach them. quorate asks for the PROPERTY (`no_write`,
`content_tool_denial`); which names deliver it is the runtime's answer.

**An entrypoint quorate needs and a runtime does not declare RAISES**, naming the key. It does not
fall back: a fallback IS the hardcoding one level down — correct for the runtime it was written
from, and silently producing nothing for any other.

**A capability with no mechanism is refused before the spawn.** Declaring `content_tool_denial` and
naming no content-reading tool is a claim the runtime cannot keep: the framework would grant the
role, write a policy that denies nothing, and report a sandboxed node. Found by a test fixture doing
exactly that.

### Declaring what a model and effort may be

```json
"effort": {
  "style": "flag", "flag": "--effort",
  "values": ["low", "medium", "high", "xhigh", "max"],
  "rejected_when_model_matches": "\((?:High|Medium|Low)\)\s*$"
}
```

Checked at **mint**, over every assignment the roster makes — each lens, each arm, and EVERY
adjudicator in the judge set (a preflight that checked one of them would let the second fail on the
rarest node in the graph, hours in).
Most nodes spawn in the first minute; an adjudicator spawns only on a genuine cross-family dispute
and `ui-audit` only when a project declares a surface, so a typo on one of those surfaces hours in,
after the quota is spent, looking like a transport failure rather than a misspelling.

**What is fatal and what is advisory matters more than the check itself:**

- `values` is a **closed set** — the CLI parses a fixed enum and rejects anything else, so an error
  here cannot be a false refusal. Omit it when the accepted set is not known: absent means *not
  enum-checked*, which is honest, while a guessed list would reject a level the vendor accepts.
- `rejected_when_model_matches` is the sharp case, and it was live here: agy takes `--effort` for
  most models and **rejects** it for names that already encode the effort in the label, such as the
  pinned adjudicator `Gemini 3.1 Pro (High)`. Two documents in this repository disagreed about that
  for weeks — one said agy takes `--effort`, the other said it is rejected for these names — both
  half right, with nothing enforcing either.
- `known_models` is **advisory only**. Vendors ship models constantly, and a preflight that refuses
  one released last week is a worse failure than the crash it prevents. An unrecognised model warns
  and the run continues.

A malformed `rejected_when_model_matches` is the adapter author's bug and is reported as one — a
pattern that will not compile must not pass silently as "no rule".

### Which runtime is the default

`default_node_runtime` in the adapter table. `args.runtime ?? 'claude'` put a vendor name in the
spawner, which is the one thing the table exists to end — and the distinction matters: *Claude Code
is the only runtime that provides the full sandbox today* is a fact about the world, while *the
spawner names Claude* was a fact about this codebase. Only the second was ours to fix. A table with
no declared default and a caller with no `--runtime` is refused; the orchestrator does not pick a
vendor. A policy that
grants nothing while looking complete is worse than one that fails.

### How the prompt reaches the CLI

```json
"node_runtime": { "prompt": { "via": "stdin", "argv_marker": "-p", "flag": "-p" } },
"prompt":       { "via": "stdin-ndjson" }
```

A node runtime's `node_runtime.prompt.via` is `stdin` or `argv` (absent reads as `argv`), read only through
`runtimePromptVia` (`lib/reviewers.mjs`). With `stdin`, `nodeArgv` puts `argv_marker` alone in the argv (`claude -p`, no
text after it) and returns the prompt as `input`, which every spawn of the runtime writes to the child's stdin; `flag`
stays for a contract that overrides the block back to `argv`, and a stdin prompt with no `argv_marker` is refused. Inline
in argv the prompt met Windows' command-line cap near 32,767 characters, which is why the shipped runtime takes stdin
(`.claude/requests/decision-panel-seats.design.md`, DP-D1 A).

A reviewer's top-level `prompt.via` is a different property, read only through `reviewerPromptVia`: `stdin` (the text
itself, after an `argv_marker` such as codex's `-`), `stdin-ndjson` (one line
`{"event":"user","message":{"role":"user","content":<prompt>}}`, the input agy's `--input-format stream-json` reads), or
`argv` (inline at its `placeholder`). Only an `argv` reviewer is held to the inline budget (`budget_bytes`, else
`INLINE_ARGV_BUDGET`), and a reviewer on any other transport that declares one is refused. An `argv` reviewer with
`needs_shell_on_windows` is refused too, since a shell would re-parse the inline prompt. A reviewer on
`stdin-ndjson` answers with `response.from: ndjson-result`: the answer is the `field` of the final
`{"event":"result",…}` line's `result`; a result whose status is not `SUCCESS` is the reviewer's own failure, named by
its status, its error text kept in the raw log rather than in the reason; and a schemaless answer is scanned in that
result's `response`, never in the raw stream, where it is string-escaped (DP-D2 A). What a tool step the reviewer was
denied looks like in that stream is `response.denied_step`: the `event` value, the `body` path of the step, the `where`
fields and values that mark it, the `message` path and the `pattern` that says a permission refused it, and the `name`
paths of the tool, first present wins; an adapter that declares none is never retried for a denied tool. Any stdin text reaches the child
from a file (`scripts/io/stdin-file.mjs`), never a pipe: on Windows the close of a pipe's write end waits until the child
has read it, so a child that never read it held the parent open. The file is in a folder each call makes exclusively below
`<engine home>/stdin/` (`QUORATE_HOME`, else `~/.quorate`), through `confined`, never in the shared temporary directory;
an engine home that cannot be written refuses the spawn. A folder there older than a day, which a child still holding it
kept from being removed, is removed by a later call, whatever its name, since every folder there is this module's; a link
found there is reported, never followed (`.claude/requests/stdin-folder-owner.design.md`, SF-D1 A, SF-D2 A).

### A model's family, and where a runtime reports usage

```json
"family": [{ "model": "Gemini", "family": "gemini" }, { "model": "Claude", "family": "anthropic" }],
"usage":  { "from": "stdout-wrapper", "field": "usage" }
```

`family` names who made the adapter's models, the fact a cross-family panel and its telemetry rest on. It is a string for
a CLI of one family, or a list matched by model-name prefix, first match wins, for a CLI that serves several (agy serves
Gemini models and Claude ones). `familyOfCall` (`lib/reviewers.mjs`) is the one rule: the stake check, the judges' check
and telemetry all ask it. A roster role that declares its own `family` is refused when it disagrees. An adapter that
declares none answers with its own name, and a model no entry matches has no family rather than a guessed one
(`.claude/requests/runtime-call-telemetry.design.md`, CR-D3 A).

`usage` says where a runtime reports what a call consumed: `stdout-wrapper` (one JSON object, the usage under `field`),
`json-events` (JSON lines, the last `event` carrying it), or `ndjson-result` (the `field` of the final result event of an
NDJSON stream, agy's). Every call to a runtime, whatever its role, is measured where it
is made, by `lib/call-entry.mjs`: times, exit code, signal, timeout, the usage read through this mapping, the outcome and
the family. `shared/telemetry.md` owns what a record keeps of it.

---

## Roles, and what each requires

| Role | Requires | Notes |
|---|---|---|
| **lens** | `structured_output`, `evidence_capture`, `path_scoped_read`, `content_tool_denial`, `no_write` | The full sandbox. A lens judges the source with the run's authority. |
| **intent** | `structured_output`, `path_scoped_read`, `content_tool_denial`, `no_write` | No evidence capture: intent capture reads documents and writes criteria; it must not execute anything. |
| **arm** | `structured_output` | The floor. Everything above is optional and each one raises what the arm may claim. |
| **adjudicator** (`tie-break`) | `structured_output` | Votes between positions already on disk; it needs no access of its own. One of a SET — see `shared/external-reviewers.md`; the role key is still `tie-break` because that is what `ROLE_REQUIREMENTS` calls it. |

A role is refused when a requirement is unmet, **and the refusal names the missing capability** —
not "unsupported reviewer". That is the difference between a wall and a specification.

**All four are checked.** This paragraph was true of two of them for a while (G-55): the arm path
computed the role contract and wrote `eligible` / `missing_for_role` into `nodes/expected.json`
where no branch read it, and the tie-break role was a table entry no caller ever passed to
`roleGaps` at all — so for the two roles that actually spend money at a third-party vendor, the
requirement was recorded and never enforced. A refusal now writes a `SKIPPED` status naming the
missing capability — on BOTH paths, which was the second half of the same defect (G-43): the arm path
wrote one and the adjudicator path pushed a `not_checked` row and moved on, writing no status file and
no `expected.json` row, so a refused judge appeared nowhere in the gate's node table. The disputes an
unsuitable judge cannot adjudicate stay in the count as unadjudicated rather than disappearing with
it, and the judge stays in the coverage denominator as an absent vote: a two-judge panel with one
unusable adapter is not the same thing as a one-judge panel, and reporting coverage 1/1 for both is
the distinction the whole merge rests on.

---

## The platform adapter — the first one implemented as code

Every adapter above is a DECLARATION: an entry in `reviewers.json` that states what a runtime can
do, rendered by code that never names a vendor. The operating system is the exception, and it is
one on purpose rather than by drift (`.claude/requests/os-platform-adapters.md`).

A vendor differs in *vocabulary* — a flag's spelling, an effort's name, a tool's name — and
vocabulary is data. An operating system differs in *mechanism*: killing a child and everything it
started is a process-group signal on POSIX and `taskkill /T` on Windows, which is two pieces of code,
not two strings. So the platform adapter is code, under `scripts/platform/`.

That is all this section owns. The adapter's layout, its members and its rules belong to
ARCHITECTURE §2 (the Platform row) and to `scripts/platform/interface.mjs`, and are not restated here —
not even as a list, since a list is the copy that falls behind (G-27 of 20260925-200721-platform-remediated). They were, in three documents at once, and a copy that listed the
interface's members had already fallen behind it (G-25, G-26, G-27 of 20260925-015614-platform-review).

---

## Status, stated plainly

**Declared and derived today**: the capability set, the role requirements, and the *derivation of
what a node may claim* from what its adapter can do. An arm's severity ceiling falls out of
`evidence_capture` being absent, and an adapter that declares it earns the higher basis by the same
rule that has always governed Claude lenses. An arm's or a judge's verdict ceiling is not derived:
`shared/external-reviewers.md`, "The ceiling on an external arm", owns what fixes it.

**What `evidence_capture` on an arm adapter does NOT do on its own** (G-56). The derivation lifts
the ceiling; `external-review.mjs` still stamps `convention` on every finding it emits, because the
evidence path it can produce is the reviewer's raw log — a transcript this run cannot re-derive, not
a captured artifact. Those two together would have been worse than either: a ceiling raised above
what §4 allows a `convention` finding gets the finding REJECTED by the validator, so the arm's
ceiling is tightened back to the rung it actually stands on. The capability is what makes the higher
basis REACHABLE; the second half — an arm that runs `capture.mjs` inside the run directory and cites
what it printed — is the spawn path, and it is not built. Declaring the capability today buys a
correct derivation and no change in outcome, which is the honest state and is stated rather than
implied.

**Not built**: the policy-file FORMAT. An adapter describes flags (`settings.flag`) and rule
spellings (`command_rule`, `command_rule_exact`), and `new-run.mjs` then writes a document with a
fixed shape — `{ permissions: { defaultMode, allow, deny } }` — because that is the schema the one
shipped runtime parses. A runtime whose policy is expressed differently has no extension point and
would need the orchestrator edited (G-20, panel-codex-arch). The seam carries the VOCABULARY and not
yet the CONTAINER, which is a narrower claim than "swappable" and is the honest one until a second
runtime exists to shape the abstraction against. Inventing a policy-document renderer with no second
consumer would be generality this project could not test, and the last four defects in this area were
all a declaration nothing consumed.

**Not built**: a second lens runtime. Every lens today is Claude Code, and its capabilities are
satisfied by `--settings`, `--setting-sources`, `--permission-mode`, `--add-dir`,
`--disallowedTools` and `--json-schema`. Those flags are now recorded as *one adapter's mechanism
for meeting the requirements above*, rather than as the requirements themselves. The spawn path is
built: `scripts/spawn-node.mjs` selects the runtime from the adapter table and spawns through its
merged `node_runtime` block, not through a hardcoded `claude` invocation. What remains is a second
adapter entry that declares its own equivalents, and the runtime to test it against.

**Deliberately not promised**: that declaring a capability makes it true. An adapter's declaration
is a claim like any other, and this framework does not accept claims it cannot check. The reviewer
preflight probes the transport; nothing yet probes that a runtime's sandbox holds. Until something does, a
declared `path_scoped_read` is the adapter author's assertion, recorded in the run so a reader knows
what it rests on.
