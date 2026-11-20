# security-audit — PASS

| | |
|---|---|
| Run | `20261119-051632-m2-9c-secret-scan` |
| Node | `security-audit` (`lens`, model `opus`) |
| State | `OK` |
| Scope | human-asserted: `.gitleaksignore`, `CLAUDE.md`, `README.md`, `publish/CLAUDE.public.md`, `publish/manifest.json`, `scripts/lib/publish.mjs`, `scripts/publish.mjs`, `tests/regression-argv-adoption.test.mjs`, `tests/regression-arms-surface-ars-r3.test.mjs`, `tests/regression-arms-surface-ars-r5.test.mjs`, `tests/regression-arms-surface-link-classes.test.mjs`, `tests/regression-ledger-review-ltr3-remediation.test.mjs`, `tests/regression-panel-runtime.test.mjs`, `tests/regression-publish.test.mjs`, `tests/regression-vendor-stderr-off-the-tracked-side.test.mjs` |
| Intent | not provided to this node |
| Session | `5967c9db-e9cf-4fca-a492-2f98c503e21f` — `claude --resume 5967c9db-e9cf-4fca-a492-2f98c503e21f` to interrogate |
| Host | win32/x64, claude `2.1.326` |
| Cost | $0.8087 over 5 turns, 42954 ms |

## Findings (0)

_None._

## Checked clean (5)

- scripts/publish.mjs:394-408 new public-CI secret scan spawns the published tree's check-secrets.mjs with childEnv (scrubChildEnv + commandEnvFor, line 240), so operator credentials are scrubbed from that child as from the gitleaks scan
- scripts/publish.mjs: a failing public scan calls stop() with a non-zero exit and tells the operator not to push; nothing is pushed by publish, and a missing check-secrets.mjs is reported, not silently passed
- scripts/publish.mjs:222-242 the snapshot scan still sets the shipped .gitleaksignore aside, so the new fingerprints for commit 2a669ba0 cannot silence a new finding in the snapshot itself
- scripts/lib/publish.mjs:98-103 validateManifest now refuses any gitleaks:<RuleID> allowance outright, narrowing what can be allowed (stricter, not looser)
- .gitleaksignore new entries are commit-scoped fingerprints (2a669ba0:file:rule:line) and cannot match the same text in any other commit

## Not checked (11)

- **commands.lint: empty in graph_contract — lint could not be run** — standing
- **commands.fmt_check: empty in graph_contract — fmt_check could not be run** — standing
- **commands.typecheck: empty in graph_contract — typecheck could not be run** — standing
- **commands.bench: empty in graph_contract — bench could not be run** — standing
- **commands.run: empty in graph_contract — run could not be run** — standing
- **commands.audit: empty in graph_contract — audit could not be run** — standing
- **commands.deny: empty in graph_contract — deny could not be run** — standing
- **commands.test_product: empty in graph_contract — test_product could not be run** — standing
- **test files in full_sweep_paths (runtime-built fakes)** — read only via the diff of the changed source files; did not verify each test still constrains its behaviour after the literals were replaced
- **no captures produced** — no finding required evidence; review was by reading the diff since base dd3a5156
- **brief-gap** — nothing material; a one-line note that changed_files are the security-relevant subset of full_sweep_paths would have saved scoping time

## Out of scope, observed (0)

_None._
