// G-17 and G-13 of 20261105-163851-crsf-d1-review: the test claiming no vendor name appears in the spawner searched only
// for the quoted literal 'claude', so the identifier `claudeBin` passed, and the test could not fail for the A-9 leak it
// claimed to constrain. This one searches the spawner's code (comments stripped) for the vendor's name in ANY spelling,
// case-insensitive. What it leaves out is named: the project's own file and folder names (CLAUDE.md, .claude/) and the
// runtime override, `--runtime-bin` since 2026-11-11 (its old spelling an alias only lib/argv-specs.mjs names).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('G-17: no spelling of a vendor name appears in the spawner\'s code', () => {
  const code = fs.readFileSync(new URL('../scripts/spawn-node.mjs', import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const left = code.replace(/'--runtime-bin'/g, '').replace(/CLAUDE\.md/g, '').replace(/\.claude\b/g, '');
  const hits = left.split('\n').filter((l) => /claude/i.test(l));
  assert.deepEqual(hits, [], `a vendor name in the spawner: ${hits.join(' | ')}`);
});
