// THE LOG WINDOW, CUT FROM KEPT HEADS AND TAILS (capture-interactive.plan.md stage 3). capture.mjs held its command's whole
// output in a 64 MiB spawn buffer and cut a window from it; it now streams, and lib/log-window.mjs's headTailKeeper keeps
// each stream's first and last `limit` bytes. The window logWindow cuts from those must be the one it cuts from the whole
// output, byte for byte, for every split of the output between the two streams; otherwise the evidence a lens cites
// changes with how much the command printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logWindow, headTailKeeper, keptStreamView } from '../scripts/lib/log-window.mjs';

const notice = ({ total, headBytes, tailBytes, dropped }) => Buffer.from(`\n[cut ${total} ${headBytes} ${tailBytes} ${dropped}]\n`);
const bytes = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => 32 + ((i * 7 + seed) % 90)));

function viaKeeper(out, err, limit, chunk) {
  const k = headTailKeeper(limit);
  for (let i = 0; i < Math.max(out.length, err.length); i += chunk) {
    if (i < out.length) k.take('stdout', out.subarray(i, i + chunk));
    if (i < err.length) k.take('stderr', err.subarray(i, i + chunk));
  }
  const r = k.result();
  return { r, pieces: [keptStreamView(r.stdout), keptStreamView(r.stderr)] };
}

test('the window from kept heads and tails equals the window from the whole output, for every split', () => {
  const limit = 4096;
  const budget = 4000;
  for (const [o, e] of [[0, 0], [10, 20], [3000, 500], [500, 3000], [9000, 0], [0, 9000], [9000, 9000], [100, 50000], [50000, 100], [4096, 4096]]) {
    for (const chunk of [1, 333, 4096, 100000]) {
      const out = bytes(o, 1);
      const err = bytes(e, 2);
      const whole = Buffer.concat(logWindow([out, err], budget, notice));
      const { r, pieces } = viaKeeper(out, err, limit, chunk);
      assert.equal(r.stdout.total, o);
      assert.equal(r.stderr.total, e);
      const kept = Buffer.concat(logWindow(pieces, budget, notice).map((p) => (Buffer.isBuffer(p) ? p : p.subarray(0, p.length))));
      assert.ok(kept.equals(whole), `split ${o}/${e} in chunks of ${chunk}: the kept window differs from the whole one`);
    }
  }
});

test('a stream the head holds whole is its Buffer; a longer one refuses the dropped middle rather than invent it', () => {
  const k = headTailKeeper(8);
  k.take('stdout', Buffer.from('abc'));
  k.take('stderr', Buffer.from('0123456789abcdefghij'));
  const { stdout, stderr } = k.result();
  assert.ok(Buffer.isBuffer(keptStreamView(stdout)));
  assert.equal(keptStreamView(stdout).toString(), 'abc');
  const v = keptStreamView(stderr);
  assert.equal(v.length, 20);
  assert.equal(v.subarray(0, 8).toString(), '01234567');
  assert.equal(v.subarray(12, 20).toString(), 'cdefghij');
  assert.throws(() => v.subarray(5, 15), /dropped middle/);
});

test('memory is bounded: a long stream keeps at most twice the limit while running, and the limit after', () => {
  const k = headTailKeeper(1000);
  for (let i = 0; i < 500; i++) k.take('stdout', bytes(997, i));
  const { stdout } = k.result();
  assert.equal(stdout.total, 500 * 997);
  assert.equal(stdout.head.length, 1000);
  assert.equal(stdout.tail.length, 1000);
});

test('a keeper refuses a limit that is not a positive integer, and a stream it does not have', () => {
  assert.throws(() => headTailKeeper(0), RangeError);
  assert.throws(() => headTailKeeper(1.5), RangeError);
  assert.throws(() => headTailKeeper(4).take('stdin', Buffer.from('x')), /no stream named stdin/);
});
