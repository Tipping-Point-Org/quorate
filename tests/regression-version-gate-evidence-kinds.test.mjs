// A REPOSITORY-STATE GATE ITEM HAS EVIDENCE OF ITS OWN KIND (m3-v1.plan.md Q7; skills/version-gate/SKILL.md step 2).
//
// The skill counted only a review run's node and report hash as a pass, and no lens can report a tag, a visibility, a CI
// result or a clean install. So M2 could not pass by construction, and its gate ran on a rule the operator gave for that
// gate alone ("Amend I4, accept CI/API evidence (Recommended)", 2026-11-20). M3's gate needs the same rule, and a rule
// living only in one gate record is re-decided at every milestone. It is in the skill now, and held here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'version-gate', 'SKILL.md'), 'utf8').split('\r\n').join('\n');

test('the skill maps code and documents to review runs, and repository state to CI, the forge\'s API or a record', () => {
  const step = skill.slice(skill.indexOf('2. **Map each gate item to evidence of its kind.**'), skill.indexOf('\n3. **'));
  assert.ok(step.length > 100, 'procedure step 2 no longer states the evidence kinds');
  for (const s of ['**Code or documents**', 'review run', "**The repository's state**", 'CI run', "forge's API", 'written record',
    'Label each item with its kind of evidence']) {
    assert.ok(step.includes(s), `step 2 no longer says: ${s}`);
  }
});

test('the report labels each pass with its kind, and one kind cannot stand in for another', () => {
  for (const label of ['pass (review)', 'pass (CI)', 'pass (API)', 'pass (record)']) {
    assert.ok(skill.includes(`| ${label} |`), `the report format has no ${label} row`);
  }
  assert.match(skill, /A kind cannot stand in for another/);
});
