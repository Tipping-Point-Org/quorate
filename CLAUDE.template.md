# <your-project-name>

<!--
  Minimal CLAUDE.md for a project using quorate. Copy this file to your repo root as CLAUDE.md
  (or merge these two pieces into your existing CLAUDE.md):

    1. the @import line below, which loads quorate's session instructions, and
    2. the graph_contract YAML block, which the engine parses from THIS file — it cannot live
       in an imported file, so it must be pasted here.

  Fill every key marked <...>. Leave a key "" when you genuinely do not have the thing — an
  empty key is honest (the check is skipped and NAMED in the run's not_checked[]); a key filled
  with a command that does not run is worse than empty. Each key's full meaning:
  .claude/skills/quorate/shared/claude-md-contract.md
-->

<One paragraph: what this project is. Keep your own project instructions here as usual.>

@.claude/skills/quorate/QUORATE.md

## Graph verification contract

Every command, path, budget and model below is read by quorate's engine. Nodes never discover
the environment — if it is not declared here, it is not checked, and the run says so.

```yaml
graph_contract_version: 6
project: <project-slug>              # [a-z0-9-]+
commands:                            # exact, runnable from YOUR repo root; "" = not available
  build:     "<e.g. npm run build>"  # "" caps every gate at RISK (UNBUILT) — declare something honest
  test:      "<e.g. npm test>"       # "" caps the gate at RISK (UNTESTED)
  test_product: ""                   # a second suite, if the repo has one; usually ""
  test_one:  ""                      # ONE test file, for a remediation node's red/green: e.g. "uv run pytest {file}"; "" = only claims not expressible as a test can be committed
  lint:      ""                      # e.g. "npx eslint ." — "" = skipped, named in not_checked[]
  fmt_check: ""                      # e.g. "npx prettier --check ."
  typecheck: ""                      # e.g. "npx tsc --noEmit"
  bench:     ""                      # "" makes perf-audit static-risk-only (RISK, findings LOW; a §6 invariant is never capped), run stamped UNBENCHED
  run:       ""                      # how to launch the app; "" skips feature-verify, named at the gate
  audit:     ""                      # e.g. "npm audit --audit-level=high"
  deny:      ""
  shell:     ""                      # "" = commands launch argv-split with no shell (safest; keep it)
source_globs:    ["src/**"]          # what counts as production code in this repo
test_globs:      ["test/**", "**/*.test.*"]   # WINS over source_globs for files matching both; a generated_globs file is neither
doc_paths:       ["docs/**", "README.md", "CLAUDE.md"]
generated_globs: [".claude/reviews/**", "node_modules/**", "dist/**"]
doc_roles:
  architecture: ""                   # path to YOUR architecture doc; "" degrades arch-review to
                                     # convention-only, its verdict capped at RISK except where a
                                     # §6 invariant finding drives it — honest if none exists
  roadmap:      ""
  spec:         ""
  request:      ""                   # path to the approved request the current work answers.
                                     # "" is not "no request": new-run first looks for a single
                                     # .claude/requests/*.md with `status: approved` and uses it,
                                     # stamping the run REQUEST-DISCOVERED. Only when nothing is
                                     # declared AND nothing is discovered does a run draft an
                                     # inferred request and cap contract-audit at RISK (a §6
                                     # invariant finding is never capped).
                                     # Fill it per piece of work, not once.
ui:
  surface: none                      # none | web | tauri-webview | desktop | cli | tui
                                     # ONLY `none` is load-bearing: it skips ui-audit. Every other
                                     # value is descriptive — nothing enforces the list, so an
                                     # unlisted word behaves exactly like the listed ones.
  static_bundle: ""
code_index: {}                       # the code index's extractors, one map per language (shared/code-index.md).
                                     # {} = declared with none; absent = the feature off. Add a language as
                                     #   python:
                                     #     extractor: "python .claude/skills/quorate/extractors/python/extract.py"
                                     #     globs: ["src/**/*.py"]
hooks:
  secret_scan: required              # required | off — the secret scan on every push and in CI.
                                     # ABSENT means required. Required and gitleaks not installed
                                     # BLOCKS the push: install gitleaks, or declare `off` deliberately.
threat_model: >
  <Two or three sentences: what this system touches that matters (credentials, user data,
  subprocesses, network), what is in scope for security-audit, and what is explicitly out.>
review:
  concurrency: 3                     # bounds EACH family: lenses and panel arms are two pools of
                                     # this width, so peak children is up to 2x it with the panel on
  node_timeout_minutes: 30           # absent = 30; a lens that reads every declared doc in full needs it
  barrier_timeout_minutes: 35        # the reconciler reads every lens AND every arm at once
  # WHAT THE PRE-FLIGHT CHECKS READ. The barrier is no longer re-run every review: the engine hashes
  # these files, compares them against the last result, and re-executes only when that result no
  # longer applies. A dirty worktree invalidates it too, independently of what moved.
  #
  # [] is legal and costs a ceiling: the set is then INFERRED from source_globs, test_globs, this
  # file and any root-level dependency manifest -- and a declared check can read a file none of those
  # name (`uv run pytest` after `uv.lock` moves is the clear case). A reuse under an inferred set is
  # stamped CHECKS-INPUTS-INFERRED and capped at RISK. Declare the globs to remove the ceiling.
  preflight_cache_max_mb: 256    # the pre-flight cache's size cap; "" = uncapped; least-recently-used is evicted
  code_index_cache_max_mb: 256   # the code index cache's size cap, under the engine's home; "" = uncapped
  code_index_timeout_minutes: 10 # the ceiling on each code index extractor call; "" is refused
  panel_snapshot_max_mb: 1024    # the arms' snapshot is refused past this many MB of changed and untracked files; "" = uncapped
  reviewer_probe_max_age_hours: 24   # a passing reviewer probe is repeated once older than this; "" = no age limit
  session_record_retention_days: 30  # days a session's records (stop record, command log) are kept; 0 or any string = no limit
  check_timeout_minutes: 10      # the ceiling on each pre-flight check, whole minutes; raise it if your slowest check runs longer; "" is refused
  preflight_inputs: []
  candidate_env: []               # names your suite needs when a remediation's fix is checked, beyond PATH/home/temp/locale: e.g. ["JAVA_HOME", "UV_*"]
  intent_timeout_minutes: 30         # intent-capture reads every declared doc IN FULL
  budget_usd_per_node: 4.00
  budget_usd_per_barrier: 7.00
  budget_usd_per_run: 32.00          # a full review stops spawning past this — size it to taste
  reviews_dir: ".claude/reviews"   # "" STAGES each run outside your repository and moves it back
                                   # here when it ends, so `git status` stays clean mid-review and
                                   # the finished run is still committed. That is the default.
                                   # Declared here instead, which writes runs straight in with no
                                   # staging: identical to the old behaviour, and kept explicit so
                                   # copying this template is a decision rather than an inheritance.
                                   # Empty it to stop runs appearing in `git status` while they run.
  models: { judgment: opus, mechanical: sonnet }
  effort: { judgment: xhigh }
  # runtime: claude                  # the node runtime, an adapter name; absent = the table's default_node_runtime
  external_panel: false              # true sends prompts to third-party clouds (codex/agy) —
                                     # read shared/external-reviewers.md before enabling, then
                                     # check it: QUORATE_LIVE=1 node .claude/skills/quorate/scripts/check-reviewers.mjs
  claim_check_transcript: same-family  # with the panel on, claim-check's cross-family checker never gets this
                                     # session's transcript; attributions are checked by a subagent of the session's own family.
                                     # cross-family sends the whole transcript (redacted) to that vendor too.
  decision_panel: off                # on: a question with options goes to Claude, Codex and agy, blind, by
                                     # majority, instead of to you; needs external_panel: true. Read
                                     # shared/claude-md-contract.md (decision_panel) before turning it on.
  decision_rounds: 3                 # the panel's talking rounds before its moderator is asked
  decision_rounds_max: 6             # the hard cap the moderator may extend the talk to
  run_spend_max: ""                  # spends a run may start on delegated answers; "" = no bound
  run_time_limit_hours: 72           # how long a run may last; "" = unlimited
  grounding_floor: measurement       # a panel decision grounded at or above this basis is settled by the panel;
                                     # below it, it comes to you (ARCHITECTURE.md A-22)
```

<!-- Validate the block after filling it:
       node .claude/skills/quorate/scripts/new-run.mjs --dry-run
     It resolves the contract, prints every command and its consequence, and spawns nothing.
     Alternatively, with no block present at all, asking Claude for /full-review prints a block
     pre-filled with what it detected in your repo. -->
