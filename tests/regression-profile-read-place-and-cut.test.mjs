// A profile read stays in the repository, and its cut is a character boundary. G-9 of
// 20261024-235344-arp-remediation-2-review: readProfile followed a link at .claude/quorate/<name>.md to any file the
// operator can read, and the brief carried it. G-10: the bytes were cut at the cap and then decoded, so a character
// across the cap became U+FFFD in a profile with no newline to cut back to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readProfile } from '../scripts/io/project-profile.mjs';

test('regression: a profile that links outside the repository is not read', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-repo-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-out-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret.md'), 'operator secret');
    fs.mkdirSync(path.join(outside, 'dir'));
    fs.writeFileSync(path.join(outside, 'dir', 'project.md'), 'operator secret');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    // A junction needs no privilege on Windows: the profile directory itself links out of the repository.
    fs.symlinkSync(path.join(outside, 'dir'), path.join(repo, '.claude', 'quorate'), 'junction');
    const p = readProfile({ repoRoot: repo, name: 'project' });
    assert.ok(p, 'the profile exists');
    assert.equal(p.text, '', 'nothing from outside the repository is carried');
    assert.equal(p.unreadable, true);
    assert.equal(p.outside, true, 'and it says why');
  } finally {
    fs.rmSync(path.join(repo, '.claude', 'quorate'), { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

// G-10 of 20261112-073408-hl-remediation-5-review: readProfile checked realpath containment, then opened the path as the
// link leads, so a junction resolving ELSEWHERE INSIDE the repository passed and its target reached every node brief.
// The read now goes through the egress owner, which refuses a link at any level below the repository.
test('regression: a profile reached through a link inside the repository is not read', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-repo-'));
  try {
    fs.mkdirSync(path.join(repo, 'elsewhere'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'elsewhere', 'project.md'), 'linked content');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.symlinkSync(path.join(repo, 'elsewhere'), path.join(repo, '.claude', 'quorate'), 'junction');
    const p = readProfile({ repoRoot: repo, name: 'project' });
    assert.ok(p, 'the profile exists');
    assert.equal(p.text, '', `linked content was carried: ${JSON.stringify(p.text)}`);
    assert.equal(p.unreadable, true);
  } finally {
    fs.rmSync(path.join(repo, '.claude', 'quorate'), { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('regression: a profile in the repository is still read', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-repo-'));
  try {
    fs.mkdirSync(path.join(repo, '.claude', 'quorate'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'quorate', 'project.md'), 'idiom');
    const p = readProfile({ repoRoot: repo, name: 'project' });
    assert.equal(p.text, 'idiom');
    assert.equal(p.unreadable, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('regression: a cut never splits a character', () => {
  // 'é' is two bytes; at an odd cap the 6th character spans the cut. No newline, so nothing hides the split.
  const raw = 'é'.repeat(10);
  const p = readProfile({ repoRoot: '/r', name: 'project', maxBytes: 11, read: () => raw, exists: () => true });
  assert.equal(p.truncated, true);
  assert.ok(!p.text.includes('�'), `the cut text holds a replacement character: ${JSON.stringify(p.text)}`);
  assert.equal(p.text, 'é'.repeat(5));
  assert.ok(Buffer.byteLength(p.text) <= 11);
});
