// G-8 of 20261111-015717-dps-remediation-10-review (panel-codex-code, MEDIUM; G-12 its symptom). G-13 of the review before
// it fixed external-review's cap at RISK, but run-graph applied the roster's ceiling afterwards. armLimits took the
// "stricter" of the declared and the derived ceiling by position in PASS,RISK,FAIL, so a declared PASS won, and
// capVerdict('RISK', 'PASS') answers PASS: an edited roster turned an arm that checked nothing into a PASS, the false
// corroboration the cap exists to prevent. A verdict ceiling lowers a verdict, so one of PASS is no cap at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, repoRunDir, runScript } from './helpers.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import { armLimitsFor, validateRoster, CONSERVATIVE_BASIS } from '../scripts/lib/capabilities.mjs';
import { capVerdict, raiseVerdict } from '../scripts/lib/decisions.mjs';

const TABLE = builtinReviewers();
const resolve = (n) => TABLE[n];
const ROSTER = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(ROSTER));
const LADDER = ROSTER.basis_ceilings;
const ARM = ROSTER.panel_arms[0];
const RUNG = CONSERVATIVE_BASIS.convention.verdict_ceiling;

for (const declared of ['PASS', 'FAIL', 'RISK', undefined]) {
  test(`G-8: an arm whose roster entry declares ${declared} is still capped at the rung it stands on`, () => {
    const caps = armLimitsFor(TABLE[ARM.reviewer], { ...ARM, verdict_ceiling: declared }, { ladder: LADDER });
    assert.equal(caps.verdict_ceiling, RUNG);
    // The two lines run-graph applies to an arm's verdict: a RISK from an arm that checked nothing stays RISK.
    assert.equal(capVerdict(raiseVerdict('RISK', 'PASS'), caps.verdict_ceiling), 'RISK');
    assert.equal(capVerdict(raiseVerdict('FAIL', 'PASS'), caps.verdict_ceiling), 'RISK');
    assert.equal(capVerdict(raiseVerdict('PASS', 'PASS'), caps.verdict_ceiling), 'PASS', 'a cap must never raise a verdict');
  });
}

test('G-8: an adapter declaring evidence_capture does not lift an arm\'s verdict cap', () => {
  const capable = { cmd: 'x', capabilities: ['evidence_capture'] };
  assert.equal(armLimitsFor(capable, { reviewer: 'x' }, { ladder: LADDER }).verdict_ceiling, RUNG);
});

test('G-8: a ladder edited to a PASS rung does not reach an arm', () => {
  const ladder = { ...LADDER, convention: { ...LADDER.convention, verdict_ceiling: 'PASS' } };
  assert.equal(armLimitsFor(TABLE[ARM.reviewer], ARM, { ladder }).verdict_ceiling, RUNG);
});

const refusals = (roster) => validateRoster(roster, resolve, { defaultRuntime: 'claude' }).errors.filter((e) => /verdict_ceiling/.test(e));

test('G-8: the shipped roster declares no verdict ceiling mint would refuse', () => {
  assert.deepEqual(refusals(ROSTER), []);
});

for (const value of ['PASS', 'FAIL']) {
  test(`G-8: an arm declaring verdict_ceiling ${value} is refused at mint, the arm named`, () => {
    const bad = clone();
    bad.panel_arms[0].verdict_ceiling = value;
    const errors = refusals(bad);
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.ok(errors[0].includes(bad.panel_arms[0].id), errors[0]);
  });
}

test('G-8: a lens or a ladder rung declaring a PASS ceiling is refused at mint, since it turns any verdict into PASS', () => {
  const lens = clone();
  lens.lenses[0].verdict_ceiling = 'PASS';
  assert.equal(refusals(lens).length, 1, JSON.stringify(refusals(lens)));
  assert.ok(refusals(lens)[0].includes(lens.lenses[0].id), refusals(lens)[0]);
  const rung = clone();
  rung.basis_ceilings.convention.verdict_ceiling = 'PASS';
  assert.equal(refusals(rung).length, 1, JSON.stringify(refusals(rung)));
  assert.match(refusals(rung)[0], /convention/);
});

// G-7 of 20261111-024650-dps-remediation-11-review (arch-review, panel-codex-arch; MEDIUM): an arm's verdict cap is the
// engine's, while the roster's convention rung looks like its owner, so editing that rung was accepted and moved nothing.
for (const value of ['FAIL', null]) {
  test(`G-7: a convention rung declaring verdict_ceiling ${value}, which no arm would apply, is refused at mint`, () => {
    const rung = clone();
    rung.basis_ceilings.convention.verdict_ceiling = value;
    assert.equal(refusals(rung).length, 1, JSON.stringify(refusals(rung)));
    assert.match(refusals(rung)[0], /convention/);
    assert.match(refusals(rung)[0], new RegExp(RUNG));
  });
}

test('G-7: a judge declaring a verdict ceiling no judge would apply is refused at mint, the judge named', () => {
  const judge = clone();
  judge.adjudicators[0].verdict_ceiling = 'FAIL';
  assert.equal(refusals(judge).length, 1, JSON.stringify(refusals(judge)));
  assert.ok(refusals(judge)[0].includes(judge.adjudicators[0].id), refusals(judge)[0]);
});

test('G-7: a rung other than convention is not held to the arm\'s cap', () => {
  const other = clone();
  other.basis_ceilings.measurement.verdict_ceiling = 'RISK';
  assert.deepEqual(refusals(other), []);
});

// G-9 of the same review (panel-codex-code, MEDIUM): run-graph reads the live roster and the PASS refusal ran only at mint,
// so a roster edited after mint reached spawn-node, which accepted the ceiling and capped a failing lens to PASS.
test('G-9: spawn-node refuses a verdict ceiling of PASS, whatever the roster said at mint', (t) => {
  const { base, dir } = repoRunDir({ prefix: 'quorate-arm-ceiling-' });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const r = runScript('spawn-node.mjs', [
    '--print-cmd', '--run-dir', dir, '--node-id', 'x', '--mode', 'lens', '--schema-variant', 'code', '--skill-command', '/x',
    '--allowed-basis', 'convention', '--verdict-ceiling', 'PASS',
  ]);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /--verdict-ceiling PASS/);
});

// G-7 of 20261111-042301-dps-a5-review (code-audit, panel-codex-code; MEDIUM): only PASS was refused, so a typo passed mint
// and spawn-node then died on it, after the run had started, leaving a required lens BLOCKED.
test('G-7 (a5): a verdict ceiling that is not a verdict is refused at mint, wherever a lens or a rung declares one', () => {
  const edits = {
    lens: (r) => { r.lenses[0].verdict_ceiling = 'RISKY'; return r.lenses[0].id; },
    degraded: (r) => { r.lenses[0].degraded_ceiling = 'risk'; return r.lenses[0].id; },
    barrier: (r) => { r.barrier_nodes[0].verdict_ceiling = 'RKS'; return r.barrier_nodes[0].id; },
    rung: (r) => { r.basis_ceilings.measurement.verdict_ceiling = 'RISKY'; return 'measurement'; },
  };
  for (const [where, edit] of Object.entries(edits)) {
    const bad = clone();
    const named = edit(bad);
    const errors = refusals(bad);
    assert.equal(errors.length, 1, `${where}: ${JSON.stringify(errors)}`);
    assert.ok(errors[0].includes(named), errors[0]);
    assert.match(errors[0], /PASS\|RISK\|FAIL/, errors[0]);
  }
});

test('G-7 (a5): a real ceiling, and an absent one, are still accepted', () => {
  const ok = clone();
  ok.lenses[0].verdict_ceiling = 'RISK';
  ok.lenses[0].degraded_ceiling = 'FAIL';
  ok.basis_ceilings.measurement.verdict_ceiling = null;
  assert.deepEqual(refusals(ok), []);
});

// G-6 of the same review (panel-codex-code, LOW): `stricter` ranked an unknown rung at -1 and returned it as the strictest,
// so a typo was recorded in expected.json while external-review applied MEDIUM, and nothing refused it.
const severityRefusals = (roster) => validateRoster(roster, resolve, { defaultRuntime: 'claude' }).errors.filter((e) => /severity_ceiling/.test(e));

test('G-6: a mistyped severity ceiling is not recorded as the arm\'s ceiling', () => {
  const caps = armLimitsFor(TABLE[ARM.reviewer], { ...ARM, severity_ceiling: 'LOWW' }, { ladder: LADDER });
  assert.equal(caps.severity_ceiling, LADDER.convention.severity_ceiling);
  const ladder = { ...LADDER, convention: { ...LADDER.convention, severity_ceiling: 'MEDUIM' } };
  assert.equal(armLimitsFor(TABLE[ARM.reviewer], { reviewer: ARM.reviewer }, { ladder }).severity_ceiling, CONSERVATIVE_BASIS.convention.severity_ceiling);
});

test('G-6: a real severity ceiling on an arm still tightens it', () => {
  assert.equal(armLimitsFor(TABLE[ARM.reviewer], { ...ARM, severity_ceiling: 'LOW' }, { ladder: LADDER }).severity_ceiling, 'LOW');
});

test('G-6: the shipped roster declares no severity ceiling mint would refuse', () => {
  assert.deepEqual(severityRefusals(ROSTER), []);
});

test('G-6: a mistyped severity ceiling is refused at mint, wherever the roster declares one', () => {
  const edits = {
    'panel-arm': (r) => { r.panel_arms[0].severity_ceiling = 'LOWW'; return r.panel_arms[0].id; },
    adjudicator: (r) => { r.adjudicators[0].severity_ceiling = 'LOWW'; return r.adjudicators[0].id; },
    lens: (r) => { r.lenses[0].severity_ceiling = 'LOWW'; return r.lenses[0].id; },
    degraded: (r) => { r.lenses[0].degraded_severity_ceiling = 'RISK'; return r.lenses[0].id; },
    ladder: (r) => { r.basis_ceilings.convention.severity_ceiling = 'LOWW'; return 'convention'; },
  };
  for (const [where, edit] of Object.entries(edits)) {
    const bad = clone();
    const named = edit(bad);
    const errors = severityRefusals(bad);
    assert.equal(errors.length, 1, `${where}: ${JSON.stringify(errors)}`);
    assert.ok(errors[0].includes(named), errors[0]);
  }
});
