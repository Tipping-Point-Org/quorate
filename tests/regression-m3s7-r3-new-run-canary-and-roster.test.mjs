// TWO SILENT PATHS IN new-run.mjs (G-7, G-8 and G-6 of 20261121-214741-m3s7-b1-remediation-2-review).
// G-7/G-8: the sandbox canary quoted its paths with a local sh() that only wrapped them in double quotes, so `%NAME%`, `$`
// and a backtick in a framework or run path still expanded in the shell the probe picked; briefArg is the one owner of
// that rule and refuses what quoting cannot neutralise. G-6: an unreadable or malformed lens-roster.json was replaced by
// {} and the mint went on with every roster default missing, failing later and elsewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../scripts/new-run.mjs', import.meta.url), 'utf8');

test('the canary quotes its paths through briefArg, not a local double-quote wrapper', () => {
  assert.ok(!/const sh = \(v\) => `"/.test(src), 'a local sh() that only adds double quotes is the defect');
  assert.match(src, /const sh = briefArg;/, 'the canary paths must go through briefArg');
  assert.match(src, /import \{[^}]*\bbriefArg\b[^}]*\} from '\.\/lib\/decisions\.mjs'/s, 'briefArg is not imported');
});

test('an unreadable or malformed lens roster refuses the mint rather than becoming {}', () => {
  const start = src.indexOf('const ROSTER_FOR_DEFAULTS');
  assert.ok(start >= 0, 'ROSTER_FOR_DEFAULTS not found');
  const block = src.slice(start, src.indexOf('})();', start) + 5);
  assert.ok(!/catch\s*(\([^)]*\))?\s*\{\s*return \{\};\s*\}/.test(block), `the roster read swallows its failure: ${block}`);
  assert.match(block, /throw new Error\(/, 'a roster read failure must throw, naming the file');
});
