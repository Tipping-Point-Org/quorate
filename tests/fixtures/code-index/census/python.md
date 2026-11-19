# Python extractor census (extractors/python/extract.py at HEAD 34763e78)

Probes: py/root/pNN_*.py (written by py/make_probes.py). Each defines a module-level `def g()`. Runner py/run_probes.py lists
every ast.Call in each probe and marks it EMITTED (resolved/callee/enclosing) or DROPPED (no calls row at its span start).
Outputs: py/out-3.12.txt, py/out-3.13.txt (identical except p13), py/out-3.8.txt, py/out-3.8-trivial.txt; raw responses
py/raw-3.12.json, py/raw-3.13.json. Python 3.9-3.11 not installed: not run.

"Correct?" compares with Python's own scoping; S/R ids are shared/code-index.md's Scope table (lines 163-187).

## Version precondition

| construct | handled? | effect | in table? | citation |
|---|---|---|---|---|
| any file, Python 3.8 (and by the same cause 3.9) | NO: `ast.match_case` (3.10+) is referenced in scope_statements; AttributeError, exit 1, no response | every file: extractor_failed (whole run) | no | extract.py:212-213; out-3.8-trivial.txt (one-line file `x = 1`), out-3.8.txt |
| `text()` on 3.8 | `ast.unparse` (3.9+) absent; caught, returns `<unrenderable>` | callee_text/signature/annotation text; staticmethod test compares decorator text | no | extract.py:69-73, 278-279 (inferred for 3.8; not reachable because of the crash above) |

## (i) Scopes

| construct | handled? | effect on a call inside | in table? | citation |
|---|---|---|---|---|
| FunctionDef | yes: visit, own scope (defs, imports, bound) | resolved per scope | S01, S02, S10 | extract.py:357-375, 265-285; out-3.13#p01 |
| AsyncFunctionDef | yes (alias of FunctionDef) | resolved | no | extract.py:377; out#p02 |
| Lambda | yes: opens a function scope keyed by the enclosing definition, params bound | `lambda g: g()` unresolved (correct); `lambda: g()` resolved | no | extract.py:383-391; out#p03 |
| ClassDef body | yes: class scope; AnnAssign fields recorded | class-level call resolved in class scope; `self.m()` resolved | S03, S08, S09 | extract.py:393-413; out#p04 |
| ListComp/SetComp/DictComp/GeneratorExp | NO scope opened (no visit_* method; generic_visit) | at module level a comprehension target that shadows a def resolves to the def (`[g() for g in xs]` -> m.g, wrong); `len` target -> builtins.len (wrong) | no | extract.py:296-324 (resolve: scope None skips bound); out#p05, p06, p09 |
| comprehension inside a function | no own scope; target counted in the function's bound | unresolved (agrees with Python by accident) | no | extract.py:139-161, 314-315; out#p07 |
| comprehension in a class body | no own scope; non-first-iterator parts resolve in the class scope | resolved to the class-body import (Python: class names are not visible there) | no | extract.py:310-313; out#p08 L6 |
| comprehension body referring to an enclosing function's def | no own scope | resolved to f.g (Python: a closure, which S10 calls unresolved) | no (S10 covers closures) | out#p36 second g() |
| type params on def (3.12), TypeVar bound | NOT visited (visit_FunctionDef visits decorator_list, defaults, body only) | DROPPED | no | extract.py:361-372; out#p10 L3 |
| type params on class (3.12) | NOT visited (visit_ClassDef iterates body only) | DROPPED | no | extract.py:401-410; out#p11 |
| TypeAlias `type A = ...` (3.12), incl. its type params | generic_visit; no annotation scope | resolved in enclosing scope | no (TypeAlias listed in NON_BINDING) | extract.py:135; out#p12 |
| TypeVar default `[T = g()]` on def (3.13) | NOT visited | DROPPED (3.13); parse_error on 3.12 | no | out-3.13#p13; out-3.12#p13 |

## (ii) Bindings

Function level: every Name in Store/Del and every BINDING_FIELDS name, nested scopes included, is in the scope's `bound`, so
a call to it is unresolved. Module level: no scope is pushed for the module, so `bound` is never consulted: a rebound
builtin resolves to builtins.X, a rebound def to the def.

| construct | handled (counted)? | effect, function level | effect, module level | in table? | citation |
|---|---|---|---|---|---|
| Assign | yes (Name Store) | unresolved | `len = ...; len()` -> builtins.len; `g = ...; g()` -> m.g | R01 (literal tracking) | extract.py:150-151, 302-322; out#p14, p15 |
| AnnAssign, AugAssign | yes | unresolved | (not probed separately; same path as Assign) | R02 | out#p16 |
| NamedExpr | yes | unresolved | walrus in a module-level comprehension, then `abs()` -> builtins.abs | R07 | out#p17 |
| For/AsyncFor target | yes | unresolved | `for abs in []: abs()` -> builtins.abs | R04 | out#p18 |
| With/AsyncWith `as` | yes | unresolved | -> builtins.abs | R05 | out#p19 |
| ExceptHandler name | yes (BINDING_FIELDS) | unresolved | -> builtins.abs | R06 | extract.py:127; out#p20 |
| TryStar (`except*`) | yes (handlers via excepthandler children) | unresolved | not probed | no | extract.py:213, 472-474; out#p21 |
| Import/ImportFrom in a function, or in a block | yes (imports_of walks blocks) | resolved to the import target | resolved (try/except import resolved; the `j = None` rebinding ignored) | S01, S05 | extract.py:234-263; out#p22 |
| `from m import *` | skipped | n/a | unresolved | no | extract.py:258-259; out#p23 |
| Global | counted as bound | `global g; g()` unresolved (Python: module g) | n/a | no | extract.py:155-157, 314-315; out#p24 |
| Nonlocal | counted as bound | unresolved | n/a | R11 | out#p25 |
| Delete | yes (Name Del) | unresolved | not probed | R08 | extract.py:150; out#p26 |
| MatchAs, MatchStar, MatchMapping rest | yes (BINDING_FIELDS) | unresolved | `case [*len]: len()` -> builtins.len | no | extract.py:128; out#p27, p28 |
| MatchClass | no name field (cls is a Load expression); not a binding | subject and guard calls resolved | resolved | no | out#p27 L13 |
| comprehension targets | counted in the ENCLOSING function's bound | unresolved | not consulted (see comprehensions) | no | out#p07, p05 |
| a binding inside a NESTED function | counted in the outer function's bound too | outer `len()` unresolved (Python: builtins.len) | n/a | R11 (literal tracking) | extract.py:139-161, 274-275; out#p29 |

## (iii) Expressions evaluated in the enclosing scope

| construct | handled? | effect on a call inside | in table? | citation |
|---|---|---|---|---|
| FunctionDef decorator_list | yes, visited before the scope opens, keyed by the enclosing name | resolved in the enclosing scope | no | extract.py:361-362; out#p30 |
| method decorator_list / defaults in a class body | yes, before the method scope opens | resolved in the class scope (`deco(1)` -> C.deco), enclosing = the method | no | extract.py:361-368; out#p38 |
| ClassDef decorator_list | NOT visited | DROPPED | no | extract.py:393-413; out#p31 |
| ClassDef bases and keywords (metaclass=) | NOT visited (only text of bases for the signature) | DROPPED | no | extract.py:396, 401-410; out#p32 |
| defaults and kw_defaults | yes, before the scope opens; enclosing = the function | resolved in the enclosing scope (body's own `def g` ignored, correct) | no | extract.py:367, 379-381; out#p33 |
| arg annotations, *args/**kw annotations, return annotation | NOT visited | DROPPED | no | extract.py:361-372; out#p34 |
| AnnAssign annotation in a body | yes (generic_visit) | resolved | no | out#p35 |
| comprehension first iterator | no comprehension scope, so every part resolves in the enclosing scope | first iterator resolved (correct); later parts too (see (i)) | no | out#p36 |
| lambda defaults | yes, before the lambda scope | resolved in the enclosing scope | no | extract.py:386; out#p37 |
| `@staticmethod` first parameter | not treated as self (decorator text compared) | `x.s()` unresolved | S08 (self) | extract.py:278-281; out#p39 |

## What shared/code-index.md says outside its table

- shared/code-index.md:153-154: "Everything else is `resolved: false`, which makes the answer `partial`, never a silent `complete`."
- :156-159: a literal is tracked only when bound exactly once; "The forms below are the ones the case matrix tests, not a limit: the extractors count every binding their parser marks."
- :193-195: an unresolved name's row "carries `resolved: false` and `callee: null`, and it is never dropped."
- extract.py:10-11 (module docstring): "anything else is emitted with resolved false rather than dropped."
- The table (rows S01-S11, R00-R11, :163-187) lists no comprehension, decorator, base/metaclass, annotation, default, type-parameter, global, star-import or match construct.
