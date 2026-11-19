// A test body that returns on a guard without calling t.skip is reported by the runner as a PASS that exercised nothing
// (G-16..G-23 of 20261023-040306-rdt-remediation-2-review: eight such guards, which the census of the remediation before
// it reported as fixed). A guard either records its skip, `if (...) { t.skip('why'); return; }`, or hands `t` to a helper
// that does (the junction() helpers), and this test holds every test file to that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = path.dirname(fileURLToPath(import.meta.url));
// A guard at a test body's own indentation: two spaces, `if (cond) return;`, on one line.
const BARE_GUARD = /^  if \((.*)\)\s*return;?\s*(\/\/.*)?$/;
// AND THE BRACED FORM (run-dir-descendants.plan.md stage 5; G-29 of 20261024-122231-rdt-remediation-3-review): `if (cond)
// { ...; return; }` on one line, which the bare pattern never matched, so a guard logging a diagnostic and returning
// passed silently. Its braces must record the skip.
const BRACED_GUARD = /^  if \((.*)\)\s*\{(.*)\breturn;?\s*\}\s*(\/\/.*)?$/;

/** The silent guards in one test file's source: a bare or braced early return that records no skip. */
export function silentGuards(name, src) {
  const silent = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const bare = BARE_GUARD.exec(line);
    if (bare) {
      if (/\bt\s*[,)]/.test(bare[1])) return;   // the guard's helper receives t and skips through it
      silent.push(`${name}:${i + 1}: ${line.trim()}`);
      return;
    }
    const braced = BRACED_GUARD.exec(line);
    // A test body's guard acts on its test context (`t.diagnostic(...)`) or does nothing but return. A fake CLI's source,
    // written out as text by a test (`if (process.argv.includes('--version')) { process.stdout.write(...); return; }`),
    // does neither, and is not a test body.
    const testGuard = braced && (/\bt\.\w+\(/.test(braced[2]) || /^\s*$/.test(braced[2]));
    if (testGuard && !/\bt\.skip\(/.test(braced[2])) silent.push(`${name}:${i + 1}: ${line.trim()}`);
  });
  return silent;
}

test('no test body returns on a guard without recording a skip', () => {
  const silent = [];
  for (const name of fs.readdirSync(TESTS).filter((n) => n.endsWith('.test.mjs'))) {
    silent.push(...silentGuards(name, fs.readFileSync(path.join(TESTS, name), 'utf8')));
  }
  assert.deepEqual(silent, [], `guards that pass silently instead of calling t.skip:\n${silent.join('\n')}`);
});

test('G-29: the braced form is seen, and a braced guard that records its skip passes', () => {
  assert.equal(silentGuards('x', "  if (r.status !== 0) { t.diagnostic('none here'); return; }").length, 1, 'a braced silent guard');
  assert.equal(silentGuards('x', "  if (r.status !== 0) { t.skip('none here'); return; }").length, 0, 'a braced guard that skips');
  assert.equal(silentGuards('x', '  if (!ok) return;').length, 1, 'the bare form, still');
  assert.equal(silentGuards('x', '  if (!ok) { return; }').length, 1, 'a braced guard that only returns');
  assert.equal(silentGuards('x', "  if (process.argv.includes('--version')) { process.stdout.write('0.0.0'); return; }").length, 0,
    'a fake CLI\'s source written out by a test is not a test body');
});
