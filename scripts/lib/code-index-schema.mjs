// code-index-schema.mjs — the interpreter of scripts/lib/code-index-spec.mjs: is this record one the index may trust?
//
// The spec holds every record's fields as data; this module checks a record against it, and runs the cross-record rules
// the spec names (RULES), each by name: every refusal one of them makes ends `(rule <name>)`, a name RULES must hold, and
// every rule RULES names has a call site here (G-19 of 20261021-162807-ciss-d1-review: RULES was named here and never
// imported; G-4 of 20261021-190234-ciss-d1-remediations-review: the second list that replaced it is gone) (code-index-schema-and-scope.plan.md stage 1; design D1). Before, each check was
// written by hand, and four review rounds each found a field the page named and the code did not check. Pure: no I/O,
// no clock, no environment (ARCHITECTURE §2). Every function returns a list of errors, empty when the record is
// acceptable, so a caller can name every problem at once.
import { validateGlob } from './contract-glob.mjs';
import {
  CODE_INDEX_SCHEMA, CODE_INDEX_REQUEST, CODE_INDEX_ANSWER, TABLES, SHAPES, OUTCOMES, EXTRACTOR_FAILURES, DEFINITION_KINDS,
  ARGUMENT_KINDS, ROW, TABLE_FIELDS, SHAPE_ARGS, SHAPE_ONE_OF, IDENTITY, RESPONSE, ENVELOPE, ANSWER_FILE, REQUEST, RULES,
} from './code-index-spec.mjs';

export { CODE_INDEX_SCHEMA, CODE_INDEX_REQUEST, CODE_INDEX_ANSWER, TABLES, SHAPES, OUTCOMES, EXTRACTOR_FAILURES, DEFINITION_KINDS, ARGUMENT_KINDS };

/** A cross-record refusal, carrying the name of the rule it breaks. The rules have one owner, the spec's RULES: a second
 *  list here restated it and proved only that the two lists agreed (G-4 of 20261021-190234-ciss-d1-remediations-review);
 *  that every rule RULES names is applied by a call of rule() is held by regression-ciss-d1-r3-rules-one-owner. */
function rule(name, message) {
  if (!(name in RULES)) throw new Error(`code-index-schema: ${JSON.stringify(name)} is not a rule the spec names`);
  return `${message} (rule ${name})`;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPos = (p) => isObject(p) && Number.isInteger(p.line) && p.line >= 1 && Number.isInteger(p.col) && p.col >= 0;

/** Does a value have this field type? Returns null, or what the value should have been. */
function typeError(type, v) {
  switch (type) {
    case 'string': return typeof v === 'string' ? null : 'text';
    case 'name': return typeof v === 'string' && v !== '' ? null : 'a non-empty name';
    case 'bool': return typeof v === 'boolean' ? null : 'true or false';
    case 'int': return Number.isInteger(v) ? null : 'an integer';
    case 'literal': return ['string', 'number', 'boolean'].includes(typeof v) ? null : 'a literal (a string, number or boolean)';
    case 'any': return v === undefined ? 'present' : null;
    case 'list': return Array.isArray(v) ? null : 'a list';
    case 'object': return isObject(v) ? null : 'an object';
    case 'map': return isObject(v) ? null : 'an object of named values';
    case 'span':
      if (!isObject(v) || !isPos(v.start) || !isPos(v.end)) return 'a span { start, end } with 1-based lines';
      // A span on one line ends at or after its start column (G-18); one that ends on a later line may end at any column.
      return v.end.line < v.start.line || (v.end.line === v.start.line && v.end.col < v.start.col) ? 'a span that ends after it starts' : null;
    case 'sha256': return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? null : 'a sha256';
    case 'glob': {
      if (typeof v !== 'string') return 'a contract glob';
      const why = validateGlob(v);
      return why ? `a contract glob (${why})` : null;
    }
    default: return `of an unknown type ${type}`;
  }
}

/**
 * Check one record against a field map. `where` prefixes every message, and each message names the field, so a caller
 * (and a test generated from the spec) can tell which field failed. A field the map does not name is not refused: a
 * contributed extractor may add its own. Arguments are the exception (argsErrors).
 */
function fieldsErrors(fields, rec, where) {
  if (!isObject(rec)) return [`${where || 'the record'}: not an object`];
  const errors = [];
  const at = (f) => (where ? `${where}: ${f}` : f);
  for (const [f, spec] of Object.entries(fields)) {
    const v = rec[f];
    const applies = !spec.when || Object.entries(spec.when).every(([k, vals]) => vals.includes(rec[k]));
    if (v === undefined) {
      if (!spec.optional && applies) errors.push(`${at(f)} is missing`);
      continue;
    }
    if (v === null) {
      if (!spec.nullable) errors.push(`${at(f)} is null, which it may not be`);
      continue;
    }
    const bad = typeError(spec.type, v);
    if (bad) { errors.push(`${at(f)} ${JSON.stringify(v)} is not ${bad}`); continue; }
    if (spec.enum && !spec.enum.includes(v)) errors.push(`${at(f)} ${JSON.stringify(v)} is not one of ${spec.enum.join(', ')}`);
    if (spec.nonEmpty && (Array.isArray(v) ? !v.length : !Object.keys(v).length)) errors.push(`${at(f)} is empty`);
    // Nested names read as a path through the record: `calls[0], argument 2: text …`, `comparisons[0], left: kind …`.
    const inner = where ? `${where}, ` : '';
    if (spec.type === 'list' && spec.of) v.forEach((item, i) => errors.push(...itemErrors(spec.of, item, ITEM[f] ? `${inner}${ITEM[f]} ${i}` : `${inner}${f}[${i}]`)));
    if (spec.type === 'map' && spec.of) for (const [k, item] of Object.entries(v)) errors.push(...itemErrors(spec.of, item, `${inner}${f}.${k}`));
    if (spec.type === 'object' && spec.fields && Object.keys(spec.fields).length) errors.push(...fieldsErrors(spec.fields, v, `${inner}${f}`));
  }
  return errors;
}

// What one item of a list field is called in a message.
const ITEM = Object.freeze({ args: 'argument' });

function itemErrors(spec, item, where) {
  if (item === null && spec.nullable) return [];
  const bad = typeError(spec.type, item);
  if (bad) return [`${where} ${JSON.stringify(item)} is not ${bad}`];
  if (spec.enum && !spec.enum.includes(item)) return [`${where} ${JSON.stringify(item)} is not one of ${spec.enum.join(', ')}`];
  if (spec.type === 'object' && spec.fields) return fieldsErrors(spec.fields, item, where);
  return [];
}

// ------------------------------------------------------------------------------------------- the response (and rows)

/**
 * Is this extractor response one the index may store? `request` is what the extractor was given; `identity`, when
 * given, is what its --identity call said, and the response must name the same extractor and version (rule
 * response-matches-identity; G-15 of 20261020-070113-code-index-remediation-4-review).
 */
export function responseErrors(response, request, identity = null) {
  if (!isObject(response)) return ['the response is not a JSON object'];
  const errors = [];
  for (const e of fieldsErrors(RESPONSE, response, '')) {
    if (e.startsWith('code_index_schema')) errors.push(`code_index_schema is ${JSON.stringify(response.code_index_schema)}, not ${CODE_INDEX_SCHEMA}`);
    else if (e.startsWith('extractor')) errors.push(`the response does not name the extractor that produced it, by name and version: ${e}`);
    else if (e === 'files is missing' || (e.startsWith('files ') && !e.startsWith('files['))) errors.push(`the response has no files list (${e})`);
    else if (e.startsWith('facts')) errors.push(`the response has no facts object (${e})`);
    else errors.push(e);
  }
  // response-matches-identity
  if (identity && isObject(response.extractor)
    && (response.extractor.name !== identity.name || response.extractor.version !== identity.version)) {
    errors.push(rule('response-matches-identity', `the response names extractor ${JSON.stringify(response.extractor.name)} ${JSON.stringify(response.extractor.version)}, `
      + `but its identity call named ${JSON.stringify(identity.name)} ${JSON.stringify(identity.version)}`));
  }
  // files-accounted-once
  const asked = new Set(Array.isArray(request?.files) ? request.files : []);
  const seen = new Map();
  for (const f of Array.isArray(response.files) ? response.files : []) {
    if (!isObject(f)) continue;
    const p = f.path;
    if (seen.has(p)) { errors.push(rule('files-accounted-once', `${p}: listed more than once`)); continue; }
    seen.set(p, f);
    if (!asked.has(p)) errors.push(rule('files-accounted-once', `${p}: in the response but not in the request`));
  }
  for (const p of asked) if (!seen.has(p)) errors.push(rule('files-accounted-once', `${p}: requested and not accounted for`));
  // rows-in-processed-files, all-tables-present, and each row's fields
  const processed = new Set([...seen].filter(([, f]) => f.status === 'processed').map(([p]) => p));
  if (!isObject(response.facts)) return errors;
  for (const table of TABLES) if (!(table in response.facts)) errors.push(rule('all-tables-present', `the response has no ${table} table`));
  for (const [table, rows] of Object.entries(response.facts)) {
    if (!TABLES.includes(table)) { errors.push(`unknown table "${table}"`); continue; }
    if (!Array.isArray(rows)) { errors.push(`${table} is not a list`); continue; }
    rows.forEach((row, i) => errors.push(...rowErrors(table, row, `${table}[${i}]`, processed)));
  }
  return errors;
}

function rowErrors(table, row, where, processed) {
  if (!isObject(row)) return [`${where}: not an object`];
  const errors = [];
  for (const e of fieldsErrors(ROW, row, where)) errors.push(e === `${where}: span is missing` ? `${where}: no span` : e);
  if (processed && typeof row.path === 'string' && !processed.has(row.path)) errors.push(rule('rows-in-processed-files', `${where}: ${row.path} is not a processed file`));
  errors.push(...fieldsErrors(TABLE_FIELDS[table], row, where));
  // unresolved-names-no-target and resolved-names-its-target
  if (table === 'calls' || table === 'constructions') {
    const target = table === 'calls' ? 'callee' : 'type';
    const what = table === 'calls' ? 'call' : 'construction';
    if (row.resolved === false && row[target] !== null && row[target] !== undefined) {
      errors.push(rule('unresolved-names-no-target', `${where}: an unresolved ${what} names a ${target} (${JSON.stringify(row[target])}); unresolved means ${target} null`));
    }
    if (row.resolved === true && (row[target] === null || row[target] === undefined)) {
      errors.push(rule('resolved-names-its-target', `${where}: a resolved ${what} names no ${target}`));
    }
  }
  return errors;
}

// ------------------------------------------------------------------------------------------------ the envelope

/** Is this answer envelope one a reader may trust? It must say which extractors and which engine produced it (D7). */
export function envelopeErrors(envelope) {
  if (!isObject(envelope)) return ['the answer is not a JSON object'];
  const errors = [];
  for (const e of fieldsErrors(ENVELOPE, envelope, '')) {
    if (e.startsWith('detail')) errors.push(`extractor_failed with ${e}`);
    else if (e.startsWith('extractors')) errors.push(`the answer does not name the extractor identities that produced it (name, version, runtime, parser): ${e}`);
    else if (e.startsWith('framework')) errors.push(`the answer carries no framework stamp (commit and dirty): ${e}`);
    else errors.push(e);
  }
  // extractors-unless-not-configured
  if (Array.isArray(envelope.extractors) && !envelope.extractors.length && envelope.outcome !== 'not_configured') {
    errors.push(rule('extractors-unless-not-configured', 'the answer does not name the extractor identities that produced it: only not_configured may name none'));
  }
  // hash-unless-no-facts
  if (envelope.input_hash === null && !['not_configured', 'extractor_failed'].includes(envelope.outcome)) {
    errors.push(rule('hash-unless-no-facts', `a ${envelope.outcome} answer was computed from facts, and names no input_hash they were read under`));
  }
  return errors;
}

// ------------------------------------------------------------------------------------------------ the identity

/**
 * Is this --identity object complete enough to key a cache by (shared/code-index.md, "The identity call")? `reads` is
 * optional here, absent meaning []; conformance requires it (conformanceIdentityErrors).
 */
export function identityErrors(identity) {
  if (!isObject(identity)) return ['--identity printed no JSON object'];
  return fieldsErrors(IDENTITY, identity, '--identity');
}

/** conformance's stricter rule: an extractor that passes it has declared what it reads, [] included. */
export function conformanceIdentityErrors(identity) {
  const errors = identityErrors(identity);
  if (isObject(identity) && identity.reads === undefined) {
    errors.push('--identity: reads is missing; conformance requires it, [] when the extractor reads no configuration');
  }
  return errors;
}

// ------------------------------------------------------------------------------------------------ the arguments

/** Why these arguments are not a question this shape can ask, or []. */
export function argsErrors(shape, args) {
  const spec = SHAPE_ARGS[shape];
  if (!spec) return [`shape ${JSON.stringify(shape)} is not one of ${SHAPES.join(', ')}`];
  if (!isObject(args)) return ['the arguments are not a JSON object'];
  const errors = [];
  for (const k of Object.keys(args)) {
    if (!(k in spec)) errors.push(`${shape}: ${k} is not one of its arguments (${Object.keys(spec).join(', ')})`);
  }
  // A missing argument is a REQUIRED one: the message says so, as a refused question should.
  errors.push(...fieldsErrors(spec, args, shape).map((e) => e.replace(/ is missing$/, ' is required')));
  // one-of-arguments
  const oneOf = SHAPE_ONE_OF[shape];
  if (oneOf && oneOf.filter((k) => args[k] !== undefined).length !== 1) errors.push(rule('one-of-arguments', `${shape}: exactly one of ${oneOf.join(', ')} is required`));
  return errors;
}

// ------------------------------------------------------------------------------------------------ the request

/** Why this is not a request an extractor may be given, or [] (shared/code-index.md, "The request"; G-34). */
export function requestErrors(request) {
  if (!isObject(request)) return ['the request is not a JSON object'];
  return fieldsErrors(REQUEST, request, 'the request');
}

// ------------------------------------------------------------------------------------------------ the answer file

/** Why a consumer's answer file is refused, or [] (shared/code-index.md, "The answer file"). */
export function answerFileErrors(file) {
  if (!isObject(file)) return ['the answer file is not a JSON object'];
  const errors = fieldsErrors(ANSWER_FILE, file, '');
  // pinned-commit-is-hex
  if (typeof file.pinned_commit === 'string' && !/^[0-9a-f]{7,64}$/.test(file.pinned_commit)) {
    errors.push(rule('pinned-commit-is-hex', `pinned_commit ${JSON.stringify(file.pinned_commit)} is not a commit id: the answers hold at one commit, named by its hex id`));
  }
  for (const [i, s] of (Array.isArray(file.sweeps) ? file.sweeps : []).entries()) {
    if (isObject(s) && (typeof s.method !== 'string' || !s.method.trim())) {
      errors.push(`sweeps[${i}] (${s.name ?? 'unnamed'}): no method; an expected answer must say how it was derived without the index`);
    }
    // args is required (the spec's field map refuses it absent); an object is checked against its shape, whatever it
    // holds, so a sweep cannot skip its arguments by omitting them (G-20).
    if (isObject(s) && SHAPES.includes(s.shape) && isObject(s.args)) {
      for (const e of argsErrors(s.shape, s.args)) errors.push(`sweeps[${i}] (${s.name ?? 'unnamed'}): ${e}`);
    }
  }
  return errors;
}
