// THE LICENCE (m2-public-release.plan.md stage 1; ROADMAP D3: Apache-2.0). LICENSE is the Apache License 2.0 text as
// apache.org publishes it, byte for byte: a licence file edited by hand, or re-wrapped, is a different document. NOTICE
// names the copyright holder, the new public account's name (operator, 2026-11-13: "The new account's name
// (Recommended)"); until that name exists it carries the publish placeholder, which the publish refuses to ship.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REPO_ROOT } from './helpers.mjs';

// sha256 of https://www.apache.org/licenses/LICENSE-2.0.txt, fetched 2026-11-13 (202 lines, LF).
const APACHE_2_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';
// Built at run time, so this file does not carry the marker the publish refuses (it ships).
const MARKER = ['PUBLISH', 'PLACEHOLDER'].join('-');

test('LICENSE is the Apache License 2.0 text, byte for byte', () => {
  const bytes = fs.readFileSync(path.join(REPO_ROOT, 'LICENSE'));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), APACHE_2_SHA256,
    'LICENSE differs from the published Apache-2.0 text');
});

test('NOTICE names the product, a copyright line and the licence; the holder is a name or the publish placeholder', () => {
  const notice = fs.readFileSync(path.join(REPO_ROOT, 'NOTICE'), 'utf8');
  assert.match(notice, /^quorate$/m);
  const holder = /^Copyright (\d{4}) (.+)$/m.exec(notice);
  assert.ok(holder, 'NOTICE has no "Copyright <year> <holder>" line');
  assert.ok(holder[2].trim().length > 0);
  assert.match(notice, /Apache License, Version 2\.0/);
  if (holder[2].includes(MARKER)) assert.equal(holder[2].trim(), MARKER, 'a placeholder holder is the marker alone');
});

test('the publish manifest holds the placeholder marker, so a NOTICE still carrying it cannot ship', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'publish', 'manifest.json'), 'utf8'));
  assert.ok(manifest.markers.includes(MARKER));
  assert.ok(!(manifest.allow ?? []).some((a) => a.path === 'NOTICE'), 'NOTICE is allowed past the scan');
});

test('README and plugin.json name the same licence', () => {
  assert.match(fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8'), /## License\s+Apache License 2\.0/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).license, 'Apache-2.0');
});
