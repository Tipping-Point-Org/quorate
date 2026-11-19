// autonomous-run.plan.md stage 4: a seat of the decision panel answers through `external-review --mode decide`, the one
// transport every reviewer role is called through, so it is probed, consented and recorded like every other mode. Its
// answer is one entry, an "Other", or a change (autonomous-run.md criteria 14, 17), always with a reason; a seat that did
// not answer is SILENCE — `result: null` — never a vote (lib/decision-panel.mjs applyRound reads null as silence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, runScript, withTempDir, seedReviewerProbe } from './helpers.mjs';
import * as schemas from '../scripts/lib/reviewer-schemas.mjs';
import { seatResultErrors } from '../scripts/lib/decision-panel.mjs';
import { supportsMode } from '../scripts/lib/reviewers.mjs';
import { probePassed, schemaRoute, unavailableSubject } from '../scripts/lib/reviewer-probe.mjs';
import { UNAVAILABLE_ROLES } from '../scripts/lib/decisions.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const decideSchema = () => {
  assert.equal(typeof schemas.decideSchema, 'function', 'lib/reviewer-schemas.mjs has no decideSchema');
  return schemas.decideSchema();
};
const answer = (over = {}) => ({ status: 'ok', reason: '', choice: 'E1', rationale: 'it bounds the disk', other_text: '', change_of: '', what_would_change: 'a measured cost', citations: [], ...over });

test('decideSchema is strict and asks for every field a seat answer has', () => {
  const s = decideSchema();
  assert.deepEqual(schemas.validateStrict(s), []);
  for (const k of ['status', 'reason', 'choice', 'rationale', 'other_text', 'change_of']) assert.ok(s.required.includes(k), k);
});

test('a seat answer is an entry, an "Other" with its text, or a change naming its entry, always with a reason', () => {
  assert.deepEqual(seatResultErrors({ choice: 'E1', reason: 'r' }), []);
  assert.deepEqual(seatResultErrors({ choice: 'other', reason: 'r', other_text: 'both caps' }), []);
  assert.deepEqual(seatResultErrors({ choice: 'change', reason: 'r', other_text: 'age, 30 days', change_of: 'E2' }), []);
  assert.ok(seatResultErrors({ choice: 'E1', reason: '' }).length, 'a vote with no reason');
  assert.ok(seatResultErrors({ choice: 'other', reason: 'r' }).length, 'an Other with no text');
  assert.ok(seatResultErrors({ choice: 'change', reason: 'r', other_text: 'x' }).length, 'a change naming no entry');
  assert.ok(seatResultErrors({ choice: '', reason: 'r' }).length, 'no choice');
  assert.ok(seatResultErrors(null).length);
});

test('the mode exists, every reviewer adapter that serves the panel takes it, and the review-only adapter does not', () => {
  assert.match(read('scripts/external-review.mjs'), /const MODES = \[[^\]]*'decide'/);
  const table = JSON.parse(read('scripts/reviewers.json')).reviewers;
  assert.equal(supportsMode(table['codex-review'], 'decide'), false);
  const roster = JSON.parse(read('scripts/lens-roster.json'));
  for (const seat of roster.decision_panel.seats) assert.equal(supportsMode(table[seat.reviewer], 'decide'), true, seat.reviewer);
});

test('the probe: native route, one fixed answer passes, and the subject run-graph recognises', () => {
  assert.equal(schemaRoute('decide'), 'native');
  assert.equal(probePassed('decide', { result: { choice: 'E1', reason: 'probe', what_would_change: 'probe', citations: ['probe'] }, not_checked: [] }), true);
  // decision-records.plan.md stage 4: the probe also proves the new field reaches the answer.
  assert.equal(probePassed('decide', { result: { choice: 'E1', reason: 'probe' }, not_checked: [] }), false);
  assert.equal(probePassed('decide', { result: { choice: 'E2', reason: 'probe' }, not_checked: [] }), false);
  assert.equal(probePassed('decide', { result: null, not_checked: [] }), false);
  assert.equal(unavailableSubject('decide', 'codex'), "decision seat 'codex'");
  assert.ok(UNAVAILABLE_ROLES.includes('decision seat'));
  const p = read('prompts/_templates/reviewer-probe-decide.md');
  assert.match(p, /`choice` "E1"/);
  assert.match(p, /`rationale` "probe"/);
});

test('the seat prompt: anonymous, blind in round 1, the three answer shapes, no vendor named', async () => {
  const { buildDecisionSeatPrompt } = await import('../scripts/io/review-prompts.mjs');
  assert.equal(typeof buildDecisionSeatPrompt, 'function', 'io/review-prompts.mjs has no buildDecisionSeatPrompt');
  const view = { round: 1, question: 'Which cap?', entries: [
    { id: 'E1', label: 'Size cap', description: 'LRU', from: null, reasons: [] },
    { id: 'E2', label: 'Age cap', description: '', from: null, reasons: [] }] };
  const p1 = buildDecisionSeatPrompt({ view, letter: 'B', context: 'Work: the code index. Changed: scripts/a.mjs' });
  assert.match(p1, /Judge B/);
  assert.match(p1, /Which cap\?/);
  assert.match(p1, /E1/);
  assert.match(p1, /E2/);
  assert.match(p1, /scripts\/a\.mjs/);
  assert.match(p1, /`other`/);
  assert.match(p1, /`change`/);
  assert.doesNotMatch(p1, /codex|agy|gemini|openai|claude|anthropic/i, 'a vendor reached the seat');
  const later = { ...view, round: 2, entries: [{ ...view.entries[0], reasons: [{ by: 'C', round: 1, reason: 'the disk fills' }] }, view.entries[1]] };
  const p2 = buildDecisionSeatPrompt({ view: later, letter: 'A', context: '' });
  assert.match(p2, /Judge C/);
  assert.match(p2, /the disk fills/);
});

function fakeCodex(dir, body) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-codex.mjs'), [
    "import fsx from 'node:fs';",
    'const a = process.argv;',
    "const i = a.indexOf('--output-last-message');",
    `const body = ${JSON.stringify(body)};`,
    'if (i !== -1 && a[i + 1]) fsx.writeFileSync(a[i + 1], body);',
    'process.stdout.write(body);',
    '',
  ].join('\n'));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'codex.cmd'), `@"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`);
  } else {
    const shim = path.join(binDir, 'codex');
    fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex.mjs" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  return binDir;
}

function launch(dir, body) {
  const binDir = fakeCodex(dir, typeof body === 'string' ? body : JSON.stringify(body));
  const home = path.join(dir, 'home');
  const sink = path.join(home, 'ev');
  fs.mkdirSync(sink, { recursive: true });
  const prompt = path.join(dir, 'prompt.md');
  fs.writeFileSync(prompt, 'Choose an entry.');
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const pathValue = `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`;
  const probes = path.join(dir, 'probes');
  seedReviewerProbe(probes, { mode: 'decide', route: 'native', pathValue });
  const out = path.join(sink, 'seat.json');
  const r = runScript('external-review.mjs', ['--reviewer', 'codex', '--mode', 'decide', '--prompt-file', prompt,
    '--evidence-dir', sink, '--out', out], { env: { [pathKey]: pathValue, QUORATE_HOME: home, QUORATE_REVIEWER_PROBES: probes } });
  return { r, out };
}

test('end to end: a seat\'s answer is recorded as {choice, reason}, with no adapter status inside it', () => {
  withTempDir((dir) => {
    const { r, out } = launch(dir, answer({ choice: 'change', change_of: 'E2', other_text: 'Age cap, 30 days' }));
    assert.equal(r.status, 0, r.output);
    const rec = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(rec.source, 'codex');
    assert.deepEqual(rec.result, { choice: 'change', reason: 'it bounds the disk', other_text: 'Age cap, 30 days', change_of: 'E2', what_would_change: 'a measured cost' });
    assert.ok('egress_basis' in rec);
  });
});

test('end to end: a seat whose answer is not a vote is silence — result null, the reason named', () => {
  withTempDir((dir) => {
    for (const body of [answer({ rationale: '' }), answer({ status: 'error', reason: 'cannot' }), answer({ status: '' }), 'no json here']) {
      const { r, out } = launch(dir, body);
      const rec = JSON.parse(fs.readFileSync(out, 'utf8'));
      assert.equal(rec.result, null, `${JSON.stringify(body)} became a vote\n${r.output}`);
      assert.ok(rec.not_checked.some((n) => /^decision seat 'codex'/.test(n.item)), JSON.stringify(rec.not_checked));
    }
  });
});
