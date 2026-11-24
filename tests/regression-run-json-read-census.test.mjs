// EVERY READ OF A run.json IN scripts/ IS BOUNDED, OR NAMED (operator, 2026-11-24: "One census round, then close
// (Recommended)"; "I fix the test, add the census, retry (Recommended)").
//
// The 8 MiB bound on a run record (RUN_RECORD_MAX_BYTES, scripts/lib/reviews-root.mjs) reached one reader per review:
// admitRun (G-5 of 20261124-140633-gsw-remediation-review-b), then archive-run and telemetry (G-3 of
// 20261124-160743-gsw-remediation-2-review-b), then telemetry-record's fallback and remediate's loadRun (G-6, G-10 of
// 20261124-170802-gsw-remediation-3-review-b). Each fix reached the reported site and missed its siblings. This census
// finds every line that reads a run.json, by the literal or through a variable holding a path to one, and holds it to a
// bounded reader (readRunJson, readRunRecord, admitRun) or to a named entry below with its reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const BOUNDED = /\breadRunJson\b|readRunRecord\(|admitRun\(/;   // readRunJson called, or passed as the parser
const READS = /\.read\(|readFileSync\(|readJson\(|JSON\.parse\(|runRead\(|ownJson\(/;
const WRITES = /\.replace\(\[|writeJson\(|writeTrackedJson\(|writeFileSync\(/;

// file -> [line text fragment, reason]. Each must still match a line, so a stale entry fails too.
const NAMED = {
  'scripts/run-graph.mjs': [
    ['Object.assign(runJson, JSON.parse(runRead(runJsonPath)));',
      'the run\'s own record re-read right after run-checks, a child this engine spawned, rewrote it; the record was admitted under the bound at start'],
    ['const onDisk = JSON.parse(runRead(runJsonPath));',
      'the run\'s own record re-read at its end to stamp graph_ended_at, best-effort, after this process wrote it; admitted under the bound at start'],
  ],
};

function scriptFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...scriptFiles(p));
    else if (e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// STATEMENTS, NOT LINES (G-12 of 20261124-180917-gsw-remediation-4-review-b): a path built over several lines, or a read
// whose call and path sit on different lines, was invisible to a per-line match. The source is cut at `;`, `{` and `}`
// outside a string or template, and each piece keeps the line it starts on.
function statements(code) {
  const out = [];
  let cur = '';
  let start = -1;
  let quote = null;
  let depth = 0;
  code.forEach((l, i) => {
    if (quote === "'" || quote === '"') quote = null;   // a plain string ends with its line; a template does not
    for (let k = 0; k <= l.length; k++) {
      const ch = k < l.length ? l[k] : '\n';
      if (start < 0 && /\S/.test(ch)) start = i;
      cur += ch;
      if (quote) {
        if (ch === '\\') { cur += l[k + 1] ?? ''; k++; } else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      // `;` always ends a piece; a brace only outside a call, so an options object (`{ parse: readRunJson }`) stays with
      // the read it configures while a function body inside a call is still cut at its statements.
      if (ch === ';' || (depth === 0 && (ch === '{' || ch === '}'))) {
        if (start >= 0) out.push({ line: start + 1, text: cur });
        cur = ''; start = -1;
      }
    }
  });
  if (start >= 0) out.push({ line: start + 1, text: cur });
  return out;
}

// A string naming a run.json, in any quote or a template ending in it: 'run.json', "run.json", `${dir}/run.json`.
const LITERAL = /run\.json['"`]/;
const DECL = /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*([\s\S]*?)[\s;{}]*$/;
// A right-hand side that is a path: path.join/resolve/normalize, an owner's resolve([...]), a string, or a bare alias.
const PATH_EXPR = /^(?:path\.(?:join|resolve|normalize)\(|[\w.]+\.resolve\(\[|['"`])/;

export function runJsonReads(rel, src) {
  const lines = src.split(/\r?\n/);
  const code = lines.map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l));
  const stmts = statements(code);
  // Variables that hold a path to a run.json, to a fixpoint so an alias of one is one too.
  const vars = new Set();
  const refersTo = (t) => LITERAL.test(t) || [...vars].some((v) => new RegExp(`\\b${v}\\b`).test(t));
  const pathDecl = (t) => {
    const m = DECL.exec(t);
    if (!m) return null;
    const rhs = m[2].trim();
    if ((PATH_EXPR.test(rhs) && refersTo(rhs)) || vars.has(rhs)) return m[1];
    return null;
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const s of stmts) {
      const v = pathDecl(s.text);
      if (v && !vars.has(v)) { vars.add(v); grew = true; }
    }
  }
  const hits = [];
  for (const s of stmts) {
    const t = s.text;
    if (!refersTo(t) || !READS.test(t) || WRITES.test(t)) continue;
    if (pathDecl(t)) continue;   // the path itself, not a read
    if (BOUNDED.test(t)) continue;
    hits.push({ rel, line: s.line, text: t.trim() });
  }
  return hits;
}

test('every read of a run.json in scripts/ goes through a bounded reader or is named with its reason', () => {
  const unnamed = [];
  const used = new Set();
  for (const abs of scriptFiles(path.join(REPO_ROOT, 'scripts'))) {
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    for (const h of runJsonReads(rel, fs.readFileSync(abs, 'utf8'))) {
      const named = (NAMED[rel] ?? []).find(([frag]) => h.text.includes(frag));
      if (named) used.add(`${rel}\0${named[0]}`);
      else unnamed.push(`${h.rel}:${h.line}: ${h.text.slice(0, 140)}`);
    }
  }
  assert.deepEqual(unnamed, [], 'a run.json read with no size bound, neither through readRunJson/readRunRecord/admitRun nor named here');
  for (const [rel, entries] of Object.entries(NAMED)) {
    for (const [frag] of entries) assert.ok(used.has(`${rel}\0${frag}`), `a named entry matches no read: ${rel}: ${frag}`);
  }
});

test('the census sees the shapes it exists for: a literal read, a read through a path variable, and a bounded one', () => {
  const src = [
    "const a = JSON.parse(own.read(['run.json']));",
    "const rjPath = path.join(runDir, 'run.json');",
    'const b = JSON.parse(fs.readFileSync(rjPath, \'utf8\'));',
    "const c = readRunJson(own, ['run.json']);",
    "own.replace(['run.json'], body);",
    "// JSON.parse(own.read(['run.json'])) in a comment",
  ].join('\n');
  assert.deepEqual(runJsonReads('x.mjs', src).map((h) => h.line), [1, 3]);
});

// G-12 of 20261124-180917-gsw-remediation-4-review-b: the census found a path variable only on one line, through
// path.join and a single-quoted 'run.json', so a reader spelled any other way passed it. Each spelling below is an
// unbounded read of a run.json and must be found; the bounded and write-only ones must not be.
test('the census sees the other spellings: double quotes, a template, path.resolve, an alias, a multiline path and read', () => {
  const src = [
    'const a = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));',          // 1: double quotes
    'const b = JSON.parse(fs.readFileSync(`${dir}/run.json`, "utf8"));',                      // 2: a template
    "const resolved = path.resolve(dir, 'run.json');",                                         // 3: path.resolve (a path)
    'const c = JSON.parse(fs.readFileSync(resolved));',                                        // 4: read through it
    'const alias = resolved;',                                                                 // 5: an alias (a path)
    'const d = fs.readFileSync(alias, "utf8");',                                               // 6: read through the alias
    'const multi = path.join(',                                                                // 7: a multiline path
    '  dir,',                                                                                  // 8
    "  'run.json',",                                                                           // 9
    ');',                                                                                      // 10
    'const e = JSON.parse(fs.readFileSync(multi));',                                           // 11: read through it
    'const f = JSON.parse(',                                                                   // 12: a multiline read
    '  fs.readFileSync(',                                                                      // 13
    '    path.join(dir, "run.json"),',                                                         // 14
    '  ),',                                                                                    // 15
    ');',                                                                                      // 16
    'const g = readRunJson(own, ["run.json"]);',                                               // 17: bounded
    'own.replace(["run.json"], body);',                                                        // 18: a write
    'const h = JSON.parse(fs.readFileSync(path.join(dir, "run.json.lock")));',                 // 19: not a run.json
    "const r = readJson(own, ['run.json'], {",                                                 // 20: bounded by its options
    '  parse: readRunJson });',                                                                // 21
  ].join('\n');
  assert.deepEqual(runJsonReads('x.mjs', src).map((h) => h.line), [1, 2, 4, 6, 11, 12]);
});
