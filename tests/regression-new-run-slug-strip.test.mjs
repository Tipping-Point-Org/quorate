// A SLUG IS STRIPPED OF EVERY LEADING AND TRAILING HYPHEN (G-7 of 20261121-193516-m3s7-b1-review). new-run checked the
// slug against [a-z0-9-]+ and then removed ONE hyphen at each end (/^-|-$/g), so `--a--` became `-a-` and went into a
// run id with a hyphen at each end, never checked again. The strip now takes every hyphen at each end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'scripts', 'new-run.mjs'), 'utf8');

test('the slug strip removes every hyphen at each end', () => {
  const m = src.match(/^const slug = rawSlug\.replace\((\/.+\/g?), ''\);$/m);
  assert.ok(m, 'the slug strip was not found');
  const re = new Function(`return ${m[1]}`)();
  assert.equal('--a--'.replace(re, ''), 'a', `${m[1]} leaves a hyphen at an end of --a--`);
  assert.equal('-a-b-'.replace(re, ''), 'a-b');
});
