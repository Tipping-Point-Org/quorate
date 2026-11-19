// G-11 of 20261016-193355-sp-bugs-review: the probe-code hash joined the reviewer probe's key (KEY_FIELDS,
// scripts/lib/reviewer-probe.mjs), and two of the three places in shared/ that enumerate the key were updated — the
// external-review.mjs row of claude-md-contract.md still listed it ending at the host. A reader of that row was told a
// record another engine's probe wrote still counts for this one, which is what the change prevents. Every enumeration of
// the key in shared/ names the probe's code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const ENUMERATION = /schema route, CLI version,? (?:and )?(?:host|machine)/;
const NAMES_CODE = /probe's own code|probe-code hash|PROBE_CODE_FILES/;

test('G-11: every enumeration of the probe key in shared/ names the probe\'s own code', () => {
  const seen = [];
  const stale = [];
  for (const rel of ['shared/claude-md-contract.md', 'shared/external-reviewers.md']) {
    const lines = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!ENUMERATION.test(line)) return;
      seen.push(`${rel}:${i + 1}`);
      // The enumeration may run onto the next line before it names the code.
      if (!NAMES_CODE.test(`${line} ${lines[i + 1] ?? ''}`)) stale.push(`${rel}:${i + 1}`);
    });
  }
  assert.ok(seen.length >= 3, `the enumerations were found: ${seen.join(', ')}`);
  assert.deepEqual(stale, [], `an enumeration of the probe key omits the probe's code: ${stale.join(', ')}`);
});

// G-1 of 20261016-193355-sp-bugs-review: ARCHITECTURE.md's description of the probe records listed the key without the
// probe's own code. The remediation node could not edit ARCHITECTURE.md (outside its writable paths), so this was fixed in
// the session, red first.
test('G-1: ARCHITECTURE.md names the probe\'s own code in the probe record\'s key', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'ARCHITECTURE.md'), 'utf8').replace(/\s+/g, ' ');
  const at = text.indexOf('reviewer probe records');
  assert.ok(at > -1, 'the probe records are described');
  assert.match(text.slice(at, at + 500), /probe's own code/, text.slice(at, at + 300));
});
