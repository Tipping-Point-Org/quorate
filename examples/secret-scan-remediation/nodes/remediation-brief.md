# Brief — remediation

run_id: 20261119-054112-m2-9c-secret-scan-remediation
remediates: 20261119-051632-m2-9c-secret-scan
doctrine_path: .claude/skills/quorate/shared/disk-first-protocol.md
remediation_doctrine: .claude/skills/quorate/shared/remediation.md
GRAPH_NODE_DEPTH=1 — you may not spawn subprocesses beyond capture.mjs.

reconciled_md: <repo>\.claude\reviews\20261119-051632-m2-9c-secret-scan\reconciled.md
Work list: G-10, G-11 — the operator's choice: "G-10 + G-11; ledger G-2, decline G-7 (Recommended)". Fix and report only these.
Deferred by the operator: do not fix, do not report: G-7, G-2, G-1, G-3, G-4.
The frame of the review you are remediating — judge *related* and *pre-existing* against it:
{"run_id":"20261119-051632-m2-9c-secret-scan","base":"dd3a5156","base_commit":"dd3a5156f4edecc88cd2754b8658c3d746f42980","scope":[".gitleaksignore","CLAUDE.md","README.md","publish/CLAUDE.public.md","publish/manifest.json","scripts/lib/publish.mjs","scripts/publish.mjs","tests/regression-argv-adoption.test.mjs","tests/regression-arms-surface-ars-r3.test.mjs","tests/regression-arms-surface-ars-r5.test.mjs","tests/regression-arms-surface-link-classes.test.mjs","tests/regression-ledger-review-ltr3-remediation.test.mjs","tests/regression-panel-runtime.test.mjs","tests/regression-publish.test.mjs","tests/regression-vendor-stderr-off-the-tracked-side.test.mjs"],"request":".claude/requests/m2-public-release.plan.md"}

capture_cmd: node .claude/skills/quorate/scripts/capture.mjs --run-dir "<home>/.quorate/reviews/quorate-83d533eb/20261119-054112-m2-9c-secret-scan-remediation" --node remediation --name <slug> -- <command>
test_one: node .claude/skills/quorate/scripts/capture.mjs --run-dir "<home>/.quorate/reviews/quorate-83d533eb/20261119-054112-m2-9c-secret-scan-remediation" --node remediation --name <slug> -- node --test {file} — replace {file} with ONE test file (repository-relative, forward slashes); run red and green with it
limits: each capture may take 25 minute(s) (review.check_timeout_minutes); this session 30 minute(s); every capture's header says how much of it has passed (its "# elapsed:" line, from the runner's clock), so read it there rather than guess. Run every capture in the foreground and wait for it.

Evidence you capture goes under this run's evidence/remediation/. You do not commit: list each group's cluster and
files, and the runner commits after you exit. You never push.

