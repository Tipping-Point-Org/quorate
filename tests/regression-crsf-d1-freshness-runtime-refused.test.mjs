// G-8 of 20261105-163851-crsf-d1-review: cli-freshness's chosenTable caught every error the runtime owner raised and set
// the runtime to null, so a contract declaring an unknown review.runtime was never refused: the freshness check went on and
// nothing named the invalid value. A declared runtime the owner refuses is now named in every answer, the hook's
// cache-only read included, and only a table with no default stays silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `q-crsfd1-${p}`));
const contract = { review: { runtime: 'not-an-adapter' } };
const run = () => ({ ok: false });

test('G-8: an unknown declared review.runtime is named by the full check, never swallowed', async () => {
  const { checkFreshness } = await import('../scripts/io/cli-freshness.mjs');
  const home = tmp('fr-rt-');
  try {
    const lines = checkFreshness({ home, now: new Date('2026-11-05T12:00:00Z'), run, declared: {}, contract });
    assert.ok(lines.some((l) => /review\.runtime 'not-an-adapter' is not in the adapter table/.test(l)),
      `the unknown runtime went unsaid: ${lines.join(' | ')}`);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('G-8: the hook\'s cache-only read names it too', async () => {
  const { checkFreshness } = await import('../scripts/io/cli-freshness.mjs');
  const home = tmp('fr-rt-only-');
  try {
    const lines = checkFreshness({ home, cacheOnly: true, now: new Date('2026-11-05T12:00:00Z'), declared: {}, contract });
    assert.ok(lines.some((l) => /not-an-adapter/.test(l)), `the unknown runtime went unsaid: ${lines.join(' | ')}`);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('G-8: no declared runtime is not a refusal', async () => {
  const { checkFreshness } = await import('../scripts/io/cli-freshness.mjs');
  const home = tmp('fr-rt-none-');
  try {
    assert.deepEqual(checkFreshness({ home, cacheOnly: true, now: new Date('2026-11-05T12:00:00Z'), declared: {}, contract: {} }), []);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
