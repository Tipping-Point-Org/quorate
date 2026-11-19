// .claude/requests/bench-corpus-format.md (operator, 2026-10-18: "Format now, tool after M2 (Recommended)"). A consumer
// learns the seed format and bench-admit's rules from shared/bench-corpus.md. The format's one authority is
// validateManifest, so the field list is taken from its refusals, never restated here: bench/README.md listed
// `defect.line` for months after validateManifest began refusing it, because nothing compared the two.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { validateManifest } from '../scripts/lib/bench-scoring.mjs';
import { admissionVerdict, preferredSetting, comparabilityErrors } from '../scripts/lib/bench-settings.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const doc = () => read('shared/bench-corpus.md');

// Every field validateManifest can refuse, read from its own messages: the leading field name of each.
function refusedFields() {
  const msgs = [
    ...validateManifest({}),
    ...validateManifest({ defect: {} }),
    ...validateManifest({ defect: { line: 1 }, tolerance: -1, request: '' }),
  ];
  const names = new Set();
  for (const m of msgs) {
    const hit = /^(defect\.[a-z_]+|[a-z_]+)\b/.exec(m);
    if (hit && hit[1] !== 'manifest') names.add(hit[1]);
  }
  return [...names];
}

// The fields missing from the manifest table: a row is `| \`<full field name>\` |`, and prose elsewhere on the page
// does not count.
function undocumentedFields(text, fields) {
  const rows = new Set([...text.matchAll(/^\| `([a-z_.]+)` \|/gm)].map((m) => m[1]));
  return fields.filter((f) => !rows.has(f));
}

test('AC1: every field validateManifest checks is documented in shared/bench-corpus.md', () => {
  const fields = refusedFields();
  assert.ok(fields.length >= 10, `too few fields read from validateManifest: ${fields.join(', ')}`);
  const text = doc();
  assert.deepEqual(undocumentedFields(text, fields), [], 'fields missing from the manifest table');
  assert.match(text, /`defect\.line`[^\n]*refused/i, 'defect.line is not named as refused');
  // G-8 of 20261019-173119-bench-corpus-review: this matched a field name anywhere on the page, so deleting the
  // `defect.file` row still passed, the name being in the Scoring prose too. A deleted row must be missed.
  for (const f of ['defect.file', 'removes_tests']) {
    const row = new RegExp(`^\\| \`${f.replace('.', '\\.')}\` \\|.*\\n`, 'm');
    assert.match(text, row, `the table has no ${f} row to delete`);
    assert.deepEqual(undocumentedFields(text.replace(row, ''), fields), [f], `deleting the ${f} row went unnoticed`);
  }
  // G-3 of 20261019-191344-review-review: the table had no type column, so `defect.lenses` and `scope` read as any
  // value although validateManifest refuses anything but a non-empty array. Each field's accepted types are probed from
  // validateManifest itself; the documented type must be one it accepts, and the only one when it accepts one.
  const types = typedFields(text);
  for (const f of fields) {
    if (f === 'defect.line') continue;
    const accepted = acceptedTypes(f);
    assert.ok(accepted.length, `no type probe is accepted for ${f}`);
    assert.ok(types.has(f), `the ${f} row names no type`);
    const t = types.get(f);
    assert.ok(accepted.includes(t), `${f} is documented as ${t}; validateManifest accepts ${accepted.join(', ')}`);
    if (accepted.length === 1) assert.equal(t, accepted[0], `${f} is documented as ${t}`);
  }
});

// The Type cell of each manifest row, its leading type word: `| \`<field>\` | <type> ... |`.
function typedFields(text) {
  const out = new Map();
  for (const m of text.matchAll(/^\| `([a-z_.]+)` \| (string|integer|boolean|array|object)\b[^|]*\|/gm)) out.set(m[1], m[2]);
  return out;
}

// The types validateManifest accepts for one field, each set in an otherwise valid manifest.
function acceptedTypes(field) {
  const sample = {
    string: field === 'source' ? 'historical' : 'x',
    integer: 1,
    boolean: true,
    array: ['x'],
    object: field === 'defect' ? { file: 'f', anchor: 'a', lenses: ['l'] } : { x: 1 },
  };
  return Object.keys(sample).filter((t) => {
    const m = { id: 's', title: 't', source: 'historical', defect: { file: 'f', anchor: 'a', lenses: ['l'] }, scope: ['p'], removes_tests: false };
    const [head, tail] = field.split('.');
    if (tail) m[head][tail] = sample[t]; else m[head] = sample[t];
    return validateManifest(m).length === 0;
  });
}

test('AC2: bench/README.md no longer lists defect.line as a field, and points at the owner', () => {
  const readme = read('bench/README.md');
  assert.doesNotMatch(readme, /defect \{file, line/, 'the README still lists defect.line');
  assert.match(readme, /shared\/bench-corpus\.md/);
});

test('AC3: bench-admit\'s verdicts, refusals, preference rules and exit codes are stated', () => {
  const t = doc().replace(/\s+/g, ' ');
  for (const v of ['`admitted`', '`rejected`', '`undecided`']) assert.ok(t.includes(v), `${v} is not stated`);
  // The refusals are stated by naming their owners (G-5 of 20261019-184023-review-review), not their conditions.
  assert.match(t, /`comparabilityErrors`/);
  for (const r of ['`dominance`', '`tiebreak-10pct`', '`genuine-trade`']) assert.ok(t.includes(r), `${r} is not stated`);
  assert.match(t, /--fp-tolerance/);
  assert.match(t, /exit[^.]*\b1\b[^.]*rejected/i, 'the exit code for rejected is not stated');
  // G-6 of 20261019-173119-bench-corpus-review: the list omitted `undecidable`, which preferredSetting returns. The
  // rules are read from the function's own source, so a rule added there and not listed here fails.
  const rules = [...new Set([...preferredSetting.toString().matchAll(/\brule: '([a-z0-9-]+)'/g)].map((m) => m[1]))];
  assert.ok(rules.length >= 5, `too few rules read from preferredSetting: ${rules.join(', ')}`);
  const section = /\*\*The preferred setting\*\*[\s\S]*?(?=\n\*\*Exit codes)/.exec(doc());
  assert.ok(section, 'no "The preferred setting" section');
  for (const r of rules) assert.match(section[0], new RegExp(`^- \`${r}\` —`, 'm'), `${r} is not listed`);
});

// G-4 of 20261019-181251-review-review: `undecided` was documented as only a missing --fp-tolerance, while
// admissionVerdict also returns it for a seed the setting in force catches that the candidate left unscored. The
// clauses are read from the function's own source, so a clause added there and not named in the verdict section fails.
test('G-4: every undecided_clause admissionVerdict returns is named under the `undecided` verdict', () => {
  const clauses = [...new Set([...admissionVerdict.toString().matchAll(/\bundecided_clause: '([a-z -]+)'/g)].map((m) => m[1]))];
  assert.ok(clauses.length >= 2, `too few clauses read from admissionVerdict: ${clauses.join(', ')}`);
  const section = /\*\*The verdict\*\*[\s\S]*?(?=\n\*\*The preferred setting)/.exec(doc());
  assert.ok(section, 'no "The verdict" section');
  for (const c of clauses) assert.match(section[0], new RegExp(`^ +- \`${c}\` —`, 'm'), `clause ${c} is not listed`);
});

// G-5 of 20261019-184023-review-review: the page restated comparabilityErrors' conditions, broader than the code (a
// lenses result with node settings on only one side passes it). The operator chose one owner per fact. G-6 of
// 20261019-191344-review-review: removing the conditions removed the refusals too, against AC3, which was amended
// ("Name each refusal, owner for detail (Recommended)"): each refusal is NAMED, under the function or script that owns
// its conditions, and its edge conditions are not restated. The refusals are read from the code, so one added there and
// not named here fails.
test('G-6: every refusal is named under its owner, and no edge condition is restated', () => {
  const section = /\*\*What it reads\.\*\*[\s\S]*?(?=\n\*\*The verdict\*\*)/.exec(doc());
  assert.ok(section, 'no section from "What it reads" to "The verdict"');
  const s = section[0];
  for (const c of ['injection_rule', 'mutated_from', 'only in the candidate', 'shared node']) {
    assert.ok(!s.includes(c), `the refusal sections restate the edge condition "${c}"`);
  }
  for (const owner of ['`readBenchResult`', '`comparabilityErrors`', '`scripts/bench-admit.mjs`']) {
    assert.ok(s.includes(owner), `the refusals do not name ${owner}`);
  }
  const listed = (owner) => {
    const part = new RegExp(`\\*\\*${owner}\\*\\*[\\s\\S]*?(?=\\n\\*\\*|$)`).exec(s);
    assert.ok(part, `no **${owner}** refusal list`);
    return new Set([...part[0].matchAll(/^- `([^`]+)` —/gm)].map((m) => m[1]));
  };
  // comparabilityErrors: the leading phrase of each reason it pushes.
  const comparable = [...comparabilityErrors.toString().matchAll(/out\.push\(\s*[`']([a-z_ ]+?)(?= \(| —|[`'])/g)].map((m) => m[1]);
  assert.ok(comparable.length >= 4, `too few refusals read from comparabilityErrors: ${comparable.join(', ')}`);
  const notComparable = listed('Not comparable');
  // A name is the reason's opening words: the reason may run on past it.
  for (const r of comparable) {
    assert.ok([...notComparable].some((n) => r === n || r.startsWith(`${n} `)), `comparabilityErrors refusal "${r}" is not named`);
  }
  // scripts/bench-admit.mjs: every die() after both files are read, except the one that prints comparabilityErrors.
  const src = read('scripts/bench-admit.mjs');
  const after = src.slice(src.indexOf('if (curRead.kind !== candRead.kind)'));
  const outright = [...after.matchAll(/die\(([\s\S]*?)\);/g)].map((m) => m[1]).filter((d) => !/differ in more than the setting/.test(d));
  const OUTRIGHT = { 'different harnesses': /different harnesses/, 'no caught seeds': /records no caught seeds/, 'the two results disagree on': /disagree on/ };
  assert.ok(outright.length >= 3, `too few outright refusals read from scripts/bench-admit.mjs: ${outright.length}`);
  const names = listed('Outright');
  for (const d of outright) {
    const name = Object.keys(OUTRIGHT).find((k) => OUTRIGHT[k].test(d));
    assert.ok(name, `an outright refusal in scripts/bench-admit.mjs has no name here: ${d.slice(0, 80)}`);
    assert.ok(names.has(name), `outright refusal "${name}" is not named`);
  }
});

// G-5 and G-3 of 20261019-194927-review-review: the third outright refusal was named `mutation mismatch`, a label no
// code prints (the session's own wording), and the page said every rule is a function in scripts/lib/bench-settings.mjs
// while naming scripts/bench-admit.mjs as the owner of the outright refusals. The operator chose "Round 3: quote the
// code's own words (Recommended)": every name on the page occurs verbatim in the source of the file that owns it, and
// the page names each owner by file.
test('G-5: every refusal and verdict name is the code\'s own text, in the source of the file that owns it', () => {
  const text = doc();
  const lists = /\*\*What it refuses\.\*\*[\s\S]*?(?=\n\*\*The preferred setting)/.exec(text);
  assert.ok(lists, 'no section from "What it refuses" to "The preferred setting"');
  const named = (owner) => {
    const part = new RegExp(`\\*\\*${owner}\\*\\*[\\s\\S]*?(?=\\n\\*\\*|$)`).exec(lists[0]);
    assert.ok(part, `no **${owner}** list`);
    return [...part[0].matchAll(/^ *- `([^`]+)` —/gm)].map((m) => m[1]);
  };
  const OWNERS = [
    ['Outright', 'scripts/bench-admit.mjs'],
    ['Not comparable', 'scripts/lib/bench-settings.mjs'],
    ['The verdict', 'scripts/lib/bench-settings.mjs'],
  ];
  for (const [owner, file] of OWNERS) {
    const src = read(file);
    const names = named(owner);
    assert.ok(names.length >= 3, `too few names under **${owner}**: ${names.join(', ')}`);
    for (const n of names) assert.ok(src.includes(n), `"${n}" (under **${owner}**) does not occur in ${file}`);
  }
});

test('G-3: the bench-admit introduction names both owners and claims no single owner for every rule', () => {
  const intro = /## `bench-admit`[\s\S]*?(?=\n\*\*What it reads)/.exec(doc());
  assert.ok(intro, 'no bench-admit introduction');
  assert.doesNotMatch(intro[0].replace(/\s+/g, ' '), /every rule below is a function in/, 'the page claims one owner for every rule');
  for (const f of ['`scripts/lib/bench-settings.mjs`', '`scripts/bench-admit.mjs`']) {
    assert.ok(intro[0].includes(f), `the introduction does not name ${f} as an owner`);
  }
});

test('AC4: what a consumer cannot do yet is said, with the deferred tool named', () => {
  const t = doc().replace(/\s+/g, ' ');
  assert.match(t, /--from-ledger/);
  assert.match(t, /after M2/);
});
