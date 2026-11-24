// THE DELIVERY REVIEW OF remediate-rebuild (20261008-214527-remediate-rebuild-review, gate FAIL): the findings that are
// pinned as units here; the runner-level ones are in regression-remediate-runner*.test.mjs.
//   G-4 (HIGH): the remediator could edit the code that confines it — the framework's own scripts (capture.mjs,
//     remediate.mjs and everything they import), the hooks, the run directories. Edits are now denied on the
//     framework's directory, hooks, .git, settings, the reviews directory and generated_globs; and a remediation of the
//     framework's OWN tree must be minted by a different checkout (the pinned install), never by the tree being fixed.
//   G-20: every stamp the remediation path emits has its consequence in stamp-consequences.json.
//   G-23: a declared command captured in a remediation run does not receive the runtime's auth variables.
//   G-12, G-18: run.json is written atomically; the frozen runtime is forwarded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, runScript } from './helpers.mjs';
import { editDenyPaths } from '../scripts/lib/capabilities.mjs';
import { commandEnvFor, commitEnvFor } from '../scripts/lib/decisions.mjs';

test('G-4: edits are denied on the framework, hooks, git, settings, the reviews directory and generated globs', () => {
  const consumer = editDenyPaths({ frameworkRel: '.claude/skills/quorate', reviewsRel: '.claude/reviews', generatedGlobs: ['dist/**'] });
  for (const p of ['.claude/skills/quorate/**', '.claude/hooks/**', '.git/**', '.claude/settings.json', '.claude/settings.local.json',
    '.claude/reviews/**', 'dist/**']) {
    assert.ok(consumer.includes(p), `${p} is denied: ${consumer}`);
  }
  const outside = editDenyPaths({ frameworkRel: '../engine', reviewsRel: '../home/reviews', generatedGlobs: [] });
  assert.ok(!outside.some((p) => p.startsWith('..')), 'a path outside the repository needs no rule and gets none');
});

test('G-4: new-run refuses to mint a remediation of the framework\'s own tree from that tree', () => {
  const r = runScript('new-run.mjs', ['--repo-root', REPO_ROOT, '--slug', 'self-fix', '--remediates', path.join(REPO_ROOT, 'no-such-run'), '--no-verify-reviewers']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /different checkout/);
});

test('G-20: every stamp the remediation path emits has a consequence', () => {
  const table = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'stamp-consequences.json'), 'utf8'));
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  const emitted = [...new Set([...src.matchAll(/stamps\.add\('([A-Z-]+)'\)/g)].map((m) => m[1]))];
  assert.ok(emitted.length >= 5, `found ${emitted}`);
  for (const s of emitted) assert.equal(typeof table[s], 'string', `${s} has no consequence sentence`);
});

test('G-23: a remediation run\'s captured command loses the runtime\'s auth variables; a review\'s keeps its environment', () => {
  const env = { PATH: 'p', CLAUDE_CODE_OAUTH_TOKEN: 't', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 'a', QUORATE_RUN_ID: 'r', MY_APP_KEY: 'm' };
  const rem = commandEnvFor(env, { remediation: true });
  for (const k of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'QUORATE_RUN_ID']) assert.ok(!(k in rem), k);
  assert.equal(rem.MY_APP_KEY, 'm', 'the project\'s own variables are its business');
  const lens = commandEnvFor(env, { remediation: false });
  assert.equal(lens.CLAUDE_CODE_OAUTH_TOKEN, 't');
  assert.ok(!('QUORATE_RUN_ID' in lens));
});

// G-3 of 20261014-143305-ccb-remediation-review: the names were deleted by exact uppercase spelling, and Windows keeps a
// variable's stored case (`Anthropic_Api_Key`) while every child reads it case-insensitively. Folded on every platform:
// removing a case variant of the runtime's auth from code the remediator wrote costs nothing anywhere.
test('G-3: a case variant of the runtime\'s auth or the run pin is removed too', () => {
  const env = { PATH: 'p', Anthropic_Api_Key: 'k', anthropic_auth_token: 'a', Claude_Code_OAuth_Token: 't', Quorate_Run_Id: 'r', MY_APP_KEY: 'm' };
  const rem = commandEnvFor(env, { remediation: true });
  for (const k of ['Anthropic_Api_Key', 'anthropic_auth_token', 'Claude_Code_OAuth_Token', 'Quorate_Run_Id']) assert.ok(!(k in rem), k);
  assert.equal(rem.MY_APP_KEY, 'm');
  const lens = commandEnvFor(env, { remediation: false });
  assert.equal(lens.Anthropic_Api_Key, 'k', 'a review\'s command keeps its environment');
  assert.ok(!('Quorate_Run_Id' in lens), 'the run pin never crosses');
  const commit = commitEnvFor({ PATH: 'p', Quorate_Run_Id: 'r' });
  assert.ok(!('Quorate_Run_Id' in commit), 'nor into a commit\'s hooks');
});

test('G-12, G-18: the runner writes run.json atomically and forwards the frozen runtime', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  // Atomic through the owner of the directory written since run-dir-descendants.plan.md stage 2 (writeJsonAtomic before).
  // Through patchRunJson since G-11 of 20261124-180917-gsw-remediation-4-review-b, whose write is the owner's replace.
  assert.match(src, /const saveRun = \(patch, dir = runDir\) => patchRunJson\(dir === runDir \? owner : confined\(dir\), patch\b/);
  const lib = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'reviews-root.mjs'), 'utf8');
  const patcher = lib.slice(lib.indexOf('export function patchRunJson('), lib.indexOf('export function admitRun('));
  assert.match(patcher, /owner\.replace\(\['run\.json'\]/, 'patchRunJson writes run.json through the owner\'s atomic replace');
  assert.doesNotMatch(src, /fs\.writeFileSync\([^)]*run\.json/);
  // The frozen runtime, chosen by the one owner since contract-runtime-and-session-files.plan.md stage 1 and always passed.
  assert.match(src, /'--runtime', nodeRuntime\(\)/);
  assert.match(src, /selectAdapters\(\{ contract \}\)\.runtime/);
});

// ------------------------------------------------- round 1's review, 20261008-221517-remediate-rebuild-r2
import { walkChain } from '../scripts/lib/remediation-chain.mjs';

// G-15 (r2)'s parser test moved with the parser: statusEntriesV2, tests/regression-remediation-paths.test.mjs (stage 2).

test('G-4 (r2): a cycle in the chain is unknown, not a complete chain', () => {
  const byId = {
    V1: { run_id: 'V1', follows_remediation: { run_id: 'R1', run_dir: 'R1' } },
    R1: { run_id: 'R1', remediates: 'V1', remediation_frame: { run_id: 'V1', run_dir: 'V1' } },
  };
  const { unknown } = walkChain({ reviewedDir: 'V1', readRun: (d) => byId[d], ownMedium: () => false });
  assert.match(unknown ?? '', /cycle/);
});

test('G-25 (r2): the doctrine states the captured-command environment as it is', () => {
  const d = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8').replace(/\s+/g, ' ');
  assert.doesNotMatch(d, /with no `env` override/);
  assert.match(d, /commandEnvFor/);
});

test('G-26 (r2): the remediation that reached the cap has its own stamp, and each says what it means', () => {
  const table = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'stamp-consequences.json'), 'utf8'));
  assert.equal(typeof table['ROUND-CAP-REACHED'], 'string');
  assert.doesNotMatch(table['ROUND-CAP-REACHED'], /nothing was spawned/i);
  const d = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8');
  assert.match(d, /\| `ROUND-CAP-REACHED` \|/);
});
