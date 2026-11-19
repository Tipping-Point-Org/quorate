# The `graph_contract` block

The verification graph is configured by exactly one thing: a fenced `yaml` block declaring
`graph_contract`. Every command, glob, model, budget, and degradation path is read from there.

It may live in the host repo's `CLAUDE.md` or in `.claude/rules/quorate-contract.md`, which is
preferred for a consuming project because it is a file quorate may own and update. The block is
found by its `graph_contract:` KEY, not by its position or by a heading: the parser used to take
the first fenced yaml block in the file, so any unrelated yaml above it — a CI snippet, a config
example — was silently fed to the parser instead. Two locations carrying blocks that DISAGREE are
refused with both paths named; two carrying identical blocks is a migration in progress. Every run
records which file it read, in `run.json.contract_source`.

`new-run.mjs` is the only component that parses it. Everything downstream reads the already
parsed result from `run.json.contract`, so there is one parser and it cannot drift from a
second one.

**Nodes never discover the environment.** A lens that goes looking for the build command is
spending tokens to re-derive a fact that was declared. If a key is empty, the corresponding
check is skipped and named verbatim in `not_checked[]` — the run still passes on what remains
(disk-first-protocol.md §7).

**Do not fill a key with a command that does not run.** An aspirational command is worse than
an empty one: an empty key degrades honestly and says so in the report, while a broken command
fails the barrier and blocks the entire run.

---

## Keys

### `graph_contract_version`

Schema version — currently `6`, and the one thing that can tell you a key changed MEANING while its
spelling stayed the same.

It was called `graph_contract` until v3: one word that named the block AND versioned it, so it
read as "this is a graph-contract block" rather than "version N of the contract". **Both spellings
are accepted** and the new one wins if a file carries both, so the rename breaks nothing — an
engine upgrade must not become a breaking change for a cosmetic reason. A contract still using the
old key gets a note, not a refusal.

A value **above** what the mounted engine implements is a hard error: a contract written for a newer
engine may rely on semantics this one does not have, and guessing is how `budget_usd_per_node: ""`
went from a `$0` cap that blocked every node to uncapped with nothing to notice it.

A value **below** is not an error. The run proceeds, is stamped `CONTRACT-STALE`, is capped at `RISK`,
and names every key whose meaning moved since the version you declared — then you re-read those keys
and set the number to record that you have. Refusing instead would break every consumer the moment
this repository bumps, punishing them for the upgrade they were told to perform; silence is the
defect being removed, not the remedy.

| Version | What changed |
|---|---|
| `6` | `review.external_panel: true` now means every external reviewer is **probed before it is used and refused if it fails**: each combination of reviewer, model, effort and mode before its first call and again once its record is older than the new `review.reviewer_probe_max_age_hours`, and at mint for every panel arm and adjudicator, where a failure refuses the run. A missing or broken reviewer used to be named in `not_checked[]` while the run continued. `new-run --no-verify-reviewers` skips the mint check, stamped `REVIEWERS-UNVERIFIED` (capping); a reviewer that passed at mint and fails during the run stamps `PANEL-DEGRADED` (capping). `check-reviewers.mjs` replaces `check-panel.mjs` and `check-tiebreak.mjs`. |
| `5` | Every contract glob follows **one grammar**, matched **exactly**: a glob that says more than its directory covers only what it says (`docs/**/README.md` no longer covers all of `docs/` for scope, demotion or `CONTRACT-PARTIAL`), and `?`, `[...]`, braces, `.` or `..` segments, absolute paths and a leading `!` are refused at mint. The intent node reads a sandbox of copies of what each `doc_paths` glob matches. Keys: the four glob keys, `review.preflight_inputs`, `doc_roles`. |
| `4` | A declared command no longer means "run before every review" but "run when the previous result no longer applies": the pre-flight is reused while its inputs and the worktree are unchanged. Declare `review.preflight_inputs`, or accept an inferred set and its `CHECKS-INPUTS-INFERRED` ceiling. |
| `3` | The key was RENAMED from `graph_contract` to `graph_contract_version`. Both are accepted; no key changed meaning. |
| `2` | An absent or empty `review.reviews_dir` now **stages** the run outside the repository and moves it back into `.claude/reviews` when the run ends; it used to be written there live. A run appears in `git status` only once finished, and one killed mid-flight stays staged. |

### `project`

Free text, used in report headers.

### `commands`

Exact command strings, runnable from the repo root. `""` means not available.

| Key | Class | Empty means |
|---|---|---|
| `build` | **barrier** | Pre-flight barrier skipped, run stamped `UNBUILT`, gate capped at `RISK`. |
| `test` | evidence | Run stamped `UNTESTED`, gate capped at `RISK`. |
| `lint` | evidence | Lint evidence unavailable; named in `not_checked[]`. |
| `fmt_check` | evidence | Formatting unverified; named in `not_checked[]`. |
| `typecheck` | evidence | Typecheck skipped; named verbatim in `not_checked[]`. |
| `bench` | — | `perf-audit` becomes static-risk-only: its `basis` enum is restricted to `convention` and `invariant`, every finding is CAPPED at `LOW` and its verdict at `RISK`, run stamped `UNBENCHED`. It cannot `FAIL` on a `convention` finding — but a §6 invariant is never capped, so an unbenchmarked run can still fail on one. |
| `run` | — | `feature-verify` is `SKIPPED` with a `skip_reason`. It appears in the gate's Not-checked table, never in Lens-did-not-report. |
| `shell` | — | `""` = launch argv-split with no shell, the safe default. Set to e.g. `"bash -lc"` only if declared commands genuinely need pipes or globs. |

Two halves of that row were stale for a while, and the resolution rule made it worse: `CLAUDE.md`
tells a reader that where its shorter table and this document disagree, **the owning document wins**
— and here the owning document was the wrong one. `degraded_basis` in `lens-roster.json` has
included `invariant` since G-45 (restricting the enum to `convention` alone withheld the §6 basis
exactly when the lens most needed it), and the floor became `degraded_severity_ceiling: LOW` after
G-40 proved `degraded_severity_floor: LOW` was a no-op — LOW is the bottom rung, and both documents
had always promised an unbenchmarked finding is recorded AT LOW, which is a ceiling. A stale
sentence in the document named as the tie-breaker is worse than a stale sentence anywhere else: it
steers the maintainer back into a defect that was already fixed once.

**Barrier vs evidence.** A failing `build` aborts the run and spawns nothing: a lens reasoning
about code the compiler has already rejected produces findings nobody can trust. A failing
`test`, `lint`, or `fmt_check` is a *fact the lenses should see*, not a reason to refuse to
look — it is captured, stamped, and handed on.

`commands.*` entries are also what generates the node allow-list. An entry here becomes a
`Bash(<command>)` rule in `node-settings.json` — alongside a fixed seeded set the generator
always grants: read-only `git` inspection rules and the `capture.mjs` invocation rules (both
path spellings), which every lens needs to produce evidence. An earlier version of this sentence
said "nothing else does", under-reporting the executable surface by those seeded rules; the
surface to size is `commands.*` PLUS that fixed set, and `capture.mjs` itself re-checks every
payload against the run's frozen contract and constrains the read-only tails.

Three keys the table above omitted, each load-bearing (round-3 G-16):

- **`test_product`** — a consuming project's own test suite, run by `tests/run-all.mjs` alongside
  the orchestration suite. Declaring it also admits the command to the `capture.mjs` execution
  allow-list, exactly like `build` and `test` — an undocumented key that widens the sandbox was
  the case this addition closes.
- **`test_one`** — a TEMPLATE running one test file, for a remediation node's red and green checks
  (`remediation-verification.plan.md`). Exactly one whitespace-separated token is `{file}`; a template with none,
  two, or `{file}` inside another token is refused when a run is minted, and so is any `test_one` beside a non-empty
  `commands.shell` (the placeholder would be interpolated into a shell string). `capture.mjs` fills `{file}` with one
  file only when it is a repository-relative path written with forward slashes, with no flag, no glob character and no
  control character (nor a Unicode line or paragraph separator), classified `test` by the contract's globs, present in
  git's file list (tracked, or untracked and not ignored), and not reached through a link out of the repository. It is
  granted to the remediation node of a remediation run and to nothing else, and never with `--cwd`. It is not one of the
  keys the pre-flight or the hooks run: a template cannot run as written. Empty leaves a remediation node no red it can
  commit on: the evidence gate admits only `test_one` captures, so only groups declared not expressible as a test
  commit (the remediation node's own limit, below).
- **`audit`** / **`deny`** — supply-chain checks (e.g. `npm audit`, `cargo deny check`). Run last
  by the pre-push gate because an overnight upstream advisory is the one failure the pushed
  commit did not cause. Empty is named in `not_checked[]` like every other empty key.

### `source_globs`, `test_globs`, `doc_paths`, `generated_globs`

Flow-sequence lists, e.g. `["src/**", "crates/**"]`.

- `source_globs` minus `generated_globs` defines what counts as a source change. The changes are the
  diff against the base plus the untracked files git does not ignore; when none of them is a source
  file, `full-review` **refuses** an implicit whole-repo scope. An empty diff beside a new untracked
  source file goes ahead, scoped to that file. `--full-sweep` with no path after it is refused, never read as a
  derived scope.
- **What kind of file a path is** has one owner, `lib/finding-scope.mjs` `classifyPath`, with this precedence: a file
  matching `generated_globs` is never source or test; `test_globs` wins over `source_globs` for a file matching both;
  then source, then doc, then undeclared. A remediation commits only `source` and `test` files, and may never edit a
  generated one (remediation-paths, operator 2026-10-08).
- `doc_paths` is what `intent-capture` may read, and what `doc-consistency-review` reviews.
- A finding whose `file` falls outside every declared surface — `source_globs`, `test_globs` and
  `doc_paths` — is moved to `out_of_scope_observations[]` by the spawner's validator, which the
  gate prints and does not tally. `test_globs` is part of that surface: omitting it would demote
  every finding about test code to an unenforced note.
- A finding with `basis: invariant` is NEVER demoted, wherever its file sits. §6 says the six
  non-waivable invariants may be raised entirely outside a lens's declared scope, and that clause
  is what keeps this rule from being able to hide a `credential_exposure` BLOCKER.
- Tracked files matching NO declared glob are counted at mint and the run is stamped
  `CONTRACT-PARTIAL`. They are invisible to scope derivation and cannot be demoted either, so an
  incomplete contract silently narrows what the gate governs — named rather than blocking, because
  a guard that fires dozens of times on a first run is one people route around.
- **The grammar of a contract glob** (`scripts/lib/contract-glob.mjs`, its one owner). Accepted: `*`,
  which matches within one path segment; `**` as a whole segment, which matches any number of
  segments (`**/` also matches none, and a trailing `x/**` also matches `x` itself); and literal
  characters. `/` and `\` both separate segments, and a leading `./` and a trailing `/` are ignored.
  A literal path names a file, or a directory and everything below it. **Refused**, each with its
  reason: an empty glob; a glob outside the repository — an absolute path (`/x`, `C:/x`, `\\host`) or
  a `..` segment anywhere, which a lexical check cannot bound after a wildcard; `?`, `[`, `]`, `{`, `}`;
  a `.` segment; a `**` that is part of a segment (`a**b`); and a leading `!`, which in a
  `.gitignore` negates. A brace list is the common case: write each alternative as its own entry.
  These forms were refused because each was read differently by different parts of the engine, which
  is how a glob came to mean one thing for scope and another for what a node could read.
- **Where it is checked.** `new-run` refuses a contract with any entry outside the grammar when a run
  is minted, and `preflight` before it seeds anything, naming every entry as `key: glob — reason`.
  This holds for these four keys, for `review.preflight_inputs`, and for every `doc_roles` value.
  `--full-sweep` paths are checked against the same grammar, except `.`, which asks for the whole
  repository. `new-run --print-contract` does **not** refuse: the git hooks read their commands
  through it, and a glob refusal there would block a push over a key the push does not use.
- **Matching is exact, everywhere** — scope derivation, finding demotion, `CONTRACT-PARTIAL`, the
  pre-flight and intent hashes, and `find-inert-features`, which no longer hands globs to git. A glob
  that says more than its directory covers no more than it says: `docs/**/README.md` covers the
  `README.md` files under `docs/`, not all of `docs/`. **One stated exception:** the remediation path compares the
  paths git reports (its tree guard, admission, planner and evidence gate) by the repository's case rule —
  `pathKey`, keyed by git's `core.ignorecase` (`git config --bool core.ignorecase`, unset meaning case-sensitive), so
  `Package.json` is `package.json` in a repository git created case-insensitive and another file in one it did not,
  whatever the platform (`candidate-check-boundaries.plan.md`, its stage 1 amendment; operator, 2026-10-14: "Git's
  core.ignorecase (Recommended)").
- **What the intent node reads: a sandbox of copies.** For every `doc_paths` glob, the documents it
  matches are copied into the node's sandbox, together with the documents named under `doc_roles`
  (the request through its own copy, checked against the hash frozen at mint), the framework's doctrine
  and the run's `contract.snapshot.md`; the node reads nothing else, and no document is granted in place.
  A document inside a review run directory or a `generated_globs` tree is never copied, even when a glob matches it:
  a glob that walks into one passes over it, and one that names such a file directly is refused and recorded. Measured before this was built: on Windows the
  Read rules the intent policy carried granted nothing, and `--add-dir` on a live doc directory
  granted everything below it, so `docs/*.md` exposed `docs/sub/b.md`. `node scripts/check-intent-grant.mjs`
  (live, `QUORATE_LIVE=1`) measures the sandbox for each glob form.
- **Except a glob with no directory before its first wildcard** (`*.md`, `**/*.md`): its walk would
  start at the repository root, so it is not granted to the intent node at all. It still counts for
  scope and for the doc lenses. `new-run` prints that it was not granted, and the run records it in its
  not-checked list; to give the intent node those documents, name a directory (`docs/**/*.md`). Every
  other doc glob the snapshot cannot honour — a base that does not exist, one leaving the repository —
  is recorded the same way.

### `doc_roles`

Which declared document plays which role. `""` = not available.

```yaml
doc_roles:
  architecture: "specs/architecture_specification.md"
  roadmap:      "specs/implementation_plan.md"
  spec:         "specs/project_specification.md"
```

This is what makes the ported review skills portable: they review against whatever the host
repo declares rather than against a hardcoded filename. Citations resolve at run time and
render as `(<doc_roles.architecture> §N)`.

A role's value is a path in the repository, in the same grammar as a glob key, and one
outside the repository — or otherwise outside the grammar — is refused the same way (see above): every
value is expanded for the intent hash, so it has to name something the hash can read.

**Degradation is explicit and never silent.** With `doc_roles.architecture` empty,
`arch-review` does not quietly pass — it reviews against observed conventions only, and `not_checked[]` names the
missing key by name. A degraded `arch-review` is capped as `shared/disk-first-protocol.md` §7 states.

**`doc_roles.request` is the one role with a discovery fallback.** An empty key does not go straight
to recovery: `new-run` first looks for a single `.claude/requests/*.md` carrying `status: approved`, and
uses it if there is exactly one. Two or more is refused rather than ranked — choosing which ask a run
judges conformance against belongs to whoever starts the run — and a draft, or an un-promoted
`inferred` document, is invisible to the search.

That exit has to exist, because run-graph writes "a human who reads this and sets `status: approved`
lifts the cap on the next run" into every inferred request. Without discovery, approving the file
changed nothing and the next run re-drafted it, so the banner the orchestrator itself wrote was
false. Recovery fires when nothing is declared AND nothing is discovered — the doctrine used to say
"every run", which stopped being true when the exit was built (G-30).

**A run minted from another run inherits its request, and resolves nothing.** `new-run --remediates` takes the reviewed
run's request, and `--follows-remediation` takes the remediation's. That covers an explicit one (which must still
exist, and is refused when its bytes no longer match the hash the source run recorded: edit a request, then review
again), an inferred one (with `REQUEST-INFERRED` and its cap), or none (stamped `UNREQUESTED`). The run records
`request_inherited_from`. A `--request` or `--no-request` that asks for something else is refused, naming both
(remediation-consumer-findings.plan.md stage 1).

### `ui`

```yaml
ui:
  surface: tauri-webview   # none | web | tauri-webview | desktop | cli | tui
  static_bundle: "dist/"   # "" when no build output exists
```

**Only `none` is load-bearing.** Every reader of this key — `run-graph`'s `not_checked` entry and the
roster's `ui-audit` condition — tests `!== 'none'` and accepts any other string, so the list above is
DESCRIPTIVE: it tells a reviewer what kind of surface they are looking at, and nothing enforces it.

Which is how the two published lists came to disagree without any run failing (G-42). This document
said `none | web | tauri-webview | cli | tui`; `CLAUDE.template.md` — the file consumers are told to
copy — said `none | web | tui | desktop`. `desktop` existed only in the template, `tauri-webview` and
`cli` only here, and the reachable harm is a consumer filling in `desktop` from the template, a later
reader checking it against this document, finding no such value, and "correcting" it to `none` — the
one correction that silently deselects `ui-audit` on a project that has a UI. The two lists are the
same list now, and the template says outright that an unlisted value behaves like any non-`none` one.

`surface: none` means `ui-audit` is `SKIPPED` entirely. An empty `static_bundle` means
`ui-audit` runs static-source only.

**Standing caveat for `tauri-webview`:** a Tauri app renders in the platform webview (WebView2
on Windows, WebKitGTK on Linux), not in Chrome. Verifying a frontend bundle in headless Chrome
verifies it in *a* browser, which is not the shipped app. `ui-audit` and `feature-verify` must
record that in `not_checked[]` **every run** rather than implying app-level verification.

### `code_index`

The extractors the code index runs, one map per language, each with the keys `extractor`, `globs`, `options` and `env`.
`shared/code-index.md` owns what each key means, with the block's example ("The contract block"), the request and
response, and the queries; `extractors/README.md` owns the commands that ship. Neither is copied here, so neither can
drift from a copy (G-10 of 20261107-072037-split-delivery-3). Three states:

- **Absent:** the feature is off, and the CLI refuses.
- **`{}`:** declared with no languages, and every query answers `not_configured`.
- **A language with `extractor: ""`:** that language answers `not_configured`.

Refused at mint and at pre-flight (`codeIndexContractErrors`, `scripts/lib/code-index-contract.mjs`):

- a block that is not a map, or a language that is not one;
- a language name that is not lower-case letters, digits, `_` and `-`;
- a key other than `extractor`, `globs`, `options` and `env`;
- an `extractor` that is not a string, or missing `globs`;
- `options` that are not a map;
- an `env` outside `review.candidate_env`'s rules, or one that matches a secret-shaped name or admits the `ANTHROPIC_`
  or `CLAUDE_CODE_` families.

Each language's `globs` are contract globs, checked with every other glob key.

The template carries `code_index: {}` and never a language. `check-install` compares nested keys, so a language in the
template would be reported missing from every consumer that does not declare it.

### `hooks`

```yaml
hooks:
  secret_scan: required    # required | off; absent means required
```

**`secret_scan` — whether pushes and CI are scanned for secrets.** The installed `pre-push` hook runs
[gitleaks](https://github.com/gitleaks/gitleaks) over the commits each push adds, on every branch,
before its protected-ref decision: a secret pushed to any branch has already left the machine. CI runs
`scripts/check-secrets.mjs` over the whole history, which covers merges made on the forge, where no
local hook runs. Found secrets are redacted in the output.

**Which rules.** Both scans use gitleaks' default rules plus the rules quorate ships in `.claude/hooks/gitleaks.toml`
— `quorate-key-value` (a quoted value), `quorate-key-value-unquoted` (an unquoted one) and one `quorate-<token>`
rule per token shape. That file is GENERATED from `scripts/lib/secret-shapes.mjs`, the one definition redaction is
built from too (secret-shapes-and-refusals 1a), so the two guards cannot drift apart. What they catch is not
restated here: it is the `CASES` table in that file, which every row runs through both guards.

**A shape the table does not list** is a request for a row, not a defect in either guard (operator, 2026-09-29).
A review that finds one keeps its rating; it is closed by adding the row, with the test it brings.

A repository with its own `.gitleaks.toml` is scanned with that file instead, since its secret policy is its
own call. `check-install` then says the shipped rules are not in force.

| Value | pre-push | CI (`check-secrets.mjs`) |
|---|---|---|
| `required`, or absent | gitleaks runs; a found secret, a failed scanner, or **gitleaks not installed blocks the push** | CI installs gitleaks (hash-pinned) and runs it; the same three fail the job |
| `off` | skipped, and the hook says so on every push | skipped, and the job says so |
| anything else | refused — the push is blocked naming the key | refused — exit 2 |

Anything but the two values is refused rather than read as either, including `""`. Elsewhere in this
contract an empty key means "skipped and named"; for a safety switch, a silent empty would be the
unscanned push this key exists to prevent. Absent means `required` (operator, 2026-09-25), so a
project that says nothing is scanned, and one without gitleaks is told how to proceed: install it, or
declare `off`, where every reader of the contract can see the choice. Added for G-9 of
`20260926-002850-m0-close`: the first version let a consuming project's push through unscanned when
gitleaks was missing — "absent treated as pass".

CI reads this flag through the engine (`check-secrets.mjs --mode`), never by parsing the YAML itself,
so the hook and CI cannot disagree about what it says.

### `threat_model`

A folded block scalar (`>`) stating what is in and out of scope for `security-audit`. Findings
outside the declared model go to `out_of_scope_observations[]` — except the non-waivable
invariants (disk-first-protocol.md §6), which no threat model can waive.

### `review`

```yaml
review:
  concurrency: 3
  checks_concurrency: 1          # how many EVIDENCE pre-flight checks may run at once; 1 = serial
  check_timeout_minutes: 10      # the ceiling on each pre-flight check, whole minutes; absent = 10; "" is refused
  preflight_cache_max_mb: 256    # size cap for the machine-local pre-flight cache; "" = uncapped
  code_index_cache_max_mb: 256   # size cap for the code index cache under the engine's home; "" = uncapped
  code_index_timeout_minutes: 10 # the ceiling on each extractor call; absent = 10; "" is refused
  panel_snapshot_max_mb: 1024    # size cap for the external arms' snapshot of the working state; "" = uncapped
  reviewer_probe_max_age_hours: 24   # how old a passing reviewer probe may be before it is repeated; "" = no age limit
  session_record_retention_days: 30  # how long a session's records are kept; absent = 30; 0 or any string = no limit
  capture_preview_lines: 120     # lines of each stream `capture.mjs --interactive` returns; absent = 120; a whole number >= 0, else refused
  capture_max_mb: 1024           # per-stream output cap of `capture.mjs --interactive`, in MB; absent = 1024; a number > 0, else refused; output reaching it stops the command's tree and fails the call with status `output_cap_reached`
  preflight_inputs: []           # globs naming what the declared checks READ; [] = inferred, and said so
  node_timeout_minutes: 30      # absent = 30
  budget_usd_per_node: 2.50
  budget_usd_per_barrier: 6.00   # the reconciler's own stop; omitting it silently derives max(6, node*2.5)
  barrier_timeout_minutes: 35    # the reconciler's own clock, same rationale; omitting it derives node_timeout_minutes * 2, held at the maximum
  intent_timeout_minutes: 30     # intent-capture's own clock: it reads every declared document IN
                                 # FULL, so it scales with DOC VOLUME rather than with review scope.
                                 # Growing shared/** by ~40 lines pushed it from 12 minutes past the
                                 # 15-minute node cap, and the run lost its criteria entirely.
                                 # Omitting it derives node_timeout_minutes * 2, held at the maximum.
  budget_usd_per_run: 12.00
  reviews_dir: ".claude/reviews"
  models: { judgment: opus, mechanical: sonnet }
  runtime: claude                # the node runtime, an adapter name; absent = the adapter table's default_node_runtime
  external_panel: false
  claim_check_transcript: same-family # which claim checker may read the session transcript; absent = same-family
  effort: { judgment: xhigh }    # always sent explicitly; omission substitutes 'high' and records it
  convergence_floor: HIGH        # the rung the findings ledger drains TO; see below
```

**Every limit in minutes, and what an absent one means.** One module owns them (`scripts/lib/check-timeout.mjs`), and
this table is written from it by `node scripts/gen-rule-text.mjs`, so it cannot disagree with the code. Every value is a
number or a string of plain digits; `""`, `true` and a value declared empty are refused at mint, and so is one above
the maximum, the same for every key: the most a Node timer can hold (above it a timer fires after about 1 ms). A fallback
named rather than numbered is resolved first, and a derived one is held at the maximum, as its Absent cell says.

Where several limits enter one timer together, the sum is checked once, where it is summed. The reviewer probe's are
the one such set: its check runs `3 × version_timeout_seconds + 2 × probe_timeout_minutes + 4 × check_margin_seconds`
in one timer, so each value can be within its maximum and the set still not fit. `probeLimits`
(`scripts/lib/reviewer-probe.mjs`) refuses such a set, naming each term, at mint (for `probe_defaults` and every adapter,
built-in or declared) and again at a reviewer's call. With the shipped version and margin limits (30 s and 60 s), a probe
limit fits up to 17,892.94 minutes: it may be fractional, and 17,892.95 does not fit.

<!-- rule:minutes-table -->
| Key | Absent | Empty (`""`) | Whole minutes only | Minimum | Maximum |
|---|---|---|---|---|---|
| `review.node_timeout_minutes` | 30 | refused | no | above 0 | 35791 |
| `review.barrier_timeout_minutes` | twice review.node_timeout_minutes, at most 35791 | refused | no | above 0 | 35791 |
| `review.intent_timeout_minutes` | twice review.node_timeout_minutes, at most 35791 | refused | no | above 0 | 35791 |
| `review.check_timeout_minutes` | 10 | refused | yes | 1 | 35791 |
| `review.code_index_timeout_minutes` | 10 | refused | no | above 0 | 35791 |
| `roster.lens.timeout_minutes` | review.node_timeout_minutes | refused | no | above 0 | 35791 |
| `roster.arm.timeout_minutes` | its lens timeout_minutes | refused | no | above 0 | 35791 |
| `roster.remediation.timeout_minutes` | review.node_timeout_minutes | refused | yes | 1 | 35791 |
| `consumer_lens.timeout_minutes` | review.node_timeout_minutes | refused | no | above 0 | 35791 |
| `reviewers.probe_timeout_minutes` | 5 | refused | no | above 0 | 35791 |
| `flag --timeout-minutes` | review.node_timeout_minutes | refused | no | above 0 | 35791 |
<!-- /rule:minutes-table -->

**`runtime` — which adapter every node and the engine's own model calls run on.** An adapter name from the table (the
built-ins in `scripts/reviewers.json`, plus whatever `reviewers:` declares). Absent means the table's
`default_node_runtime`; a name the table lacks, or a value that is not a name, is refused, naming it. An explicit
`--runtime` (spawn-node's, passed from the run's frozen contract) wins over the key. One function chooses it,
`selectAdapters` in `scripts/lib/reviewers.mjs`, and every entry point asks it: the mint and its policy files, every
node, the remediation node, `spawn-subagent` (plan reviews, the claim checker), `claim-check`'s same-family label,
`decide`'s runtime seat, `resume-run`, `check-intent-grant`, the CLI freshness check and the bench. A census test
(`tests/regression-contract-runtime-owner.test.mjs`) refuses a script that reads the key itself: by dot, by bracket, by
destructuring, or through an alias of the review section the same file binds; an alias it cannot see bound (a function
parameter, a spread) is its stated residual. It was read by some of these and not others until 2026-11-05
(contract-runtime-and-session-files.plan.md), so a contract that declared it ran its plan reviews and claim checks on the
default. The telemetry records name what a run FROZE, never today's choice.

**`preflight_cache_max_mb` — how large the pre-flight cache may grow.** Each distinct input set
keeps its result and a copy of its captured output under `<reviews root>/.preflight-cache/`, which
is machine-local and kept out of git: every writer into a reviews root — mint, archive, and
`preflight --run` — writes that root's `.gitignore` first if it has none (G-28 of
20260925-200721-platform-remediated; seeding the pre-flight before the first mint used to skip it).
An operator's own `.gitignore` there is left alone, so one that drops the rule is theirs to keep
right. Bounded by SIZE, not entry count — one entry can be 100 KB or
50 MB — and after each write the least recently USED entries are removed until the rest fits; a
reused entry counts as used. The entry just written is always kept, even when it alone exceeds the
cap, and the gate then names that in `not_checked[]`. Absent means 256 MB; `""` means uncapped, by
your declaration; a number is that many megabytes. Added for G-10 of
20260925-015614-platform-review: the cache used to grow with every edit, forever.

**`code_index_cache_max_mb` and `code_index_timeout_minutes` — the code index's own bound and ceiling.** The
code index (`shared/code-index.md`) keeps its facts under the engine's home, outside every working tree, and its cache
follows the pre-flight cache's rule: least recently used removed first, the newest always kept. It has its own cap so
the disk you allowed the pre-flight cache is not shared under one number. Absent means 256 MB, `""` uncapped, and a
number that many megabytes. The timeout bounds each extractor call. Absent means 10 minutes, a positive number that
many, and `""` is refused, because an extractor with no ceiling would hold a query forever. Neither key changes what
`preflight_cache_max_mb` or `check_timeout_minutes` mean.

**`panel_snapshot_max_mb` — how much changed and untracked content the arms' snapshot may take.** The
directory an external reviewer reads is built from a snapshot of the working state (the tracked files
with their changes, plus untracked files not ignored), and a linked directory can lead that snapshot to
a large tree outside the repository before the check that leaves such content out can run. So the sizes
of the changed (staged or not) and untracked files are summed first, from paths alone, and over the cap
the snapshot is not built: that run has no external panel, stamped with the reason. Absent means
1024 MB; `""` means uncapped, by your declaration; a number is that many megabytes. A project that keeps
large untracked files it does not want reviewed can ignore them instead, which removes them from both
the cap and the snapshot. Added for `.claude/requests/arms-read-surface.md`.

**`reviewer_probe_max_age_hours` — how long a passing reviewer probe counts.** With the panel on, every external
reviewer is probed before it is used: a small known task in the mode it is about to be used in, for the exact
combination of adapter (and its definition), model, effort, mode, schema route, CLI version, machine and the probe's own code (a hash of `PROBE_CODE_FILES`, `scripts/lib/reviewer-probe.mjs`). A pass is
recorded under the engine's home and reused for that combination until it is older than this; then the next call
probes again. A changed model, effort, adapter definition or CLI version is a different combination and is probed
before its first use whatever the age — the CLI version only for a reviewer whose adapter declares `version_argv` (every
built-in does). A declared reviewer without it keys as `undeclared`, so an update of its CLI is noticed only by this
age limit, and never under `""`: declare `version_argv` for any reviewer you add. Absent means
24 hours; `""` means no age limit, by your declaration — a record then counts until its combination changes; a number
is that many hours. A probe that fails refuses the call, and at mint refuses the run (`shared/external-reviewers.md`,
"Failure handling"). Read from the run's frozen contract inside a run, the live one outside. Added for
`.claude/requests/reviewer-preflight.plan.md`.

**`session_record_retention_days` — how long a session's records are kept.** The session hooks (`scripts/stop-guard.mjs`,
`scripts/command-log.mjs`, `shared/session-rules.md`) keep a folder per session under the engine's home. A session's first
write removes that repository's session folders whose newest file is older than this many days. Absent means `30`; a
positive whole number is that many days; `0` or any string means no limit (operator, 2026-10-25: "allowing 0 (or another
string) as no limit"), so a mistyped number written as a string also reads as no limit; a negative or fractional number
is refused by the reader, and the hooks then keep the default and say so on stderr rather than stop logging; `capture.mjs
--interactive`, which prunes its saved labels by the same key, refuses such a value instead, with exit 2. Read from the
live contract by the hooks, in process. Added for `.claude/requests/session-record-files.plan.md`; no version change, since
a key whose absence means its default moves no other key's meaning.

**`claim_check_transcript` — which claim checker may read the session's transcript.** With `external_panel: true`,
`quorate:claim-check` runs its checker in the other family, through `scripts/external-review.mjs`. An attribution ("you
asked for X") is checked against the session's transcript, so this key decides where that file goes. `cross-family`:
the cross-family checker gets the transcript reduced to the conversation (commands and their outputs dropped; the
operator's and the session's text, the question tool's exchanges, and one line per file change and commit kept:
`scripts/lib/transcript-reduce.mjs`; operator, 2026-10-25), passed through the secret redaction, and checks every claim; the
transcript then reaches that reviewer's vendor as well as the one the session runs on. `same-family`: the cross-family
checker never sees it, and attribution claims are checked by a subagent on the node runtime, which does; its claims are
recorded under that runtime's name from the adapter table. **Absent means `same-family`**, so a consumer sends no
transcript to a second vendor unless it decides to; any other value, the former `claude` included, is refused at mint
(renamed 2026-10-19, A-9: the vocabulary names a role, not a vendor). With the panel off the key does nothing: the
checker is a node-runtime subagent either way. Either way the cross-family checker stands in the arms' snapshot
(`--surface`), which narrows what it is shown and does not bound what it reads: `--surface` sets its working directory,
and a read-only sandbox bounds writes, not reads (`shared/external-reviewers.md`). Read by `claimCheckTranscriptOf`
(`scripts/lib/claim-check.mjs`). Added for `.claude/requests/claim-check-cross-family.md`.

**`decision_panel` — whether a question with options goes to the decision panel instead of the operator.** `off | on`;
**absent means `off`**, and any other value is refused. On, a session that would put a question with options to the
operator sends it to `scripts/decide.mjs`, which asks the panel's seats, blind, and takes the answer by majority; who
sits on the panel is the node runtime (a fresh subagent at the contract's judgment model and effort) beside the roster's
`decision_panel.seats` (`scripts/lens-roster.json`), as `scripts/decide.mjs` builds them; the seats themselves are not
restated here. What reaches those vendors is owned by `shared/external-reviewers.md` (the decision panel's
paragraph), and not restated here (G-9 and G-10 of 20261104-030455-gre-remediation-3-review). It needs
`external_panel: true`: on without it is refused, naming both keys. A decision reserved for the operator
(`shared/session-rules.md`, "What waits for the operator") never reaches the panel, on or off. Nodes do not inherit it:
`decide.mjs` refuses under `GRAPH_NODE_DEPTH`. A round in which fewer seats answer than the quorum (`QUORUM` in `scripts/lib/decision-panel.mjs`, its one
owner) ends the decision at once as
`seats-unavailable`, each silent seat named with why, for the operator: no further round, moderator or revote
(`.claude/requests/decision-panel-seats.plan.md` stage 4). Read by `decisionPanelOf` and `panelUsable`
(`scripts/lib/autonomous-keys.mjs`). Added for `.claude/requests/autonomous-run.plan.md`.

**`decision_rounds`, `decision_rounds_max` — how long the panel may talk.** `decision_rounds` (absent = 3) is the number
of talking rounds before the panel's moderator is asked whether to extend; `decision_rounds_max` (absent = 6, or
`decision_rounds` if that is higher) is the hard cap the moderator may extend to, one round at a time. Whole numbers; a
hard cap below the cap is refused. Read by `decisionRoundsOf` (`scripts/lib/autonomous-keys.mjs`).

**`run_spend_max` — how many spends a run may start on delegated answers.** A review, a remediation or a bench run
started on an answer the panel gave counts as one. **Absent or `""` means no bound**; a whole number is the bound, and 0
allows none. At the bound the run stops and names it. Read by `runSpendMaxOf` (`scripts/lib/autonomous-keys.mjs`).
The session counts each spend with `decide.mjs --count-spend <decision-id>` before starting it, against the active run
(`run-session.mjs start`'s state, named by its plan and start time), so a run that crosses midnight keeps its count and
two runs never share one; with no active run the count is refused, and so is a spends record that cannot be read.

**`run_time_limit_hours` — how long a run may last.** **Absent means 72**; `""` is unlimited; any other value must be a
positive number of hours. At the limit the run stops and names it. Read by `runTimeLimitHoursOf`
(`scripts/lib/autonomous-keys.mjs`).

**`grounding_floor` — the basis a panel decision must reach to be settled by the panel.** One of the basis values
`shared/disk-first-protocol.md` §4 owns (read from `scripts/verdict.schema.json`'s enum, never copied). **Absent means
`measurement`**, the operator's ruling of 2026-09-13 (ARCHITECTURE.md A-22); any other value is refused. A decision's
basis is set by code from the evidence paths its majority seats cite, the lowest among them; at or above the floor the
panel settles the question, below it the question goes to the operator with the panel's positions as its options. A
seat executes nothing, so a decision reaches `measurement` only through a captured artifact that already exists, and
only one the question names in its `evidence` list (a list of paths, refused before a record exists if it is anything
else, if an entry has a `..` segment, if an entry is absolute and not below a reviews directory a citation is graded
against: the declared `reviews_dir`, or, undeclared, the archive and the engine home's staging root, or if an entry's
file is missing, unreadable, not a file, or reached through a link; a question with no list grounds no seat: `.claude/requests/grounding-and-retry-evidence.plan.md`). Read by `groundingFloorOf` (`scripts/lib/autonomous-keys.mjs`). Added for `.claude/requests/decision-records.plan.md`.

**`preflight_inputs` — what the declared checks READ, and therefore what makes a previous result
stale.** A run no longer re-executes the pre-flight barrier by default. It hashes the files below,
compares that against the entry the last run left, and re-runs only when the result no longer
applies. The files are GIT'S LIST under the globs: tracked plus untracked-not-ignored, never an ignored file (a suite's
own leftover output once changed the hash), and the entry records which files it hashed (`input_files`). With the set
DECLARED and listed by git, the hash alone decides: a changed input changes it, and a dirty file outside the set does
not invalidate (operator, 2026-10-12: "Hash decides when declared (Recommended)"; `preflight-reuse-by-hash.md`). With
the set INFERRED, or when git cannot list the tree, a dirty worktree also invalidates, whatever moved. Every class is
cached, `build` included: being cacheable and being invalidated are separate rules, and both hold.

Empty is legal and honest, and it costs a ceiling. The set is then INFERRED from `source_globs`,
`test_globs`, the contract file itself and any root-level dependency manifest — and a declared check
can read a file none of those name. `uv run pytest` behaves differently after `uv.lock` moves, and a
`source_globs` of `["src/storypipe/**"]` excludes it. So a reuse under an inferred set is stamped
`CHECKS-INPUTS-INFERRED`, capped at `RISK`, and named in `not_checked[]`: unproven freshness is
staleness, and where the engine had to guess it says so rather than inferring silently.

Declare the globs and the ceiling goes away, because the claim stops being a guess. `--preflight
always` re-runs unconditionally; `--preflight never` (and its alias `--skip-preflight`) skips,
stamps `CHECKS-SKIPPED`, caps, and names every declared command in the gate. The install-time
question — *are these commands runnable at all* — belongs to `scripts/preflight.mjs --run`, which is
where a seven-minute suite should be paid for once.

**`convergence_floor`** is the severity at or above which an open finding keeps a review loop
running. `findings-ledger.mjs --summary` reports `DRAINED` when nothing open sits at or above it,
and two consecutive drained cycles is the recommended stop. It was the literal `HIGH` at the one
call site that computes the signal (G-13), so a project wanting to drain to `MEDIUM` had to patch
the engine — which is the "hardcoded rather than declared" shape I-10 names as its own failure mode.
Absent means `HIGH`, so a project that says nothing is unaffected.

**`reviews_dir` — where run artifacts land, and the one key that decides whether a review touches
your tree WHILE IT RUNS.** Empty or absent STAGES each run under the engine's own home and moves it
back into `.claude/reviews` once it ends: `git status` stays clean throughout a sweep, and the
finished run is still committed alongside the code it judged. **Its `evidence/` moves only if git would
ignore it there** — captured output can carry the operator's environment (§3 of the protocol), so the
archive asks `git check-ignore` about the evidence path, and when the answer is anything but "ignored"
(the reviews `.gitignore` lacks the rule, or re-includes it) the run is archived without its
`evidence/`, which stays staged; the gate's not-checked table says where — when run-graph archives the run. A run
archived later by `scripts/archive-run.mjs` reports withheld evidence on stderr only, and its gate does not say where
(G-1 of `20261017-000724-sp-bugs-backout-review`, open). Declare a path to write runs straight
there with no staging. `run-graph --no-archive` leaves one finished run staged, and a run killed
mid-flight stays staged either way — which is where `--resume` looks for it. `--resume` also takes a finished run,
archived or staged, whose reconciler left groups out, leaving the run where it is; what it does then is owned by
`shared/disk-first-protocol.md`, Batched reconcile. A remediation run ends,
and is archived by `remediate.mjs`, once nothing is pending for `--retry-commits` and no commit is
unrecorded; that happens before its follow-up review is minted, so the follow-up records where the run
now is; an archive that is refused or fails mints no follow-up, and the run stays staged. A link that
still names a run's staged path (`follows_remediation`, `remediation_frame`) is followed to the run's new
place by its name, and only to a run carrying the link's `run_id`. `scripts/archive-run.mjs --run-dir <dir>` archives an ended
run left staged; until 2026-10-15 only run-graph archived, so every remediation stayed staged.

Two properties survive either choice. The value is bounded — it may name a directory inside the
repository or inside the engine's home and **nothing else**, because this key is read from the
contract of whatever tree the engine is pointed at, and an unbounded one would let that tree choose
any directory on the machine to write into (the path traversal the threat model puts in scope; three
separate defects had already exploited the narrower version of this bound). And the cross-run
**ledger does not move**: it stays tracked at `.claude/reviews/ledger.json` whatever `reviews_dir`
says, because it is the project's memory rather than one review's working artifacts, and deriving its
location from this key would have carried that memory out of the tree the moment the runs left.

**Folding is manual, and the summary says when it is incomplete.** No orchestration step folds a run
into the ledger — not `run-graph`, not `new-run`, not either git hook — so a cycle only enters the
store when someone runs `findings-ledger.mjs --run-dir <dir>`. What a fold takes from a run is what its gate
confirmed — its reconciled groups, at the payload's severity — owned by `shared/ledger-transitions.md` ("What a
fold counts"). `--summary` compares the runs it has
folded against the run directories actually present and warns about the difference (G-14), because
otherwise an operator who ran five cycles and folded one is told `DRAINED` about four cycles the
store never heard of: cross-run silence read as a verdict, which is the one thing this store exists
to refuse.

`concurrency` defaults to 3 rather than something larger on token-velocity grounds: measured
cost is dominated by cache-creation tokens, and a wide fan-out multiplies that before any
review work happens.

**It bounds each FAMILY, not the whole run.** The lens fan-out and the external panel are two pools
of this width, running deliberately overlapped — six serialized arms cost 30.5 minutes of wall clock
that fits inside the lens window instead — so a panel run can have up to `2 x concurrency` children
alive at once. That is the intent, not an oversight (G-36): the two families spend different
budgets, against different vendors' quotas, and collapsing them into one pool would idle the local
fan-out behind a slow network arm. Size the value knowing peak children is twice it when
`external_panel: true`.

### `lenses` — bringing your own check

A map of `id -> declaration`, like `reviewers:` and for the same reason: the contract parser supports no
block sequences, and a key cannot be declared twice.

```yaml
lenses:
  stage-contract-audit:
    instructions: .claude/quorate/lenses/stage-contract-audit.md
    condition: { type: always }        # optional; defaults to always
    timeout_minutes: 12                # optional
```

This is the one place the tree under review supplies a NODE'S INSTRUCTIONS, and everything about how it
is treated follows from that. `spawn-node` otherwise refuses outright — "a node's instructions come from
the framework doing the reviewing, never from the tree being reviewed" — because `--repo-root` pointed at
another project would otherwise feed that project's skills into your run. A threat model or a project
profile is DATA reaching a brief; a lens's instructions are the node's whole contract, executed with your
credentials, producing findings that reach a gate you rely on.

So a project lens is **coverage, never authority**, and the caps are DERIVED rather than declared —
declaring any of them is refused with the key named:

| | |
|---|---|
| `allowed_basis` | `convention` only. `invariant` is the one basis that can raise a non-waivable finding, and the basis list becomes the envelope's schema enum, so this is enforced by the validator rather than by intention |
| verdict ceiling | `RISK` — it cannot `FAIL` a gate |
| `required` | always false — its absence can never block |
| id | may not collide with a lens the framework ships; that would be the reviewed tree rewriting the review under a familiar name |
| `instructions` | a relative path inside the repository, proved contained through links before any spawn; a missing file is fatal at mint rather than a fallback |

Every such run is stamped `CONSUMER-LENS`. This is the same bargain the external panel makes: an
opinion whose discipline this engine cannot verify is welcome as coverage and recorded as such.

### `reviewers` — bringing your own vendor

Optional. Adds external-reviewer adapters, or overrides fields on a built-in one, **without editing
the engine**. This matters because the alternative is editing `scripts/reviewers.json` inside the
mounted submodule, and those edits exist in no branch, are carried by no push, and are discarded
silently the next time the pointer moves.

```yaml
reviewers:
  grok:
    cmd: "grok"
    args: ["review", "--json"]
    env_names: ["GROK_API_KEY"]       # ONLY these exact variables cross into that vendor's process
    prompt: { via: stdin }            # or { via: stdin-ndjson } or { via: argv, placeholder: "<PROMPT>" }
    response: { from: stdout-wrapper, field: "answer" }   # or { from: file } or { from: ndjson-result, field: ... }
    effort: { style: flag, flag: "--effort" }             # or config-kv / none
    needs_shell_on_windows: false     # true only for an npm .ps1/.cmd shim; refused with prompt.via argv
```

Merged over the built-in table, per field, so `reviewers: { codex: { model: "..." } }` overrides one
key and keeps the rest. Every declared entry is validated **at mint**: a missing `cmd`, an argv
prompt with no placeholder, an argv prompt with `needs_shell_on_windows`, a `stdout-wrapper` or `ndjson-result` response
with no `field`, or an inline budget on a
reviewer whose prompt does not go by argv fails the run before anything spawns, with the reason named. What each
transport means is `shared/adapter-contract.md`, "How the prompt reaches the CLI".

`env_names` is the credential boundary for a reviewer you declare: that vendor receives exactly the
variables named, matched whole — never another vendor's, and never the operator's shell (G-21).
Omitting it means that reviewer gets no credentials at all, which fails closed as a visible DEGRADED
rather than leaking.

That boundary is exact for a reviewer you ADD. Overriding a built-in (`codex`, `agy`) keeps that
vendor's own prefixes, its `env_prefixes` in `scripts/reviewers.json`, and your
`env_names` are forwarded in addition (G-29 of 20260925-200721-platform-remediated). That is
deliberate: pinning a model must not strip the vendor's credentials. So the override's process
receives every variable matching those built-in prefixes, not only the ones you named.

An override can therefore change WHERE those credentials go: its `cmd`, any field that reaches argv, the
Windows shell. Overriding the node runtime (`claude`) does the same with no allow-list at all: every node
spawned on it gets at most the scrubbed environment plus the runtime's own auth. Both are the contract's
decision, trusted like the `commands.*` it declares (ARCHITECTURE.md A-26), and every path that runs an
overridden built-in names it: the gate (`gate.json.reviewer_overrides`), external-review, new-run,
spawn-node, spawn-subagent, check-reviewers, check-intent-grant, resume-run, the daily CLI freshness check
(`run-session.mjs freshness` and the hooks' refresh) and both benches print one line from `overrideLine`.

**A contract may not declare `env_prefixes`**, and mint refuses one (G-12 of
20260925-015614-platform-review). A prefix forwards every variable that happens to share it — the
one that did was `AWS_` — and a pattern would be no narrower. Prefixes exist only for the built-in
vendors, in `scripts/reviewers.json`, maintained with the engine; a declared entry can neither add
nor widen them.

**Two things this does not do yet.** It defines a vendor; it does not assign one to a role — which
lens an arm shadows, and who breaks ties, still live in `scripts/lens-roster.json` inside the
engine. And a declared adapter is not exercised by the offline suite, like every other transport
here: every reviewer is probed before its first use, and `QUORATE_LIVE=1 node scripts/check-reviewers.mjs`
checks every combination at once, declared reviewers included.

`checks_concurrency` governs the pre-flight barrier in `run-checks.mjs`, and **defaults to 1** —
serial, which is what it has always done. The six evidence checks (`test`, `lint`, `fmt_check`,
`typecheck`, `audit`, `deny`) have no data dependency on one another and cannot stop the run, so
their wall clock is strictly additive for no structural reason (G-30). But they are commands a
CONSUMING PROJECT declares and this engine knows nothing about: two of them may bind the same port,
share a build cache, write the same coverage file, or expect a database to themselves. Running them
concurrently by default would trade a slow pre-flight for intermittent failures in the one phase
whose job is producing trustworthy evidence, and a flaky barrier is worse than a slow one.

So it is the operator's declaration that their own commands are independent. Raise it when they are.

The `barrier` class is never pooled: it runs first and alone, and a failure stops the rest from
running at all — the checks that never ran are recorded as `SKIPPED` with `not run: a barrier check
failed first`, which is a different fact from a command the project never declared.

`check_timeout_minutes` is the ceiling each pre-flight check runs under before `capture` stops it, the whole
process tree through the stop owner (`capture-interactive.plan.md` stage 3; before it, only the direct process was
killed and a command that started others could leave them running); it is also the default deadline of
`scripts/capture.mjs --interactive` when `--timeout-minutes` is not given, so changing it changes that deadline too; and
**defaults to 10** — the value every check ran under before the key existed, so a contract that does not
declare it behaves exactly as before. `run-checks` passed no timeout at all, and a consumer whose suite
takes 11 minutes (story-pipeline, measured in quorate's M1 sandbox, 2026-10-04) was killed 55% through
on every review: stamped `TESTS-TIMED-OUT`, which caps the gate and leaves the suite's result unknown
(the stamp does not force the gate; `disk-first-protocol.md` owns that), and no key could change it. Declare the time your slowest check needs on this machine, with headroom for load, as a whole
number of minutes from 1 to the maximum the minutes table above states (the one every minutes value shares, the most a
Node timer can hold; `scripts/lib/check-timeout.mjs` owns it). A quoted value counts only as plain
decimal digits (`"45"`); `"0x2"` or `"1e1"` is refused rather than coerced. A fraction is refused: it reached
`spawnSync` as a millisecond count it rejects. `""` is REFUSED rather than read as uncapped, unlike the
size caps: a check that hangs with no ceiling holds the whole run forever. `capture`'s own
`--timeout-minutes` flag is judged by the same owner and exits 2 on a value it refuses, before launching
anything. Every captured log records the ceiling it ran under (`# timeout: N minute(s)`), killed or not. It also records
how much of its node's own session has passed (`# elapsed: N of M minute(s)`, from the start and cap spawn-node gives
every node), or `# elapsed: unknown (not inside a node)`. This is the clock a node reads before it claims a session
limit.

**It bounds every capture, not only the pre-flight** (remediation-verification.plan.md, stage 2), and each check the remediation runner runs on its commit candidate (stage 4). A capture whose caller
passes no `--timeout-minutes` (a lens, the remediation node, feature-verify's `run` launch) now runs under this key, where
it used to run under a fixed 10 minutes; a remediation node's capture of the full suite could not fit that. A malformed
value therefore refuses every such capture, as it refuses the pre-flight.

**The remediation node's own limit** is the roster's remediation entry `timeout_minutes` when it declares one, else
`review.node_timeout_minutes` (`remediationTimeoutMinutes`, `scripts/lib/remediation-chain.mjs`); a declared value that is
not a whole number of minutes, at least 1, refuses the remediation before its node is spawned. A project with no
`commands.test_one` cannot show a fix red before green: the evidence gate admits only `test_one` captures, so it commits
only groups declared not expressible as a test, and the commit check names the empty key for every other
(`remediation-verification.plan.md` stage 8; G-7 of `20261013-220031-rv-delivery`). Declare `test_one` first. Until it
is declared, a node that still captures the full suite red then green runs it twice, so its limit must exceed twice
`check_timeout_minutes` (stage 2) or the node is killed before it reports.

**`review.candidate_env`** names what a project's suite needs beyond the platform's process basics when the
remediation runner checks a commit candidate (`candidate-check-boundaries.plan.md`; operator, 2026-10-14: "Allow-list
(Recommended)"). That check runs code the remediator wrote, so its environment is an ALLOW-LIST: the platform's basics
(`processEnvBasics` in `scripts/platform/`: `PATH`, the temp and home folders, locale, and on Windows what a process
needs to start), the git identity, `QUORATE_HOME`, and these names. A flow list of names
(`[A-Za-z_][A-Za-z0-9_]*`) or `NAME_*` prefixes, e.g. `["JAVA_HOME", "UV_*"]`; absent or `[]` declares none. Refused at
mint and by `preflight`, naming each entry: anything outside that grammar (a bare `*`, an empty string), a duplicate,
and any entry admitting a name the runner always removes or sets itself — the runtime's auth, the run pin,
`GRAPH_NODE_DEPTH`, the channel files, `SSH_AUTH_SOCK`, every `GIT_CONFIG_*` name — so `GIT_*` is refused with that
reason — and any secret-shaped name (`MY_API_KEY`), which a declared prefix never forwards either. Matched by the platform's environment case rule (Windows folds); the refusals of a duplicate and of a reserved
name compare case-folded on every platform, so `FOO` beside `foo`, or a lowercase `anthropic_api_key`, is refused on
Linux and macOS too, the safe direction for a name that folds on Windows. A suite that needs an undeclared name fails
the candidate check visibly (`full-run-red`, retryable), and its log shows what was missing; declare it and retry.
(quorate's own suite is checked this way by `tests/tools/run-under-candidate-env.mjs`, which runs only quorate's.)

`models.judgment` applies to every lens, `reconcile`, and `second-opinion`. `spawn-node.mjs`
hard-errors on a haiku model in lens mode. Mechanical work — collation, diffing, rendering the
gate table — is script, not model.

`external_panel: true` requires `external-review.mjs` to exist under the framework's `scripts/` directory — this repository's own `scripts/` when working in the framework, `.claude/skills/quorate/scripts/` in the documented consumer mount.
`run-graph.mjs` probes for it and forces the value to `false` when absent, regardless of what
the contract claims, stamping the run `PANEL-ABSENT`.

---

## Keys that were deliberately removed

The design this set was built from declared `os: windows` and `shell: pwsh`. Both are gone.

They existed only to decide how to quote and launch the declared commands. The scripts are
Node and launch commands identically on every platform, and a declared platform can go stale
and lie in a way `process.platform` cannot. Both values are still **recorded** — `run.json.host`
carries `{platform, arch, node_version, runtime, runtime_version, cwd}` — so a report is attributable to
the machine that produced it. Recorded, not declared.

This does not violate "nodes never discover the environment": that rule is about *models*
spending tokens to re-derive declared facts. A script reading `process.platform` spends none.

---

## Installed since first delivery

Four artifacts were deferred in the first delivery and are now installed. Their contracts are
recorded here because they are still the contracts — a replacement must satisfy the same shape.

The first two live at `prompts/<id>/PROMPT.md`, not in `skills/`. This table said `SKILL.md` and
both paths resolved to nothing (G-58) — the untracked half of the move `CLAUDE.md` records and
explains: a graph node is not a skill, nobody can usefully invoke one, and twelve of them in
`skills/` put twelve false affordances into every consuming project's namespace. A reader following
a row here to check whether a replacement satisfies the same shape landed on a missing file, which
is the one thing a contract record must never do. `plan-review` and `version-gate` are genuinely
skills — a person runs both — and their rows are unchanged.

| Artifact | Contract it satisfies |
|---|---|
| `arch-review/PROMPT.md` | Named `arch-review`; emits the standard verdict envelope with `basis: architecture_doc`; renders its citation as `(<doc_roles.architecture> §N)` inside `claim`; never emits `intent_ref`; pushes `{"item":"doc_roles.architecture","reason":"not declared"}` into `not_checked[]` when the key is empty. |
| `doc-consistency-review/PROMPT.md` | Reads `doc_paths` from its brief (already emitted); `basis` restricted to `convention` and `invariant`; standard envelope. |
| `plan-review/SKILL.md` | **Not a graph node — a pre-run gate.** Run as the session's subagent, before any run directory exists, emitting the `plan-verdict` shape that `variantFor('gate', …)` builds: `{schema_version, verdict, settings{model, effort}, in_scope[], scope_creep[]{item, defer_to, why, justified_pull_forward}, premature_decision[]{decision, trigger, why}, missing[], defective[]{item, why, source}, not_checked[]}`. `missing` is gate work the plan does not cover; `defective` is an item present but wrong (a list with no authority, a change its consumer refuses). `settings` is the model and effort the caller pinned, given in the brief and checked against the pin by the caller with `scripts/check-plan-verdict.mjs` (exit 1 on a mismatch, and the round is not accepted); it checks `spawned_with`, the model, effort and backend-reported models `scripts/spawn-subagent.mjs` writes into the verdict, not the echoed `settings` (`.claude/requests/two-ledger-mediums.md`). A non-`PASS` aborts before `new-run.mjs`. Absent ⇒ `run.json.plan_review = "deferred"`. |
| `version-gate/SKILL.md` | Consumes `gate.json`, which is the stable machine-readable surface: per-node `{node_id, state, verdict, findings_count, report_path, report_sha256, evidence_dir}` plus `stamps[]` and `gate`, and `reviewer_overrides` — `[{name, roles, fields, prefixes}]`, one per built-in the run's frozen contract overrides, `[]` when none; a fact for the reader, never a stamp or a ceiling (ARCHITECTURE.md A-26). |

| `remediation/PROMPT.md` | The remediation node, spawned only by `scripts/remediate.mjs` in a remediation run. Emits the `remediation` variant: per group in its work list (every confirmed group, or the groups a scoped run names; never a group the operator deferred) `{group_id, disposition, reason, red_evidence, green_evidence, no_red, stop_reason, limit_kind, stop_cause, cluster, files, search_command, search_sites[], not_in_class[{site, reason}], unmatched_spellings[], deferred[]}` — `no_red` on every group, why a fix has no possible red, `null` otherwise (an empty `red_evidence` needs it, `shared/remediation.md`); `stop_reason` (`not-attempted`, `blocked`, `limit`), `limit_kind` (`session-time`, `turns`, `budget`) and `stop_cause` on every group, `null` where they do not apply; `scripts/remediate.mjs`'s report check (`stopReasonChecks`, `scripts/lib/remediation-chain.mjs`) names a `not-fixed` or `partial` group with no `stop_reason`, a `partial` one claiming `not-attempted`, a `blocked` one with no `stop_cause`, a `limit` with no `limit_kind`, a `limit` the node's own record contradicts, and a field set where it does not apply: a `fixed` or `declined` group with a `stop_reason`, a `limit_kind` without `limit`, a `stop_cause` without `blocked` (`REPORT-CHECK`); the census fields defined once as `CENSUS_FIELDS` in `scripts/lib/census.mjs`, with their item shapes; `reason`, each census string and each `not_in_class` site and reason non-empty — written to `evidence/remediation/payload.json`. The follow-up review finds the remediation by the `run_id` of its `follows_remediation` link, copies that payload into its own run as `evidence/remediation-census/payload.json`, and names the copy, with each group's census counts, in every lens brief. An external arm, which may not read the run directory, is given a second copy in the arms' directory at `.quorate-arm/remediation-census.json`, and its prompt names that one; the copy is a context input (ARCHITECTURE.md A-30), so when the run's copy is refused no second copy is written, the arms still start, the cause is named in the gate's not-checked list, and each arm's prompt names the census as left out, with that cause, in place of the copy's location (`prompts/_templates/arm-census-left-out.md`). It does not commit: `scripts/remediate.mjs` commits each cluster after it exits. **A repair pass** (`remediation-repair-pass.plan.md`): when the runner's full check refuses the candidate on failing tests alone (no other check refusing), the same node is spawned again, fresh, as `remediation-repair-<n>`, given every failing test with its file and the check's log (`prompts/_templates/remediation-repair-brief.md`), and answers in the `remediation-repair` schema: `run_id`, `pass`, `failures[]` (`test_name`, `test_file`, `disposition` `fixed` or `not-fixed`, `reason`, `cluster`, `files`, `green_evidence`) and `summary`, read by `repairReportErrors` (`scripts/lib/remediation-chain.mjs`). |
| `scripts/new-run.mjs` (adapter validation) | On every mint, with the panel on or off and before the reviewer preflight, every adapter in the merged table — each built-in in `reviewers.json` and each contract declaration as merged with its built-in — is checked by `adapterErrors` (`scripts/lib/reviewers.mjs`), with the contract's declared credential names. Any error refuses the mint (exit 2), listing each, so a malformed built-in refuses a run whose panel is off. |
| `scripts/new-run.mjs` (the reviewer preflight) | With `review.external_panel: true`, after `--dry-run` and before the run directory exists, runs `external-review.mjs --preflight-only` from the repository root for each distinct combination of the roster's `panel_arms` (review mode) and `adjudicators` (tie-break mode), up to `review.concurrency` at once, each bounded, from that adapter's limits, by its worst case: its version command, a wait on another check's probe (one probe child plus the margin), its own probe child (version + probe + margin) and the margin — `version + 2 × (version + 60 × probe + margin) + 2 × margin`, in seconds of `version_timeout_seconds`, `probe_timeout_minutes` and `check_margin_seconds`. Any failure refuses the mint (exit 2), naming each failed combination: exit 5 with the probe's reason, exit 2 with the child's usage message, any other exit or a crash with its exit, and an overrun with its bound. What passed is recorded as `run.json.reviewer_preflight: [{probe_record, adapter, model, effort, mode, route, state, checked_at}]` (`probe_record` is the record file's key under the engine's home; named so a secret scan does not read the hash as a credential); null with the panel off. A failed combination whose reviewer the contract overrides carries `[override: …]` beside its label. `--no-verify-reviewers` skips the check, records `"skipped"` and stamps `REVIEWERS-UNVERIFIED` (capping); `remediate.mjs` passes it to the follow-up mint. A declared reviewer is validated as merged with its built-in, as external-review runs it. |
| `scripts/new-run.mjs` (every mint) | Before it spawns anything, panel on or off, prints one stderr line per built-in the contract overrides (`new-run: <overrideLine>`; ARCHITECTURE.md A-26). A sandbox-canary refusal under an overridden node runtime names the override too. |
| `scripts/new-run.mjs --remediates <review dir>` | Mints a remediation run: `run.json` records `remediates: <run id>` and `remediation_frame` (the reviewed run's base, base and head commits, scope, request and `reconciled.md` path), scoped to the reviewed paths, and writes `remediate-settings.json` (edits scoped to `source_globs` and `test_globs` by relative rules; no commit path: the node reports each group's `cluster` and `files`, and `remediate.mjs` commits). Refuses a run with no `reconciled.md`, no gate, or no readable `evidence/reconcile/payload.json` with a groups list (the confirmed groups and severities the runner commits by), and a remediation run. Both `--remediates` and `--follows-remediation` admit their directory through `admitRun` (`scripts/lib/reviews-root.mjs`, ARCHITECTURE A-28) before any field of it is read or anything is written: refused when it is not inside the repository or the engine's home or leaves one through a link, is not the run its `run.json` names, is not among this repository's own run roots by its contract, or names another tree as its `repo_root` — another repository's run under the shared home is no frame for this one; `--follows-remediation` also requires a remediation run. `--groups <G-n,...> --operator-quote "<words>"` scopes it to confirmed groups the operator chose: `remediation_frame` then also records `groups` (in the given order), `deferred` (the review's other confirmed groups) and `scope_quote`; an unknown, unconfirmed or repeated id, an empty list, `--groups` without `--remediates` or without a non-empty quote, and a quote without `--groups` are refused. `--follows-remediation <remediation dir>` marks a review as the follow-up a remediation minted (`run.json.follows_remediation`); `remediate.mjs` passes it. |
| `scripts/remediate.mjs` | Runs a remediation run. Its `--run-dir` is admitted through `admitRun` for the repository `--repo-root` names, or else git's toplevel of where it runs, and it locks, commits in and spawns its node in that repository, never the one the run's `repo_root` names (ARCHITECTURE A-28). It stops at the round cap (`ROUND-CAP`; `shared/remediation.md`), stamps `CHAIN-BROKEN`, spawns the node, then commits each admitted cluster (every group in it passes `commitRefusal`, and none shares a file or cluster with a group that does not), one commit per cluster, after checking its files against `git status` and the contract's globs. **A repair pass** (`remediation-repair-pass.plan.md`): when the full check below refuses the candidate on failing tests alone (no other check refusing), the node is spawned again, fresh, as `remediation-repair-<n>`, with every failing test and its file read from the check's log (`failingTestsWithFiles`, `scripts/lib/full-check.mjs`); its report is read by `repairReportErrors`, which refuses an answer whose `test_file` differs from the file the log named, and each fixed test's green (`repairGreenErrors`) must be a passing `test_one` capture of the file the log named for that test (the answer's `test_file` only where the log named none, and then required), named `evidence/remediation/repair<n>-…` for this pass, with no `..` segment, and every file the pass changed (by git's answer and content before and after it) must be listed in an answer and admitted by the planner's own file rule (`clusterFileRule`, `repairFileAdmission`): a file a cluster holds stays there, a new one joins the cluster its answer names and is recorded in that cluster's `repair_added`. Then the widened candidate is checked again. A pass whose node did not finish `OK`, whose report or files cannot be admitted, or that changed or fixed nothing ends the passes, its edits left in the tree and the refusal standing. How many passes is the roster's remediation entry `repair_passes` (`repairPassCap`: a whole number, 0 for none, absent 3, the operator's RP-D2). `--measure-only`, the bench's stop (`scripts/bench-repair-pass.mjs`), records the full check and any pass and exits 0 before any commit, archive or follow-up mint. `--replay-node <dir>` (only with `--measure-only` and never with `--retry-commits`, refused otherwise before the lock; `repair-bench-replay.plan.md`) installs a recorded first node in place of spawning one: `<dir>` must be a directory, not a link or junction (the confined-path owner refuses either at its root), `<dir>/replay.json` must name this `--run-dir` and `--repo-root` and a candidate, and `<dir>` must hold the case's `payload.json` and `status.json`, else it is refused before the lock; its `evidence/` files are copied into `evidence/remediation/`, the status into `nodes/remediation.status.json` and the report into `evidence/remediation/payload.json` (both renamed to this run), the candidate's blobs written into the repository, and the run goes on as after a node that exited 0. Each pass is recorded in `repair_passes: [{pass, node_id, started_at, ended_at, failing, brief, report, node_exit, node_state, changed, added?, outcome, why?, full_check?}]`, `outcome` `green`, `still-red` or `refused`; a pass refused before its node was spawned records `node_exit` and `node_state` null and `changed` empty, and one refused because git could not be read after it, `changed` null. **Before the node is spawned** it refuses, naming them — commit or stash first — a working tree whose source, test or check-input files (`review.preflight_inputs` and the contract source; with none declared, every tracked change and any root-level dependency manifest, tracked or not) have already changed, and a changed framework mounted inside the repository as a repository of its own. **Before the first commit** it checks the whole commit candidate (every committable cluster's files) in place (`remediation-verification.plan.md`): the same guard with those files allowed (comparing paths by the repository's case rule, `pathKey` keyed by `core.ignorecase`), then the checked state recorded in `full_checks` (HEAD; each file's hash or `absent` in `checked-files.json` beside that check's output, cited as `files_at`, never in run.json, where a hash keyed by a file name such as `*-auth.test.mjs` reads as a credential to the secret scan once the run is archived), then every declared pre-flight command run through `capture` into `evidence/remediation-runner/` under `check_timeout_minutes`, in the candidate checks' own environment (`candidateCheckEnv`; an allow-list, and what crosses is the `review.candidate_env` entry's; `shared/remediation.md` states its residuals), at `GRAPH_NODE_DEPTH` 1. `build`, `test`, `lint` and `typecheck` refuse: lint and typecheck refuse here while they only stamp a review. `audit`, `deny` and `fmt_check` are recorded in `full_checks` (`fmt_check` stamps `FMT-DIRTY`), except that `fmt_check` refuses when it passed on the tree before the node ran and fails on the candidate: the runner runs it once before spawning the node and records `fmt_baseline` on the run, which `--retry-commits` judges against too (`remediation-fmt-check-baseline.md`). Every result, and the baseline, carries its `outcome` (`passed`, `failed`, `timed-out`, `incomplete`, `could-not-start`; `checkOutcome` in `scripts/lib/capture-header.mjs`, `check-outcomes.plan.md`), and the rule is read over outcomes: the format advice only for a `passed` baseline and a `failed` candidate; an `fmt_check` that did not run to its own end, and does not refuse, is recorded in `full_checks` under `unfinished` and stamps nothing, so `FMT-DIRTY` keeps one meaning — the formatter ran and failed. A `test` with failing tests, or with no readable count and a non-zero exit, refuses; one that exits 0 with no readable count commits and is recorded uncounted in `full_checks`; a non-zero exit with none failing commits only as a counted-facts drift alone (`QUORATE_FACTS_FILE`, fresh per check), and the update to make is printed. Before each cluster's `git add` the guard, the hashes of the files still to commit and HEAD (advanced only by this invocation's commits) are re-checked; after each commit the committed blobs are compared with the checked hashes. It records in `run.json`: `dirty_at_start: {files, refused}`, plus `untracked` (what had changed before it began that the checks do not read — never committed by the runner; a refusal is `{path, reason}`); `clusters: [{id, merged_from, groups, accepted, refused, notes, commit, reason?, output?, pending_retry?, fmt_turned_red?, unrecorded?, attempting?, readmitted?, seq}]` (`commit` the sha, or null with a `reason`; `output` as on `commit_check`; `readmitted: true` on a cluster `--readmit-evidence` planned); `remediation_commits`, the runner's commits; and `commit_check: [{cluster, kind, message, output?, group?, groups?, reason?, disposition?, blocked_by?, file?, deferred?}]` (`output`: the evidence file holding a rejected commit's raw output, which run.json never carries; `groups`: on a `readmitted` entry, the group ids re-admitted), naming what it would not or could not commit — `kind` is `stray-commit`, `node-failed` (the node did not exit 0 or did not finish `OK`), `report-mismatch` (no report, or one naming another run), `confirmed-unknown`, `unconfirmed-group` (a group the review did not confirm; a reported `symptom` whose `root_cause_group`, followed through any symptoms, is confirmed is judged as its root — deferred with it, and committed only with it: refused as unconfirmed when the root is not reported, and as sharing with a refused group when the root is refused), `deferred-group` (a group a scoped run's operator deferred, reported anyway), `not-committable` (a confirmed group reported `not-fixed`, `declined`, or `partial` with no files), `evidence-refused` (a fixed or partial group whose red-before-green is not on disk: its red must be a `test_one` capture whose outcome is `failed` (it ran and exited non-zero: not timed out, stopped, or unable to start; `checkOutcome`, `check-outcomes.plan.md`), its green a later `test_one` capture of the same file that exited 0 — or several, `;`-separated, every one a later passing `test_one` capture and one of them of the red's file; a fix pinned in several test files may list a red for each the same way, every one checked as the one red is, and each red followed by a later green of its own file; that each changed test file has a green is not checked, only every green listed — each red's file, and so the green answering it, a test file the group commits; a further green of another file must pass after the red but need not be committed (operator, 2026-11-03) — read from capture's header; a group with no red passes this gate, and whether it commits is its cluster's rule, under refused-cluster below; a symptom planned with its root is judged on its root's red and green, which may cite a test only the root's group commits), `shared-with-refused` (a group sharing a file or cluster with any reported group that may not be committed — unconfirmed, deferred or not committable, by the one rule `commitEligible` — or a symptom whose root is refused, `blocked_by` that root: refusal spreads, at admission; after it, a symptom is planned in its root's cluster, so a later refusal of either refuses both), `deferred-file` (a file a planned group reports that also holds a finding the operator deferred, from the reviewed run's `finding-groups.json`, noted at admission before any commit), `deferred-file-unchecked` (a scoped run whose reviewed `finding-groups.json` could not be read, so that note could not be made), `left-in-tree` (a path `git status` lists after the node that it did not list in `dirty_at_start`, and that no planned cluster accepts: left in the working tree, `file` naming it, and printed; `remediation-left-in-tree.md`), `readmitted` (groups the evidence gate refused on the first run and admits now, planned by `--retry-commits --readmit-evidence`), `set-aside-unrestored` (the bytes of a refused cluster set aside for the full check could not be written back, or hash differently or carry another mode after writing, or the path changed since it was set aside or is now a link, a directory or unreadable: the run stops with the copies kept, and running the same command again writes them back), `merged`, `refused-file`, `refused-cluster` (a planned cluster that is not committable: a refused file, no source file unless every group in it was reported against a test file (the reviewed run's `finding-groups.json`), a reported test not found, or a group with no red, no `no_red` declaration and no root's red to show it, with a test file or without — "red-before-green skipped", `.claude/requests/two-ledger-mediums.md`, `remediation-evidence-rules.plan.md` — or, on `--retry-commits`, a re-plan that no longer matches the record), `committed-without-test`, `declared-no-red` (a committed group the node declared has no possible red, with its `no_red` reason in `reason`, for the follow-up review to judge; recorded, not stamped), `hook-rejected`, `reset-failed`, `commit-unrecorded` (the commit landed but its sha could not be read: recorded `unrecorded` and saved, never retried, its raw output in the runner's log; the run stops with exit 1 and prints how to find the sha and mint the follow-up by hand, and no follow-up is minted for it on any later invocation), `full-run-red` (the runner's check of the commit candidate, every declared pre-flight command run in the working tree before the first commit, refused it: `build`, `test`, `lint` or `typecheck` failed or timed out, or `fmt_check` failed where it passed in `fmt_baseline`; recorded on every planned cluster, retryable) `tree-not-candidate` (the working tree held, in what those checks read, changes no planned commit carries — or, re-checked before each cluster's `git add`, a file still to be committed no longer hashes as checked, or HEAD moved by a commit this invocation did not make — or the check passed but `git reset` could not unmark the candidate's new files, which it marks intent-to-add for the checks and unmarks after, so the index still holds them: the message names them and prints no command to paste, only `--retry-commits`, which counts a file already intent-to-add as new and unmarks it again after its check; retryable) or `committed-differs` (the commit landed, but a committed file differs from what was checked, as when a pre-commit hook rewrites it, or its committed state could not be read, so it is unverified rather than shown to match; named, not retried), or `set-aside-kept` (a cluster ruled not committable that could not be set aside for the full check: a link, a directory, an unreadable path (one the working tree's owner or git's `ls-tree` or `hash-object` could not read), a deletion, a mode-only change or a refused file among its files; its edits stay and may block the others), and `cluster` is null for every kind listed before `merged`. A REFUSED CLUSTER IS SET ASIDE (remediation-cluster-order.plan.md): before the one full check, on a first run and on `--retry-commits`, the accepted files of every planned cluster ruled not committable, except one `set-aside-kept` names, are copied, with a manifest of their hashes and HEAD's blob of each (`head_blob`, null for a new file), under `evidence/remediation-runner/set-aside-<n>/` (`<n>` the first free number within the same bound as the runner's logs; past it the run stops naming the run directory, and nothing is put back), and their paths put back to HEAD (a new file removed), each hashed against `head_blob` (or found absent) before the check runs. `run.json` names the folder in `set_aside_dir`, and `set_aside_count` the last `<n>` used, before the first copy is made, so a run killed while copying leaves a record whose write-back removes the partial copies, and no `<n>` is reused; it records `set_aside: [{ cluster, path, kind, sha256, head_blob, mode, restored }]` once the manifest is written, `mode` being the file's permission bits when it was set aside. After the commits, and before any exit the run takes after the set-aside, the bytes are written back with that mode, only over a path still at `head_blob` with HEAD's mode (or still absent), or over the exact bytes an earlier write-back of it left when its hash check failed, which that write-back records on the entry as `written_sha256`, with the mode it left as `written_mode` when it read one; each hash, and each recorded mode, is verified, before the put-back and after the write-back. WHAT IS AT A SET-ASIDE PATH is read in one place, through the working tree's confined owner, which refuses a link or junction at any level (set-aside-identity.plan.md): the copy, the put-back check, the recovery check and the write-back all ask it, so a path below a link is never set aside, and a set-aside path that has become a link, a directory or unreadable is never read as restored or written through. A path changed since it was set aside, its mode included where git reports modes (a chmod-only change is seen only with `core.fileMode` true, as `git status` sees it), or one that is now a link, a directory or unreadable, is `set-aside-unrestored`: every other entry is written back first, and its copy removed; the named entries' copies and the manifest are kept, and the run stops. The next write-back leaves an entry recorded `restored` alone, whatever its path now holds: its copy is gone and the path is the operator's again. A manifest that is present but cannot be read writes nothing back and removes nothing. With every entry written back, the copies are removed (a removal that fails is printed). The record 85f45c55 wrote, `set_aside: { dir, entries }`, is still read, by the same one reader as the current shape, so a run it left is recovered; an entry with no `head_blob`, from a manifest written before it existed, is held to the blob HEAD holds now, with HEAD's mode, since a path at that blob is one git can give back, and any other state of its path is `set-aside-unrestored` like any other. A partial folder whose removal fails is `set-aside-unrestored` too, its record kept so the next run removes it. A set-aside file with more than one hard link is set aside like any other, and its path and link count are printed and recorded in its `run.json` entry (`links`); the write-back replaces that path and leaves the other names as they are. Each refused file is read as it is copied aside, and that read must match the state that classified it, and read again just before its put-back, for the guard that it still holds the bytes copied, so at most one file's bytes are held at a time by what the runner keeps; after the copies one more batched `git hash-object --stdin-paths` over the same paths is compared path by path with the classification's, and a blob that changed, even at the same size and time, dies before anything is put back. An edit outside every planned cluster is never set aside and still refuses the candidate. A run killed with files set aside is written back by the next invocation on it, before it plans anything. Which kinds stamp `COMMIT-CHECK` is the stamp table's (`shared/disk-first-protocol.md` §7). The vocabulary's one owner is `COMMIT_CHECK_KINDS` in `scripts/lib/remediation-chain.mjs`. The node is given the repository, and this run and the reviewed run when they are staged outside it, as `--add-dir` directories, so a run under the engine's home is readable. When nothing was committed, it mints nothing and exits 0 only if the report was received and neither `REPORT-CHECK` nor `COMMIT-CHECK` stamped; otherwise it exits 1. `--commit-trailer "<Key: value>"`, repeatable, adds that line as a git trailer to every cluster commit (one line shaped `Key: value`, else refused before anything runs), recorded as `commit_trailers` (a retry adds its own, and its commits carry the first run's and its own): the remedy a consumer's hook may name. `--retry-commits`, on a run already run, re-attempts, without spawning the node, the clusters still pending: those git, a hook or the runner's check refused (`hook-rejected`, `reset-failed`, `full-run-red`, `tree-not-candidate`), and those never attempted because a run was killed mid-loop: the re-plan must hold exactly the cluster's recorded `groups` — a group the evidence gate or its disposition no longer admits on the re-read is refused even when every path is unchanged — and accept exactly its recorded `accepted` files, each still a change git lists and not one changed before the remediation began (the one comparison is `retryMismatch`, `scripts/lib/remediation-chain.mjs`), else the cluster is `refused-cluster`, and stays pending while any of its recorded files is still changed; the files are committed as they are in the working tree at that moment, and the attempt is recorded in `commit_retries: [{at, trailers, clusters: [{id, commit, reason?, resolved_from?}]}]` (`resolved_from: "git log"` when a commit that landed before its save was found there). With `--repair` (only with `--retry-commits`, refused otherwise before anything runs), a full check that refuses the retried candidate on failing tests alone gives the node its repair pass first, as a first run does, the files it admits joining both the re-plan and the recorded cluster; without it a retry spawns nothing. With `--readmit-evidence` (operator, 2026-11-03), a retry of a run that committed nothing and planned no cluster first judges the groups its first run recorded `evidence-refused` by the evidence gate as it stands, and plans those it now admits as the first run would have, recorded `readmitted`; the retry then goes on as for any pending cluster, and is refused when the gate still refuses every one. **What a retry trusts** (`.claude/requests/grounding-and-retry-evidence.plan.md` stage 2; operator, 2026-11-03): the first run's evidence gate records `evidence_record: {payload, captures: {<path>: <sha256 | absent>}, repair_captures?: {<path>: <sha256 | absent>}}` in `run.json`, the hash of the node's report and of every capture a group cites as it read them, and, once a repair pass is admitted, of each of its greens (`repair_captures`, absent when no pass was admitted; present and not an object, the record is refused as corrupted); `--retry-commits`, with `--readmit-evidence` or without, refuses before it plans when the report, a cited capture or a recorded repair green differs from that record, is missing, or is cited now and was not then, and refuses a run with no record (`evidenceRecordDifference`, `scripts/lib/remediation-chain.mjs`). The edited source and test files are committed as found and checked by the full check. A retry re-plans a cluster's `repair_added` files with it, each by the same file rule, so a cluster a repair pass widened still matches its record. It refuses a run not yet run, and one with nothing to retry, nothing recovered and nothing unrecorded; a retry that only recovers a landed commit goes on to mint its follow-up, and one on an unrecorded run prints the manual follow-up command. A retry re-plans those clusters through `planClusterCommits`, from the node's saved report against git's answer at that moment, and a cluster still refused stays pending (`pending_retry`, from the kinds marked `retryable` in `COMMIT_CHECK_KINDS`): by git or a hook, by the runner's own full check (`full-run-red`), or by a tree that is not the candidate (`tree-not-candidate`). **No follow-up review is minted while any cluster is pending**: the run exits 1, prints each pending cluster with its recorded reason — and, when the cluster records `fmt_turned_red` (a `fmt_check` that ran and failed on the candidate after passing in `fmt_baseline`; not one that timed out or was not run), that its files must be formatted before the retry — and names the retry command, and to abandon a pending cluster, discard its edits and retry: it is recorded refused, and the follow-up is minted if any cluster was committed (with none, the run ends with nothing to review). Every planned cluster is saved before the first commit, numbered `seq` in the plan; each is saved `attempting` just before its commit, and the run is saved again after every commit attempt. The commit subject carries this run's id, the group ids and ` (cluster <seq>)` (a commit's only trailers are `Remediates:` and the operator's `--commit-trailer` lines), so a cluster left `attempting` by a run killed after its commit landed is resolved on the next invocation from `git log <remediation_start>..HEAD`: found, it is recorded committed; not found, it stays pending. A refused commit's raw output goes to the runner's log when that can be written; its record never waits on it. A `reset-failed` cluster's files stay staged. so a run killed mid-loop leaves its unattempted clusters pending for `--retry-commits`. A hook refusal leaves the cluster's changes unstaged in the working tree. Once nothing is pending and no commit is unrecorded the run has ended: it is archived (the same sequence as run-graph's, its `remediate.lock` left behind; where it goes, and when it stays, is `reviews_dir`'s rule above: a run a declared `reviews_dir` wrote is already in place), and then it mints the follow-up review (`followup_run_id`, `followup_run_dir`) from the archived run, without running it. An archive that is refused or fails mints no follow-up: the run stays staged, the reason is printed with the command to run again, and it exits 1. Never pushes. Its own files — a rejected commit's output, an earlier attempt's payload — go under `evidence/remediation-runner/` and are never overwritten; nothing it writes is under `evidence/remediation/`, the node's folder and the only place a fix's evidence is admitted from. One runner per run: `remediate.lock`, created exclusively before `run.json` is read, records its phase (`started`, `node-running`, `node-ran`, `checking` while the runner's check runs, `committing` while commits are made, `saved`, and `archiving` while `scripts/archive-run.mjs` holds it to archive a run left staged); a second invocation finding it refuses with exit 6 and changes nothing; an orderly exit releases it, and a release that fails is named and exits 7; a lock KEPT because the node may have edited the working tree with no record (`node-running`, `node-ran`, or a kill) is never removed automatically — the operator inspects the tree, then deletes it. One remediation per repository: after the run lock, and before any other work, it takes a repository lock under the engine's home (`locks/<key>.lock`, keyed by git's common dir, so every linked worktree of one repository shares it; `scripts/io/repo-lock.mjs`) recording `{run_id, pid, host, started_at}`. Held by another remediation it refuses with exit 8 and changes nothing, naming the holder: a live runner on this host (run it after that one ends), a stale lock whose pid on this host is gone (check its run, then delete the lock file it names and run again), a holder on another host (whose liveness is never guessed, so never called stale), or a lock that cannot be read. An orderly exit releases it (a release that fails is named, and exits 7); kept with a kept run lock, the operator deletes both. |
| `scripts/capture.mjs --interactive` | Capture's second front end, for a session's own commands (`capture-interactive.plan.md`); **built and not adopted for this repository's session until the operator says so** (ROADMAP.md M2 item 7). `node scripts/capture.mjs --interactive --mode read-only\|run --evidence-dir <abs> --name <label> [--preview-lines <n>] [--quiet] [--strict] [--stdin-file <path>] [--timeout-minutes <n>] -- "<command string>"`, or `--mode read-only\|run --evidence-dir <abs> --name <label> --fetch stdout\|stderr\|combined\|status.json\|argv.json\|stderr.stage-<n>` to read a saved stream back. **`--mode` is always stated**: `read-only` applies the lens's allow-list unchanged (`scripts/lib/capture-admit.mjs`, to every stage and every inner command) and admits no redirection but `2>&1`; `run` admits any command the string parses to. `--evidence-dir` is absolute and is refused inside a git work tree unless git ignores it, for a capture and a `--fetch` alike; `--name` is used once. Writes `<label>/stdout`, `stderr`, `combined` (both, in arrival order), `argv.json` (every command's resolved argv, inner ones included) and `status.json`, each byte-exact; returns a preview of each stream's last lines, `review.capture_preview_lines` (absent = 120) or `--preview-lines`, masked by `lib/redact.mjs`, or with `--quiet` the status and sizes only. Exit: the pipeline's (pipefail by construction: the rightmost failure; 124 for the deadline, 127 for a stage that could not start, 2 for a refusal). **The string** is a POSIX subset parsed by the vendored unbash (`third_party/unbash`) and decided by `scripts/lib/command-subset.mjs`: a pipeline of simple commands, single and double quotes and backslash escapes, `<` `>` `>>` `2>` `2>>` `2>&1` (applied in order; `2>&1` before stdout's own `>` or `>>` is refused, since the runner cannot keep stderr on the original stdout), and `"$( )"` inside double quotes, each inner command run and captured first under `<label>/subst-<n>/` and a failing one failing the whole before anything after it runs; an inner command printing over 8 MiB fails the call (exit 1), since that is the most a `"$( )"` may substitute. Refused by name: `&&` `\|\|` `;` `&` `!`, compound commands, functions, assignments, backticks, unquoted `$( )`, `$VAR` and `$?`, globs, a leading `~`, `$'...'`, arithmetic, here-documents and here-strings, process substitution, `[[ ]]`, and any string the parser had to recover from. A stage stopped because its downstream exited is `terminated_by_downstream_exit`, not a failure, unless `--strict`. That reading has a known race, kept on purpose (G-18 of 20261117-013640-m2-9a-final; operator, 2026-11-17: "Keep the race, document it, decline (Recommended)"): a downstream that exits without reading (`true`, `head -n 0`) can close first, and an upstream that then fails on its own is sometimes read as stopped by it, so its failure is hidden. Windows has no SIGPIPE, and a producer there exits 1 by itself when its reader closes, so the two cannot be told apart without breaking every `producer | head`. `--strict` counts every non-zero exit and is the deterministic reading. **Inside the string a backslash is a POSIX escape**, so a Windows path is quoted or written with `/`. On Windows a `.cmd` or `.bat` runs through the shell with each argument quoted, and an argument, or the resolved path itself, holding `"`, `%` or `!` is refused. **Output is capped per stream** by `review.capture_max_mb` (absent = 1024 MB): output reaching it stops the command's tree and fails the call (exit 1) with `status.json`'s `status` `output_cap_reached`, each file holding exactly the bytes up to the cap (output exactly at the cap is kept whole, and stops it too); a stage the stop could not confirm ended is named in the report as possibly still running. A pipeline's stages each keep their stderr in `stderr.stage-<n>` as well, an empty file for a stage that wrote none, fetched by that name; a command not on PATH is a stage that could not start (127), not a refusal; and saved labels older than `review.session_record_retention_days` are pruned on the next capture, only labels this front end wrote, known by the `writer` mark in their `status.json` beside `schema_version` 1 and the label's own name (a directory without it is the caller's and is left). `commands.shell` never launches anything here; it is read only to split a declared command into the argv `--mode read-only` admits. The command runs without the node runtime's authentication variables, and `--interactive` is refused inside a graph node (`GRAPH_NODE_DEPTH` set), whose captures take `--run-dir`. It is not a privilege boundary: `--mode run` runs what the caller could type. |
| `scripts/archive-run.mjs` | `--run-dir <dir> [--repo-root <repository>]`: archives a run left staged, by the sequence run-graph and remediate.mjs use (`archiveStagedRun`, `scripts/io/reviews-root.mjs`). Refuses, leaving it where it is, a run that has not ended: a review with no `gate.json` (the refusal names every review it could read that cites the run as the source of its reused pre-flight or intent, `checks_reused_from` / `intent_reused_from`, and the run roots it searched, so the run is not deleted from under them; a run root or `run.json` it could not read, a link among them refused, is named too, as is a run root left out because its real path leads outside the repository or the engine's home (`repoRunRoots`' `dropped`), with the warning that another review may cite the run unseen), or a remediation holding `remediate.lock`, whose node has not run, with a cluster pending for `--retry-commits`, or with an unrecorded commit (`remediationNotEnded`) — asked before whether it is already in place, so an unfinished run is never reported in place. Refuses too a run `admitRun` does not admit for the repository `--repo-root` names, or else git's toplevel of where it runs (ARCHITECTURE A-28): one outside that repository and the engine's home, whose real name is not its `run_id`, in none of that repository's run roots (by its own contract), or whose `repo_root` names another tree. Exit 0 archived or already in place, 1 refused, 2 bad arguments. |

| `shared/external-reviewers.md` | Supplies the panel roster, the per-reviewer prompt template, and model policy. Where it and `CLAUDE.md` disagree on model policy, **the shared file wins**. |
| `scripts/external-review.mjs` | Review mode: `node scripts/external-review.mjs --run-dir <abs> --node-id panel-<r> --reviewer <name> --prompt-file <p> --schema <inline json>`; prints one verdict envelope and exits 0 — or 5 when the reviewer failed its preflight: before every call the combination (adapter, model, effort, mode, schema route, CLI version, host, and the probe's own code — `PROBE_CODE_FILES`; the key is owned by the `reviewer_probe_max_age_hours` entry above) needs a passing probe record younger than `review.reviewer_probe_max_age_hours`, and without one it is probed in an empty temporary directory; a failed probe refuses the call with the mode's unavailable envelope, reason `reviewer preflight failed for <adapter>/<model>/<effort>/<mode>/<route>: <reason>`, on stdout and to `--out`, and the reviewer is never called. `--preflight-only` runs that check alone and exits 0 or 5; it needs no `--prompt-file`, `--schema`, `--node-id` or `--run-dir`. Candidate mode adds `--mode propose` and prints `{schema_version, source, model, effort, candidates, not_checked}` without a verdict; claim-check mode (`--mode claim-check`, `.claude/requests/claim-check-cross-family.plan.md`) prints `{schema_version, source, result, model, effort, usage, duration_ms, not_checked, egress_basis}`, where `result` is the `{schema_version, claims, not_checked}` that `scripts/claim-check.mjs` applies its rules to, or `null` when the checker did not answer or answered a shape `resultShapeErrors` refuses, with `claim checker '<name>'` and the reason in `not_checked`; decide mode (`--mode decide`, `.claude/requests/autonomous-run.plan.md` stage 4), one seat of the decision panel, prints the same fields with `call`, where `result` is `{choice, reason, other_text?, change_of?, citations?, what_would_change}` (the seat's `rationale` recorded as `reason`; `citations` the evidence paths it cites, kept when non-empty, and `what_would_change` its answer to what would change its choice, both read by the record's grounding, ARCHITECTURE.md A-22), or `null` when the seat did not answer, reported no status, or answered a shape `seatAnswerOf` refuses (`scripts/lib/decision-panel.mjs`: what `seatResultErrors` refuses, and also a raw answer whose `citations` is missing or not a list, an empty list being an answer, or whose `what_would_change` is empty), with `decision seat '<name>'` and the reason in `not_checked`; tie-break mode, the one a judge is called in (`run-graph.mjs` spawns it on a disputed group), is `node scripts/external-review.mjs --run-dir <abs> --node-id <judge node> --reviewer <judge> [--model <m>] [--effort <e>] --mode tie-break --participants <position,position> --prompt-file <p> --timeout-minutes <n> --surface <arms' directory>`, needs no `--schema` (its schema is built in the script, the vote enum from `--participants`), starts the reviewer in the `--surface` directory, and prints `{schema_version, source, node_id, supports, confidence, rationale, not_checked}`, with `supports: null` when the judge named no position; when the contract overrides the built-in reviewer called, EVERY response (review, propose, tie-break, claim-check, and each mode's unavailable form) also carries `reviewer_override: {name, roles, fields, prefixes}` and one `external-review: <overrideLine>` line goes to stderr — not the `--preflight-only` success record, whose shape `run.json.reviewer_preflight` freezes (ARCHITECTURE.md A-26); a proposer reporting a status other than `ok` gets an empty `candidates` and what it did propose in `incomplete_candidates`. `--out <file>` also writes the response to a file, under these rules, each refused with its id: **OUT-1** it needs `--evidence-dir` or `--run-dir` (the sink); **OUT-2** it lies inside the sink; **OUT-3** its parent folder already exists — nothing is created to check it; **OUT-4** no link or junction stands at any level of its folder below the sink, whatever it leads to (ARCHITECTURE.md A-30); **OUT-5** inside a repository it is git-ignored; **OUT-6** it is created exclusively before the vendor is called, and an existing file, or one that cannot be created, is refused; **OUT-7** a reservation nothing was written to is removed at exit; **OUT-8** it is not `<sink>/evidence` and does not lie inside it, where the adapter writes its own files — decided on native real paths, case-folded on every filesystem. These rules are stated here and nowhere else. Both accept `--model` and `--effort`, which are **declared per arm in `scripts/lens-roster.json`, never defaulted in a script** — unset sends no flag and is named in `not_checked[]`. Timeout falls back to `review.node_timeout_minutes`' absent default, 30 minutes (the table under `review`). The adapter appends a mandatory `status`/`reason` field to the caller's schema so a reviewer can report failure inside the contract; `status != "ok"` is a soft failure and never a PASS. Both reviewers are driven through native enforced structured output (codex `--output-schema`/`--output-last-message`; agy `--json-schema` under `--input-format stream-json --output-format stream-json`, the answer read from the final NDJSON result event, `response.from: ndjson-result`), with schemas built by `scripts/lib/reviewer-schemas.mjs`. Proposal mode additionally takes `--candidate-fields a,b,c`; without it no strict schema can be built and the run falls back to prompt-and-scan, named in `not_checked[]`. The prompt reaches the reviewer by its adapter's `prompt.via` and the answer is read by its `response.from` (`shared/adapter-contract.md`, "How the prompt reaches the CLI"): only an `argv` reviewer is refused over the inline budget, and an `ndjson-result` reviewer whose final result reports a status other than `SUCCESS` gets the mode's unavailable envelope, the status named and its error left in `raw.log` (G-43). See `shared/external-reviewers.md`. |

Nothing is deferred any more. Every artifact the design names is installed.

## Enabling the external panel

When `review.external_panel` is `false` the run is stamped `PANEL-ABSENT` and `second-opinion` runs its single arm; when `true`, shadow arms run during the fan-out and the run is not stamped `PANEL-ABSENT`. (This repository's own contract sets it `true`.)
Turning it on is a privacy decision, not a configuration detail: `codex` and `agy` transmit
whatever prompt they are given to their own cloud providers. For a local-first product that rule
governs the shipped application rather than the development tooling, but source code still
leaves the machine, so the switch is deliberate and stays off until set.

To enable: set `review.external_panel: true` in `CLAUDE.md`. Every reviewer the roster names must be on `PATH`
and pass its preflight: one that is missing or fails its probe is refused before its call, and a run whose panel arms
or adjudicators fail is refused at mint (`new-run --no-verify-reviewers` skips that check and caps the run,
`REVIEWERS-UNVERIFIED`). `QUORATE_LIVE=1 node scripts/check-reviewers.mjs` shows the panel's state beforehand.

Two properties of an external arm that the reconciler depends on:

- Its findings carry `source: "codex"` / `"agy"`, so cross-arm agreement can be weighted above
  agreement between two Claude lenses, which share a model family and therefore share blind
  spots.
- Its `basis` and its ceilings are owned by `shared/external-reviewers.md`, which states them in
  full and explains what would lift them. **Read the owner for the values** (G-35; G-30 of
  20260925-200721-platform-remediated): even a one-line summary here is a second copy of a policy to
  keep in step, and this document has been caught holding a stale copy of a cap once.

---

## `review.effort` — the depth dial

`effort` sits next to `models` because it does the same kind of job: it changes cost and finding
quality on every node, so it needs **one place to move**, not a literal in a spawn call.

```yaml
review:
  models: { judgment: opus, mechanical: sonnet }
  effort: { judgment: xhigh }
```

Resolution is narrowest-first: an explicit call-site value, then an `effort` key on the lens's own
`lens-roster.json` entry, then `review.effort.judgment`. Omit the key and every judgment node
still runs at an explicit `high` — the flag is ALWAYS sent, because a run whose reasoning depth is
a property of the machine records `effort: null` and its findings stop being reproducible, the
attribution failure this system exists to prevent. The substitution is recorded on
`run.json.defaults_substituted`, so a defaulted configuration stays distinguishable from a
declared one.

Only `judgment` is read — every node the orchestrator spawns is a judgment node. A `mechanical`
counterpart is deliberately absent: config nothing consumes is the inert guarantee
`doc-consistency-review` exists to catch. Add it when a mechanical node exists to read it.

**Why `xhigh` was the default here.** HISTORICAL measurement (2026-08, story-pipeline era):
replaying `contract-audit` against a frozen intent, varying only effort, produced the table below.
**No current command regenerates it** — the seeded-defect benchmark (`bench/`) is the measured
record now, its results identify their own configuration, and varying effort is a roster edit
between invocations. The current measured setting is the contract's `review.effort.judgment`, and
the comment above that key in the contract records how it was measured; `lens-roster.json`'s
`$effort_note` records only the history, code-audit's earlier `medium` pin that the contract default
replaced. The
table stays as the provenance of the original default, not as a reproducible claim:

| effort | recall | cost | turns |
|---|---|---|---|
| `high` (old CLI default) | 7/9 | $1.79 | 21 |
| `xhigh` | 8/9 | **$1.65** | **14** |
| `max` | **9/9** | $1.98 | 24 |

`xhigh` is both cheaper and stronger than the default it replaced — it plans better and flails
less, so it reaches a better answer in fewer turns. Raise to `max` when recall matters more than
cost; the extra 1/9 costs about 20%.

## Supply-chain checks — the cheapest decorrelation available

`commands.audit` and `commands.deny` are declared like any other command, but they earn their
place for a different reason than the rest. Every lens in the graph is a language model, so a
blind spot shared by the model family is invisible to all of them at once. A CVE database and a
dependency graph share no failure mode with a model at all — which makes them stronger
decorrelation than a second model family, and unlike the external panel they cost nothing and
send nothing off the machine.

This is the same principle the evidence rule already encodes: `evidence_path` forces a claim to
rest on something no model produced. These two commands are that rule applied to the one class
of defect no lens can see by reading the diff — a vulnerability in code nobody in this
repository wrote.

**Both are `evidence`, never `barrier`.** An advisory published upstream overnight is a fact the
lenses should see, not a reason to refuse to review the change in front of them; unlike a broken
build it says nothing about whether the code under review is analysable. In the pre-push gate
they run **last** for the mirror-image reason: they are the one class of failure the commit
being pushed usually did not cause, so the developer sees every failure they *can* fix before
hitting one they cannot.

`cargo deny check licenses` is deliberately **not** included. It requires a declared license
policy in `deny.toml`, which is a decision this project has not made — and inventing one would
produce a check that passes by construction. The omission is recorded in `CLAUDE.md` next to the
command rather than hidden.

## Child environment and auth

Subscription credentials are stored **per user**, not per process — the keychain on macOS,
`~/.claude/.credentials.json` on Linux and Windows. A `claude -p` child running as the same user
with the same `HOME` therefore inherits them with no plumbing at all. The common case needs no
configuration; what needs handling is the two things that *break* that inheritance, and
`spawn-node.mjs` strips both rather than trusting the caller to have remembered.

| Variable | Why it is stripped | Mode |
|---|---|---|
| `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` | Set inside a Claude Code session. A child that inherits them looks like Claude Code launching inside Claude Code, and can refuse to start or hang. No graph node ever wants to be seen as a nested session. | **always** |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` | Outrank subscription auth. A stale or zero-balance key produces a `400` *after* the node has spent its turns — the worst failure shape available, since it costs money and yields nothing. | `--auth subscription` (default) |
| `CLAUDE_CODE_OAUTH_TOKEN` | **Never stripped.** It *is* subscription auth, in the form that survives a different user, a container, or a stripped environment (`claude setup-token`). | — |
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | **Set to `1`**, not stripped, whatever the parent had. Without it a Bash `cd` into an added directory becomes the child's working directory, and its write rules then refuse every edit under the repository (remediation 20261020-115946-ciss-remediation-4, Claude Code 2.1.304). | **always** |

`--auth inherit` keeps the ANTHROPIC credentials the default mode strips — it does **not** pass the
whole environment through (G-41). `scrubChildEnv` runs in both modes and removes the same
foreign secret-shaped variables either way; the only difference between them is the Anthropic auth
block in the table above. That matters to the CI case this setting exists for: a declared test
command that needs `AWS_*` or `DATABASE_URL` does not get them from a graph node, and the honest
place to give a child a credential it genuinely needs is the contract's own command, not an auth
mode. The document said "passes everything through" for months, which is the shape of promise this
project refuses everywhere else.

Both are recorded on every node's status file, in the form each node class warrants: lens
children carry `auth_mode` and `env_stripped` (every name removed: `scrubChildEnv`'s pattern-based
scrub of secret-shaped variables, such as `GITHUB_TOKEN`, `AWS_*` and `DATABASE_URL`, plus
`runtimeSessionEnv`'s removals: the parent session's markers, `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT`, in every mode,
and under the subscription mode the Anthropic API key and auth token), while panel arms carry `auth_mode: "external-vendor"` and `env_passed` — an
ALLOW-LIST's entire output, because for an arm handed to a third-party CLI the auditable fact is
what CROSSED the boundary, not which five names a deny-list knew about. Either way a run is
attributable to the credential path that produced it — the same reason `session_id` is recorded.

**Billing note:** non-interactive `claude -p` usage on a subscription draws from a separate Agent
SDK credit pool rather than interactive session limits. A fan-out that seems not to affect your
interactive usage is still spending; `gate.json.total_cost_usd` is the number to watch, and
`review.budget_usd_per_node` is the per-node stop. `review.budget_usd_per_barrier` is the reconciler's own stop — the barrier reads every lens at once and legitimately costs more than a lens; omit it and it defaults to `max(6, budget_usd_per_node * 2.5)`, which is a silent function of another key, so declare it explicitly. It also caps `reconcile-b` under `--reconcile-twice`, and its exhaustion returns BLOCKED even after every lens succeeded. On a batched barrier, reconcile's `total_cost_usd` is a charge, not a measured spend, so the total is an upper bound; the measured part is `total_cost_usd_known`. The batches share this one ceiling, and how each is granted and charged is owned by shared/disk-first-protocol.md, "Batched reconcile".

## Generated policy files

`new-run.mjs` writes two policy files into every run directory. They are generated, never
hand-written, and both pass the four validation gates before any node spawns.

| File | Used by | Read scope |
|---|---|---|
| `node-settings.json` | every lens, `reconcile`, `second-opinion` | `Read(//<repo-root>/**)` — the whole repo, but **not outside it**. A lens has no business reading a developer's home directory. |
| `intent-settings.json` | `intent-capture` only | No `Read` grant and no live directory: the node reads only its sandbox — its working directory and only `--add-dir` — which holds copies of the documents each `doc_paths` glob matches and those named under `doc_roles`, the request (its own frozen-hash copy), the doctrine, and `contract.snapshot.md` (`disk-first-protocol.md` §5 owns why). Every shell tool denied — `Bash` and `PowerShell` on this platform, or whatever the runtime's adapter lists under `node_runtime.tools.deny_intent` — and `Grep` denied, because Grep returns file content. |

A scoped rule and `--add-dir` are an **AND**, not alternatives: a rule grants nothing for a path the
directory sandbox does not reach (measured — see `disk-first-protocol.md` §5). That is why top-level
declared documents are copied into the intent sandbox rather than granted where they live.

**Never replace a scoped Read rule with a bare `Read`.** A bare tool rule carries no path
restriction and overrides the `--add-dir` sandbox entirely — verified empirically, with no
denial recorded to indicate anything had gone wrong. The allow-list is the sandbox; `--add-dir`
only narrows what the allow-list already permits.

**Six top-level tool denials** are mirrored onto the command line as `--disallowedTools` — Edit,
Write, NotebookEdit, WebFetch, WebSearch, Task, plus Bash, PowerShell and Grep for an intent node —
for a separate reason: a settings file that fails validation is **silently ignored** in `-p` mode,
whereas a flag cannot be silently dropped. If the file is ignored, the node loses its allow-list and
fails loudly rather than quietly running unsandboxed.

The GRANULAR rules are not mirrored, and cannot be: `--disallowedTools` takes tool names, not the
`Bash(rm:*)` / `PowerShell(Remove-Item:*)` forms the settings file uses (G-42). This document said
the deny list was duplicated, which describes a defence in depth that is one layer thinner than
claimed — what the flag actually guarantees is that a node with a dropped settings file cannot
Edit, Write, fetch, search or spawn, and that an intent node additionally cannot reach a shell or
Grep. The granular rules are not redundant: the allow-list is not closed. An unlisted command the
runtime treats as read-only runs, and only a deny rule refuses regardless (measured, `disk-first-protocol.md`
§8). So the granular rules are the ones that bind, in the settings file, and a dropped settings file
loses them.

## Parser limits

`new-run.mjs` implements a strict subset of YAML, on purpose: a contract that parses into
something unintended is worse than one that refuses to parse.

Supported: nested block maps, flow sequences `["a","b"]`, flow maps `{a: b}`, quoted and
unquoted scalars, integers, floats, booleans, folded (`>`) and literal (`|`) block scalars, and
`#` comments.

**Not supported:** block sequences (`- item`). Use the flow form. Anchors, aliases, multiple
documents, and tags are also unsupported and are errors rather than silent omissions.
