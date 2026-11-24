// G-7 of 20261124-030759-m3s9-remediation-3-review-b: the session hooks' in-process contract reader returned whatever
// parsed, with no graph_contract_version check, while the engine's reader (new-run --print-contract) refuses a contract
// that is ahead of this engine or declares no valid version. The CLI freshness refresh reads through it and runs the
// adapter commands it finds, so a contract the engine refuses still chose which commands ran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessionContract } from '../scripts/io/session-contract.mjs';
import { CONTRACT_VERSION } from '../scripts/lib/contract-version.mjs';

const withRepo = (version, fn) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-'));
  try {
    const head = version === undefined ? '' : `graph_contract_version: ${version}\n`;
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# t\n\n\`\`\`yaml\n${head}project: t\nreviewers:\n  codex:\n    cmd: /opt/other-codex\nreview:\n  decision_panel: off\n\`\`\`\n`);
    return fn(repo);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
};

test('G-7: a contract ahead of this engine is refused, as the engine\'s reader refuses it', () => withRepo(CONTRACT_VERSION + 1, (repo) => {
  const r = sessionContract(repo);
  assert.equal(r.contract, null, 'an ahead contract was returned for the hooks to act on');
  assert.match(String(r.unreadable), /newer engine|implements/);
}));

test('G-7: a contract with no valid version is refused', () => withRepo('"six"', (repo) => {
  const r = sessionContract(repo);
  assert.equal(r.contract, null, 'a contract with an invalid version was returned');
  assert.match(String(r.unreadable), /positive integer/);
}));

test('G-7: a current contract is still read', () => withRepo(CONTRACT_VERSION, (repo) => {
  const r = sessionContract(repo);
  assert.equal(r.unreadable, undefined);
  assert.equal(r.contract?.project, 't');
}));
