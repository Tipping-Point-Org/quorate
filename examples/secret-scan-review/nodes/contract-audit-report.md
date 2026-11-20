# contract-audit — RISK

| | |
|---|---|
| Run | `20261119-051632-m2-9c-secret-scan` |
| Node | `contract-audit` (`lens`, model `opus`) |
| State | `OK` |
| Scope | human-asserted: `.gitleaksignore`, `CLAUDE.md`, `README.md`, `publish/CLAUDE.public.md`, `publish/manifest.json`, `scripts/lib/publish.mjs`, `scripts/publish.mjs`, `tests/regression-argv-adoption.test.mjs`, `tests/regression-arms-surface-ars-r3.test.mjs`, `tests/regression-arms-surface-ars-r5.test.mjs`, `tests/regression-arms-surface-link-classes.test.mjs`, `tests/regression-ledger-review-ltr3-remediation.test.mjs`, `tests/regression-panel-runtime.test.mjs`, `tests/regression-publish.test.mjs`, `tests/regression-vendor-stderr-off-the-tracked-side.test.mjs` |
| Intent | `33e3ca0896d88decfdaa2929f9987a965cd0b36d5aee1d15eaf320b89bbbff7d` |
| Session | `8bfdfd23-ba61-4019-b7d5-32708a222905` — `claude --resume 8bfdfd23-ba61-4019-b7d5-32708a222905` to interrogate |
| Host | win32/x64, claude `2.1.326` |
| Cost | $0.8899 over 9 turns, 64126 ms |

## Findings (1)

### MEDIUM · intent · `scripts/publish.mjs:402`

I-6 says a failing check-secrets result blocks the commit. Here the published tree's check-secrets runs only after the commit is already made in --out (line 388). When it fails, the publish stops but leaves the commit in place and tells the operator to reset --soft it by hand. The scan's output goes to the terminal (stdio: 'inherit') and is never written as a record in --out. If scripts/check-secrets.mjs is missing, the publish only logs a line and goes on (line 400). So a failing or absent scan does not prevent a commit, and its result is not recorded.

Evidence: `evidence/contract-audit/check-secrets-after-commit.log`
Criterion: `I-6`

## Checked clean (4)

- I-5: validateManifest refuses any allowance whose pattern starts with gitleaks: (scripts/lib/publish.mjs:98), and tests/regression-publish.test.mjs:309 asserts that refusal
- I-5: .gitleaksignore holds 13 lines beginning with the 2a669ba0 fingerprint prefix
- I-6: the scan that runs is the snapshot's own scripts/check-secrets.mjs (path.join(out,...)), not the private tree's; a test covers both the failing and the passing stand-in
- I-11: the gitleaks-allowance refusal has a test (regression-publish.test.mjs:301-320)

## Not checked (11)

- **commands.lint** — empty in graph_contract — lint could not be run
- **commands.fmt_check** — empty in graph_contract — fmt_check could not be run
- **commands.typecheck** — empty in graph_contract — typecheck could not be run
- **commands.bench** — empty in graph_contract — bench could not be run
- **commands.run** — empty in graph_contract — run could not be run
- **commands.audit** — empty in graph_contract — audit could not be run
- **commands.deny** — empty in graph_contract — deny could not be run
- **commands.test_product** — empty in graph_contract — test_product could not be run
- **I-1, I-2, I-3, I-4, I-7, I-8, I-9, I-10** — low effort: the review focused on the 2026-11-19 amendment (I-5, I-6); these were judged in earlier runs and not re-traced
- **I-5: are the test fakes really built at runtime in every swept test, and is the 2a669ba0 fingerprint content right** — each fake literal was not inspected, and gitleaks was not run over the published history
- **brief-gap** — The brief did not point to the plan's 2026-11-19 amendment text. Without it, the exact meaning of 'output in --out' had to be inferred.

## Out of scope, observed (0)

_None._
