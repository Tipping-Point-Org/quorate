// Every call node in the given JavaScript files, as ESTree defines one: CallExpression, NewExpression,
// TaggedTemplateExpression, ImportExpression. The census coverage test's independent count, so it does not depend on
// the extractor's own idea of where calls are. acorn is loaded from <root>/node_modules, as the extractor loads it.
//
//   node list_calls.mjs <root> <file> [<file> ...]   ->  JSON [{file, line, col, text}]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [root, ...files] = process.argv.slice(2);
const acorn = createRequire(path.join(root, 'package.json'))('acorn');
const CALLS = new Set(['CallExpression', 'NewExpression', 'TaggedTemplateExpression', 'ImportExpression']);
const out = [];
for (const rel of files) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  // As the extractor parses: a .cjs file is a script (`with` is legal there); a file the parser refuses has no call nodes
  // to count, and the test checks the extractor answers it parse_error.
  let tree;
  try {
    tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: rel.endsWith('.cjs') ? 'script' : 'module', locations: true, allowHashBang: true });
  } catch { continue; }
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (CALLS.has(node.type)) {
      const head = node.type === 'ImportExpression' ? { start: node.start, end: node.start + 6 } : (node.callee ?? node.tag);
      out.push({ file: rel, line: node.loc.start.line, col: node.loc.start.column, text: source.slice(head.start, head.end) });
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
    }
  };
  walk(tree);
}
console.log(JSON.stringify(out));
