// quorate's reference JavaScript extractor for the code index (shared/code-index.md).
//
//   node extract.mjs --identity --root <repository root>
//   node extract.mjs --language javascript --request <request.json>
//
// It parses with acorn, loaded from the CONSUMER's repository (createRequire at the request's root), never from quorate,
// so quorate keeps no dependencies. Without acorn every file answers not_configured, saying so. An HTML file is cut to
// its inline <script> blocks, and every fact's span is mapped back to the HTML file's own lines. All blocks of one file
// share one scope, as a browser's do. A name is resolved one hop, through the file's own top-level definitions, its
// imports, or the platform's globals; anything else is emitted with resolved false rather than dropped.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const NAME = 'quorate-javascript';
const VERSION = '1';
const SCHEMA = 1;
const HERE = fileURLToPath(import.meta.url);
// The constructs this extractor models as scopes and binders: generated from shared/code-index.md's JavaScript table
// (the one hand-kept copy) by `node scripts/gen-rule-text.mjs`; do not edit inside the markers (code-index-d1-part-b.plan.md
// stage 2).
// rule:scope-constructs language="javascript"
const SCOPE_CONSTRUCTS = Object.freeze({
  Program: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: false }),
  FunctionDeclaration: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: true }),
  FunctionExpression: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: false }),
  ArrowFunctionExpression: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: false }),
  MethodDefinition: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: false }),
  ClassDeclaration: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: true }),
  ImportDeclaration: Object.freeze({ opens_scope: false, visible_to_nested: false, binds_in_parent: true }),
  VariableDeclarator: Object.freeze({ opens_scope: false, visible_to_nested: false, binds_in_parent: true }),
});
// /rule:scope-constructs

// Every node type that opens a scope in JavaScript (ECMAScript's environment records): the program, functions, classes
// and their static blocks, `with`, and the lexical blocks. One the table does not model is OPAQUE, every call inside it
// answering resolved false (fail closed, design B-D1), except the lexical blocks: a block, a `for` head, a `switch` and a
// `catch` clause are a scope only for the names they declare, so a call naming one of those fails closed and the rest
// resolve as before. A function body's own block is the function's scope, not a lexical block.
const LANGUAGE_SCOPES = new Set(['Program', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'MethodDefinition', 'ClassDeclaration', 'ClassExpression', 'StaticBlock', 'WithStatement', 'BlockStatement',
  'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'CatchClause']);
const LEXICAL_BLOCKS = new Set(['BlockStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement',
  'CatchClause']);
const modelledScope = (kind) => Boolean(SCOPE_CONSTRUCTS[kind]?.opens_scope);
const bindsInParent = (kind) => Boolean(SCOPE_CONSTRUCTS[kind]?.binds_in_parent);
const visibleToNested = (kind) => Boolean(SCOPE_CONSTRUCTS[kind]?.visible_to_nested);
const functionInit = (n) => n?.type === 'ArrowFunctionExpression' || n?.type === 'FunctionExpression';
const GLOBALS = new Set(['console', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Date',
  'RegExp', 'Error', 'Map', 'Set', 'Symbol', 'fetch', 'document', 'window', 'globalThis', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent',
  'requestAnimationFrame', 'localStorage', 'sessionStorage', 'navigator', 'location', 'alert', 'confirm', 'URL',
  'URLSearchParams', 'FormData', 'Blob', 'Event', 'CustomEvent', 'structuredClone', 'queueMicrotask']);
const TABLES = ['definitions', 'calls', 'constructions', 'literals', 'comparisons', 'imports', 'handlers'];
const COMPARE = new Set(['==', '===', '!=', '!==', '<', '<=', '>', '>=', 'instanceof', 'in']);

// Only an acorn that cannot be found is absent (not_configured). One that is found and cannot be read or loaded is a
// failure, said on stderr with exit 2: caught as absent, it answered not_configured for every file and hid the cause
// (G-1 of 20261022-183032-pb-delivery). Node raises MODULE_NOT_FOUND also for an installed acorn whose entry file is
// missing, so that code is absent only when no acorn/package.json sits on the lookup path (G-1 of 191112).
function loadAcorn(root) {
  const req = createRequire(path.join(path.resolve(root), 'package.json'));
  let at;
  try {
    at = req.resolve('acorn');
  } catch (e) {
    const installed = (req.resolve.paths('acorn') ?? []).some((d) => fs.existsSync(path.join(d, 'acorn', 'package.json')));
    if (e?.code === 'MODULE_NOT_FOUND' && !installed) return null;
    return brokenAcorn(e);
  }
  try {
    let dir = path.dirname(at);
    while (!fs.existsSync(path.join(dir, 'package.json')) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return { acorn: req('acorn'), version: pkg.version };
  } catch (e) {
    return brokenAcorn(e);
  }
}

function brokenAcorn(e) {
  process.stderr.write(`extract.mjs: acorn is present but could not be loaded: ${e?.message ?? e}\n`);
  process.exit(2);
}

function identity(root) {
  const loaded = root ? loadAcorn(root) : null;
  return {
    name: NAME, version: VERSION, runtime: `node ${process.versions.node}`,
    parser: loaded ? `acorn ${loaded.version}` : null,
    // Whether a .js file is a module comes from its package.json, so those files are part of the cache key (G-5).
    reads: ['**/package.json'],
    modules: { 'extract.mjs': crypto.createHash('sha256').update(fs.readFileSync(HERE)).digest('hex') },
    // What it models, for the engine to compare with the contract's table (code-index-d1-part-b.plan.md stage 5).
    scope_constructs: SCOPE_CONSTRUCTS,
  };
}

const moduleName = (rel) => rel.replace(/\\/g, '/').replace(/\.(html?|m?js|cjs)$/i, '').split('/').filter(Boolean).join('.');

// The inline <script> blocks of an HTML file: their text and where each starts. A block with src, or a non-JavaScript
// type, carries no code here.
function scriptBlocks(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  // The line and the last newline are carried forward from the previous block, so each byte of the page is counted
  // once: slicing and splitting the whole prefix for every block was O(H×S) (extract.mjs:110 on the ledger).
  let counted = 0;
  let line = 1;
  let lastNl = -1;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && !['text/javascript', 'module', 'application/javascript'].includes(type)) continue;
    const startIndex = m.index + m[0].indexOf('>') + 1;
    for (let i = html.indexOf('\n', counted); i !== -1 && i < startIndex; i = html.indexOf('\n', i + 1)) {
      line += 1;
      lastNl = i;
    }
    counted = startIndex;
    const col = startIndex - (lastNl + 1);
    out.push({ code: m[2], line, col, module: type === 'module' });
  }
  return out;
}

function children(node) {
  const out = [];
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') out.push(x); }
    else if (v && typeof v.type === 'string') out.push(v);
  }
  return out;
}

function dotted(node) {
  const parts = [];
  while (node && node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    parts.push(node.property.name);
    node = node.object;
  }
  if (node && node.type === 'Identifier') { parts.push(node.name); return parts.reverse().join('.'); }
  if (node && node.type === 'ThisExpression') { parts.push('this'); return parts.reverse().join('.'); }
  return null;
}

const argKind = (n) => n.type === 'Identifier' ? 'name' : n.type === 'MemberExpression' ? 'attribute'
  : (n.type === 'CallExpression' || n.type === 'NewExpression') ? 'call' : n.type === 'Literal' ? 'literal' : 'other';

// THE NAMES A PATTERN BINDS, by the ESTree specification's pattern positions (D3 of code-index-schema-and-scope; plan
// stage 2). acorn ships no walker to enumerate them, so the positions are named here, and a test parses one fixture
// holding every position and requires each binding to be counted.
function patternIds(p, out = []) {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier': out.push(p.name); break;
    case 'ArrayPattern': for (const e of p.elements) patternIds(e, out); break;
    case 'ObjectPattern': for (const pr of p.properties) patternIds(pr.type === 'RestElement' ? pr.argument : pr.value, out); break;
    case 'AssignmentPattern': patternIds(p.left, out); break;
    case 'RestElement': patternIds(p.argument, out); break;
    default: break;   // a MemberExpression target binds no name
  }
  return out;
}

/** How many times each name is bound in this node and everything inside it, nested functions and closures included. */
export function bindingCounts(root) {
  const counts = new Map();
  const add = (names) => { for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1); };
  const todo = [root];
  while (todo.length) {
    const n = todo.pop();
    switch (n.type) {
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        if (n.id && n !== root) add([n.id.name]);
        for (const p of n.params) add(patternIds(p));
        break;
      case 'ClassDeclaration': case 'ClassExpression': if (n.id) add([n.id.name]); break;
      case 'VariableDeclarator': add(patternIds(n.id)); break;
      case 'AssignmentExpression': add(patternIds(n.left)); break;
      case 'UpdateExpression': add(patternIds(n.argument)); break;
      case 'CatchClause': add(patternIds(n.param)); break;
      case 'ForInStatement': case 'ForOfStatement': if (n.left.type !== 'VariableDeclaration') add(patternIds(n.left)); break;
      case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': add([n.local.name]); break;
      default: break;
    }
    todo.push(...children(n));
  }
  return counts;
}

/**
 * How many times each name is bound IN ONE SCOPE, and how many of those by a modelled binder (a function or class
 * declaration, an import, or a declarator binding one name to a function, whose table row binds in its enclosing scope):
 * { total, modelled }. It does not descend into nested functions, whose names and parameters are their own, nor class
 * bodies; it does descend into blocks, so a block's `let` is counted here too: an over-count, which only makes more calls
 * unresolved (design B-D1).
 */
function scopeCounts(nodes) {
  const total = new Map();
  const modelled = new Map();
  const add = (names, isModelled = false) => {
    for (const n of names) {
      total.set(n, (total.get(n) ?? 0) + 1);
      if (isModelled) modelled.set(n, (modelled.get(n) ?? 0) + 1);
    }
  };
  const todo = [...nodes];
  while (todo.length) {
    const n = todo.pop();
    switch (n.type) {
      case 'FunctionDeclaration': if (n.id) add([n.id.name], bindsInParent('FunctionDeclaration')); continue;
      case 'FunctionExpression': case 'ArrowFunctionExpression': continue;
      case 'ClassDeclaration':
        if (n.id) add([n.id.name], bindsInParent('ClassDeclaration'));
        if (n.superClass) todo.push(n.superClass);
        continue;
      case 'ClassExpression': if (n.superClass) todo.push(n.superClass); continue;
      case 'VariableDeclarator':
        add(patternIds(n.id), n.id.type === 'Identifier' && functionInit(n.init) && bindsInParent('VariableDeclarator'));
        if (n.init && !functionInit(n.init)) todo.push(n.init);
        continue;
      case 'ImportDeclaration': add(n.specifiers.map((s) => s.local.name), bindsInParent('ImportDeclaration')); continue;
      case 'AssignmentExpression': add(patternIds(n.left)); break;
      case 'UpdateExpression': add(patternIds(n.argument)); break;
      case 'CatchClause': add(patternIds(n.param)); break;
      case 'ForInStatement': case 'ForOfStatement': if (n.left.type !== 'VariableDeclaration') add(patternIds(n.left)); break;
      default: break;
    }
    todo.push(...children(n));
  }
  return { total, modelled };
}

// The names a lexical block declares for itself: its let, const, class and function declarations, a for head's
// declaration, a switch's case declarations, a catch clause's parameter.
function blockNames(node) {
  const out = [];
  const decls = (stmts) => {
    for (const s of stmts) {
      if (s.type === 'VariableDeclaration') for (const d of s.declarations) patternIds(d.id, out);
      else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) out.push(s.id.name);
    }
  };
  if (node.type === 'BlockStatement') decls(node.body);
  else if (node.type === 'ForStatement' && node.init?.type === 'VariableDeclaration') decls([node.init]);
  else if ((node.type === 'ForInStatement' || node.type === 'ForOfStatement') && node.left.type === 'VariableDeclaration') decls([node.left]);
  else if (node.type === 'SwitchStatement') for (const c of node.cases) decls(c.consequent);
  else if (node.type === 'CatchClause') patternIds(node.param, out);
  return new Set(out);
}

// A scope's own definitions: the functions and classes its body declares directly, and functions bound by a declarator.
function ownDefs(body, qualified) {
  const defs = new Map();
  for (const top of body) {
    const s = (top.type === 'ExportNamedDeclaration' || top.type === 'ExportDefaultDeclaration') && top.declaration ? top.declaration : top;
    if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) defs.set(s.id.name, `${qualified}.${s.id.name}`);
    if (s.type === 'VariableDeclaration') {
      for (const d of s.declarations) {
        if (d.id.type === 'Identifier' && (d.init?.type === 'ArrowFunctionExpression' || d.init?.type === 'FunctionExpression')) {
          defs.set(d.id.name, `${qualified}.${d.id.name}`);
        }
      }
    }
  }
  return defs;
}

// A constant the schema's literal type and JSON can both carry: a string, a finite number or a boolean (G-14 of
// 20261020-094311-ciss-delivery). A BigInt makes JSON.stringify throw, and 1e999 would print null.
const isLiteral = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

// D3: the names a scope binds exactly once, by a declarator with a literal initialiser. Nothing else is tracked.
function singleLiterals(body, counts) {
  const out = new Map();
  const todo = [...body];
  while (todo.length) {
    const n = todo.pop();
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassDeclaration', 'ClassExpression'].includes(n.type)) continue;
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init?.type === 'Literal'
      && isLiteral(n.init.value) && counts.get(n.id.name) === 1) {
      out.set(n.id.name, n.init.value);
    }
    todo.push(...children(n));
  }
  return out;
}

function fileFacts(rel, blocks, acorn, manifest) {
  const mod = moduleName(rel);
  const t = Object.fromEntries(TABLES.map((k) => [k, []]));
  const parsed = [];
  for (const b of blocks) {
    const ast = acorn.parse(b.code, { ecmaVersion: 'latest', sourceType: b.module ? 'module' : 'script', locations: true,
      allowHashBang: true });
    parsed.push({ ...b, ast });
  }
  // One scope per file: its top-level names, and its imports.
  const defs = new Map();
  const classes = new Set();
  const imports = new Map();
  for (const { ast } of parsed) {
    for (const top of ast.body) {
      // An exported declaration is still this file's own name (G-2): unwrap `export` and `export default`.
      const s = (top.type === 'ExportNamedDeclaration' || top.type === 'ExportDefaultDeclaration') && top.declaration
        ? top.declaration : top;
      if (s.type === 'FunctionDeclaration' && s.id) defs.set(s.id.name, `${mod}.${s.id.name}`);
      if (s.type === 'ClassDeclaration' && s.id) { defs.set(s.id.name, `${mod}.${s.id.name}`); classes.add(`${mod}.${s.id.name}`); }
      // A declarator is a definition only when it binds one name to a function or an arrow (the table's VariableDeclarator
      // row): `const fs = require('fs')` made fs.readFileSync() resolve to this module (census j30).
      if (s.type === 'VariableDeclaration') for (const d of s.declarations) if (d.id.type === 'Identifier' && functionInit(d.init)) defs.set(d.id.name, `${mod}.${d.id.name}`);
      if (s.type === 'ImportDeclaration') {
        const src = String(s.source.value);
        const target = src.startsWith('.') ? moduleName(path.posix.join(path.posix.dirname(rel.replace(/\\/g, '/')), src)) : src;
        for (const sp of s.specifiers) {
          const imported = sp.type === 'ImportSpecifier' ? (sp.imported.name ?? sp.imported.value) : null;
          imports.set(sp.local.name, imported ? `${target}.${imported}` : target);
        }
      }
    }
  }
  // THE SCOPE STACK (D2 of code-index-schema-and-scope). A name resolves through exactly: the innermost function's own
  // definitions; then the file's top-level definitions and imports; then the platform's globals. `this.m()` in a method
  // resolves to the enclosing class's own method m. A name the innermost function binds any other way, and a closure's
  // outer name, resolve to nothing: resolved false.
  // The module's own bindings, counted (design B-D1): a name the module binds by an assignment, a destructuring or a
  // non-function declarator, as well as by a declaration, no longer resolves to the declaration (census j20, j23).
  const modTotal = new Map();
  const modModelled = new Map();
  for (const { ast } of parsed) {
    const c = scopeCounts(ast.body);
    for (const [k, v] of c.total) modTotal.set(k, (modTotal.get(k) ?? 0) + v);
    for (const [k, v] of c.modelled) modModelled.set(k, (modModelled.get(k) ?? 0) + v);
  }
  const onlyModelled = (total, modelled, name) => total.get(name) === (modelled.get(name) ?? 0);
  const scopes = [];
  // The unmodelled scopes enclosing the node being walked: { all: true } for an opaque one, { names } for a lexical block.
  const frames = [];
  // Fails closed (design B-D1 of the code-index D1 design step): inside an opaque scope nothing resolves, and a name a
  // lexical block declares resolves to nothing; a name bound in a scope by anything the table does not model resolves to
  // nothing; and the WHOLE chain of scopes is read, so a name an enclosing function binds shadows the module's (S10).
  const resolve = (node) => {
    const p = dotted(node);
    if (!p) return null;
    const [head, ...rest] = p.split('.');
    if (frames.some((f) => f.all || f.names.has(head))) return null;
    const scope = scopes.at(-1);
    if (scope && head === 'this') {
      const m = scope.cls?.get(rest[0]);
      if (!m) return null;
      return rest.length > 1 ? `${m}.${rest.slice(1).join('.')}` : m;
    }
    for (let i = scopes.length - 1; i >= 0; i--) {
      const s = scopes[i];
      const depth = scopes.length - 1 - i;
      if (depth > 0 && !visibleToNested(s.node)) continue;
      if (!s.total.has(head)) continue;
      if (depth > 0 || !onlyModelled(s.total, s.modelled, head)) return null;
      const target = s.defs.get(head);
      if (!target) return null;
      return rest.length ? `${target}.${rest.join('.')}` : target;
    }
    let target;
    if (modTotal.has(head)) {
      if (!onlyModelled(modTotal, modModelled, head)) return null;
      target = defs.get(head) ?? imports.get(head);
      if (!target) return null;
    } else if (GLOBALS.has(head)) target = `globals.${head}`;
    else return null;
    return rest.length ? `${target}.${rest.join('.')}` : target;
  };
  // Open a function's scope: its own definitions, its own bindings counted (parameters included), its single-assignment
  // literals, and for an instance method the class's methods, so this.m() resolves. `kind` is its table row.
  const openScope = (fn, qualified, cls, kind) => {
    const body = fn.body?.type === 'BlockStatement' ? fn.body.body : [];
    const { total, modelled } = scopeCounts(body);
    for (const prm of fn.params) for (const n of patternIds(prm)) total.set(n, (total.get(n) ?? 0) + 1);
    // A function expression's own name binds inside it, by no modelled binder.
    if (fn.type === 'FunctionExpression' && fn.id) total.set(fn.id.name, (total.get(fn.id.name) ?? 0) + 1);
    scopes.push({ node: kind, defs: ownDefs(body, qualified), total, modelled, cls });
    return singleLiterals(body, bindingCounts(fn));
  };
  // Each dotted prefix of q looked up in the manifest's set, not every module scanned per call (G-1 of
  // 20261030-124823-ciss-stage7): q === m or q starts with `${m}.` exactly when m is one of q's dotted prefixes.
  const inManifest = (q) => {
    for (let at = q.indexOf('.'); at !== -1; at = q.indexOf('.', at + 1)) if (manifest.has(q.slice(0, at))) return true;
    return manifest.has(q);
  };

  for (const b of parsed) {
    const src = b.code;
    const at = (loc) => ({ line: b.line + loc.line - 1, col: loc.line === 1 ? b.col + loc.column : loc.column });
    const span = (n) => ({ start: at(n.loc.start), end: at(n.loc.end) });
    const text = (n) => src.slice(n.start, n.end);
    const describe = (n, keyword = null) => {
      const d = { keyword, text: text(n), kind: argKind(n) };
      if (n.type === 'MemberExpression') { const p = dotted(n); if (p) d.path = p; }
      return d;
    };
    // A call node's arguments as the callee receives them. A tagged template has no `arguments`: its tag is called with
    // the strings and then each substitution (G-3 of 20261022-183032-pb-delivery).
    const callArgs = (node) => (node.type === 'TaggedTemplateExpression' ? [node.quasi, ...node.quasi.expressions]
      : (node.arguments ?? [])).map((a) => describe(a));
    const assigned =[singleLiterals(b.ast.body, bindingCounts(b.ast))];
    const classes_ = [];
    const emitted = new Set();
    // A function's parameters, defaults included, are walked in a scope of their own before its body's opens: a default
    // cannot see the body's declarations, and resolved against them it named the wrong function (census j19). Its body's
    // own block is its scope, so the block's statements are walked directly, not as a lexical block.
    const enterFunction = (fn, q, cls, kind) => {
      // Every path into a function passes here, a declarator's included, so an unmodelled function kind is opaque however
      // it is reached (walk() checks only the nodes it is handed).
      if (!modelledScope(kind)) {
        frames.push({ all: true, names: new Set() });
        try { enterModelled(fn, q, cls, kind); } finally { frames.pop(); }
        return;
      }
      enterModelled(fn, q, cls, kind);
    };
    const enterModelled = (fn, q, cls, kind) => {
      const params = new Map();
      for (const prm of fn.params) for (const n of patternIds(prm)) params.set(n, 1);
      scopes.push({ node: kind, defs: new Map(), total: params, modelled: new Map(), cls: null });
      for (const prm of fn.params) walk(prm, q);
      scopes.pop();
      assigned.push(openScope(fn, q, cls, kind));
      if (fn.body?.type === 'BlockStatement') for (const s of fn.body.body) walk(s, q);
      else if (fn.body) walk(fn.body, q);
      assigned.pop();
      scopes.pop();
    };
    // A scope the language opens and the table does not model is opaque, and a lexical block is a scope for its own
    // names (design B-D1): the frame is pushed for the node and everything inside it.
    const walk = (node, enclosing) => {
      node.__enclosing = enclosing;
      const kind = node.type;
      const frame = !LANGUAGE_SCOPES.has(kind) || modelledScope(kind) ? null
        : LEXICAL_BLOCKS.has(kind) ? { all: false, names: blockNames(node) } : { all: true, names: new Set() };
      if (frame) frames.push(frame);
      try { walkNode(node, enclosing); } finally { if (frame) frames.pop(); }
    };
    const walkNode = (node, enclosing) => {
      const row = (n, fields) => ({ path: rel, span: span(n), enclosing, ...fields });
      let inner = enclosing;
      switch (node.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression': {
          const name = node.id?.name;
          if (node.type === 'FunctionDeclaration' && name) {
            t.definitions.push(row(node, { name, qualified: `${enclosing}.${name}`, kind: 'function',
              signature: `(${node.params.map(text).join(', ')})` }));
          }
          enterFunction(node, name ? `${enclosing}.${name}` : enclosing, null, node.type);
          return;
        }
        case 'MethodDefinition': {
          // A method is its own definition, and its body's facts are its own, not the class's (G-4).
          const name = node.key.type === 'Identifier' || node.key.type === 'PrivateIdentifier' ? node.key.name
            : node.key.type === 'Literal' ? String(node.key.value) : null;
          if (name === null || node.value?.type !== 'FunctionExpression') break;
          const q = `${enclosing}.${name}`;
          t.definitions.push(row(node, { name, qualified: q, kind: 'function',
            signature: `(${node.value.params.map(text).join(', ')})` }));
          // `this` in a static method is the class, not an instance, so it reaches no instance method (census j10).
          if (node.computed) walk(node.key, enclosing);
          enterFunction(node.value, q, node.static ? null : (classes_.at(-1) ?? null), 'MethodDefinition');
          return;
        }
        case 'VariableDeclarator':
          if (node.id.type === 'Identifier' && (node.init?.type === 'ArrowFunctionExpression' || node.init?.type === 'FunctionExpression')) {
            const q = `${enclosing}.${node.id.name}`;
            t.definitions.push(row(node, { name: node.id.name, qualified: q, kind: 'function',
              signature: `(${node.init.params.map(text).join(', ')})` }));
            node.init.__enclosing = enclosing;
            enterFunction(node.init, q, null, node.init.type);
            return;
          }
          break;
        case 'ClassDeclaration': {
          const q = `${enclosing}.${node.id?.name ?? '<anonymous>'}`;
          t.definitions.push(row(node, { name: node.id?.name ?? null, qualified: q, kind: 'class',
            signature: node.superClass ? `(${text(node.superClass)})` : '()' }));
          for (const el of node.body.body) {
            if (el.type === 'PropertyDefinition' && el.key.type === 'Identifier') {
              const f = { name: el.key.name, qualified: `${q}.${el.key.name}`, kind: 'field', annotation: null };
              // null stays null (the field is nullable); anything that is not a literal, a constant JSON cannot carry
              // included, is its source text in default_text, so "f()" and f() are not one fact (G-3).
              const constant = el.value?.type === 'Literal' && (el.value.value === null && !el.value.regex || isLiteral(el.value.value));
              if (el.value) f[constant ? 'default' : 'default_text'] = constant ? el.value.value : text(el.value);
              t.definitions.push({ path: rel, span: span(el), enclosing: q, ...f });
            }
          }
          // this.m() reaches an instance method only when m names exactly one member of the class: a getter and a setter,
          // a static and an instance member, or a field and a method of one name answer resolved false, and a computed key
          // names nothing (census j09, j10; the operator's example j50: an instance field hides the method).
          const members = new Map();
          for (const el of node.body.body) {
            if ((el.type === 'MethodDefinition' || el.type === 'PropertyDefinition') && !el.computed && el.key.type === 'Identifier') {
              members.set(el.key.name, (members.get(el.key.name) ?? 0) + 1);
            }
          }
          classes_.push(new Map(node.body.body.filter((el) => el.type === 'MethodDefinition' && el.kind === 'method' && !el.static
            && !el.computed && el.key.type === 'Identifier' && members.get(el.key.name) === 1)
            .map((el) => [el.key.name, `${q}.${el.key.name}`])));
          for (const c of children(node)) walk(c, q);
          classes_.pop();
          return;
        }
        case 'ImportDeclaration':
          for (const sp of node.specifiers) {
            t.imports.push(row(node, { module: String(node.source.value), name: sp.imported?.name ?? null,
              alias: sp.local.name, qualified: imports.get(sp.local.name) ?? null }));
          }
          return;
        case 'CallExpression':
        case 'NewExpression': {
          emitted.add(node);
          const target = resolve(node.callee);
          const args = node.arguments.map((a) => describe(a));
          const call = { callee: target, resolved: target !== null, callee_text: text(node.callee), args };
          if (target !== null) call.in_manifest = inManifest(target);
          t.calls.push(row(node, call));
          if (target !== null && (node.type === 'NewExpression' || classes.has(target))) {
            const keys = node.arguments.filter((a) => a.type === 'ObjectExpression').flatMap((o) => o.properties)
              .filter((p) => p.type === 'Property' && !p.computed)
              .map((p) => (p.key.type === 'Identifier' ? p.key.name : String(p.key.value)));
            t.constructions.push(row(node, { type: target, callee_text: text(node.callee), resolved: true, keywords: [],
              dict_keys: keys, args }));
          }
          break;
        }
        // A tagged template calls its tag, and `import()` loads a module: both are calls, and both were dropped (census
        // j26). import() names no function, so it is never resolved.
        case 'TaggedTemplateExpression': {
          emitted.add(node);
          const target = resolve(node.tag);
          const call = { callee: target, resolved: target !== null, callee_text: text(node.tag), args: callArgs(node) };
          if (target !== null) call.in_manifest = inManifest(target);
          t.calls.push(row(node, call));
          break;
        }
        case 'ImportExpression':
          emitted.add(node);
          t.calls.push(row(node, { callee: null, resolved: false, callee_text: 'import', args: [describe(node.source)] }));
          break;
        case 'Literal':
          if (isLiteral(node.value)) t.literals.push(row(node, { value: node.value, type: typeof node.value }));
          return;
        case 'BinaryExpression':
          if (COMPARE.has(node.operator)) {
            const lit = (s) => (s.type === 'Literal' && isLiteral(s.value)) ? [s.value, null]
              : (s.type === 'Identifier' && assigned.at(-1).has(s.name)) ? [assigned.at(-1).get(s.name), s.name] : [null, null];
            let [literal, via] = lit(node.right);
            if (literal === null) [literal, via] = lit(node.left);
            const operands = [node.left, node.right].filter((s) => s.type === 'CallExpression').map((s) => resolve(s.callee)).filter(Boolean);
            const r = { op: node.operator, left: describe(node.left), right: describe(node.right), literal, via };
            if (operands.length) r.operands = operands;
            t.comparisons.push(row(node, r));
          }
          break;
        case 'CatchClause':
          t.handlers.push(row(node, { caught: null }));
          break;
        default:
          break;
      }
      for (const c of children(node)) walk(c, inner);
    };
    walk(b.ast, mod);
    // THE COMPLETION PASS (design B-D2): every call node ESTree defines that the walk did not reach gets a row, resolved
    // false, so none is dropped. Its enclosing definition is the nearest enclosing node the walk keyed.
    const CALL_NODES = new Set(['CallExpression', 'NewExpression', 'TaggedTemplateExpression', 'ImportExpression']);
    const complete = (node, enclosing) => {
      const here = node.__enclosing ?? enclosing;
      if (CALL_NODES.has(node.type) && !emitted.has(node)) {
        const head = node.type === 'ImportExpression' ? null : (node.callee ?? node.tag);
        t.calls.push({ path: rel, span: span(node), enclosing: here, callee: null, resolved: false,
          callee_text: head ? text(head) : 'import', args: node.type === 'ImportExpression' ? [describe(node.source)] : callArgs(node) });
      }
      for (const c of children(node)) complete(c, here);
    };
    complete(b.ast, mod);
  }
  return t;
}

// Whether Node would load this file as an ES module: .mjs is, .cjs is not, and a .js file is when its nearest
// package.json, at or below the root, says "type": "module" (G-6). A package.json that cannot be read or parsed is
// reported, never read as CommonJS: the file it governs is not processed, with the reason (G-5 of 070113).
function isModule(root, rel) {
  if (/\.mjs$/i.test(rel)) return true;
  if (!/\.js$/i.test(rel)) return false;
  const top = path.resolve(root);
  for (let dir = path.dirname(path.resolve(top, rel)); ; dir = path.dirname(dir)) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(pkg, 'utf8')); } catch (e) {
        throw Object.assign(new Error(`${path.relative(top, pkg).split(path.sep).join('/')} cannot be parsed, so whether this file is a module is unknown: ${e.message}`), { packageJson: true });
      }
      return parsed?.type === 'module';
    }
    if (dir === top || path.dirname(dir) === dir) return false;
  }
}

function extract(request) {
  const loaded = loadAcorn(request.root);
  const files = [];
  const facts = Object.fromEntries(TABLES.map((k) => [k, []]));
  const manifest = new Set(request.files.map(moduleName));
  for (const rel of request.files) {
    if (!loaded) {
      files.push({ path: rel, status: 'not_processed', outcome: 'not_configured', reason: `acorn not found from ${request.root}` });
      continue;
    }
    let source;
    try { source = fs.readFileSync(path.join(request.root, rel), 'utf8'); } catch (e) {
      // Never parsed, so not a parse_error: an unread file makes the answer partial (shared/code-index.md).
      files.push({ path: rel, status: 'not_processed', outcome: 'partial', reason: `unreadable: ${e.code ?? e.message}` });
      continue;
    }
    let blocks;
    try {
      blocks = /\.html?$/i.test(rel) ? scriptBlocks(source) : [{ code: source, line: 1, col: 0, module: isModule(request.root, rel) }];
    } catch (e) {
      if (!e.packageJson) throw e;
      files.push({ path: rel, status: 'not_processed', outcome: 'parse_error', reason: e.message });
      continue;
    }
    try {
      const t = fileFacts(rel, blocks, loaded.acorn, manifest);
      for (const k of TABLES) facts[k].push(...t[k]);
      files.push({ path: rel, status: 'processed' });
    } catch (e) {
      const line = e.loc ? e.loc.line : null;
      files.push({ path: rel, status: 'not_processed', outcome: 'parse_error', reason: `SyntaxError${line ? ` at block line ${line}` : ''}: ${e.message}` });
    }
  }
  return { code_index_schema: SCHEMA, extractor: { name: NAME, version: VERSION }, files, facts };
}

// ON REAL PATHS (ci-path-identity.plan.md stage 3b): Node names the main module by its real path, and argv[1] keeps the
// spelling it was started with, so on macOS (/var is a link to /private/var) the extractor started through /var did
// nothing, exited 0 and printed nothing (CI runs 44206754901 to 44240829385).
const realOr = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const invoked = Boolean(process.argv[1]) && realOr(path.resolve(process.argv[1])) === realOr(HERE);
if (invoked) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i === -1 ? undefined : argv[i + 1]; };
  if (argv.includes('--identity')) {
    process.stdout.write(`${JSON.stringify(identity(opt('--root')))}\n`);
  } else if (opt('--language') === 'javascript' && opt('--request')) {
    process.stdout.write(JSON.stringify(extract(JSON.parse(fs.readFileSync(opt('--request'), 'utf8')))));
  } else {
    process.stderr.write('extract.mjs: give --identity --root <dir>, or --language javascript --request <file>\n');
    process.exit(2);
  }
}
