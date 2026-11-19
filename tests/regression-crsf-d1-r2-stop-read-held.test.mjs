// G-9 of 20261105-173030-crsf-d1-remediation-review: readStopEvents trimmed only once it held more than twice its cap,
// so a read with the default cap of 200,000 held about 400,000 events, while the plan and shared/session-rules.md cap
// the read at the cap. The test watches every push of an event, bare or wrapped, during one read and records the longest
// array an event was pushed to; each session's file is two events, so a longer array is the read's own buffer. It reaches
// the cap, so the spy sees that buffer, and holds no more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendStopEvent, readStopEvents } from '../scripts/io/stop-log.mjs';

test('G-9: one read never holds more events than its cap', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stopheld-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stopheld-repo-'));
  const realPush = Array.prototype.push;
  let longest = 0;
  try {
    for (let i = 0; i < 24; i++) appendStopEvent(repo, { at: i + 1, event: 'start', session: `s${i % 12}` }, { home });
    let r;
    Array.prototype.push = function (...items) {
      const n = realPush.apply(this, items);
      // An event is pushed bare (a file's parse) or wrapped `{ e, s }` (the read's heap, G-15): both are counted.
      const isEvent = (x) => x && typeof x === 'object' && 'at' in x && 'event' in x;
      if (items.some((x) => isEvent(x) || (x && typeof x === 'object' && isEvent(x.e)))) longest = Math.max(longest, n);
      return n;
    };
    try { r = readStopEvents(repo, { home, maxEvents: 5 }); } finally { Array.prototype.push = realPush; }
    assert.deepEqual(r.events.map((e) => e.at), [20, 21, 22, 23, 24], 'the newest five, oldest first');
    assert.equal(r.dropped, 19);
    // G-15 of 20261105-181450-crsf-d1-remediation-2-review: the spy must see the read's own buffer reach its cap, or the
    // bound above was measured on the per-file arrays only and holds whatever the buffer does.
    assert.equal(longest, 5, `the spy saw a longest array of ${longest}, not the read's buffer filled to its cap of 5`);
    assert.ok(longest <= 5, `the read held ${longest} events at once, past its cap of 5`);
  } finally {
    Array.prototype.push = realPush;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
