// .claude/requests/check-outcomes.plan.md, stage 6: no reader decides a captured check's result from a raw exit. Three
// remediation rounds each taught one reader one more case of exit 124 (remediation-fmt-check-baseline's round cap); the
// outcome is decided once, by lib/capture-header.mjs, and this guard keeps a new reader from combining the fields again.
// The file set is computed the way the design's census computes it, not pasted: every .mjs under scripts/ except the
// process-outcome files the design puts out of scope, the writer (capture.mjs) and the parser (lib/capture-header.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_OF_CLASS = new Set([
  // Node and reviewer process outcomes: a different class (check-outcomes.design.md, "Not in this design").
  'scripts/io/run-child.mjs', 'scripts/io/spawn-capture.mjs', 'scripts/external-review.mjs', 'scripts/lib/reviewer-probe.mjs',
  'scripts/io/reviewer-probe.mjs', 'scripts/spawn-node.mjs', 'scripts/check-reviewers.mjs',
  // The writer and the parser of the header.
  'scripts/capture.mjs', 'scripts/lib/capture-header.mjs',
]);
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
  const rel = `${dir}/${d.name}`;
  return d.isDirectory() ? walk(rel) : rel.endsWith('.mjs') ? [rel] : [];
});
const RAW_EXIT = [/exit_code\s*[!=]==?\s*\d/, /\.exit\s*[!=]==?\s*\d/, /exitCode\)?\s*[!=]==?\s*\d/];
// The names are built, so this file does not carry them itself.
const REMOVED = ['timedOut', 'captureError'].map((n) => `${n}InLog`);

test('stage 6: the two one-field log readers are gone from scripts/ and tests/', () => {
  const hits = [...walk('scripts'), ...walk('tests')].filter((rel) => REMOVED.some((n) => fs.readFileSync(path.join(ROOT, rel), 'utf8').includes(n)));
  assert.deepEqual(hits, []);
});

test('stage 6: no in-class reader decides from a raw exit comparison without saying why', () => {
  const offenders = [];
  const marked = [];
  for (const rel of walk('scripts').filter((r) => !OUT_OF_CLASS.has(r))) {
    fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((line, i) => {
      const code = line.split('//')[0];
      if (!code.trim() || !RAW_EXIT.some((re) => re.test(code))) return;
      if (/\/\/ outcome-ok: \S/.test(line)) marked.push(`${rel}:${i + 1}`);
      else offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  // Every marker is printed, so an exemption stays visible.
  if (marked.length) console.log(`outcome-ok markers:\n  ${marked.join('\n  ')}`);
  assert.deepEqual(offenders, [], `raw exit comparisons outside lib/capture-header.mjs:\n${offenders.join('\n')}`);
});
