// A DRAFT THAT QUOTES `status: approved` WAS DISCOVERED AS APPROVED (G-20, contract-audit vs I-21).
//
// I-21 requires a draft to be invisible to discovery. Two readers answered "is this approved?"
// differently:
//
//   discovery   /^status:\s*approved\s*$/m.test(text)   — ANY line in the file
//   acceptance  /^status:\s*(\S+)/m.exec(text)[1]       — the FIRST status line
//
// So a draft whose body quotes an approved header — which a request document describing this very
// mechanism naturally does — was counted among the approved candidates and then refused as a draft.
// With one real approved request beside it, the mint refuses outright ("2 approved requests ... name
// one with --request", naming the draft); alone, it selects the draft, fails acceptance and falls
// through to recovery, so the run is judged against inferred criteria while an approved request sat
// in the directory.
//
// One owner, and the first line is the right rule rather than the convenient one: a status is a
// property of a document's header, and its body is prose that may quote anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import {
  requestStatus, requestIsApproved, REQUESTS_DIR, shadowedSkills, docRoleCandidates,
} from '../scripts/io/project-paths.mjs';

const DRAFT_QUOTING_APPROVAL = [
  '---',
  'status: draft',
  '---',
  '',
  '# Adjudication merge for disputes',
  '',
  'Discovery counts a file when a line reads:',
  '',
  'status: approved',
  '',
  '...which is why this document must not be discovered.',
  '',
].join('\n');

test('regression: a draft that quotes an approved header is not approved', () => {
  assert.equal(requestStatus(DRAFT_QUOTING_APPROVAL), 'draft');
  assert.equal(requestIsApproved(DRAFT_QUOTING_APPROVAL), false,
    'the body is prose and may quote any header; the status is the first line');

  // The old discovery rule, for contrast: it is what made this file visible.
  assert.ok(/^status:\s*approved\s*$/m.test(DRAFT_QUOTING_APPROVAL),
    'the previous rule matched this draft, which is the defect this test exists for');

  // And the real shapes still work.
  assert.equal(requestIsApproved('---\nstatus: approved\n---\n\nbody\n'), true);
  assert.equal(requestStatus('---\nstatus: inferred\n---\n'), 'inferred');
  assert.equal(requestStatus('no status at all\n'), null);
  assert.equal(requestStatus(null), null, 'an unreadable document is not an approved one');
});

// G-7 of 20261020-113229-ciss-remediation-3-review. "The first line" was read as the first `status:` line ANYWHERE, so a
// document with no status in its front matter (or no front matter at all) was approved by a line in its body.
test('regression: a status line outside the front matter approves nothing', () => {
  assert.equal(requestIsApproved('---\nrequest: x\n---\n\nstatus: approved\n'), false,
    'front matter with no status, and a body line that quotes one');
  assert.equal(requestIsApproved('# A note\n\nstatus: approved\n'), false, 'no front matter at all');
  assert.equal(requestStatus('# A note\n\nstatus: approved\n'), null);
  assert.equal(requestIsApproved('---\r\nstatus: approved\r\n---\r\n\r\nbody\r\n'), true, 'CRLF front matter still reads');
  assert.equal(requestIsApproved(String.fromCharCode(0xFEFF) + '---\nstatus: approved\n---\n'), true,
    'and so does a leading BOM');
  assert.equal(requestIsApproved('---\nstatus: approved\n'), false, 'an unclosed fence is not front matter');

  // run-graph's recovery reader asked the same question with its own copy of the regex.
  const rg = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const code = rg.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\^status:/.test(code), 'run-graph must ask requestStatus, not carry a second copy of the rule');
});

test('regression: discovery and acceptance ask the same function', () => {
  const nr = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  assert.match(nr, /\.filter\(\(abs\) => requestIsApproved\(fs\.readFileSync\(abs, 'utf8'\)\)\)/,
    'discovery must use the owner');
  assert.match(nr, /const status = requestStatus\(text\);/, 'and so must acceptance');
  const code = nr.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\^status:\\s\*approved/.test(code),
    'a second copy of the rule is how the two came to disagree');
});

test("regression: a refusal names the directory discovery actually searches", () => {
  // G-21. The path lookups used REQUESTS_DIR while two refusal messages hard-coded
  // `.claude/requests/` — so after the move locate.mjs promised was "one line", the operator would
  // be told to look in a directory nothing searches. The constant reaches the prose too.
  const nr = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  const code = nr.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/'[^']*\.claude\/requests\/[^']*'|`[^`]*\.claude\/requests\/[^`]*`/.test(code),
    'a refusal message must render REQUESTS_DIR, not a literal that can go stale');
  assert.equal(REQUESTS_DIR, '.claude/requests', 'and the constant is still what it says');
  assert.match(nr, /\$\{REQUESTS_DIR\}\/` \};/, 'the "nothing found" refusal renders it');
  assert.match(nr, /approved requests in \$\{REQUESTS_DIR\}\//, 'as does the ambiguity refusal');
});

// The two helpers the install report rests on, exercised directly. Both are PURE and take their inputs
// as arguments — the lesson from three ReferenceErrors in one phase, where a closure reached for a name
// in an enclosing scope and the artifact write threw after ten judges had already ruled.
test('shadowedSkills separates what collides from what is merely present', () => {
  const dirs = ['arch-review', 'unit-test-writer', 'shared', 'scripts', 'their-own-thing'];
  const r = shadowedSkills({
    frameworkIds: ['arch-review', 'unit-test-writer', 'code-audit'],
    consumerSkillsDir: '/anywhere',
    readdir: () => dirs,
    exists: (p) => ['shared', 'scripts'].some((n) => String(p).endsWith(n)),
  });
  assert.deepEqual(r.shadowed, ['arch-review', 'unit-test-writer']);
  assert.deepEqual(r.legacy, ['shared', 'scripts'], 'the ancestor engine dirs sit on the doctrine path');
  assert.ok(!r.shadowed.includes('their-own-thing'), 'a project skill colliding with nothing is not its business');

  // A project with no skills directory at all: nothing collides, and it must not throw.
  const none = shadowedSkills({
    frameworkIds: ['code-audit'],
    consumerSkillsDir: '/nope',
    readdir: () => { throw new Error('ENOENT'); },
    exists: () => false,
  });
  assert.deepEqual(none.shadowed, []);
});

test('docRoleCandidates points at a document and refuses to invent one', () => {
  const files = [
    'docs/architecture.md', 'docs/system-architecture.md', 'docs/notes-that-mention-architecture.md',
    'docs/specification.md', 'docs/readme.md', 'docs/architecture/index.md',
  ];
  assert.deepEqual(docRoleCandidates({ role: 'architecture', files }),
    ['docs/architecture.md', 'docs/system-architecture.md'],
    'the word must be a segment of a basename of at most two segments — a rule that errs toward '
    + 'missing a candidate rather than proposing noise');
  assert.deepEqual(docRoleCandidates({ role: 'spec', files }), ['docs/specification.md']);
  assert.deepEqual(docRoleCandidates({ role: 'roadmap', files }), [],
    'nothing to point at is the normal case, and it must produce no note at all');
  assert.deepEqual(docRoleCandidates({ role: 'architecture', files: [] }), []);
});
