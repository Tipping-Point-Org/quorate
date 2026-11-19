---
name: remediate
description: Fixes the confirmed findings of a FINISHED review run — in a separate remediation run, by a remediation node spawned in its own context, never in the run or the session context that produced the findings. Mints the run (new-run --remediates), runs the node (remediate.mjs), and walks the operator through what comes back: claim-check the report, record a ledger disposition per group, run the follow-up review. Use when the user asks to fix, address, or remediate the findings from a review run.
---

# remediate — a separate run, a separate context, one claim at a time

The standing rule in this system is: **never apply fixes in the run that found them.** The reason is not procedural
tidiness. A context that has just spent an hour arguing a finding is real is the worst possible judge of whether the fix
worked — it is invested, it knows what it expects to see, and it will read a passing check as confirmation of its own
earlier reasoning. Separating the two is the cheapest independence the system can buy.

So the fixing is not done here. This skill mints a **remediation run** and launches the **remediation node** into it —
a fresh subprocess with its own contract (`<framework-root>/prompts/remediation/PROMPT.md`), its own policy (it may edit
only the contract's `source_globs` and `test_globs`, and cannot commit: it reports each fix's cluster and files), and the reviewed
run's `reconciled.md` as its work list. You, in this session, drive it and read what it reports.

Which instances of a defect a change fixes, which it ledgers, and when to stop patching are not decided here:
`<framework-root>/shared/remediation.md` owns that rule, and the node applies it as written.

## The flow

1. **Mint the remediation run** from the finished review — never from the run you are reviewing in now:

   ```
   node <framework-root>/scripts/new-run.mjs --slug <slug> --remediates <reviewed run dir>
   ```

   **To fix only some confirmed groups**, because the operator deferred the rest to later work, add
   `--groups G-7,G-11 --operator-quote "<the operator's words choosing them>"`. Each id must be a confirmed group of
   that review. The node is given only those groups, and the others are marked deferred by the operator. After the
   run, ledger each deferred group as `open`, with the same `--operator-quote`, so the deferral is the operator's
   decision on record.

   **If the project's own hook refuses a commit** (`hook-rejected` in `commit_check`), the cluster's changes stay
   unstaged in the working tree. When the hook names a commit-message trailer as its remedy, re-attempt only those
   clusters, without spawning the node again:

   ```
   node <framework-root>/scripts/remediate.mjs --run-dir <remediation run dir> --retry-commits --commit-trailer "Doc-Impact: <the operator's words>"
   ```

   No follow-up review is minted while such a cluster is pending. To abandon one instead, discard its edits from the
   working tree and run the same command: it is then recorded refused, and the follow-up is minted if any cluster was committed. Each file is
   re-checked against git first. What is committed is the files as they are in the working tree at that
   moment, so do not edit them in between. Never commit them by hand with `--no-verify`. `--commit-trailer` can also
   be given on the first run.

   It refuses a review with no `reconciled.md` or no gate, and a run that is itself a remediation. The run records
   `remediates` and the reviewed run's frame (base, scope, request), and writes its own `remediate-settings.json`.
   **Remediating the framework itself** (quorate's own repository) must be minted by a different checkout of it — the
   pinned install, `.claude/skills/quorate/scripts/new-run.mjs` — so the remediator cannot edit the code that confines
   it; `new-run` refuses otherwise.

2. **Run it:**

   ```
   node <framework-root>/scripts/remediate.mjs --run-dir <remediation run dir>
   ```

   Run it from the repository, or name it with `--repo-root`: the run directory is admitted only as one of that
   repository's remediation runs, and the runner acts on that repository, never on the one its `run.json` names
   (`<framework-root>/ARCHITECTURE.md` A-28). It refuses inside a graph node (§8). It **stops at the round cap** (`<framework-root>/shared/remediation.md`,
   **Round cap**) and says to run a design step (`<framework-root>/shared/design-step.md`) instead of a fourth
   patch; it refuses when the chain cannot be read (`CHAIN-UNKNOWN`) and stamps `CHAIN-BROKEN` when the review you are
   remediating is not the follow-up the previous remediation minted. **Commit or stash your own work first**: it refuses,
   before the node is spawned, a working tree whose source, test or check-input files are already changed. Then it spawns
   the node, checks the report against the review's confirmed groups and its own evidence (`REPORT-CHECK`), and admits a
   group only on its own experiment on disk: a `commands.test_one` red that ran and failed (not one that timed out, was
   stopped, or could not start), then a later green of the same test
   file that passed — several reds and greens may be listed, `;`-separated, one per test file: every red listed must have
   failed, every green listed must pass, and each red must be followed by a green of its own file, though that each changed test file has a green is not checked (`evidence-refused` otherwise; a fix with no possible red is declared in `no_red` and recorded as `declared-no-red`, by the rule `shared/remediation.md` states (What a fix must show); a symptom fixed in its root's cluster is shown by its root's red; the three cases are `<framework-root>/shared/remediation.md`'s, What a fix must show). Before the
   first commit it **checks the whole commit candidate in place**, its new files marked intent-to-add so they read as git will commit them — every declared pre-flight command, `build`, `test`,
   `lint` and `typecheck` refusing, and `fmt_check` where it passed before the node ran (`full-run-red`) — one that did
   not run to its own end is recorded under `unfinished` and stamps nothing — the tree holding nothing else the checks read, and the new files unmarked after (`tree-not-candidate`; when an unmark fails, the recovery is the `scripts/remediate.mjs` row of `<framework-root>/shared/claude-md-contract.md`)
   — then commits each cluster — one commit per cluster, re-checked just before, with a test and every group's red
   capture (a cluster with a group that has no red, no `no_red` declaration and no root's red to show it is refused, with a test or without, "red-before-green skipped", as `refused-cluster`;
   `.claude/requests/two-ledger-mediums.md`), whatever the node reported; whatever it will not commit stays in the working tree, named (`COMMIT-CHECK`) — and
   **mints the follow-up review of its own diff without running it**. A refused candidate check is retried with
   `--retry-commits` once the cause is fixed inside the candidate's files; a fix outside them needs a new remediation run.
   A run whose fixed groups the evidence gate refused committed nothing and planned no cluster, so a plain retry finds
   nothing; when the gate has changed since, `--retry-commits --readmit-evidence` judges them again and retries those it
   now admits (`shared/claude-md-contract.md`, the `scripts/remediate.mjs` row).
   A counted-facts drift alone does not refuse: the commit proceeds and the runner prints the stated count to update. It never pushes. If the mint fails, run it again: it mints
   without spawning the node twice. If it refuses because `<remediation run>/remediate.lock` exists, another runner
   holds the run, or one was stopped while the node may have run: the lock's `phase` says which — only `"started"` means
   the node never ran, and `"saved"` means the run finished and recorded everything but the lock's removal failed.
   Check no runner is still going, inspect the working tree for the node's edits (not needed at `"saved"`), then delete
   the lock.

   **Only one remediation runs in a repository at a time.** A second runner exits 8, naming the run that holds the
   repository lock. The lock lives under the engine's home, keyed by git's common directory, so linked worktrees share
   it, and it is released and kept with the run lock. A lock whose pid is gone on this host is called stale, with the
   file to remove; a lock from another host never is. Run the next remediation when the first has ended.

   **A group the node did not fix carries a `stop_reason`.** The runner checks a `limit` claim against the node's own
   record and names a contradicted one in `report_check`, so relay that rather than the node's prose. When a cluster the
   runner refused for changing no source file blocks another cluster, the refusal names it. Inspect that file, commit or
   discard it, then run `--retry-commits`.

3. **Read the report** — `<remediation run>/evidence/remediation/payload.json`: per group in its work list (every confirmed group, or a scoped run's chosen groups), its disposition, the
   red and green evidence, its cluster and files, the search for other instances of the defect, and what it deferred.
   The commits are the runner's, in `<remediation run>/run.json`: `clusters` (each one's commit, or why none) and
   `commit_check`.

4. **Check it, record it, review it** — the Output section below.

`remediate.mjs --unsandboxed` is the one explicit lift of the remediation policy and the only path to
`bypassPermissions` in this system. A remediation that needs it is one the operator chose to run that way; it is
recorded on the run (`unsandboxed: true`, stamped `UNSANDBOXED`).

## What the node is held to

Its contract says it in full; in short: only `confirmed` groups (a `symptom` is fixed through its `root_cause_group`);
one re-checkable claim at a time, most severe first, clustered only where groups share one re-check; **red before
green** — the failing check captured before the fix with `commands.test_one`, in the foreground, for the reason the
finding names, then the same file passing, or an honest "not expressible as a test", declared in `no_red` with the
before-state named; a finding about a test, and a symptom fixed with its root, are shown as `shared/remediation.md`
(What a fix must show) says (the check of the whole is the runner's); the smallest change that addresses the claim; the search for the same defect
elsewhere with its exact command; each cluster's test and fix committed together; nothing weakened to make a check pass;
no §6 invariant closed as acceptable risk; nothing spawned. The node may not touch `intent.md`, the reviewed run, or any
other run's artifacts.

## Output

**Run `quorate:claim-check` on the node's report before you relay it** — every `fixed`, `declined` and `not-fixed`
claim in `evidence/remediation/payload.json`. The node spawns nothing, so the check is yours; how it works is that
skill's. Relay the revised report, with one line naming the check directory.

**Record a disposition in the LEDGER for every confirmed group, not only in the report** (G-43). Prose is not checkable:
a group nobody dispositioned stays `open` while its siblings move, and `findings-ledger.mjs --summary` prints it.

```
node <framework-root>/scripts/findings-ledger.mjs --disposition fixed_claimed --run-dir <remediation run> --reason "<why>" --evidence <green capture> --group <reviewed run>:<G-n> [--group ...] --mark-fixed <key> [--mark-fixed <key> ...]
```

`<key>` is the ledger entry the group landed on: the fold of the reviewed run prints each entry's group ids beside its
key (`new  scripts/a.mjs:40 [G-3] — …`), and the entry's `sightings[]` keeps them. An entry two groups landed on is
**shared**, and a claim on it must name every one of them with `--group`, or it goes to the operator.

A remediation answers a group with `fixed_claimed`, `partial` or `declined` (a decline needs its reason), or defers it
with `open` and a reason. `withdraw`, `closed` and `reopen` exist too. What each means, who may use it, which need the
operator's words (`--operator-quote`, only when you can quote them), and why a claim must name every group its entry holds
(`--group`): `<framework-root>/shared/ledger-transitions.md`, the one owner. **`fixed_claimed` is a claim, not a
closure** — it reads `fixed` only when a later review of that file stays silent, so say "fixed pending confirmation".

**Then run the follow-up review the runner minted** — the command it printed. That review is what the next remediation,
if one is needed, works from; running a fresh sweep instead breaks the chain the round cap counts, and the next
remediation will say so.

Relay, per group: the disposition, the red and green evidence (or why there is no red), the commit, the search command
and what it deferred; then what remains unfixed and why. Be plain about partials — a report that reads complete when it
is not starts the next run from a false baseline.

(`<framework-root>` is where this framework's `scripts/` lives: the repository root in quorate itself,
`.claude/skills/quorate/` under the documented consumer mount (G-49).)
