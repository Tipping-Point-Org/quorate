// The uncap had a second half that the first attempt got wrong, and it cost a whole resume.
//
// run-graph was made to OMIT --budget-usd when a tier is uncapped. But spawn-node defaults an
// ABSENT --budget-usd to its own $1.50 standalone safety and always pushed --max-budget-usd to the
// child. So "uncapped" reached claude -p as a $1.50 ceiling — LOWER than the $4 cap being lifted —
// and arch-review, intent-capture and reconcile all died at ~$1.5 on the first uncapped resume of
// 20260903-225529-full-sweep-approved, each with `--max-budget-usd 1.50` in its recorded cmd.
//
// The fix: run-graph passes the explicit sentinel `none`, and spawn-node omits --max-budget-usd on
// the child for `none`/`''` while keeping the $1.50 default for a genuinely absent flag. This test
// pins all three cases at the process boundary, reading the exact child argv via --print-cmd.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRunDir, runScript } from './helpers.mjs';

function childCmd(extraArgs) {
  // One of this repository's runs, so spawn-node admits it: run-dir-trust.plan.md stage 3 (ARCHITECTURE A-28).
  const { base, dir } = repoRunDir({ prefix: 'quorate-childbudget-', json: { stamps: [] } });
  try {
    // Any non-intent node needs a node-settings.json to exist; its content is irrelevant here —
    // it is passed to the child as --settings, not read by the budget path.
    fs.writeFileSync(path.join(dir, 'node-settings.json'), '{}');
    const r = runScript('spawn-node.mjs', [
      '--run-dir', dir, '--repo-root', process.cwd(),
      '--node-id', 'reconcile', '--mode', 'reconcile', '--prompt', 'x',
      '--print-cmd', ...extraArgs,
    ]);
    assert.equal(r.status, 0, `--print-cmd should exit 0; got ${r.status}\n${r.output.slice(-400)}`);
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
const capOf = (cmd) => { const i = cmd.indexOf('--max-budget-usd'); return i < 0 ? null : cmd[i + 1]; };

test('regression: --budget-usd none omits --max-budget-usd on the child (truly uncapped)', () => {
  assert.equal(capOf(childCmd(['--budget-usd', 'none'])), null,
    'uncapped must mean NO ceiling reaches claude -p, not a fallback default');
});

test("regression: an empty --budget-usd '' is also uncapped", () => {
  assert.equal(capOf(childCmd(['--budget-usd', ''])), null);
});

test('a finite --budget-usd passes through to the child unchanged', () => {
  assert.equal(capOf(childCmd(['--budget-usd', '4.00'])), '4.00');
});

test('regression: an ABSENT --budget-usd keeps the $1.50 standalone safety, not uncapped', () => {
  // The trap that made omit-the-flag wrong: absence must stay bounded so a direct spawn-node call
  // is never accidentally uncapped. Only the explicit sentinel lifts the ceiling.
  assert.equal(capOf(childCmd([])), '1.50');
});
