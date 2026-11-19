# JavaScript extractor census (extractors/javascript/extract.mjs at HEAD 34763e78)

Probes: js/root/jNN_*.mjs|.cjs (written by js/make_probes.mjs; acorn 8.18.0 copied from another local project into
js/root/node_modules). Runner js/run_probes.mjs walks each probe with the same acorn and lists every CallExpression,
NewExpression, TaggedTemplateExpression and ImportExpression, EMITTED (resolved/callee/enclosing) or DROPPED (no calls row
at its start). Output js/out.txt; raw response js/raw.json. node 24.13.1.

Module level has no scope on the stack: resolve() consults only the file's top-level defs (direct top-level statements,
Identifier declarators only), imports, then GLOBALS (extract.mjs:188-208, 214-232). A function scope's `bound` counts every
binding in the function including nested blocks and nested functions (extract.mjs:116-139, 235-240).

| construct | handled? | effect on a call inside | in table? | citation |
|---|---|---|---|---|
| FunctionDeclaration | yes: definition row, scope opened | resolved per scope | S02, S04, S10 | extract.mjs:259-273; out#j01 |
| FunctionExpression (named, or as an argument) | yes: scope opened; named one qualifies enclosing, no definition row; one bound to a declarator is named by the declarator | resolved | no | extract.mjs:259-273, 288-299; out#j02 |
| ArrowFunctionExpression | yes: scope; params bound | `(g) => g()` unresolved (correct); otherwise resolved | no | out#j03 |
| async functions, generators, await, yield | no special handling needed | resolved | no | out#j04 |
| ClassDeclaration body, methods | yes: definition rows; methods map for this.m() | resolved; `this.n()` -> C.n | S08 | extract.mjs:300-318, 274-287; out#j05 |
| ClassDeclaration superClass | walked with enclosing = class, scope = outer | resolved, keyed by the class | no | extract.mjs:315; out#j05 L3 |
| ClassDeclaration inside a function | yes (ownDefs includes it) | `new L()` and `this.n()` resolved | no | extract.mjs:142-156; out#j13 |
| ClassExpression | NO case: default branch, no class row, no methods map pushed | methods qualified under the enclosing name (m.m, not m.D.m); `this.n()` unresolved (or uses an OUTER class's map when nested in one: inferred from :282) | no | extract.mjs:282, 359-362; out#j06 |
| PropertyDefinition (field) value | field row; value walked in the OUTER scope | `a = g()` resolved; `b = this.m()` unresolved | no | extract.mjs:304-312; out#j07 |
| arrow function as a field value / inside a method (`this` is lexical) | scope opened with no class | `() => this.m()` unresolved | no | extract.mjs:268, 220-223; out#j07 L6, j12 L5 |
| StaticBlock | NO case: no scope; its declarations bound nowhere | `const parseInt = 1; parseInt()` -> globals.parseInt (wrong) | no | extract.mjs:359-362; out#j08 |
| computed method key `[expr]()` (non-Identifier) | name null: no definition row; body walked as an anonymous function keyed by the class | key call resolved; `this.n()` in that body unresolved | S11 (computed member call, not key) | extract.mjs:276-278; out#j09 L5 |
| computed method key `[k]()` (Identifier) | treated as a method NAMED k | definition C.k; `this.k()` -> C.k (runtime name is k's value) | no | extract.mjs:276, 313-314; out#j09 |
| getters/setters | yes, as methods; two definition rows with the same qualified name | `this.x()` -> C.x | no | out#j10 |
| static methods | in the same methods map as instance methods | `this.s()` from an instance method -> C.s | no | extract.mjs:313-314; out#j10 L7 |
| private method `this.#p()`, `super.m()`, `super()` | not dotted | unresolved | no | extract.mjs:85-94; out#j11 |
| object-literal method `{ m() { this.n() } }` | FunctionExpression scope, no class | unresolved | no | out#j12 L3 |
| BlockStatement let/const/class, module level | no block scope | `{ const parseInt = 1; parseInt() }` -> globals.parseInt (wrong) | no | extract.mjs:188-208; out#j14 L5 |
| block-level function declaration, module level | not a top-level def | `h()` unresolved | no | out#j14 L10 |
| BlockStatement let/const inside a function | counted in the whole function's bound | `{ let g } g()` -> unresolved (JS: module g) | no | extract.mjs:116-139; out#j15 L5 |
| block-level function declaration inside a function | definition row f.h, not in ownDefs | `h()` unresolved | no | extract.mjs:142-156; out#j15 L7 |
| CatchClause param | counted in a function's bound | in a function unresolved; at module level -> globals.parseInt (wrong) | no | extract.mjs:131; out#j16 |
| for / for-in / for-of with let/const, module level | not top-level defs | -> globals.parseInt, -> m.g, -> globals.isNaN (wrong) | R04 (literal tracking) | out#j17 |
| for-of with const inside a function | counted | unresolved | R04 | out#j18 |
| default parameters | walked INSIDE the function's scope | `a = g()` -> f.g, the body's own declaration (JS: param scope cannot see it); `b = parseInt()` unresolved because the body declares `let parseInt` | R10 (parameter) | extract.mjs:268-269; out#j19 |
| destructuring, module level | top-level defs take Identifier declarators only | `const [parseInt] = []; parseInt()` -> globals.parseInt (wrong); defaults/computed keys inside the pattern resolved | R03 | extract.mjs:198, 102-113; out#j20 |
| destructuring parameter | counted | unresolved | R03, R10 | out#j20 L4 |
| labeled statement | no effect on bindings | resolved (label g ignored, correct) | no | out#j21 |
| `with` (script) | no case | resolved to module g (could be o.g) | no | out#j22 |
| module-level let/var shadowing a global | top-level defs | `let parseInt = 1; parseInt()` -> m.parseInt | no | extract.mjs:198; out#j23 |
| binding in a NESTED function (param) | counted in the outer function's bound | outer `parseInt()` unresolved | R11 (literal tracking) | extract.mjs:116-139; out#j24 |
| import default / named / string-named / namespace | yes: imports map, top level | default -> module name (`other`, not other.default); `'a b'` -> `other.a b`; `ns.f()` -> pkg.f | S05 | extract.mjs:199-206, 319-324; out#j25 |
| dynamic `import()` | NO case (ImportExpression) | DROPPED | no | extract.mjs:325-326; out#j26 L3/L4 |
| `(await import(x)).f()` | callee not dotted | unresolved | no | out#j26 L4 |
| tagged template `` g`x` `` | NO case | DROPPED | no | extract.mjs:325-326; out#j26 L5 |
| `import.meta.resolve()` | MetaProperty not dotted | unresolved | no | out#j26 L6 |
| export named declaration / export const arrow | unwrapped into top-level defs | resolved | S06 | extract.mjs:194-195; out#j27 |
| `export default function () {}` (anonymous) | no definition; body keyed by module | resolved | no | out#j27 L4 |
| `export default <expr>` | walked | resolved | no | out#j28 |
| `export default class {}` | ClassDeclaration with null id -> `<anonymous>` | resolved | no | extract.mjs:301; out#j29 |
| `export { a as b }`, `export * from` | no binding or import recorded | n/a (no calls) | no | out#j27 |
| CommonJS `require` | no case; `const fs = require('fs')` is a top-level def | `fs.readFileSync()` -> `<this module>.fs.readFileSync` (resolved into this file); destructured `{ join }` -> unresolved; `require()` unresolved | no | extract.mjs:198; out#j30 |
| optional call `g?.()`, `ns?.f()`; NewExpression | dotted ignores `optional` | resolved | no | out#j31 |
| decorators `@g() class C {}` | acorn 8.18 rejects | whole file parse_error | no | extract.mjs:183-184; out#j32 |

## What shared/code-index.md says outside its table

- shared/code-index.md:153-154: "Everything else is `resolved: false`, which makes the answer `partial`, never a silent `complete`."
- :156-159: literal tracking; "The forms below are the ones the case matrix tests, not a limit: the extractors count every binding their parser marks."
- :193-195: unresolved rows carry `resolved: false`, `callee: null`, "and it is never dropped."
- extract.mjs:9-10 (header): "anything else is emitted with resolved false rather than dropped."
- The table (:163-187) has no row for class expressions, fields, static blocks, block scoping, catch, defaults, `with`, labels, dynamic import, tagged templates, CommonJS, or decorators.
