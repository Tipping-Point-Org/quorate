# The bench's seed format and its admission gate

This page owns two things a project needs to benchmark quorate's lenses on defects of its own: the format a **seed** takes,
and what `scripts/bench-admit.mjs` decides about two results. It is written from the code that enforces each; where the
two disagree, the code is right and this page is the defect.

**What a consumer can do today, and what it cannot.** A project can author seeds in this format now, from defects its
own reviews found. It cannot yet run them against its own tree: `scripts/bench-lenses.mjs` seeds **this framework's**
tree, from `bench/corpus/`, and answers to this framework's contract (`bench-contract-root.design.md`). Recovering a
consumer's pre-fix tree for each seed is `--from-ledger`, deferred to after M2 (ROADMAP.md, Consumer use, item 4 of
story-pipeline's five). `bench/README.md` says how the bench runs here; this page says what a seed is.

## A seed

```
<corpus>/<id>/
  manifest.json    what the defect is and where a lens must land to have caught it
  defect.patch     a git patch that reintroduces the defect against the current tree
```

`defect.patch` recreates the **pre-discovery** state, which is the state a review exists for. It also removes the
defect's regression tests (`removes_tests: true`): a defect the suite catches fails the pre-flight barrier, and the
bench would then measure the tests instead of the lenses. The patch must apply to the tree being benchmarked; the
offline corpus check fails a seed whose patch no longer applies, so a stale seed is visible rather than silently wrong,
and is regenerated.

### `manifest.json`

Checked by `validateManifest` (`scripts/lib/bench-scoring.mjs`); a manifest it refuses is not run.

| Field | Type | Required | What it is |
|---|---|---|---|
| `id` | string | yes | A `[a-z0-9-]+` slug, equal to the seed's directory name. |
| `title` | string | yes | One line saying what the defect does. |
| `source` | string | yes | `historical` (a defect that actually shipped) or `mutation` (made for volume). Historical seeds are the ground truth a mutation only approximates. |
| `defect` | object | yes | `file`, `anchor`, `lenses`, below. |
| `defect.file` | string, non-empty | yes | The repository-relative path of the seeded file. |
| `defect.anchor` | string, non-empty | yes | A literal fragment of one line of the **seeded** file, unique within it. The defect's line is found from it when the run is scored. |
| `defect.lenses` | array, non-empty, of distinct lens names (non-empty strings, no surrounding space) | yes | The lenses expected to catch this seed, at least one. A lens's recall counts only the seeds it is named on. |
| `scope` | array, non-empty, of non-empty strings | yes | The paths handed to `new-run --full-sweep`. |
| `removes_tests` | boolean | yes | `true` when the patch strips regression tests, `false` when there were none to strip. Stated, never assumed. |
| `tolerance` | integer, non-negative | no | How many lines from the anchor a finding may land and still count (the run's `--tolerance`, 15 by default, when absent). |
| `request` | string, non-empty | no | A repository-relative path the patch itself creates: a request document the seeded run judges conformance against. Absent, the run is minted with `--no-request`. |
| `defect.line` | — | **refused** | An absolute line number rots the moment anything above the defect grows; the anchor replaced it. A manifest carrying it is refused. |

The corpus's manifests also carry `found_by`, `notes` and `defect.severity_floor`. Nothing checks or scores them: they
are the seed's own record, for whoever reads it.

**The anchor resolves or the seed fails.** `resolveAnchor` finds every line of the seeded file containing the fragment.
No match, or more than one, is a failure that names which, rather than a guess; a fragment that matches several lines
is lengthened until it matches one.

**Scoring.** A finding catches a seed when it names `defect.file` and lands within the tolerance of the anchored line.
A finding that hits no seed is a **false-positive candidate**, not a false positive: on a tree with one seeded defect
it may be a real defect, and only adjudication can say (`bench/README.md`, "Scoring").

## `bench-admit`: may a candidate setting replace the one in force?

```
node scripts/bench-admit.mjs --current <result.json> --candidate <result.json> [--fp-tolerance N] [--position <name>] [--json] [--allow-incomparable]
```

Each rule below has one owner, named by file. The verdicts, the preference rules and `comparabilityErrors` are
functions in `scripts/lib/bench-settings.mjs`; the outright refusals are checks `scripts/bench-admit.mjs` makes itself.
Each refusal, verdict and rule is named by text its owner's source contains, so the page can be searched for what a
script prints. Nothing it prints edits the contract or the roster;
adopting a setting is the operator's decision (ARCHITECTURE.md A-20).

**What it reads.** A `bench-lenses` result (`scores[]`) or a `bench-second-opinion` result (`seeds[]`), normalised by
`readBenchResult`, which owns what each shape must carry. Anything that is neither is refused, never read as zero
seeds: a gate that compared nothing once reported every one of zero seeds still caught.

**What it refuses.** Each refusal is named here under the code that owns its conditions, which this page does not
restate; every refusal prints its reason and exits `2`. Two kinds:

**Outright**, with no override: the checks `scripts/bench-admit.mjs` makes itself after reading both files, which
refuse a pair that cannot measure a setting at all.

- `different harnesses` — one file is a `bench-lenses` result and the other a `bench-second-opinion` result.
- `no caught seeds` — the current result catches nothing, so there is no baseline to regress against.
- `the two results disagree on` — two `bench-second-opinion` results that differ on a key saying which mutation they
  measured; the reason names the key.

**Not comparable** (`comparabilityErrors`, `scripts/lib/bench-settings.mjs`): a pair that differs in more than the
setting, so a verdict would not be about the setting. `--allow-incomparable` compares it anyway and prints every reason
on the record.

- `different corpus_commit` — the two sweeps seeded different trees.
- `different reporter sets` — the two sweeps ran different nodes.
- `no node ran at a different setting` — the nodes both sweeps ran are at the same settings on both sides.
- `both results are at the same setting` — the same, for results that carry no per-node records.

**The verdict** (`admissionVerdict`), one of three:

- `rejected` — a seed the current setting catches is not caught by the candidate, or the false-positive count rose by
  more than `--fp-tolerance`. The regressing seeds are named.
- `admitted` — every such seed is still caught, and the false-positive clause was decided in the candidate's favour.
- `undecided` — no seed regressed, but a clause could not be decided. `undecided_clause` names which, checked in
  this order:
  - `coverage` — a seed the current setting catches has no verdict from the candidate: it was never run (`absent`),
    or it ran and the judge did not settle it (`unscoreable`). Admission needs the whole set, so a seed with no verdict
    is an open question, not a pass.
  - `false-positive rise` — every such seed was scored, but no `--fp-tolerance` was given, so the false-positive clause
    could not be evaluated. It has no default on purpose: a built-in number would be nobody's decision wearing a
    gate's authority.

**The preferred setting** (`preferredSetting`), when admitted:

- `dominance` — better or equal on tokens, wall-clock and false-positive candidates, strictly better on at least one.
- `tiebreak-10pct` — within 10% on tokens, the faster.
- `genuine-trade` — neither: surfaced as a trade for the operator, never resolved here.
- `not-admitted` — the candidate was not admitted, so the current setting stays.
- `undecidable` — tokens or wall-clock is missing from either result, so dominance cannot be proven and nothing is
  preferred (`preferred: null`). A metric the vendor never reported is missing, not zero: it is never imputed.

**Exit codes:** `1` when the verdict is `rejected`; `0` otherwise, `undecided` included, so a caller reads the verdict,
not only the exit code; `2` for usage, an unreadable file, or a pair it refuses to compare.
