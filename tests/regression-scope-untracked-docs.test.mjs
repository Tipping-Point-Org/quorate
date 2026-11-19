// THE SCOPE RULE'S OWNER DESCRIBED THE OLD BOUNDARY (G-11 of 20261020-113229-ciss-remediation-3-review).
//
// new-run derives scope from the diff against the base UNIONED with the untracked files git does not ignore (G-27 of
// 20261020-094311-ciss-delivery), so an empty diff beside a new untracked source file goes ahead. The contract that owns
// the rule still said "a diff containing no source files" refuses, and the refusal conditions in the skills repeated it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\s+/g, ' ');

test('regression: the scope rule names untracked files wherever it is stated', () => {
  const code = read('scripts/new-run.mjs');
  assert.match(code, /'ls-files', '--others', '--exclude-standard'/, 'the premise: new-run takes untracked files');

  for (const doc of ['shared/claude-md-contract.md', 'skills/full-review/SKILL.md', 'skills/invoke/SKILL.md']) {
    const text = read(doc);
    assert.ok(!/(a|the) diff contain(s|ing) no source files/i.test(text),
      `${doc} still states the refusal as a diff with no source files`);
    assert.match(text, /untracked/i, `${doc} must say untracked files count as changes`);
  }

  assert.match(code, /no source files in the diff vs \$\{base\} or the untracked files/,
    'and the refusal itself says what it looked at');
});
