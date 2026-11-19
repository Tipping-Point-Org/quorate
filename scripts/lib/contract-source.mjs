// Which file carries this project's graph_contract?
import { CONTRACT_BLOCK_RE } from './contract-version.mjs';
//
// Originally there was one answer — the repo's CLAUDE.md — and the block was copied into it by
// hand at install time. That made the contract unmanageable: `check-install` could compare hook
// shims against what the installer would write, but it could never fix a contract, because the
// file holding it is the consumer's own project instructions and is not ours to rewrite. So a key
// whose MEANING changed underneath a project (`budget_usd_per_node: ""` once meant a $0 cap that
// blocked every node, and now means uncapped) had no upgrade path and no signal.
//
// `.claude/rules/quorate-contract.md` is a file quorate may own. It is auto-loaded as memory the
// same way CLAUDE.md is — the token cost is identical, and that is NOT the reason for the move —
// but it can be diffed against a template, updated in place, and reported on.
//
// CLAUDE.md remains supported and is not deprecated here. Existing installs keep working, and a
// project that prefers one file for everything is making a defensible choice.

/** In preference order. The first that carries a contract wins. */
export const CONTRACT_CANDIDATES = ['.claude/rules/quorate-contract.md', 'CLAUDE.md'];

/**
 * THE EXIT CODE OF `new-run --print-contract` WHEN NO CONTRACT EXISTS (ledger-findings.plan.md stage 4; design D4). Any
 * other non-zero exit is an error: an unreadable or conflicting contract, or a framework copy that cannot start.
 */
export const NO_CONTRACT_EXIT = 4;

/**
 * WHAT A `new-run --print-contract` RESULT MEANS, the one classifier every reader uses: `{ contract }`, `{ absent }`
 * or `{ error }`, each with the child's own words where it said any. Decided by the exit code and the parse, never by
 * the message text.
 */
export function classifyPrintContract({ status, stdout = '', stderr = '', error = null } = {}) {
  const words = String(stderr || stdout || '').trim().split(/\r?\n/).slice(0, 4).join('\n');
  if (status === 0) {
    try { return { contract: JSON.parse(String(stdout)) }; } catch (e) { return { error: `the printed contract did not parse (${e.message})` }; }
  }
  if (status === NO_CONTRACT_EXIT) return { absent: true, message: words };
  return { error: `new-run --print-contract exited ${status ?? 'without a status'}${error ? ` (${error.message})` : ''}`, message: words };
}

/**
 * Every fenced yaml block in the document that actually DECLARES a contract.
 *
 * The original parser took the first ```yaml fence in the file and assumed it was the contract.
 * That is positional, not semantic: a project that puts any other yaml block above its contract —
 * a CI snippet, a config example, a front-matter sample — silently hands the parser the wrong text.
 * The failure is quiet and total, because the wrong block usually parses fine and simply describes
 * nothing the engine was looking for.
 *
 * Identifying the block by its `graph_contract:` key instead means position stops mattering. The
 * contract can sit anywhere in the file, with anything above it.
 */
export function contractBlocks(text) {
  const out = [];
  const re = /```ya?ml\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(String(text ?? ''))) !== null) {
    // Top-level key only. An indented `graph_contract:` is a value inside some other structure, and
    // treating it as a declaration would reintroduce the guessing this function removes.
    // EITHER SPELLING. The key was renamed to `graph_contract_version`, and this regex is what
    // FINDS the block at all -- a file carrying only the new name would have been invisible here,
    // reported as 'no contract in this repository' rather than as a renamed one.
    if (CONTRACT_BLOCK_RE.test(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Compare contracts by what they DECLARE, not by their bytes.
 *
 * Two blocks differing only in comments or blank lines are the same contract, and refusing them as
 * a disagreement blocks the very migration this file exists to enable: an operator copying the
 * block to `.claude/rules/` and annotating the copy — the most natural thing to do while moving it
 * — got every run refused with "two graph_contract blocks disagree" (G-21).
 *
 * Deliberately NOT a yaml parse. new-run.mjs is the one parser in this repository, and a second one
 * here is exactly how two components come to disagree about the same file — the defect this module
 * exists to prevent. Anything a comment strip cannot reconcile stays a conflict, which fails closed.
 */
/**
 * Drop a yaml comment, but only a REAL one: a `#` preceded by whitespace and OUTSIDE quotes.
 *
 * The first version cut at any `\s+#`, which swallowed the difference between
 * `test: "node t.mjs --tag #1"` and `--tag #2` — two different commands comparing equal, so a real
 * disagreement would have been accepted as a duplicate. Caught by the test written for the fix,
 * which is the only reason it is not in this file.
 */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

const norm = (s) => String(s ?? '')
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((l) => stripComment(l).replace(/\s+$/, ''))
  .filter((l) => l.length)
  .join('\n')
  .trim();

/**
 * @param {{path: string, text: string|null}[]} entries  candidates in preference order; `text` is
 *        null for a file that does not exist.
 * @returns {{ok: true, path, text, yaml, duplicates: string[]} | {ok: false, why: string}}
 */
export function chooseContractSource(entries) {
  const carrying = [];
  for (const e of entries ?? []) {
    if (e?.text == null) continue;
    const blocks = contractBlocks(e.text);
    if (!blocks.length) continue;  // a file declaring no contract is simply not a contract source
    // TWO CONTRACTS IN ONE FILE is refused for the same reason two files are: there is no honest
    // way to rank them. Taking the first would be the positional guess this function exists to
    // remove, one level down.
    if (blocks.length > 1) {
      return {
        ok: false,
        why: `${e.path} declares ${blocks.length} graph_contract blocks — delete all but one.`,
      };
    }
    carrying.push({ path: e.path, text: e.text, yaml: blocks[0] });
  }

  if (!carrying.length) {
    return {
      ok: false,
      // ABSENT, said by a field, not only by the words (ledger-findings.plan.md stage 4): `new-run --print-contract` exits
      // NO_CONTRACT_EXIT on it, so no caller matches this message's text to tell "no contract" from "cannot read one".
      absent: true,
      why: `no graph_contract found — looked for a fenced yaml block declaring \`graph_contract:\` in: ${(entries ?? []).map((e) => e.path).join(', ')}`,
    };
  }

  const [chosen, ...rest] = carrying;
  const conflicting = rest.filter((r) => norm(r.yaml) !== norm(chosen.yaml));

  // AMBIGUITY IS REFUSED, NOT RANKED. Two contracts that disagree is a migration left half-done,
  // and picking the preferred one would run the project against a contract it may have stopped
  // maintaining — silently, since both files look authoritative. This is the same rule the request
  // resolver already follows for two approved requests: name them and stop.
  //
  // Two contracts that AGREE are not ambiguous. That is what a completed copy looks like before the
  // old one is deleted, and refusing there would block the very migration this file enables.
  if (conflicting.length) {
    return {
      ok: false,
      why:
        `two graph_contract blocks disagree:\n` +
        [chosen, ...conflicting].map((c) => `      ${c.path}`).join('\n') +
        `\n      Delete or reconcile one. Keeping both means every run silently picks ${chosen.path}\n` +
        `      while the other looks equally authoritative.`,
    };
  }

  return {
    ok: true,
    path: chosen.path,
    text: chosen.text,
    yaml: chosen.yaml,
    duplicates: rest.map((r) => r.path),   // identical copies; safe, but worth reporting once
  };
}
