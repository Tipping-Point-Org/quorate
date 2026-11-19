// The pre-push hook resolves which new-run.mjs to EXECUTE, and dynamically imports lib/decisions.mjs
// and lib/locate.mjs from beside it, on every push. Four of its candidate paths are rooted in the
// CONSUMER's repository, so a file that repository happens to carry at scripts/new-run.mjs ran as
// the framework, with the framework's trust (G-1).
//
// findNewRun is not exported — checks.mjs is a hook, not a module — so the function is lifted out of
// the source and exercised directly. Reading the source for a regex would only assert that a line
// exists; this asserts what it decides.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'hooks', 'checks.mjs'), 'utf8');
const body = src.slice(src.indexOf('function findNewRun'), src.indexOf('const NEW_RUN'));
const findNewRun = new Function('fs', 'path', `${body} return findNewRun;`)(fs, path);

test('the hook resolves the framework it lives in', () => {
  const here = path.join(REPO_ROOT, '.claude', 'hooks');
  assert.equal(path.resolve(findNewRun(here, REPO_ROOT)), path.resolve(REPO_ROOT, 'scripts', 'new-run.mjs'));
});

test('a consumer file named scripts/new-run.mjs is NOT run as the framework', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-hook-'));
  try {
    const consumer = path.join(tmp, 'consumer');
    const elsewhere = path.join(tmp, 'framework-that-is-not-there', 'hooks');
    fs.mkdirSync(path.join(consumer, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(consumer, 'scripts', 'new-run.mjs'), '// not the engine\n');

    const decoy = path.resolve(consumer, 'scripts', 'new-run.mjs');
    // NULL, not a fallback. The first cut ended with an unvalidated `return candidates[1]` — the
    // very candidate the loop may have just rejected — so the identity gate governed the happy path
    // and was bypassed on the one branch where nothing legitimate was found. The sweep that reviewed
    // the gate's own commit caught it, and this test stayed green either way; it now pins the
    // default branch rather than only the loop.
    assert.equal(findNewRun(elsewhere, consumer), null,
      'nothing legitimate was found, and a hook that guesses here executes what it could not identify');

    // ...and the check is a real identity test, not a blanket refusal of consumer paths: a genuine
    // quorate checkout there — one carrying the plugin manifest that makes it one — is accepted.
    fs.mkdirSync(path.join(consumer, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(consumer, '.claude-plugin', 'plugin.json'), '{"name":"quorate"}\n');
    assert.equal(path.resolve(findNewRun(elsewhere, consumer)), decoy,
      'a real checkout must still resolve, or the hook refuses every legitimate install');

    // And the CALLER must stop on null rather than spawning it: that is what turns "could not
    // identify the engine" into a configuration error instead of an execution.
    assert.match(src, /if \(!NEW_RUN\) \{[\s\S]*?process\.exit\(2\)/,
      'an unlocatable framework is a configuration error (exit 2), not a failed check');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
