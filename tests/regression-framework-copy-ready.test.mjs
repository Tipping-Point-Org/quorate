// G-8 of 20260926-060936-m0-close-r3 (panel-codex-code): framework readiness in the arms' checkout was
// `copyTrackedInto().ok`, which is true even when it REFUSED files — so a detector or doctrine file
// withheld as an outward link left an incomplete framework selected, and the arms ran without the
// inputs they are ordered to use. Ready now means the copy completed AND every file the arms require
// is at the destination.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const S = path.join(import.meta.dirname, '..', 'scripts');

test('a framework copy that refused a required file is not ready', async () => {
  const caps = await import('../scripts/lib/capabilities.mjs');
  assert.equal(typeof caps.frameworkCopyReady, 'function', 'the decision has one owner');
  const present = new Set(['scripts/find-inert-features.mjs', 'shared/disk-first-protocol.md']);
  const exists = (rel) => present.has(rel);
  assert.equal(caps.frameworkCopyReady({ ok: true, refused: [] }, exists).ready, true);
  assert.equal(caps.frameworkCopyReady({ ok: false, refused: [] }, exists).ready, false, 'a failed copy');
  const withheld = caps.frameworkCopyReady({ ok: true, refused: [{ rel: 'shared/disk-first-protocol.md', why: 'link' }] },
    (rel) => rel !== 'shared/disk-first-protocol.md');
  assert.equal(withheld.ready, false, 'a required file refused as a link');
  assert.match(withheld.why, /disk-first-protocol/);
  assert.equal(caps.frameworkCopyReady({ ok: true, refused: [{ rel: 'README.md', why: 'link' }] }, exists).ready, true,
    'a refused file the arms do not need does not block the panel — it is still named in the gate');
});

test('run-graph takes readiness from that decision, not from the copy alone', () => {
  const src = fs.readFileSync(path.join(S, 'run-graph.mjs'), 'utf8');
  assert.doesNotMatch(src, /panelFrameworkReady = sub\.ok;/);
  assert.match(src, /frameworkCopyReady\(sub,/);
});
