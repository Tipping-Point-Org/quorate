// preflight.mjs held the contract's version as new-run does (G-13 of 20261124-040316-m3s9-remediation-4-review-b):
// it parsed graph_contract itself and never asked contractVersionGap, so a contract new-run refuses as ahead or
// invalid could still reach `preflight --run`, which executes the contract's declared commands. And the CENSUS the
// operator chose ("Remediation 5 with a census test (Recommended)"): every script that parses a contract in process,
// rather than through io/contract-reader.mjs (which spawns new-run --print-contract, the version's owner), holds it to
// the same version decision, or is named below with why it need not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, runScript, withTempDir } from './helpers.mjs';

const contractWith = (version) =>
  `# t\n\n\`\`\`yaml\ngraph_contract_version: ${version}\nproject: t\ncommands:\n  build: ""\n  test: ""\n\`\`\`\n`;

for (const [label, version, why] of [['ahead', 999, /newer|ahead|999/i], ['invalid', '"six"', /invalid|not a|six/i]]) {
  test(`preflight refuses a contract whose version is ${label}, as new-run does`, () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), contractWith(version));
      const home = path.join(dir, '.home');
      const r = runScript('preflight.mjs', ['--repo-root', dir], { cwd: dir, env: { QUORATE_HOME: home } });
      assert.equal(r.status, 2, `an ${label} contract must be a configuration error (exit 2), got ${r.status}:\n${r.output.slice(-600)}`);
      assert.match(r.output, why, `the refusal must say the version is ${label}:\n${r.output.slice(-600)}`);
    });
  });
}

// THE CENSUS. A script that parses a contract block in process (parseContractYaml) owns its own admission; each such
// site must ask contractVersionGap, or be named here with why its parse admits nothing to run.
const NOT_ADMISSION = {
  'scripts/lib/contract-yaml.mjs': 'the parser itself',
  'scripts/lib/compatibility.mjs': 'reads the template and doc fragments for their key sets; it runs nothing they declare',
  'scripts/publish.mjs': 'compares the keys of the private and public contracts; it runs nothing either declares',
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('every in-process contract parse under scripts/ asks the version decision', () => {
  const parsers = [];
  for (const abs of walk(path.join(REPO_ROOT, 'scripts'))) {
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    const src = fs.readFileSync(abs, 'utf8');
    if (!/\bparseContractYaml\s*\(/.test(src)) continue;
    parsers.push(rel);
    if (NOT_ADMISSION[rel]) continue;
    assert.ok(/\bcontractVersionGap\s*\(/.test(src),
      `${rel} parses a contract in process and never asks contractVersionGap: an ahead or invalid contract new-run `
      + 'refuses is admitted here (G-13 of 20261124-040316-m3s9-remediation-4-review-b)');
  }
  assert.ok(parsers.includes('scripts/preflight.mjs'), 'the census must see preflight.mjs, the site it was written for');
  for (const rel of Object.keys(NOT_ADMISSION)) {
    assert.ok(parsers.includes(rel), `${rel} is exempted but no longer parses a contract: drop it from NOT_ADMISSION`);
  }
});
