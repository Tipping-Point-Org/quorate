// code-index-query.mjs — one question asked of a language's facts, answered with one outcome (shared/code-index.md).
//
// Pure: facts in, { outcome, rows, not_checked } out. The rules are the shared document's "Resolution" section:
// - a question whose own target resolves to nothing answers `unresolved`, never an empty `complete`;
// - rows that are themselves unresolved make the answer `partial`, and stay in it;
// - a file in scope that was not processed makes the answer `partial`, and is named.
import { SHAPES, answerFileErrors } from './code-index-schema.mjs';

const under = (q, prefix) => q === prefix || q.startsWith(`${prefix}.`);

/** Every qualified name the facts give a meaning: definitions, modules, import targets, resolved callees. */
export function knownNames(facts) {
  const known = new Set();
  for (const d of facts.definitions ?? []) known.add(d.qualified);
  for (const t of Object.values(facts)) for (const r of t ?? []) {
    // The module of every row: the first segment chain of its enclosing that is not a definition.
    if (typeof r.enclosing === 'string') known.add(r.enclosing);
  }
  for (const i of facts.imports ?? []) if (i.qualified) known.add(i.qualified);
  for (const c of facts.calls ?? []) if (c.resolved && c.callee) known.add(c.callee);
  for (const k of [...known]) { const parts = k.split('.'); for (let n = 1; n < parts.length; n++) known.add(parts.slice(0, n).join('.')); }
  return known;
}

const resolvesTo = (known, name) => typeof name === 'string' && name !== '' && known.has(name);
const resolvesPrefix = (known, prefix) => [...known].some((k) => k.startsWith(prefix));

function select(shape, args, facts, known) {
  const a = args ?? {};
  switch (shape) {
    case 'symbol': {
      const name = String(a.name ?? '');
      const prefix = name.endsWith('.');
      if (prefix ? !resolvesPrefix(known, name) : !resolvesTo(known, name)) return null;
      return (facts.definitions ?? []).filter((d) => (prefix ? d.qualified.startsWith(name) : d.qualified === name)
        && (a.kind === undefined || d.kind === a.kind) && (a.annotation === undefined || d.annotation === a.annotation)
        // annotation_contains: a substring of the annotation text, so str finds str | None and list[str] too.
        && (a.annotation_contains === undefined || (typeof d.annotation === 'string' && d.annotation.includes(a.annotation_contains))));
    }
    case 'calls':
      if (!resolvesTo(known, a.callee)) return null;
      return (facts.calls ?? []).filter((c) => c.callee === a.callee
        && (a.arg_path === undefined || (c.args ?? []).some((x) => x.path === a.arg_path)));
    case 'constructions':
      if (!resolvesTo(known, a.type)) return null;
      return (facts.constructions ?? []).filter((c) => c.type === a.type);
    case 'literals':
      if (a.within !== undefined && !resolvesTo(known, a.within)) return null;
      return (facts.literals ?? []).filter((l) => l.value === a.value && (a.within === undefined || under(l.enclosing, a.within)));
    case 'comparisons':
      if (a.within !== undefined && !resolvesTo(known, a.within)) return null;
      if (a.operand !== undefined && !resolvesTo(known, a.operand)) return null;
      return (facts.comparisons ?? []).filter((c) => (a.within === undefined || under(c.enclosing, a.within))
        && (a.operand !== undefined ? (c.operands ?? []).includes(a.operand) : c.literal === a.literal));
    case 'callees':
      if (!resolvesTo(known, a.of)) return null;
      return (facts.calls ?? []).filter((c) => c.enclosing === a.of);
    case 'handlers': {
      const set = (Array.isArray(a.calls_any) ? a.calls_any : []).filter((n) => resolvesTo(known, n));
      if (!set.length) return null;
      const targets = new Set(set);
      const fns = new Set(set);
      for (const c of facts.calls ?? []) if (targets.has(c.callee)) fns.add(c.enclosing);
      return (facts.handlers ?? []).filter((h) => fns.has(h.enclosing) && (a.caught === undefined || h.caught === a.caught));
    }
    default:
      return undefined;
  }
}

/** Does a fact row carry every field an expected row lists? `line` is the span's start line; objects nest. */
export function rowCovers(fact, expected) {
  return Object.entries(expected ?? {}).every(([k, v]) => {
    if (k === 'line') return fact?.span?.start?.line === v;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return Boolean(fact?.[k]) && rowCovers(fact[k], v);
    return JSON.stringify(fact?.[k] ?? null) === JSON.stringify(v);
  });
}

/** Does an answer match an expected sweep: the outcome, and exactly the expected rows (each covered, none extra)? */
export function sweepMatches(result, sweep) {
  // Bucketed by path, and within a path by line, so each expected row is checked only against the rows it could match
  // (G-25 of 20261020-043006-code-index-delivery; scripts/lib/code-index-query.mjs:90, cubic within one path). An
  // expected row with no line, which the answer-file format allows, is checked against its whole path's bucket.
  const byPath = new Map();
  const byLine = new Map();
  for (const r of result.rows) {
    const p = r.path;
    if (!byPath.has(p)) byPath.set(p, []);
    byPath.get(p).push(r);
    const k = `${p}\0${r.span?.start?.line}`;
    if (!byLine.has(k)) byLine.set(k, []);
    byLine.get(k).push(r);
  }
  const bucket = (e) => (Number.isInteger(e.line) ? byLine.get(`${e.path}\0${e.line}`) : byPath.get(e.path)) ?? [];
  // One actual row covers one expected row at most, so a match is a one-to-one assignment, found by augmenting paths
  // within each path's bucket (G-16 of 20261020-051530-code-index-remediation-review: each expected row matched by
  // `some` alone let two of them share one actual row, and an unexpected row then made the totals agree).
  const takenBy = new Map();
  const assign = (e, covers, seen) => {
    for (const r of covers.get(e)) {
      if (seen.has(r)) continue;
      seen.add(r);
      if (!takenBy.has(r) || assign(takenBy.get(r), covers, seen)) { takenBy.set(r, e); return true; }
    }
    return false;
  };
  const covers = new Map((sweep.expected ?? []).map((e) => [e, bucket(e).filter((r) => rowCovers(r, e))]));
  const missing = (sweep.expected ?? []).filter((e) => !assign(e, covers, new Set()));
  const ok = result.outcome === sweep.outcome && missing.length === 0 && result.rows.length === (sweep.expected ?? []).length;
  return { ok, missing, got: { outcome: result.outcome, rows: result.rows.length } };
}

/** Why a consumer's answer file is refused, or []. The checks are the spec's (code-index-schema.mjs, answerFileErrors). */
export function answersFileErrors(file) {
  return answerFileErrors(file);
}

/**
 * Answer one question. `facts` are one language's merged facts, `files` that language's response file list. Returns
 * { outcome, rows, not_checked }; an unknown shape is refused by the caller before this is reached.
 */
export function answer(shape, args, { facts, files }) {
  if (!SHAPES.includes(shape)) throw new Error(`answer: unknown shape ${JSON.stringify(shape)}`);
  const known = knownNames(facts);
  const rows = select(shape, args, facts, known);
  const skipped = (files ?? []).filter((f) => f.status !== 'processed');
  const not_checked = skipped.map((f) => `${f.path}: not processed (${f.outcome}${f.reason ? `: ${f.reason}` : ''})`);
  if (rows === null) {
    // The target resolves to nothing. With every file read, that is `unresolved`. With a file in scope that failed to
    // parse, the target may be defined in it, so the answer is `parse_error`, naming the file (G-31 of
    // 20261020-043006-code-index-delivery, G-37 of 061457). Any other unread file makes it `partial`.
    const outcome = skipped.some((f) => f.outcome === 'parse_error') ? 'parse_error' : skipped.length ? 'partial' : 'unresolved';
    return { outcome, rows: [], not_checked };
  }
  const sorted = [...rows].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : x.span.start.line - y.span.start.line
    || x.span.start.col - y.span.start.col));
  const partial = skipped.length > 0 || sorted.some((r) => r.resolved === false);
  return { outcome: partial ? 'partial' : 'complete', rows: sorted, not_checked };
}
