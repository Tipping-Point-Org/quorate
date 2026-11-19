# The code index: facts, extractors, queries

This page owns what the code index's records MEAN: the facts an extractor emits, the request it is given and the response
it returns, the answer a query prints, and the answer file a consumer's comparison reads. Which fields each record has,
and their types, is owned by one data definition, `scripts/lib/code-index-spec.mjs`, which every check interprets
(ARCHITECTURE A-1: one owner per rule). Tests compare this page's field lists with the spec, and check every JSON
example here against it, so the two cannot drift apart silently.

The design is `.claude/requests/code-index.design.md` and the plan `.claude/requests/code-index.plan.md`. The
requirements are story-pipeline's (consumer zero).

**Two halves, one boundary.** An extractor turns source files into facts. A query reads the facts and answers one
question. quorate owns this schema and the queries. Each project declares, in its contract, which extractor reads which
files. How the engine and an extractor are kept apart is ARCHITECTURE.md A-27.

## What a query covers

**A query covers only the files under each language's declared `globs`.** Whether that is production source or the
whole tracked tree is the consumer's choice, made where it writes the globs. The manifest is git's list under those
globs: tracked files, plus untracked files that are not ignored.

**The module set is the manifest, not a shape.** A response lists every file processed and every file not processed,
so "every module, as a derived set" is the response's file list.

## The contract block

```yaml
code_index:
  python:
    extractor: "python .claude/skills/quorate/extractors/python/extract.py"
    globs: ["src/**/*.py"]
    options: { import_roots: ["src"] }
    env: []
```

- `extractor`: the command. Empty means this language answers `not_configured`.
- `globs`: the files this language's extractor reads. The file→language mapping is declared here, never detected.
- `options`: passed unchanged in the request. This is where an extractor's own settings go, such as import roots, a
  language version or a `tsconfig`.
- `env`: the variable names the extractor needs beyond the platform's process basics. **Absent means `[]`**, and `[]`
  is the default to start from. Add a name only when the extractor fails without it: reading a variable is not
  needing it, and every name added widens what a contract command receives. Names that match the secret-name shape, or
  the `ANTHROPIC_` or `CLAUDE_CODE_` families, are refused.

`code_index` absent means the feature is off. `code_index: {}` means declared with no languages, and every query answers
`not_configured`.

## The request

The extractor is run as `<extractor> --language <language> --request <file>`. The request file:

```json
{
  "code_index_request": 1,
  "language": "python",
  "root": "/abs/path/to/repository",
  "files": ["src/a.py", "src/b.py"],
  "options": { "import_roots": ["src"] }
}
```

The files travel in the request, not on the command line. Windows caps a command line at 32,767 characters, and a
consumer's paths reach most of that.

## The identity call

`<extractor> --identity --root <repository root>` prints one JSON object and reads no source:

```json
{ "name": "quorate-python", "version": "1", "runtime": "python 3.12.4", "parser": "ast (stdlib)", "modules": { "extract.py": "<sha256>" }, "reads": [], "scope_constructs": { "Module": { "opens_scope": true, "visible_to_nested": true, "binds_in_parent": false } } }
```

`scope_constructs` is required: the rows of "The constructs each reference extractor models" (below, under Scope) that
the extractor models, keyed by construct, in the table's three columns (the example is cut to one row; copied as is, it is refused). The engine compares
it with the table for the extractor's language, at every query and in `conformance`. **An extractor whose rows differ is
refused as `extractor_failed`** (`invalid-response`), each difference named: a row added is a construct whose answers no
shared test checks, and a row missing breaks the contract as written. **A language with no table is not compared**: the
extractor runs, and every answer names its scope model as unchecked in `not_checked`; its reported rows are the proposal
for that language's table.

It receives the root because a parser library resolves from there, the same way a build loads it. The cache key
includes this object, so a different runtime, an upgraded parser or a changed helper module invalidates cached facts.

`reads` lists, as contract globs, the configuration files the extractor consults, such as the JavaScript extractor's
`["**/package.json"]`. They are matched against git's file list under the root, as the manifest is, and hashed into the
key, so changing one invalidates the facts it shaped. A glob outside the contract grammar is refused. `reads` is
optional at query time, where absent means `[]`. `conformance` requires it, `[]` included, so an extractor that passes
conformance has declared what it reads.

## The response

```json
{
  "code_index_schema": 1,
  "extractor": { "name": "quorate-python", "version": "1" },
  "files": [
    { "path": "src/a.py", "status": "processed" },
    { "path": "src/b.py", "status": "not_processed", "outcome": "parse_error", "reason": "SyntaxError at line 12" }
  ],
  "facts": { "definitions": [], "calls": [], "constructions": [], "literals": [], "comparisons": [], "imports": [], "handlers": [] }
}
```

Every file in the request appears in `files`, exactly once. A row's `path` names a processed file.

## Tables

Every row carries `path`, a `span` (`{ "start": { "line": n, "col": n }, "end": { "line": n, "col": n } }`, 1-based
lines), and `enclosing`: the qualified symbol of its containing function or class, or the module at module level.

- `definitions` — `name`, `qualified`, `kind` (`function`, `class` or `field`), `signature` (functions and classes),
  and for a field its `annotation` source text and its default: `default` when it is a literal (or null), else
  `default_text`, its source text, so a literal `"f()"` and the expression `f()` are never the same fact.
- `calls` — `callee`: the target resolved one hop (see "Scope"), or `null`; `resolved`, whether it was; `in_manifest`,
  optional, whether a resolved target lies in a requested file (the manifest), processed or not; `callee_text` as written; `args`, each with `keyword` (or `null`), `text`, `kind` (`name`, `attribute`, `call`,
  `literal` or `other`), and for an attribute chain its dotted `path`.
- `constructions` — `type`, resolved as a call's target is, or `null`; `resolved`; `callee_text` as written; its `keywords`;
  `dict_keys`, the literal keys of any dict argument; and its `args`, as a call's.
- `literals` — `value` and its `type`, keyed by `enclosing`.
- `comparisons` — `op`, and `left` and `right`, each described as an argument is (`text`, `kind`, `path`). It also
  carries `literal`, the literal compared against when either side is one or was assigned one level up, else `null`.
  `via` names the variable that assignment went through, or is `null`. A comparison against a call is a row too, with
  that side's `kind` `call`; `operands` lists the resolved callee of each side that is a call (consumer zero's sweep of
  by_model comparisons against a locality call needs it).
- `imports` — `module`, `name`, `alias` and the `qualified` target.
- `handlers` — `caught`: the exception type as written, or `null` for a bare except.

## Shapes

One subcommand of `scripts/code-index.mjs` per shape:

- `symbol` — does this symbol exist, what kind, with what signature.
- `calls` — every call of F, with its arguments.
- `constructions` — every construction of T, with its keywords and literal dict keys.
- `literals` — every literal L, keyed by `enclosing`.
- `comparisons` — every comparison against L, tracking one level of assignment.
- `callees` — what M calls, one hop resolved, each unresolved edge reported in the rows.
- `handlers` — the exception handlers in functions that call, or are, any of a given set.

Their arguments, each a filter that narrows the rows:

| shape | arguments |
|---|---|
| `symbol` | `name` (qualified, or a prefix ending `.`), optional `kind`, optional `annotation` (the annotation's exact text), optional `annotation_contains` (a field whose annotation text contains it, so "str" finds str, str | None and list[str]) |
| `calls` | `callee` (qualified), optional `arg_path` (an argument's dotted path) |
| `constructions` | `type` (qualified) |
| `literals` | `value`, optional `within` (a qualified prefix) |
| `comparisons` | `literal` or `operand` (a call's qualified callee), optional `within` |
| `callees` | `of` (a qualified function or module) |
| `handlers` | `calls_any` (a list of qualified functions), optional `caught` |

## Scope

Which names a name can mean, stated once, for every extractor (design D2 and D3 of
`.claude/requests/code-index-schema-and-scope.design.md`). A name resolves through exactly:

1. the innermost scope's own definitions and imports, where a scope is a function body, or a class body for code
   written at class level;
2. the module's top-level definitions, imports and exports;
3. the language's builtins or globals.

`self.m()` (an undecorated method's first parameter; a decorated method has no receiver) and `this.m()` resolve to the enclosing class's own method `m`. Everything else
is `resolved: false`, which makes the answer `partial`, never a silent `complete`.

A comparison reports `literal` and `via` only when the variable is bound **exactly once** in its scope, counting nested
functions and closures, by an assignment of a literal. Any other binding of that name, by any form, means it is not
tracked. The forms below are the ones the case matrix tests, not a limit: the extractors count every binding their
parser marks.

Each row has a fixture in `tests/fixtures/code-index/scope/`, one sweep per language that has the construct.

| id | case | answer | languages |
|---|---|---|---|
| `S01` | a function-local aliased import: `def f(): from a.b import c as d; d()` | `a.b.c` | python |
| `S02` | a function's own nested definition | `f.inner` | python, javascript |
| `S03` | a class body's own import, for code at class level | the import's target | python |
| `S04` | a module's top-level definition | `m.g` | python, javascript |
| `S05` | a module's import | the import's target | python, javascript |
| `S06` | an exported declaration | `m.g` | javascript |
| `S07` | a builtin or global | `builtins.len`, `globals.parseInt` | python, javascript |
| `S08` | `self.m()`, `this.m()` | the class's method | python, javascript |
| `S09` | a class body's name, from inside a method | unresolved | python |
| `S10` | a closure over an outer function's name | unresolved | python, javascript |
| `S11` | a computed member: `getattr(o, n)()`, `o[k]()` | unresolved | python, javascript |
| `R00` | bound once, to a literal | tracked | python, javascript |
| `R01` | rebound by assignment | not tracked | python, javascript |
| `R02` | rebound by augmented assignment | not tracked | python, javascript |
| `R03` | rebound by destructuring | not tracked | python, javascript |
| `R04` | rebound as a `for` target | not tracked | python, javascript |
| `R05` | rebound by `with … as` | not tracked | python |
| `R06` | rebound by `except … as` | not tracked | python |
| `R07` | rebound by a walrus | not tracked | python |
| `R08` | deleted, then rebound | not tracked | python |
| `R09` | an update expression (`x++`) | not tracked | javascript |
| `R10` | also a parameter | not tracked | python, javascript |
| `R11` | written from a nested function or closure (`nonlocal`, a closure assignment) | not tracked | python, javascript |

### The constructs each reference extractor models

These tables are the one hand-kept list of what each reference extractor models as a scope or a binder
(`code-index-d1-part-b.plan.md`, B-D4). Each extractor's constant is generated from its language's table by
`node scripts/gen-rule-text.mjs`, into a marked region, and a stale constant fails `--check`. A name bound by anything
not listed, and every call inside a scope-opening construct not listed, answers `resolved: false`. A contributed
extractor reports its own rows through `--identity`.

The columns: **opens a scope** (its body is a scope of its own); **visible to nested scopes** (a scope nested in it may
resolve a name through it: a Python class body may not, case S09); **binds in enclosing scope** (it gives a name a
meaning in the scope it sits in). **Shown by** names the fixture that exercises the row.

<!-- table:scope-constructs language="python" -->
| Construct | Opens a scope | Visible to nested scopes | Binds in enclosing scope | Shown by |
|---|---|---|---|---|
| `Module` | yes | yes | no | `tests/fixtures/code-index/scope/python/sc/s04_module_def.py` |
| `FunctionDef` | yes | yes | yes | `tests/fixtures/code-index/scope/python/sc/s02_local_def.py` |
| `AsyncFunctionDef` | yes | yes | yes | `tests/fixtures/code-index/census/python/p02_asyncfunctiondef.py` |
| `Lambda` | yes | yes | no | `tests/fixtures/code-index/census/python/p03_lambda.py` |
| `ClassDef` | yes | no | yes | `tests/fixtures/code-index/scope/python/sc/s08_self_method.py` |
| `Import` | no | no | yes | `tests/fixtures/code-index/scope/python/sc/s05_module_import.py` |
| `ImportFrom` | no | no | yes | `tests/fixtures/code-index/scope/python/sc/s01_local_import.py` |
<!-- /table:scope-constructs -->

<!-- table:scope-constructs language="javascript" -->
| Construct | Opens a scope | Visible to nested scopes | Binds in enclosing scope | Shown by |
|---|---|---|---|---|
| `Program` | yes | yes | no | `tests/fixtures/code-index/scope/javascript/s04_module_def.mjs` |
| `FunctionDeclaration` | yes | yes | yes | `tests/fixtures/code-index/scope/javascript/s02_local_def.mjs` |
| `FunctionExpression` | yes | yes | no | `tests/fixtures/code-index/census/javascript/j02_function_expression.mjs` |
| `ArrowFunctionExpression` | yes | yes | no | `tests/fixtures/code-index/census/javascript/j03_arrow.mjs` |
| `MethodDefinition` | yes | yes | no | `tests/fixtures/code-index/scope/javascript/s08_self_method.mjs` |
| `ClassDeclaration` | yes | yes | yes | `tests/fixtures/code-index/census/javascript/j05_class_declaration.mjs` |
| `ImportDeclaration` | no | no | yes | `tests/fixtures/code-index/scope/javascript/s05_module_import.mjs` |
| `VariableDeclarator` | no | no | yes | `tests/fixtures/code-index/census/javascript/j03_arrow.mjs` |
<!-- /table:scope-constructs -->

In JavaScript a `VariableDeclarator` is a modelled binder only when it binds one name to a function or an arrow
(`const f = () => {}`); bound to anything else (`const fs = require('fs')`, a destructuring), it is a binding the table
does not model. A block, a `for` head, a `catch` clause and a `switch` open a lexical scope that matters only for the
names they declare: a call naming one of those answers `resolved: false`. A scope the language opens that is not listed
(a class expression, a static block, `with`) makes every call inside it answer `resolved: false`.

## Resolution

- **A name is resolved** when "Scope" above gives it a qualified target. A target outside the manifest is still
  resolved; its row carries `in_manifest: false`.
- **A name is unresolved** when nothing gives it a qualified target, for example a call on a computed value
  (`getattr(obj, name)(1)`) or a JavaScript name defined nowhere in scope. Its row carries `resolved: false` and
  `callee: null`, and it is never dropped.
- **The extractors fail closed** (`code-index-d1-design-step.design.md`, B-D1). A call inside a scope the table above
  does not model, or naming a name some scope in its chain binds by a construct the table does not model, answers
  `resolved: false`: an unmodelled construct reads "could not tell", never a guessed target. Where a name is bound both
  by a modelled binder and otherwise in one scope (a def and an assignment; a method and a class attribute of its name),
  it is unresolved. Every call node the parser defines gets a row, the ones the walk does not reach included, so none is
  dropped (B-D2).
- **A JavaScript file using decorators** (`@d class C {}`) answers `parse_error`: the parser the reference extractor
  uses does not accept them, and no plugin is loaded for them (B-D3).
- **A question whose own target cannot be resolved** answers `unresolved`. Examples: `calls` of a function defined
  nowhere in the manifest and imported nowhere, `callees` of such a function, `literals` `within` a module that does
  not exist. An empty `complete` is reserved for a target that resolves and has no rows.
- **An answer that includes unresolved rows** answers `partial`, with those rows in it.
- **A target that resolves to nothing while a file in scope failed to parse** answers `parse_error`, naming the
  file: the target may be defined in it. With any other file unread, it answers `partial`:
  the target may be defined in the unread file. The unread files are named in `not_checked`.

A question none of these can ask is recorded with `code-index.mjs ask --needs "<the shape it would need>" "<question>"`,
and counted with `code-index.mjs unsupported`. When those accumulate, a query language is its own request.

## Outcomes

Every answer has exactly one, and each means one thing:

- `complete` — every file in scope was read and the answer is whole.
- `partial` — some files in scope were not processed, or some rows are unresolved; the answer covers the rest, and
  names them.
- `unresolved` — the question names something the index cannot resolve. This is never an empty `complete`.
- `parse_error` — the target resolves to nothing, and a file in scope could not be parsed; the file is named.
- `unsupported` — the shapes cannot ask this question.
- `extractor_failed` — the extractor produced no valid response. Its `detail` is the process outcome, and its `why`
  says what failed.
- `not_configured` — no language is declared, its `extractor` is empty, or its parser library is missing; its `why`
  says which.

## Extractor failures

An `extractor_failed` answer's `detail` is one of:

- `failed` — the extractor exited non-zero.
- `timed-out` — it was stopped at `review.code_index_timeout_minutes`.
- `could-not-start` — it could not be spawned.
- `incomplete` — it was stopped by a signal, or its output overflowed.
- `invalid-response` — it exited 0 and its response failed this page's rules.

## The answer envelope

```json
{
  "code_index_answer": 1,
  "shape": "callees",
  "language": "python",
  "outcome": "complete",
  "rows": [],
  "input_hash": "<sha256>",
  "extractors": [{ "name": "quorate-python", "version": "1", "runtime": "python 3.12.4", "parser": "ast (stdlib)" }],
  "framework": { "commit": "<sha>", "dirty": false },
  "not_checked": []
}
```

An envelope with no `extractors` entry, or no `framework` stamp, is refused by every reader. The one exception is
`not_configured`, which no extractor produced, so its `extractors` list may be empty. `framework.dirty` is `null` when
git cannot say. `not_checked` names what
the answer did not cover, for example a language whose `extractor` is empty, an extractor keyed by its command alone,
or the extractor's network access, which nothing constrains.

## The answer file a consumer's comparison reads

`code-index.mjs compare --answers <file>` checks the index against answers derived without it:

```json
{
  "pinned_commit": "<commit>",
  "sweeps": [
    { "name": "LLMConfig( construction sites and their keyword sets", "shape": "constructions",
      "args": { "type": "LLMConfig" }, "expected": [], "method": "hand-read of every LLMConfig( site at the pinned commit" }
  ]
}
```

It refuses a file with no `pinned_commit`, a sweep with no `method`, a sweep with no `args` or with arguments its shape
does not take, a tree whose HEAD is not `pinned_commit`, and a working tree with any edited or untracked file, or whose
status git cannot read: the index reads working-tree bytes, so a matching HEAD alone vouches for nothing. An
expected answer copied from the index's own output would make the comparison pass vacuously, so `method` must name an
independent derivation. The answers hold at their pinned commit only; a moved tree is expected to differ.
