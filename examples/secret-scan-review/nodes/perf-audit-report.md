# perf-audit — RISK

| | |
|---|---|
| Run | `20261119-051632-m2-9c-secret-scan` |
| Node | `perf-audit` (`lens`, model `opus`) |
| State | `OK` |
| Scope | human-asserted: `.gitleaksignore`, `CLAUDE.md`, `README.md`, `publish/CLAUDE.public.md`, `publish/manifest.json`, `scripts/lib/publish.mjs`, `scripts/publish.mjs`, `tests/regression-argv-adoption.test.mjs`, `tests/regression-arms-surface-ars-r3.test.mjs`, `tests/regression-arms-surface-ars-r5.test.mjs`, `tests/regression-arms-surface-link-classes.test.mjs`, `tests/regression-ledger-review-ltr3-remediation.test.mjs`, `tests/regression-panel-runtime.test.mjs`, `tests/regression-publish.test.mjs`, `tests/regression-vendor-stderr-off-the-tracked-side.test.mjs` |
| Intent | not provided to this node |
| Session | `9ed4faa5-d7c0-4d73-a6f9-399c09b27f74` — `claude --resume 9ed4faa5-d7c0-4d73-a6f9-399c09b27f74` to interrogate |
| Host | win32/x64, claude `2.1.326` |
| Cost | $0.7161 over 4 turns, 36779 ms |

## Findings (0)

_None._

## Checked clean (4)

- scripts/publish.mjs ship/scan loops are linear in the shipped file count, which is a few thousand at most, and the tool is a release step run by hand
- scripts/lib/publish.mjs scanText runs each compiled pattern once per line, so its cost is linear in snapshot size
- scripts/publish.mjs:254 re-reads and splits a file for each gitleaks hit; the hit count is expected to be near zero, so this is a micro-cost and not a finding
- The manifest.json diff only removes entries, so it adds no work

## Not checked (10)

- **commands.bench** — empty in graph_contract; no measurement is possible, so every finding is static risk only
- **commands.lint** — empty in graph_contract — lint could not be run
- **commands.fmt_check** — empty in graph_contract — fmt_check could not be run
- **commands.typecheck** — empty in graph_contract — typecheck could not be run
- **commands.run** — empty in graph_contract — run could not be run
- **commands.audit** — empty in graph_contract — audit could not be run
- **commands.deny** — empty in graph_contract — deny could not be run
- **commands.test_product** — empty in graph_contract — test_product could not be run
- **test files in full_sweep_paths** — Tests are admissible only for vacuity or flakiness, and that is not a performance question. Not read in depth.
- **brief-gap** — The brief lists commands.bench twice. The scope is a one-shot release tool, where perf matters little. Expected run frequency and snapshot size would have helped.

## Out of scope, observed (0)

_None._
