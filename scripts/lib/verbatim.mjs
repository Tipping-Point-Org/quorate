// verbatim.mjs — does this quotation actually appear in that text?
//
// One rule, two callers. `check-quotes.mjs` holds the build log's quotations to the raw session
// digests; `second-opinion-scoring.mjs` holds a JUDGE's citation to the report it claims to be
// quoting. Both are the same question and both are load-bearing in the same way: a quotation
// nobody checked is an assertion wearing a citation's clothes.
//
// It lived inline in check-quotes.mjs, where it was neither importable nor tested. The second
// caller is what turned that into a defect worth fixing rather than a tidiness argument — a
// re-spelled copy of a matching rule is how two checks come to disagree about what "verbatim"
// means, and this repository has already paid for that shape twice (EXECUTABLE_COMMAND_KEYS, the
// intent canary's two line windows).

/**
 * Whitespace-, case- and EMPHASIS-insensitive, because a copied quote keeps the words and not the
 * spacing — nor the markdown.
 *
 * The emphasis half was measured, not anticipated. On the drop/opus-low pass, seed
 * `numeric-bundle-pager`, the audit caught the injected error and said so at length, the judge
 * voted `identified` and quoted the sentence that says it, and the scorer returned `unverified`.
 * The entire difference was two asterisks:
 *
 *     report : - **G-2: I dispute the drop.** It should be Confirmed at BLOCKER, with G-7 ...
 *     judge  :   G-2: I dispute the drop. It should be Confirmed at BLOCKER, with G-7 ...
 *
 * Stripping formatting is what every quoter does — a model, a person, a clipboard. Leaving it in
 * meant the check was asking "did you reproduce my markdown", which is not the question. It cost a
 * correct catch its verdict and turned a gate that should have read ADMITTED into UNDECIDED.
 *
 * THIS IS A LOOSENING, and it is the safe direction because emphasis markers are presentation
 * rather than words. Every protection worth having is untouched: fragments must still appear, in
 * order, each longer than `minFragment`, so two unrelated sentences cannot be stitched into a
 * quotation nobody wrote. What changed is that the comparison is prose against prose.
 *
 * `check-quotes.mjs` shares this rule and is only made more permissive by it — a build-log
 * quotation that verified before still verifies, and one that differs from the digest by italics no
 * longer fails for the wrong reason.
 */
/**
 * DELIMITER, NOT IDENTIFIER (G-33, panel-codex-code). The first version stripped these characters
 * everywhere, so a FABRICATED `maxbudget` verified against a real `max_budget` — and refusing a
 * quotation the source does not contain is this module's entire job. My own comment on that change
 * called the collision possible and waved it off; an underscore joining two word characters is part
 * of an identifier, not punctuation around one.
 *
 * So a run of these characters is dropped only where it FLANKS a word — `**bold**`, `_italic_`,
 * `` `code` `` — and kept where it JOINS one. Erring toward keeping is the safe direction: a kept
 * character can only make the check stricter, and strictness is the point.
 */
const stripEmphasis = (t) => {
  // PAIRED, OR IT IS PART OF THE TOKEN (G-21, panel-codex-code). The previous rule kept a run only
  // when alphanumerics sat on BOTH sides, so `_private` normalised to `private` and `value_` to
  // `value` — and a citation with the marker dropped verified against a source that has it.
  //
  // Position cannot settle this on its own: a leading `_` looks exactly like an emphasis opener,
  // because that is what an opener looks like. What separates them is whether something CLOSES it.
  // So a run is removed only when a matching run of the same character exists on the other side of
  // some text — `_italic_`, `**bold**`, `` `code` `` — and kept otherwise.
  //
  // Ambiguous cases keep their markers. `__dunder__` reads as emphasis and as an identifier, and
  // keeping can only make this check STRICTER, which is the direction a verbatim test should err in.
  const runs = [];
  const re = /[*_`]+/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const at = m.index;
    const run = m[0];
    const before = t[at - 1] ?? '';
    const after = t[at + run.length] ?? '';
    const word = (c) => /[A-Za-z0-9]/.test(c);
    runs.push({
      at,
      run,
      ch: run[0],
      // Flanked by word characters on both sides: an identifier's interior, never a delimiter.
      joins: word(before) && word(after),
      // CommonMark's flanking rule, and the reason it is WHITESPACE rather than word characters:
      // `**I dispute.**` closes after a full stop, so a word-character test rejected the commonest
      // real citation in this corpus.
      opens: after !== '' && !/\s/.test(after),
      closes: before !== '' && !/\s/.test(before),
      // A DOUBLED UNDERSCORE IS READ AS AN IDENTIFIER, NOT AS BOLD. `__init__` and `__dunder__` are
      // the overwhelming use of `__` in the material this checks, while bold is spelled `**` almost
      // universally — so the ambiguity resolves toward keeping, which can only make a verbatim test
      // stricter. A judgement, stated rather than left in the flanking arithmetic.
      dunder: run[0] === '_' && run.length > 1,
    });
  }
  const strip = new Set();
  // The runs that can close, per character, in order, each read past once (G-18 of 20261121-233915-m3s7-b2-review): a
  // search of the whole list for every opener was O(R^2) on R runs that never close. The head of a character's queue,
  // once past every index at or before the opener and every run already stripped, is the first later run that can
  // close it, the same run the search found.
  const closers = new Map();
  runs.forEach((b, k) => {
    if (b.joins || b.dunder || !b.closes) return;
    if (!closers.has(b.ch)) closers.set(b.ch, { at: 0, list: [] });
    closers.get(b.ch).list.push(k);
  });
  for (let i = 0; i < runs.length; i += 1) {
    const a = runs[i];
    if (a.joins || a.dunder || !a.opens || strip.has(i)) continue;
    const q = closers.get(a.ch);
    if (!q) continue;
    while (q.at < q.list.length && (q.list[q.at] <= i || strip.has(q.list[q.at]))) q.at += 1;
    if (q.at < q.list.length) { strip.add(i); strip.add(q.list[q.at]); q.at += 1; }
  }
  let out = '';
  let cursor = 0;
  runs.forEach((r, i) => {
    if (!strip.has(i)) return;
    out += t.slice(cursor, r.at);
    cursor = r.at + r.run.length;
  });
  return out + t.slice(cursor);
};

export const flat = (t) => stripEmphasis(String(t ?? ''))
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/**
 * Is `quote` present in `haystack`, allowing `…` to elide material from the middle?
 *
 * AN ELISION IS NOT A LICENCE. Each fragment must appear AND they must appear in order —
 * otherwise two unrelated sentences could be stitched into one quotation nobody ever wrote.
 *
 * Returns `{ ok, fragments, missing }`: `missing` is the first fragment that was not found, which
 * is the only part of a failure worth printing.
 *
 * ONE DELIBERATE TIGHTENING over the inline version this replaces: a quotation with nothing left
 * after fragmenting — shorter than `minFragment` — used to PASS, because the loop that checked the
 * fragments simply never ran. It now fails. A quotation too short to locate has not been verified,
 * and the caller that made this matter is the new one: a judge answering with a two-word citation
 * would otherwise have been believed without a check. No quotation in blog/build-log.html is
 * affected — all 16 fragment normally, measured before the change.
 */
export function quotePresent({ haystack, quote, minFragment = 3 }) {
  const hay = flat(haystack);
  const fragments = String(quote ?? '').split('…').map(flat);
  // A SHORT FRAGMENT FAILS THE QUOTE; IT DOES NOT VANISH FROM IT (G-22, panel-codex-contract).
  // These were filtered out, so `allowed … not` verified because `allowed` is present and `not` —
  // three characters — was silently discarded. That does not weaken the citation, it REVERSES it,
  // which is worse than a fragment that merely cannot be found.
  //
  // The rule was already written down one paragraph up and applied to the wrong scope: "a quotation
  // too short to locate has not been verified" was enforced for the whole quote and never for the
  // fragments it splits into. Same rule, now at the level the splitting created.
  // AN EMPTY FRAGMENT IS NOT A CLAIM. A leading or trailing `…` — "the quotation continues" — splits
  // to `''`, which asserts nothing and cannot be located because there is nothing to locate. One of
  // the build log's 19 quotations is written that way, and failing it taught the distinction: the
  // defect was a short fragment that MEANS something being discarded, not an absent one.
  const short = fragments.filter((f) => f.length > 0).find((f) => f.length <= minFragment);
  if (short !== undefined) {
    return {
      ok: false,
      fragments,
      missing: short,
      why: `the fragment ${JSON.stringify(short)} is too short to locate (${minFragment} characters `
        + 'or fewer), so this quotation cannot be verified. It was previously discarded, which let a '
        + 'citation verify on its other half while the short one reversed its meaning.',
    };
  }
  const locatable = fragments.filter((f) => f.length > 0);
  if (!locatable.length) return { ok: false, fragments, missing: null };
  let cursor = 0;
  for (const f of locatable) {
    const at = hay.indexOf(f, cursor);
    if (at === -1) return { ok: false, fragments, missing: f };
    cursor = at + f.length;
  }
  return { ok: true, fragments, missing: null };
}
