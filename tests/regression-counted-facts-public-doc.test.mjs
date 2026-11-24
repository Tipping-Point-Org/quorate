// G-1 of 20261124-140633-gsw-remediation-review-b: publish/CLAUDE.public.md, the CLAUDE.md the public mirror ships,
// states the test count and says it "is verified against the tree on every push — see scripts/check-counted-facts.mjs",
// but that script read only CLAUDE.md, QUORATE.md and README.md, so the public copy could go stale while the check it
// cites passed. It is now one more document of the set, held to agree with the others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-1: a public CLAUDE.md stating another test count than CLAUDE.md fails check-counted-facts, by its name', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qcf-public-'));
  try {
    fs.mkdirSync(path.join(d, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts', 'check-counted-facts.mjs'), path.join(d, 'scripts', 'check-counted-facts.mjs'));
    for (const f of ['argv.mjs', 'argv-specs.mjs', 'counted-facts.mjs']) {
      fs.copyFileSync(path.join(ROOT, 'scripts', 'lib', f), path.join(d, 'scripts', 'lib', f));
    }
    fs.writeFileSync(path.join(d, 'CLAUDE.md'), '| `tests/` | 12 regression tests. |\n');
    fs.mkdirSync(path.join(d, 'publish'));
    fs.writeFileSync(path.join(d, 'publish', 'CLAUDE.public.md'), '| `tests/` | 13 regression tests. |\n');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, [path.join(d, 'scripts', 'check-counted-facts.mjs'), '--tests-count', '12'],
      { cwd: d, encoding: 'utf8', env });
    assert.equal(r.status, 1, `exit ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /CLAUDE\.public\.md says 13\b/, `the public copy was not read:\n${r.stderr}`);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
