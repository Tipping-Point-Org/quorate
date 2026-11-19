"""quorate's reference Python extractor for the code index (shared/code-index.md).

Standard library only. Two calls:

    extract.py --identity --root <repository root>
    extract.py --language python --request <request.json>

The first prints who this extractor is, without reading any source. The second reads the request, parses every file it
names, and prints one response: every file accounted for, and the facts of every file that parsed. A name is resolved
one hop, through the module's own definitions, its import table, or the builtins; anything else is emitted with
resolved false rather than dropped.
"""
import argparse
import ast
import builtins
import collections
import hashlib
import json
import math
import os
import sys

NAME = "quorate-python"

# The constructs this extractor models as scopes and binders: generated from shared/code-index.md's Python table (the one
# hand-kept copy) by `node scripts/gen-rule-text.mjs`; do not edit inside the markers (code-index-d1-part-b.plan.md stage 2).
# rule:scope-constructs language="python"
SCOPE_CONSTRUCTS = {
    "Module": {"opens_scope": True, "visible_to_nested": True, "binds_in_parent": False},
    "FunctionDef": {"opens_scope": True, "visible_to_nested": True, "binds_in_parent": True},
    "AsyncFunctionDef": {"opens_scope": True, "visible_to_nested": True, "binds_in_parent": True},
    "Lambda": {"opens_scope": True, "visible_to_nested": True, "binds_in_parent": False},
    "ClassDef": {"opens_scope": True, "visible_to_nested": False, "binds_in_parent": True},
    "Import": {"opens_scope": False, "visible_to_nested": False, "binds_in_parent": True},
    "ImportFrom": {"opens_scope": False, "visible_to_nested": False, "binds_in_parent": True},
}
# /rule:scope-constructs

# Every node type that opens a scope in Python (the language reference, "Execution model": modules, function and class
# bodies, lambdas, comprehensions, and the annotation scopes of 3.12's type statement). One the table above does not
# model opens an OPAQUE scope: every call inside it answers resolved false (fail closed, design B-D1), instead of
# resolving through a scope this extractor does not understand. Type parameters (3.12) are annotation scopes too; they
# are not visited at all, so their calls reach the completion pass, unresolved.
LANGUAGE_SCOPES = {"Module", "FunctionDef", "AsyncFunctionDef", "Lambda", "ClassDef", "ListComp", "SetComp", "DictComp",
                   "GeneratorExp", "TypeAlias"}


def modelled_scope(kind):
    return SCOPE_CONSTRUCTS.get(kind, {}).get("opens_scope", False)


def binds(kind):
    return SCOPE_CONSTRUCTS.get(kind, {}).get("binds_in_parent", False)


def visible_to_nested(kind):
    return SCOPE_CONSTRUCTS.get(kind, {}).get("visible_to_nested", False)
VERSION = "1"
SCHEMA = 1
BUILTINS = set(dir(builtins))


def identity(root):
    here = os.path.abspath(__file__)
    with open(here, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    v = sys.version_info
    return {
        "name": NAME,
        "version": VERSION,
        "runtime": "python %d.%d.%d" % (v.major, v.minor, v.micro),
        "parser": "ast (stdlib)",
        "modules": {os.path.basename(here): digest},
        # This extractor reads no configuration file, and says so (conformance requires the declaration).
        "reads": [],
        # What it models, for the engine to compare with the contract's table (code-index-d1-part-b.plan.md stage 5).
        "scope_constructs": SCOPE_CONSTRUCTS,
    }


def module_name(rel, import_roots):
    """The dotted module of a file, relative to the first import root that contains it."""
    rel = rel.replace("\\", "/")
    for r in import_roots:
        r = r.strip("/").replace("\\", "/")
        if r and (rel == r or rel.startswith(r + "/")):
            rel = rel[len(r) + 1:]
            break
    if rel.endswith(".py"):
        rel = rel[:-3]
    parts = [p for p in rel.split("/") if p]
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def span(node):
    return {
        "start": {"line": node.lineno, "col": node.col_offset},
        "end": {"line": getattr(node, "end_lineno", node.lineno) or node.lineno,
                "col": getattr(node, "end_col_offset", node.col_offset) or node.col_offset},
    }


def text(node):
    try:
        return ast.unparse(node)
    except Exception:  # an extractor reports what it could not render rather than failing the file
        return "<unrenderable>"


def dotted(node):
    """a.b.c for a chain of names and attributes, else None."""
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def arg_kind(node):
    if isinstance(node, ast.Name):
        return "name"
    if isinstance(node, ast.Attribute):
        return "attribute"
    if isinstance(node, ast.Call):
        return "call"
    if isinstance(node, ast.Constant):
        return "literal"
    return "other"


def describe(node, keyword=None):
    d = {"keyword": keyword, "text": text(node), "kind": arg_kind(node)}
    if isinstance(node, ast.Attribute):
        p = dotted(node)
        if p:
            d["path"] = p
    return d


LITERAL_TYPES = (str, int, float, bool)


def is_literal(v):
    """A constant the schema's literal type and JSON can both carry: a string, a finite number or a boolean (G-14 of
    20261020-094311-ciss-delivery). None, bytes, complex and Ellipsis are not, and 1e999 would print Infinity."""
    return isinstance(v, LITERAL_TYPES) and not (isinstance(v, float) and not math.isfinite(v))


def literal_type(v):
    return type(v).__name__


# Every binding Python's grammar defines, by the ast class that carries it (D3 of code-index-schema-and-scope; plan
# stage 2). A Name in Store or Del context is counted wherever it appears; these are the bindings that carry the name as
# a string instead. A test enumerates every ast class with a field named name, names, asname, arg or rest, and fails
# when one is in neither this table nor NON_BINDING, so a binding form the grammar adds is not missed.
BINDING_FIELDS = {
    "FunctionDef": "name", "AsyncFunctionDef": "name", "ClassDef": "name", "ExceptHandler": "name",
    "MatchAs": "name", "MatchStar": "name", "MatchMapping": "rest", "Global": "names", "Nonlocal": "names",
    "TypeVar": "name", "ParamSpec": "name", "TypeVarTuple": "name", "alias": "alias", "arg": "arg",
}
NON_BINDING = {
    "keyword": "arg is a call's keyword name, not a binding",
    "Import": "names holds alias nodes, counted as alias",
    "ImportFrom": "names holds alias nodes, counted as alias",
    "TypeAlias": "name is a Name in Store context, counted there",
}


def bindings(nodes):
    """How many times each name is bound among these nodes and everything inside them, nested scopes included."""
    counts = {}

    def add(n):
        if n:
            counts[n] = counts.get(n, 0) + 1

    todo = list(nodes)
    while todo:
        node = todo.pop()
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            add(node.id)
        field = BINDING_FIELDS.get(type(node).__name__)
        if field == "alias":
            add(node.asname or node.name.split(".")[0])
        elif field == "names":
            for n in node.names:
                add(n)
        elif field:
            add(getattr(node, field, None))
        todo.extend(ast.iter_child_nodes(node))
    return counts


def scope_counts(nodes):
    """How many times each name is bound IN ONE SCOPE, and how many of those bindings are by a modelled binder (a def,
    class or import whose table row binds in its enclosing scope): (total, modelled). It does not descend into the bodies
    of nested functions, classes and lambdas, whose bindings are their own; it does count their names, and the walrus or
    other binding in their decorators, bases, defaults and annotations, which bind here. It does descend into
    comprehensions, so their targets are counted here too: an over-count, which only makes more calls unresolved."""
    total, modelled = {}, {}

    def add(n, is_modelled=False):
        if n:
            total[n] = total.get(n, 0) + 1
            if is_modelled:
                modelled[n] = modelled.get(n, 0) + 1

    todo = list(nodes)
    while todo:
        node = todo.pop()
        kind = type(node).__name__
        if kind in ("FunctionDef", "AsyncFunctionDef", "ClassDef"):
            add(node.name, binds(kind))
            outside = list(node.decorator_list) + list(getattr(node, "bases", [])) + list(getattr(node, "keywords", []))
            if kind != "ClassDef":
                outside += list(node.args.defaults) + [d for d in node.args.kw_defaults if d is not None]
                outside += [a.annotation for a in ast_args(node.args) if a.annotation is not None]
                outside += [node.returns] if node.returns is not None else []
            todo.extend(outside)
            continue
        if kind == "Lambda":
            todo.extend(list(node.args.defaults) + [d for d in node.args.kw_defaults if d is not None])
            continue
        if kind in ("Import", "ImportFrom"):
            for a in node.names:
                if a.name != "*":
                    add(a.asname or a.name.split(".")[0], binds(kind))
            continue
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            add(node.id)
        field = BINDING_FIELDS.get(kind)
        if field == "names":
            for n in node.names:
                add(n)
        elif field and field != "alias":
            add(getattr(node, field, None))
        todo.extend(ast.iter_child_nodes(node))
    return total, modelled


def ast_args(args):
    return list(args.posonlyargs) + list(args.args) + list(args.kwonlyargs) + [a for a in (args.vararg, args.kwarg) if a]


def single_literals(body, counts):
    """D3: the names bound exactly once in a scope, by an assignment of a literal: name -> literal. Nothing else is tracked."""
    out = {}
    todo = list(body)
    while todo:
        node = todo.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            continue
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) \
                and isinstance(node.value, ast.Constant) and is_literal(node.value.value) \
                and counts.get(node.targets[0].id) == 1:
            out[node.targets[0].id] = node.value.value
        todo.extend(ast.iter_child_nodes(node))
    return out


class Module:
    """One file's names, and the scope stack its visitor walks (D2 of code-index-schema-and-scope).

    A name resolves through exactly: the innermost scope's own definitions and imports (a function body, or a class body
    for code at class level); then the module's top-level definitions and imports; then the builtins. `self.m()` (the
    method's first parameter) resolves to the enclosing class's own method m. A name the innermost scope binds any other
    way, a closure's outer name, and a class body's name seen from a method, resolve to nothing: resolved false.
    """

    def __init__(self, name, tree, is_package):
        self.name = name
        self.package = name if is_package else name.rpartition(".")[0]
        self.defs = self.own_defs(tree.body, name)
        # Every class a scope's body declares, nested ones too, by the qualified name resolve() gives it: top-level only
        # left a nested class's construction out of constructions (G-4 of 20261021-162807-ciss-d1-review).
        self.classes = self.class_names(tree.body, name)
        self.imports = self.imports_of(tree.body)
        # The module's own bindings, counted (design B-D1): a name the module binds by an assignment, a loop, a with, an
        # except, a walrus or a match, as well as by a def, no longer resolves to the def. The module's bound set was never
        # consulted, so `len = f()` then `len()` resolved to builtins.len (census p15).
        self.total, self.modelled = scope_counts(tree.body)
        self.scopes = []
        # How many unmodelled scopes (LANGUAGE_SCOPES not in SCOPE_CONSTRUCTS) enclose the node being visited.
        self.opaque = 0

    @staticmethod
    def scope_statements(body):
        """One scope's statements with those of its if, for, while, with, try and match blocks, which open no scope; not
        the bodies of the functions and classes in it. Direct statements only left a class or function declared in a block
        out of the scope (G-1 of 20261021-190234-ciss-d1-remediations-review)."""
        out = []
        todo = list(reversed(body))
        while todo:
            node = todo.pop()
            if isinstance(node, ast.stmt):
                out.append(node)
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    continue
            todo.extend(reversed([c for c in ast.iter_child_nodes(node)
                                  if isinstance(c, (ast.stmt, ast.excepthandler, ast.match_case))]))
        return out

    @staticmethod
    def own_defs(body, qualified):
        """The functions and classes one scope's body defines: name -> qualified."""
        return {node.name: "%s.%s" % (qualified, node.name) for node in Module.scope_statements(body)
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}

    @staticmethod
    def class_names(body, qualified):
        """The qualified names of the classes one scope's body defines, and those its functions and classes define."""
        out = set()
        for node in Module.scope_statements(body):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                q = "%s.%s" % (qualified, node.name)
                if isinstance(node, ast.ClassDef):
                    out.add(q)
                out |= Module.class_names(node.body, q)
        return out

    def imports_of(self, body):
        """The import bindings one scope's body makes: its own statements, not those of the functions and classes in it."""
        out = {}
        # A deque, in the same breadth-first order: popping a list's front shifted the rest each time, quadratic in the scope's size
        # (G-2 of 20261021-190234-ciss-d1-remediations-review).
        todo = collections.deque(body)
        while todo:
            node = todo.popleft()
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
                continue
            if isinstance(node, ast.Import):
                for a in node.names:
                    if a.asname:
                        out[a.asname] = a.name
                    else:
                        top = a.name.split(".")[0]
                        out[top] = top
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                if node.level:
                    pkg = self.package.split(".") if self.package else []
                    pkg = pkg[: len(pkg) - (node.level - 1)] if node.level > 1 else pkg
                    base = ".".join([p for p in pkg + ([base] if base else []) if p])
                for a in node.names:
                    if a.name == "*":
                        continue
                    out[a.asname or a.name] = "%s.%s" % (base, a.name) if base else a.name
            else:
                todo.extend(ast.iter_child_nodes(node))
        return out

    def enter(self, kind, qualified, node):
        """Open a function or class scope. A method's first positional parameter is its `self`. A lambda is a function
        scope whose body is one expression: it defines and imports nothing, and is no method."""
        is_lambda = isinstance(node, ast.Lambda)
        body = [node.body] if is_lambda else node.body
        parent = self.scopes[-1] if self.scopes else None
        scope = {"kind": kind, "node": type(node).__name__, "qualified": qualified,
                 "defs": {} if is_lambda else self.own_defs(body, qualified),
                 "imports": {} if is_lambda else self.imports_of(body), "self": None, "class": None}
        # This scope's own bindings (scope_counts), parameters included, for resolution; `bound`, which also counts
        # nested scopes, stays what the literal rules read (D3 of code-index-schema-and-scope).
        scope["total"], scope["modelled"] = scope_counts(body)
        if kind == "function":
            for a in ast_args(node.args):
                scope["total"][a.arg] = scope["total"].get(a.arg, 0) + 1
            scope["bound"] = bindings(list(node.args.posonlyargs) + list(node.args.args) + list(node.args.kwonlyargs)
                                      + [a for a in (node.args.vararg, node.args.kwarg) if a] + list(body))
            positional = list(node.args.posonlyargs) + list(node.args.args)
            # Only an undecorated method has a receiver: decorator text cannot say what the first parameter is (an alias
            # of staticmethod, builtins.staticmethod, a wrapper), so a decorated method's calls through it fail closed (G-2).
            if not is_lambda and parent is not None and parent["kind"] == "class" and positional and not node.decorator_list:
                scope["self"] = positional[0].arg
                scope["class"] = parent
        else:
            scope["bound"] = bindings(body)
        self.scopes.append(scope)
        return scope

    def leave(self):
        self.scopes.pop()

    def import_of(self, local):
        """What an import binding means where it is made: the innermost scope's own imports, then the module's."""
        if self.scopes and local in self.scopes[-1]["imports"]:
            return self.scopes[-1]["imports"][local]
        return self.imports.get(local)

    @staticmethod
    def only_modelled(scope_total, scope_modelled, name):
        """True when every binding of the name in one scope is by a modelled binder (design B-D1): a def followed by an
        assignment, or a method followed by a class attribute of its name, is not a def any more."""
        return scope_total.get(name, 0) == scope_modelled.get(name, 0)

    def resolve(self, node):
        """The qualified target of a callee expression, one hop, or None. Fails closed (design B-D1 of the code-index D1
        design step): inside an unmodelled scope, nothing resolves; a name bound in a scope by anything the table does not
        model resolves to nothing; and the WHOLE chain of scopes is read, not the innermost and then the module, so a name
        an enclosing function binds shadows the module's (the S10 case, whose answer is unresolved)."""
        if self.opaque:
            return None
        p = dotted(node)
        if p is None:
            return None
        head, _, rest = p.partition(".")
        scope = self.scopes[-1] if self.scopes else None
        if scope is not None and scope["self"] and head == scope["self"]:
            first, _, more = rest.partition(".")
            cls = scope["class"]
            if not first or first not in cls["defs"] or not self.only_modelled(cls["total"], cls["modelled"], first):
                return None
            return "%s.%s" % (cls["defs"][first], more) if more else cls["defs"][first]
        for depth, s in enumerate(reversed(self.scopes)):
            if depth > 0 and not visible_to_nested(s["node"]):
                continue
            if head not in s["total"]:
                continue
            # S10: a name an enclosing function binds is a closure over it, which this extractor does not model.
            if depth > 0 or not self.only_modelled(s["total"], s["modelled"], head):
                return None
            target = s["defs"].get(head) or s["imports"].get(head)
            if target is None:
                return None
            return "%s.%s" % (target, rest) if rest else target
        if head in self.total:
            if not self.only_modelled(self.total, self.modelled, head):
                return None
            target = self.defs.get(head) or self.imports.get(head)
            if target is None:
                return None
            return "%s.%s" % (target, rest) if rest else target
        if head in BUILTINS and not rest:
            return "builtins.%s" % head
        return None


class Facts(ast.NodeVisitor):
    def __init__(self, path, mod, manifest_modules, all_classes):
        self.path = path
        self.mod = mod
        self.manifest = manifest_modules
        self.all_classes = all_classes
        self.stack = [mod.name]
        self.assigned = []
        self.docstrings = set()
        self.emitted = set()
        self.t = {k: [] for k in ("definitions", "calls", "constructions", "literals", "comparisons", "imports", "handlers")}

    def visit(self, node):
        """A scope the language opens and the table does not model is opaque: every call inside answers resolved false
        (design B-D1). Comprehensions are the case today; a construct removed from the table becomes one."""
        kind = type(node).__name__
        if kind in LANGUAGE_SCOPES and not modelled_scope(kind):
            self.mod.opaque += 1
            try:
                return super().visit(node)
            finally:
                self.mod.opaque -= 1
        return super().visit(node)

    def complete(self, tree):
        """Design B-D2: every ast.Call the walk did not reach gets a row, resolved false, so no call is dropped
        (shared/code-index.md: an unresolved row is never dropped). Its enclosing definition is the nearest def or class
        whose BODY holds it; a decorator, base, annotation or type parameter belongs to the scope the def sits in."""
        def walk(node, owner):
            if isinstance(node, ast.Call) and id(node) not in self.emitted:
                args = [describe(a) for a in node.args] + [describe(k.value, k.arg) for k in node.keywords]
                self.t["calls"].append({"path": self.path, "span": span(node), "enclosing": owner, "callee": None,
                                        "resolved": False, "callee_text": text(node.func), "args": args})
            for field, value in ast.iter_fields(node):
                inner = owner
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and field == "body":
                    inner = "%s.%s" % (owner, node.name)
                for child in (value if isinstance(value, list) else [value]):
                    if isinstance(child, ast.AST):
                        walk(child, inner)
        walk(tree, self.mod.name)

    def row(self, node, **fields):
        r = {"path": self.path, "span": span(node), "enclosing": self.stack[-1]}
        r.update(fields)
        return r

    def in_manifest(self, target):
        # Each dotted prefix of target looked up in the manifest's set, not every module scanned per call (G-2 of
        # 20261030-124823-ciss-stage7): equal to, or under, a manifest module exactly when one of its prefixes is one.
        parts = target.split(".")
        return any(".".join(parts[:i]) in self.manifest for i in range(1, len(parts) + 1))

    def mark_docstring(self, body):
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                and isinstance(body[0].value.value, str):
            self.docstrings.add(id(body[0].value))

    def visit_Module(self, node):
        self.mark_docstring(node.body)
        self.assigned.append(single_literals(node.body, bindings(node.body)))
        self.generic_visit(node)
        self.assigned.pop()

    def visit_FunctionDef(self, node):
        q = "%s.%s" % (self.stack[-1], node.name)
        self.t["definitions"].append(self.row(node, name=node.name, qualified=q, kind="function",
                                              signature="(%s)" % text(node.args)))
        for d in node.decorator_list:
            self.visit(d)
        self.stack.append(q)
        # Defaults are evaluated where the def is, but belong to the function they default: they key by it, and resolve
        # before its scope opens. Visited inside it, a name resolved against the function's own locals (G-2 of
        # 20261021-194056-ciss-d1-remediation-3-review).
        self.visit_defaults(node.args)
        # Annotations are evaluated where the def is too (without `from __future__ import annotations`), and like the
        # defaults key by the function: unvisited, their calls were dropped (census p34).
        for a in ast_args(node.args):
            if a.annotation is not None:
                self.visit(a.annotation)
        if node.returns is not None:
            self.visit(node.returns)
        scope = self.mod.enter("function", q, node)
        self.assigned.append(single_literals(node.body, scope["bound"]))
        self.mark_docstring(node.body)
        for s in node.body:
            self.visit(s)
        self.assigned.pop()
        self.mod.leave()
        self.stack.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_defaults(self, args):
        for d in list(args.defaults) + [k for k in args.kw_defaults if k is not None]:
            self.visit(d)

    def visit_Lambda(self, node):
        """A lambda's parameters bind in its own scope: with none opened, `lambda len: len()` resolved as builtins.len (G-1
        of 20261021-194056-ciss-d1-remediation-3-review). It has no name, so its rows key by the enclosing definition."""
        self.visit_defaults(node.args)
        scope = self.mod.enter("function", self.stack[-1], node)
        self.assigned.append(single_literals([node.body], scope["bound"]))
        self.visit(node.body)
        self.assigned.pop()
        self.mod.leave()

    def visit_ClassDef(self, node):
        q = "%s.%s" % (self.stack[-1], node.name)
        self.t["definitions"].append(self.row(node, name=node.name, qualified=q, kind="class",
                                              signature="(%s)" % ", ".join(text(b) for b in node.bases)))
        # A class's decorators, bases and keywords (metaclass=) are evaluated in the scope the class sits in, before its
        # body exists: unvisited, their calls were dropped (G-6 of 20261021-202611-ciss-d1-remediation-4-review; census
        # p31, p32).
        for part in list(node.decorator_list) + list(node.bases) + [k.value for k in node.keywords]:
            self.visit(part)
        self.stack.append(q)
        scope = self.mod.enter("class", q, node)
        self.assigned.append(single_literals(node.body, scope["bound"]))
        self.mark_docstring(node.body)
        for s in node.body:
            if isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name):
                field = {"name": s.target.id, "qualified": "%s.%s" % (q, s.target.id), "kind": "field",
                         "annotation": text(s.annotation)}
                if s.value is not None:
                    # None stays null (the field is nullable); anything that is not a literal, a constant JSON cannot
                    # carry included, is its source text in default_text, so "f()" and f() are not one fact (G-3).
                    const = isinstance(s.value, ast.Constant) and (s.value.value is None or is_literal(s.value.value))
                    if const:
                        field["default"] = s.value.value
                    else:
                        field["default_text"] = text(s.value)
                self.t["definitions"].append(self.row(s, **field))
            self.visit(s)
        self.assigned.pop()
        self.mod.leave()
        self.stack.pop()

    def visit_Import(self, node):
        for a in node.names:
            self.t["imports"].append(self.row(node, module=a.name, name=a.name, alias=a.asname,
                                              qualified=self.mod.import_of(a.asname or a.name.split(".")[0]) or a.name))

    def visit_ImportFrom(self, node):
        for a in node.names:
            local = a.asname or a.name
            self.t["imports"].append(self.row(node, module=node.module, name=a.name, alias=a.asname,
                                              qualified=self.mod.import_of(local)))

    def visit_Call(self, node):
        target = self.mod.resolve(node.func)
        args = [describe(a) for a in node.args] + [describe(k.value, k.arg) for k in node.keywords]
        self.emitted.add(id(node))
        row = {"callee": target, "resolved": target is not None, "callee_text": text(node.func), "args": args}
        if target is not None:
            row["in_manifest"] = self.in_manifest(target)
        self.t["calls"].append(self.row(node, **row))
        if target is not None and target in self.all_classes:
            keys = []
            for v in list(node.args) + [k.value for k in node.keywords]:
                if isinstance(v, ast.Dict):
                    keys += [k.value for k in v.keys if isinstance(k, ast.Constant) and is_literal(k.value)]
            self.t["constructions"].append(self.row(node, type=target, callee_text=text(node.func), resolved=True,
                                                    keywords=[k.arg for k in node.keywords if k.arg], dict_keys=keys,
                                                    args=args))
        self.generic_visit(node)

    def visit_Constant(self, node):
        if id(node) in self.docstrings:
            return
        if is_literal(node.value):
            self.t["literals"].append(self.row(node, value=node.value, type=literal_type(node.value)))

    def literal_of(self, side):
        if isinstance(side, ast.Constant) and is_literal(side.value):
            return side.value, None
        if isinstance(side, ast.Name) and side.id in self.assigned[-1]:
            return self.assigned[-1][side.id], side.id
        return None, None

    def visit_Compare(self, node):
        left = node.left
        for op, right in zip(node.ops, node.comparators):
            lit, via = self.literal_of(right)
            if lit is None:
                lit, via = self.literal_of(left)
            row = {"op": text_op(op), "left": describe(left), "right": describe(right), "literal": lit, "via": via}
            for side in (left, right):
                if isinstance(side, ast.Call):
                    t = self.mod.resolve(side.func)
                    if t:
                        row.setdefault("operands", []).append(t)
            self.t["comparisons"].append(self.row(node, **row))
            left = right
        self.generic_visit(node)

    def visit_ExceptHandler(self, node):
        self.t["handlers"].append(self.row(node, caught=text(node.type) if node.type is not None else None))
        self.generic_visit(node)


OPS = {ast.Eq: "==", ast.NotEq: "!=", ast.Lt: "<", ast.LtE: "<=", ast.Gt: ">", ast.GtE: ">=", ast.Is: "is",
       ast.IsNot: "is not", ast.In: "in", ast.NotIn: "not in"}


def text_op(op):
    return OPS.get(type(op), type(op).__name__)


def extract(request):
    root = request["root"]
    roots = (request.get("options") or {}).get("import_roots") or []
    files, parsed = [], []
    for rel in request["files"]:
        full = os.path.join(root, rel)
        try:
            with open(full, "rb") as f:
                source = f.read()
        except OSError as e:
            # Never parsed, so not a parse_error: an unread file makes the answer partial (shared/code-index.md).
            files.append({"path": rel, "status": "not_processed", "outcome": "partial", "reason": "unreadable: %s" % e.strerror})
            continue
        try:
            tree = ast.parse(source, filename=rel)
        except SyntaxError as e:
            files.append({"path": rel, "status": "not_processed", "outcome": "parse_error",
                          "reason": "SyntaxError at line %s: %s" % (e.lineno, e.msg)})
            continue
        name = module_name(rel, roots)
        parsed.append((rel, Module(name, tree, rel.replace("\\", "/").endswith("__init__.py")), tree))
        files.append({"path": rel, "status": "processed"})
    # The manifest is every requested file, read or not, as the JavaScript extractor's is (G-5): in_manifest means one thing.
    manifest = {n for n in (module_name(rel, roots) for rel in request["files"]) if n}
    classes = set().union(*[m.classes for _, m, _ in parsed]) if parsed else set()
    facts = {k: [] for k in ("definitions", "calls", "constructions", "literals", "comparisons", "imports", "handlers")}
    for rel, mod, tree in parsed:
        v = Facts(rel, mod, manifest, classes)
        v.visit(tree)
        v.complete(tree)
        for k in facts:
            facts[k].extend(v.t[k])
    return {"code_index_schema": SCHEMA, "extractor": {"name": NAME, "version": VERSION}, "files": files, "facts": facts}


def main(argv):
    p = argparse.ArgumentParser(prog="extract.py")
    p.add_argument("--identity", action="store_true")
    p.add_argument("--root")
    p.add_argument("--language")
    p.add_argument("--request")
    a = p.parse_args(argv)
    # The floor (design B-D3): below 3.10 the extractor cannot run (ast.match_case, ast.unparse), and said so only as an
    # AttributeError traceback. A refusal names the requirement; the query reads it as extractor_failed.
    if sys.version_info < (3, 10):
        sys.stderr.write("extract.py: quorate-python needs Python 3.10 or later; this is %d.%d\n" % sys.version_info[:2])
        return 2
    if a.identity:
        print(json.dumps(identity(a.root)))
        return 0
    if a.language != "python" or not a.request:
        sys.stderr.write("extract.py: give --identity --root <dir>, or --language python --request <file>\n")
        return 2
    with open(a.request, "r", encoding="utf-8") as f:
        request = json.load(f)
    sys.stdout.write(json.dumps(extract(request)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
