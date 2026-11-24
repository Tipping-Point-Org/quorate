// G-20 — THE GUARD COULD NOT FAIL ON PROSE THAT DID NOT EXIST WHEN IT WAS WRITTEN.
//
// `regression-prompts-out-of-scripts` asserts `!src.includes(<three strings that were already moved>)`.
// It confirms a past migration stayed migrated. It is structurally incapable of failing on an ADDITION,
// which is the only moment a guard matters — so when seven paragraphs of model-facing prose were added
// to `codex-prompts.mjs` on 2026-09-13, under a line 27 reading "THE PROMPTS LIVE IN
// prompts/_templates/, NOT IN THIS FILE", the suite stayed green.
//
// This is the same shape as three other defects in this repository: the node-kind blacklists that
// silently admitted any new kind, and `forbidden-tail` guarding flags by name while `git blame -S`
// walked past. A BLACKLIST FAILS EXACTLY WHEN SOMETHING IS ADDED.
//
// So this is a WHITELIST. Every long string literal in the prompt library must be named below with a
// reason, or the suite goes red. A legitimate long string — a thrown diagnostic, an error message — is
// admitted by being named, which is what makes the rule mechanical rather than a judgement about what
// counts as "prose". Adding a sentence a model will read becomes a decision with someone's name on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

// THE SET IS EVERY PROMPT-BUILDING MODULE, AND A CENSUS NAMES IT (consumer-owned-configuration.md, "AC2 for v1";
// operator, 2026-11-20: "Prompt-building modules (Recommended)", then "As decided, module by module (Recommended)"). The
// guard read three library modules while run-graph.mjs and spawn-node.mjs, two of the four places model-facing prose was
// first found, stood outside it. A module is in the set when its text reads or renders a prompt template, starts
// external-review.mjs or spawn-subagent.mjs, or calls nodeArgv( or reviewerArgv( (the owners that put text into a model's
// command), their definition lines excepted. A wrapper reaching those owners only through a helper of its own is outside
// the rule, as the request says.
const SCRIPTS = path.join(REPO_ROOT, 'scripts');
const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');
function promptBuildingModules() {
  const out = [];
  for (const f of fs.readdirSync(SCRIPTS, { recursive: true }).map(String).filter((f) => f.endsWith('.mjs'))) {
    const p = path.join(SCRIPTS, f);
    const r = rel(p);
    if (r === 'scripts/lib/argv-specs.mjs') continue;   // names those scripts' flags; builds no prompt
    const src = fs.readFileSync(p, 'utf8');
    const calls = src.split('\n').filter((l) => !/function (nodeArgv|reviewerArgv)\(/.test(l)).some((l) => /\b(nodeArgv|reviewerArgv)\(/.test(l));
    if (calls || /lib\/template\.mjs|io\/template\.mjs|from '\.\/template\.mjs'|renderTemplate|readTemplate/.test(src)
      || /external-review\.mjs|spawn-subagent\.mjs|prompt-file/.test(src)) out.push(r);
  }
  return out.sort();
}

// THE BASELINE: the set as measured at 3315d8d9, frozen. A module whose literals are not yet named may wait in PENDING only
// if it is here, so PENDING only shrinks, and a prompt-building module that appears later is scanned from its first commit.
const BASELINE = [
  'scripts/bench-repair-pass.mjs', 'scripts/bench-second-opinion.mjs', 'scripts/check-intent-grant.mjs',
  'scripts/check-plan-verdict.mjs', 'scripts/check-reviewers.mjs', 'scripts/claim-check.mjs', 'scripts/decide.mjs',
  'scripts/external-review.mjs', 'scripts/gen-rule-text.mjs', 'scripts/io/forge-spawn.mjs', 'scripts/io/review-prompts.mjs',
  'scripts/io/template.mjs', 'scripts/lib/capabilities.mjs', 'scripts/lib/decision-panel.mjs', 'scripts/lib/decisions.mjs',
  'scripts/lib/reconcile-mutations.mjs', 'scripts/lib/review-prompts.mjs', 'scripts/lib/reviewer-probe.mjs',
  'scripts/lib/reviewers.mjs', 'scripts/lib/rule-text.mjs', 'scripts/lib/stamp-notes.mjs', 'scripts/lib/stop-record.mjs',
  'scripts/lib/telemetry-record.mjs', 'scripts/lib/template.mjs', 'scripts/new-run.mjs', 'scripts/remediate.mjs',
  'scripts/run-graph.mjs', 'scripts/run-session.mjs', 'scripts/spawn-node.mjs', 'scripts/spawn-subagent.mjs',
  'scripts/stop-guard.mjs',
];

// THE MODULES WHOSE LITERALS ARE NOT YET NAMED. AC2 is delivered when this is empty (the request's exit). Remove a module
// from it in the commit that adds its entries to tests/prose-allowlist.json; never add one.
const PENDING = [
   ];

/** The allow-list: tests/prose-allowlist.json, one entry per admitted literal, `{ module, text, reason }`. */
const ALLOW = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tests', 'prose-allowlist.json'), 'utf8'));
// Long enough that no identifier, path or format fragment reaches it, short enough that a sentence cannot hide under it.
const MAX_LITERAL = ALLOW.threshold;
const scanned = () => promptBuildingModules().filter((m) => !PENDING.includes(m));

/** Every string literal in the file, outside comments. */
// EVERY STRING LITERAL, READ OVER THE WHOLE SOURCE (G-8 of 20261121-021222-prc-g5-cig-review). The guard read each line
// for single-quoted and backtick literals, so a double-quoted string or a template spanning lines was never checked and
// prose written that way passed. Now: single, double and template quotes; a template across lines, its `${}` parts read
// as code, so a template nested in one is a literal of its own; comments skipped; a regex literal skipped so its quote
// characters open nothing (the same test of what precedes a `/` that the link census's codeMask uses). A literal's text
// is its raw source between the quotes.
function literals(src) {
  const out = [];
  const lineAt = (i) => src.slice(0, i).split('\n').length;
  const keep = (from, to) => { const text = src.slice(from, to); if (text.length > MAX_LITERAL) out.push({ line: lineAt(from), text }); };
  const prevSignificant = (at) => { let k = at - 1; while (k >= 0 && /\s/.test(src[k])) k--; return k < 0 ? '' : src[k]; };
  const stack = [];   // brace depth at each open `${`, so its template resumes at the matching `}`
  const opened = [];  // where each template on the stack began
  let depth = 0;
  let i = 0;
  // From just after a backtick or a `}` closing a `${`: to the closing backtick, or into the next `${`.
  const template = (from, start) => {
    let k = from;
    while (k < src.length) {
      if (src[k] === '\\') { k += 2; continue; }
      if (src[k] === '`') { keep(start, k); return k + 1; }
      if (src[k] === '$' && src[k + 1] === '{') { stack.push(depth); opened.push(start); depth++; return k + 2; }
      k++;
    }
    return k;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '\'' || c === '"') {
      let k = i + 1;
      while (k < src.length && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      keep(i + 1, k); i = k + 1; continue;
    }
    if (c === '`') { i = template(i + 1, i + 1); continue; }
    if (c === '/' && (/[(,=:[!&|?{};+\-*%<>~^]/.test(prevSignificant(i)) || prevSignificant(i) === ''
      || /\b(return|typeof|in|of|case|throw)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) {
      let k = i + 1; let cls = false;
      while (k < src.length && src[k] !== '\n') {
        if (src[k] === '\\') { k += 2; continue; }
        if (src[k] === '[') cls = true; else if (src[k] === ']') cls = false;
        else if (src[k] === '/' && !cls) break;
        k++;
      }
      i = k + 1; continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (stack.length && depth === stack[stack.length - 1]) { stack.pop(); i = template(i + 1, opened.pop()); continue; }
    }
    i++;
  }
  return out;
}

/**
 * Whether the module's allow-list entries admit this literal: an entry admits exactly its own literal (G-9 of
 * 20261121-021222-prc-g5-cig-review). A substring match either way let an admitted fragment admit the prose around it.
 */
function admits(mine, text) {
  return mine.includes(text);
}

test('the census finds the prompt-building set, and every module in it is scanned or pending from the baseline', () => {
  const set = promptBuildingModules();
  assert.ok(set.length >= 25, `the census found only ${set.length} modules: the reading, not the tree`);
  for (const m of ['scripts/run-graph.mjs', 'scripts/spawn-node.mjs']) assert.ok(set.includes(m), `${m} is not in the set AC2 names it in`);
  assert.deepEqual(PENDING.filter((m) => !BASELINE.includes(m)), [],
    'PENDING names a module outside the frozen baseline: a prompt-building module added after it is scanned, never pending');
  assert.deepEqual(PENDING.filter((m) => !set.includes(m)), [], 'PENDING names a module no longer in the set: remove it');
});

test('no unnamed long string literal survives in a scanned prompt-building module', () => {
  const unlisted = [];
  for (const m of scanned()) {
    const mine = ALLOW.entries.filter((e) => e.module === m).map((e) => e.text);
    for (const f of literals(fs.readFileSync(path.join(REPO_ROOT, m), 'utf8'))) {
      if (!admits(mine, f.text)) unlisted.push(`${m}:${f.line}: ${f.text.slice(0, 70)}`);
    }
  }
  assert.deepEqual(unlisted, [],
    'model-facing prose belongs in prompts/_templates/ (ARCHITECTURE.md §2). If one of these is genuinely not prose, a\n'
    + 'thrown diagnostic say, add it to tests/prose-allowlist.json with its module and the reason. That is the point:\n'
    + 'admitting a long string becomes a decision instead of a default.');
});

// THE ALLOW-LIST MUST NOT BECOME A SECOND BLACKLIST. An entry kept after its string is gone is how an allow-list rots into
// a list of things nobody checks; and an entry for a module the guard does not scan admits nothing anyone reads.
test('every allow-list entry is a real string of a scanned module, with a reason', () => {
  const live = scanned();
  for (const e of ALLOW.entries) {
    assert.ok(typeof e.reason === 'string' && e.reason.trim().length > 10, `an entry has no reason: "${String(e.text).slice(0, 50)}"`);
    assert.ok(live.includes(e.module), `an entry names ${e.module}, which the guard does not scan (pending, or not in the set)`);
    assert.ok(fs.readFileSync(path.join(REPO_ROOT, e.module), 'utf8').includes(e.text),
      `an entry names a string no longer in ${e.module}: "${e.text.slice(0, 50)}" (${e.reason})`);
  }
});

test('the guard fails on prose that did not exist when it was written', () => {
  assert.equal(literals("x('this is a sentence a model would read and follow, long enough to need a name');").length, 1);
  assert.equal(literals("// 'a comment is not a literal, however long it is, so it is never scanned at all'").length, 0);
  assert.equal(literals("x('short');").length, 0);
});

test('the reader sees every literal: double quotes, a template across lines, one nested in ${}, none in a regex', () => {
  const long = 'a sentence a model would read and follow, long enough to need a name';
  assert.deepEqual(literals(`x("${long}");`).map((l) => l.text), [long], 'a double-quoted literal');
  assert.deepEqual(literals(`x(\`first line of it\n${long}\`);`).map((l) => l.line), [1], 'a template across lines');
  const nested = literals(`x(\`outer \${y ? \`${long}\` : ''} tail of the outer template, long enough as well to count\`);`);
  assert.ok(nested.some((l) => l.text === long), 'a template nested in ${} is a literal of its own');
  assert.equal(literals(`const r = /it's "${long}"/; x();`).length, 0, 'a regex literal opens no string');
  assert.equal(literals(`/* "${long}" */ x(); // '${long}'`).length, 0, 'comments are not literals');
});

// G-9 of the same review: the allow check matched substrings in either direction, so an admitted fragment admitted any
// longer literal around it, and prose appended to an admitted literal was never a new decision.
test('an allow-list entry admits exactly its literal, not one that contains it or one it contains', () => {
  const k = 'an approved diagnostic that a developer reads, never a model, admitted by name';
  assert.equal(admits([k], k), true);
  assert.equal(admits([k], k + ' and here is a new instruction to the model, appended'), false, 'a literal around an entry');
  assert.equal(admits([k], k.slice(0, 40)), false, 'a literal inside an entry');
});

// The prose that WAS in the file must be in the templates, not merely deleted from here.
test('the intent instructions moved to templates rather than vanishing', () => {
  const dir = path.join(REPO_ROOT, 'prompts', '_templates');
  for (const name of ['arm-intent-inlined.md', 'arm-intent-unavailable.md', 'arm-evidence-contract.md']) {
    const p = path.join(dir, name);
    assert.ok(fs.existsSync(p), `${name} must hold the prose removed from codex-prompts.mjs`);
    assert.ok(fs.readFileSync(p, 'utf8').trim().length > 0, `${name} is empty — a blank prompt asks a node to do nothing`);
  }
  // And the sentences a model actually reads are still reaching it.
  assert.match(fs.readFileSync(path.join(dir, 'arm-intent-inlined.md'), 'utf8'), /intent-grounded/);
  assert.match(fs.readFileSync(path.join(dir, 'arm-intent-unavailable.md'), 'utf8'), /not_checked/);
  // G-3 of 20261105-212751-sogsr-delivery: external-review's reply contract (the schema hint and the `status` field) was
  // model-facing prose in orchestration code; the prompt library owns every sentence a model reads (ARCHITECTURE.md §2).
  const er = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  assert.doesNotMatch(er, /MUST also contain|EXACTLY ONE JSON object/, 'external-review.mjs still writes the reply contract inline');
  const reply = path.join(dir, 'reviewer-reply-contract.md');
  assert.ok(fs.existsSync(reply), 'the reply contract must live in the prompt library');
  assert.match(fs.readFileSync(reply, 'utf8'), /"status": one of "ok" \| "refused" \| "incomplete"[\s\S]*\{\{schema\}\}|\{\{schema\}\}[\s\S]*"status": one of "ok" \| "refused" \| "incomplete"/);
});
