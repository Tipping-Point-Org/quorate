// THE COMMAND-STRING SUBSET capture's interactive front end runs (capture-interactive.plan.md stage 4; ROADMAP.md M2
// item 7: "a command string in a POSIX subset, parsed by an existing parser"). The string is parsed by the vendored
// unbash (third_party/unbash, chosen by the stage-1 bench); this module decides, from its tree, whether the string is
// inside the subset, and turns it into a plan of argv stages capture runs itself with no shell.
//
// THE SUBSET, by the handover's grammar (H#L571-L629) and the operator's decisions of 2026-10-19 and 2026-11-15:
// - one statement: a simple command, or a pipeline of them joined by `|`;
// - words of plain text, single quotes, double quotes and backslash escapes;
// - redirections `<`, `>`, `>>`, `2>`, `2>>` and `2>&1`;
// - `$( )` inside double quotes only, its body itself inside the subset (decision 4, 2026-10-19).
// Everything else is REFUSED by name, never run: `&&`, `||`, `;`, `&`, `!`, compound commands, functions, assignments,
// backticks, unquoted `$( )`, `$VAR` and `$?` ("Refuse both (Recommended)"), globs ("Refuse (Recommended)"), tilde
// expansion, `$'...'`, arithmetic, here-documents and here-strings, process substitution, `[[ ]]`, and any node this
// module does not classify, so a construct the parser starts reporting is refused until someone classifies it.
//
// Pure: no I/O. The parser is pure code; its tree is the input.
import { parse } from '../../third_party/unbash/dist/parser.js';

/** A word as capture runs it: its parts in order, each a literal string or a `$( )` whose output is substituted. */
// { parts: [ { literal: string } | { subst: Plan } ] }
/** A plan: { stages: [ { argv: Word[], redirects: [{ fd: 0|1|2, op: '<'|'>'|'>>'|'dup', target: Word | 1 }] } ] } */

const refusal = (construct, why) => ({ construct, why });

// Why each refused construct is outside, with what to do instead: the refusal explains itself (H#L609-L613).
const WHY = {
  AndOr: 'run each command as its own call; the runner returns every exit status',
  List: 'run each command as its own call',
  Background: 'run the command in the foreground; the runner has deadlines',
  Negation: 'read the returned exit status instead',
  Subshell: 'run the command directly',
  BraceGroup: 'run the command directly',
  Function: 'scripts are outside the command-line subset',
  Compound: 'scripts are outside the command-line subset',
  Assignment: 'pass the value as a literal argument',
  Backtick: 'use "$( )" inside double quotes',
  UnquotedSubst: 'write it inside double quotes: "$( )"',
  Expansion: 'pass the value as a literal argument; the exit status and log path are returned as fields',
  Glob: "list the files, or quote the pattern and let a command expand it (git ls-files '*.js')",
  Tilde: 'write the path in full',
  AnsiC: 'use single or double quotes',
  Arithmetic: 'compute the value before the call',
  HereDoc: 'pass the text as the runner\'s stdin field',
  HereString: 'pass the text as the runner\'s stdin field',
  ProcessSubst: 'run the inner command as its own call',
  Test: 'run `test` or `[` as a command, or check in the caller',
  Redirect: 'use <, >, >>, 2>, 2>> or 2>&1',
  Unclassified: 'this construct is not classified in the subset yet',
};

function word(w, refusals, { inQuotes = false } = {}) {
  if (!w || w.type !== 'Word') { refusals.push(refusal(w?.type ?? 'missing word', WHY.Unclassified)); return null; }
  // A word with no parts is plain text: unbash has already removed quoting and escapes from `value`.
  if (!w.parts) {
    if (!inQuotes && /^~/.test(w.text ?? w.value)) { refusals.push(refusal(`tilde expansion \`${w.text ?? w.value}\``, WHY.Tilde)); return null; }
    return { parts: [{ literal: w.value }] };
  }
  // A leading unquoted tilde in a word with parts (`~/"x"`): only an unquoted first part can carry one.
  const first = w.parts[0];
  if (!inQuotes && first?.type === 'Literal' && /^~/.test(first.text ?? first.value)) {
    refusals.push(refusal(`tilde expansion \`${w.text ?? ''}\``, WHY.Tilde));
    return null;
  }
  const parts = [];
  for (const p of w.parts) {
    const got = part(p, refusals, false);
    if (got) parts.push(...got);
  }
  return parts.length || !refusals.length ? { parts } : null;
}

function part(p, refusals, inDouble) {
  switch (p.type) {
    case 'Literal':
      return [{ literal: p.value }];
    case 'SingleQuoted':
      return [{ literal: p.value }];
    case 'DoubleQuoted': {
      if (inDouble) { refusals.push(refusal('nested double quotes', WHY.Unclassified)); return null; }
      const out = [];
      for (const q of p.parts ?? []) {
        const got = part(q, refusals, true);
        if (got) out.push(...got);
      }
      return out;
    }
    case 'CommandExpansion': {
      const text = String(p.text ?? '');
      if (text.startsWith('`')) { refusals.push(refusal(`backtick substitution \`${text}\``, WHY.Backtick)); return null; }
      if (!inDouble) { refusals.push(refusal(`unquoted substitution \`${text}\``, WHY.UnquotedSubst)); return null; }
      const inner = script(p.script, refusals);
      return inner ? [{ subst: inner }] : null;
    }
    case 'SimpleExpansion':
    case 'ParameterExpansion':
      refusals.push(refusal(`parameter expansion \`${p.text ?? p.parameter ?? ''}\``, WHY.Expansion));
      return null;
    case 'Glob':
      refusals.push(refusal(`glob \`${p.text ?? p.value ?? ''}\``, WHY.Glob));
      return null;
    case 'AnsiCQuoted':
      refusals.push(refusal(`ANSI-C quoting \`${p.text ?? ''}\``, WHY.AnsiC));
      return null;
    case 'ArithmeticExpansion':
      refusals.push(refusal(`arithmetic expansion \`${p.text ?? ''}\``, WHY.Arithmetic));
      return null;
    case 'ProcessSubstitution':
      refusals.push(refusal(`process substitution \`${p.text ?? ''}\``, WHY.ProcessSubst));
      return null;
    default:
      refusals.push(refusal(`${p.type} \`${p.text ?? ''}\``, WHY.Unclassified));
      return null;
  }
}

function redirect(r, refusals) {
  if (r.type === 'HereString') { refusals.push(refusal(`here-string \`${r.operator}\``, WHY.HereString)); return null; }
  if (r.type === 'HereDoc') { refusals.push(refusal('here-document `<<`', WHY.HereDoc)); return null; }
  const fd = r.descriptor?.value;
  const target = word(r.target, refusals);
  if (!target) return null;
  const literal = target.parts.length === 1 && 'literal' in target.parts[0] ? target.parts[0].literal : null;
  if (r.operator === '<' && fd === undefined) return { fd: 0, op: '<', target };
  if ((r.operator === '>' || r.operator === '>>') && (fd === undefined || fd === 1 || fd === 2)) {
    return { fd: fd ?? 1, op: r.operator, target };
  }
  if (r.operator === '>&' && fd === 2 && literal === '1') return { fd: 2, op: 'dup', target: 1 };
  refusals.push(refusal(`redirection \`${fd ?? ''}${r.operator}\``, WHY.Redirect));
  return null;
}

function command(c, refusals) {
  if (c.type !== 'Command') {
    const kind = { AndOr: 'AndOr', Subshell: 'Subshell', BraceGroup: 'BraceGroup', Function: 'Function', TestCommand: 'Test' }[c.type];
    const named = kind === 'AndOr' ? `\`${(c.operators ?? []).join(' ')}\``
      : kind ? `${c.type === 'TestCommand' ? '`[[ ]]`' : c.type.toLowerCase()}` : `compound command \`${String(c.type ?? '').toLowerCase()}\``;
    refusals.push(refusal(named, WHY[kind] ?? WHY.Compound));
    return null;
  }
  for (const a of c.prefix ?? []) refusals.push(refusal(a.type === 'Assignment' ? `assignment \`${a.name}=\`` : `${a.type}`, a.type === 'Assignment' ? WHY.Assignment : WHY.Unclassified));
  const argv = [];
  const redirects = [];
  if (c.name) {
    const name = word(c.name, refusals);
    if (name) argv.push(name);
  } else if (!(c.prefix ?? []).length) refusals.push(refusal('a command with no name', WHY.Unclassified));
  for (const s of c.suffix ?? []) {
    if (s.type === 'Word') { const w = word(s, refusals); if (w) argv.push(w); }
    else if (s.type === 'Redirect' || s.type === 'HereString' || s.type === 'HereDoc') { const r = redirect(s, refusals); if (r) redirects.push(r); }
    else refusals.push(refusal(`${s.type}`, WHY.Unclassified));
  }
  return { argv, redirects };
}

function script(s, refusals) {
  const statements = s?.commands ?? [];
  if (statements.length !== 1) {
    refusals.push(refusal(statements.length ? '`;` or a newline between commands' : 'an empty command', WHY.List));
    return null;
  }
  const st = statements[0];
  if (st.background) refusals.push(refusal('`&`', WHY.Background));
  const c = st.command;
  if (c?.type === 'Pipeline') {
    if ((c.prefixes ?? []).length) refusals.push(refusal('`!`', WHY.Negation));
    if ((c.operators ?? []).some((o) => o !== '|')) refusals.push(refusal(`\`${c.operators.find((o) => o !== '|')}\``, WHY.Redirect));
    const stages = (c.commands ?? []).map((x) => command(x, refusals));
    return refusals.length ? null : { stages };
  }
  const one = command(c ?? {}, refusals);
  return refusals.length || !one ? null : { stages: [one] };
}

/**
 * Parse a command string and classify it. `{ ok: true, plan }` for a string inside the subset; `{ ok: false, refusals }`
 * naming every construct outside it, each with what to do instead; a string the parser itself rejects is refused with the
 * parser's message.
 */
export function classifyCommand(source) {
  const text = String(source ?? '');
  let tree;
  try { tree = parse(text); } catch (e) { return { ok: false, refusals: [refusal('a string the parser rejects', String(e?.message ?? e))] }; }
  const refusals = [];
  // A TREE THE PARSER RECOVERED IS NEVER RUN. unbash recovers from a syntax error and lists it in `errors` (an unterminated
  // quote still yields words, measured 2026-11-15), so the recovered words are a guess at what was meant: every reported
  // error refuses the string, with its position.
  for (const e of tree?.errors ?? []) refusals.push(refusal(`a syntax error at character ${e.pos}`, String(e.message ?? 'reported by the parser')));
  if (refusals.length) return { ok: false, refusals };
  const plan = script(tree, refusals);
  return refusals.length || !plan ? { ok: false, refusals } : { ok: true, plan };
}

/** Every refusal reason, by key, so a test can hold that each construct is refused with its own words. */
export const REFUSAL_REASONS = Object.freeze({ ...WHY });
