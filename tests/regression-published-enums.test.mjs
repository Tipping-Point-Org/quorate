// TWO DOCUMENTS PUBLISHED THE SAME ENUM AND DISAGREED, and nothing could fail for it.
//
// `shared/claude-md-contract.md` — the document QUORATE.md names as where "every key is documented"
// — listed `ui.surface` as `none | web | tauri-webview | cli | tui`, while `CLAUDE.template.md`, the
// file consumers are told to COPY, listed `none | web | tui | desktop`. Every reader of the key
// tests `!== 'none'` and accepts any string, so the enum is descriptive and no run could ever go red
// over the split (G-42).
//
// The reachable harm is not the mismatch itself: a consumer fills in `desktop` from the template, a
// later reader checks it against the owning document, finds no such value and "corrects" it — and
// `none` is the correction that silently deselects ui-audit on a project that has a UI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { CONTRACT_BLOCK_RE } from '../scripts/lib/contract-version.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** The values listed in a `surface:` line's trailing comment, in order. */
function publishedSurfaces(text) {
  const line = text.split('\n').find((l) => /^\s*surface:/.test(l) && l.includes('#'));
  assert.ok(line, 'no documented `surface:` line found — this test is pinning nothing');
  return line.slice(line.indexOf('#') + 1)
    .split(';')[0]
    .split('|')
    .map((s) => s.trim())
    .filter((s) => /^[a-z-]+$/.test(s));
}

test('the ui.surface list is the same in the owning document and in the template consumers copy', () => {
  const owning = publishedSurfaces(read('shared/claude-md-contract.md'));
  const template = publishedSurfaces(read('CLAUDE.template.md'));

  assert.ok(owning.length >= 4, `parsed too few values from the owning doc: ${owning.join(', ')}`);
  assert.deepEqual(template, owning,
    'the file consumers copy and the file that documents it must publish one list');
  assert.ok(owning.includes('none'), '`none` is the one load-bearing value and must be listed');
});

// The template is also the yardstick check-install measures a consumer's contract against: it
// reports keys "the mounted quorate knows about" that a contract does not carry, and that comparison
// is bounded BY THE TEMPLATE. A key missing here can never be surfaced there — which is how a
// consumer keeps a 15-minute barrier cap long after this repository learned it kills the reconciler.
test('every review key this repository declares is present in the template', () => {
  // The contract block is found by its KEY, the way contract-source.mjs finds it — never by taking
  // the first fence in the file, which is the positional guess that module exists to remove.
  const keysOf = (text) => {
    const block = [...text.matchAll(/```ya?ml\s*\n([\s\S]*?)\n```/g)]
      .map((m) => m[1])
      // EITHER SPELLING — the key was renamed to `graph_contract_version` at contract v3, and this
      // is what FINDS the block: pinned to the old name it reported "no contract" for a file that
      // has one, which is the worst shape of wrong answer available here.
      .find((body) => CONTRACT_BLOCK_RE.test(body));
    assert.ok(block, 'no graph_contract block found');
    const review = block.slice(block.indexOf('\nreview:'));
    return new Set([...review.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]));
  };
  const mine = keysOf(read('CLAUDE.md'));
  const template = keysOf(read('CLAUDE.template.md'));
  const missing = [...mine].filter((k) => !template.has(k));
  assert.deepEqual(missing, [],
    'check-install cannot report a key the template never mentions, so a consumer never learns it exists');
});
