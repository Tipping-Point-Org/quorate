// G-4 of 20261024-224631-arp-remediation-review: a settings file holding JSON that parses but is not an object (`null`,
// a number, an array) was read as a file with no hooks, so check-install said the stop guard was not declared and sent
// the operator to add hooks, the misreport the first G-4 remediation removed for a file that does not parse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runScript, REPO_ROOT } from './helpers.mjs';

test('regression: settings JSON that is not an object is named as that, not as an absent guard', () => {
  for (const settings of ['null', '3', '[]', '"hooks"']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-guard-shape-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: dir });
      fs.copyFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
      fs.mkdirSync(path.join(dir, '.claude'));
      fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), settings);
      const out = runScript('check-install.mjs', ['--repo-root', dir]).output;
      assert.match(out, /\.claude[\\/]settings\.json is not a JSON object/, `settings ${settings}`);
      assert.doesNotMatch(out, /stop guard not declared/, `settings ${settings}: not an absent guard`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
