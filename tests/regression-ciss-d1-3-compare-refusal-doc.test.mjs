// G-19 of 20261022-211328-ciss-d1-2-remediation-b-review: `code-index.mjs compare` refuses a working tree with edited or
// untracked files (treeIsClean, G-10 of 20261022-200543-ciss-d1-review-2), and the owning section of shared/code-index.md
// listed every other refusal but that one, so a consumer whose comparison was refused found no rule naming why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

test('G-19: the compare section names the refusal of an edited or untracked working tree', () => {
  const page = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'code-index.md'), 'utf8');
  const section = page.split('## The answer file a consumer\'s comparison reads')[1]?.split('\n## ')[0] ?? '';
  assert.ok(section, 'the compare section is missing');
  assert.match(section.replace(/\s+/g, ' '), /It refuses [^.]*edited or untracked file/, 'the refusal list omits the dirty-tree refusal');
});
