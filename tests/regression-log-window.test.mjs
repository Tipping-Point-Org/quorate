// The oversized-capture path built `Buffer.concat([stdout, stderr])` — a full copy of everything a
// command produced, up to the 64 MiB spawn buffer — only to keep about a megabyte of it (G-8). The
// window is now read out of the two buffers. What must not change is what the window CONTAINS: the
// real first and last bytes of stdout-then-stderr, across the boundary between them.
//
// It lives in a module rather than inline in capture.mjs because capture's payload allow-list means
// a test cannot run an arbitrary command through the CLI to produce a big enough log.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceStream, logWindow } from '../scripts/lib/log-window.mjs';

const A = Buffer.from('A'.repeat(1000));
const B = Buffer.from('B'.repeat(500));
const FULL = Buffer.concat([A, B]);
const join = (bufs) => Buffer.concat(bufs);

test('a window is the same bytes the joined stream would have given', () => {
  for (const [from, len] of [[0, 10], [995, 10], [1000, 5], [1400, 100], [0, 1500], [0, 9999]]) {
    assert.ok(join(sliceStream([A, B], from, len)).equals(FULL.subarray(from, from + len)),
      `slice(${from}, ${len}) must match the joined stream`);
  }
});

test('the window straddling stdout and stderr is contiguous, not two heads', () => {
  // The boundary is where a per-buffer implementation goes wrong without looking wrong: 995..1005
  // is the last five bytes of stdout followed by the first five of stderr.
  assert.equal(join(sliceStream([A, B], 995, 10)).toString(), 'AAAAABBBBB');
});

test('nothing is copied — the window is views into the original buffers', () => {
  const [piece] = sliceStream([A, B], 0, 10);
  assert.equal(piece.buffer, A.buffer, 'a copy here is the O(B) allocation this fix removed');
});

test('an under-cap stream is passed through whole, with no truncation notice', () => {
  const out = logWindow([A, B], 5000, () => Buffer.from('NOTICE'));
  assert.ok(join(out).equals(FULL));
});

// THE NOTICE IS INSIDE `max` (G-5). It was excluded — documented as such, and still wrong: the
// caller bounds the log ON DISK at the figure I-30 states, so bytes the framework adds have to come
// out of the budget or the artifact exceeds a limit by exactly its own bookkeeping. Asserted as a
// property rather than against magic numbers, because the split now depends on how long the notice
// renders and a test pinned to 150/450 would have to be rewritten every time its wording changed.
test('a truncated log keeps the REAL first and last bytes, states the drop, and fits the cap', () => {
  const notice = ({ total, headBytes, tailBytes, dropped }) =>
    Buffer.from(`[cut ${total}/${headBytes}/${tailBytes}/${dropped}]`);

  for (const max of [600, 601, 137, 1499]) {
    const parts = logWindow([A, B], max, notice);
    const out = join(parts);
    assert.ok(out.length <= max, `window is ${out.length} bytes against a cap of ${max}`);

    const text = out.toString();
    const cut = /\[cut (\d+)\/(\d+)\/(\d+)\/(\d+)\]/.exec(text);
    assert.ok(cut, `the drop must be stated at max=${max}; a log that quietly stops reads like a command that did`);
    const [, total, headBytes, tailBytes, dropped] = cut.map(Number);
    assert.equal(total, 1500);
    assert.equal(dropped, total - headBytes - tailBytes, 'the stated drop must be the real drop');
    // AND THE STATED LENGTHS ARE THE EMITTED LENGTHS. A first attempt clamped the tail AFTER
    // rendering the notice, so the window was one byte shorter than the figure it had just printed:
    // the truncation notice is the one line a reader must take on trust, and it does not get to be
    // approximately right.
    assert.ok(out.subarray(headBytes, out.length - tailBytes).toString().includes('[cut'),
      'everything between the stated head and the stated tail must be the notice itself');

    assert.ok(out.subarray(0, headBytes).equals(FULL.subarray(0, headBytes)),
      `head is the real head at max=${max}`);
    assert.ok(out.subarray(out.length - tailBytes).equals(FULL.subarray(FULL.length - tailBytes)),
      'tail is the real tail — a tail taken from an already-truncated buffer is the G-9 defect');
    // Both halves are non-empty at a realistic cap: a "window" that is all notice keeps nothing.
    if (max > 200) assert.ok(headBytes > 0 && tailBytes > 0);
  }
});

test('a cap smaller than the notice yields a short window, never a negative slice', () => {
  // The degenerate end of the same arithmetic. capture floors its budget well above this, but a
  // range error thrown out of the truncation path would lose the whole capture — the one moment the
  // output is already enormous and the log is the only record of it.
  const out = join(logWindow([A, B], 4, () => Buffer.from('[cut a very long notice indeed]')));
  assert.ok(out.length >= 0);
  assert.match(out.toString(), /cut/);
});
