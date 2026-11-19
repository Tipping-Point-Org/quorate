// This test exists to guard a DOCUMENTED DECISION, not a line of code.
//
// capture.mjs spawns declared project commands with no env override, so a command that prints its
// environment writes those values into evidence/<node>/<name>.log. That was raised by an external
// arm and DECLINED deliberately: the command is the operator's own, running on a machine where
// those variables are already in the launching shell, and the output stays on local disk.
//
// The whole justification rests on one fact — evidence is gitignored and never committed. §3 states
// the condition that flips the decision: if evidence directories are ever committed, or run dirs
// shipped as CI artifacts, the disclosure stops being local and the default must become a scrub.
//
// A trigger condition that lives only in prose is the failure this project keeps finding in itself.
// So the fact the decision depends on is asserted here: anyone deleting that .gitignore entry is
// changing a security decision, and this is what tells them so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

test('regression: evidence directories are gitignored — the residual depends on it', () => {
  const ignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.claude\/reviews\/\*\/evidence\/\s*$/m,
    'removing this entry turns a local disclosure into a committed one; see §3');
});

test('regression: no evidence file is actually tracked', () => {
  // The .gitignore entry is necessary but not sufficient: a file force-added before the rule
  // existed stays tracked forever, and gitignore says nothing about it.
  const tracked = execFileSync('git', ['ls-files', '.claude/reviews/'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 30 })
    .split('\n')
    .filter((f) => f.includes('/evidence/'));
  assert.deepEqual(tracked, [], `evidence files are tracked in git:\n${tracked.join('\n')}`);
});

test('the doctrine still states the trigger that would reverse the decision', () => {
  // If someone deletes the reasoning, the next reader inherits a default with no rationale and no
  // idea what would justify changing it.
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8');
  assert.match(doc, /condition that flips this decision/i);
  assert.match(doc, /uploaded as CI artifacts|shared between machines/i);
});
