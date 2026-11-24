// G-63: fifteen SKILL.md files opened their "read this first" list with
// `.claude/skills/shared/disk-first-protocol.md` — a path that exists in NEITHER layout. In this
// checkout the doctrine is at `shared/`; under the documented consumer mount it is at
// `.claude/skills/quorate/shared/`. spawn-node inlines SKILL.md VERBATIM into every node prompt,
// so this was the instruction set itself, not prose about it: a literal-minded node looked for a
// file that was not there and skipped the document defining the severity ladder, the evidence
// rule, the finding shape and the non-waivable invariants — in every run, for every judgment node.
//
// No literal can be correct in both layouts, so the brief now carries the RESOLVED path
// (`doctrine_path:`) and the skills defer to it rather than guessing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, instructionFiles, instructionFile } from './helpers.mjs';
import { PROFILE_DIR } from '../scripts/io/project-profile.mjs';

// BOTH LIBRARIES. This enumerated `skills/**` alone, which was the whole population until the
// twelve node prompts moved to `prompts/` on 2026-09-09. Note the failure shape it would have had
// if the helper did not exist: not a red test, but a green one silently checking ten files where it
// means twenty-two — the doctrine-path rule below would have gone unenforced on exactly the files
// that cite the doctrine most.
const skillFiles = instructionFiles();

test('regression: no skill cites the .claude/skills/shared/ path, which exists in neither layout', () => {
  const offenders = skillFiles.filter((p) => /\.claude\/skills\/shared\//.test(fs.readFileSync(p, 'utf8')));
  assert.deepEqual(offenders.map((p) => path.relative(REPO_ROOT, p)), [],
    'these skills instruct nodes to read a file that does not exist');
});

test('every doctrine path a skill states as a literal actually resolves on disk', () => {
  // A skill may still name a path; if it does, that path must be real from the repo root. This is
  // the general form of the defect — the specific bad prefix is only one way to get it wrong.
  const bad = [];
  for (const p of skillFiles) {
    const text = fs.readFileSync(p, 'utf8');
    for (const m of text.matchAll(/`((?:\.claude\/|shared\/)[A-Za-z0-9._\/-]+\.md)`/g)) {
      const cited = m[1];
      // Two kinds of cited path do NOT resolve in this checkout by design:
      //   - the consumer-mount spelling of quorate's own doctrine, and
      //   - files that live in the CONSUMING project (the test profile a skill asks it to produce).
      // Both are documented prose about another tree, not a path this node should open here.
      if (cited.startsWith('.claude/skills/quorate/')) continue;
      // THE WHOLE CONSUMER DIRECTORY, not one filename. This was
      // `cited === '.claude/quorate/test-profile.md'` — a blacklist with a single entry, which
      // fails exactly when something is added, and three somethings were: plan-review,
      // plan-authoring and version-gate gained profiles of their own. The comment above already
      // states the general rule ("files that live in the CONSUMING project"); the code enumerated
      // one instance of it. PROFILE_DIR is the owner of this path, so it is asked rather than spelled.
      if (cited.startsWith(`${PROFILE_DIR}/`)) continue;
      // A PRIVATE DESIGN RECORD in the public mirror, which leaves .claude/requests/ out (ROADMAP D2; operator, 2026-11-13:
      // "Keep, mark as private (Recommended)"): kept as provenance, not openable there. Where the folder exists, as in this
      // repository, every such citation must still resolve.
      if (cited.startsWith('.claude/requests/') && !fs.existsSync(path.join(REPO_ROOT, '.claude', 'requests'))) continue;
      if (!fs.existsSync(path.join(REPO_ROOT, cited))) bad.push(`${path.relative(REPO_ROOT, p)} -> ${cited}`);
    }
  }
  assert.deepEqual(bad, [], 'a skill names a doctrine file that is not there');
});

test('the lens brief carries a resolved doctrine_path for the skills to defer to', () => {
  // Split in two since the brief moved to prompts/_templates/run-brief.md: the TEMPLATE must carry
  // the field, and the SCRIPT must still derive the value that fills it. Asserting only the script
  // would pass on a template that had quietly dropped the line.
  const template = fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'run-brief.md'), 'utf8');
  assert.match(template, /doctrine_path: \{\{doctrine_path\}\}/, 'the brief must state the resolved path');
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /const DOCTRINE_PATH = /, 'and it must be derived, not hardcoded');
  assert.match(graph, /doctrine_path: DOCTRINE_PATH/, 'and the derived value must fill the slot');
  // It must fail honestly rather than invent a path when the doctrine cannot be found. The words are an instruction to the
  // node, so they live in the prompt library (consumer-owned-configuration.md AC2), and the script reads them from there.
  const missing = fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'doctrine-not-found.md'), 'utf8');
  assert.match(missing, /doctrine not found.*not_checked\[\]/, 'an unresolvable doctrine must say so, not guess');
  assert.match(graph, /readTemplate\('doctrine-not-found\.md'\)/, 'and the script must use those words when it finds none');
});

test('the judgment lenses point at the brief for the doctrine location', () => {
  for (const lens of ['code-audit', 'security-audit', 'contract-audit', 'arch-review']) {
    const text = fs.readFileSync(instructionFile(lens), 'utf8');
    assert.match(text, /doctrine_path/, `${lens} must defer to the brief's resolved doctrine path`);
  }
});

// ---------------------------------------------------------------------------------------------
// /request is the first node that transmits CONVERSATION rather than source, and it has two egress
// paths the panel's data-governance rules never covered: .claude/requests/<slug>.md is COMMITTED (not
// gitignored, permanent in history, and this repository is headed for a public home), and the
// critique prompt goes to a third-party cloud. A conversation carries what a repository does not —
// a token pasted while debugging, a customer name in an error message.
//
// Found by a codex arm critiquing the skill on its first live run; neither the agy arm nor the
// model that wrote the skill raised it.
test('the request skill states the egress boundary for conversation content', () => {
  const skill = fs.readFileSync(instructionFile('request'), 'utf8');

  assert.match(skill, /What leaves, and what must not/,
    'the skill must carry the section naming both egress paths');

  // Redaction must be VISIBLE. A silent deletion breaks the verbatim guarantee that `approved`
  // rests on, while leaving the document still claiming it — the artifact lying about itself.
  assert.match(skill, /\[redacted:/,
    'redaction must be shown in-place with a marker, never performed silently');
  assert.match(skill, /name every redaction you made/,
    'the operator approves this document, so they must be told what was altered before they do');

  // The two properties that make the disk path the dangerous one.
  assert.match(skill, /Committed to the repository/,
    'the skill must say the request file is committed, not treated as a local note');
});

// The doctrine file must not still imply its rules cover everything the panel transmits: a reader
// who trusts "the prompt file is the floor" as complete has no reason to think about secrets that
// were never in a file.
test('external-reviewers doctrine names conversation as outside its original scope', () => {
  const doctrine = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'external-reviewers.md'), 'utf8');
  assert.match(doctrine, /Conversation is a category these rules were not written for/,
    'the panel doctrine reasons about source; a node sending conversation inherits a gap it must be told about');
});

// The two findings a codex arm raised about /request that were not the secrets one. Both concern
// what the skill leaves UNSAID, which is the class a reader cannot detect by reading it.
test('the request skill separates the capture from the critique, and says which can fail', () => {
  const skill = fs.readFileSync(instructionFile('request'), 'utf8');

  assert.match(skill, /two outcomes, not one/i,
    'the document and the second opinion succeed and fail independently, and the ordering is not ' +
    'obvious from the numbered steps');

  // The dangerous direction: discarding a reliable artifact because an optional one failed.
  assert.match(skill, /the document STANDS/,
    'a failed critique must never invalidate a faithful capture');

  // A retry must amend, not mint a second file — otherwise doc_roles.request points at one of two
  // documents for the same ask and nobody can tell which is current.
  assert.match(skill, /amends the existing file/i,
    'resuming an unfinished capture is not a slug collision');

  // The external reviewer must not acquire authority the status ladder reserves for the operator.
  assert.match(skill, /not an approval and not a veto/i,
    'SOUND is not permission to write approved, and NEEDS-WORK is not a block — an arm is capped ' +
    'at RISK everywhere else in this framework for the same reason');
});

test('a request with no derivable acceptance criterion is refused, not filled in', () => {
  const skill = fs.readFileSync(instructionFile('request'), 'utf8');
  const refusals = skill.slice(skill.indexOf('## Refusal conditions'));
  assert.match(refusals, /no acceptance criterion is derivable/,
    'Acceptance criteria is the only section contract-audit can judge against; an empty one is a ' +
    'request the lens cannot use, which recreates the gap this skill exists to close while looking ' +
    'like it closed it — worse than the REQUEST-INFERRED cap, which at least announces itself');
});

// THE GUARD SCANNED ONLY skills/. Both live instances of the defect it exists to prevent were
// outside its glob: a hook printing `.claude/skills/shared/claude-md-contract.md` as the one
// remediation on a configuration failure, and the usage header of find-inert-features.mjs — the
// script whose job is finding phantom instructions — naming `.claude/skills/scripts/` (G-2, G-15).
//
// READER-FACING lines only. The prefix is legitimate in prose that explains why it was removed, and
// in run-graph's deliberate probe of the legacy location. What must never carry it is a line the
// operator is told to act on: something printed, or a Usage: header meant to be copied.
test('regression: nothing PRINTED or documented as a command cites the layout-less legacy path', () => {
  const roots = [
    path.join(REPO_ROOT, 'scripts'),
    path.join(REPO_ROOT, '.claude', 'hooks'),
  ];
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) files.push(p);
    }
  };
  roots.forEach(walk);
  assert.ok(files.length > 10, 'the walk found almost nothing — it is broken, not the tree');

  const DEAD = /\.claude\/skills\/(shared|scripts)\//;
  const offenders = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!DEAD.test(line)) return;
      const printed = /console\.(error|log|warn)/.test(line);
      const usage = /^\/\/\s+node\s/.test(line.trim()) || /^\/\/\s+node\s/.test(line);
      if (printed || usage) offenders.push(`${path.relative(REPO_ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [],
    'these lines hand an operator a path that exists in neither supported layout');
});
