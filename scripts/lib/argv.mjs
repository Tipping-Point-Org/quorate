// A FLAG'S VALUE, ONE RULE FOR EVERY ENTRYPOINT (G-7 of 20261020-122714-ciss-remediation-4b-review; entrypoint-argv.plan.md).
//
// new-run and run-graph each parsed value-taking flags their own way, and only one of them refused a missing value: a
// trailing `--only` in run-graph became an empty selection and deselected every lens. 23 scripts read a value as
// `a[++i]`, and 9 let an unknown flag pass. parseArgv is the one parser: Node's own util.parseArgs in strict mode
// (operator, 2026-10-20: "util.parseArgs + thin wrapper (Recommended)"), plus the two shapes it does not have.
import { parseArgs } from 'node:util';

/** A refusal of the command line, naming the flag. The caller turns it into its own die(). */
export class ArgvError extends Error {}

/**
 * Parse `argv` (process.argv.slice(2)) against `spec`:
 *   options: { name: 'string' | 'repeat' | 'boolean' | 'list' }
 *   positionals: true   bare arguments are allowed (otherwise refused); a number n allows at most n of them
 *   passthrough: true   everything after the first `--` is returned untouched as `rest`
 *
 * - `string`: one value, given once. A missing value, a flag in its place, or a second `--name` is refused.
 * - `repeat`: one value per use, given any number of times; an array (`--mark-fixed a --mark-fixed b`).
 * - `boolean`: no value.
 * - `list`: the values after the flag up to the next `-`-led token, one or more (`--full-sweep a b c`; plan D3). None is
 *   refused. A value starting with `-` is written `--full-sweep=-x`, one per use, as for `string`.
 * Returns { values, positionals, rest }. Unknown flags are refused. Pure: no I/O, no process.
 */
export function parseArgv(argv, spec = {}) {
  const options = spec.options ?? {};
  for (const [name, type] of Object.entries(options)) {
    if (!['string', 'repeat', 'boolean', 'list'].includes(type)) throw new Error(`parseArgv: --${name} has an unknown type ${type}`);
  }
  let head = [...argv];
  let rest = [];
  if (spec.passthrough) {
    const at = head.indexOf('--');
    if (at >= 0) { rest = head.slice(at + 1); head = head.slice(0, at); }
  }
  // THE LIST FLAGS FIRST: util.parseArgs takes one value per use, and `--full-sweep a b c` is the documented spelling.
  const lists = {};
  const remaining = [];
  for (let i = 0; i < head.length; i++) {
    const tok = head[i];
    const eq = tok.startsWith('--') ? tok.indexOf('=') : -1;
    const name = tok.startsWith('--') ? tok.slice(2, eq >= 0 ? eq : undefined) : null;
    if (name !== null && options[name] === 'list') {
      const got = lists[name] ?? (lists[name] = []);
      if (eq >= 0) { const v = tok.slice(eq + 1); if (!v) throw new ArgvError(`--${name} needs at least one value`); got.push(v); continue; }
      let n = 0;
      // Stops at any '-'-led token, not only '--': a value starting with '-' takes the = form, as util.parseArgs holds
      // a string flag to (G-8 of 20261020-151402-argv-delivery). A lone '-' is a value there too, so it is here.
      while (i + 1 < head.length && !isOptionLike(head[i + 1])) { got.push(head[++i]); n++; }
      if (!n) throw new ArgvError(`--${name} needs at least one value`);
      continue;
    }
    remaining.push(tok);
  }
  const parseOptions = {};
  for (const [name, type] of Object.entries(options)) {
    if (type === 'list') continue;
    parseOptions[name] = { type: type === 'boolean' ? 'boolean' : 'string', ...(type === 'repeat' ? { multiple: true } : {}) };
  }
  let parsed;
  try {
    parsed = parseArgs({ args: remaining, options: parseOptions, strict: true, allowPositionals: Boolean(spec.positionals), tokens: true });
  } catch (e) {
    throw new ArgvError(refusalOf(e));
  }
  // A `string` flag given twice was silently its last value; it is refused, so two different values never reduce to one.
  const seen = {};
  for (const t of parsed.tokens) {
    if (t.kind !== 'option' || options[t.name] !== 'string') continue;
    if (seen[t.name]) throw new ArgvError(`--${t.name} is given more than once`);
    seen[t.name] = true;
  }
  // A COUNT IS A CEILING (G-7 of 20261111-224124-runtime-bin-d1-review): `positionals: <n>` admits at most n bare
  // arguments, and the rest are refused by name, as an unknown flag is; a script that read the first was silent on them.
  if (typeof spec.positionals === 'number' && parsed.positionals.length > spec.positionals) {
    const extra = parsed.positionals.slice(spec.positionals);
    throw new ArgvError(`unexpected argument${extra.length > 1 ? 's' : ''} ${extra.map((a) => `'${a}'`).join(', ')}: this command takes ${spec.positionals}`);
  }
  return { values: { ...parsed.values, ...lists }, positionals: parsed.positionals, rest };
}

const isOptionLike = (tok) => tok.startsWith('-') && tok !== '-';

// util.parseArgs's messages, as one line naming the flag.
function refusalOf(e) {
  const m = String(e?.message ?? e);
  const flag = m.match(/'(-{1,2}[^' <]+)/)?.[1] ?? null;
  if (e?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return `unknown flag ${flag ?? m}`;
  if (e?.code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') return `unexpected argument ${m.match(/'([^']+)'/)?.[1] ?? m}`;
  if (e?.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    if (/argument missing|ambiguous/.test(m)) return `${flag ?? 'a flag'} needs a value`;
    return `${flag ?? 'a flag'}: ${m.split('\n')[0]}`;
  }
  return m.split('\n')[0];
}
