// G-5 and G-9 of 20261013-233901-rv-delivery-remediation-review. captureHeaderOf found the header's closing rule with an
// unanchored indexOf, and headerValue does not escape dashes, so a `$ ` or `# cwd:` line carrying 72 dashes ended the
// header inside that line: the `# admitted`, `# exit` and `# captured` facts after it were lost and valid red or green
// evidence was refused (G-5). And test-one.mjs wrote its own copy of the control-character class headerValue escapes, two
// definitions of one boundary free to drift (G-9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { HEADER_RULE, headerValue, parseCaptureHeader } from '../scripts/lib/capture-header.mjs';

const dashes = '-'.repeat(72);
const log = (cmdLine, cwd) => `$ ${headerValue(cmdLine)}\n# admitted: test_one tests/a.test.mjs\n# cwd: ${headerValue(cwd)}\n`
  + `# exit: 1\n# timeout: 15 minute(s)\n# captured: 2026-10-13T10:00:00.000Z\n${HEADER_RULE}\noutput\n`;

test('G-5: 72 dashes inside the $ line do not end the header', () => {
  const h = parseCaptureHeader(log(`node --test tests/a${dashes}.test.mjs`, '/repo'));
  assert.equal(h.exit, 1);
  assert.equal(h.admitted, 'test_one');
  assert.equal(h.captured, '2026-10-13T10:00:00.000Z');
});

test('G-5: 72 dashes inside the cwd line do not end the header', () => {
  const h = parseCaptureHeader(log('node --test tests/a.test.mjs', `/repo/${dashes}`));
  assert.equal(h.exit, 1);
  assert.equal(h.captured, '2026-10-13T10:00:00.000Z');
});

test('G-5: a rule on a line of its own still closes the header, and output cannot add facts after it', () => {
  const h = parseCaptureHeader(`$ x\n# captured: 2026-10-13T10:00:00.000Z\n${HEADER_RULE}\n# exit: 0\n`);
  assert.equal(h.exit, null);
  assert.equal(parseCaptureHeader('$ x\n# exit: 0\n'), null);
});

test('G-9: test-one.mjs takes the header-unsafe class from capture-header.mjs, not a copy of its own', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/lib/test-one.mjs'), 'utf8');
  assert.doesNotMatch(src, /\\p\{Cc\}/);
  assert.match(src, /from '\.\/capture-header\.mjs'/);
});
