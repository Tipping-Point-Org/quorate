// THE PUBLISHED CLAUDE.md CITES NO EXCLUDED FILE BY ITS BARE NAME (G-1 of 20261121-001829-prc-remediation-review).
//
// publish/CLAUDE.public.md named `remediation-repair-pass.plan.md` and `autonomous-run-pauses.md`, both under
// .claude/requests, which publish/manifest.json excludes; a reader of the public repository followed them to nothing. The
// check in regression-pr-comments (G-2) requires a folder in the citation, so it could not see a bare name. A bare
// document name is an excluded citation when the file of that name stands in an excluded folder of this checkout (the
// public mirror has none, and ships this same text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SCRIPTS_DIR } from './helpers.mjs';

test('G-1: the published CLAUDE.md cites, by its bare name, no file under a folder the publish manifest excludes', () => {
  const root = path.resolve(SCRIPTS_DIR, '..');
  const { exclude } = JSON.parse(fs.readFileSync(path.join(root, 'publish', 'manifest.json'), 'utf8'));
  // Whichever file is the public CLAUDE.md (operator, 2026-11-24: "Tests read whichever is the public CLAUDE.md
  // (Recommended)"): the snapshot ships publish/CLAUDE.public.md as its CLAUDE.md.
  const pub = fs.existsSync(path.join(root, 'publish', 'CLAUDE.public.md')) ? path.join('publish', 'CLAUDE.public.md') : 'CLAUDE.md';
  const text = fs.readFileSync(path.join(root, pub), 'utf8');
  const bare = [...new Set([...text.matchAll(/`([\w-][\w.-]*\.md)`/g)].map((m) => m[1]))];
  assert.ok(bare.length > 0, 'the pattern found no bare document name at all, so it checks nothing');
  const hidden = bare.filter((n) => exclude.some((e) => fs.existsSync(path.join(root, e, n))));
  assert.deepEqual(hidden, [], 'the published contract cites, by its bare name, a file under a folder the snapshot does not ship');
});
