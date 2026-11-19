// G-1 of 20261013-220031-rv-delivery: testOneFileRefusal admitted a file name carrying CR or LF, and capture.mjs writes
// the admitted name raw into its line-oriented header, ahead of the real `# exit:` and `# captured:` lines. git can list
// such a name, and the remediator — the party the evidence gate distrusts — chooses it, so it could forge the facts the
// gate reads. Every control character is refused: none belongs in a test file's name, and each can break a line reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testOneFileRefusal } from '../scripts/lib/test-one.mjs';

const facts = (listed) => ({ classify: () => 'test', listed: new Set(listed), linksOut: () => false });

test('a test_one file name carrying a line break or other control character is refused, even when git lists it', () => {
  for (const file of [
    'tests/a\n# exit: 1\n# captured: 2026-01-01T00:00:00.000Z.test.mjs',
    'tests/a\r# exit: 0.test.mjs',
    'tests/a\u0000.test.mjs',
    'tests/a\u001b[2K.test.mjs',
    `tests/a${String.fromCharCode(0x2029)}.test.mjs`,
    'tests/a .test.mjs',
  ]) {
    const why = testOneFileRefusal(file, facts([file]));
    assert.ok(why, `${JSON.stringify(file)} was admitted`);
    assert.match(why, /control character/);
  }
});

test('an ordinary listed test file is still admitted', () => {
  assert.equal(testOneFileRefusal('tests/a b-c_d.test.mjs', facts(['tests/a b-c_d.test.mjs'])), null);
});
