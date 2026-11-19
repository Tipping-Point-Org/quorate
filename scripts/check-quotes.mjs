#!/usr/bin/env node
// check-quotes.mjs — every quotation attributed to a person must exist, verbatim, in the record.
//
// WHY THIS EXISTS. blog/build-log.html quotes the operator and states, in its own method note, that
// nothing on the page is paraphrase. The first draft got four of eight quotations wrong:
//
//   * the operator writes turns as `<context>: <reply>`, where the context is usually a phrase
//     copied out of the ASSISTANT'S previous message — so reading the line naively put the
//     assistant's own words in the operator's mouth, twice;
//   * one quotation came from a continuation SUMMARY (the assistant's account of an earlier
//     conversation) rather than from anything the operator said;
//   * one merged two separate turns into a single block;
//   * one was dated a day early.
//
// A page whose claim is "verbatim" and whose guarantee is "I read it carefully" has the shape this
// whole project rejects: an assertion with no check behind it. `check-counted-facts` exists because
// a number in prose went stale five times in one day; this is the same instrument pointed at speech.
//
// It reads the gitignored digests written by extract-sessions.mjs, so it verifies against the
// PRIMARY RECORD rather than against another document.
//
// NO GRAPH_NODE_DEPTH GUARD: reads files, spawns nothing (§8, same class as capture.mjs).
//
//   node scripts/check-quotes.mjs [--page blog/build-log.html] [--digests blog/sessions]
//
// Exit codes: 0 every quotation verified · 1 at least one did not · 2 the record is missing.

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import path from 'node:path';
// The matching rule itself lives in lib/, because a second caller now depends on it meaning
// exactly this: the judge citation check in lib/second-opinion-scoring.mjs.
import { flat, quotePresent } from './lib/verbatim.mjs';

const args = { page: 'blog/build-log.html', digests: 'blog/sessions' };
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['check-quotes'])); } catch (e) {
    if (!(e instanceof ArgvError)) throw e;
    console.error(`check-quotes: ${e.message}`);
    process.exit(2);
  }
  if (v.page !== undefined) args.page = v.page;
  if (v.digests !== undefined) args.digests = v.digests;
}

const pagePath = path.resolve(args.page);
const digestDir = path.resolve(args.digests);

if (!fs.existsSync(pagePath)) {
  console.error(`check-quotes: no page at ${pagePath}`);
  process.exit(2);
}
if (!fs.existsSync(digestDir)) {
  // FAILS LOUDLY, never "nothing to check". A verifier that passes because its evidence is absent
  // is worse than no verifier: it reports a guarantee it did not test.
  console.error(`check-quotes: no digests at ${digestDir} — run:\n`
    + '  node scripts/extract-sessions.mjs\n'
    + 'They are gitignored (raw conversation), so a fresh checkout has none until it extracts them.');
  process.exit(2);
}

const digests = fs.readdirSync(digestDir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
  .map((f) => fs.readFileSync(path.join(digestDir, f), 'utf8'))
  .join('\n');

if (!digests.trim()) {
  console.error(`check-quotes: the digest directory holds no dated day files`);
  process.exit(2);
}

const HAY = digests;

const page = fs.readFileSync(pagePath, 'utf8');
const said = [...page.matchAll(/<div class="said">([\s\S]*?)<\/div>/g)].map((m) => m[1]);

let checked = 0;
const failures = [];

for (const block of said) {
  const who = /<span class="who">([^<]*)<\/span>/.exec(block)?.[1]?.trim() ?? '(unattributed)';
  for (const m of block.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    const text = m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .trim();
    if (!text) continue;
    checked += 1;

    // AN ELISION IS NOT A LICENCE — see lib/verbatim.mjs, which owns that rule for this check and
    // for the judge-citation check that scores second-opinion.
    const { ok, missing } = quotePresent({ haystack: HAY, quote: text });
    if (!ok) failures.push({ who, fragment: missing ?? flat(text), text });
  }
}

if (!checked) {
  console.error('check-quotes: the page contains no `said` quotations — the selector or the page changed');
  process.exit(2);
}

for (const f of failures) {
  console.error(`FAIL  ${f.who}`);
  console.error(`      not in the record: "${f.fragment.slice(0, 110)}"`);
}

if (failures.length) {
  console.error(`\n${failures.length} of ${checked} quotation(s) are not verbatim in the transcripts.`);
  console.error('A quotation the record does not contain is either the assistant\'s own words quoted');
  console.error('back, a line from a continuation summary, or two turns merged — check the digest\'s');
  console.error('annotations before changing the page.');
  process.exit(1);
}

console.log(`check-quotes: ${checked} quotation(s) verified verbatim against the transcripts `
  + `(elisions checked fragment-by-fragment, in order)`);
