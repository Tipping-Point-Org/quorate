"""Every call node in the given Python files, as the parser defines one (ast.Call): the census coverage test's
independent count, so it does not depend on the extractor's own idea of where calls are.

    python -I list_calls.py <root> <file> [<file> ...]   ->  JSON [{file, line, col, text}]
"""
import ast
import json
import sys

root, files = sys.argv[1], sys.argv[2:]
out = []
for rel in files:
    with open(f"{root}/{rel}", encoding="utf-8") as fh:
        tree = ast.parse(fh.read(), filename=rel)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            out.append({"file": rel, "line": node.lineno, "col": node.col_offset, "text": ast.unparse(node.func)})
print(json.dumps(out))
