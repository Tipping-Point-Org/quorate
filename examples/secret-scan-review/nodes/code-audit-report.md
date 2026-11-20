# code-audit — PASS

| | |
|---|---|
| Run | `20261119-051632-m2-9c-secret-scan` |
| Node | `code-audit` (`lens`, model `opus`) |
| State | `OK` |
| Scope | human-asserted: `.gitleaksignore`, `CLAUDE.md`, `README.md`, `publish/CLAUDE.public.md`, `publish/manifest.json`, `scripts/lib/publish.mjs`, `scripts/publish.mjs`, `tests/regression-argv-adoption.test.mjs`, `tests/regression-arms-surface-ars-r3.test.mjs`, `tests/regression-arms-surface-ars-r5.test.mjs`, `tests/regression-arms-surface-link-classes.test.mjs`, `tests/regression-ledger-review-ltr3-remediation.test.mjs`, `tests/regression-panel-runtime.test.mjs`, `tests/regression-publish.test.mjs`, `tests/regression-vendor-stderr-off-the-tracked-side.test.mjs` |
| Intent | not provided to this node |
| Session | `d811aeb6-8c4f-490e-bf48-3ab330b028fc` — `claude --resume d811aeb6-8c4f-490e-bf48-3ab330b028fc` to interrogate |
| Host | win32/x64, claude `2.1.326` |
| Cost | $0.8539 over 9 turns, 63307 ms |

## Findings (0)

_None._

## Checked clean (5)

- scripts/lib/publish.mjs validateManifest: a gitleaks:* allowance is now refused before the manifest-pattern check, so the two error branches cannot both apply and no gitleaks pattern reaches the allow list
- scripts/publish.mjs:398-408: the public scan uses childEnv, which is defined at line 240 inside the same try block, and stop() throws a Refusal that the outer catch turns into exitCode=1, so a failing scan is not silent
- scripts/publish.mjs:404: a spawn failure (status null) is reported through cs.error?.code rather than printing 'exit null' with no cause
- scripts/publish.mjs:399-401: a missing check-secrets.mjs in --out is printed, not skipped silently
- publish/manifest.json: the removed entries are all gitleaks:* allowances, which validateManifest would now refuse; the JSON array stays well formed after the removal

## Not checked (12)

- **commands.lint** — commands.lint: empty in graph_contract — lint could not be run
- **commands.fmt_check** — commands.fmt_check: empty in graph_contract — fmt_check could not be run
- **commands.typecheck** — commands.typecheck: empty in graph_contract — typecheck could not be run
- **commands.bench** — commands.bench: empty in graph_contract — bench could not be run
- **commands.run** — commands.run: empty in graph_contract — run could not be run
- **commands.audit** — commands.audit: empty in graph_contract — audit could not be run
- **commands.deny** — commands.deny: empty in graph_contract — deny could not be run
- **commands.test_product** — commands.test_product: empty in graph_contract — test_product could not be run
- **tests/* in full_sweep_paths (the fakes built at runtime)** — I did not read the tests to confirm that each runtime-built fake still produces the shape its assertion needs; that is settled by running the suite, which this lens did not do
- **the reset --soft HEAD~1 recovery advice when --out holds only one commit** — I did not check whether --out can ever be a single-commit clone, where HEAD~1 does not exist
- **the rest of scripts/publish.mjs outside the diff hunks** — only the changed hunks and the definitions they depend on were read
- **brief-gap** — the brief was adequate; a diff summary of how the tests changed (literal fakes replaced by runtime construction) would have helped me target the test files

## Out of scope, observed (0)

_None._
