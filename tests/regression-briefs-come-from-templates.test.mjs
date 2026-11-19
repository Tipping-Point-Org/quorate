// A BRIEF BUILT FROM STRING LITERALS IN THE ORCHESTRATOR IS PROSE A PROMPT AUTHOR CANNOT FIND.
//
// `consumer-owned-configuration` AC 2 requires that no model-facing prose sits in `scripts/**/*.mjs`,
// "enforced by a rule a machine can apply", and that the rule "must be able to fail on prose that did
// not exist when it was written". The existing guard (regression-prompt-prose-allowlist) does that for
// `lib/codex-prompts.mjs` with a length threshold plus an allow-list. That AC carried its own status
// note saying the rest of the engine was outstanding, and it was right: two whole briefs lived in
// `run-graph.mjs` as literals, reported four times and twice respectively.
//
// THE LENGTH RULE DOES NOT TRANSPLANT. `run-graph.mjs` holds 161 string literals over sixty
// characters and `spawn-node.mjs` 58 — almost all of them `die()` reasons and `ABORT:` diagnostics
// read by a developer, never by a model. Allow-listing 219 of those would turn "a new entry here is a
// decision" into a wall nobody reads, which is the same failure as no guard at all.
//
// So this guards the PROPERTY instead: a file whose name ends `-brief.md` is written to a node, and
// therefore must be rendered from a template rather than concatenated here. That fails on an addition
// — writing a new brief inline trips it — without demanding an opinion about what counts as prose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const ORCHESTRATORS = ['run-graph.mjs', 'spawn-node.mjs', 'new-run.mjs'];
const TEMPLATES = path.join(REPO_ROOT, 'prompts', '_templates');
// The run brief's slot values still built inline in run-graph.mjs's lens-brief writer: found when this guard was made
// to scan the whole block (G-30 of 20261021-162807-ciss-d1-review), ledgered as instances of G-25 rather than moved in
// the same change. A new entry here is a decision; removing one when its sentence moves to a template is the goal.
// The intent block's two sentences left this list for prompts/_templates/brief-intent-*.md (G-9 of
// 20261114-032609-m2-7b-remediation-review). The last two left it too (G-7 and G-10 of
// 20261114-042824-m2-7b-remediation-2-review): the doc-roles none line for brief-doc-roles-none.md, and
// PRECONDITIONS[].why for recovery-why-request.md. The list is empty, and stays a decision to add to.
const KNOWN_INLINE = [];
// A diagnostic is for a developer, not a model: it names its script first (`run-graph: …`), as every die() does.
const DIAGNOSTIC = /^(run-graph|spawn-node|new-run): /;

/** Source with comments stripped, so prose ABOUT a rule cannot satisfy the rule. */
// NO BLOCK-COMMENT REGEX, because a glob is indistinguishable from one. This stripped
// `/*` ... `*/` pairs, and a GLOB contains `/*` — in comments AND in real code, which this
// orchestrator is full of. So the stripper opened blocks that were never meant to open and
// swallowed 230,000 of run-graph.mjs's 290,000 characters, including the `recovery-brief.md`
// render this test looks for.
//
// It had been eating chunks silently for a long time (287k stripping to 76k) and only FAILED once a
// new comment quoting a glob shifted which `*/` it paired with. Green for the wrong reason, then
// red for the wrong reason — a helper that mangles its input and still passes is the shape this
// repository keeps finding in itself.
//
// Line comments are enough. A JSDoc block's interior lines start with `*` and are dropped by the
// same filter; only its `/**` opener survives, which no search here can match by accident.
function code(name) {
  return fs.readFileSync(path.join(REPO_ROOT, 'scripts', name), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');
}

test('every brief an orchestrator writes is rendered from a template', () => {
  for (const name of ORCHESTRATORS) {
    const src = code(name);
    // THE PAYLOAD, not the neighbourhood. The first version of this asserted `renderTemplate(`
    // appeared within 400 characters of the write, and failed on a brief that IS rendered — from a
    // template ninety lines earlier, assigned to `body`. Proximity was the wrong instrument.
    //
    // What actually matters is that the bytes handed to the write are not prose: a rendered brief,
    // or a variable holding one, carries no long literal. An inline brief carries dozens.
    for (const m of src.matchAll(/-brief\.md['"`]/g)) {
      if (/copyFileSync/.test(src.slice(Math.max(0, m.index - 200), m.index))) continue;
      // writeTracked too: run-graph writes its briefs through it, and a write this skipped was never scanned (G-30).
      if (!/writeFileSync|writeText|writeTracked/.test(src.slice(Math.max(0, m.index - 300), m.index))) continue;
      // AFTER the closing quote of the filename. Slicing from `m.index` included that quote, and a
      // brief path is often a template literal — so the scanner read its CLOSING backtick as an
      // opening one and reported the whole render call as a single long string.
      const from = m.index + m[0].length;
      const stop = src.indexOf(');', from);
      // THE WHOLE BLOCK THAT BUILDS THE PAYLOAD, and every caller's arguments (G-30 of 20261021-162807-ciss-d1-review).
      // Scanning only from the filename to `);` saw `body + BRIEF_FEEDBACK` and never the inline array that built
      // `body`, nor the prose writeAuxBrief's callers pass in, so the boundary was broken while this stayed green.
      // The block starts after the previous top-level block closed (`\n}\n`), or at its own `function`.
      const blockStart = Math.max(src.lastIndexOf('\n}\n', m.index), src.lastIndexOf('\nfunction ', m.index), 0);
      const parts = [src.slice(from, stop === -1 ? from + 1200 : stop), src.slice(blockStart, m.index)];
      const fn = /\nfunction (\w+)\(/.exec(src.slice(blockStart, m.index));
      if (fn) {
        for (const call of src.matchAll(new RegExp(`\\b${fn[1]}\\(`, 'g'))) {
          if (src.slice(call.index - 9, call.index) === 'function ') continue;
          const end = src.indexOf(');', call.index);
          parts.push(src.slice(call.index, end === -1 ? call.index + 1200 : end));
        }
      }
      // A literal inside a console line, a die() or a thrown Error is read by the operator, not by a node.
      const inDiagnostic = (payload, at) => {
        const before = payload.slice(Math.max(0, at - 300), at);
        const open = Math.max(...['console.', 'die(', 'Error('].map((k) => before.lastIndexOf(k)));
        return open !== -1 && !before.slice(open).includes(');');
      };
      const prose = parts.flatMap((payload) => [...payload.matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)]
        .filter((lit) => !inDiagnostic(payload, lit.index))
        .map((lit) => lit[1] ?? lit[2] ?? '')
        .filter((t) => t.length > 60 && !DIAGNOSTIC.test(t) && !KNOWN_INLINE.some((k) => t.startsWith(k))));
      assert.deepEqual(prose, [],
        `${name} writes a brief whose payload carries ${prose.length} long literal(s) — prose in the `
        + 'one place a prompt author does not look, which is how two whole briefs sat in '
        + `run-graph.mjs through six sightings. They begin: ${JSON.stringify(prose.map((p) => p.slice(0, 70)))}`);
    }
  }
});

test('the templates those briefs render from exist and say something', () => {
  // A template that is present but empty renders a brief that asks a node to do nothing, and the
  // render succeeds — so existence alone is not the property worth pinning.
  for (const t of ['recovery-brief.md', 'reconcile-brief.md', 'run-brief.md', 'aux-brief.md']) {
    const p = path.join(TEMPLATES, t);
    assert.ok(fs.existsSync(p), `${t} is missing — a brief cannot render from a template that is not there`);
    assert.ok(fs.readFileSync(p, 'utf8').trim().length > 200, `${t} is too short to be a brief`);
  }
});

test('the moved briefs kept the sentences that carry their meaning', () => {
  // Moving prose must not quietly edit it. These are the load-bearing instructions from each brief:
  // the recovery draft's status rule, and the barrier's statement that grouping was already done.
  const recovery = fs.readFileSync(path.join(TEMPLATES, 'recovery-brief.md'), 'utf8');
  assert.match(recovery, /you neither choose nor state the status/,
    'the producer must still be told the orchestrator sets `inferred`, or it writes `draft` by its '
    + 'normal rule and the recovery reports success while changing nothing');
  assert.match(recovery, /capped at RISK/, 'and why an honest draft beats a confident one');

  const reconcile = fs.readFileSync(path.join(TEMPLATES, 'reconcile-brief.md'), 'utf8');
  assert.match(reconcile, /Grouping is mechanical and was done by script/,
    'the barrier must still be told not to re-do the grouping');
  assert.match(reconcile, /judgment only/, 'and what its job actually is');
});

// G-10 of 20261114-042824-m2-7b-remediation-2-review: PRECONDITIONS[].why is rendered into recovery-brief.md as {{why}},
// but it is defined far from the writer the scan above reads, so its prose was out of that scan's reach (and listed in
// KNOWN_INLINE as well). The table's sentences come from prompts/_templates, so it carries no long literal of its own.
test('the recovery preconditions table carries no model-facing prose of its own', () => {
  const src = code('run-graph.mjs');
  const at = src.indexOf('const PRECONDITIONS = [');
  assert.notEqual(at, -1, 'PRECONDITIONS is gone from run-graph.mjs; point this test at where the table lives now');
  const table = src.slice(at, src.indexOf('\n];', at));
  const prose = [...table.matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? '')
    .filter((t) => t.length > 60);
  assert.deepEqual(prose, [], 'a recovery reason a producer reads belongs in prompts/_templates/');
});

test('every slot a brief template declares is filled by its caller', () => {
  // An unfilled `{{slot}}` reaches the model as literal braces. renderTemplate throws on one, so this
  // asserts the CALLER passes the set the template declares rather than trusting it to notice.
  const src = code('run-graph.mjs');
  for (const [tpl, slots] of [
    ['recovery-brief.md', ['producer', 'why', 'missing_reason', 'scope_paths', 'doc_paths', 'doc_roles', 'brief_feedback']],
    // repo_root added 2026-10-20 (regression-briefs-name-the-repository): the reconciler could not open the source it judged.
    ['reconcile-brief.md', ['run_id', 'repo_root', 'doctrine_path', 'groups_file', 'batch_note', 'intent_sha256', 'did_not_report', 'not_checked', 'brief_feedback']],
  ]) {
    const declared = [...fs.readFileSync(path.join(TEMPLATES, tpl), 'utf8').matchAll(/\{\{(\w+)\}\}/g)]
      .map((m) => m[1]);
    assert.deepEqual([...new Set(declared)].sort(), [...slots].sort(),
      `${tpl} declares a different slot set than this test pins — update both deliberately`);
    const at = src.indexOf(tpl);
    assert.notEqual(at, -1, `${tpl} is rendered by nothing in run-graph.mjs`);
    const call = src.slice(at, at + 900);
    for (const s of slots) {
      assert.match(call, new RegExp(`\\b${s}:`), `${tpl}: the caller does not fill {{${s}}}`);
    }
  }
});

test('every brief names the doctrine path, the auxiliary ones included', () => {
  // The run brief carried doctrine_path; the reconcile brief and every writeAuxBrief brief did not, and a
  // reconciler found the doctrine only by reading a sandbox copy (story-pipeline run
  // 20261005-235247-product-sweep, its BRIEF-GAP note). A node told to follow a doctrine must be told where it is.
  const src = code('run-graph.mjs');
  const aux = src.slice(src.indexOf('function writeAuxBrief('), src.indexOf('function writeAuxBrief(') + 600);
  // Rendered from aux-brief.md since G-25 of 20261021-162807-ciss-d1-review: the template names it, the writer fills it.
  assert.match(aux, /doctrine_path: DOCTRINE_PATH/, 'writeAuxBrief must fill the doctrine path');
  assert.match(fs.readFileSync(path.join(TEMPLATES, 'aux-brief.md'), 'utf8'), /^doctrine_path: \{\{doctrine_path\}\}$/m,
    'the auxiliary brief must name the doctrine path');
  const reconcile = fs.readFileSync(path.join(TEMPLATES, 'reconcile-brief.md'), 'utf8');
  assert.match(reconcile, /^doctrine_path: \{\{doctrine_path\}\}$/m, 'the reconcile brief must name the doctrine path');
});
