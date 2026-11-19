#!/usr/bin/env node
/**
 * bench-admit — read two bench result files and say whether the candidate setting may be adopted.
 *
 * I-7, I-8 and I-9 of `.claude/requests/model-and-effort-reevaluation.md`. The bench produced recall,
 * caught and false alarms and STOPPED there: no admitted/rejected verdict, no regressing-seed list,
 * no preferred setting, no per-position record. So a reader comparing two settings had nothing to do
 * but weigh aggregate recall by eye, which is the one comparison AC8 rules out by name — at seven
 * seeds one flipping is 14% of the result, and no aggregate threshold over that is honest.
 *
 * THIS SCRIPT DECIDES NOTHING ITSELF. Every rule is in lib/bench-settings.mjs where it is tested
 * without spawning anything; this reads two files, calls them, and prints. That split is why a
 * "genuine trade" can be surfaced rather than resolved: the rule that refuses to pick is a tested
 * function, not a paragraph in a CLI nobody exercises.
 *
 *   node scripts/bench-admit.mjs --current <result.json> --candidate <result.json> [--fp-tolerance N]
 *
 * `--fp-tolerance` IS NOT OPTIONAL IN EFFECT, and has no default on purpose. I-7's second clause is
 * "the false-positive candidate count does not rise MATERIALLY" and the request quantifies nothing;
 * the intent capture of the run that raised this recorded the same gap. Without it the verdict is
 * `undecided` and says which clause it could not evaluate. A built-in number here would be nobody's
 * decision wearing a gate's authority, which is worse than the missing gate it replaces.
 */
import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import path from 'node:path';
import {
  admissionVerdict, preferredSetting, positionRecord, settingLabel, readBenchResult,
  comparabilityErrors,
} from './lib/bench-settings.mjs';

function die(msg) {
  console.error(`bench-admit: ${msg}`);
  process.exit(2);
}

const args = {};
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['bench-admit'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  if (v.current !== undefined) args.current = v.current;
  if (v.candidate !== undefined) args.candidate = v.candidate;
  if (v['fp-tolerance'] !== undefined) args.fpTolerance = Number(v['fp-tolerance']);
  if (v.position !== undefined) args.position = v.position;
  if (v.json) args.json = true;
  if (v['allow-incomparable']) args.allowIncomparable = true;
}
if (!args.current || !args.candidate) {
  die('both --current <result.json> and --candidate <result.json> are required: an admission gate '
    + 'compares the setting in force against one candidate, and there is nothing to decide with one file');
}
if (args.fpTolerance !== undefined && !(Number.isFinite(args.fpTolerance) && args.fpTolerance >= 0)) {
  die('--fp-tolerance must be a non-negative number of false alarms');
}

const read = (p, label) => {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) die(`the ${label} result file does not exist: ${abs}`);
  try {
    return { json: JSON.parse(fs.readFileSync(abs, 'utf8')), path: abs };
  } catch (e) {
    return die(`${abs} did not parse: ${e.message}`);
  }
};

const cur = read(args.current, 'current');
const cand = read(args.candidate, 'candidate');

// READ BOTH SHAPES, AND REFUSE ANYTHING THAT IS NEITHER. Handed a bench-lenses result this gate
// read no seeds and reported "ADMITTED — every one of the 0 seed(s) ... is still caught": a vacuous
// pass, the same shape as the `'caught'` vocabulary bug arriving through a different door. Caught
// before a $22 lens sweep rather than after, which is the only reason it never became a number
// someone quoted. A gate that cannot read its input says so; it does not compare nothing.
const curRead = readBenchResult(cur.json);
if (!curRead.ok) die(`${path.basename(cur.path)}: ${curRead.why}`);
const candRead = readBenchResult(cand.json);
if (!candRead.ok) die(`${path.basename(cand.path)}: ${candRead.why}`);
if (curRead.kind !== candRead.kind) {
  die(`these files came from different harnesses (${curRead.kind} vs ${candRead.kind}), so the `
    + 'difference between them is not the setting');
}
if (!curRead.caught.size) {
  die(`${path.basename(cur.path)} records no caught seeds, so there is no baseline to regress `
    + 'against and "no seed regressed" would be vacuously true');
}

// IS THE DIFFERENCE THE SETTING, OR SOMETHING ELSE? Checked before anything is compared, because
// every number below is an attribution claim. A real pass was spent learning this: a lens sweep at
// `low` against the archived `medium` baseline differed in corpus_commit AND reporter set, and the
// gate compared them anyway. `--allow-incomparable` exists for a reader who knows and wants the
// numbers regardless; it prints the reasons either way, so nobody gets them silently.
{
  const bad = comparabilityErrors({ current: cur.json, candidate: cand.json });
  if (bad.length) {
    const lines = bad.map((b) => `  - ${b}`).join('\n');
    if (!args.allowIncomparable) {
      die('these two results differ in more than the setting, so a verdict would not be about the '
        + `setting:\n${lines}\n`
        + '  Re-run the baseline under the same conditions, or pass --allow-incomparable to compare '
        + 'anyway with the reasons on the record.');
    }
    console.error('bench-admit: COMPARING ANYWAY (--allow-incomparable). These differ in more than '
      + `the setting:\n${lines}`);
  }
}

// THE TWO FILES MUST MEASURE THE SAME THING. A misanchor pass against a drop pass compares
// detection of two different error shapes and would read as a setting difference — the "judged
// against a mutation it never saw" error this harness has already made once, one level up.
for (const key of (curRead.kind === 'second-opinion' ? ['mutation', 'injection_rule', 'mutated_from'] : [])) {
  const a = cur.json[key] ?? null;
  const b = cand.json[key] ?? null;
  if (a !== b) {
    die(`the two results disagree on \`${key}\` (${JSON.stringify(a)} vs ${JSON.stringify(b)}), so the `
      + 'difference between them is not the setting. Compare passes that measured the same thing.');
  }
}

// The setting each file was produced at. `candidate` is null in a pass that ran the setting in
// force, which is exactly what the "current" side should be.
const curSetting = curRead.setting;
const candSetting = candRead.setting;
if (curRead.kind === 'second-opinion' && cand.json.candidate == null) {
  console.error('bench-admit: WARNING — the candidate file records no `candidate` setting, so it '
    + 'looks like another pass at the setting in force. Check you are comparing what you think.');
}

const gate = admissionVerdict({
  current: cur.json,
  candidate: cand.json,
  fpTolerance: args.fpTolerance ?? null,
});
const preference = preferredSetting({
  current: cur.json, candidate: cand.json, admitted: gate.verdict === 'admitted',
});
const record = positionRecord({
  position: args.position ?? 'second-opinion',
  current: curSetting ?? { model: cur.json.seeds?.[0]?.setting?.model ?? null },
  candidate: candSetting,
  gate,
  preference,
  measuredBy: `${path.basename(cur.path)} vs ${path.basename(cand.path)}`,
});

if (args.json) {
  console.log(JSON.stringify({ schema_version: 1, gate, preference, position: record }, null, 2));
  process.exit(gate.verdict === 'rejected' ? 1 : 0);
}

const VERDICT = { admitted: 'ADMITTED', rejected: 'REJECTED', undecided: 'UNDECIDED' };
console.log(`\n== ${VERDICT[gate.verdict]} — ${settingLabel(candSetting)} against ${settingLabel(curSetting)}`);
console.log(`   ${gate.why}\n`);
console.log(`   seeds in force: ${gate.seeds_in_force}  (scored: ${gate.scored.current} current, ${gate.scored.candidate} candidate)`);
console.log(`   false alarms:   ${gate.false_alarms.current} -> ${gate.false_alarms.candidate}`
  + ` (${gate.false_alarms.rise >= 0 ? '+' : ''}${gate.false_alarms.rise})`);
if (gate.regressed.length) console.log(`   REGRESSED:      ${gate.regressed.join(', ')}`);
if (gate.gained.length) console.log(`   newly caught:   ${gate.gained.join(', ')}`);
console.log(`\n   preference: ${preference.rule}${preference.preferred ? ` -> ${preference.preferred}` : ''}`);
console.log(`   ${preference.why}`);
console.log(`\n   position record: ${record.position} · ${record.verdict} · ${record.outcome}`);
console.log(`   measured by ${record.measured_by}`);
// A RECOMMENDATION IS A RECOMMENDATION (A-20). Nothing here edits the contract or the roster —
// I-9 names the bench tooling doing that as a failure mode, and the operator decides.
console.log('\n   Nothing was changed. Adopting a setting means editing review.models / review.effort'
  + '\n   or lens-roster.json yourself — this reports, it does not adopt.\n');
process.exit(gate.verdict === 'rejected' ? 1 : 0);
