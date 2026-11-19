// rule-text.mjs — one owner for each rule restated across documents (code-index-d1-part-a.plan.md stage 4; design note
// A-D4′, operator 2026-10-21: marked regions written by one command).
//
// The degraded-cap rule had dozens of statements and no owner: the document CLAUDE.md names as the owner of key meanings
// said a degraded arch-review is always RISK while the code lets a §6 invariant lift it, and each review round fixed one
// copy (G-17 of 20261021-202611-ciss-d1-remediation-4-review). Prose documents are read as written, with no assembly
// step, so the sentence reaches them as a MARKED REGION that scripts/gen-rule-text.mjs writes and --check compares:
//
//   <!-- rule:<id> slot="value" … -->rendered text<!-- /rule:<id> -->          (Markdown, inline or on its own lines)
//   // rule:<id> slot="value" …   …   // /rule:<id>                           (JavaScript, its own lines)
//   # rule:<id> slot="value" …   …   # /rule:<id>                             (Python, its own lines)
//
// The comment syntax per file type is here so part B's scope-construct constants, generated into each extractor
// (B-D4), are one more rule rather than a second generator. Pure (ARCHITECTURE §2): text in, text out.

import { renderTemplate, readTemplate, slotsIn } from './template.mjs';
import { MINUTES, minText } from './check-timeout.mjs';
// The three columns an extractor reads, by their table headings (code-index-d1-part-b.plan.md stage 2), from their owner.
import { SCOPE_COLUMNS } from './scope-constructs.mjs';
// The reserved decisions' bullets (autonomous-run.plan.md stage 5), from the set decide.mjs refuses.
import { renderReservedRules } from './decision-panel.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The comment syntax of a file, by extension; null for a file type no rule may live in. */
export function syntaxFor(file) {
  if (/\.md$/i.test(file)) return { open: '<!-- ', close: ' -->', inline: true };
  if (/\.(m?js)$/i.test(file)) return { open: '// ', close: '', inline: false };
  if (/\.py$/i.test(file)) return { open: '# ', close: '', inline: false };
  return null;
}

const SLOT_ARG = /([a-z_]+)="([^"]*)"/g;
const argsOf = (s) => Object.fromEntries([...String(s ?? '').matchAll(SLOT_ARG)].map((m) => [m[1], m[2]]));

/**
 * Every region in `text`: { id, args, start, end, body, inline } where start/end bound the body. A region opened and
 * never closed is an error naming its id, because a missing close marker would let the next run eat the file.
 */
export function regionsIn(text, file) {
  const syn = syntaxFor(file);
  if (!syn) return [];
  // In code a marker is a whole comment line, so a marker quoted inside a string (a test's fixture) is not a region and
  // is never rewritten. Markdown allows an inline region, inside a table cell or a sentence.
  const lead = syn.inline ? '' : '^[ \\t]*';
  const open = new RegExp(`${lead}${esc(syn.open)}rule:([a-z0-9-]+)((?: [a-z_]+="[^"]*")*)${esc(syn.close)}`, syn.inline ? 'g' : 'gm');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const out = [];
  for (const m of text.matchAll(open)) {
    const id = m[1];
    let start = m.index + m[0].length;
    const block = text[start] === '\n' || text[start] === '\r';
    if (!syn.inline && !block) continue;
    const closeMarker = `${syn.open}/rule:${id}${syn.close}`;
    const close = new RegExp(`${lead}${esc(closeMarker)}`, 'gm');
    close.lastIndex = start;
    const c = close.exec(text);
    if (!c) throw new Error(`${file}: rule:${id} is opened and never closed (${closeMarker})`);
    let end = c.index;
    // A region whose markers sit on their own lines holds whole lines: the body excludes the line break after the open
    // marker and the indentation before the close marker, and is written with the file's own line ending.
    if (block) {
      start = text.indexOf('\n', start) + 1;
      end = text.lastIndexOf('\n', end - 1) + 1;
    }
    out.push({ id, args: argsOf(m[2]), start, end, body: text.slice(start, end), inline: !block, eol });
  }
  return out;
}

/** The rules a region may name. `render(args, template)` returns the region's body; `template` names the file it reads. */
export const RULES = Object.freeze({
  'degraded-cap': {
    template: 'rule-degraded-cap.md',
    render: (args, tpl) => renderTemplate(tpl, args, 'rule:degraded-cap').trim(),
    // Phrases that restate this rule. A line carrying one outside a region, without the exception, is a restatement
    // that will drift (the test over the real tree reads these).
    // A LENS's cap only: a gate's, an arm's and a project lens's caps are different rules (an arm or a project lens
    // cannot cite `invariant`; a gate ceiling is consulted after FAIL), classified in the design note's census.
    restates: [/cannot `?FAIL`?/, /degrades? to convention-only/i, /every finding enters reconciliation as/i,
      /(conformance|contract-audit)[^.|]*capped at `?RISK`?/i, /caps? (the )?(conformance|contract-audit)[^.|]* at `?RISK`?/i,
      /(UNBENCHED|perf)[^.|]*caps?[^.|]* at `?RISK`?/i, /(is|as) always `?RISK`?/i, /can never block/i],
    // A line pointing at the owner is a pointer, not a restatement (operator, 2026-11-05: "Pointers, all 6", G-2 of
    // 20261105-173030-crsf-d1-remediation-review: the copies outside disk-first-protocol.md became pointers).
    exception: /§6|invariant|disk-first-protocol\.md`? §7/i,
    // A line that matches a phrase but is not this rule: the file, a substring of the line, and why. An entry that
    // matches no line fails the real-tree test, so the list cannot outlive what it excuses.
    allowed: [
      ['CLAUDE.md', 'arch-review degrades to convention-only". So the framework', 'quotes the contract comment it replaced, as history'],
      ['shared/claude-md-contract.md', '| verdict ceiling | `RISK` — it cannot `FAIL` a gate |', 'a project-declared lens: its basis is convention only, so no §6 exception applies'],
      ['shared/claude-md-contract.md', '| `required` | always false — its absence can never block |', 'a project-declared lens: about its absence, not a cap'],
    ],
  },
  // The no-red evidence rule (evidence-rules-text-owner.plan.md stage 2; T-D1 A): copies of it drifted, and stage 4 of
  // remediation-evidence-rules missed two (G-1, G-11, G-14 of 20261023-081135-rer-remediation-3-review). Model-facing
  // text carries it as a region (prompts/remediation/PROMPT.md, and shared/remediation.md, which owns the rules) or as
  // a {{rule_no_red}} slot in a JSON table, filled at load (ruleTable below); other documents point at
  // shared/remediation.md.
  'no-red': {
    template: 'rule-no-red.md',
    render: (args, tpl) => renderTemplate(tpl, args, 'rule:no-red').trim(),
    // Phrases only a statement of the rule uses; a kind's description (`declared-no-red`, `refused-cluster`) names the
    // fact, and stays where the schema's names are documented (design T-D1 A).
    restates: [/an empty red with no/i, /race between two reads/i, /admit(s|ted)( it)? in any cluster/i],
    // A line that points at the owner is a pointer, not a restatement.
    exception: /shared\/remediation\.md/,
    allowed: [],
  },
  // Each reference extractor's constant of the constructs it models, from shared/code-index.md's table for its language,
  // the one hand-kept copy (code-index-d1-part-b.plan.md stage 2; B-D4, operator 2026-10-21: "B, try to mitigate the
  // cons. two copies usually drift").
  'scope-constructs': {
    template: null,
    source: 'shared/code-index.md',
    render: (args, _tpl, sources) => renderScopeConstructs(args, sources),
  },
  'reserved-decisions': {
    template: null,
    render: () => renderReservedRules(),
  },
  'minutes-table': {
    template: null,
    render: () => [
      '| Key | Absent | Empty (`""`) | Whole minutes only | Minimum | Maximum |',
      '|---|---|---|---|---|---|',
      ...Object.entries(MINUTES).map(([k, s]) => `| \`${k}\` | ${s.absent} | ${s.empty} | `
        + `${s.whole ? 'yes' : 'no'} | ${minText(s)} | ${s.max} |`),
    ].join('\n'),
  },
});

/**
 * The rows of a hand-kept source table in a document: the Markdown table between `<!-- table:<id> language="<l>" -->`
 * and `<!-- /table:<id> -->`. A cell's backticks are dropped; `yes`/`no` become booleans. Throws when the table is absent,
 * so a rule never renders from nothing.
 */
export function sourceTable(text, id, language, where = 'the source document') {
  const open = `<!-- table:${id} language="${language}" -->`;
  const at = text.indexOf(open);
  const end = at < 0 ? -1 : text.indexOf(`<!-- /table:${id} -->`, at);
  if (at < 0 || end < 0) throw new Error(`${where} has no table:${id} for language ${JSON.stringify(language)}`);
  const lines = text.slice(at + open.length, end).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const cells = (l) => l.slice(1, -1).split('|').map((c) => c.trim().replace(/^`|`$/g, ''));
  const head = cells(lines[0]);
  return lines.slice(2).map((l) => Object.fromEntries(cells(l).map((c, i) => [head[i], c === 'yes' ? true : c === 'no' ? false : c])));
}


function renderScopeConstructs(args, sources) {
  const rows = sourceTable(sources['shared/code-index.md'] ?? '', 'scope-constructs', args.language, 'shared/code-index.md');
  // `syntax` is the language the constant is written in (the engine's own copy is JavaScript for both tables), and `name`
  // its identifier; both default to the extractor's own.
  const syntax = args.syntax ?? args.language;
  const name = args.name ?? 'SCOPE_CONSTRUCTS';
  if (syntax === 'javascript' && name !== 'SCOPE_CONSTRUCTS') {
    return [`const ${name} = Object.freeze({`,
      ...rows.map((r) => `  ${r.Construct}: Object.freeze({ ${SCOPE_COLUMNS.map(([k, h]) => `${k}: ${r[h]}`).join(', ')} }),`),
      '});'].join('\n');
  }
  if (syntax === 'python') {
    const py = (b) => (b ? 'True' : 'False');
    return ['SCOPE_CONSTRUCTS = {',
      ...rows.map((r) => `    "${r.Construct}": {${SCOPE_COLUMNS.map(([k, h]) => `"${k}": ${py(r[h])}`).join(', ')}},`),
      '}'].join('\n');
  }
  if (args.language === 'javascript') {
    return ['const SCOPE_CONSTRUCTS = Object.freeze({',
      ...rows.map((r) => `  ${r.Construct}: Object.freeze({ ${SCOPE_COLUMNS.map(([k, h]) => `${k}: ${r[h]}`).join(', ')} }),`),
      '});'].join('\n');
  }
  throw new Error(`rule:scope-constructs has no rendering for language ${JSON.stringify(args.language)}`);
}

/** The body a region should hold; block regions end with a newline so the close marker keeps its own line. */
export function expectedBody(region, templates) {
  const rule = RULES[region.id];
  if (!rule) throw new Error(`no rule is registered as ${region.id} (lib/rule-text.mjs RULES)`);
  // `templates` also carries each rule's source document, keyed by its path (a source table's rule reads it).
  const text = rule.render(region.args, rule.template ? templates[rule.template] : null, templates);
  const eol = region.eol ?? '\n';
  return region.inline ? text : `${text.split('\n').join(eol)}${eol}`;
}

/** `text` with every region rewritten, and the regions that differed. */
export function regenerate(text, file, templates) {
  const regions = regionsIn(text, file);
  const stale = [];
  let out = '';
  let at = 0;
  for (const r of regions) {
    const want = expectedBody(r, templates);
    if (r.body !== want) stale.push({ id: r.id, line: text.slice(0, r.start).split('\n').length });
    out += text.slice(at, r.start) + want;
    at = r.end;
  }
  return { text: out + text.slice(at), stale };
}

/** Lines of `text` that restate a rule outside any region and without its exception. */
export function restatementsIn(text, file) {
  // This file holds the phrase list and its allow-list, which quote every phrase on purpose.
  if (file === 'scripts/lib/rule-text.mjs') return [];
  // A rule's own template is its one statement, not a restatement of it.
  if (Object.values(RULES).some((r) => r.template && file === `prompts/_templates/${r.template}`)) return [];
  const regions = regionsIn(text, file);
  const inRegion = (offset) => regions.some((r) => offset >= r.start && offset <= r.end);
  const found = [];
  let offset = 0;
  text.split('\n').forEach((line, i) => {
    for (const [id, rule] of Object.entries(RULES)) {
      if (!rule.restates || rule.exception.test(line)) continue;
      if ((rule.allowed ?? []).some(([af, sub]) => af === file && line.includes(sub))) continue;
      // Where the phrase sits, not where the line starts: an inline region shares its line with prose.
      const hit = rule.restates.map((p) => line.match(p)).find((m) => m && !inRegion(offset + m.index));
      if (hit) found.push({ id, line: i + 1, text: line.trim() });
    }
    offset += line.length + 1;
  });
  return found;
}

/**
 * A JSON template table with its rule slots filled (evidence-rules-text-owner.plan.md stage 2). JSON has no comments, so
 * a table a model reads (stamp-consequences.json, schema-fields.json) cannot carry a region; an entry that states a
 * registered rule carries `{{rule_<id>}}` (`-` written `_`) instead, filled here from the rule's template, so every
 * reader of the table gets the rule's one text. A slot naming no rule, or one left unfilled, throws: an entry that
 * reached a model as `{{rule_no_red}}` would state nothing.
 */
export function ruleTable(name, io) {
  const table = JSON.parse(readTemplate(name, io));
  // Filled by lib/template.mjs's renderer, the one substitution grammar, so a slot outside `rule_*` throws there rather
  // than reaching a model unfilled (G-11 of 20261023-205906-ger-delivery). Only rule slots are given values.
  const fill = (text) => renderTemplate(text, Object.fromEntries(slotsIn(text).filter((s) => s.startsWith('rule_')).map((s) => {
    const key = s.slice('rule_'.length);
    const rule = RULES[key.replace(/_/g, '-')];
    if (!rule?.template) throw new Error(`${name}: {{rule_${key}}} names no rule with a template (lib/rule-text.mjs RULES)`);
    return [s, rule.render({}, readTemplate(rule.template, io))];
  })), name);
  return Object.fromEntries(Object.entries(table).map(([k, v]) => [k, typeof v === 'string' ? fill(v) : v]));
}
