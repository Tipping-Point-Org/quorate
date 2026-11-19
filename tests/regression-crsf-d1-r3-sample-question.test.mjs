// G-5 of 20261105-181450-crsf-d1-remediation-2-review: decide --sample showed a decision whose question.json could not
// be read or parsed with a blank question, as though it were valid, and asked the operator to mark it. The line now says
// the question is unreadable and why, so the operator does not judge the decision without its context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'decide.mjs'), 'utf8');

test('G-5: an unreadable question.json is shown as unreadable, not blank', () => {
  assert.doesNotMatch(SRC, /\/\* shown blank \*\//, 'the error is discarded');
  const at = SRC.indexOf("owner.read(D(d.id, 'question.json'))");
  assert.ok(at > 0);
  const near = SRC.slice(at, at + 300);
  assert.match(near, /catch \(e\) \{ q = `\[question\.json unreadable: /, 'the line names the unreadable question');
});
