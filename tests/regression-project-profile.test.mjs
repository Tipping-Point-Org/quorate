// A CONSUMING PROJECT HAD NOWHERE TO PUT KNOWLEDGE ITS LENSES NEED.
//
// Asked for directly: quorate must be adaptable to the project using it — Rust, Python, whatever —
// and "aware of their needs regarding tests, architecture, etc." The contract carries FACTS (commands,
// globs, doc_roles, threat_model) and nothing discursive, so a project with idiom to convey had one
// remaining move: ship its own skill of the same name. `C:\work\story-pipeline` did exactly that for
// `unit-test-writer` and `integration-test-writer`.
//
// That is a COLLISION, not an extension, and it fails in both directions. For a skill the orchestrator
// spawns, `--inline-skill` means the framework's text wins and the project's is discarded SILENTLY;
// for a skill a person invokes, the runtime picks one and which one is not quorate's choice. The two
// documents measured 41 and 43 lines of pytest-and-storypipe specifics against quorate's 102 and 103
// lines of portable discipline. Neither was wrong. There was nowhere to keep both.
//
// So: `.claude/quorate/` — consumer-owned, outside the submodule, surviving every pointer move.
//
// INLINED rather than pointed at, because graph-topologies.md settles it: "a node that has to discover
// its own context will discover a different one each time." A profile a node is told to go and read is
// a profile some runs read and some do not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, runScript } from './helpers.mjs';
import {
  PROFILE_DIR, SHARED_PROFILE, PROFILE_MAX_BYTES, readProfile, profileSection, listProfiles,
} from '../scripts/io/project-profile.mjs';

// An in-memory tree, so the rules are exercised without a filesystem — the standing lesson from three
// ReferenceErrors in one phase is that a helper whose inputs arrive as parameters is one that cannot
// reach for the wrong thing.
const fakeTree = (files) => ({
  exists: (p) => Object.keys(files).some((k) => String(p).replace(/\\/g, '/').endsWith(k)),
  read: (p) => {
    const hit = Object.keys(files).find((k) => String(p).replace(/\\/g, '/').endsWith(k));
    if (hit === undefined) throw new Error('ENOENT');
    if (files[hit] === null) throw new Error('EACCES');
    return files[hit];
  },
});

test('a project with no profile changes nothing about the brief', () => {
  const { exists, read } = fakeTree({});
  assert.equal(readProfile({ repoRoot: '/r', name: 'code-audit', exists, read }), null);
  const s = profileSection({ repoRoot: '/r', nodeId: 'code-audit', exists, read });
  assert.equal(s.text, '',
    'an empty heading invites a model to explain the emptiness, and a "(none)" section in every brief '
    + 'of every run is noise that teaches the reader to skip the region');
  assert.deepEqual(s.files, []);
});

test('the shared profile and the node’s own both reach the brief, in that order', () => {
  const { exists, read } = fakeTree({
    [`${PROFILE_DIR}/${SHARED_PROFILE}.md`]: '# every node\n\n- IDs are uuid4 hex since 2026-08.\n',
    [`${PROFILE_DIR}/code-audit.md`]: '# code-audit\n\n- TaskResult is the stage/runner contract.\n',
  });
  const s = profileSection({ repoRoot: '/r', nodeId: 'code-audit', exists, read });
  assert.deepEqual(s.files, [`${PROFILE_DIR}/project.md`, `${PROFILE_DIR}/code-audit.md`]);
  assert.ok(s.text.indexOf('every node') < s.text.indexOf('TaskResult'),
    'shared context first, then the specific: the node reads the narrower one last');
  // Each section names the file it came from, so a finding about a profile can cite it.
  assert.match(s.text, /### \.claude\/quorate\/project\.md/);
  assert.match(s.text, /### \.claude\/quorate\/code-audit\.md/);
});

test('the section states that a profile cannot waive anything', () => {
  const { exists, read } = fakeTree({ [`${PROFILE_DIR}/code-audit.md`]: 'x\n' });
  const s = profileSection({ repoRoot: '/r', nodeId: 'code-audit', exists, read });
  // Consumer prose already reaches a brief through threat_model, and §6's invariants are outside any
  // threat model's power to waive. The same rule holds here and is STATED to the node rather than
  // assumed, because a project could otherwise write "ignore the evidence rule" and be obeyed.
  assert.match(s.text, /CONTEXT rather than authority/);
  assert.match(s.text, /does not grant a permission, relax a severity floor, waive a §6 invariant/);
  assert.match(s.text, /they win and the disagreement is worth reporting as a finding about the profile/,
    'and a profile that contradicts the doctrine is itself a finding, not a silent override');
});

test('an oversized profile is truncated AND says so', () => {
  const big = `# big\n${'- a line that is here only to take up room.\n'.repeat(400)}`;
  assert.ok(Buffer.byteLength(big) > PROFILE_MAX_BYTES, 'fixture must exceed the cap');
  const { exists, read } = fakeTree({ [`${PROFILE_DIR}/code-audit.md`]: big });
  const p = readProfile({ repoRoot: '/r', name: 'code-audit', exists, read });
  assert.equal(p.truncated, true);
  assert.ok(Buffer.byteLength(p.text) <= PROFILE_MAX_BYTES);

  const s = profileSection({ repoRoot: '/r', nodeId: 'code-audit', exists, read });
  // THE MARK IS THE POINT. Truncating without one is the defect this project already fixed for
  // rulings (G-36): the number was never the problem, cutting silently was. A node that cannot tell a
  // complete instruction from a cut one will follow half of one.
  assert.match(s.text, /TRUNCATED at \d+ bytes of \d+/);
});

test('an unreadable or empty profile is reported, not silently skipped', () => {
  const unreadable = fakeTree({ [`${PROFILE_DIR}/code-audit.md`]: null });
  const p = readProfile({ repoRoot: '/r', name: 'code-audit', ...unreadable });
  assert.equal(p.unreadable, true, 'a profile that exists and cannot be read is not the same as absent');
  const s1 = profileSection({ repoRoot: '/r', nodeId: 'code-audit', ...unreadable });
  assert.match(s1.notes.join(' '), /could not be read/);

  const blank = fakeTree({ [`${PROFILE_DIR}/code-audit.md`]: '   \n\n' });
  const s2 = profileSection({ repoRoot: '/r', nodeId: 'code-audit', ...blank });
  assert.match(s2.notes.join(' '), /is empty/);
  assert.equal(s2.files.length, 0, 'an empty file contributes no section');
});

test('regression: the brief template carries the slot and run-graph fills it per node', () => {
  const tpl = fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'run-brief.md'), 'utf8');
  assert.match(tpl, /\{\{project_profile\}\}/, 'the brief must interpolate it');
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /project_profile: profileSection\(\{ repoRoot, nodeId: e\.node_id \}\)\.text/,
    'PER NODE: a shared-only mechanism would hand security-audit the code-audit profile');
});

test('listProfiles is sorted and tolerates a project with no directory at all', () => {
  assert.deepEqual(listProfiles({ repoRoot: '/r', readdir: () => ['z.md', 'a.md', 'notes.txt'] }),
    ['a', 'z'], 'sorted, so two runs of the install report print the same order');
  // A real absence carries code ENOENT; any other failure is raised since G-11 of 20261025-021243-arp-remediation-3c-review.
  assert.deepEqual(listProfiles({ repoRoot: '/r', readdir: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } }), [],
    'no directory is the normal case');
});

test('the install names a profile that matches no node, because nothing reads it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-prof-'));
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n```\n');
    fs.mkdirSync(path.join(dir, '.claude', 'quorate'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'quorate', 'code-audit.md'), '# ok\n');
    fs.writeFileSync(path.join(dir, '.claude', 'quorate', 'code-review.md'), '# typo\n');
    const r = runScript('check-install.mjs', ['--repo-root', dir]);
    assert.match(r.output, /carries 2 profile\(s\)/);
    assert.match(r.output, /NAMED AFTER NOTHING THIS QUORATE SPAWNS[^\n]*code-review/,
      'a profile named after a node that does not exist is read by nothing and looks like it works');
    assert.ok(!/NAMED AFTER NOTHING[^\n]*code-audit\b/.test(r.output));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
