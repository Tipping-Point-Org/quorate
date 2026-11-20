# Reconciled

The main defect is in scripts/publish.mjs:388-406. The publisher commits the release into the public clone (--out) first and only then runs the published tree's check-secrets. When that scan fails, the rejected commit stays at HEAD, and the operator is told to undo it with a manual reset --soft. A plain push would therefore send out a commit that failed its own secret scan. This directly breaks I-6 ('a failing result blocks the commit'). The Claude contract-audit lens and four independent external (codex) arms each reached this finding by different reasoning (G-10, HIGH). Two more I-6 breaches sit next to it. If scripts/check-secrets.mjs is missing, the publish only logs a notice and succeeds. The scan output also goes to the terminal and is never recorded in --out (G-11, MEDIUM).

Smaller confirmed gaps:
- The --identity value is not pinned to the configured Tipping Point identity (G-7).
- The windows-drive-path pattern misses forward-slash and single-character-component paths (G-2).
- The manifest omits the blog/sessions/ and ledger exclusions that the intent requires; they are gitignored, so exposure is low (G-1).
- ROADMAP D2 is stale about the order of scan and commit (G-3).
- The trimmed-line allowance hash survives whitespace-only edits (G-4).

The perf findings (G-5, G-6, G-9) and the untracked-files dirty-tree claim (G-8) were dropped: speculative or unreachable.

What the run could not check: lint, fmt_check, typecheck, bench, run, audit, deny and test_product are all empty in the contract, so nothing was executed and every finding is static. feature-verify and ui-audit did not run because their conditions were unmet. No budget caps were enforced. intent-capture read only the .claude/skills copies of the 14 shared docs that collide on snapshot names, so drift in <repo>\shared\ was not checked. All nodes reported. intent.md hashes to the brief's value. Apart from G-11, almost every group rests on a single external arm, and I confirmed those only by reading the source myself. Brief-gap: the brief did not point me to the intent's I-numbers, so I had to find the identity and dirty-tree clauses (intent lines 95 and 107) by grep, and their I-ids are unresolved in my rationales.

## Confirmed (7)

### G-10 · HIGH · `scripts/publish.mjs:388`

Raised by: `panel-codex-arch`, `panel-codex-code`, `panel-codex-contract`, `panel-codex-security`

Verified at scripts/publish.mjs:388-406: gitCommitSync creates the --out commit, then check-secrets runs. A failure calls stop() and only tells the operator to reset --soft by hand, so the rejected commit stays at HEAD. That breaks I-6's 'a failing result blocks the commit'. Four external arms (arch, code, contract, security) reasoned to this independently from different angles: layering, retry stacking, contract, and push exposure. The Claude lens contract-audit (G-11, citing line 388 against I-6) agrees with them. Agreement across lens and arms is strong corroboration, so this is raised above the arms' MEDIUM cap. Root cause of the commit-before-scan half of G-11.

- `panel-codex-arch` · codex: The publisher commits the candidate to --out before running the final whole-history validation at line 402; a failed scan therefore leaves the rejected release as HEAD and requires manual rollback, instead of validating before changing the target repository, contrary to A-11's rule that what reaches Git is a decision (ARCHITECTURE.md §4). (evidence: `evidence/panel-codex-arch/raw.log`)
- `panel-codex-code` · codex: The release commit is created before the public-history scan runs, so a scan failure returns exit 1 with `--out` already advanced to a rejected commit; retrying from that clean but contaminated clone stacks another commit and the whole-history failure persists until HEAD is repaired manually. (evidence: `evidence/panel-codex-code/raw.log`)
- `panel-codex-contract` · codex: The public commit is created before check-secrets runs; when that check fails, the commit already remains in --out, contrary to the requirement that failure block the commit. (evidence: `evidence/panel-codex-contract/raw.log`)
- `panel-codex-security` · codex: The publisher commits the snapshot before running the public repository's whole-history secret scan; when that scan fails, the error path never resets the commit, so the rejected snapshot remains at HEAD ready for an ordinary push and may leave the machine despite publish reporting failure. (evidence: `evidence/panel-codex-security/raw.log`)

### G-11 · MEDIUM · `scripts/publish.mjs:399`

Raised by: `panel-codex-arch`, `panel-codex-code`, `panel-codex-contract`, `panel-codex-security`, `contract-audit`

Verified at publish.mjs:399-401: when scripts/check-secrets.mjs is missing the publish logs a notice and continues, and the scan runs with stdio 'inherit', so nothing is recorded in --out. Both break I-6, which requires a recorded result in --out and failure modes 'output not recorded'. contract-audit (intent, I-6, with its own evidence log) and the codex code/contract/security arms agree on the missing-scanner bypass, which is real corroboration across lens and arms. Its commit-ordering clause restates G-10. The arch arm's point about policy duplicated in orchestration is a separate, weaker layering note that only happens to sit nearby.

- `panel-codex-arch` · codex: The orchestration layer directly decides that an absent public scan passes and that a nonzero scan blocks publication, duplicating the scan-outcome policy already assigned to scripts/lib/publish.mjs; this testable release rule belongs in the pure decision layer rather than orchestration (ARCHITECTURE.md §2). (evidence: `evidence/panel-codex-arch/raw.log`)
- `panel-codex-code` · codex: The missing-script branch treats absence of `scripts/check-secrets.mjs` as success after logging, so an exclusion or snapshot error can remove the validation it is meant to perform; the publish exits 0 and leaves a release commit whose public-history scan never ran. (evidence: `evidence/panel-codex-code/raw.log`)
- `panel-codex-contract` · codex: A snapshot without scripts/check-secrets.mjs is accepted and committed after only a notice, although every committing publish must run the published tree's scanner. (evidence: `evidence/panel-codex-contract/raw.log`)
- `panel-codex-security` · codex: A missing scripts/check-secrets.mjs only produces a notice and the publish still succeeds, so a master commit that removes or renames the checker bypasses the whole-history scan and leaves an unchecked release commit ready to push; the current head contains the checker, making this reachable when such a commit becomes the release source. (evidence: `evidence/panel-codex-security/raw.log`)
- `contract-audit` · opus: I-6 says a failing check-secrets result blocks the commit. Here the published tree's check-secrets runs only after the commit is already made in --out (line 388). When it fails, the publish stops but leaves the commit in place and tells the operator to reset --soft it by hand. The scan's output goes to the terminal (stdio: 'inherit') and is never written as a record in --out. If scripts/check-secrets.mjs is missing, the publish only logs a line and goes on (line 400). So a failing or absent scan does not prevent a commit, and its result is not recorded. (evidence: `evidence/contract-audit/check-secrets-after-commit.log`)
- `panel-codex-contract` · codex: check-secrets inherits terminal output and no result file is written under --out, so the required recorded scan result is absent. (evidence: `evidence/panel-codex-contract/raw.log`)

### G-7 · MEDIUM · `scripts/publish.mjs:82`

Raised by: `panel-codex-contract`

I-? (intent line 95) says the commit is authored as the configured identity only, Tipping Point Org <dev@tippingpointconsultoria.com.br>. publish.mjs:82-88 only parses --identity and checks local deny patterns, and nothing pins it to the configured value. I verified this in the source, so the arm's single finding stands.

- `panel-codex-contract` · codex: The committing path accepts any syntactically valid --identity not matched by local deny patterns; it does not require Tipping Point Org <dev@tippingpointconsultoria.com.br> and can commit as another identity. (evidence: `evidence/panel-codex-contract/raw.log`)

### G-2 · MEDIUM · `publish/manifest.json:16`

Raised by: `panel-codex-contract`

Verified in publish/manifest.json: the windows-drive-path regex needs a backslash and a first component of at least 2 characters, so <home> and C:\x\... are not caught. The intent asks for windows drive paths to be scanned, so this is a real detection gap in a leak guard. Verified in source, not taken on the arm's word.

- `panel-codex-contract` · codex: The Windows-path pattern accepts only backslash paths with a multi-character first component; valid machine-local paths such as <home>/file or C:\x\file pass unnamed. (evidence: `evidence/panel-codex-contract/raw.log`)

### G-1 · LOW · `publish/manifest.json:4`

Raised by: `panel-codex-contract`

Intent line 9 says the exclusion list covers at least blog/sessions/ digests (and the ledger), and manifest.json leaves both out. blog/sessions/ is gitignored (.gitignore:73), so only a force-added digest would ship. The contract gap is real, but exposure today is low.

- `panel-codex-contract` · codex: The required exclusion list does not include blog/sessions digests, so a tracked digest under blog/sessions would be copied into the public snapshot. (evidence: `evidence/panel-codex-contract/raw.log`)

### G-3 · LOW · `ROADMAP.md:454`

Raised by: `panel-codex-docs`

ROADMAP D2 (around lines 452-455) still describes the old order (scan, then commit) and does not mention the new commit-then-scan failure state. This is doc drift downstream of the G-10 behaviour: worth fixing, low impact.

- `panel-codex-docs` · codex: D2 still documents publishing as scanning the snapshot and then committing it, but scripts/publish.mjs:388-405 now creates the public commit before running a second whole-history secret scan; when that scan fails, the commit remains and the operator is told to undo it. The documented sequencing therefore omits the new post-commit failure state and can falsely lead operators to expect every failed secret scan to leave no commit. (evidence: `evidence/panel-codex-docs/raw.log`)

### G-4 · LOW · `scripts/lib/publish.mjs:39`

Raised by: `panel-codex-contract`

lineSha256 trims before hashing (scripts/lib/publish.mjs:39), so a whitespace-only edit keeps its allowance. Intent says an edited line loses it. The trim is a documented choice so that a moved or re-indented line keeps its allowance, which leaves a narrow conflict with the letter of the intent. Low impact, because the secret-bearing content has to stay identical.

- `panel-codex-contract` · codex: Allowance identity hashes trimmed line text, so editing only leading or trailing whitespace preserves the allowance even though the contract requires any edited line to lose it. (evidence: `evidence/panel-codex-contract/raw.log`)

## Dropped (4)

### G-5 · LOW · `scripts/lib/publish.mjs:212`

Raised by: `panel-codex-perf`

This is speculative O(N²) work from a zero-width regex, and that regex could only come from the operator-authored tracked manifest. No benchmark was declared and no evidence of real cost exists. It is a static risk outside any declared performance constraint.

- `panel-codex-perf` · codex: scanText permits zero-width regular expressions and recomputes SHA-256 over the complete line for every match; an empty regex on an N-character user-controlled line produces about N buffered hits and O(N²) hashing work, risking excessive CPU and memory during publish. Static risk only because no benchmark is declared. (evidence: `evidence/panel-codex-perf/raw.log`)

### G-6 · LOW · `scripts/lib/publish.mjs:342`

Raised by: `panel-codex-perf`

O(H×A) matching over an operator-curated allowance list that is small by design (stale entries refuse the publish). No benchmark and no plausible input size that matters.

- `panel-codex-perf` · codex: applyAllowances linearly searches all A allowances for each of H scan hits, producing O(H×A) comparisons and quadratic behavior when the user-controlled allowance and hit collections grow together. Static risk only because no benchmark is declared. (evidence: `evidence/panel-codex-perf/raw.log`)

### G-9 · LOW · `scripts/publish.mjs:254`

Raised by: `panel-codex-perf`

Rereading the file per gitleaks finding only matters when there are many hits, and any hit already refuses the publish. No benchmark and no demonstrated cost.

- `panel-codex-perf` · codex: The gitleaks-report loop synchronously rereads and splits an entire staged file for every finding; H findings in an S-byte file cause O(H×S) I/O and allocation, quadratic when file size grows with finding count, even though manifest validation now prohibits gitleaks allowances. Static risk only because no benchmark is declared. (evidence: `evidence/panel-codex-perf/raw.log`)

### G-8 · LOW · `scripts/publish.mjs:103`

Raised by: `panel-codex-contract`

The snapshot copies the tracked files of the named commit, so untracked files cannot enter it. '--untracked-files=no' therefore does not let any dirty content into a publish. The claim reads I-? 'dirty tree' more literally than its failure mode ('a dirty tree is published'), which cannot happen through untracked files.

- `panel-codex-contract` · codex: The dirty-tree check deliberately ignores untracked files and later permits those under excluded paths, so a dirty working tree can publish despite the requirement to refuse every dirty tree. (evidence: `evidence/panel-codex-contract/raw.log`)
