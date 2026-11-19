// source-literals.mjs — which test files name a module in a string literal that is not an import's specifier
// (runner-test-seam.plan.md stage 4). A module with no tests of its own, so importing it runs none twice.
//
// LEXICAL, and its limits are stated here because a census is only as wide as its instrument: a line is read for every
// occurrence of `name`; a line whose text starts with `//` or `*`, or an occurrence after a ` // ` on its line, is a comment;
// the literal around an occurrence is the nearest quote before it (', " or `) whose same quote closes after it, or the
// slashes of a regular expression; a literal is an import's specifier when the text before it on the line ends with `from`,
// `import` or `import(`. Both spellings of a path are seen: 'scripts/io/set-aside.mjs' and the segment 'set-aside.mjs' of
// path.join or read(...).
//
// A SPLIT NAME IS SEEN (G-11 of 20261108-222629-rts-delivery): before the search, literals are joined where the text itself
// joins them (+, across lines too; .concat; an array's .join; a template interpolating a literal) and an escaped dot is read
// as a dot. A literal that alone is more than half of the name and starts or ends it is a site too, for a name held in pieces
// in variables ('aside.mjs').
//
// STILL NOT SEEN, because a lexical census cannot: a name computed at run time (character codes, a reversed string, a piece
// under half the name in a variable), other escapes (\x2d), and a directory listing filtered to the file.
//
//   node tests/tools/source-literals.mjs <name> <dir>     prints file:line: literal for every site, one per line

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PIECE = String.raw`(['"\x60])([^'"\x60\n]*)`;
const JOINED_PLUS = new RegExp(String.raw`${PIECE}\1\s*\+\s*(['"\x60])([^'"\x60\n]*)\3`, 'g');
const JOINED_CONCAT = new RegExp(String.raw`${PIECE}\1\s*\.concat\(\s*(['"\x60])([^'"\x60\n]*)\3\s*\)`, 'g');
const INTERPOLATED = /\$\{\s*(['"])([^'"`\n]*)\1\s*\}/g;
const ARRAY_JOINED = /\[\s*((?:['"`][^'"`\n]*['"`]\s*,\s*)*['"`][^'"`\n]*['"`]\s*,?\s*)\]\.join\(\s*(?:['"`]([^'"`\n]*)['"`])?\s*\)/g;
const LITERAL = /(['"`])([^'"`\n]+)\1/g;

// The newlines a join removed go after the joined literal, so every line after it keeps its number.
const lines = (m) => m.replace(/[^\n]/g, '');

/** `text` with its literals joined where the text joins them, and an escaped dot read as a dot; its line numbers unchanged. */
export function joinedLiterals(text) {
  let s = text.replace(/\\\./g, '.').replace(INTERPOLATED, (m, q, v) => v);
  for (let previous = null; previous !== s;) {
    previous = s;
    s = s.replace(JOINED_PLUS, (m, q, a, q2, b) => `${q}${a}${b}${q}${lines(m)}`)
      .replace(JOINED_CONCAT, (m, q, a, q2, b) => `${q}${a}${b}${q}${lines(m)}`)
      .replace(ARRAY_JOINED, (m, items, sep = ',') => `'${[...items.matchAll(LITERAL)].map((x) => x[2]).join(sep)}'${lines(m)}`);
  }
  return s;
}

const isSpecifier = (raw, open) => /(?:\bfrom|\bimport|\bimport\()$/.test(raw.slice(0, open).trimEnd());   // a static or dynamic import's

/** Every site in `text` naming `name` in a string literal that is not an import specifier: [{ line, literal }]. */
export function literalSites(text, name) {
  const out = [];
  joinedLiterals(text).split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    const comment = raw.indexOf(' // ');
    let from = 0;
    for (let at = raw.indexOf(name, from); at >= 0; at = raw.indexOf(name, from)) {
      from = at + name.length;
      if (comment >= 0 && comment < at) continue;
      let open = -1;
      let q = null;
      for (let j = at - 1; j >= 0; j -= 1) {
        const c = raw[j];
        if ((c === "'" || c === '"' || c === '`') && raw.indexOf(c, at + name.length) >= 0) { open = j; q = c; break; }
      }
      if (open < 0) {
        // Not in a quoted literal: a regular expression's slashes, or nothing this instrument can see.
        const slash = raw.lastIndexOf('/', at - 1);
        const end = raw.indexOf('/', at + name.length);
        if (slash >= 0 && end >= 0) out.push({ line: i + 1, literal: raw.slice(slash, end + 1) });
        continue;
      }
      const close = raw.indexOf(q, at + name.length);
      if (isSpecifier(raw, open)) continue;
      out.push({ line: i + 1, literal: raw.slice(open, close + 1) });
    }
    // A name held in pieces: a literal that alone is more than half of it, and starts or ends it.
    for (const m of raw.matchAll(LITERAL)) {
      const v = m[2];
      if (v === name || v.includes(name) || v.length * 2 <= name.length || !(name.startsWith(v) || name.endsWith(v))) continue;
      if ((comment >= 0 && comment < m.index) || isSpecifier(raw, m.index)) continue;
      out.push({ line: i + 1, literal: m[0] });
    }
  });
  return out;
}

/** Every test file below `dir` (relative, slash-separated) with its sites, for files that have any. */
export function filesNaming(dir, name, root = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { out.push(...filesNaming(abs, name, root)); continue; }
    if (!/\.(mjs|js|cjs)$/.test(e.name)) continue;
    const sites = literalSites(fs.readFileSync(abs, 'utf8'), name);
    if (sites.length) out.push({ file: path.relative(root, abs).split(path.sep).join('/'), sites });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, dir] = process.argv.slice(2);
  for (const f of filesNaming(dir, name)) for (const s of f.sites) console.log(`${f.file}:${s.line}: ${s.literal}`);
}
