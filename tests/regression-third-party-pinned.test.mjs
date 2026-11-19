// VENDORED CODE IS PINNED BYTE FOR BYTE (capture-interactive.plan.md stage 4; operator, 2026-11-15: "third_party/, pinned,
// not reviewed (Recommended)"). third_party/ holds code quorate did not write and no review reads, so the one guard on it
// is that it is exactly what was fetched and checked: every file a VENDORED.md names has the hash it records, no file
// below third_party/<name>/ goes unnamed, and every vendored package carries its licence and is named in NOTICE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REPO_ROOT } from './helpers.mjs';

const ROOT = path.join(REPO_ROOT, 'third_party');
const packages = () => fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const pinned = (name) => {
  const md = fs.readFileSync(path.join(ROOT, name, 'VENDORED.md'), 'utf8');
  return [...md.matchAll(/^- `([^`]+)` `([0-9a-f]{64})`$/gm)].map((m) => ({ file: m[1], sha: m[2] }));
};
const walk = (dir, pre = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? walk(path.join(dir, e.name), `${pre}${e.name}/`) : [`${pre}${e.name}`]));

test('every vendored file has the hash its VENDORED.md records', () => {
  assert.ok(packages().length >= 1, 'third_party/ holds no package');
  for (const name of packages()) {
    const pins = pinned(name);
    assert.ok(pins.length > 0, `${name}: VENDORED.md pins no file`);
    for (const { file, sha } of pins) {
      const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, name, file))).digest('hex');
      assert.equal(got, sha, `third_party/${name}/${file} differs from the bytes vendored: replace the table only by an upgrade`);
    }
  }
});

test('no file below a vendored package goes unpinned, and each carries its licence and is named in NOTICE', () => {
  const notice = fs.readFileSync(path.join(REPO_ROOT, 'NOTICE'), 'utf8');
  for (const name of packages()) {
    const named = new Set(pinned(name).map((p) => p.file));
    const unpinned = walk(path.join(ROOT, name)).filter((f) => f !== 'VENDORED.md' && !named.has(f));
    assert.deepEqual(unpinned, [], `third_party/${name}: files present but not pinned`);
    assert.ok(named.has('LICENSE'), `third_party/${name}: no LICENSE pinned`);
    assert.match(notice, new RegExp(`third_party/${name}/`), `NOTICE does not name third_party/${name}/`);
  }
});

test('the vendored parser loads and parses, so the pin is of a working copy', async () => {
  const { parse } = await import(new URL(`file:///${path.join(ROOT, 'unbash', 'dist', 'parser.js').replace(/\\/g, '/')}`).href);
  const ast = parse('echo "a | b" | wc -l');
  assert.equal(ast.type, 'Script');
  assert.ok(JSON.stringify(ast).includes('DoubleQuoted'));
});
