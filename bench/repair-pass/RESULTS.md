# The repair pass, measured on real refusals

Written by `scripts/bench-repair-pass.mjs` (`remediation-repair-pass.plan.md` stage 4) from every case it has measured;
6 case(s) so far. Each case is a remediation of this repository whose full check refused its candidate, rebuilt
in a worktree at the head that check recorded and given repair passes up to the cap it ran at (`--cap`, three unless
set), committing nothing. The raw record
(each case's `result.json`, each repair node's whole output, the runner's logs, the scratch runs) stays machine-local
under the engine's home, `~/.quorate/bench-repair/`. A case is a sample of one, and every figure below is beside its n.
The full-check column leaves out one check per case that the bench's own design adds: the retry that runs the repair
passes checks the candidate again before the first pass (as long as the reproduction), and wall time includes it.

| Case | Status | Failing tests recorded | Green after pass | Passes run | Repair node time | Full-check time (reproduction, and after each pass) | Repair diff vs candidate | Repair tokens | Repair vendor cost | Wall time |
|---|---|---|---|---|---|---|---|---|---|---|
| 20261101-075544-dr-remediation-2 | measured | 2 | 1 | 1 | 1.8 min | 29.9 min | 2 file(s), +7 -2 (rebuilt) | 1736295 | $1.28 | 46.9 min |
| 20261030-040405-rdr-remediation-8 | measured | 1 | 1 | 1 | 0.7 min | 29.3 min | 1 file(s), +2 -1 (rebuilt) | 471560 | $0.57 | 44.3 min |
| 20261030-191916-ciss-remaining-remediation | measured | 1 | 1 | 1 | 1.7 min | 28.0 min | 3 file(s), +24 -2 | 1036078 | $0.99 | 43.7 min |
| 20261025-082729-srf-remediation | measured | 5 | 1 | 1 | 1.4 min | 29.7 min | 1 file(s), +10 -2 | 1084832 | $0.83 | 46.1 min |
| 20261031-040606-urr-remediation-3 | measured | 2 | never | 2 | 2.2 min | n/a | 1 file(s), +4 -0 | 1269323 | $1.46 | 45.2 min |
| 20261024-003108-rmg-remediation-3b | no-pass: no repair pass was offered: the retry's check refused on test (did not run to completion (timed out: killed by capture at its deadline) (evidence/remediation-ru | 2 | n/a | 0 | 0.0 min | 14.6 min | n/a | n/a | n/a | 30.1 min |

## Outcomes

- green after pass 1: 4 of 5
- green after pass 2: 0 of 5
- green after pass 3: 0 of 5
- never green within the cap: 1 of 5
- 20261031-040606-urr-remediation-3, pass 2 not admitted: the pass changed nothing

## Totals

- cases attempted: 6; measured: 5; not measured: 1
- repair passes run: 6 (n = 5 case(s))
- repair node time: 7.7 min over 6 pass(es)
- full-check time, reproduction included: n/a (n = 5)
- repair node vendor cost: $5.12 over 6 pass(es), as each node's own output reports it
- wall time, every case: 256.3 min (n = 6)
- (rebuilt): 2 case(s) whose diff was rebuilt after the run: rebuilt after the run from the repair node's own transcript (its Edit calls applied to the file as it was before the repair); the bench's own figure compared a file outside the candidate with an empty file

## Not measured

- 20261024-003108-rmg-remediation-3b: no-pass — no repair pass was offered: the retry's check refused on test (did not run to completion (timed out: killed by capture at its deadline) (evidence/remediation-runner/test.2.log))

## Superseded

- 20261030-191916-ciss-remaining-remediation, measured 2026-11-01T21:29:01.242Z: measured, green after never; superseded by 20261101T232348-20261030-191916-ciss-remaining-remediation: measured again after d05e17c2 fixed the repair brief: its pass had been refused because the node copied the brief's "<name> (<file>)" line into test_name
- 20261101-075544-dr-remediation-2, measured 2026-11-02T15:27:45.898Z: measured, green after 1; superseded by 20261101T195740 (the stage 4 result of this case, which stays counted): repair-bench-replay.plan.md stage 5: the same case re-measured with the replay moved into remediate.mjs --replay-node, listed apart so the case is counted once; same outcome (reproduced, green after pass 1)
