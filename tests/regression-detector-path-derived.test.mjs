// capture.mjs's allow-list carried two HARDCODED literals for the inert-feature detector:
//
//   ['node', '.claude/skills/scripts/find-inert-features.mjs']
//   ['node', '.claude\skills\scripts\find-inert-features.mjs']
//
// kept "so an old checkout's doctrine still works". They resolve against the CONSUMER's repo root,
// so in any project that has a file at that path — precisely the legacy layout a quorate-descended
// project would have, and the sandbox fixture used here literally shipped a .claude/skills/scripts
// directory — capture.mjs would execute the CONSUMER'S file through the sanctioned evidence
// channel, under the node's permissions.
//
// They were also redundant. In the legacy vendored layout capture.mjs itself lives at
// .claude/skills/scripts/, so DETECTOR_ABS and DETECTOR_REL already resolve to exactly that path.
// The literals therefore added nothing in the layout they existed to serve, and added a
// consumer-resolvable execution target in every other.
//
// The general rule this pins: capture may execute a framework script ONLY by a path derived from
// its own location. A literal that a consumer can create is not a path to our file, it is a path
// to whatever they put there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'capture.mjs'), 'utf8');

test('regression: no consumer-resolvable literal is executable through capture', () => {
  // Asserted on the ENTRIES, not on the file's text. The first version of this test matched a
  // regex against the whole allow-list region and failed on the comment DOCUMENTING the removal —
  // a test that cannot tell an executable entry from prose about one is testing the wrong thing,
  // the same mistake as pinning an implementation instead of a property.
  // The list is lib/capture-admit.mjs's since capture-interactive.plan.md stage 4: its node entries are asked for, given a
  // derived path, and every one must be that path (in either separator), never a literal of the owner's own.
  const owner = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'capture-admit.mjs'), 'utf8');
  const fn = owner.slice(owner.indexOf('export function readOnlyPrefixes'), owner.indexOf('export function admitCommand'));
  const entries = fn.split('\n').filter((l) => /^\s*\['node',/.test(l));
  assert.ok(entries.length >= 2, 'the detector entries must still be there to inspect');
  for (const e of entries) {
    assert.doesNotMatch(e, /\.claude|'[^']*\.mjs'/, `an allow-list ENTRY hardcodes a path: ${e.trim()}`);
    assert.match(e, /detectorAbs/, `an allow-list ENTRY is not the derived path: ${e.trim()}`);
  }
  assert.match(src, /readOnlyPrefixes\(DETECTOR_ABS\)/, 'capture must hand the owner the path it derives from its own location');
});

test('the detector is reachable ONLY by an absolute path derived from capture.mjs itself', () => {
  const list = src.slice(src.indexOf('const READ_ONLY'), src.indexOf('];', src.indexOf('const READ_ONLY')));

  // Derived from THIS file's location, which is what makes it ours in every layout.
  assert.match(src, /DETECTOR_ABS = path[.]join[(]path[.]dirname[(]fileURLToPath[(]import[.]meta[.]url[)][)]/);
  assert.match(list, /DETECTOR_ABS/, 'the absolute path must remain permitted');

  // AND THE RELATIVE SPELLING IS GONE (G-6, security-audit). This test used to REQUIRE it — "the
  // derived relative path must remain permitted" — which is how a demonstrated hole survived a
  // test written to guard the very rule it broke. path.relative(process.cwd(), ...) is derived
  // from capture.mjs's location only at the moment it is computed; node then resolves it against
  // the SPAWN cwd, which --cwd lets the caller choose. A path relative to wherever the caller
  // stands is not a path derived from this file, whatever it was derived from originally.
  assert.ok(!/DETECTOR_REL/.test(list),
    'a relative entry resolves against the caller, which is the hole this rule exists to close');
  assert.ok(!/const DETECTOR_REL =/.test(src),
    'and the derivation is gone, not merely unused — a dangerous value left computed gets used again');
});
