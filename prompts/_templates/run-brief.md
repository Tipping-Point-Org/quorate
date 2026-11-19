# Brief — {{node_id}}

run_id: {{run_id}}
node_id: {{node_id}}
mode: lens
GRAPH_NODE_DEPTH=1 — you may not spawn subprocesses beyond the §8 exemptions: capture.mjs (the only way to produce an evidence path) and find-inert-features.mjs. The absolute form used to contradict the evidence rule and had literal-minded nodes produce nothing (G-24).
base_commit: {{base_commit}}
repository_root: {{repo_root}}
doctrine_path: {{doctrine_path}}

## Intent
{{intent_block}}

## Scope
{{scope_origin}}
full_sweep_paths: {{full_sweep_paths}}
changed_files: {{changed_files}}
source_globs: {{source_globs}}
test_globs: {{test_globs}}
generated_globs (never report): {{generated_globs}}
doc_paths: {{doc_paths}}

{{remediation_census}}

**test_globs WINS over source_globs.** A file matching both is TEST code, and test code is
reviewed under one question only: *does this test actually constrain the behaviour it claims to?*
Admissible findings on a test file are exactly these — it passes vacuously or tautologically; it
asserts nothing; it cannot fail for the reason it was written; it is flaky; it silently skips.
Nothing else. Do not report style, structure, duplication, naming, coverage gaps, or "this could
be a helper" on a test file.

This is a TERMINATION rule, not a courtesy. A bug produces a test; a test is code; if test code is
reviewed like production code it produces findings, which produce tests, which produce findings.
The recursion stops here because a test's correctness is settled by an experiment — it fails before
the fix and passes after — and not by a further review. Judgment applies to what the code should
do; a test only has to go red for the right reason, and that is checkable without you.

## Declared documents
{{doc_roles_block}}
ui.surface: {{ui_surface}}
ui.static_bundle: {{ui_static_bundle}}

## Your basis enum
{{allowed_basis}}
{{severity_ceiling_line}}
{{severity_floor_line}}
{{verdict_ceiling_line}}

## Evidence
Your evidence dir is evidence/{{node_id}}/. Produce every evidence path with:
  node {{capture_rel}} --run-dir {{run_dir}} --node {{node_id}} --name <slug> -- <command>
Cite exactly the path it prints. A path you did not see printed will be rejected.

The other §8 exemption, resolved for this mount — use it verbatim rather than guessing a
framework root, which is neither the repository root nor a fixed offset from it. It produces
evidence, so it runs THROUGH capture.mjs like every other command, and the absolute spelling below
is the only one capture admits (a relative path would resolve against the working directory, so
capture executes a framework script only by a path derived from its own location):
  node {{capture_rel}} --run-dir {{run_dir}} --node {{node_id}} --name inert-sweep -- node {{detector_abs}}

Run it EXACTLY as written above, one capture per tool call. Do not chain captures with \`;\` or
\`&&\`, do not add \`echo\`, and do not prefix it with \`cd\` — --run-dir is already absolute. The
chain is judged as a unit by the permission policy, so one \`echo\` can deny every capture in it,
not just that segment. A denied capture prints no path, and with no path you cannot cite the finding
it would have substantiated — so a chained capture silently costs you findings you already did the
work for. Run them one per tool call and this cannot happen either way.

**A capture is evidence for a claim only if its command targets that claim.** A clean build log
proves the code compiles; it does not prove a serialization mismatch, a wrong default, or a
missing field, and citing it for one of those is citing nothing. Before you cite a path, ask what
a reader would see in that file that makes this specific finding true — if the answer is "nothing
in particular", capture something that does: the grep that shows the offending line, the command
whose output contradicts the declared behaviour, the diagnostic that names the symbol.

Name each capture after the claim it substantiates (\`--name modality-enum\`, not \`--name build\`),
and expect roughly one capture per finding. Reusing a single whole-project log across many
findings is the specific failure this instruction exists to prevent: it was the main criticism of
an earlier run of this lens, where eleven of thirteen findings pointed at one clean build log.
Cite \`build.log\` only for a finding about the build itself.

## Declared commands you may run
{{allowed_commands}}

## Standing not_checked entries — include these verbatim
{{standing_block}}

## Run stamps — what this run already knows about itself
{{stamps_block}}
## Threat model
{{threat_model}}

{{project_profile}}
