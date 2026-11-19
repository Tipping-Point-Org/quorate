// Remediation 20261112-061652-hl-remediation-4, of review 20261112-054852-hl-remediation-3-review.
//   G-9: writeAllSync retried EAGAIN at once, with no wait, so a full pipe made it spin a core. It now waits between tries.
//   G-3, G-11: decide.mjs --json and new-run.mjs --print-contract queued stdout and called process.exit at once, so a large
//   answer on a POSIX pipe could be cut short; both now write every byte through writeAllSync before exiting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { writeAllSync } from '../scripts/io/write-all.mjs';

test('G-9: an EAGAIN is retried after a wait, not in a spin, and every byte is still written', (t) => {
  let fails = 5;
  const got = [];
  const at = [];
  t.mock.method(fs, 'writeSync', (fd, buf, off, len) => {
    at.push(performance.now());
    if (fails-- > 0) throw Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' });
    got.push(Buffer.from(buf.subarray(off, off + len)));
    return len;
  });
  writeAllSync(99, 'hello', { retry: ['EAGAIN'] });
  assert.equal(Buffer.concat(got).toString(), 'hello');
  const waited = at.at(-1) - at[0];
  assert.ok(waited >= 4, `five EAGAINs retried within ${waited.toFixed(2)} ms: no wait between tries`);
});

test('G-3: the --json decision is written every byte before the process exits', () => {
  const decide = fs.readFileSync(path.join(REPO_ROOT, 'scripts/decide.mjs'), 'utf8');
  assert.match(decide, /if \(opts\.json\) writeAllSync\(1, `\$\{JSON\.stringify\(\{ id, \.\.\.o \}\)\}\\n`, \{ retry: \['EAGAIN'\] \}\);/,
    'decide --json is queued with console.log before process.exit');
});

test('G-11: --print-contract is written every byte before the process exits', () => {
  const newRun = fs.readFileSync(path.join(REPO_ROOT, 'scripts/new-run.mjs'), 'utf8');
  assert.match(newRun, /writeAllSync\(1, JSON\.stringify\(contract, null, 2\) \+ '\\n', \{ retry: \['EAGAIN'\] \}\);\s*process\.exit\(0\);/,
    'new-run --print-contract is queued with process.stdout.write before process.exit');
});
