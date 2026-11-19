"""Run the Python extractor with its SCOPE_CONSTRUCTS patched in memory: the column tests' instrument
(code-index-d1-part-b.plan.md stage 3, "one test per column"). A column nothing reads is one no patch can change.

    python -I run_with_table.py <extract.py> <patch json> <request.json>
    patch: {"<Construct>": null} removes the row; {"<Construct>": {"<column>": true|false}} sets a column.
"""
import importlib.util
import json
import sys

extractor, patch, request = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3]
spec = importlib.util.spec_from_file_location("extract", extractor)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
for construct, change in patch.items():
    if change is None:
        mod.SCOPE_CONSTRUCTS.pop(construct, None)
    else:
        mod.SCOPE_CONSTRUCTS[construct] = {**mod.SCOPE_CONSTRUCTS.get(construct, {}), **change}
with open(request, encoding="utf-8") as fh:
    print(json.dumps(mod.extract(json.load(fh))))
