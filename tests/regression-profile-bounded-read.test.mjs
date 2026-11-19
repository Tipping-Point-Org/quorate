// G-3 of 20261024-224631-arp-remediation-review: readProfile's maxBytes capped the text it kept, not what it read. The
// whole file was loaded with readFileSync first and cut afterwards, so a large profile could still exhaust the memory of
// check-install, the caller the cap was passed for. Read through io, a profile is now read only up to its cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProfile } from '../scripts/lib/project-profile.mjs';
import { FS_MEMBERS } from '../scripts/platform/interface.mjs';

test('regression: a profile larger than its cap is read only up to the cap', () => {
  const size = 10_000_000;
  let asked = 0;
  const io = {
    fs: {
      existsSync: () => true,
      realpathSync: (p) => p,   // the profile is where it is named: in the repository (G-9 of 20261024-235344)
      statSync: () => ({ size }),
      // The read goes through the egress owner (G-10 of 20261112-073408-hl-remediation-5-review), which lstats each level.
      lstatSync: (p) => {
        const file = String(p).endsWith('.md');
        return { size: file ? size : 0, nlink: 1, isSymbolicLink: () => false, isDirectory: () => !file, isFile: () => file };
      },
      readFileSync: () => { throw new Error('the whole file was read'); },
      openSync: () => 7,
      readSync: (fd, buf, off, len) => { asked += len; buf.fill(0x61, off, off + len); return len; },
      closeSync: () => {},
    },
  };
  const p = readProfile({ repoRoot: '/r', name: 'code-audit', maxBytes: 1024, io });
  assert.equal(p.unreadable, false, 'read without loading the whole file');
  assert.equal(p.bytes, size, 'the size is still the whole file\'s, for the oversize note');
  assert.equal(p.truncated, true);
  assert.ok(Buffer.byteLength(p.text) <= 1024);
  assert.ok(asked <= 1024 + 4, `read ${asked} bytes for a cap of 1024`);
  assert.ok(FS_MEMBERS.includes('readSync'), 'every platform provides the bounded read');
});
