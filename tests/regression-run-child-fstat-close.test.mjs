// G-13 of 20261122-193909-llo-delivery (panel-codex-code): openChildOutput's fstatSync ran outside any guard after
// openSync succeeded, so an fstat failure left the output descriptor open. The descriptor is now closed before the error
// is thrown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openChildOutput } from '../scripts/io/run-child.mjs';

test('G-13: an fstat failure after the open closes the descriptor it opened', () => {
  const closed = [];
  const fsImpl = {
    lstatSync: () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); },
    openSync: () => 42,
    fstatSync: () => { throw Object.assign(new Error('fstat failed'), { code: 'EIO' }); },
    closeSync: (fd) => { closed.push(fd); },
  };
  assert.throws(() => openChildOutput('out.log', fsImpl), /fstat failed/);
  assert.deepEqual(closed, [42], 'the descriptor was left open');
});
