# Scaffold contract

**This set deliberately ships no scaffolding skills.** There is no `node-scaffold`, no
`test-scaffold`, no generator of any kind. This file explains why, and specifies what a host
repo's own generators must do to participate in the verification graph.

## Why no scaffolds

The reasoning that kept `plan-review` and `arch-review` portable is the same reasoning that
killed the scaffolds, applied in the other direction.

A *review* skill can be portable because it reviews against whatever the host repo **declares**:
point `doc_roles.architecture` at a document and the skill has something to check against. The
skill supplies method; the repo supplies substance.

A *generator* has no such split. Emitting code means committing to a language, a module layout,
a test framework, an error-handling idiom, and a naming convention — none of which can be
declared in a contract block without the block becoming the codebase. A portable generator would
either emit something so generic it must be rewritten, or smuggle in one project's conventions
under the guise of a default. Both produce code that then flows into the same graph that is
supposed to be judging it independently.

So: **the graph reviews. The host repo generates.** A repo that wants scaffolding writes its own
generator, in its own idiom, and makes it emit into the graph through the interface below.

## What a host generator must satisfy

A generator participates by producing evidence the graph can consume. It does **not** become a
lens and it does not emit verdicts.

1. **Write nothing into a run directory it does not own.** A generator run is not a review run.
   If it wants its output reviewed, it produces files in the working tree and lets the next
   verification run pick them up through `source_globs` like any other change.

2. **Emit a manifest.** Machine-readable, at a path the repo declares, listing every file created
   or modified with its role:

   ```json
   { "generator": "<name>", "version": "<v>", "generated_at": "<iso8601>",
     "emitted": [ { "path": "src/foo/mod.rs", "role": "implementation", "from_template": "module.rs.tmpl" },
                  { "path": "src/foo/tests.rs", "role": "test", "covers": ["src/foo/mod.rs"] } ] }
   ```

   Without this, generated code is indistinguishable from hand-written code, and lenses spend
   their budget reviewing template boilerplate as though a person had chosen every line.

   **Nothing in the engine reads this today** (G-64). There is no contract key naming a manifest
   path and no code that consumes `emitted`, `from_template` or `generated_at`, so emitting one buys
   exactly one thing: a lens that happens to be pointed at the manifest can cite it, and a person
   reading a finding can tell boilerplate from a choice. This page asked for a manifest in the
   imperative while its own closing section said no reader exists — a requirement whose benefit is
   described in the present tense and delivered by nothing is the inert-guarantee shape this project
   keeps finding in itself, so the state is written down instead. Emit it because it is true and
   cheap, not because the graph will act on it.

3. **Declare generated output in `generated_globs`** if it is genuinely not meant to be reviewed.
   Be honest about which case applies: `generated_globs` means "nobody reviews this, ever". Code
   a human will edit next week does not belong there — it belongs in `source_globs` with a
   manifest saying where it came from.

4. **Never emit a test that asserts nothing.** A generated test that only checks the code
   compiles is worse than no test: it inflates the count that `TESTS-THIN` measures, and it makes
   a `checked_clean` claim about coverage defensible when it is not. If the template cannot
   produce a meaningful assertion, emit the test with an explicit `todo!()`/skip marker so the
   gap is visible.

5. **Never run inside a graph node.** Generation is not verification. A lens that generates code
   has modified the artifact it was asked to judge, and every finding it then reports is about
   its own work.

## How the graph treats generated code

- Files matched by `generated_globs` are excluded from scope entirely; a finding pointing at one
  is moved to `out_of_scope_observations[]` by the spawner's validator.
- Files listed in a manifest but inside `source_globs` are reviewed normally. A lens that can
  read the manifest should note provenance in its claim — "this is generated from
  `module.rs.tmpl`, so the defect is in the template and will recur" is a materially more useful
  finding than the same defect reported once per generated file.
- A defect that recurs identically across several generated files is **one** finding against the
  template, not N findings. The reconciler groups by file and line and will not catch this on
  its own; it is the lens's job to say so.

## If you are reading this because you want a scaffold skill

Write the generator in your repo, in your language, with your conventions. Then decide, per tree,
which of two things you actually want — because they are opposites and this paragraph used to
describe them as one (G-65):

- **`generated_globs` means nobody reviews it, ever.** Matched files are excluded from scope
  entirely, and a finding that names one is demoted to `out_of_scope_observations[]`. "Reported and
  not counted" is what happens to a finding a lens reached by another route; it is not a review.
  Putting a tree here to get it reviewed prevents the review.
- **`source_globs` means reviewed like anything else**, with a manifest recording where each file
  came from. This is where generated code a person will edit next week belongs.

The hand-written code that CONSUMES a generated tree is always `source_globs`.

There is still no manifest key, and rule 2 above now says so where the requirement is stated rather
than only down here. An earlier version of this page told hosts to "add its manifest path to the
contract"; the contract defines no such key and no reader consumes one, so following that
instruction configured nothing. The graph's value
is that it judges your code from the outside; a generator inside the graph would be judging its
own.
