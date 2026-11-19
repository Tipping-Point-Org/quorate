// THE HEADLINE WAS ONE BARE WORD, AND THE WORD IS AMBIGUOUS EXACTLY WHERE IT MATTERS MOST.
//
// PASS, RISK and FAIL are three rungs of ONE ladder, and all three are claims about the CODE.
// BLOCKED is not on that ladder: it is a claim about the RUN, meaning no verdict was established.
// That distinction is this project's central rule -- silence is not a verdict -- and the gate table
// already carries it in two separate columns:
//
//     | contract-audit | OK | FAIL | 4 |
//                        ^     ^
//                        |     the verdict on the code
//                        the node state: the machinery was fine
//
// But `# Gate — FAIL` alone has no register cue, and that is the first thing a reader sees. Read on
// its own, "FAIL" is just as easily "the tool broke" -- which is the one thing it never means, and
// which is precisely how an operator read it. The exit code says the same thing and says it
// backwards to most eyes: a FAIL run exits 0 BECAUSE IT WORKED, and only BLOCKED exits 1.
//
// Renaming the verdicts was the alternative and is worse: `gate.json` verdicts are consumed by
// version-gate and recorded across every folded run in the cross-run ledger, so a rename propagates
// through all of it to fix a legibility problem in one sentence. One line of context on the headline
// costs nothing and moves nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';
import { gateCompleteness } from '../scripts/lib/decisions.mjs';

/**
 * A finished run in a throwaway consumer repository, gated and archived.
 *
 * `ui.surface: none` IS LOAD-BEARING: ui-audit's condition is `ui.surface != none`, and an
 * undeclared key is not equal to "none" -- so a contract omitting the block SELECTS the lens and
 * `--only ui-audit` spawns a real model. Declared, the lens is deselected, nothing is billed, and
 * run-graph still reaches the gate. That is the whole gate path for the price of a process.
 */
function gatedRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-headline-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-headlinehome-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
    '# t\n\n```yaml\ngraph_contract_version: 3\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
    + 'ui:\n  surface: none\n```\n');
  git('add', '-A');
  git('commit', '-qm', 'init');

  const mint = runScript('new-run.mjs',
    ['--slug', 'headline', '--no-verify-sandbox', '--no-request', '--full-sweep', '.'],
    { cwd: dir, env: { QUORATE_HOME: home } });
  assert.equal(mint.status, 0, mint.output.slice(-300));
  const runDir = mintedRunDir(mint.output);

  const graph = runScript('run-graph.mjs',
    ['--run-dir', runDir, '--skip-panel', '--only', 'ui-audit'], { cwd: dir, env: { QUORATE_HOME: home } });
  assert.match(graph.output, /cost:\s+\$0\.0+\b/,
    `this test must spawn no model:\n${graph.output.slice(-600)}`);

  const archived = path.join(dir, '.claude', 'reviews', path.basename(runDir));
  const gateMd = fs.readFileSync(path.join(archived, 'gate.md'), 'utf8');
  const gateJson = JSON.parse(fs.readFileSync(path.join(archived, 'gate.json'), 'utf8'));
  return { dir, home, gateMd, gateJson, output: graph.output };
}

test('the gate headline says whether the review completed, not only what it concluded', () => {
  const r = gatedRun();
  try {
    const headline = r.gateMd.split('\n')[0];
    assert.match(headline, /^# Gate — \w+ · /,
      `the headline must carry the verdict AND its kind. Got: ${JSON.stringify(headline)}`);

    // THE FACT, checked against the bucket that owns it rather than against a hardcoded phrase:
    // a headline claiming every node reported while the gate lists nodes that did not is the
    // disagreement this line exists to prevent, not one it may introduce.
    const silent = r.gateJson.buckets?.did_not_report ?? [];
    if (silent.length === 0) {
      assert.match(headline, /every node reported/,
        'a complete run must say so, so that FAIL cannot be read as "the review broke"');
    } else {
      assert.match(headline, new RegExp(`${silent.length} nodes? did not report`),
        'and an incomplete one must name how many, which is what makes BLOCKED legible');
    }
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
    fs.rmSync(r.home, { recursive: true, force: true });
  }
});

test('and the console line a reader actually watches says the same thing', () => {
  // gate.md is opened later; this line is what scrolls past at the end of a 50-minute sweep, and it
  // was the bare word too.
  const r = gatedRun();
  try {
    assert.match(r.output, /== gate: \w+ ==/, 'the verdict line itself is unchanged');
    assert.match(r.output, /(every node reported|\d+ nodes? did not report)/,
      `the console must disambiguate the verdict the same way gate.md does:\n${r.output.slice(-600)}`);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
    fs.rmSync(r.home, { recursive: true, force: true });
  }
});

test('the verdict vocabulary itself is unchanged — this adds context, it does not rename', () => {
  // version-gate consumes gate.json, and every folded run in the cross-run ledger carries these
  // strings. The headline gained a suffix; the machine-readable verdict must not have moved.
  const r = gatedRun();
  try {
    assert.ok(['PASS', 'RISK', 'FAIL', 'BLOCKED'].includes(r.gateJson.gate),
      `gate.json must still carry one of the four verdicts, unadorned. Got ${JSON.stringify(r.gateJson.gate)}`);
    assert.ok(!String(r.gateJson.gate).includes('·'),
      'the suffix belongs to the rendered headline, never to the value anything parses');
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
    fs.rmSync(r.home, { recursive: true, force: true });
  }
});

// BOTH BRANCHES, which no cheap fixture can produce: a run where a required node DID NOT REPORT
// needs a node that spawns and then dies, and every one of those costs a model. The phrasing is a
// pure decision for exactly that reason -- the integration tests above prove it is wired in, and
// these prove it is right for the case they cannot reach.
test('the incomplete phrasing is exact, including the case no cheap fixture can produce', () => {
  assert.equal(gateCompleteness(0), 'every node reported');
  assert.equal(gateCompleteness(1), '1 node did not report', 'singular, because a gate reads as prose');
  assert.equal(gateCompleteness(2), '2 nodes did not report');
});

test('an ABSENT count never reads as a clean run', () => {
  // `Number(null)` is 0, so a caller that lost the count would have rendered "every node reported"
  // -- silence resolving to a clean bill of health, in the headline of the artifact whose whole
  // premise is that silence is not a verdict. Caught while writing this test, not by a lens.
  for (const absent of [null, undefined, '', NaN, -1, 1.5]) {
    assert.equal(gateCompleteness(absent), 'completeness unknown',
      `${JSON.stringify(absent) ?? 'undefined'} must not be read as zero silent nodes`);
  }
});
