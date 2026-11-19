# Brief — remediation, repair pass {{pass}} of {{cap}}

run_id: {{run_id}}
GRAPH_NODE_DEPTH=1 — you may not spawn subprocesses beyond capture.mjs.

The fixes this run reported are in the working tree, uncommitted. The runner checked them together with every declared
check, and these tests failed, each as a `test_name:` line and its `test_file:` line:

{{failing}}

The full check's log: {{log_path}}

The clusters the fixes were reported in, and their files:

{{clusters}}

Your work is these failures only: make them pass on top of the fixes, without weakening a test to pass. Follow the
"Repair pass" section of your contract (prompts/remediation/PROMPT.md).

capture_cmd: {{capture_cmd}}
{{test_one}}
{{limits}}

Evidence you capture goes under this run's evidence/remediation/, its name starting `repair{{pass}}-`. You do not commit:
answer every failing test above with its cluster and files, and the runner checks the whole again after you exit.
