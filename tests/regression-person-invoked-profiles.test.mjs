// PROJECT PROFILES STOPPED AT THE GRAPH BOUNDARY, WHICH IS WHERE PROJECT KNOWLEDGE MATTERS MOST.
//
// `.claude/quorate/<name>.md` let a consuming project tell a NODE how it works, and `profileSection`
// inlined it into that node's brief. The skills a PERSON invokes got nothing -- except the two test
// writers, which reach `test-profile.md` by a pointer in their own prose. So `plan-review`,
// `plan-authoring` and `version-gate` were portable skills with nowhere to learn a project's
// milestone vocabulary, exit-gate locations or Definition-of-Done.
//
// Measured on a real consumer (storypipe, 2026-09-18): it shipped its OWN plan-review,
// plan-authoring, version-gate, unit-test-writer, integration-test-writer and candidate-pool,
// colliding with six of quorate's ten skill names, because that was the only place the project half
// could live. Every one of the twelve files was a single SKILL.md -- the differences were PURELY
// prose, nothing executable -- so the split was always possible and simply had no mechanism.
//
// THE OBJECTION THAT WAS RAISED AND ANSWERED. A node's profile is safe because `profileSection`
// EXECUTES the guard: it bounds the file, declares truncation in the brief, and writes the
// context-not-authority header itself. For a skill, Claude Code loads SKILL.md directly, so no
// assembly step exists and none of that can run at read time. The guard did not disappear; it moved:
//
//   bounded            -> check-install reports a file over budget (nothing truncates for a skill)
//   context/authority  -> stated in the skill's own text, and by its ADAPT.md at the top of the file
//   empty/unreadable   -> check-install names it, rather than the reader silently seeing nothing
//
// This pins that relocation. A guarantee that moved to a place nobody checks has been deleted, not
// moved, and the only way to tell the difference is a test at the new place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, runScript } from './helpers.mjs';
import { PROFILE_DIR, PROFILE_MAX_BYTES } from '../scripts/io/project-profile.mjs';

/** The three skills that gained a profile, and the file each one names. */
const EXTENDED = ['plan-review', 'plan-authoring', 'version-gate'];

test('each extended skill POINTS AT its profile, in the reading list a reader follows', () => {
  for (const s of EXTENDED) {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'skills', s, 'SKILL.md'), 'utf8');
    assert.match(text, new RegExp(`\\.claude/quorate/${s}\\.md`),
      `${s}/SKILL.md must name its own profile path -- a pointer is the ONLY mechanism available to `
      + 'a person-invoked skill, because nothing assembles its text');
    // AND IN THE DESCRIPTION, which is what a reader deciding whether to invoke the skill sees, and
    // what tells a project its knowledge has somewhere to go other than a same-named skill of its own.
    const desc = /^description: (.+)$/m.exec(text)?.[1] ?? '';
    assert.match(desc, new RegExp(`\\.claude/quorate/${s}\\.md`),
      `${s}'s description must mention the profile`);
  }
});

test('and carries the authority rule ITSELF, because no orchestrator can stamp it', () => {
  for (const s of EXTENDED) {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'skills', s, 'SKILL.md'), 'utf8');
    assert.match(text, /CONTEXT, not authority/,
      `${s} must state the rule in its own prose. For a NODE, profileSection writes this header; `
      + 'here there is no assembly step, so the skill is the only place it can live');
    // The honest half: a reader must be told the guarantee is weaker here, not left to assume the
    // node's bounding and truncation notice apply.
    assert.match(text, /check-install/,
      `${s} must say where the bound is actually enforced, rather than implying it is enforced at `
      + 'read time the way a node\'s is');
  }
});

test('every extended skill ships the ADAPT.md that derives its profile', () => {
  // A pointer to a file nobody knows how to write is a feature with no entry point. The two test
  // writers set the precedent: the skill reads test-profile.md, ADAPT.md produces it.
  for (const s of EXTENDED) {
    const adapt = path.join(REPO_ROOT, 'skills', s, 'ADAPT.md');
    assert.ok(fs.existsSync(adapt), `${s} points at a profile but ships no way to produce one`);
    const text = fs.readFileSync(adapt, 'utf8');
    assert.match(text, new RegExp(`\\.claude/quorate/${s}\\.md`), 'ADAPT must name what it writes');
    assert.match(text, /CITATION|citation/,
      `${s}/ADAPT.md must record by citation rather than by copy -- a restated exit gate or `
      + 'Definition-of-Done becomes a second bar that drifts from the first');
  }
});

test("version-gate's profile may ADD a requirement and never remove one", () => {
  // The one place the authority rule decides a release. A profile that could waive a gate item is a
  // gate weakening itself with text it cannot refuse, so both the skill and its ADAPT say so.
  const adapt = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'version-gate', 'ADAPT.md'), 'utf8');
  assert.match(adapt, /may ADD requirements/, 'the asymmetry must be stated where the file is written');
  assert.match(adapt, /may not remove one|never remove one/,
    'and the half that protects the gate must be explicit, not implied by the other');
});

test('the cap is 16 KiB, and it is a constant rather than a literal anyone can drift from', () => {
  // RAISED from 6 KiB, which was sized against a lens's idiom notes and would have cut storypipe's
  // 7.6 KB plan-authoring in half -- a bound that truncates the thing it was raised to carry.
  assert.equal(PROFILE_MAX_BYTES, 16 * 1024);
  const quorateMd = fs.readFileSync(path.join(REPO_ROOT, 'QUORATE.md'), 'utf8');
  assert.match(quorateMd, /16 KiB/, 'the consumer-facing document must state the real bound');
  assert.ok(!/Bounded\*\* at 6 KiB/.test(quorateMd), 'and must not still state the old one');
});

/** A throwaway repo carrying a contract and whatever profiles a test wants. */
function repoWithProfiles(profiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-prof-'));
  fs.mkdirSync(path.join(dir, PROFILE_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
    '# t\n\n```yaml\ngraph_contract_version: 3\nproject: t\ncommands:\n  build: ""\n  test: "x"\n```\n');
  for (const [name, body] of Object.entries(profiles)) {
    fs.writeFileSync(path.join(dir, PROFILE_DIR, `${name}.md`), body);
  }
  return dir;
}

test('check-install distinguishes a profile a NODE inlines from one a SKILL reads', () => {
  // Two mechanisms under one directory. Reporting them identically is how a reader comes to expect
  // a node's bounding and truncation notice from a file that gets neither.
  const dir = repoWithProfiles({ 'code-audit': 'lens idiom\n', 'plan-review': 'milestones\n' });
  try {
    const r = runScript('check-install.mjs', [], { cwd: dir });
    assert.match(r.output, /code-audit \[node, inlined\]/, 'a node profile is inlined by the engine');
    assert.match(r.output, /plan-review \[skill, read\]/, 'a skill profile is read by the skill itself');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check-install names an EMPTY or OVER-BUDGET profile, which is where those guards moved', () => {
  const dir = repoWithProfiles({
    'version-gate': '   \n',
    'plan-authoring': 'x'.repeat(PROFILE_MAX_BYTES + 1),
  });
  try {
    const r = runScript('check-install.mjs', [], { cwd: dir });
    assert.match(r.output, /EMPTY: version-gate/,
      'an empty profile and an absent one mean the same thing to a skill reading the file, so the '
      + 'difference has to be reported somewhere');
    assert.match(r.output, /over the \d+-byte budget: plan-authoring/,
      'nothing truncates a skill profile, so this note is the only enforcement the budget has');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check-install looks for test-profile.md where the documented path actually is', () => {
  // It probed `.claude/test-profile.md` while every message it printed, QUORATE.md, and both test
  // writers said `.claude/quorate/test-profile.md`. So a correctly-placed profile was reported
  // ABSENT forever, and the check for the localisation feature could not see the feature.
  const withIt = repoWithProfiles({ 'test-profile': 'pytest, fixtures under tests/fixtures\n' });
  try {
    const r = runScript('check-install.mjs', [], { cwd: withIt });
    assert.match(r.output, /test-profile\.md present/,
      'a profile at the DOCUMENTED path must be found');
  } finally {
    fs.rmSync(withIt, { recursive: true, force: true });
  }

  const wrongPath = repoWithProfiles({});
  try {
    fs.writeFileSync(path.join(wrongPath, '.claude', 'test-profile.md'), 'x\n');
    const r = runScript('check-install.mjs', [], { cwd: wrongPath });
    assert.match(r.output, /no \.claude\/quorate\/test-profile\.md/,
      'and one at the OLD path must NOT be, or the fix is only half applied');
  } finally {
    fs.rmSync(wrongPath, { recursive: true, force: true });
  }
});
