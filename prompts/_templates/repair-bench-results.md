# The repair pass, measured on real refusals

Written by `scripts/bench-repair-pass.mjs` (`remediation-repair-pass.plan.md` stage 4) from every case it has measured;
{{cases}} case(s) so far. Each case is a remediation of this repository whose full check refused its candidate, rebuilt
in a worktree at the head that check recorded and given repair passes up to the cap it ran at (`--cap`, three unless
set), committing nothing. The raw record
(each case's `result.json`, each repair node's whole output, the runner's logs, the scratch runs) stays machine-local
under the engine's home, `~/.quorate/bench-repair/`. A case is a sample of one, and every figure below is beside its n.
The full-check column leaves out one check per case that the bench's own design adds: the retry that runs the repair
passes checks the candidate again before the first pass (as long as the reproduction), and wall time includes it.

| Case | Status | Failing tests recorded | Green after pass | Passes run | Repair node time | Full-check time (reproduction, and after each pass) | Repair diff vs candidate | Repair tokens | Repair vendor cost | Wall time |
|---|---|---|---|---|---|---|---|---|---|---|
{{rows}}

## Outcomes

{{outcomes}}

## Totals

{{totals}}

## Not measured

{{not_measured}}

## Superseded

{{superseded}}
