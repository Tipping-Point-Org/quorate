// THE UPGRADE PATH FROM 0.x IS WHAT check-install SAYS, AND THE RELEASE NOTES SAY THE SAME (m3-v1.plan.md stage 4, I6).
//
// A consumer upgrading reads two things: the CHANGELOG's "What a consumer coming from 0.3.x must change" list and
// check-install's report. Nothing compared them, and check-install could not see half of what an upgrade asks: a key
// the project carries that quorate no longer reads (the old top-level `os` and `shell`) was ignored with no signal.
// Here check-install runs on a project whose contract is 0.3.1's template, frozen in tests/fixtures/consumer-0.3.1, and
// the keys its `upgrade:` line names must be exactly the keys the newest CHANGELOG entry's list names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript } from './helpers.mjs';
import { undocumentedKeys, upgradeLine, upgradeNames, documentedContractKeys } from '../scripts/lib/compatibility.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\r\n').join('\n');
const FIXTURE = 'tests/fixtures/consumer-0.3.1/contract-0.3.1.md';

function checkInstallOn(contractText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-upgrade-'));
  try {
    spawnSync('git', ['init', '-q', '.'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), contractText);
    return runScript('check-install.mjs', ['--repo-root', dir], { cwd: dir }).output;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The keys the newest CHANGELOG entry's "must change" list names: the first backticked name of each item. */
function changelogMustChange() {
  const text = read('CHANGELOG.md');
  const entry = text.slice(text.indexOf('\n## ')).split(/\n## /)[1];
  const at = entry.indexOf('### What a consumer coming from 0.3.x must change');
  assert.notEqual(at, -1, 'the newest CHANGELOG entry has no "What a consumer coming from 0.3.x must change" list');
  const body = entry.slice(at).split('\n### ')[0].split('\n').slice(1).join('\n').trim();
  const items = body.split('\n').filter((l) => l.startsWith('- '));
  if (!items.length) {
    assert.match(body, /^Nothing\./, 'a list with no items must say "Nothing."');
    return [];
  }
  return items.map((l) => /`([^`]+)`/.exec(l)?.[1] ?? `(no backticked key: ${l})`).sort();
}

test('check-install on a 0.3.1 consumer names exactly the contract changes the 1.0 release notes list', () => {
  const out = checkInstallOn(read(FIXTURE));
  const line = out.split('\n').find((l) => l.trim().startsWith('upgrade:'));
  assert.ok(line, `check-install printed no upgrade: line\n${out.slice(-1500)}`);
  assert.deepEqual(upgradeNames(line.trim()).sort(), changelogMustChange(),
    'check-install and the CHANGELOG disagree about what a 0.3.x consumer must change');
});

test('a key quorate no longer documents is named, as stale and on the upgrade line', () => {
  const out = checkInstallOn(read(FIXTURE).replace(/^project: .*$/m, 'project: t\nos: windows'));
  assert.match(out, /STALE: contract carries 1 key\(s\) this quorate does not document/);
  assert.deepEqual(upgradeNames(out.split('\n').find((l) => l.includes('upgrade:')).trim()), ['os']);
});

test('the fixture is the 0.3.1 template, not today\'s: it has its own contract block', () => {
  assert.match(read(FIXTURE), /^graph_contract_version: 6$/m);
});

test('undocumentedKeys: a removed key is named, an accepted spelling and a reviewer\'s own field are not', () => {
  const documented = documentedContractKeys({ docText: '', templateText: '```yaml\ngraph_contract_version: 6\nreview:\n  concurrency: 1\n```\n' });
  assert.deepEqual(undocumentedKeys({
    graph_contract: 6, os: 'windows', review: { concurrency: 1, concurency: 2 }, reviewers: { x: { model: 'm' } },
  }, documented), ['os', 'review.concurency', 'reviewers', 'reviewers.*']);
  assert.equal(upgradeLine([]), 'upgrade: nothing to change in the contract');
  assert.deepEqual(upgradeNames(upgradeLine([{ name: 'a.b', why: 'x; y (z)' }, { name: 'c', why: 'z' }])), ['a.b', 'c'],
    'a reason with a semicolon in it split one item in two');
});
