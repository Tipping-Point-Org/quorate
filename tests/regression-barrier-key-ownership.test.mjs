// A contract command key that NO ONE executes is invisible, and the omission reads as an oversight.
//
// Raised by a codex arm reviewing the story-pipeline fixture, about the real gap it points at: "the
// barrier records no entry for `run` at all... a declared run command that cannot start is caught by
// nothing until feature-verify tries it". Excluding `run` from the barrier is correct -- it launches
// the product, which may be a server that never exits -- but the CHECKS list simply omitted it, so a
// reader could not tell that decision from a forgotten key.
//
// This holds the two lists against each other. Every key a node may execute is either run by the
// barrier or carries a written owner; a key added to the contract cannot become unexercised by both
// without someone stating who owns it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { EXECUTABLE_COMMAND_KEYS } from '../scripts/lib/decisions.mjs';
import { PREFLIGHT_COMMAND_KEYS } from '../scripts/lib/preflight-cache.mjs';

const SRC = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-checks.mjs'), 'utf8');

/** The keys as the file actually declares them, not as a second copy of the list. */
function declared(name) {
  const block = SRC.slice(SRC.indexOf(`const ${name} =`));
  const end = block.indexOf('\n];') >= 0 && (name === 'CHECKS')
    ? block.indexOf('\n];') : block.indexOf('\n});');
  return [...block.slice(0, end).matchAll(/^\s*(?:\{\s*key:\s*)?'?([a-z_]+)'?[:,]/gm)].map((m) => m[1]);
}

test('every executable contract key is run by the barrier or has a named owner', () => {
  // The barrier runs PREFLIGHT_COMMAND_KEYS: run-checks builds CHECKS from it since G-13 of
  // 20260925-200721-platform-remediated, which regression-m0-gate-remediation holds. There is no literal left to parse.
  assert.match(SRC, /const CHECKS = PREFLIGHT_COMMAND_KEYS\.map\(/, 'run-checks no longer builds CHECKS from the one list');
  const atBarrier = [...PREFLIGHT_COMMAND_KEYS];
  const elsewhere = declared('NOT_AT_THE_BARRIER');
  assert.ok(atBarrier.includes('build'), 'sanity: the list parsed');
  assert.ok(elsewhere.includes('run'), 'sanity: the exclusions parsed');

  for (const key of EXECUTABLE_COMMAND_KEYS) {
    const owned = atBarrier.includes(key) || elsewhere.includes(key);
    assert.ok(owned,
      `commands.${key} is executable but neither runs at the barrier nor names an owner -- `
      + 'a key nobody exercises and nobody accounts for is exactly the shape that was found');
  }
  // And the two sets are disjoint: a key claimed by both is two owners, which is how they drift.
  for (const key of elsewhere) {
    assert.ok(!atBarrier.includes(key), `${key} cannot be both run here and delegated`);
  }
});

test("`run` is excluded on purpose, and the reason names the hazard", () => {
  // The exclusion predates the finding and was stated in lib/decisions.mjs, where the arm did not
  // look. Stating it once more at the list is not duplication of the RULE -- decisions.mjs still
  // owns which keys a node may execute at all -- it is the absence being made legible where the
  // absence is.
  assert.match(SRC, /feature-verify is the only node that may launch the product, and it may never exit/);
  assert.ok(!EXECUTABLE_COMMAND_KEYS.includes('run'),
    'and `run` is not executable through capture at all, which is the owning rule');
});
