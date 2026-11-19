---
status: approved 2026-09-25 by the operator (decisions D1–D6 settled the same day)
created: 2026-09-25
---

# quorate roadmap

Three milestones, in order. Each has an **implement** list, an **exit gate** — the checkable conditions
that say the milestone is done — and what it deliberately **excludes**. A milestone plan is written
against its section with the `plan-authoring` skill; the gate is what `plan-review` and a
`version-gate` judge.

The rule every gate inherits, in the operator's words (2026-09-25): *"deploy with known issue is a bad
thing"*. So no gate below passes with a confirmed finding unresolved — resolved meaning fixed and
promoted by a later review, or declined with a reason the operator approved.

## Where things stand (2026-11-13)

Each row says how it was established; a value carried from an earlier table without a recheck says so.

| | |
|---|---|
| Milestone | **M0's gate met** (2026-10-03, one stated exception: `64980a9`, below), **M1's gate met** (2026-10-04, `.claude/requests/m1-story-pipeline.plan.md`), and **Consumer use met** (2026-11-12, all five end conditions below). **M2 started 2026-11-13**: `.claude/requests/m2-public-release.plan.md` approved (operator: "Approve, start stage 0 (Recommended)", after plan-review round 9 PASS), and `doc_roles.request` names it; stages 0 to 9b done (9b, the merge to `master`, on 2026-11-18), 9c (publish) in progress. M3 not started |
| Consumer use, end conditions | Decided by the operator, 2026-10-17: "When the in-flight items close (Recommended)". (1) item 2's chain, observation-guard-and-sibling-census, meets D1: **met** (20261017-044216-ogsc-remediation-2-review). (2) item 3's PATH fix, reviewer-path-entries, meets D1: **met** (20261017-190519-rpe-remediation-4-review). (3) `deploy-test` is merged to `master`: **met** 2026-11-12: master fast-forwarded from `318f7be4` to `c9c0ae95` after PR #2's CI went green on all five jobs (run 43309179949), and master's own CI green (run 43320590005), the first green run since 2026-10-11. (4) story-pipeline asked to repin to that merge: **met** 2026-11-12, repinned to `c9c0ae95` (its beca26e), check-install unchanged bar the hash and `new-run --dry-run` exit 0 with an asserted scope (it repinned to `4baa0184` on 2026-11-12, its 6061a66; a repin only, by the operator's 2026-11-12 ruling below). (5) ledger-findings' stage 8, story-pipeline told and asked: **met** 2026-10-15 (`ledger-findings.plan.md:87`: story-pipeline declared `commands.test_one` and `review.candidate_env` and repinned; a CLAUDE.md comment of 2026-10-17 still called it open) |
| Pulled ahead of M2 since | closed: autonomous-run part 3 delivered 2026-11-12 (`autonomous-run.plan.md`, stage 9's run with the decision panel on), with the design steps delivered inside it (decision-panel-seats, stdin-folder-owner, the `--runtime-bin` rename, hardlink-egress); the code index's own half of stage 8 met 2026-11-13 (`code-index.plan.md`, `stage_8_run`); the code index delivered 2026-11-13 (operator: "Delivered, compare deferred (Recommended)"), its scored compare against story-pipeline's answer file deferred until that file exists; test selection deferred to after M2 (operator: "Defer to after M2 (Recommended)") |
| Version | `0.3.0` in `VERSION` and `.claude-plugin/plugin.json`; `CHANGELOG.md`'s newest section is *0.3.0*; no tag yet (`git tag` lists none; the tag is M2 stage 9d) (rechecked 2026-11-18) |
| Branch | `origin/master` at `45188401`, the merge of PR #3 (M2 stage 9b); `deploy-test` ahead of it by the stage 9c commits (the public install URL and `NOTICE`'s holder, the snapshot's own suite made to pass, and this review chain's fixes), which reach `master` through stage 9b's route (2026-11-18) |
| Consumer | story-pipeline pins `c9c0ae95` (its beca26e, 2026-11-12; `git -C story-pipeline submodule status .claude/skills/quorate`, rechecked 2026-11-18). Moving its pointer is asked of its session first |
| M0 gate, condition 1 | **28 of 28**: every confirmed group of `20260925-200721-platform-remediated` fixed by claim+silence, declined, or closed on the operator's word, each judged by its own defect (entries followed by `first_seen` and file where the ledger re-bucketed them; G-8 settled by group as the gate list records). Re-run 2026-10-03 at stage 8 and again after the last review |
| M0 gate, condition 2 | Met: every follow-up review's findings resolved under D1, through `stopping-a-child.plan.md` stage 7 and the arms' directory work (`arms-directory-home.design.md`). **Stated exception:** `64980a9` (a one-paragraph doc edit, its guard, a test's load headroom) was not reviewed before M0 closed, on the operator's choice; its G-13/G-12 claims are promoted only when a later review covers that paragraph (whether one has since is not rechecked) |
| M0 "soon after" items | prompt-overlap mapping and the first `feature-verify` run: not started (carried from 2026-10-06, not rechecked) |
| OS coverage | CI on the push to `master`: ubuntu Node 22, 24, 26 and windows Node 26, green on `45188401` (run 44395581032, 2026-11-18); a pull request runs Node 26 on ubuntu and windows only (operator, 2026-11-18: "1"). macOS: a hand-started job only (operator, 2026-11-13: "Here, once, on the release PR"), green on the release pull request's head `feb3aa01` (run 44360966711, 2026-11-18). The public repository's run on all three is M2 stage 9d |
| Public-release files | `LICENSE` (Apache-2.0) and `NOTICE` added 2026-11-13, `NOTICE` naming Tipping Point Org since 2026-11-18 (operator: "Tipping Point Org (Recommended)"); `CONTRIBUTING.md` and `SECURITY.md` written 2026-11-14 (M2 stage 5); no code of conduct |
| Exposure | carried from 2026-09-25, not rechecked: tracked review runs and many tracked files carry the operator's local paths; D2/D4 keep `.claude/reviews/` and `.claude/requests/` out of the public mirror |
| Remote visibility | this repository is **private** (`gh repo view --json visibility`, rechecked 2026-11-18) and stays private: the public mirror is `github.com/Tipping-Point-Org/quorate`, public and still empty (no refs, read unauthenticated, 2026-11-18), filled by M2 stage 9c's publish |

## The problem every milestone meets first: review convergence

Three full reviews in a row confirmed 7, 24, then 28 findings. Each remediation fixes what it is pointed
at and the next review, over a wider diff, finds about as many new ones — some in the fixes themselves.
Under "no known issues", that loop has no guaranteed end. Every gate below applies the **stopping rule**
settled as D1 below.

---

## M0 — Finish the remediation in flight

**Implement**
- Scan the full history with `gitleaks` now; the operator reads the report before D2 and D4 are
  acted on. Then add it to the pre-push hook and CI. **Done 2026-09-25:** 347 commits, no leaks;
  the pre-push hook scans each push's commits (every branch), and CI's `secrets` job scans the whole
  history with a checksum-pinned gitleaks.
- Re-sort the 28 findings under D1: the pre-existing, unrelated ones move to the ledger with their
  reason, each shown pre-existing by its failing test on the base commit.
- R2–R8 of the 28 findings of `20260925-200721-platform-remediated`, as listed in the plan file.
- Commit, then one full review over that diff.
- **Soon after (operator, 2026-09-25) — review integrity:**
  - **Responsibility overlap between prompts, checked by relation, not N².** First map which node
    prompts (lenses, arms, reconcile, intent-capture, second-opinion) relate to which: shadowing,
    shared doctrine duties, shared scope. Then check only the related pairs for a responsibility both
    carry. Found in `20260926-002850-m0-close`: G-4's "corroboration" by the code and security arms
    came from the one duty both carry (§6's non-waivable invariants), not two independent angles.
  - **Agreement from a shared duty is not corroboration.** Both arms reported an unbounded CPU spin
    and neither tagged `invariant`. A §6-class finding must carry its invariant, and the reconciler
    must label agreement that arises from a shared duty instead of counting it.
  - **`feature-verify` has never run on this repository.** One narrowed run (not a permanent
    `commands.run`): `quorate:invoke feature-verify` against
    `.claude/requests/preflight-checked-not-rerun.md`, with `node scripts/preflight.mjs` as the run
    command for that run only.

**Exit gate**
- Every confirmed group of `20260925-200721-platform-remediated` is `fixed` in the ledger or declined
  with an operator-approved reason.
- The follow-up review's confirmed findings are resolved under the D1 stopping rule.

**Excludes:** anything a review raises outside the D1 rule's scope.

---

## M1 — Deployable to story-pipeline

**Implement**
1. **Sandbox validation** in `.sandbox/story-pipeline` (never the operator's checkout): move its
   submodule pointer to the candidate commit; `check-install` reports no problems; `new-run --dry-run`
   succeeds; one `quorate:invoke` of a single lens completes to a gate; one full review of a small
   story-pipeline change completes to a gate with every required lens reporting. `ui-audit` reports
   there (the fixture declares `surface: web` and a static bundle), since it can never run on quorate
   itself.
2. **Consumer contract drift**: `check-install` in the sandbox names every key the template has and the
   consumer's contract lacks (at least `review.preflight_cache_max_mb`); each is added or deliberately
   left absent, and the choice recorded.
3. **Hooks**: the installed `pre-push` shim runs against the new engine layout (`scripts/io/`) in the
   sandbox.
4. **Push** the branch (operator approval required — outward-facing).
5. **Rollback note**: the previous pin (`07db3f6`) and the one-line command to return to it.

**Exit gate**
- M0's gate is met.
- Every item above is shown done in the sandbox, with the framework commit the gate printed matching
  the candidate commit (CLAUDE.md: "read the framework stamp before believing a result").
- The operator moves story-pipeline's pointer — or authorises it explicitly.

**Excludes:** merging to `master`; macOS; public-facing documentation; any change to story-pipeline
itself ("the fixture is the environment, not the subject").

---

## Consumer use — between M1 and M2

quorate's `deploy-test` branch (from `c67e63f`, the commit story-pipeline pins) is where a defect found by USING
quorate in story-pipeline is fixed (operator: "any problem found while running story-pipeline we can commit
and merge when done"). Each fix is ledgered, reviewed like any other change, and story-pipeline's pointer moves to it.
When done, `deploy-test` merges into `preflight-checked-not-rerun` (operator, 2026-10-05: "Work branch") — not
`master`; M2 does that.

Found by story-pipeline run `20261005-235247-product-sweep` and its sessions — all FIXED (`d33db1a`, `b46a729`, `d52ec64`;
reviewed by `20261007-031302-consumer-use-review` and remediated through three rounds, `b7c6bac`, `4713ab9`, `b5e95d2`):
the doctrine path in every brief, external-arm `model`, the self-ignoring claim-check directory, `check-install`'s
hook misreport and reviews `.gitignore` check, the decision rule reaching consumer sessions, and reconcile past 80
groups (now batched). Merged back (`9638c97`); `deploy-test` advanced to `b5e95d2`; story-pipeline repinned to it.

**Delivered — the batching design step** (operator, 2026-10-07: "Design step"). Batched reconcile had drawn new
findings at MEDIUM or above in three reviews running (`consumer-use-r2`, `-r3`, `-r4`), the last a HIGH (G-3 of
`20261007-050929-consumer-use-r4`: the merge validated nothing), so under D1 it went to a design review instead of a
fourth patch. Designed (`reconcile-batches.design.md`), plan-reviewed in six rounds (`reconcile-batches.plan.md`,
approved), implemented once (stages 1–4: `3a87df3`, `36050d3`, `94058b9`, `6655b9d`), and reviewed once
(`20261007-073125-reconcile-batches-review`: two MEDIUMs, remediated in `5afe118`; that remediation's review,
`20261007-080217-reconcile-batches-r2`, raised no new MEDIUM from this work, so D1 is met). Its single-family LOWs and
the pre-existing G-8 (an adapter timeout flag nothing passes) are in the ledger with their reasons.

**In progress — the remediate design step** (operator, 2026-10-08: "One remediate design (Recommended)", "Build the
mechanism"). The search-for-other-instances rule written into `skills/remediate` step 3 drew a new MEDIUM from its own
fix in three reviews running (`20261008-152031-remediate-siblings`, `-r2`, `-r3`), and the reviews and story-pipeline's
questions showed the mechanism the skill describes was never built: no remediate node had ever run, and remediation run
directories were written by hand. Designed (`remediate-rebuild.design.md`, decided), plan-reviewed in five rounds
(`remediate-rebuild.plan.md`, approved): remediation as a spawned node in its own run, the fix-or-ledger rule moved into
`shared/remediation.md`, a sandbox that can edit source and tests, and the round cap counted along the remediation links.
Delivered in stages 0-6; its delivery review (`20261008-214527-remediate-rebuild-review`) was remediated in three rounds,
each drawing new MEDIUMs from its own fixes, all on which file a path names and what kind it is — the round cap. The
operator chose a second design step (`remediation-paths.design.md`, decided; `remediation-paths.plan.md`, approved,
2026-10-08: "Approve, start (Recommended)"): one owner of a path's kind, git's status as the one authority on which
file a path is, and the runner committing after the node exits. Delivered; its delivery review
(`20261009-002459-remediation-paths-review`) was remediated in three rounds, each drawing a new MEDIUM from its own fix,
all at what the runner writes and reads beside the node — the round cap again. A third design step
(`remediation-run-ownership.design.md`, decided; `remediation-run-ownership.plan.md`, approved, 2026-10-09: "Approve,
start (Recommended)"): the runner's own files in a folder of their own, one runner per run behind a lock, and
repositories refused at the start kept out of the commit. Delivered, its review meeting D1 in two rounds; story-pipeline
repinned to it.

The `--out` flag `external-review.mjs` gained for story-pipeline's candidate-pool reached the round cap in its three
reviews (`20261008-175234-cpool-and-design-step`, `-r2`, `-r3`), each finding a document behind the code. A design step
(`external-review-out.design.md`, decided; `external-review-out.plan.md`, approved, 2026-10-09: "Approve, start
(Recommended)"): the contract row owns the rules as `OUT-1` … `OUT-8`, every refusal carries its id, and `--out` may not
lie under the adapter's own `<sink>/evidence/`. Delivered; its review met D1 after one round; story-pipeline repinned.

The reviewer preflight, raised by story-pipeline's candidate-pool (the agy probe; operator, 2026-10-08: "no fallback.
preflight test for what is needed and fails if something is missing"; "Every reviewer (Recommended)"). A design step
(`reviewer-preflight.design.md`, decided; `reviewer-preflight.plan.md`, approved, 2026-10-09: "Approve, start
(Recommended)"): every external reviewer is checked before it is used and refused if it fails. What that means is
owned by `shared/external-reviewers.md` ("Failure handling") and `shared/claude-md-contract.md`
(`reviewer_probe_max_age_hours`, and the version table's row 6), and not restated here.

Remediation scoped to the operator's chosen groups (`remediation-group-scope.md`, approved, 2026-10-10: "Add group
scoping (Recommended)"): story-pipeline had to fix 6 of 15 confirmed groups and defer 9 to later designs, and a
remediation could not be scoped. `new-run --remediates <run> --groups … --operator-quote …` scopes it. Folded in is the
defect story-pipeline hit the same day: a remediation run staged outside the tree was unreadable to its node, and the
runner reported that as a clean no-op. Its review reached the round cap (r2-r4, each on which of the node's edits get
committed); story-pipeline was repinned to it, and a design step followed (`remediation-commit-admission.design.md`,
decided; `remediation-commit-admission.plan.md`, approved, 2026-10-10). Its review met D1 on `20261011-000159-commit-admission-r2`. Then story-pipeline's own pre-commit hook refused a
remediation commit and named a trailer as the remedy, which the runner could not add or retry: `--retry-commits` and
`--commit-trailer` (`remediation-commit-recovery.md`, approved, 2026-10-11: "Add retry + trailer (Recommended)").

A contract's override of a built-in adapter (`reviewer-credential-routing.design.md`, decided 2026-10-10: "A: decline,
make visible (Recommended)"; `reviewer-credential-routing.plan.md`, approved 2026-10-11). The override keeps that
vendor's credentials, deferred from external-review-out's review as worth its own step (G-1 of
`20261009-055155-ero-review`). Forwarding is unchanged; the trust decision gets one owner (A-26), and every path that
runs an overridden built-in names it.

The ledger absorbed a confirmed HIGH into an unrelated, operator-declined MEDIUM entry in the same ten-line bucket
(`.claude/findings/2026-10-12-ledger-absorbs-a-high-into-a-declined-entry.md`). A design step
(`ledger-identity.design.md`, decided; `ledger-identity.plan.md`, approved 2026-10-12: "Approve, start (Recommended)"):
the fold reads reconciled groups at the severity the gate confirmed, a bucket two groups share is flagged, and a fix
claim must cover every group in it.

Its rounds reached D1's round cap in the machinery that checks a fix rather than in the fixes: one node backgrounded its
full-suite check and ended its own session, one was killed holding a wait, and one committed work it had not verified
(dec1158a). A design step (`remediation-verification.design.md`, decided; `remediation-verification.plan.md`, approved
2026-10-13: "Approve, start (Recommended)"): a node checks each fix with a declared single-test command, the runner checks
the commit candidate in place, and only verified groups commit. The ledger-identity work resumes after it.

Its delivery reached the round cap in turn, three remediation rounds each drawing a new MEDIUM in its own fixes, all in
the candidate check's two boundaries: which environment reaches code the remediator wrote (a deny-list that missed one
more variable each round) and how paths are compared (case). A design step (`candidate-check-boundaries.design.md`,
decided; `candidate-check-boundaries.plan.md`, approved 2026-10-14: "Approve, start (Recommended)"): an allow-listed
environment decided once, with a `review.candidate_env` key, and one path key over the repository's case rule (git's `core.ignorecase`).
remediation-verification's stage 8 resumes after it.

The ledger-identity work it paused resumed on 2026-10-14; its scoped remediations left the open findings of its
delivery, which a design step gathers by mechanism (`ledger-findings.design.md`, decided; `ledger-findings.plan.md`,
approved 2026-10-14: "Approve, start (Recommended)"): one re-fold rule on every path, symptom chains walked to their root,
one contract reader, run directories read once, one list of run roots. The bucket model stays (operator: "Keep the
limit (Recommended)").

Its delivery's remediation rounds then drew a MEDIUM in the bench tools' contract read each round — which directory a
bench reads its contract from, and when — and the sixth was refused by its own full check. A design step
(`bench-contract-root.design.md`, decided; `bench-contract-root.plan.md`, approved 2026-10-14: "Approve, start
(Recommended)"): a bench answers to the framework root's contract, read once, and a live run refuses one that is not
committed. ledger-findings' stage 8 resumes after it.

**Exit (checked at M2's gate):** the batching design step is delivered and its review meets D1; the remediate design step
is delivered and its review meets D1; `deploy-test` is merged back; story-pipeline pins a commit on the merged branch.

**When it ends** (operator, 2026-10-17: "When the in-flight items close (Recommended)"): once all of these are done, M2
can start, and the operator is still asked before it does:
- `observation-guard-and-sibling-census.md` meets D1;
- the reviewer PATH-entry fix (G-6 of `20261016-224651-sp-bugs-remediation-3b-review`) meets D1;
- `deploy-test` is merged to `master`;
- story-pipeline is asked to repin to that merge (a repin only; nothing else of story-pipeline's is a quorate condition);
- `ledger-findings.plan.md` stage 8 is done.

**No story-pipeline work is a quorate milestone condition** (operator, 2026-11-12: "Do not include any stage/task from story-pipeline as a milestone for you. If you NEED story-pipeline to do some work you tell that otherwise is just repin. Don't mix one projetc work with another"). Work that
story-pipeline's own repository has to do, code-index stage 8's answer file among it, is that project's own work; where
quorate needs a result from story-pipeline to validate quorate (a validation, a test, one of its stages), story-pipeline
is asked for it and the operator is told it as a named task (operator, 2026-11-12: "if you need story-pipeline to run
something be it validation, test, etc. that can be asked ... if the work 'result' is important for quorate it can be
done"). Code-index stage 8's answer file is such a result, so it is asked of story-pipeline. Stage 8's other half is quorate's and stays: the
index run read-only over a clone of story-pipeline's tree, the answers that need no answer file, and the benchmark.

Bugs story-pipeline finds after that are still fixed before the release, inside M2.

**Placed 2026-10-24 — autonomous runs** (`.claude/requests/autonomous-run.md`, the operator's draft request of 2026-10-21,
not yet approved). Built right after the code index (item 3 below) and its nested design steps, and before interactive
capture (M2 item 7). Operator, 2026-10-24, after confirming that this request, not capture, is the work that cuts the
pauses waiting on them: "Let's keep working; just advance autonomous-run.md closer". It needs its request approved and a
plan first; criterion 5 (a stop only for a named reason, in every mode) may be its first stage.

**Reordered 2026-10-24 — parts 1 and 2 first** (`.claude/requests/autonomous-run-pauses.md` and its plan, both approved).
The operator split the request in three ("We can split autonomous into: * pauses with no question * Questions related
to push, run xx now, etc.? [...] * anything that needs answering questions") so that parts 1 and 2 are "implemented
before the remainder of autonomous-run". The order, as the message the operator answered "yes" to stated it: parts 1-2,
then telemetry's run records (M2 item 6, pulled forward), then run-dir-descendants as decided, then code-index D1, then
M2. The run-dir-trust chain, inside the code index, pauses where it stands (remediation 4 refused at the round cap) and
resumes at run-dir-descendants. Part 3, questions that need an answer, stays in `autonomous-run.md`.

**Part 3 planned and pulled ahead of the code index's close, 2026-10-31** (`.claude/requests/autonomous-run.md`, approved:
"as approved"; its design `autonomous-run.design.md`, decided: "do A"; its plan `autonomous-run.plan.md`, approved after
plan-review round 3 PASS). The code index is not delivered: `code-index.plan.md` stage 8 waits on story-pipeline's
operator. Asked "Build it now, or after the code index?", suggested "Build now", the operator answered "as suggested".
Part 3 is built now; the code index's stage 8 closes when story-pipeline answers, and `doc_roles.request` returns to it
by part 3's plan's stage 9 if it is still open then.

**story-pipeline's five items, decided (operator, 2026-10-18)**. Each answer in the operator's words:
1. **Effort pins.** "do 1 but leave 2 for later". Every skill that spawns a subagent names its model and effort from the
   contract (`review.models.judgment`, `review.effort.judgment`), marked unmeasured for those tasks. Separate skill
   keys are later. Before M2, as a bug.
2. **The claim-check checker's family.** "Cross-family when the panel is on (Recommended)". With `external_panel` on,
   the checker runs through the external reviewer adapter. With it off, it stays Claude and stamps same-family. Before
   M2. The transcript, which a checker needs for attribution claims, goes to the cross-family checker too, and a config
   key falls back to keeping attributions with the Claude checker (operator, 2026-10-18: "2 wiht config to fallback to
   1"), because "My codex subscription is lower than clause's and if it prooves to be a jeavy drain on codex I need a
   simple falback (1) without a new coding round".
3. **A code index.** "Build now, before M2". quorate owns the interface, the schema and a conformance suite. Each project
   declares its extractor as a contract command. story-pipeline is the first consumer. A design step, before M2. **It
   moves M2 out**, which was accepted when it was chosen. The answer decided timing only: "nothing is persisted" was in
   my question's text, and the input-hash clause that stood here was mine. Persistence and the rest are decided in
   `.claude/requests/code-index.design.md` (operator, 2026-10-20).
4. **A bench from a consumer's own ledger.** "Format now, tool after M2 (Recommended)". The seed corpus format and the
   `bench-admit` contract are documented now. `--from-ledger`, which recovers each seed's pre-fix tree, comes after M2.
5. **A document-owner set in the contract.** "Not in the contract (Recommended)". No key. A key beside `doc_roles` is
   added only if a quorate lens ever reads owner data.

**A design step on the way (2026-10-17)**: `remediation-fmt-check-baseline.md` reached D1's round cap, all three rounds on
whether a captured check actually ran, and the operator chose "Design step now, then merge (Recommended)". Design
`check-outcomes.design.md` (decided), plan `check-outcomes.plan.md` (approved after six plan-review rounds: "Approve and
build (Recommended)"). It comes before the merge to master. Its census found two siblings outside the fmt_check chain:
the review pre-flight and the evidence gate.

---

## M2 — Public repository (a 0.x pre-release, not v1)

Public means someone who is not the operator can find, read, install and run it — and that nothing
private or machine-local ships with it.

**Implement**
1. **Licence**: Apache-2.0 (D3), with `LICENSE` and a `NOTICE` file.
2. **What ships** (D2, D4): the publish script and its exclusion list; `examples/` with one or two
   curated runs; the build log after the operator's read-through; and a `gitleaks` scan of the
   snapshot that must come back clean — its exact command recorded in the gate.
3. **Outsider docs**: `README.md` written for someone who has never seen this repository — what quorate
   is, what it costs (it spends model and vendor quota), what leaves the machine (the external panel),
   and install by `QUORATE.md`. `CONTRIBUTING.md` and `SECURITY.md` (how to report a vulnerability).
4. **Merge to `master`**, and CI green on `master` for push and pull request, on all three operating
   systems (D5).
5. **A tagged 0.x release** (e.g. `v0.3.0`) with a `CHANGELOG.md` entry that says what a consumer must
   change — the first release this project has cut.
6. **Telemetry** (`.claude/requests/telemetry-recommendations.md`, approved 2026-09-27; placed here by the operator,
   2026-10-06: "M2, with the public 0.x"): finished runs write a local record (best-effort, `shared/telemetry.md`), and `scripts/telemetry.mjs` reports and
   recommends from them — so records start with the first outside users, where the request says real recommendations
   come from. Its first part is `.claude/requests/telemetry-records.plan.md` (approved 2026-10-25): the run records, what every task
   records for performance analysis and debugging, and a report that reads them. Deferred in writing to item 6's second
   plan, not yet written: criteria 2-5 (recommendations), 11's query half (SQLite) and 13-16 (the bench work); the
   request's amendment numbers its own criterion 9, cited as criterion 17 to keep it apart from criterion 9. **Pulled forward** for its run records (operator, 2026-10-24:
   "Have metrics to be able to know where to focus my energy on improving Quorate"; "yes" to the order in the
   Consumer-use list's "Reordered 2026-10-24" paragraph): built after autonomous runs' parts 1 and 2, before
   run-dir-descendants; still before the public release either way ("being at M2 or before it, both count as before
   public").
7. **Capture for interactive commands**, story-pipeline's handover (2026-10-19,
   `story-pipeline\.claude\requests\capture-for-interactive-commands.md`; operator: "When I asked to be included at
   M2 was because I want it to be when public is released"). `capture.mjs` splits into one async core, deadlines as
   parameters, and two front ends: the lens node's, its allow-list unchanged, and an interactive one that needs no run
   directory and keeps stdout and stderr apart. It accepts a command string in a POSIX subset, parsed by an existing
   parser; quoted `"$( )"` only, every parsed command, inner ones included, run and captured the same way, and a failing
   inner command fails the whole command before the next runs (operator, 2026-10-19). The parser comes from a
   candidate-pool at plan time ("Search wide, decide constraints after"). Open at planning: `$VAR`, globs, how a stage
   stopped by a downstream exit is reported, preview defaults, `commands.shell`, recording the resolved argv, and the
   one runner rule that authorises everything it runs. **Built 2026-11-15/16** by `.claude/requests/capture-interactive.plan.md`
   (approved "Approve, start the bench (Recommended)"; the parser unbash 6.0.4, chosen by a bench; the open points decided
   in its stage 2), delivered with D1 overridden at its delivery chain's round cap ("One more scoped round, then close
   (Recommended)"), its open findings in `capture-interactive.followup.md`. **Pulled forward**
   (operator, 2026-10-19: "implement but do not use when it's done yet"; then "Item 3 first, capture after"): built
   after item 3 of the Consumer-use list and the autonomous-run request placed beside it (2026-10-24), and before M2, and not adopted for the session's own commands until the
   operator says so.

**Exit gate**
- M1's gate is met, and the "Consumer use" exit above.
- The telemetry request's criteria are verified against the delivered code, or each one not delivered is deferred in
  writing.
- The pre-publication scan's findings are each resolved, and its instrument (the exact commands) is
  recorded.
- A fresh clone, on a machine that is not this one, installs into a throwaway consumer by following
  `QUORATE.md` alone, and `check-install` reports no problems.
- The repository's visibility is public, and the tag exists.

**Excludes:** any stability promise about the contract or CLI — that is what v1 is for; macOS support
claims.

---

## M3 — v1.0.0

v1 is a promise: the contract, the CLI and the artifacts a consumer depends on stay compatible within
1.x, and the supported operating systems are actually tested.

**Implement**
1. **A compatibility policy**, starting small (operator agreed the draft below, 2026-09-25):
   > - **Contract:** every `graph_contract` key documented in `shared/claude-md-contract.md` at 1.0
   >   keeps its name and meaning throughout 1.x. New keys may be added, always optional, with a default
   >   that preserves 1.0 behaviour. A change of meaning bumps `graph_contract_version` and waits for 2.0.
   > - **`gate.json`:** every field present in 1.0 keeps its name, type and meaning; new fields may be
   >   added, so consumers ignore fields they do not know. `PASS`, `RISK`, `FAIL`, `BLOCKED` are fixed.
   > - **Commands:** the entry points and flags `QUORATE.md` documents keep working as documented.
   > - **Not covered:** prompt wording, what lenses find, and everything under `scripts/` that
   >   `QUORATE.md` does not document.
   > - **Removals:** anything removed in 2.0 is flagged by `check-install` for at least one 1.x release.

   A breaking change is signalled by `graph_contract_version` (which exists) and semver on the release.
2. **All three operating systems tested in CI** (D5): `macos-latest` is added at M2; by v1 it has been
   green for the whole 1.0 candidate.
3. **Open requests triaged**: each approved request is either delivered — verified against its
   criteria, not recalled — or explicitly deferred past v1. Known open or unverified:
   - `model-and-effort-reevaluation.md` — AC7's false-positive tolerance is **decided (2026-10-02)**; the
     number and the measurement behind it are in that request, not restated here.
   - `consumer-owned-configuration.md` — AC 6 met; its other criteria's status is not recorded.
   - `per-functionality-auth-selection.md`, `code-review-comparison.md`,
     `adjudication-merge-for-disputes.md`, `cross-family-review-standard.md` — **no delivery status
     recorded; audit needed**.
   - `gateway-reviewer-adapter.md` — draft; approve, reject or defer.
   - `second-opinion-scored.plan.md` — the build plan for AC 14's second half of `model-and-effort-reevaluation.md`
     (status `plan`, no milestone until 2026-10-06).
   - `ledger-quote-verification.plan.md` — deferred until `ledger-transitions` landed, which it has (`fa5148d`);
     now due a decision.
   - (`consumer-path-readiness.md` is retired: M1 delivered what it asked.)
   - the six `.inferred.md` recoveries — confirm or retire. (Counted 2026-10-02; this line said five.)
4. **The unverified-claims gap** (`shared/unverified-claims.md`) — item 2 built as `quorate:claim-check`
   (2026-09-26). For v1: decide whether what it still does not cover, as that file lists, is a
   documented limitation or further work.
5. **Bench coverage**: the corpus seeds no `arch-review`, `perf-audit`, `ui-audit` or `feature-verify`
   defect (CLAUDE.md). Widen it, or state in the release that those lenses' settings are unmeasured.
6. **An upgrade path from 0.x**: `check-install` names everything a 0.x consumer must change, and the
   release notes match it.
7. **Three requests from reviewing story-pipeline's skills** (operator, 2026-10-04: "After M2, before v1"), each a
   draft with open questions under `Needs input` and no acceptance criteria yet: `lens-scaffold.md` (a skill for
   adding a lens, from story-pipeline's `stage-scaffold`), `reviewer-adapter-scaffold.md` (a skill for supporting a
   new vendor, from its `adapter-scaffold`), and `pr-review-comments.md` (posting a review's findings to a pull
   request — the one `/code-review` capability quorate lacks). Each is answered, approved and delivered, or deferred
   past v1, like item 3's requests.
8. **The ledger triaged** (operator, 2026-10-06): every open entry in `.claude/reviews/ledger.json` — 231 on
   2026-10-06, 200 MEDIUM and 31 LOW — is fixed, closed, or deferred past v1 with a reason. A deferral may cover a
   class of entries at once, but names them.
9. **Two halves left by `observation-guard-and-sibling-census.md`** (operator, 2026-10-17: "Guard now, D2-B to M3
   (Recommended)"; "Prompt census now, check in M3 (Recommended)"). Each is delivered, or deferred past v1 in writing:
   - **D2-B, the ledger's stable anchor.** An entry is keyed by file and enclosing symbol instead of a 10-line bucket,
     so two defects near each other stop sharing one entry, including the case a review fold produces, which the
     `--add` guard does not cover. Case and encounters: `.claude/findings/2026-10-15-ledger-bucket-collisions.md`.
   - **The mechanical census check.** The commit step notes a group whose changed files do not cover the
     `search_sites` it reported, minus its `not_in_class`. Case: `.claude/findings/2026-10-15-evidence-gate-under-reach.md`.
10. **Memory and CPU monitoring** (`.claude/requests/resource-monitor.md`, approved; operator, 2026-11-05: "A but do not
   start yet add it to the roadmap for a stage after public release"): per-run load figures and a standing collector,
   built from memlog and the avp sampler, on all three operating systems, switchable and configured by contract keys,
   with warnings at configured limits, published as telemetry records. Not started before M2's release. Delivered, or
   deferred past v1 in writing.

**Exit gate**
- M2's gate is met.
- The compatibility policy is written and linked from `README.md`.
- CI is green on every operating system the release claims to support.
- Every approved request is delivered (verified) or deferred in writing; no draft or inferred request
  is left undecided.
- No ledger entry is open without a decision (item 8).
- A full review of the release candidate's diff meets the D1 stopping rule.
- `quorate:version-gate` passes on the candidate, and `v1.0.0` is tagged.

**Excludes:** new features not already requested; a second node runtime; anything a request defers.

---

## Later — to be planned, not scheduled

- **Ideas from comparing with AI-DLC (`awslabs/aidlc-workflows`, read 2026-10-16).** Operator, 2026-10-16: "add to
  future roadmap a task to plan that". The task is to write a plan, not to build. It covers:
  - a prompt-injection lens, since reviewed code is untrusted input to every lens (that project's PR review has one;
    quorate's threat model does not name injection through reviewed content);
  - explicit kill criteria for the reconciler (that project's judge drops a candidate whose REPRO, LOSS or BLAME line
    cannot be written, and turns a BLAME-on-base finding into a pre-existing follow-up);
  - incremental re-review, where non-security lenses skip lines an earlier review already covered.

  Each idea is evaluated, not assumed; none is a milestone item until a plan is approved.
- **Run only the tests a change can affect — after M2 (moved ahead 2026-11-06, deferred again 2026-11-07).** Operator,
  2026-10-19: "we can handle this speedup later write a note so we can go back after M2"; then, 2026-11-06, told that every
  review and remediation pays about 6 minutes of full suite: "After this chain (Recommended)", and "Add review pre-flight
  (Recommended)". Item 0 re-timed the suite (343.5 s) and the operator chose to split the slowest test files first ("Split
  slow files first (Recommended)"; `.claude/requests/split-slow-test-files.md`, delivered 2026-11-07: full runs 190 s).
  On the split suite, selection would save about half of a run, and the operator deferred it: "Defer to after M2
  (Recommended)" (2026-11-07). Record which files each test reads, then select by that map, with CI, pre-push to master
  and a remediation's candidate check still running everything. The plan,
  `.claude/requests/test-selection-by-recorded-reads.plan.md`, stays approved with items 1-9 not built; its harness's open
  findings are settled when it resumes. The request: `.claude/requests/test-selection-by-recorded-reads.md`.

---

## Decisions (settled with the operator, 2026-09-25)

- **D1 — when a review has converged.** A release gate is met when every confirmed finding is resolved, where resolved
  means fixed and promoted by a later review, or declined with an operator-approved reason — except the one class
  deferred to the ledger as tracked work. Which class that is (the fix-or-ledger table and *related*), the single-family
  LOW rule and the round cap are owned by `shared/remediation.md`, where a consuming project's remediations read them
  too (moved 2026-10-08, operator: "Move into shared/ (Recommended)").

- **D2 — publishing.** A release mirror. Work continues in this private repository; the public repository
  receives one squashed commit per release, with a short message written for readers — what changed,
  what a consumer must do — taken from that release's `CHANGELOG.md` entry, never the concatenated
  private history. A publish script copies the tracked files minus a declared exclusion list
  (`.claude/reviews/`, `.claude/requests/`, the ledger, anything machine-local), runs the secret scan
  on that snapshot, and commits it.
- **D3 — licence.** Apache-2.0.
- **D4 — run artifacts and the build log.** One or two curated, scrubbed example runs in `examples/`;
  the tracked runs and `ledger.json` stay private. The build log is published after the operator
  reads it as a stranger would.
- **D5 — operating systems.** One release and one tag for every OS; a release may CONTAIN an OS-specific
  fix and the changelog says so. `macos-latest` joins the CI matrix, so "supported on macOS" means the
  suite ran there.
- **D6 — this document.** Declared as `doc_roles.roadmap` and added to `doc_paths` once approved.
- **Secret scanning starts now, not at M2** (operator, 2026-09-25): `gitleaks` over the full history
  first, then as a standing check in the pre-push hook and CI.
