// Two test-authoring skills, adopted from the project quorate grew out of and made portable.
//
// Why they belong here at all: quorate's own doctrine settles a test's correctness by EXPERIMENT
// rather than by review — red-before-green is what stops "every bug gets a test" recursing
// finding -> test -> finding forever (§4). That rule was stated in doctrine, required by the
// approved request, and enforced by nothing: `remediate`, the skill that actually fixes bugs, went
// straight from fix to re-check and never asked for a failing test first. These skills plus the
// remediate change close that.
//
// They are kept SEPARATE deliberately. A unit test pins one behaviour of the deterministic core; an
// integration test proves a flow through the real entrypoint. Different targets, different
// fixtures, different definitions of done — merged, the guidance would contradict itself depending
// on which mode the reader was in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const unit = read('skills/unit-test-writer/SKILL.md');
const integ = read('skills/integration-test-writer/SKILL.md');

test('both skills are portable: they name no language, runner, or fixed test directory', () => {
  // The whole point of the adaptation prompt is that these must work in a Python, Go or Rust repo
  // as written. A hardcoded runner is the defect.
  for (const [name, src] of [['unit-test-writer', unit], ['integration-test-writer', integ]]) {
    for (const leak of ['pytest', 'jest', 'vitest', 'go test', 'cargo test', 'tests/unit/', 'uv run']) {
      assert.ok(!src.includes(leak), `${name} hardcodes "${leak}" — it must read the runner from the contract`);
    }
  }
});

test('both read what they need from the contract rather than assuming it', () => {
  for (const [name, src] of [['unit', unit], ['integration', integ]]) {
    assert.match(src, /commands\.test/, `${name} must take its runner from the contract`);
    assert.match(src, /test_globs/, `${name} must take its locations from the contract`);
    assert.match(src, /models\.mechanical/, `${name} must follow declared model routing`);
    assert.match(src, /doctrine_path/, `${name} must resolve doctrine via the brief (G-63)`);
  }
  // Only the integration writer drives the product.
  assert.match(integ, /commands\.run/);
});

test('regression: red-before-green is required by the unit writer, not merely mentioned', () => {
  assert.match(unit, /A test that cannot fail is a defect/);
  assert.match(unit, /fails before the fix and passes after/);
  assert.match(unit, /Record which you did/, 'it must be reported, or it is unverifiable');
});

test('the integration writer refuses to guess an entrypoint it was not given', () => {
  assert.match(integ, /If `commands\.run` is empty/);
  assert.match(integ, /An inability to exercise the product IS the finding/,
    'the same rule feature-verify enforces: a verifier that verified nothing must not pass');
});

test('both refuse to invent project conventions when the profile is absent', () => {
  for (const [name, src] of [['unit', unit], ['integration', integ]]) {
    assert.match(src, /test-profile\.md/, `${name} must consult the project profile`);
    assert.match(src, /not_checked\[\]/, `${name} must name the gap rather than guess`);
    assert.match(src, /Do not invent/i, `${name} must forbid inventing a convention`);
  }
});

test('the adaptation prompt ships beside both skills and forbids guessing', () => {
  for (const p of ['skills/unit-test-writer/ADAPT.md', 'skills/integration-test-writer/ADAPT.md']) {
    const adapt = read(p);
    assert.match(adapt, /Do not invent a convention/);
    assert.match(adapt, /Do not silently resolve a conflict/,
      'a project rule contradicting the portable core must be recorded, not quietly resolved');
    assert.match(adapt, /## Unknown/, 'undeterminable idiom must land in an explicit Unknown section');
    assert.match(adapt, /how you verified the runner actually works/,
      'the same rule as a contract key: do not declare a command nobody ran');
  }
});

test('regression: remediate now requires a failing check BEFORE the fix', () => {
  // The loop moved into the node's own contract (remediate-rebuild stage 4); the skill drives the run around it.
  const node = read('prompts/remediation/PROMPT.md');
  assert.match(node, /Reproduce the defect as a failing check before touching the code/i);
  assert.match(node, /fails \*for the reason the finding names\*/,
    'a test that fails with an import error has reproduced nothing');
  assert.match(node, /`red_evidence` and `green_evidence`/, 'the report must carry BOTH evidence paths');
  // And it must leave an honest exit for claims that are not testable, or the rule would
  // manufacture exactly the vacuous tests it exists to prevent.
  assert.match(node, /cannot be expressed as a test/);
  assert.match(read('skills/remediate/SKILL.md'), /red before\s+green/i, 'the skill states the bar the node is held to');
});

// THE FIX STAYS SMALL, THE CLASS STAYS VISIBLE (ledger skills/remediate/SKILL.md:80; operator, 2026-10-08: "Make the
// smallest change: you can still obey that but add other findings to a roadmap and keep the actual change small").
// story-pipeline's G-19 drew its class as "the prompt file" and missed the vision path (G-17 next round); G-49 deferred
// its codex sibling in a comment only (G-18 next round).
test('regression: remediate searches for the same defect elsewhere and ledgers each instance, without widening the fix', () => {
  // Since remediate-rebuild: the node does the search (its contract), the rule lives in shared/remediation.md, and the
  // skill points at both. G-3/G-4/G-6/G-7 of the remediate-siblings reviews are pinned where the text now lives.
  const node = read('prompts/remediation/PROMPT.md');
  const rule = read('shared/remediation.md');
  const rem = read('skills/remediate/SKILL.md');
  assert.match(node, /Make the smallest change that addresses the claim/, 'the small-change rule stays');
  assert.match(node, /Search for the same defect elsewhere/);
  assert.doesNotMatch(node, /do not fix it here/);
  assert.match(node, /Name its class by its mechanism/, 'the boundary is drawn by mechanism, not by the reported instance');
  assert.match(node, /exact command in `search_command`/, 'the search is reviewable');
  assert.match(node, /every\s+other one goes in `deferred` with its file, line, severity, claim and reason/);
  assert.match(node, /Never defer in a comment/);
  assert.match(node, /`shared\/remediation\.md` decides which instances this change fixes/, 'the rule is applied, not restated');
  assert.match(rule, /a roadmap entry may be added beside it,\s+never instead/, 'the ledger is the one record');
  assert.match(rule, /a deferral made only in a code comment or a commit message is not a deferral/);
  assert.match(rem, /`<framework-root>\/shared\/remediation\.md` owns that rule/);
  assert.doesNotMatch(rem, /\(ROADMAP\.md,/, 'no bare ROADMAP.md: it is the consumer\'s own file');
});

// THE PROFILE CAPTURED THE DIALECT AND NOT THE DOMAIN.
//
// Found by comparing these two skills against the project-specific pair they were generalised from,
// while answering whether quorate's can REPLACE a consumer's own (C:\work\story-pipeline, which has both
// names already). The eight original ADAPT items cover how a test is written here — runner,
// assertion idiom, layout, temp workspace, fixtures, opt-in marks, faking, entrypoint. Every one of
// those appears in the project-specific skills and would survive the move.
//
// What would NOT survive is what those skills spend most of their length on: WHICH SUBSYSTEMS ARE
// WORTH PINNING, per area, each citing the architecture section that declares it — schemas, stable
// IDs, YAML round-trip, asset-registry supersedes, review-queue apply semantics, ledger transitions,
// timestamp lookup, dependency invalidation in both directions, stage fan-out, adapter contracts —
// and which milestone exit gate each integration flow is evidence for. A consumer swapping in the
// portable skill after running ADAPT would have kept the dialect and silently dropped the bar.
//
// Items 9 and 10 capture it BY CITATION, not by copy: the original skills restated the checklist
// inline, and that copy had already drifted from the runner the project's own contract declares
// (`python -m pytest -q` in the contract, a PowerShell wrapper in the skill). A second bar drifts
// from the first exactly the way a second command does.
test('regression: the profile captures the coverage bar and the gate mapping, not only the dialect', () => {
  for (const p of ['skills/unit-test-writer/ADAPT.md', 'skills/integration-test-writer/ADAPT.md']) {
    const adapt = read(p);
    assert.match(adapt, /Where the coverage bar is declared/,
      `${p}: a profile that says how to write a test here but not what is worth testing loses the `
      + 'half a project-specific skill is mostly made of');
    assert.match(adapt, /Record the CITATION,\s*\n?>?\s*not a copy/,
      'restating the owning document creates a second bar that drifts — the defect this repo keeps finding');
    assert.match(adapt, /How a test maps to a gate/,
      'a project that gates releases on test evidence needs each test to name the gate it serves');

    // Both prompts must ask the same questions. They are two files by design — the skills are
    // separate because their targets differ — but a question added to one and not the other is how
    // the two profiles come to disagree about the same repository.
    const items = [...adapt.matchAll(/^>\s*(\d+)\.\s+\*\*([^*]+)\*\*/gm)].map((m) => m[2].trim());
    assert.equal(items.length, 10, `${p} asks ${items.length} questions; both prompts must ask all ten`);
    assert.deepEqual(items.slice(-2), ['Where the coverage bar is declared', 'How a test maps to a gate']);
  }
  const [a, b] = ['skills/unit-test-writer/ADAPT.md', 'skills/integration-test-writer/ADAPT.md']
    .map((p) => [...read(p).matchAll(/^>\s*\d+\.\s+\*\*([^*]+)\*\*/gm)].map((m) => m[1].trim()));
  assert.deepEqual(a, b, 'the two adaptation prompts must ask the same questions in the same order');
});
