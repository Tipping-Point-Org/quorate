# Extractors for the code index

An extractor turns a project's source files into the facts the code index answers questions from. quorate's engine never
imports one: a project declares, in its contract's `code_index` block, which extractor command reads which files, and the
engine runs that command. `shared/code-index.md` owns the request an extractor is given, the response it returns, and the
facts in it; this page says what ships here and what an extractor of your own must do.

## What ships

| Language | Command | Needs |
|---|---|---|
| Python | `python .claude/skills/quorate/extractors/python/extract.py` | Python 3.10 or later, standard library only; below 3.10 it refuses, naming the requirement (the query reads it as `extractor_failed`) |
| JavaScript, including `<script>` blocks in HTML | `node .claude/skills/quorate/extractors/javascript/extract.mjs` | acorn, installed in your own repository (see below); a file using decorators answers `parse_error` |

The paths assume the standard consumer mount, `.claude/skills/quorate/`. Declare one per language:

```yaml
code_index:
  python:
    extractor: "python .claude/skills/quorate/extractors/python/extract.py"
    globs: ["src/**/*.py"]
    options: { import_roots: ["src"] }
```

`options.import_roots` tells the Python extractor where module names start: a file `src/pkg/a.py` under the import root
`src` is the module `pkg.a`. Without it, module names start at the repository root.

The golden facts this extractor is tested against were checked on Python 3.12, which CI runs; it is written for 3.10 and
later, and other versions are not yet checked.

**The JavaScript extractor needs acorn**, and loads it from your repository rather than from quorate, so quorate itself
keeps no dependencies. Without acorn every HTML and JavaScript file answers `not_configured`, saying acorn is missing.
quorate's CI tests acorn 8.14.0 (`.github/workflows/checks.yml`); install that version, or a later 8.x, with `npm install acorn@8.14.0` in your repository.

## An extractor of your own

A contributed extractor, for another language or as a replacement, is a command that answers two calls:

- `<command> --identity --root <repository root>` prints one JSON object naming the extractor, its version, its
  runtime, its parser library, a hash of each module it loads, `reads`, the configuration files it consults (`[]` when
  none), and `scope_constructs`, the constructs it models as scopes and binders, without reading any source. For
  example:

  ```json
  { "name": "my-extractor", "version": "1", "runtime": "node 24.13.1", "parser": "acorn 8.14.0", "modules": { "extract.mjs": "<sha256>" }, "reads": ["**/package.json"], "scope_constructs": { "Program": { "opens_scope": true, "visible_to_nested": true, "binds_in_parent": false } } }
  ```

  How `scope_constructs` is compared with the table for its language, and what happens for a language with no table,
  is owned by `shared/code-index.md` ("The identity call"). Model a construct you do not list as unresolved, never as a
  guess: a call inside a scope you do not model answers `resolved: false`.

- `<command> --language <language> --request <file>` reads the request, and prints one response that accounts for every
  requested file and carries the facts of each one it processed.

It passes when `node scripts/code-index.mjs conformance --language <language> --extractor "<command>" --fixtures <dir>`
passes over a fixture directory in that language. The directory holds the fixtures, plus a `golden.json` in the format
of `tests/fixtures/code-index/golden.json`, covering every shape and an `unresolved` twin for each.

An extractor runs with only the platform's process basics in its environment, plus the names its language's `env` lists.
It is trusted like any command in your contract: nothing confines its file or network access, and every answer says so.

## Running the extractor tests inside a remediation

A remediation's candidate check passes an extractor's tests only the platform's basics and the names in
`review.candidate_env`. This repository declares `QUORATE_ACORN_DIR`, `QUORATE_REQUIRE_PYTHON` and
`QUORATE_REQUIRE_ACORN` there. Before a remediation of extractor code, set all three, with `QUORATE_ACORN_DIR` naming a
directory whose `node_modules` holds acorn. Unset, the extractor tests skip, and the runner commits a fix its own check
never ran.
