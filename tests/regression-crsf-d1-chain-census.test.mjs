// G-12 of 20261105-163851-crsf-d1-review: remediate's CHAIN-BROKEN census turned every root-listing error into an empty
// root (`catch { continue; }`) and skipped every link child as not a directory, so an incomplete scan could suppress the
// CHAIN-BROKEN record with no warning. A source check, as G-16 of 20261029-055946 is, because the scan sits behind a full
// remediation mint no fixture here reaches: only ENOENT is absence, and a listing error or a link child is named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('G-12: the CHAIN-BROKEN census names an unreadable root and a link child, never reads them as empty', () => {
  const s = fs.readFileSync(new URL('../scripts/remediate.mjs', import.meta.url), 'utf8');
  const from = s.indexOf('// CHAIN-BROKEN:');
  // The scan ends where its census is reported (the sort it ended at went with G-12 of
  // 20261105-173030-crsf-d1-remediation-review, which keeps the newest as the scan goes).
  const end = s.indexOf('if (censusUnread.length)', from);
  const block = s.slice(from, end);
  assert.ok(from > 0 && end > from && block.length > 0, 'the CHAIN-BROKEN scan was not found');
  assert.doesNotMatch(block, /catch\s*\{\s*continue;?\s*\}/, 'a listing error is read as an empty root');
  assert.match(block, /ENOENT/, 'absence is not limited to ENOENT');
  assert.match(block, /isSymbolicLink\(\)/, 'a link child is skipped unnamed');
  const after = s.slice(end, s.indexOf('// ---', from));
  assert.match(after, /console\.error\([^)]*not (?:read|scanned)/, 'an incomplete census is not reported');
});
