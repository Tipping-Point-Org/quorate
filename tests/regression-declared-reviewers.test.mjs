// `reviewers:` in the graph_contract — a promise the code did not keep.
//
// lib/reviewers.mjs has said this since it was written: "A CONSUMER may extend the table without
// touching the engine: `reviewers:` in the graph_contract adds entries or overrides fields on a
// built-in one, and the merged result is what a run records." The merge function existed, was
// exported, and was tested. NOTHING READ THE KEY.
//
// So the one question the adapter table exists to answer — can I use a different vendor — still
// ended at "fork quorate and edit scripts/reviewers.json", which CLAUDE.md separately forbids: a
// mounted submodule's edits exist in no branch, are carried by no push, and are discarded the next
// time the pointer moves. The capability was real, documented, and reachable by no caller.
//
// Two smaller promises failed with it, and both are pinned below:
//   * `adapterErrors` says it is "checked at MINT, before anything spawns" — it was checked inside
//     external-review, at the moment an arm was about to transmit;
//   * check-panel's own comment says the probe "must cover whatever vendors the engine can actually
//     spawn, or a newly declared reviewer ships unprobed while this script reports a clean
//     transport" — and it read the built-in table only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript, REPO_ROOT, repoRunDir } from './helpers.mjs';
import { builtinReviewers, mergeReviewers, adapterErrors, declaredReviewers } from '../scripts/io/reviewers.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

const GROK = {
  cmd: 'grok',
  args: ['review', '--json'],
  // EXACT names, not a prefix: a contract may not declare prefixes (G-12 of 20260925-015614-platform-review).
  env_names: ['GROK_API_KEY'],
  prompt: { via: 'stdin' },
  response: { from: 'stdout-wrapper', field: 'answer' },
};

function withContract(contract, fn) {
  const { base, dir } = repoRunDir({ runId: '20260101-000000-declrev', json: { contract } });
  try {
    fs.writeFileSync(path.join(dir, 'p.md'), 'review this');
    return fn(dir);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('regression: a vendor declared only in the contract is accepted by external-review', () => {
  // THE DEFECT, end to end. Before this, `--reviewer grok` died with "must be one of
  // codex|agy|codex-review" no matter what the contract said.
  const r = withContract({ reviewers: { grok: GROK }, review: { external_panel: false } }, (dir) =>
    runScript('external-review.mjs', [
      '--reviewer', 'grok', '--prompt-file', path.join(dir, 'p.md'), '--run-dir', dir,
    ]));
  assert.equal(r.status, 0, 'external-review always exits 0 and answers with an envelope');
  const env = JSON.parse(r.stdout);
  assert.equal(env.source, 'grok', 'the declared vendor is the source of record');
  // Refused on CONSENT, which is the correct next gate — the fixture leaves the panel off. What
  // matters is that it got that far: an unknown reviewer never reaches the consent question.
  assert.match(env.egress_basis, /external_panel is not true/,
    'a declared adapter is resolved, then held to the same egress rule as a built-in one');
});

test('regression: an unknown reviewer is still refused, and the message says where to declare one', () => {
  const r = withContract({}, (dir) => runScript('external-review.mjs', [
    '--reviewer', 'nosuchvendor', '--prompt-file', path.join(dir, 'p.md'), '--run-dir', dir,
  ]));
  assert.equal(r.status, 2);
  assert.match(r.output, /must be one of/);
  assert.match(r.output, /reviewers:/, 'the refusal must point at the key that would fix it');
});

test('regression: the declared table is the RUN\'s, frozen at mint', () => {
  // Same rule as egress consent (G-8/G-11): how a vendor is invoked is part of what a run WAS. If
  // this re-read the live contract, an edit mid-run could change a reviewer's argv, model or
  // credential prefixes, and the artifacts would describe a contract nobody can reconstruct.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  // ASKED OF THE OWNER, BY RUNNING IT. This read the local `function declaredReviewers` out of
  // external-review's source — and that copy is gone. It existed TWICE, in external-review and
  // check-panel, with different fallback behaviour, while two other call sites read neither. The rule
  // is behaviour now, exercised directly.
  assert.match(src, /declaredReviewers\(\{/, 'the table comes from the one owner');
  // With a run, the frozen copy is preferred, and read from the record admission returned (run-dir-descendants.plan.md
  // stage 3, G-9): never from run.json through the caller's spelling.
  assert.match(code, /earlyAdmission\.record\?\.contract\?\.reviewers/, 'the frozen copy is preferred when there is a run');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-frozen-'));
  try {
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
      run_id: 'r', contract: { reviewers: { frozencli: { cmd: 'frozencli' } } },
    }));
    assert.deepEqual(declaredReviewers({ run: confined(dir) }), { frozencli: { cmd: 'frozencli' } },
      'inside a run the declarations are the ones that run froze');
    // And with a run present it must not fall through to the live contract, even when one is offered.
    let spawned = false;
    declaredReviewers({ run: confined(dir), readContract: () => { spawned = true; return { error: 'x' }; } });
    assert.equal(spawned, false, 'a run that froze its contract does not re-read the live one');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('regression: a broken declared adapter fails at MINT, not at transmit time', () => {
  // The promise adapterErrors makes about itself. A stdout-wrapper with no `field` is the sharp
  // case: agy's wrapper carries its own transport `status` beside the reviewer's answer, so reading
  // the wrong key reports a refusal as a success.
  const { base, dir } = repoRunDir({ runId: '20260101-000000-badadapter' });
  try {
    const rulesDir = path.join(dir, 'tree', '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tree', 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract: 1\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
      + 'reviewers:\n  broken:\n    cmd: "b"\n    response: { from: stdout-wrapper }\n```\n');
    const r = runScript('new-run.mjs', ['--repo-root', path.join(dir, 'tree'), '--dry-run']);
    assert.notEqual(r.status, 0, 'an unusable adapter must stop the mint');
    assert.match(r.output, /cannot be used/);
    assert.match(r.output, /response\.field/, 'and name the field that is missing');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('regression: check-reviewers probes declared reviewers, not just built-in ones', () => {
  // check-panel's comment, the rule check-reviewers inherited when it replaced it (reviewer-preflight stage 4): "the
  // probe must cover whatever vendors the engine can actually spawn, or a newly declared reviewer ships unprobed while
  // this script reports a clean transport."
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'check-reviewers.mjs'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  // The declarations are read by the owner and merged over the built-ins — inline, or through a named table (G-1 of
  // 20261009-232840 names it DECLARED, because the command also checks each declared reviewer by name).
  assert.match(code, /declaredReviewers\(\{/, 'the declarations come from the shared owner');
  // Merged by the one owner since contract-runtime-and-session-files.plan.md stage 1.
  assert.match(code, /selectAdapters\(\{ declared: DECLARED \}\)/,
    'a probe that covers only the built-ins reports a clean transport it did not test');

  // AND SO MUST THE OTHER TWO PROBES. This test pinned check-panel alone, so `check-tiebreak` and
  // `bench-lenses` kept `mergeReviewers(builtinReviewers(), {})` — and a consumer-declared adapter
  // used as an adjudicator was then REFUSED by the probe ("not in the adapter table") while the real
  // run accepted it. Same defect as this one, in the siblings, for as long as the guard named one file.
  // (check-tiebreak was the third, retired with check-panel in stage 4.)
  for (const f of ['bench-lenses']) {
    const other = fs.readFileSync(path.join(REPO_ROOT, 'scripts', `${f}.mjs`), 'utf8');
    assert.ok(!/mergeReviewers\(builtinReviewers\(\), \{\}\)/.test(other),
      `${f} reports on a table the run does not use`);
    // Through its one read at the framework root (bench-contract-root D3): benchContract, whose adapters come from the
    // owner, lib/reviewers' reviewersFromOutcome.
    assert.match(other, /benchContract\(readContract\(/, `${f} must read the consumer's declarations too`);
  }
});

test('merging overrides one field and keeps the rest', () => {
  const merged = mergeReviewers(builtinReviewers(), { codex: { model: 'something-else' } });
  assert.equal(merged.codex.model, 'something-else', 'the declared field wins');
  assert.deepEqual(merged.codex.env_prefixes, builtinReviewers().codex.env_prefixes,
    'and everything not declared is inherited — an override is not a replacement');
  assert.deepEqual(adapterErrors('codex', merged.codex), [], 'an overridden built-in stays usable');
});

test('a declared vendor receives only its own credentials', () => {
  // The credential boundary must extend to declared vendors, or "bring your own adapter" becomes a
  // way to receive another vendor's keys.
  const merged = mergeReviewers(builtinReviewers(), { grok: GROK });
  // Its OWN credentials are now the exact variables it names — and no prefix at all, so it cannot
  // be handed a neighbour that happens to share one (G-12).
  assert.deepEqual(merged.grok.env_names, ['GROK_API_KEY']);
  assert.equal(merged.grok.env_prefixes, undefined);
  assert.deepEqual(adapterErrors('grok', merged.grok), [], 'the fixture adapter is well-formed');
});
