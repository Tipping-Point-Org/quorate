// contract-yaml.mjs — the strict parser for the graph_contract block.
//
// It lived inside new-run.mjs, which is a CLI: importing it to reach the parser would have run the
// whole mint. So the function deciding what every key in the most load-bearing file in this system
// MEANS had no test of its own, and nothing could enumerate the keys it recognises.
//
// That absence is why adding a contract key was unratcheted: the template, the owning document and
// the readers agreed by care rather than by construction, and a key added to one and forgotten in
// the others would fail nothing. A ratchet needs to ask the REAL parser what keys exist — a second
// regex extractor beside it could disagree with the engine and still pass, which is the "two owners
// of one fact" defect this repository keeps paying for.
//
// Moved verbatim, no behaviour change: `scalar` and `splitTopLevel` are nested inside it, so it had
// no dependency on new-run at all.
// ---------------------------------------------------------------------------- YAML subset
// A deliberately STRICT parser for the shape the contract block is allowed to take. Anything
// outside that shape is an error rather than a guess: a contract that parses into something
// unintended is worse than one that refuses to parse.
export function parseContractYaml(src) {
  const lines = src.split('\n');
  const root = {};
  const stack = [{ indent: -1, node: root }];

  const scalar = (raw) => {
    let v = raw.trim();
    if (v === '') return '';
    // Anchors, aliases and tags are HARD errors, not accepted as ordinary strings (G-15). The old
    // final `return v` let `external_panel: *flag` become the string "*flag", which !== true, so
    // the panel silently did not run while the contract appeared to enable it — a frozen contract
    // meaning something other than what it says is the one artifact that must not misparse quietly.
    if (/^[&*!]/.test(v)) {
      throw new Error(`unsupported YAML syntax "${v}": anchors (&), aliases (*) and tags (!) are not allowed in the graph_contract block`);
    }
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+$/.test(v)) return Number(v);
    if (/^-?\d*\.\d+$/.test(v)) return Number(v);
    const q = v[0] === '"' || v[0] === "'" ? v[0] : null;
    if (q) {
      // AN UNTERMINATED QUOTE IS A PARSE ERROR, not a string (G-31, panel-codex-contract). The
      // paired-quote test failed on `test: "node tests/run-all.mjs` and fell through to the raw
      // return below, turning malformed YAML into the valid-looking value `"node tests/run-all.mjs`
      // — a command with a leading quote, which then fails to launch and reads as a broken project
      // rather than a broken contract. I-18 requires a NAMED parse error, and the contract is the
      // one artifact whose misreading must never be quiet. `v.length > 1` matters: a bare `"` is
      // both its own opening and its own closing quote under a naive test.
      if (v.length < 2 || v[v.length - 1] !== q) {
        throw new Error(`unterminated ${q === '"' ? 'double' : 'single'}-quoted value: ${v}`);
      }
      return v.slice(1, -1);
    }
    if (v.startsWith('[') && v.endsWith(']')) {
      const inner = v.slice(1, -1).trim();
      if (!inner) return [];
      return splitTopLevel(inner).map((s) => scalar(s));
    }
    if (v.startsWith('{') && v.endsWith('}')) {
      const inner = v.slice(1, -1).trim();
      const obj = {};
      if (!inner) return obj;
      for (const part of splitTopLevel(inner)) {
        const ci = part.indexOf(':');
        if (ci === -1) throw new Error(`flow map entry without a colon: ${part}`);
        const fk = part.slice(0, ci).trim();
        // Same rule as the block-mapping branch above (G-21): a flow map is no less
        // contract-supplied for fitting on one line.
        if (fk === '__proto__' || fk === 'constructor' || fk === 'prototype') {
          throw new Error(`'${fk}' is not a permitted contract key — it reaches the object prototype`);
        }
        obj[fk] = scalar(part.slice(ci + 1));
      }
      return obj;
    }
    return v;
  };

  const splitTopLevel = (s) => {
    const out = [];
    let depth = 0, quote = null, cur = '';
    for (const ch of s) {
      if (quote) {
        cur += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === '[' || ch === '{') depth++;
      if (ch === ']' || ch === '}') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map((x) => x.trim());
  };

  // Strip a trailing comment that sits outside quotes. Extracted so a wrapped flow collection's
  // continuation lines get the same treatment as the line that opened it.
  const stripInlineComment = (raw) => {
    let quote = null, cut = -1;
    for (let k = 0; k < raw.length; k++) {
      const ch = raw[k];
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '#' && k > 0 && /\s/.test(raw[k - 1])) { cut = k; break; }
    }
    return (cut === -1 ? raw : raw.slice(0, cut)).trim();
  };

  // Net unclosed [ or { OUTSIDE quotes. > 0 means the collection continues on the next line.
  const flowDepth = (text) => {
    let quote = null, depth = 0;
    for (const ch of text) {
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;
    }
    return depth;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const indent = line.length - line.trimStart().length;
    let content = stripInlineComment(line.trim());
    if (!content) continue;

    // Join a flow collection that WRAPS across lines. A real project's generated_globs runs to a
    // dozen entries — model trees, dataset trees, virtualenvs — and wrapping it is the natural
    // thing to write. This parser required one physical line and reported the continuation as
    // `expected "key: value"`, which points at the wrong line and names the wrong problem; the
    // single-line requirement was documented nowhere. Observed on the first real consumer install.
    // Depth is counted outside quotes, so a bracket inside a string cannot open a continuation.
    for (let depth = flowDepth(content); depth > 0 && i + 1 < lines.length; depth = flowDepth(content)) {
      const next = stripInlineComment(lines[++i].trim());
      if (next) content += ' ' + next;
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;

    if (content.startsWith('- ')) {
      throw new Error(`line ${i + 1}: block sequences are not supported; use flow form ["a","b"]`);
    }

    const ci = content.indexOf(':');
    if (ci === -1) throw new Error(`line ${i + 1}: expected "key: value", got "${content}"`);
    const key = content.slice(0, ci).trim();
    const rest = content.slice(ci + 1).trim();
    // A CONTRACT MAY NOT REACH THE PROTOTYPE (G-21, panel-codex-security). Keys here come from a
    // file the consuming project controls and are assigned into ordinary objects, so `__proto__:`
    // with a nested block placed `reviewers` or `runtime` on Object.prototype — where every later
    // `contract.review.runtime ?? ...` lookup finds it, and where JSON.stringify does NOT, so the
    // frozen run.json records a contract that omits the thing the run actually obeyed. A hidden
    // runtime override is the one value in this file worth polluting for: it decides which binary
    // every node spawns under.
    //
    // Refused rather than skipped: a contract containing this is not a contract with one bad line,
    // and the two keys that make a prototype reachable have no legitimate use in a graph_contract.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error(`line ${i + 1}: '${key}' is not a permitted contract key — it reaches the `
        + 'object prototype, where a value would govern the run without appearing in run.json');
    }

    if (rest === '>' || rest === '|') {
      // Folded / literal block scalar: consume the more-indented lines that follow.
      const buf = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (!lines[j].trim()) { buf.push(''); continue; }
        const ind = lines[j].length - lines[j].trimStart().length;
        if (ind <= indent) break;
        buf.push(lines[j].trim());
      }
      i = j - 1;
      parent[key] = rest === '>' ? buf.join(' ').replace(/\s+/g, ' ').trim() : buf.join('\n');
    } else if (rest === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = scalar(rest);
    }
  }
  return root;
}
