# What 1.x keeps compatible

From 1.0.0, quorate makes one promise to the projects that mount it: what this page covers keeps working, with the same
meaning, through every 1.x release. A change that would break it waits for 2.0, and is signalled two ways:
`graph_contract_version` for the contract, and semver on the release.

The policy is the draft the operator agreed on 2026-09-25 (ROADMAP §M3 item 1), and `m3-v1.plan.md` stage 3 built it.
Each promised set is frozen at 1.0 in `scripts/compatibility.json` and checked by a test against the file that owns it
now. Until 1.0 is tagged, the freeze must **equal** what the owner declares, so a key or flag added before the tag is
frozen with the rest. From 1.0 on, the freeze must be a **subset** of it: a 1.x release may add, and may not remove or
rename. `scripts/lib/compatibility.mjs` owns that rule (`freezeHolds`).

## Covered

### The contract

Every `graph_contract` key `shared/claude-md-contract.md` documents at 1.0 keeps its name and meaning throughout 1.x.
New keys may be added, always optional, with a default that keeps 1.0's behaviour. A change of meaning bumps
`graph_contract_version` and waits for 2.0.

- *The set:* the keys in that document's `yaml` examples, the template's block (`CLAUDE.template.md`), and the
  per-language `code_index` keys from their owner (`scripts/lib/code-index-contract.mjs`). A name a project chooses (a
  lens id, a reviewer name, a language) is written `*`.
- *Held by:* `tests/regression-compat-contract-keys.test.mjs`. It fails when a frozen key leaves the documents, so a
  removal or a rename is caught. A change of meaning under the same name is not something a test can see. The
  `graph_contract_version` history in `shared/claude-md-contract.md` is where one is recorded, and it waits for 2.0.

### `gate.json`

Every field present in 1.0 keeps its name, its type and its meaning. New fields may be added, so a reader must ignore
fields it does not know. The gate verdicts `PASS`, `RISK`, `FAIL` and `BLOCKED` are fixed, and so are the other verdict
fields' values: `max_verdict`, `adjudicated_floor`, each node's `verdict` and each `buckets.ok` entry's.

- *The set:* `scripts/gate.schema.json`, the shape of the file `run-graph.mjs` writes. A field's type includes its
  enum, so narrowing a verdict field's values is a change. A field whose values are not an enum (a node's `state`, the
  pre-flight's `state`, `stamps`) is promised as a string, and a 1.x release may add values to it. A reader that
  branches on one must have a branch for a value it does not know.
- *Held by:* `tests/regression-compat-gate-schema.test.mjs`. It runs the real orchestrator in a throwaway repository and
  validates each gate it writes, a finished one, a forced `BLOCKED`, and one whose lens reported OK and whose reconciler
  was asked again (a fake runtime, so `buckets.ok` and `reconcile_reask` are populated), against the schema. It reports any field the
  schema does not declare, so the schema stays complete, and it fails when a frozen field leaves the schema or changes
  type. *And at the writer:* `run-graph.mjs` checks every gate against the schema, strictly, before writing it; a gate
  that does not match is written `BLOCKED`, stamped `GATE-SCHEMA` (`shared/disk-first-protocol.md` §7), and checked
  again; one that still fails is fitted to the schema (`fitToSchema`, `scripts/lib/compatibility.mjs`: undeclared fields,
  top-level or nested, dropped; each declared field that validated kept, each that did not at its least value), its
  errors printed on stderr, and written only once it validates, so no gate a reader receives violates the schema that
  promises its shape
  (`gate-schema-at-writer.plan.md`). A field an older engine
  never recorded (a resumed run's re-ask record) is `null` in the gate, read through the one function that knows the
  older shape.

### Commands

The entry points and flags `QUORATE.md` documents keep working as documented.

- *The set:* each invocation `QUORATE.md` writes out (`node .claude/skills/quorate/scripts/<name>.mjs ...`), and the
  flags its prose names for a command (`--preflight` and `--skip-preflight` on `run-graph.mjs`, for example). Flags
  `QUORATE.md` mentions that belong to another program (node's, git's, the runtime's) are listed as such in
  `compatibility.json` and promise nothing.
- *Held by:* `tests/regression-compat-commands.test.mjs`. Each written-out invocation must parse against its script's
  entry in `scripts/lib/argv-specs.mjs`, the one argv owner, which is what the script itself parses with. Each frozen
  flag must still be accepted there and still be documented in `QUORATE.md` in a section that names its own script
  (`flagsDocumentedWith` in `scripts/lib/compatibility.mjs`: a heading or a first-column list item to the next), so a flag
  written only under another command does not count. `.claude/hooks/install.mjs` reads its arguments without that
  owner, so its one documented flag, `--force`, is held by running the installer in a throwaway repository: refused
  over a hook it does not manage without the flag, replaced with it.

### Removals

Anything removed in 2.0 is flagged by `check-install` for at least one 1.x release before it goes.

- *The list:* `deprecated` in `scripts/compatibility.json`. That file is the list's one owner. Each entry is
  `{ kind, name, since, removed_in, use_instead }`. `kind` is `contract-key`, with a key path as the name, or `flag`,
  with `<script> --flag`. At 1.0 the list is empty.
- *What check-install does with it:* it names each entry the project still uses, with the fix. A contract key is looked
  for in the project's contract, and a flag in the files that invoke quorate: `.claude/settings.json`,
  `.claude/settings.local.json` and the git hooks. Each use is reported as stale, so a project sees it before 2.0
  removes it. A list check-install cannot read is reported as that, never as "nothing deprecated".
- *Held by:* `tests/regression-compat-removals.test.mjs`.

## Not covered

Nobody should build on these and believe they are stable. Any 1.x release may change them.

- **Prompt wording**, and **what the lenses find**. A release that makes a lens find more, or less, is not a break.
- **Everything under `scripts/` that `QUORATE.md` does not document**: other scripts, other flags, the modules under
  `scripts/lib/`, `scripts/io/` and `scripts/platform/`, `lens-roster.json`, `reviewers.json`, `verdict.schema.json`.
- **The other run artifacts:** `gate.md`, `reconciled.md`, and the run directory's layout. `gate.json` is the one
  artifact covered. `gate.md` and `reconciled.md` are written for a person to read.
- **The findings ledger's format** (`.claude/reviews/ledger.json`). `scripts/findings-ledger.mjs` reads and migrates
  it. Nothing else should.
- **The telemetry records** (`shared/telemetry.md`). `telemetry.mjs report` is how they are read.
- **What `quorate:claim-check` does not check.** It checks what is written down, its checker can miss a claim, a claim
  about who asked stands only on a transcript the checker is given, and a command citation is re-runnable, not re-run.
  `shared/unverified-claims.md` ("What it does not cover") owns these four limits.
