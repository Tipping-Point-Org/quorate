// A KEY WHOSE MEANING CHANGED UNDER AN UNCHANGED SPELLING WAS UNDETECTABLE, AND IT HAPPENED ONCE.
//
// CLAUDE.md and QUORATE.md both record it, in the same words:
//
//   "`budget_usd_per_node: ""` once meant `Number("") === 0`, a $0 cap that blocked every node; it
//    now means uncapped. Same text, opposite behaviour, no signal. Nothing on the consumer side
//    records which version was installed, so staleness is currently undetectable rather than merely
//    unhandled."
//
// `check-install` compares key PRESENCE and says so. The contract-key ratchet catches a key ADDED
// and forgotten somewhere. Neither can see a key that is spelled identically in every file and means
// something new — the consumer's contract is byte-identical before and after the upgrade.
//
// The number to hang this on already existed and was inert as a signal: new-run did
// `if (contract.graph_contract !== 1) die(...)`, a strict equality against a literal. Equality cannot
// say "you are behind and here is what moved", which is the only message that helps.
//
// These tests pin the MECHANISM at version 1 rather than waiting for a real bump to exercise it —
// a feature that only runs on some future edit is the inert-feature class this repository keeps
// shipping (G-63 this same day: a stamp promised by three documents and read by nothing).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, withTempDir, runScript } from './helpers.mjs';
import {
  CONTRACT_VERSION, CONTRACT_CHANGES, contractVersionGap, contractVersionMessage,
  declaredContractVersion, CONTRACT_BLOCK_RE, CONTRACT_VERSION_KEYS,
} from '../scripts/lib/contract-version.mjs';

test('a contract at the engine version is current and says nothing', () => {
  const gap = contractVersionGap(CONTRACT_VERSION);
  assert.equal(gap.state, 'current');
  assert.equal(contractVersionMessage(gap), null, 'no news is the only case that stays silent');
});

test('a contract BEHIND the engine names the keys whose meaning moved', () => {
  // Synthetic versions, so the mechanism is exercised now rather than on some future bump.
  const gap = contractVersionGap(1, 3);
  assert.equal(gap.state, 'behind');
  assert.equal(gap.changes.length, 2, 'every version above the declared one, up to the engine');
  assert.deepEqual(gap.changes.map((c) => c.version), [2, 3]);
  const msg = contractVersionMessage(gap);
  // No key supplied, so the message reaches for the PREFERRED spelling; the test below covers the
  // case where a consumer used the old one and must be quoted their own file.
  assert.match(msg, /graph_contract_version: 1/, 'it must quote the version the consumer declared');
  assert.match(msg, /set graph_contract_version: 3/, 'and name the one edit that records the read');
});

test('a version with no changelog entry is reported, not skipped', () => {
  // A version ABOVE anything the changelog records, so this keeps testing the unlogged case as real
  // entries are added. Pinned at 2 once, and the first real bump made it collide with v2's own entry.
  const gap = contractVersionGap(CONTRACT_VERSION, CONTRACT_VERSION + 1);
  assert.equal(gap.changes.length, 1);
  assert.match(gap.changes[0].what, /no changelog entry/,
    'omitting an unlogged version would make "nobody wrote it down" look identical to "nothing '
    + 'changed here" — the more dangerous of the two readings');
});

test('a contract from a NEWER engine is fatal, not a warning', () => {
  const gap = contractVersionGap(9, 1);
  assert.equal(gap.state, 'ahead');
  assert.match(contractVersionMessage(gap), /upgrade the submodule rather than lowering the number/,
    'a contract written for a newer engine may rely on meanings this one does not have, and '
    + 'guessing is exactly how the $0-cap flip became a behaviour change nobody saw');
});

test('a non-integer or zero version is invalid rather than silently coerced', () => {
  for (const bad of ['1', 0, -1, null, undefined, 1.5, NaN]) {
    assert.equal(contractVersionGap(bad).state, 'invalid', `${JSON.stringify(bad)} must not pass`);
  }
});

// THE RATCHET ON THE RATCHET. A bump with no changelog is the same silence one level up.
test('every version above 1 has a changelog entry', () => {
  const missing = [];
  for (let v = 2; v <= CONTRACT_VERSION; v += 1) if (!CONTRACT_CHANGES[v]) missing.push(v);
  assert.deepEqual(missing, [],
    'bumping CONTRACT_VERSION without recording what moved leaves a consumer told they are behind '
    + 'and not told what changed, which is worse than not telling them at all');
  for (const [v, entry] of Object.entries(CONTRACT_CHANGES)) {
    assert.ok(Number(v) <= CONTRACT_VERSION, `changelog names v${v}, past the engine's ${CONTRACT_VERSION}`);
    assert.ok(Array.isArray(entry.keys) && entry.keys.length > 0, `v${v} names no key`);
    assert.ok(typeof entry.what === 'string' && entry.what.length > 20, `v${v} does not say what moved`);
  }
});

// WIRED, not merely written. The lesson of G-63, the same day: a decision nothing calls is inert,
// and a test that greps for a name is satisfied by a comment.
test('new-run derives the version check from the shared decision, not a literal', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  assert.match(src, /contractVersionGap\(/,
    'new-run must ask the shared decision. `if (contract.graph_contract !== 1)` cannot express '
    + '"behind", which is the only state worth reporting.');
  assert.ok(!/graph_contract !== 1/.test(src),
    'the hardcoded equality must be gone, or two owners decide what a version means');
});

// END TO END, because a decision that is only unit-tested is a decision nothing calls.
//
// This file once said `behind` was unreachable end to end until the repository bumped to 2, since 1
// was the lowest valid value — and named that as a gap rather than papering over it. THE BUMP HAS
// HAPPENED (v2 moved `review.reviews_dir` out of the reviewed tree), so all three states are now
// exercised against the real script and the gap is closed rather than merely acknowledged.
test('a contract BEHIND the engine mints, stamps CONTRACT-STALE, and names the keys', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n```\n');
    const r = runScript('new-run.mjs',
      ['--slug', 'stale', '--no-verify-sandbox', '--no-request', '--full-sweep', '.'], { cwd: dir });
    assert.equal(r.status, 0, `behind must PROCEED, not refuse:\n${r.output.slice(-400)}`);
    assert.match(`${r.output}`, /CONTRACT-STALE/,
      'the run must carry the stamp, or a reader cannot tell it ran under semantics nobody confirmed');
    assert.match(`${r.output}`, /review\.reviews_dir/,
      'and it must name the key whose MEANING moved — "you are behind" without the key is not actionable');
  });
});

test('new-run refuses a contract from a newer engine, end to end', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      `# t\n\n\`\`\`yaml\ngraph_contract: ${CONTRACT_VERSION + 1}\nproject: t\n\`\`\`\n`);
    const r = runScript('new-run.mjs', ['--print-contract'], { cwd: dir });
    assert.notEqual(r.status, 0, 'a contract written for a newer engine must not mint a run');
    assert.match(`${r.stderr}`, /upgrade the submodule rather than lowering the number/,
      'and the operator must be told which direction fixes it — lowering the number would silently '
      + 'accept semantics this engine does not implement');
  });
});

test('new-run refuses a version that is not a positive integer, end to end', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\ngraph_contract: 0\nproject: t\n```\n');
    const r = runScript('new-run.mjs', ['--print-contract'], { cwd: dir });
    assert.notEqual(r.status, 0);
    assert.match(`${r.stderr}`, /graph_contract_version must be a positive integer/);
  });
});

test('this repository declares the version its own engine implements', () => {
  const md = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const m = md.match(/^graph_contract_version:\s*(\d+)/m);
  assert.ok(m, 'CLAUDE.md declares no graph_contract_version');
  assert.equal(Number(m[1]), CONTRACT_VERSION,
    'the framework repository must sit at its own version, or it never exercises the current path');
  const tpl = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.template.md'), 'utf8');
  const t = tpl.match(/^graph_contract_version:\s*(\d+)/m);
  assert.ok(t, 'the template declares no graph_contract_version');
  assert.equal(Number(t[1]), CONTRACT_VERSION,
    'a consumer copying the template must start CURRENT, not one version behind on day one');
});

// THE KEY WAS RENAMED, AND EVERY CONTRACT IN THE WORLD STILL SPELLS IT THE OLD WAY.
//
// `graph_contract: 2` named the block AND versioned it with one word -- it reads as "this is a
// graph-contract block", not "version N of the contract". `graph_contract_version` says what it is.
//
// A rename that REFUSED the old spelling would turn an engine upgrade into a breaking change for a
// cosmetic reason, so both are accepted. The dangerous half is the other direction: the block is
// FOUND by this key, and the original regex `/^graph_contracts*:/m` does not match
// `graph_contract_version:` -- a renamed contract would have been invisible, reported as "no
// contract in this repository" rather than as one using the new name.
test('both spellings are accepted, and the new one wins when a file carries both', () => {
  assert.equal(declaredContractVersion({ graph_contract: 1 }).value, 1);
  assert.equal(declaredContractVersion({ graph_contract: 1 }).deprecated, true);
  assert.equal(declaredContractVersion({ graph_contract_version: 3 }).deprecated, false);

  // A migration in progress: the new key was added and the old one not yet deleted.
  const both = declaredContractVersion({ graph_contract_version: 3, graph_contract: 1 });
  assert.equal(both.value, 3, "the new spelling must win, or a half-done rename silently reads stale");
  assert.equal(both.key, 'graph_contract_version');
});

test('a contract declaring only the NEW key is still found', () => {
  assert.ok(CONTRACT_BLOCK_RE.test('graph_contract_version: 3\nproject: t'),
    'the block is located by this key; a renamed contract that cannot be found reads as no contract '
    + 'at all, which is a far worse failure than a deprecation notice');
  assert.ok(CONTRACT_BLOCK_RE.test('graph_contract: 1\nproject: t'),
    'and the old spelling still finds it');
  assert.ok(!CONTRACT_BLOCK_RE.test("  graph_contract: 1"), "top-level only -- an indented key is a value inside something else");
});

test('the message quotes the spelling the consumer actually used', () => {
  const oldWay = contractVersionMessage(contractVersionGap(1, 3, "graph_contract"));
  assert.match(oldWay, /declares graph_contract: 1/,
    'telling someone their graph_contract_version is wrong when they wrote graph_contract sends them '
    + 'looking for a line that is not in their file');
  assert.match(oldWay, /set graph_contract_version: 3/, "and the fix names the key they should end up with");
});

test('the preferred spelling is first, because that is what every message reaches for', () => {
  assert.equal(CONTRACT_VERSION_KEYS[0], 'graph_contract_version');
  assert.ok(CONTRACT_VERSION_KEYS.includes('graph_contract'), 'and the old one is still accepted');
});
