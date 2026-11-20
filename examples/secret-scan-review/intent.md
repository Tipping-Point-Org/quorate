# Intent

_Captured before any implementation was read. Frozen once the first lens launched._

## Criteria

### I-1

scripts/publish.mjs copies the tracked files of one commit, minus the exclusion list, into a staging directory. The list covers at least .claude/reviews/, .claude/requests/, the ledger, .claude/findings/, blog/sessions/ digests and anything machine-local. It is declared in publish/manifest.json and read by the script, never hardcoded. Source: plan stage 2; CLAUDE.md scripts row 'publish'.

**I/O contract:** In: a ref (master) plus publish/manifest.json exclusions. Out: a staging directory holding tracked files minus the excluded paths.

**Failure modes:**
- An excluded path reaches the snapshot: the fixture test must fail (red before green)
- An exclusion hardcoded in the script instead of the manifest
- Untracked or machine-local files reach the snapshot

### I-2

The publish runs gitleaks on the snapshot and scans it for machine-local paths (windows drive paths, posix home paths), the operator's identity (read from a gitignored local file), the private repository owner name, and placeholder markers. Each hit is named, and the publish refuses while any finding is unresolved. Source: plan stage 2, stage 3; CLAUDE.md publish row.

**I/O contract:** In: the staging directory and the manifest's patterns. Out: findings named by file, pattern and line; a non-zero refusal while any remain; the exact scan commands recorded for G3.

**Failure modes:**
- A planted secret passes the scan
- A planted local path or private owner name goes unnamed
- The scan instrument goes unrecorded

### I-3

Manifest allowances accept a hit only by file, pattern name and the text of the line it is on. A second hit of the same pattern in the same file needs its own allowance. A moved line keeps its allowance and an edited line loses it. Each allowance carries a reason. Source: plan stage 3, amended 2026-11-13 and 2026-11-16.

**I/O contract:** In: allow entries {file, pattern, line text, reason}. Out: only the exact matching hit is suppressed.

**Failure modes:**
- One allowance silences every hit of its pattern in a file (G-20 of 20261116-200635-m2-9a-high)
- An allowance without a reason is accepted

### I-4

An allowance that matches nothing refuses the publish, so the list cannot go stale. A placeholder marker or one of the operator's identity patterns can never be allowed. Source: plan stage 3, amendment 2026-11-13.

**I/O contract:** In: the allow list. Out: a refusal naming the stale allowance, or naming the disallowed pattern kind.

**Failure modes:**
- A stale allowance is silently ignored
- An identity or placeholder hit is suppressed by an allowance

### I-5

Amended 2026-11-19 (this run's subject): an allowance naming a gitleaks:<RuleID> pattern is refused. Fake secret values in tests are built at runtime, so the published tree carries no literal that gitleaks matches. The 13 fingerprints of published commit 2a669ba0 are in .gitleaksignore. Source: plan stage 3, amendment 2026-11-19.

**I/O contract:** In: a manifest containing a gitleaks:* allowance. Out: the publish refuses. In: the published tree scanned by the public CI with the shipped rules and .gitleaksignore. Out: clean.

**Failure modes:**
- A gitleaks allowance is still accepted, so a commit publishes clean locally but fails the public history scan (as 2a669ba0 did, on 13 allowed values)
- Test fakes are left as literals
- The .gitleaksignore fingerprints for 2a669ba0 are missing or wrong

### I-6

A committing publish runs the published tree's own check-secrets (the scan CI runs, per hooks.secret_scan) with its output in --out, before or as part of committing. Source: plan stage 3, amendment 2026-11-19.

**I/O contract:** In: the snapshot and its scripts/check-secrets.mjs. Out: a recorded check-secrets result in the --out directory; a failing result blocks the commit.

**Failure modes:**
- The commit proceeds when check-secrets fails
- The check runs the private tree's scanner instead of the snapshot's
- Its output is not recorded in --out

### I-7

In the snapshot, CLAUDE.md is replaced by the tracked publish/CLAUDE.public.md. The replacement declares no request, keeps the same keys and commands, and carries comments written for readers. The publish refuses a replacement whose graph_contract keys differ from the private contract's in anything but doc_roles.request and comment text. Source: plan stage 2b, Q12.

**I/O contract:** In: the manifest's replacement entry, the private CLAUDE.md and publish/CLAUDE.public.md. Out: CLAUDE.public.md installed as the snapshot's CLAUDE.md, or a refusal naming the key that drifted.

**Failure modes:**
- Key drift is accepted
- The public file carries private history or a private request path
- The one-line description drifts from the other copies (checked by hand only, since the drift check compares keys)

### I-8

Before committing, the publish checks that the snapshot runs on its own: node scripts/check-syntax.mjs, node tests/run-all.mjs and node scripts/new-run.mjs --dry-run all succeed inside the snapshot, with output recorded. No test reaches a real Claude CLI. A test that needs history skips with its reason on a squashed tree. Source: plan stage 2b.

**I/O contract:** In: the snapshot directory. Out: recorded results for the three commands; a failure blocks the commit (unless --no-suite was given, which a dry run uses).

**Failure modes:**
- A suite failure inside the snapshot does not block the commit
- A test spawns the real CLI
- A test that needs history fails or skips silently

### I-9

The publish commits one squashed commit into a local clone of the public repository. Its message comes from the release's CHANGELOG.md entry and records the source commit. It is authored as the configured identity only (Tipping Point Org <dev@tippingpointconsultoria.com.br>). Neither the operator's personal identity nor <operator-account> appears in its metadata. The publish never pushes. Source: plan stage 2, 9c.

**I/O contract:** In: --ref, the CHANGELOG entry, the configured identity, the local clone path. Out: one commit in the clone and no push.

**Failure modes:**
- The commit message is not drawn from the CHANGELOG
- The author or committer leaks another identity
- The script pushes
- A missing CHANGELOG section is not refused

### I-10

The publish takes its snapshot from exactly the given master commit and refuses any other ref or a dirty tree. Source: plan stage 9c.

**I/O contract:** In: --ref plus the working-tree state. Out: proceeds only on the approved commit with a clean tree; otherwise refuses.

**Failure modes:**
- A dirty tree is published
- A non-master ref is accepted for a committing publish

### I-11

Tests in tests/regression-publish.test.mjs (and the related suites in scope) are red-before-green on a fixture repository. They cover exclusion, a planted secret, a planted path, a planted <operator-account>, the CHANGELOG-sourced message, the author identity, per-line allowances, stale allowances and the refused gitleaks allowance. Source: plan stage 2 'Verified by', stage 3.

**I/O contract:** In: the fixture repository. Out: each test fails without the behaviour and passes with it.

**Failure modes:**
- A test asserts nothing about the behaviour it names
- No test covers the 2026-11-19 gitleaks-allowance refusal

## Assumed contract (UNVERIFIED)

- **The 2026-11-19 amendment's 'committing publish runs the published tree's check-secrets in --out' means the check gates the commit, not only that it is recorded.** — The plan's sentence does not say whether a failing result blocks; no spec document defines it.
- **The public CI's secret scan uses the shipped gitleaks config generated by gen-gitleaks-config together with .gitleaksignore.** — checks.yml and the public repository's settings are not among the declared documents.
- **The exact manifest schema (field names for allow entries and replacements) is whatever publish/manifest.json declares.** — No declared document specifies field names; reading the manifest would be reading implementation.
- **README.md, .gitleaksignore and the non-publish regression tests in full_sweep_paths are judged only against the general M2 rule 'nothing private or machine-local ships' and their own claims.** — The plan gives no criteria specific to tests such as regression-panel-runtime or regression-argv-adoption.

## Not checked

- **commands.lint** — empty in graph_contract — lint could not be run
- **commands.fmt_check** — empty in graph_contract — fmt_check could not be run
- **commands.typecheck** — empty in graph_contract — typecheck could not be run
- **commands.bench** — empty in graph_contract — bench could not be run
- **commands.run** — empty in graph_contract — run could not be run
- **commands.audit** — empty in graph_contract — audit could not be run
- **commands.deny** — empty in graph_contract — deny could not be run
- **commands.test_product** — empty in graph_contract — test_product could not be run
- **ui.static_bundle** — not declared; no built bundle was inspected
- **contract.snapshot.md and the disk-first protocol copy** — Neither file was found at the sandbox root or as a top-level declared-docs entry (copies exist only inside bench result archives). I used declared-docs/CLAUDE.md as the contract, and protocol §5 and §7 were not read.
- **ARCHITECTURE.md and ROADMAP.md** — Not read in full at this effort. The criteria are sourced from the request plan, which cites ROADMAP M2 and its decisions.
- **Sandbox scope** — declared-docs holds 719 files, mostly bench/results archives matched by bench/**/*.md. The source tree was not reachable and was not attempted.
- **brief-gap** — The brief did not name the 2026-11-19 amendment as the run's subject, or which of the 15 swept tests relate to it. The bench/** copies were noise. A pointer to the specific plan section and the snapshot's real path would have helped.
