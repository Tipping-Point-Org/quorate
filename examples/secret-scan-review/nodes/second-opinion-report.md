# second-opinion

_Session `57bec6a8-3449-4dd6-8895-e054f81a557b` — verbatim._

The reconciler got the substance right, but the HIGH on G-10 rests on corroboration it describes in a way the groups don't support. That is the most consequential problem I found. G-10's "Raised by" lists only the four `panel-codex-*` arms. The Claude lens it cites as agreeing, `contract-audit`, sits in G-11 and not in G-10. The reconciler then lifts G-10 above the arms' MEDIUM ceiling, and the reason it gives is that "agreement across lens and arms is strong corroboration". So the cross-family agreement that justifies the lift happens in another group. Within G-10 itself, the only agreement is codex agreeing with codex.

Calling the four arms "four independent external (codex) arms" overstates it as well. They are one model family under four lens briefs. They are four angles, not four independent observations, which is close to the "agreement mistaken for corroboration" pattern.

I read `scripts/publish.mjs:385-408` myself. The commit is made at line 388, the scan runs at line 402, and the failure path at lines 404-405 only tells the operator to run `reset --soft`. So the defect is real, and HIGH is defensible on consequence: a rejected snapshot is left at HEAD, one `git push` away from the public mirror. It just needs a correct basis.

**Recommendation:** fix the group, not the severity. Either fold the commit-ordering half of `contract-audit`'s G-11 item into G-10, or state that G-10's HIGH rests on the lens observation recorded under G-11. As it stands, anyone checking G-10 against its own raiser list cannot reconstruct why it is above the cap.

## Group by group

- **G-10: concur on defect and root.** The "root cause of G-11's commit-before-scan half" direction is right: the ordering at line 388 is the cause, and the missing-scanner branch at lines 399-400 is a separate defect.
  - It is not a §6 invariant breach on its own. Nothing is pushed; the hazard is the next ordinary push, so the HIGH is about consequence rather than an invariant. I agree with not escalating further.
- **G-11: concur, MEDIUM.** The missing-scanner bypass (lines 399-400) and the unrecorded `stdio: 'inherit'` result (line 402) are both visible in the source. This is the one group with genuine lens-plus-arm agreement.
  - The arch arm's "policy belongs in lib/" item is a different claim, an ARCHITECTURE §2 layering note. Reconcile itself calls it separate but left it inside the group. It should be split out so a remediation doesn't treat it as covered by fixing the bypass.
- **G-7: concur, MEDIUM, single arm, checked against source.** An unpinned identity matters on a publish path.
  - The intent clause is cited as "I-?". Remediation needs the real I-id; that is a gap in the record, not an argument against the finding.
- **G-2: concur.** A leak guard that misses `<home> is a real detection gap. I did not re-run the regex.
- **G-1: concur, LOW.** The paths are gitignored, so only a force-added file would ship.
- **G-3: concur, LOW.** It is downstream of G-10 and should be fixed together with it.
- **G-4: concur, LOW.** The trim is a documented choice, and the secret-bearing content has to stay identical to keep its allowance.
- **G-5, G-6, G-9 (dropped): concur.**
  - Codex speculated about the cost with no benchmark, and the inputs come from the operator.
  - G-5's zero-width regex comes from the tracked manifest, which only the operator writes.
  - G-9 only matters once there are findings, and any finding already refuses the publish.
- **G-8 (dropped): concur, after reading the evidence.** Line 103 uses `--untracked-files=no`, but the snapshot is read through `git show <sourceCommit>:<path>` (lines 116-118). Untracked content cannot enter the snapshot, so the failure mode the intent names cannot happen this way.

No group is marked disputed, so I had no dispute declarations to audit. No required node is missing.

## Out-of-scope observation

The refusal message at line 404 tells the operator to `reset --soft HEAD~1`. On a first publish into an empty clone, HEAD~1 does not exist. That is a future-run item, not a finding for this run.

## Not checked

- I did not read `finding-groups.json`, `gate.json`, the raw arm logs or `intent.md`. The concurrences above rest on the source lines I read, not on the evidence files, except where I say otherwise.
- I did not test the regex in G-2.
- The intent's I-ids are unresolved (I-? in G-7 and G-8).
- Standing entries:
  - commands.lint: empty in graph_contract — lint could not be run
  - commands.fmt_check: empty in graph_contract — fmt_check could not be run
  - commands.typecheck: empty in graph_contract — typecheck could not be run
  - commands.bench: empty in graph_contract — bench could not be run
  - commands.run: empty in graph_contract — run could not be run
  - commands.audit: empty in graph_contract — audit could not be run
  - commands.deny: empty in graph_contract — deny could not be run
  - commands.test_product: empty in graph_contract — test_product could not be run
  - ui.static_bundle: not declared; no built bundle was inspected
- **brief-gap:** The brief did not say that every arm is one family, which is what decides how much weight the "four arms" agreement carries. Giving the intent's I-number index would have let me resolve the "I-?" citations instead of only flagging them.
