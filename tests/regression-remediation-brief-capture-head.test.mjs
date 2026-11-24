// THE CAPTURE COMMAND'S HEAD IN THE REMEDIATION BRIEF IS CHECKED, NOT INTERPOLATED BARE (G-24 of
// 20261121-204740-m3s7-b1-remediation-review; I-9 of .claude/requests/m3-stage7-fixes.md): remediate.mjs passed the run
// directory through briefArg but put capture.mjs's repository-relative path into the node's command as it was, so a
// framework path with a space or a shell metacharacter split or ran as something else when the node pasted it. The head
// cannot be quoted (the node's allow-list prefix-matches it), so a head a shell would act on refuses the launch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('remediate.mjs names capture.mjs in the brief through briefHead', () => {
  const src = fs.readFileSync(new URL('../scripts/remediate.mjs', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => /const captureStart = /.test(l)) ?? '';
  assert.match(line, /node \$\{captureHead\}/, `the capture head is interpolated unchecked: ${line.trim()}`);
  assert.match(src, /captureHead = briefHead\(repoRel\(path\.join\(FRAMEWORK\.scriptsDir, 'capture\.mjs'\)\)\)/);
});

test('briefHead keeps a plain head unquoted and refuses one a shell would split or expand', async () => {
  const { briefHead } = await import('../scripts/lib/decisions.mjs');
  assert.equal(briefHead('.claude/skills/quorate/scripts/capture.mjs'), '.claude/skills/quorate/scripts/capture.mjs');
  assert.equal(briefHead('.claude\\skills\\quorate\\scripts\\capture.mjs'), '.claude/skills/quorate/scripts/capture.mjs');
  assert.equal(briefHead("C:/Users/O'B/x.mjs".replace("'", '')), 'C:/Users/OB/x.mjs');
  for (const bad of ['my tools/capture.mjs', 'a;b/capture.mjs', 'a$(x)/capture.mjs', 'a`x`/capture.mjs', 'a"b/capture.mjs', "a'b/c.mjs", 'a&b/c.mjs', '%HOME%/c.mjs', '']) {
    assert.throws(() => briefHead(bad), /node brief/, `accepted ${JSON.stringify(bad)}`);
  }
});
