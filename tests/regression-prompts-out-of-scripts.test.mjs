// Model-facing prose belongs in the prompt library, not in the orchestrator.
//
// It was in four places, and the operator found it before any check did: the run brief (167 lines
// in run-graph.mjs), the external-arm and tie-break prompts (187 in lib/codex-prompts.mjs), the
// node prompt head (52 in spawn-node.mjs), and the schema `description:` strings that reach the
// model verbatim through --json-schema. A framework whose SUBJECT is model instructions kept most
// of its own instructions inside its spawner, where a prompt author cannot find them and where
// editing prose means editing control flow.
//
// The measurement that started this was itself wrong first — a naive scan for multi-line template
// literals reported 1,812 lines across six files, because it counted JSON schemas and die()
// messages. Prose that instructs a model is a narrower thing than "a long string".
//
// WHAT THIS PINS. Not "no template literals" — that would forbid error messages and report
// rendering. It pins that the prompts which MOVED stay moved, and that the library is loadable and
// complete, because a template that silently fails to load is a node asked to do nothing and
// reported as a node that found nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { renderTemplate, slotsIn } from '../scripts/lib/template.mjs';
import { readTemplate } from '../scripts/io/template.mjs';

const TEMPLATES = path.join(REPO_ROOT, 'prompts', '_templates');
const EXPECTED = [
  'run-brief.md', 'shadow-arm.md', 'tie-break.md',
  'external-arm-constraints.md', 'tie-break-constraints.md', 'brief-feedback.md',
  // stamp-tests-thin.md and stamp-fmt-dirty.md were the ONLY two stamps that stated a consequence,
  // and they stated it as blocks appended after a bare list of every other stamp's name (G-39). They
  // are entries in stamp-consequences.json now — same words, one place, and thirteen stamps that
  // said nothing now say what they do.
];

test('every template the engine asks for exists and is non-empty', () => {
  for (const name of EXPECTED) {
    const body = readTemplate(name);
    assert.ok(body.trim().length > 0, `${name} is empty — a blank prompt asks a node to do nothing`);
  }
});

test('a missing template throws rather than rendering blank', () => {
  // The failure this prevents does not look like a failure. An empty prompt produces a node that
  // reports nothing, which reaches the gate looking exactly like a node that found nothing.
  assert.throws(() => readTemplate('no-such-template.md'), /is missing at/);
});

test('the run brief lives in the library, not in run-graph.mjs', () => {
  const brief = readTemplate('run-brief.md');
  // The rules a lens is actually governed by. If these are not in the template, they are not in the
  // brief — and a lens governed by a rule nobody sent it is the shape of an inert guarantee.
  for (const rule of [
    'test_globs WINS over source_globs',
    'TERMINATION rule',
    'Cite exactly the path it prints',
    'A capture is evidence for a claim only if its command targets that claim',
    'doctrine_path:',
  ]) {
    assert.ok(brief.includes(rule), `the brief template must carry: ${rule}`);
  }
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.ok(!src.includes('test_globs WINS over source_globs'),
    'the prose must not also live in the script — two copies of a rule drift, and the one that '
    + 'reaches the model is whichever the renderer happens to use');
});

test('the external prompts live in the library, not in lib/review-prompts.mjs', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'review-prompts.mjs'), 'utf8');
  for (const moved of [
    'Review only. Read files as needed',
    'Rule on THIS group only',
    'shadow reviewer for the',
  ]) {
    assert.ok(!src.includes(moved), `"${moved}" is still embedded in the script`);
  }
  assert.ok(readTemplate('external-arm-constraints.md').includes('Review only. Read files as needed'));
  assert.ok(readTemplate('tie-break.md').includes('Rule on THIS group only'));
  assert.ok(readTemplate('shadow-arm.md').includes('shadow reviewer for the'));
});

test('every slot a template declares is one the engine fills', () => {
  // A slot nobody fills throws at render time, which is the right behaviour and the wrong moment:
  // it would surface mid-run, on the node that needed the prompt. This catches it in the suite.
  const brief = readTemplate('run-brief.md');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const call = src.slice(src.indexOf("renderTemplate(readTemplate('run-brief.md')"), src.indexOf("}, 'run-brief.md');"));
  for (const slot of slotsIn(brief)) {
    assert.ok(new RegExp(`\\b${slot}:`).test(call), `run-brief.md declares {{${slot}}} and nothing fills it`);
  }
});

test('the brief states one severity-ceiling rule, not two', () => {
  // FOUND BY DOING THE EXTRACTION. The literal carried two consecutive sentences, both conditioned
  // on the same value — "clamped, not rejected" and "except a §6 invariant, which is never capped"
  // — so a degraded node was told the same rule twice, in different words, and neither telling was
  // complete. No archived brief shows it because no lens carried a severity ceiling until they
  // became derived from runtime capability; it would have started firing on the next degraded run.
  // The sentence moved to its template (G-12 of 20261021-194056-ciss-d1-remediation-3-review); the rule is unchanged.
  const src = readTemplate('degraded-severity-ceiling.md');
  const lines = src.split('\n').filter((l) => l.includes('no finding may exceed severity'));
  assert.equal(lines.length, 1, 'one ceiling sentence, carrying both facts');
  assert.ok(lines[0].includes('invariant'), 'and it must still say invariants are never capped');
  assert.ok(lines[0].includes('clamped'), 'and that findings above it are clamped, not rejected');
});

test('rendering fills every slot — no {{...}} survives into a prompt', () => {
  // The end-to-end property. A leftover slot in a document a model follows literally is worse than
  // a missing sentence: it reads as an instruction to look for something.
  const filled = renderTemplate(readTemplate('shadow-arm.md'), {
    vendor: 'V', lens_id: 'L', arm_constraints: 'A', lens_contract: 'C', run_brief: 'B', brief_feedback: '',
  }, 'shadow-arm.md');
  assert.ok(!/\{\{[a-z_]+\}\}/i.test(filled), 'an unfilled slot reached the prompt');
});

// ---------------------------------------------------------------------------------------------
// The last two places, done in the same pass as the first two.

test('the node prompt head lives in the library, not in spawn-node.mjs', () => {
  // SHORT, WHICH IS WHY IT SURVIVED. Every sentence here reaches every node in every run — the
  // brief pointer, the output rule, the no-write/no-spawn rule, the depth. A rule that small hides
  // in a spawner while governing the entire graph.
  for (const name of ['node-head-slash.md', 'node-head-inline.md', 'node-output-json.md',
    'node-output-prose.md', 'node-tail.md']) {
    assert.ok(readTemplate(name).trim().length > 0, `${name} must exist and be non-empty`);
  }
  assert.ok(readTemplate('node-tail.md').includes('capture.mjs and find-inert-features.mjs'),
    'the §8 exemptions are what let a node produce evidence at all');
  assert.ok(readTemplate('node-output-prose.md').includes('no JSON is expected'),
    'the prose variant must still countermand the JSON instruction — second-opinion was told to '
    + 'produce the exact opposite of what its handler expects, and complied');
});

test('no model-facing prose is left in spawn-node.mjs', () => {
  const code = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const moved of [
    'Emit only the JSON object', 'Follow these instructions exactly', 'read your brief at',
    'Do not write files', 'no JSON is expected',
  ]) {
    assert.ok(!code.includes(moved), `"${moved}" is still embedded in the spawner`);
  }
});

test('schema field descriptions are data — they reach the model verbatim', () => {
  // The base envelope's descriptions were already data (scripts/verdict.schema.json). These three
  // belong to variants derived in memory and were the last model-facing strings in the scripts. A
  // model reads them to decide what to put in a field, which makes them prompt content whatever
  // file they live in.
  const table = JSON.parse(readTemplate('schema-fields.json'));
  for (const field of ['intent_intact', 'decision', 'disputed']) {
    assert.equal(typeof table[field], 'string', `${field} must have a description`);
    assert.ok(table[field].length > 40, `${field}'s description must actually say something`);
  }
  const code = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/description:\s*['"`]/.test(code),
    'a description literal is back in the schema builder');
});

test('an unknown schema field throws rather than describing nothing', async () => {
  const { schemaField } = await import('../scripts/io/review-prompts.mjs');
  assert.throws(() => schemaField('no-such-field'), /no description for schema field/);
  assert.equal(typeof schemaField('disputed'), 'string');
});


// EVERY STAMP A SCRIPT EMITS HAS A SENTENCE SAYING WHAT IT DOES (G-39, arch-review +
// panel-codex-arch).
//
// The brief handed a lens `  - CONTRACT-PARTIAL` and nothing more. I-49 requires a stated
// consequence wherever a fact about the run is stated at all, and this one changed no behaviour a
// node could name — the reader had to already know the framework to act on it, which is the reader
// this brief exists because we do not have.
//
// The check runs against the EMITTERS, not against a hand-kept list: a stamp added to new-run
// tomorrow with no sentence here fails this test instead of quietly rendering as a bare name again.
test('a run stamp cannot reach a node without saying what it does', async () => {
  const { stampConsequence, explainedStamps } = await import('../scripts/io/stamp-notes.mjs');

  // remediate.mjs joined the emitters in remediate-rebuild stage 4 (ROUND-CAP, CHAIN-*, REPORT-CHECK, COMMIT-CHECK, UNSANDBOXED).
  const sources = ['new-run.mjs', 'run-graph.mjs', 'run-checks.mjs', 'spawn-node.mjs', 'remediate.mjs']
    .map((f) => fs.readFileSync(path.join(REPO_ROOT, 'scripts', f), 'utf8'))
    .concat(fs.readdirSync(path.join(REPO_ROOT, 'scripts', 'lib'))
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', f), 'utf8')))
    .join('\n');

  // Every string constant lib/ exports whose name ends `_STAMP`, resolved by IMPORTING the modules —
  // so a stamp emitted through its one owner is checkable, and an identifier no module exports fails
  // loudly instead of being skipped.
  const STAMP_CONSTANTS = {};
  for (const f of fs.readdirSync(path.join(REPO_ROOT, 'scripts', 'lib')).filter((x) => x.endsWith('.mjs'))) {
    const mod = await import(`../scripts/lib/${f}`);
    for (const [k, v] of Object.entries(mod)) {
      if (/_STAMP$/.test(k) && typeof v === 'string') STAMP_CONSTANTS[k] = v;
    }
  }

  // EMISSION SITES ONLY. A grep for every SCREAMING-CASE token would sweep up prose and go green on
  // a typo. All four shapes the tree actually uses, because writing only the first one found
  // TREE-MOVED and TESTS-THIN unexplained-by-omission rather than by inspection — they are added to
  // a Set, not pushed to an array.
  const emitted = new Set([
    ...sources.matchAll(/stamps\.push\('([A-Z][A-Z-]+)'\)/g),
    ...sources.matchAll(/stamps\.add\('([A-Z][A-Z-]+)'\)/g),
    ...sources.matchAll(/stamp: '([A-Z][A-Z-]+)'/g),
    ...sources.matchAll(/stamps \?\? \[\]\), '([A-Z][A-Z-]+)'\]/g),
  ].map((m) => m[1]));

  // A FIFTH SHAPE: a stamp emitted through a CONSTANT rather than a literal. `CONSUMER-LENS` is
  // exported as `CONSUMER_LENS_STAMP` — one owner, which is this project's own rule — so every scan
  // above missed it and this test reported it as "a consequence and no emitter": prose describing a
  // state the run cannot enter. It could enter it; the emitter simply did not spell the value.
  //
  // Resolved GENERICALLY rather than by adding one name to a list: every `*_STAMP` identifier the
  // engine pushes is looked up in the actual exports of lib/, so the next stamp that follows the
  // one-owner rule is found without editing this test. A hand-maintained mapping here would be the
  // same defect the scan above already paid for twice.
  for (const [, ident] of sources.matchAll(/\b([A-Z][A-Z0-9_]*_STAMP)\b/g)) {
    const value = STAMP_CONSTANTS[ident];
    assert.ok(typeof value === 'string' && value,
      `${ident} is pushed as a stamp and is exported by no module in scripts/lib — a stamp whose value `
      + 'cannot be resolved is one no reader of this suite can check');
    // SHAPE, NOT JUST THE SUFFIX. `_STAMP` is a naming convention two different kinds of constant
    // share: a RUN stamp (SCREAMING-KEBAB, explained in the consequences table) and
    // `SOURCE_STAMP = '.quorate-source.json'`, the framework-copy marker FILENAME. Adding the second
    // to `emitted` made this test demand a node-facing consequence for a filename — a true failure
    // about a false claim, which is its own kind of noise.
    if (/^[A-Z][A-Z-]+$/.test(value)) emitted.add(value);
  }

  // A SIXTH SHAPE: the stamp the code COMPOSES (G-39). run-graph builds recovery stamps as
  // `${pre.stamp}-FAILED`, which no literal-matching scan can see — so the throw this test guards
  // became a crash waiting on the one path that emits them, and the test went green because the
  // stamp it could not find was the stamp that was missing. Every declared precondition's derived
  // form is checked here explicitly.
  const derived = [...sources.matchAll(/stamp: '([A-Z][A-Z-]+)'/g)].map((m) => `${m[1]}-FAILED`);
  for (const stamp of derived) {
    const text = stampConsequence(stamp);
    assert.match(text, /attempted to close it, and FAILED/,
      `${stamp} is composed by the code and must be explained without a hand-written entry`);
  }
  assert.ok(derived.length, 'no precondition found — this half would pass vacuously');
  assert.ok(emitted.size >= 14, `only ${emitted.size} stamps found — this test would pass vacuously`);

  for (const stamp of emitted) {
    const text = stampConsequence(stamp);
    assert.ok(text.length > 40, `${stamp}'s consequence is too short to say anything`);
  }

  // ...and the reverse: a sentence for a stamp nothing emits is prose describing a state the run
  // cannot enter, which is the inert-guarantee shape pointing the other way.
  for (const stamp of explainedStamps()) {
    assert.ok(emitted.has(stamp),
      `${stamp} has a consequence and no emitter — either it is dead prose or its emitter moved`);
  }

  assert.throws(() => stampConsequence('NO-SUCH-STAMP'), /no consequence for run stamp/);
});

test('the brief renders each stamp with its consequence, not as a bare name', () => {
  const brief = readTemplate('run-brief.md');
  assert.ok(brief.includes('{{stamps_block}}'));
  // The two per-stamp slots are GONE, not merely unused: template.mjs throws on an unused slot, so
  // leaving them would have failed every render — which is the property that makes folding them in
  // safe rather than a second place for the same words to live.
  assert.equal(slotsIn(brief).includes('tests_thin_block'), false);
  assert.equal(slotsIn(brief).includes('fmt_dirty_block'), false);

  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /stamps_block:[\s\S]{0,400}stampConsequence\(x\)/,
    'a stamp list a node must interpret for itself is the defect, not the rendering of it');
});

// THE TEMPLATE DIRECTORY WAS A SECOND OWNER OF A LOCATION FACT (G-21, arch-review).
//
// codex-prompts computed `prompts/_templates` as a fixed two-hop `'..', '..'` from its own file
// URL, while check-install, new-run, run-graph and spawn-node all resolve framework paths through
// resolveFrameworkDirs — which already returns `promptsDir` for exactly this. lib/locate.mjs exists
// because that fact once had three owners and two of the copies had already disagreed. A hardcoded
// hop count is correct only while this file stays in scripts/lib/: move it, or add a templates
// consumer under scripts/, and it resolves to a SIBLING of the framework root — and the layout
// probe that fails loudly while naming both candidate paths never runs at all.
test('the template directory comes from the framework locator, not a hop count', () => {
  // lib/template.mjs since G-21: the loader left the prompt module before it was renamed (AC 6).
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'template.mjs'), 'utf8');
  assert.match(src, /resolveFrameworkDirs\(/, 'one owner of "where the framework\'s own files are"');
  assert.ok(!/'\.\.',\s*'\.\.',\s*'prompts'/.test(src), 'a hardcoded hop count is the defect');
  // And it still finds them: a locator that resolves to the wrong place fails as an empty prompt,
  // which reads downstream as a node that found nothing.
  assert.ok(readTemplate('run-brief.md').includes('{{stamps_block}}'));
});

// THE PROMPT HANDED OVER THE COORDINATES THE WORKTREE EXISTS TO HIDE (G-27, panel-codex-security).
//
// buildCodexShadowPrompt's docstring has always said it replaces "internal-only capture instructions
// with the external arm's honest evidence contract". It did not — the lens brief was embedded
// verbatim, so the §Evidence block went out intact, including the ABSOLUTE path of the run
// directory. That is the one location the arms' isolated checkout exists to put out of reach, and a
// prompt that supplies it undoes a containment built by construction. The arm-constraints line
// telling the reviewer not to read that directory is labelled in this repository, correctly, as
// defence in depth rather than a boundary.
//
// It was also instructions the arm cannot follow: an external reviewer has no capture.mjs, which is
// precisely why its findings rest on `convention`.
test('an arm prompt carries no capture mechanics and no run-directory path', async () => {
  const { stripCaptureSection, buildArmShadowPrompt } = await import('../scripts/io/review-prompts.mjs');

  const brief = [
    '# Brief', '', '## Scope', 'scripts/**', '',
    '## Evidence',
    'Your evidence dir is evidence/x/. Produce every evidence path with:',
    '  node cap.mjs --run-dir C:/proj/.claude/reviews/20260101-000000-x --node x --name <slug> -- <cmd>',
    'Cite exactly the path it prints.', '',
    '## Threat model', 'everything after the section must survive', '',
  ].join('\n');

  const out = stripCaptureSection(brief);
  assert.ok(!out.includes('.claude/reviews/20260101-000000-x'),
    'the absolute run directory is the coordinate the worktree exists to withhold');
  assert.ok(!out.includes('--run-dir'), 'and the mechanics it cannot use go with it');
  assert.match(out, /no capture channel/, 'the arm must be told why, not left with a gap');
  assert.match(out, /## Threat model[\s\S]*must survive/, 'only that section is cut');
  assert.match(out, /## Scope[\s\S]*scripts/, 'and what precedes it is untouched');

  // A brief with no such section is returned unchanged rather than guessed at.
  assert.equal(stripCaptureSection('# Brief\n\n## Scope\nx\n'), '# Brief\n\n## Scope\nx\n');

  // G-1 of 20261105-212751-sogsr-delivery: the cut took the detector command with it, so the mandatory inert-feature
  // sweep (doc-consistency-review rule 1) named a path the arm was never given. It comes back RELATIVE to the repository,
  // which is the arm's working directory, with no absolute coordinate.
  const withDetector = [
    '# Brief', '', 'repository_root: C:/proj', '', '## Scope', 'scripts/**', '',
    '## Evidence',
    '  node cap.mjs --run-dir C:/proj/.claude/reviews/20260101-000000-x --node x --name inert-sweep -- node C:/proj/.claude/skills/quorate/scripts/find-inert-features.mjs',
    '', '## Threat model', 'kept', '',
  ].join('\n');
  const armOut = stripCaptureSection(withDetector);
  assert.match(armOut, /`node \.claude\/skills\/quorate\/scripts\/find-inert-features\.mjs`/,
    `the arm brief does not give the detector's path in its working directory: ${armOut}`);
  assert.ok(!armOut.includes('C:/proj/.claude'), 'and gives no absolute coordinate');

  // End to end: the assembled prompt must not carry it either.
  const prompt = buildArmShadowPrompt({
    lensId: 'code-audit', skillMarkdown: '# lens\nrules', runBrief: brief, reviewer: 'codex',
  });
  assert.ok(!prompt.includes('.claude/reviews/20260101-000000-x'),
    'the docstring says this prompt replaces the capture instructions — now it does');
});

// THE COPY THAT REACHES THE MODEL DISAGREED WITH THE DOCTRINE THAT OWNS IT (G-3, arch-review +
// contract-audit).
//
// Twice now. `UNSWEPT-DIFF` told every lens "files changed in this diff fall outside the declared
// review surface, so no lens is reading them", while new-run pushes that stamp whenever --full-sweep
// is passed — meaning what §7 says it means, "scope was human-asserted rather than derived from a
// diff". And `PANEL-SEES-EVIDENCE` told every lens an arm "can capture evidence… do not discount a
// corroborating arm", inverting a stamp that records an EXPOSURE.
//
// §7's table is the declared owner of stamp semantics; this file is what actually reaches the model.
// Prose cannot be diffed mechanically, so what is pinned here is the property that made both errors
// possible: a consequence that contradicts the condition its own emitter tests.
test('a stamp consequence does not contradict the condition that emits it', async () => {
  const { stampConsequence } = await import('../scripts/io/stamp-notes.mjs');

  // UNSWEPT-DIFF fires on --full-sweep, which is a statement about how SCOPE WAS CHOSEN. A
  // consequence describing files being excluded from review is describing a different stamp.
  const unswept = stampConsequence('UNSWEPT-DIFF');
  assert.match(unswept, /--full-sweep|asserted by a person/i,
    'the consequence must name the condition its emitter actually tests');
  assert.ok(!/no lens is reading them/.test(unswept),
    'a full sweep reviews the declared paths; nothing is excluded by this stamp');

  // PANEL-NO-SAFE-SURFACE: no arm ran. Since arms-read-surface it is the ONLY panel-surface stamp —
  // PANEL-SEES-EVIDENCE, the root fallback's, is gone with the fallback — so its text must not
  // promise a corroboration that did not happen, nor suggest the repository was read instead.
  const panel = stampConsequence('PANEL-NO-SAFE-SURFACE');
  assert.match(panel, /No external reviewer ran/, 'it says the panel did not run');
  assert.match(panel, /stands alone/, 'and that nothing corroborates the lenses in this run');
  assert.match(panel, /never handed over/, 'and that the repository was not read in its place');
  assert.throws(() => stampConsequence('PANEL-SEES-EVIDENCE'), /no consequence/, 'the fallback\'s stamp has no row: nothing emits it');

  const { builtinReviewers } = await import('../scripts/io/reviewers.mjs');
  const { adapterCapabilities } = await import('../scripts/lib/capabilities.mjs');
  for (const [name, a] of Object.entries(builtinReviewers())) {
    if (!(a.roles ?? []).includes('reviewer')) continue;
    assert.ok(!adapterCapabilities(a).has('evidence_capture'),
      `${name} declares evidence_capture — the prompt text above assumes no arm does`);
  }
});
